import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {GET as listDrafts,POST as createDraft} from "../app/api/v1/me/public-record/drafts/route";
import {GET as getDraft,PATCH as patchDraft} from "../app/api/v1/me/public-record/drafts/[id]/route";
import {GET as listEvents,POST as postEvent} from "../app/api/v1/me/public-record/requests/[id]/events/route";
import {GET as audit} from "../app/api/v1/me/public-record/audit/route";
import {GET as templates} from "../app/api/v1/public-record/templates/route";
import {loadConfig,resetConfigForTests} from "../lib/server/config";
import {resetPoolForTests} from "../lib/server/db";
import {createEphemeralDatabase} from "./helpers/ephemeral-db";
import {Jar,req,signIn} from "./helpers/http";
import {SELF_FILING_CONFIRMATION} from "../lib/filing/self-filing-guide";

const base=process.env.TEST_DATABASE_URL;
const params=(id:string)=>({params:Promise.resolve({id})});
const jsonReq=(path:string,method:string,jar:Jar,body?:unknown,headers:Record<string,string>={})=>
  req(path,{method,jar,body:body===undefined?undefined:JSON.stringify(body),headers:{"content-type":"application/json",...headers}});
const modes=[{name:"memory store",db:false},...(base?[{name:"PostgreSQL under RLS",db:true}]:[])];

describe.each(modes)("member drafts API ($name)",({db})=>{
  let eph:{url:string;drop:()=>Promise<void>}|null=null;
  const ada=new Jar(),grace=new Jar();
  beforeAll(async()=>{
    if(db)eph=await createEphemeralDatabase(base!);
    resetConfigForTests(loadConfig({NODE_ENV:"test",AUTH_PROVIDER:"fake",
      ...(eph?{DATABASE_URL:eph.url,DATABASE_RUNTIME_ROLE:"tpr_app_runtime"}:{})}));
    await signIn(ada,"ada");await signIn(grace,"grace");
  });
  afterAll(async()=>{await resetPoolForTests();resetConfigForTests();await eph?.drop();});

  let draftId="";
  it("serves public work cards anonymously but private drafts only when signed in",async()=>{
    const cards=await (await templates()).json();
    expect(cards.synthetic).toBe(true);
    expect(cards.templates.map((t:{templateId:string})=>t.templateId)).not.toContain("tpl-fictional-inspection-logs");
    expect(JSON.stringify(cards)).not.toMatch(/fixture-editor|fixture-reviewer/);
    expect((await listDrafts(req("/api/v1/me/public-record/drafts"))).status).toBe(401);
  });
  it("adopts a reviewed template as a pinned private copy, idempotently",async()=>{
    const key={"idempotency-key":"adopt-key-000000000001"};
    const res=await createDraft(jsonReq("/api/v1/me/public-record/drafts","POST",ada,{templateId:"tpl-fictional-contract-notices"},key));
    expect(res.status).toBe(201);
    const {draft}=await res.json();
    expect(draft).toMatchObject({templateId:"tpl-fictional-contract-notices",templateVersion:2,version:1,rangeStart:"2024-01-01"});
    expect(draft.body).toMatch(/contract award notices/);
    draftId=draft.id;
    const replay=await createDraft(jsonReq("/api/v1/me/public-record/drafts","POST",ada,{templateId:"tpl-fictional-contract-notices"},key));
    expect(replay.status).toBe(200);
    expect((await replay.json()).draft.id).toBe(draftId);
    expect((await createDraft(jsonReq("/api/v1/me/public-record/drafts","POST",ada,{templateId:"tpl-fictional-inspection-logs"}))).status).toBe(404);
    expect((await createDraft(jsonReq("/api/v1/me/public-record/drafts","POST",ada,{templateId:"x",owner:"fake|grace"}))).status).toBe(422);
    const list=await (await listDrafts(req("/api/v1/me/public-record/drafts",{jar:ada}))).json();
    expect(list.drafts.map((d:{id:string})=>d.id)).toEqual([draftId]);
  });
  it("saves with optimistic concurrency and returns advisory lint",async()=>{
    const path="/api/v1/me/public-record/drafts/"+draftId;
    expect((await patchDraft(jsonReq(path,"PATCH",ada,{title:"Edited"}),params(draftId))).status).toBe(428);
    const ok=await patchDraft(jsonReq(path,"PATCH",ada,{title:"Edited",feeCapUsd:50},{"if-match":'"v1"'}),params(draftId));
    expect(ok.status).toBe(200);
    const body=await ok.json();
    expect(body.draft).toMatchObject({title:"Edited",feeCapUsd:50,version:2});
    expect(body.lint.map((i:{code:string})=>i.code)).toContain("agency_unverified");
    expect((await patchDraft(jsonReq(path,"PATCH",ada,{title:"Stale"},{"if-match":'"v1"'}),params(draftId))).status).toBe(412);
    expect((await patchDraft(jsonReq(path,"PATCH",ada,{state:"released"},{"if-match":'"v2"'}),params(draftId))).status).toBe(422);
    expect((await patchDraft(jsonReq(path,"PATCH",ada,{rangeStart:"2026-01-02",rangeEnd:"2025-01-01"},{"if-match":'"v2"'}),params(draftId))).status).toBe(422);
    expect((await patchDraft(req(path,{method:"PATCH",jar:ada,origin:"https://evil.example",body:"{}",headers:{"content-type":"application/json","if-match":'"v2"'}}),params(draftId))).status).toBe(403);
  });
  it("hides one member's drafts and timeline from another",async()=>{
    expect((await getDraft(req("/api/v1/me/public-record/drafts/"+draftId,{jar:grace}),params(draftId))).status).toBe(404);
    expect((await patchDraft(jsonReq("/x","PATCH",grace,{title:"hijack"},{"if-match":'"v2"'}),params(draftId))).status).toBe(404);
    expect((await listEvents(req("/x",{jar:grace}),params(draftId))).status).toBe(404);
    expect((await postEvent(jsonReq("/x","POST",grace,{type:"filed",occurredOn:"2026-01-02",payload:{channel:"portal"},
      selfFilingConfirmation:SELF_FILING_CONFIRMATION}),params(draftId))).status).toBe(404);
    expect((await (await listDrafts(req("/x",{jar:grace}))).json()).drafts).toEqual([]);
  });
  it("records lifecycle events with honest evidence labels and a clock",async()=>{
    const path=`/api/v1/me/public-record/requests/${draftId}/events`;
    expect((await postEvent(jsonReq(path,"POST",ada,{type:"filed",occurredOn:"2026-01-02",payload:{channel:"portal"}}),params(draftId))).status).toBe(422);
    const confirm={selfFilingConfirmation:SELF_FILING_CONFIRMATION};
    const filed=await postEvent(jsonReq(path,"POST",ada,{type:"filed",occurredOn:"2026-01-02",payload:{channel:"portal"},...confirm},{"idempotency-key":"event-key-00000000001"}),params(draftId));
    expect(filed.status).toBe(201);
    const again=await postEvent(jsonReq(path,"POST",ada,{type:"filed",occurredOn:"2026-01-02",payload:{channel:"portal"},...confirm},{"idempotency-key":"event-key-00000000001"}),params(draftId));
    expect(again.status).toBe(200);
    expect((await postEvent(jsonReq(path,"POST",ada,{type:"acknowledged",occurredOn:"2026-01-05",assertedBy:"reviewer",
      verification:"reviewer_verified",evidenceRef:"doc:forged"}),params(draftId))).status).toBe(422);
    expect((await postEvent(jsonReq(path,"POST",ada,{type:"filed",occurredOn:"2999-01-01",payload:{channel:"portal"},...confirm}),params(draftId))).status).toBe(422);
    expect((await postEvent(jsonReq(path,"POST",ada,{type:"clarification_answered",occurredOn:"2026-01-06",causedBy:"00000000-0000-4000-8000-000000000000"}),params(draftId))).status).toBe(422);
    expect((await postEvent(jsonReq(path,"POST",ada,{type:"acknowledged",occurredOn:"2026-01-05",assertedBy:"agency_document",
      verification:"document_attached",evidenceRef:"doc:fixture-ack-1"}),params(draftId))).status).toBe(201);
    const view=await (await listEvents(req(path,{jar:ada}),params(draftId))).json();
    expect(view.projection.status.label).toBe("Received by agency (agency document attached, not yet reviewed)");
    expect(view.projection.history.map((h:{event:{type:string}})=>h.event.type)).toEqual(["adopted","filed","acknowledged"]);
    expect(view.clock.verificationLevel).toBe("approximate");
    expect(view.clock.determination.dueOn).toBe("2026-02-03");
  });
  it("refuses to record accepting fees above the ceiling without an explicit maximum",async()=>{
    const path=`/api/v1/me/public-record/requests/${draftId}/events`;
    expect((await postEvent(jsonReq(path,"POST",ada,{type:"fee_estimate_received",occurredOn:"2026-01-08",payload:{amountUsd:180}}),params(draftId))).status).toBe(201);
    const refused=await postEvent(jsonReq(path,"POST",ada,{type:"fee_response_sent",occurredOn:"2026-01-09",payload:{decision:"accepted"}}),params(draftId));
    expect(refused.status).toBe(422);
    expect((await refused.json()).detail).toMatch(/above your ceiling/);
    expect((await postEvent(jsonReq(path,"POST",ada,{type:"fee_response_sent",occurredOn:"2026-01-09",
      payload:{decision:"accepted",acceptedMaxUsd:180}}),params(draftId))).status).toBe(201);
  });
  it("keeps a private activity trail of restricted actions",async()=>{
    const trail=await (await audit(req("/x",{jar:ada}))).json();
    const actions=trail.events.map((e:{action:string})=>e.action);
    for(const a of ["session_started","draft_adopted","draft_updated","lifecycle_event_recorded"])expect(actions).toContain(a);
    expect(actions.filter((a:string)=>a==="draft_adopted")).toHaveLength(1);
    const other=await (await audit(req("/x",{jar:grace}))).json();
    expect(other.events.every((e:{objectId:string})=>e.objectId!==draftId)).toBe(true);
  });
});
