import {afterAll,beforeAll,describe,expect,it} from "vitest";
import pg from "pg";
import {randomBytes} from "node:crypto";
import {POST as createDraft} from "../app/api/v1/me/public-record/drafts/route";
import {POST as upload} from "../app/api/v1/me/public-record/requests/[id]/uploads/route";
import {GET as myPubs,POST as requestPub} from "../app/api/v1/me/public-record/publications/route";
import {DELETE as withdraw} from "../app/api/v1/me/public-record/publications/[id]/consent/route";
import {GET as queue} from "../app/api/v1/admin/public-record/publications/route";
import {POST as review} from "../app/api/v1/admin/public-record/publications/[id]/route";
import {GET as reviewFile} from "../app/api/v1/admin/public-record/publications/[id]/file/route";
import {GET as publicList} from "../app/api/v1/public-record/published/route";
import {GET as publicMeta} from "../app/api/v1/public-record/published/[publicId]/route";
import {GET as publicFile} from "../app/api/v1/public-record/published/[publicId]/file/route";
import {loadConfig,resetConfigForTests} from "../lib/server/config";
import {resetPoolForTests} from "../lib/server/db";
import {ATTESTATIONS,PUBLICATION_CONSENT} from "../lib/publication/publication";
import {createEphemeralDatabase} from "./helpers/ephemeral-db";
import {Jar,req,signIn} from "./helpers/http";
import {pdf} from "./helpers/zip";

const base=process.env.TEST_DATABASE_URL;
const ISS="https://fake-oidc.the-public-record.invalid";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P=(o:Record<string,string>)=>({params:Promise.resolve(o)}) as any;
const j=(method:string,jar:Jar|undefined,body?:unknown)=>req("/x",{method,jar,body:body===undefined?undefined:JSON.stringify(body),headers:{"content-type":"application/json"}});
const all=Object.fromEntries(Object.keys(ATTESTATIONS).map(k=>[k,true]));
const released=pdf("BT (Fictional released inspection summary) Tj ET");

describe.skipIf(!base)("publication authorization, review and withdrawal (TPR-31)",()=>{
  let eph:{url:string;drop:()=>Promise<void>};let owner:pg.Client;
  const ada=new Jar(),lin=new Jar(),grace=new Jar();
  let draftId="",recordObj="",letterObj="",requestId="",publicId="";
  beforeAll(async()=>{
    eph=await createEphemeralDatabase(base!);
    owner=new pg.Client({connectionString:eph.url});await owner.connect();
    for(const [s,role] of [["fake|lin","records_reviewer"],["fake|ada","records_reviewer"],["fake|grace","editor"]])
      await owner.query(`INSERT INTO tpr_private.role_grant_events(owner_subject,issuer,role,grant_action,actor_subject,reason)
        VALUES($1,$2,$3,'granted','bootstrap-operator','Synthetic test assignment')`,[s,ISS,role]);
    resetConfigForTests(loadConfig({NODE_ENV:"test",AUTH_PROVIDER:"fake",SESSION_SECRET:randomBytes(32).toString("base64url"),
      STORAGE_DRIVER:"memory",MALWARE_SCANNER:"fake",PRIVATE_STORAGE_KEY:randomBytes(32).toString("base64url"),
      DATABASE_URL:eph.url,DATABASE_RUNTIME_ROLE:"tpr_app_runtime"}));
    await signIn(ada,"ada");await signIn(lin,"lin");await signIn(grace,"grace");
    draftId=(await (await createDraft(j("POST",ada,{}))).json()).draft.id;
    const up=async(purpose:string)=>{const f=new FormData();f.set("file",new Blob([new Uint8Array(released)],{type:"application/pdf"}),"x.pdf");f.set("purpose",purpose);
      return (await (await upload(req("/x",{method:"POST",jar:ada,body:f}),P({id:draftId}))).json()).upload.id as string;};
    recordObj=await up("released_record");letterObj=await up("correspondence");
  });
  afterAll(async()=>{await owner?.end();await resetPoolForTests();resetConfigForTests();await eph?.drop();});

  it("accepts only explicit consent for an agency-released record",async()=>{
    expect((await requestPub(j("POST",ada,{objectId:letterObj,title:"My letter",consent:PUBLICATION_CONSENT}))).status).toBe(422);
    expect((await requestPub(j("POST",ada,{objectId:recordObj,title:"Inspection summary"}))).status).toBe(422);
    expect((await requestPub(j("POST",grace,{objectId:recordObj,title:"Not mine",consent:PUBLICATION_CONSENT}))).status).toBe(404); // not her document
    const res=await requestPub(j("POST",ada,{objectId:recordObj,title:"Fictional harbor inspection summary",agencyLabel:"Fictional Safety Bureau",consent:PUBLICATION_CONSENT}));
    expect(res.status).toBe(201);
    requestId=(await res.json()).publication.id;
    expect((await requestPub(j("POST",ada,{objectId:recordObj,title:"Again",consent:PUBLICATION_CONSENT}))).status).toBe(409);
    expect((await (await publicList()).json()).records).toEqual([]);
  });
  it("requires an independent, assigned records reviewer who affirms every attestation",async()=>{
    expect((await queue(req("/x",{jar:grace}))).status).toBe(403);
    const adaQueue=(await (await queue(req("/x",{jar:ada}))).json()).queue;
    expect(adaQueue.map((q:{id:string})=>q.id)).not.toContain(requestId); // own request hidden even with the reviewer role
    expect((await review(j("POST",ada,{action:"claim"}),P({id:requestId}))).status).toBe(409);
    expect((await reviewFile(req("/x",{jar:lin}),P({id:requestId}))).status).toBe(404); // not yet assigned
    expect((await review(j("POST",lin,{action:"claim"}),P({id:requestId}))).status).toBe(200);
    const f=await reviewFile(req("/x",{jar:lin}),P({id:requestId}));
    expect(Buffer.from(await f.arrayBuffer()).equals(released)).toBe(true);
    expect((await review(j("POST",lin,{action:"approve",attestation:{...all,redactions_intact:false}}),P({id:requestId}))).status).toBe(422);
    const ok=await review(j("POST",lin,{action:"approve",attestation:all,note:"Checked fixture"}),P({id:requestId}));
    expect(ok.status).toBe(200);
    publicId=(await ok.json()).publication.publicId;
    expect(publicId).toMatch(/^pub_[0-9a-f]{20}$/);
  });
  it("publishes a separate derivative with public fields only",async()=>{
    const list=(await (await publicList()).json()).records;
    expect(list.map((r:{publicId:string})=>r.publicId)).toEqual([publicId]);
    const meta=await (await publicMeta(new Request("http://x"),P({publicId}))).json();
    expect(meta.record).toMatchObject({title:"Fictional harbor inspection summary",agencyLabel:"Fictional Safety Bureau",mime:"application/pdf"});
    expect(JSON.stringify(meta)).not.toMatch(/fake\||private\/|derivative|quarantine/);
    const file=await publicFile(new Request("http://x"),P({publicId}));
    expect(file.status).toBe(200);
    expect(Buffer.from(await file.arrayBuffer()).equals(released)).toBe(true);
    expect(file.headers.get("cache-control")).toBe("no-store");
    const row=(await owner.query("SELECT derivative_key FROM tpr_private.publication_requests WHERE id=$1",[requestId])).rows[0];
    const orig=(await owner.query("SELECT private_storage_key FROM tpr_private.quarantine_objects WHERE id=$1",[recordObj])).rows[0];
    expect(row.derivative_key).not.toBe(orig.private_storage_key);
  });
  it("stops delivery immediately when the owner withdraws consent",async()=>{
    expect((await withdraw(j("DELETE",lin),P({id:requestId}))).status).toBe(404);
    const w=await withdraw(j("DELETE",ada),P({id:requestId}));
    expect(w.status).toBe(200);
    expect((await w.json()).notice).toMatch(/cannot be recalled/);
    expect((await publicMeta(new Request("http://x"),P({publicId}))).status).toBe(404);
    expect((await publicFile(new Request("http://x"),P({publicId}))).status).toBe(404);
    expect((await (await publicList()).json()).records).toEqual([]);
    const events=(await owner.query("SELECT event_action FROM tpr_private.consent_events WHERE quarantine_object_id=$1 ORDER BY recorded_at",[recordObj])).rows;
    expect(events.map(e=>e.event_action)).toEqual(["granted","revoked"]);
    const mine=(await (await myPubs(req("/x",{jar:ada}))).json()).publications;
    expect(mine[0]).toMatchObject({status:"withdrawn"});
    await expect(owner.query("DELETE FROM tpr_private.publication_requests")).rejects.toThrow(/never deleted/);
  });
  it("hides a published record if consent is revoked outside the request flow",async()=>{
    // A re-request after withdrawal goes through review again; then revoke consent directly.
    const again=await (await requestPub(j("POST",ada,{objectId:recordObj,title:"Fictional harbor inspection summary, second request",consent:PUBLICATION_CONSENT}))).json();
    await review(j("POST",lin,{action:"claim"}),P({id:again.publication.id}));
    const pub=(await (await review(j("POST",lin,{action:"approve",attestation:all}),P({id:again.publication.id}))).json()).publication.publicId;
    expect((await publicMeta(new Request("http://x"),P({publicId:pub}))).status).toBe(200);
    await owner.query(`INSERT INTO tpr_private.consent_events(owner_subject,quarantine_object_id,scope,event_action) VALUES('fake|ada',$1,'web_publication','revoked')`,[recordObj]);
    expect((await publicMeta(new Request("http://x"),P({publicId:pub}))).status).toBe(404);
  });
});
