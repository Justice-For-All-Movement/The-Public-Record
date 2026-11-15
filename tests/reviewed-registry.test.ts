import {afterAll,beforeAll,describe,expect,it} from "vitest";
import pg from "pg";
import {GET as listTemplates,POST as createTemplate} from "../app/api/v1/admin/public-record/templates/route";
import {PATCH as editTemplate,POST as transition} from "../app/api/v1/admin/public-record/templates/[id]/[version]/route";
import {POST as proposeRoute} from "../app/api/v1/admin/public-record/filing-routes/route";
import {POST as reviewRoute} from "../app/api/v1/admin/public-record/filing-routes/[id]/route";
import {POST as addHost} from "../app/api/v1/admin/public-record/trusted-hosts/route";
import {GET as publicTemplates} from "../app/api/v1/public-record/templates/route";
import {POST as createDraft} from "../app/api/v1/me/public-record/drafts/route";
import {loadConfig,resetConfigForTests} from "../lib/server/config";
import {resetPoolForTests,withSubject} from "../lib/server/db";
import {filingRegistry} from "../lib/server/catalog";
import {buildSelfFilingGuide} from "../lib/filing/self-filing-guide";
import {authorize} from "../lib/auth/authorization";
import {createEphemeralDatabase} from "./helpers/ephemeral-db";
import {Jar,req,signIn} from "./helpers/http";

const base=process.env.TEST_DATABASE_URL;
const ISS="https://fake-oidc.the-public-record.invalid";
const COMPONENT="5c3d2e1f-0a9b-4c8d-9e7f-6a5b4c3d2e1f";
const tpl={title:"Fictional grant award files",agencyComponentId:COMPONENT,agencyLabel:"Fictional Grants Office (synthetic)",
  recordsDescription:"Award decision memoranda and scoring sheets for the fictional Example Community Grants round.",
  rangeStart:"2024-01-01",rangeEnd:"2024-12-31",sourceIds:[]};
const j=(path:string,method:string,jar:Jar,body?:unknown)=>req(path,{method,jar,body:body===undefined?undefined:JSON.stringify(body),headers:{"content-type":"application/json"}});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P=(o:Record<string,string>)=>({params:Promise.resolve(o)}) as any;

describe("principal rules for reviewed reference data",()=>{
  it("requires an editor to author and someone else to publish",()=>{
    const ed={subject:"e1",roles:["editor"] as const},ed2={subject:"e2",roles:["editor"] as const},rr={subject:"r1",roles:["records_reviewer"] as const};
    expect(authorize(ed,"create",{kind:"request_template",author:null})).toBe(true);
    expect(authorize(rr,"create",{kind:"request_template",author:null})).toBe(false);
    expect(authorize(ed,"publish",{kind:"request_template",author:"e1"})).toBe(false);
    expect(authorize(ed2,"publish",{kind:"request_template",author:"e1"})).toBe(true);
    expect(authorize(rr,"review",{kind:"filing_route",proposer:"e1"})).toBe(true);
    expect(authorize(ed2,"review",{kind:"filing_route",proposer:"e1"})).toBe(false);
    expect(authorize({subject:"x",roles:["requester"]},"manage",{kind:"trusted_host_list"})).toBe(false);
  });
});

describe.skipIf(!base)("reviewed templates and filing routes in PostgreSQL",()=>{
  let eph:{url:string;drop:()=>Promise<void>};let owner:pg.Client;
  const ada=new Jar(),grace=new Jar(),lin=new Jar();
  beforeAll(async()=>{
    eph=await createEphemeralDatabase(base!);
    owner=new pg.Client({connectionString:eph.url});await owner.connect();
    for(const [s,role] of [["fake|ada","editor"],["fake|grace","editor"],["fake|grace","admin"],["fake|lin","records_reviewer"]])
      await owner.query(`INSERT INTO tpr_private.role_grant_events(owner_subject,issuer,role,grant_action,actor_subject,reason)
        VALUES($1,$2,$3,'granted','bootstrap-operator','Synthetic test assignment')`,[s,ISS,role]);
    resetConfigForTests(loadConfig({NODE_ENV:"test",AUTH_PROVIDER:"fake",TPR_ENVIRONMENT:"preview",SESSION_SECRET:Buffer.alloc(32,9).toString("base64url"),DATABASE_URL:eph.url,DATABASE_RUNTIME_ROLE:"tpr_app_runtime"}));
    await signIn(ada,"ada");await signIn(grace,"grace");await signIn(lin,"lin");
  });
  afterAll(async()=>{await owner?.end();await resetPoolForTests();resetConfigForTests();await eph?.drop();});
  let templateId="";

  it("shows the synthetic catalog until a reviewed template is published",async()=>{
    expect((await (await publicTemplates()).json()).source).toBe("fixture");
    expect((await listTemplates(req("/x"))).status).toBe(401);
  });
  it("drafts, submits and independently publishes a template",async()=>{
    expect((await createTemplate(j("/x","POST",lin,{template:tpl}))).status).toBe(403);
    expect((await createTemplate(j("/x","POST",ada,{template:{...tpl,recordsDescription:"too short"}}))).status).toBe(422);
    const created=await createTemplate(j("/x","POST",ada,{template:tpl}));
    expect(created.status).toBe(201);
    const v1=(await created.json()).version;
    templateId=v1.templateId;
    expect(v1).toMatchObject({version:1,state:"draft",editorId:"fake|ada"});
    expect((await editTemplate(j("/x","PATCH",grace,tpl),P({id:templateId,version:"1"}))).status).toBe(403);
    expect((await editTemplate(j("/x","PATCH",ada,{...tpl,title:"Fictional grant award files (edited)"}),P({id:templateId,version:"1"}))).status).toBe(200);
    expect((await transition(j("/x","POST",ada,{action:"submit"}),P({id:templateId,version:"1"}))).status).toBe(200);
    expect((await editTemplate(j("/x","PATCH",ada,tpl),P({id:templateId,version:"1"}))).status).toBe(409);
    expect((await transition(j("/x","POST",ada,{action:"approve"}),P({id:templateId,version:"1"}))).status).toBe(403);
    const ok=await transition(j("/x","POST",grace,{action:"approve",note:"Checked against fictional source"}),P({id:templateId,version:"1"}));
    expect((await ok.json()).version).toMatchObject({state:"published",reviewerId:"fake|grace"});
    const cat=await (await publicTemplates()).json();
    expect(cat).toMatchObject({source:"database",synthetic:false});
    expect(cat.templates.map((t:{templateId:string})=>t.templateId)).toEqual([templateId]);
    expect(JSON.stringify(cat)).not.toMatch(/fake\|/);
  });
  it("enforces independence and immutability in the database itself",async()=>{
    const s={id:"x".repeat(22),subject:"fake|ada",issuer:ISS,expiresAt:Math.floor(Date.now()/1000)+600};
    await expect(withSubject(s,db=>db.query("UPDATE tpr_public.request_template_versions SET title='rewritten' WHERE template_id=$1",[templateId]))).rejects.toThrow(/immutable/);
    await expect(withSubject(s,db=>db.query("DELETE FROM tpr_public.request_template_versions WHERE template_id=$1",[templateId]))).rejects.toThrow();
    await withSubject(s,db=>db.query(`INSERT INTO tpr_public.request_template_versions(template_id,version,title,agency_component_id,agency_label,records_description,editor_subject,state)
      VALUES('tpl-selfie',1,'x',$1,'Fictional agency','Twenty-five characters of records description.','fake|ada','draft')`,[COMPONENT]));
    await withSubject(s,db=>db.query("UPDATE tpr_public.request_template_versions SET state='in_review' WHERE template_id='tpl-selfie'"));
    await expect(withSubject(s,db=>db.query(`UPDATE tpr_public.request_template_versions SET state='published',reviewer_subject='fake|ada',reviewed_at=now()
      WHERE template_id='tpl-selfie'`))).rejects.toThrow(/check constraint/);
  });
  it("supersedes with a new version without changing adopted drafts",async()=>{
    const adopted=await (await createDraft(j("/x","POST",ada,{templateId}))).json();
    expect(adopted.draft).toMatchObject({templateVersion:1,title:"Fictional grant award files (edited)"});
    const v2=(await (await createTemplate(j("/x","POST",ada,{templateId,template:{...tpl,title:"Fictional grant award files, 2025 round",rangeStart:"2025-01-01",rangeEnd:"2025-12-31"}}))).json()).version;
    expect(v2.version).toBe(2);
    await transition(j("/x","POST",ada,{action:"submit"}),P({id:templateId,version:"2"}));
    expect((await transition(j("/x","POST",lin,{action:"approve"}),P({id:templateId,version:"2"}))).status).toBe(200);
    const versions=(await (await listTemplates(req("/x",{jar:lin}))).json()).versions.filter((v:{templateId:string})=>v.templateId===templateId);
    expect(versions.map((v:{version:number;state:string})=>[v.version,v.state])).toEqual([[2,"published"],[1,"retired"]]);
    const draftRow=await owner.query("SELECT title,template_version FROM tpr_private.request_drafts WHERE id=$1",[adopted.draft.id]);
    expect(draftRow.rows[0]).toEqual({title:"Fictional grant award files (edited)",template_version:1});
  });
  it("accepts filing routes only on trusted hosts and only after independent verification",async()=>{
    const route={agencyComponentId:COMPONENT,sourceUrl:"https://grants.example.org/foia",channelKind:"portal",
      channelValue:"https://requests.example.org/foia/new",acknowledgement:"The portal shows a tracking number; keep it."};
    expect((await proposeRoute(j("/x","POST",ada,route))).status).toBe(422);
    expect((await addHost(j("/x","POST",ada,{host:"grants.example.org",purpose:"source",reason:"Synthetic official site"}))).status).toBe(403);
    for(const [host,purpose] of [["grants.example.org","source"],["requests.example.org","channel"]])
      expect((await addHost(j("/x","POST",grace,{host,purpose,reason:"Synthetic official host for tests"}))).status).toBe(201);
    expect((await proposeRoute(j("/x","POST",ada,{...route,channelValue:"https://requests.example.org.evil.test/new"}))).status).toBe(422);
    const proposed=await proposeRoute(j("/x","POST",ada,route));
    expect(proposed.status).toBe(201);
    const {id}=(await proposed.json()).route;
    expect((await filingRegistry()).synthetic).toBe(true); // nothing approved yet
    expect((await reviewRoute(j("/x","POST",ada,{action:"approve"}),P({id}))).status).toBe(403);
    expect((await reviewRoute(j("/x","POST",grace,{action:"approve"}),P({id}))).status).toBe(200);
    const reg=await filingRegistry();
    expect(reg.synthetic).toBe(false);
    const guide=buildSelfFilingGuide(COMPONENT,reg);
    expect(guide.status).toBe("ready");
    expect(guide.steps.flatMap(s=>s.link?[s.link.href]:[])).toEqual(["https://grants.example.org/foia","https://requests.example.org/foia/new"]);
  });
});
