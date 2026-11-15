import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import pg from "pg";
import {randomBytes} from "node:crypto";
import {createEphemeralDatabase} from "./helpers/ephemeral-db";
import {loadConfig,resetConfigForTests} from "../lib/server/config";
import {resetPoolForTests,withSubject} from "../lib/server/db";
import {createPostgresStore} from "../lib/server/member-store";
import {createPostgresDraftStore} from "../lib/server/draft-store";
import {backoffSeconds,PermanentJobError,runWorkerOnce} from "../lib/jobs/outbox";
import {handleDeadlineReminder,plannedReminders,reminderText} from "../lib/jobs/reminders";
import {listNotifications,setPreferences} from "../lib/server/notifications";
import {createFakeMailProvider,createResendProvider,MailError} from "../lib/jobs/mail";
import {computeFoiaClock} from "../lib/clock/foia-clock";
import {createFederalCalendar,addCalendarDays} from "../lib/clock/federal-calendar";
import {POST as runJobs} from "../app/api/internal/jobs/run/route";
import {req} from "./helpers/http";

const base=process.env.TEST_DATABASE_URL;
const ISS="https://fake-oidc.the-public-record.invalid";
const sess=(subject:string)=>({id:randomBytes(16).toString("base64url"),subject,issuer:ISS,expiresAt:Math.floor(Date.now()/1000)+600});
const today=new Date().toISOString().slice(0,10);

describe("reminder planning and mail adapters",()=>{
  it("plans reminders only for future estimates and never for recorded determinations",()=>{
    const cal=createFederalCalendar();
    const filed=addCalendarDays(today,-1);
    const clock=computeFoiaClock({today,filedOn:filed,receivedOn:filed,receiptBasis:"agency_acknowledgment"},cal);
    const plans=plannedReminders("drf_aaaaaaaaaaaaaaaaaaaa",clock,today);
    expect(plans).toHaveLength(1);
    expect(plans[0].key).toBe(`deadline:drf_aaaaaaaaaaaaaaaaaaaa:det:${clock.determination.dueOn}`);
    const done=computeFoiaClock({today,filedOn:filed,receivedOn:filed,receiptBasis:"agency_acknowledgment",determination:{on:today,adverse:false}},cal);
    expect(plannedReminders("drf_aaaaaaaaaaaaaaaaaaaa",done,today)).toEqual([]);
    expect(reminderText("determination_estimate","2026-02-02").body).toMatch(/estimate, not a deadline the agency has missed/);
    expect(backoffSeconds(1)).toBe(30);expect(backoffSeconds(20)).toBe(3600);
  });
  it("maps provider failures to short codes and never sends without configuration",async()=>{
    const msg={to:"member@example.org",subject:"Test",text:"Synthetic"};
    const ok=createFakeMailProvider();await ok.send(msg);expect(ok.outbox).toHaveLength(1);
    await expect(createFakeMailProvider("invalid_credentials").send(msg)).rejects.toMatchObject({code:"invalid_credentials",retryable:false});
    await expect(createFakeMailProvider("offline").send(msg)).rejects.toMatchObject({code:"provider_unavailable",retryable:true});
    await expect(ok.send({...msg,subject:"x\r\nBcc: victim@example.org"})).rejects.toMatchObject({code:"rejected_message"});
    const resp=(status:number,body:unknown={})=>vi.fn(async()=>new Response(JSON.stringify(body),{status})) as unknown as typeof fetch;
    const p=(f:typeof fetch)=>createResendProvider({apiKey:"test-key",from:"Records <no-reply@example.org>"},f);
    await expect(p(resp(200,{id:"msg_1"})).send(msg)).resolves.toEqual({providerId:"msg_1"});
    await expect(p(resp(401)).send(msg)).rejects.toMatchObject({code:"invalid_credentials",retryable:false});
    await expect(p(resp(503)).send(msg)).rejects.toMatchObject({code:"provider_unavailable",retryable:true});
    await expect(p(vi.fn(async()=>{throw new TypeError("offline");}) as unknown as typeof fetch).send(msg)).rejects.toBeInstanceOf(MailError);
    expect(()=>createResendProvider({apiKey:"",from:"no-reply@example.org"})).toThrow(MailError);
  });
});

describe.skipIf(!base)("outbox worker against PostgreSQL",()=>{
  let eph:{url:string;drop:()=>Promise<void>};
  let owner:pg.Client;let pool:pg.Pool;
  const ada=sess("fake|ada");
  beforeAll(async()=>{
    eph=await createEphemeralDatabase(base!);
    owner=new pg.Client({connectionString:eph.url});await owner.connect();
    pool=new pg.Pool({connectionString:eph.url,max:4});
    resetConfigForTests(loadConfig({NODE_ENV:"test",DATABASE_URL:eph.url,DATABASE_RUNTIME_ROLE:"tpr_app_runtime",WORKER_TOKEN:"w".repeat(40)}));
    await createPostgresStore().startSession(ada);
  });
  afterAll(async()=>{await owner?.end();await pool?.end();await resetPoolForTests();resetConfigForTests();await eph?.drop();});
  const makeDue=()=>owner.query("UPDATE tpr_private.outbox_jobs SET run_after=now()-interval '1 second' WHERE status='pending'");

  it("schedules a reminder in the same transaction as the event, deduplicated",async()=>{
    const drafts=createPostgresDraftStore();
    const {draft}=await drafts.create(ada,null,null);
    const filed={type:"filed" as const,occurredOn:addCalendarDays(today,-1),assertedBy:"requester" as const,verification:"self_reported" as const,
      evidenceRef:null,causedBy:null,correctsEventId:null,payload:{channel:"portal" as const}};
    await drafts.appendEvent(ada,draft.id,filed,null);
    await drafts.appendEvent(ada,draft.id,{...filed,type:"interim_release",payload:{}},null);
    const jobs=await owner.query("SELECT kind,status,dedupe_key FROM tpr_private.outbox_jobs");
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]).toMatchObject({kind:"deadline_reminder",status:"pending"});
    expect((await runWorkerOnce(pool,"worker-a",handleDeadlineReminder)).leased).toBe(0); // not due yet
  });
  it("delivers an in-app notification once, under the worker role",async()=>{
    await makeDue();
    const r=await runWorkerOnce(pool,"worker-a",handleDeadlineReminder);
    expect(r).toMatchObject({leased:1,done:1});
    const notes=await listNotifications(createPostgresStore(),ada);
    expect(notes).toHaveLength(1);
    expect(notes[0].linkPath).toMatch(/^\/me\/drafts\/drf_/);
    expect((await runWorkerOnce(pool,"worker-a",handleDeadlineReminder)).leased).toBe(0);
    expect(await listNotifications(createPostgresStore(),sess("fake|grace"))).toEqual([]);
  });
  it("leases each job to exactly one of several concurrent workers and recovers expired leases",async()=>{
    for(let i=0;i<6;i++)await owner.query(`INSERT INTO tpr_private.outbox_jobs(owner_subject,kind,dedupe_key,payload,run_after)
      VALUES('fake|ada','deadline_reminder',$1,$2::jsonb,now()-interval '1 minute')`,[`test:conc:${i}`,JSON.stringify({draftId:"drf_bbbbbbbbbbbbbbbbbbbb",reminder:"determination_estimate",date:today})]);
    const handler=vi.fn(async()=>{await new Promise(r=>setTimeout(r,20));});
    const [a,b,c]=await Promise.all(["w1","w2","w3"].map(w=>runWorkerOnce(pool,"worker-"+w,handler,{batch:3})));
    expect(a.done+b.done+c.done).toBe(6);
    expect(handler).toHaveBeenCalledTimes(6);
    await owner.query(`INSERT INTO tpr_private.outbox_jobs(owner_subject,kind,dedupe_key,status,lease_owner,lease_expires_at,attempts,run_after)
      VALUES('fake|ada','deadline_reminder','test:stuck','leased','worker-crashed',now()-interval '1 minute',1,now()-interval '5 minutes')`);
    expect((await runWorkerOnce(pool,"worker-new",async()=>{})).done).toBe(1);
  });
  it("retries with backoff and dead-letters with a short error code",async()=>{
    await owner.query(`INSERT INTO tpr_private.outbox_jobs(owner_subject,kind,dedupe_key,max_attempts,run_after)
      VALUES('fake|ada','deadline_reminder','test:flaky',2,now()-interval '1 minute')`);
    const failing=async()=>{throw Object.assign(new Error("smtp said no to someone@example.org"),{code:"provider_unavailable"});};
    expect(await runWorkerOnce(pool,"worker-a",failing)).toMatchObject({retried:1,dead:0});
    let row=(await owner.query("SELECT status,attempts,last_error_code,run_after>now() AS later FROM tpr_private.outbox_jobs WHERE dedupe_key='test:flaky'")).rows[0];
    expect(row).toMatchObject({status:"pending",attempts:1,last_error_code:"provider_unavailable",later:true});
    await makeDue();
    expect(await runWorkerOnce(pool,"worker-a",failing)).toMatchObject({dead:1});
    row=(await owner.query("SELECT status,last_error_code FROM tpr_private.outbox_jobs WHERE dedupe_key='test:flaky'")).rows[0];
    expect(row).toEqual({status:"dead",last_error_code:"provider_unavailable"});
    await owner.query(`INSERT INTO tpr_private.outbox_jobs(owner_subject,kind,dedupe_key,run_after) VALUES('fake|ada','deadline_reminder','test:bad',now()-interval '1 minute')`);
    expect(await runWorkerOnce(pool,"worker-a",async()=>{throw new PermanentJobError("invalid_payload");})).toMatchObject({dead:1});
  });
  it("confines the worker role and honours member opt-out",async()=>{
    const asWorker=(sql:string)=>withSubject({subject:"worker:x",issuer:"https://worker.the-public-record.invalid",expiresAt:Math.floor(Date.now()/1000)+60},
      async db=>{await db.query("SET LOCAL ROLE tpr_worker_runtime");return db.query(sql);});
    await expect(asWorker("SELECT draft_body FROM tpr_private.request_drafts")).rejects.toThrow(/permission denied/);
    await expect(asWorker("SELECT body FROM tpr_private.member_notifications")).rejects.toThrow(/permission denied/);
    await expect(asWorker("SELECT * FROM tpr_private.audit_events")).rejects.toThrow(/permission denied/);
    await setPreferences(createPostgresStore(),ada,false);
    await owner.query(`INSERT INTO tpr_private.outbox_jobs(owner_subject,kind,dedupe_key,payload,run_after)
      VALUES('fake|ada','deadline_reminder','test:optout',$1::jsonb,now()-interval '1 minute')`,[JSON.stringify({draftId:"drf_cccccccccccccccccccc",reminder:"determination_estimate",date:today})]);
    const before=(await listNotifications(createPostgresStore(),ada)).length;
    expect((await runWorkerOnce(pool,"worker-a",handleDeadlineReminder)).done).toBe(1);
    expect((await listNotifications(createPostgresStore(),ada)).length).toBe(before);
  });
  it("exposes the job runner only with the configured bearer token",async()=>{
    expect((await runJobs(req("/api/internal/jobs/run",{method:"POST",origin:null,headers:{authorization:"Bearer wrong"}}))).status).toBe(401);
    const ok=await runJobs(req("/api/internal/jobs/run",{method:"POST",origin:null,headers:{authorization:"Bearer "+"w".repeat(40)}}));
    expect(ok.status).toBe(200);
    resetConfigForTests(loadConfig({NODE_ENV:"test",DATABASE_URL:eph.url}));
    expect((await runJobs(req("/api/internal/jobs/run",{method:"POST",origin:null,headers:{authorization:"Bearer "+"w".repeat(40)}}))).status).toBe(404);
  });
});
