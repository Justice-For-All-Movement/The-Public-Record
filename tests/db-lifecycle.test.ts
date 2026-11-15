import {afterAll,beforeAll,describe,expect,it} from "vitest";
import pg from "pg";
import {createEphemeralDatabase} from "./helpers/ephemeral-db";
import {withPrivateSubject} from "../lib/auth/private-transaction";
import {appendParticipantEvent,listLifecycleEvents} from "../lib/lifecycle/repository";
import {rebuildLifecycle} from "../lib/lifecycle/projection";

const base=process.env.TEST_DATABASE_URL;
const session=(subject:string)=>({subject,issuer:"https://fake-oidc.invalid",expiresAt:Math.floor(Date.now()/1000)+600});
const opts={runtimeRole:"tpr_app_runtime",requireRowSecurity:true};
const filed={type:"filed" as const,occurredOn:"2026-01-02",assertedBy:"requester" as const,verification:"self_reported" as const,
  evidenceRef:null,causedBy:null,correctsEventId:null,payload:{channel:"portal" as const}};

describe.skipIf(!base)("request lifecycle persistence",()=>{
  let eph:{url:string;drop:()=>Promise<void>};
  let pool:pg.Pool;
  const asA=<T,>(fn:(db:pg.PoolClient)=>Promise<T>)=>withPrivateSubject(pool,session("subject-A"),fn,opts);
  const asB=<T,>(fn:(db:pg.PoolClient)=>Promise<T>)=>withPrivateSubject(pool,session("subject-B"),fn,opts);
  beforeAll(async()=>{
    eph=await createEphemeralDatabase(base!);
    pool=new pg.Pool({connectionString:eph.url,max:2});
    await asA(db=>db.query("INSERT INTO tpr_private.request_drafts(id,owner_subject) VALUES('req-A','subject-A')"));
    await asB(db=>db.query("INSERT INTO tpr_private.request_drafts(id,owner_subject) VALUES('req-B','subject-B')"));
  });
  afterAll(async()=>{await pool?.end();await eph?.drop();});

  it("appends events idempotently and rebuilds the projection from stored rows",async()=>{
    const first=await asA(db=>appendParticipantEvent(db,"subject-A","req-A",filed,"idem-key-0000000001"));
    const again=await asA(db=>appendParticipantEvent(db,"subject-A","req-A",filed,"idem-key-0000000001"));
    expect(again).toEqual({event:first.event,replayed:true});
    await expect(asA(db=>appendParticipantEvent(db,"subject-A","req-A",{...filed,occurredOn:"2026-01-03"},"idem-key-0000000001")))
      .rejects.toThrow(/reused/);
    const ack=await asA(db=>appendParticipantEvent(db,"subject-A","req-A",{...filed,type:"acknowledged",occurredOn:"2026-01-05",
      assertedBy:"agency_document",verification:"document_attached",evidenceRef:"doc:fixture-1",payload:{}},null));
    await asA(db=>appendParticipantEvent(db,"subject-A","req-A",{...filed,type:"correction",occurredOn:"2026-01-06",
      correctsEventId:first.event.id,payload:{reason:"Wrong date",retract:false,replacement:{occurredOn:"2026-01-03"}}},null));
    const events=await asA(db=>listLifecycleEvents(db,"req-A"));
    expect(events).toHaveLength(3);
    const p=rebuildLifecycle("req-A",events);
    expect(p.facts).toMatchObject({filedOn:"2026-01-03",receivedOn:"2026-01-05",receiptVerification:"document_attached"});
    expect(p.status!.basisEventId).toBe(ack.event.id);
  });
  it("keeps history append-only and private to its owner",async()=>{
    await expect(asA(db=>db.query("UPDATE tpr_private.request_lifecycle_events SET occurred_on='2026-01-01'"))).rejects.toThrow();
    expect(await asB(db=>listLifecycleEvents(db,"req-A"))).toEqual([]);
    await expect(asB(db=>appendParticipantEvent(db,"subject-B","req-A",filed,null))).rejects.toThrow();
    const [eventA]=await asA(db=>listLifecycleEvents(db,"req-A"));
    await expect(asB(db=>appendParticipantEvent(db,"subject-B","req-B",{...filed,type:"correction",
      correctsEventId:eventA.id,payload:{reason:"cross-owner",retract:true}},null))).rejects.toThrow();
  });
  it("refuses participant-recorded reviewer verification even with raw SQL",async()=>{
    await expect(asA(db=>db.query(`INSERT INTO tpr_private.request_lifecycle_events
      (request_id,owner_subject,event_type,occurred_on,asserted_by,verification,evidence_ref)
      VALUES('req-A','subject-A','acknowledged','2026-01-05','reviewer','reviewer_verified','doc:forged')`))).rejects.toThrow(/row-level security/);
    await expect(asA(db=>db.query(`INSERT INTO tpr_private.request_lifecycle_events
      (request_id,owner_subject,event_type,occurred_on,asserted_by,verification)
      VALUES('req-A','subject-A','acknowledged','2026-01-05','agency_document','self_reported')`))).rejects.toThrow(/check constraint/);
  });
});
