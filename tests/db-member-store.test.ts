import {afterAll,beforeAll,describe,expect,it} from "vitest";
import pg from "pg";
import {randomBytes} from "node:crypto";
import {createEphemeralDatabase} from "./helpers/ephemeral-db";
import {loadConfig,resetConfigForTests} from "../lib/server/config";
import {resetPoolForTests,withSubject} from "../lib/server/db";
import {createPostgresStore} from "../lib/server/member-store";
import {EFFECTIVE_CONSENT_SQL} from "../lib/audit/consent";

const base=process.env.TEST_DATABASE_URL;
const ISS="https://fake-oidc.the-public-record.invalid";
const sess=(subject:string,issuer=ISS)=>({id:randomBytes(16).toString("base64url"),subject,issuer,expiresAt:Math.floor(Date.now()/1000)+600});

describe.skipIf(!base)("PostgreSQL member store under the runtime role",()=>{
  let eph:{url:string;drop:()=>Promise<void>};
  let owner:pg.Client;
  beforeAll(async()=>{
    eph=await createEphemeralDatabase(base!);
    owner=new pg.Client({connectionString:eph.url});await owner.connect();
    resetConfigForTests(loadConfig({NODE_ENV:"test",DATABASE_URL:eph.url,DATABASE_RUNTIME_ROLE:"tpr_app_runtime"}));
  });
  afterAll(async()=>{await owner?.end();await resetPoolForTests();resetConfigForTests();await eph?.drop();});

  it("creates accounts and sessions, audits them, and honours revocation",async()=>{
    const store=createPostgresStore();
    const s=sess("fake|ada");
    expect(await store.startSession(s)).toBe("active");
    expect(await store.isSessionActive(s)).toBe(true);
    await store.endSession(s);
    expect(await store.isSessionActive(s)).toBe(false);
    const audit=await store.listAudit(s);
    expect(audit.map(a=>a.action)).toEqual(["session_ended","session_started"]);
    expect(await store.isSessionActive(sess("fake|ada"))).toBe(false); // unknown session id
  });
  it("binds an account to its first issuer and refuses locked accounts",async()=>{
    const store=createPostgresStore();
    expect(await store.startSession(sess("fake|ada","https://other-issuer.example"))).toBe("locked");
    await owner.query("UPDATE tpr_private.member_accounts SET status='locked' WHERE owner_subject='fake|ada'");
    expect(await store.startSession(sess("fake|ada"))).toBe("locked");
  });
  it("derives roles only from owner-provisioned grant history",async()=>{
    const store=createPostgresStore();
    const s=sess("fake|grace");
    await store.startSession(s);
    expect(await store.rolesFor(s)).toEqual(["requester"]);
    await expect(withSubject(s,db=>db.query(`INSERT INTO tpr_private.role_grant_events(owner_subject,issuer,role,grant_action,actor_subject,reason)
      VALUES('fake|grace',$1,'admin','granted','fake|lin','self-escalation attempt')`,[ISS]))).rejects.toThrow(/permission denied/);
    await owner.query(`INSERT INTO tpr_private.role_grant_events(owner_subject,issuer,role,grant_action,actor_subject,reason)
      VALUES('fake|grace',$1,'editor','granted','bootstrap-operator','Fixture editorial assignment')`,[ISS]);
    expect(await store.rolesFor(s)).toEqual(["editor","requester"]);
    await owner.query(`INSERT INTO tpr_private.role_grant_events(owner_subject,issuer,role,grant_action,actor_subject,reason)
      VALUES('fake|grace',$1,'editor','revoked','bootstrap-operator','Fixture assignment ended')`,[ISS]);
    expect(await store.rolesFor(s)).toEqual(["requester"]);
    // Grants issued for another issuer never apply.
    await owner.query(`INSERT INTO tpr_private.role_grant_events(owner_subject,issuer,role,grant_action,actor_subject,reason)
      VALUES('fake|grace','https://other-issuer.example','moderator','granted','bootstrap-operator','Wrong issuer')`);
    expect(await store.rolesFor(s)).toEqual(["requester"]);
  });
  it("prevents the runtime role from unlocking accounts, editing audit or reading others' sessions",async()=>{
    const s=sess("fake|lin");
    await createPostgresStore().startSession(s);
    await expect(withSubject(s,db=>db.query("UPDATE tpr_private.member_accounts SET status='active'"))).rejects.toThrow(/permission denied/);
    await expect(withSubject(s,db=>db.query("UPDATE tpr_private.audit_events SET object_id='x'"))).rejects.toThrow();
    await expect(withSubject(s,db=>db.query("UPDATE tpr_private.app_sessions SET expires_at=now()+interval '1 day'"))).rejects.toThrow(/permission denied/);
    const visible=await withSubject(s,db=>db.query("SELECT owner_subject FROM tpr_private.app_sessions"));
    expect(new Set(visible.rows.map(r=>r.owner_subject))).toEqual(new Set(["fake|lin"]));
  });
  it("computes effective consent from the latest event in SQL",async()=>{
    await owner.query("INSERT INTO tpr_private.request_drafts(id,owner_subject) VALUES('d','fake|lin')");
    await owner.query(`INSERT INTO tpr_private.quarantine_objects(id,draft_id,owner_subject,private_storage_key,sha256)
      VALUES('q','d','fake|lin','private/quarantine/v1/cccccccccccccccccccccccccccccccc/00000000-0000-4000-8000-000000000002',$1)`,["c".repeat(64)]);
    await owner.query(`INSERT INTO tpr_private.consent_events(owner_subject,quarantine_object_id,scope,event_action,recorded_at)
      VALUES('fake|lin','q','web_publication','granted',now()-interval '1 hour'),('fake|lin','q','web_publication','revoked',now())`);
    const r=await withSubject(sess("fake|lin"),db=>db.query(EFFECTIVE_CONSENT_SQL));
    expect(r.rows).toEqual([expect.objectContaining({quarantine_object_id:"q",scope:"web_publication",granted:false})]);
  });
});
