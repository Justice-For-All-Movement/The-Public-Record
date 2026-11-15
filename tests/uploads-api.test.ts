import {afterAll,beforeAll,describe,expect,it} from "vitest";
import pg from "pg";
import {randomBytes} from "node:crypto";
import {POST as createDraft} from "../app/api/v1/me/public-record/drafts/route";
import {GET as listUp,POST as upload} from "../app/api/v1/me/public-record/requests/[id]/uploads/route";
import {GET as download} from "../app/api/v1/me/public-record/requests/[id]/uploads/[objectId]/route";
import {loadConfig,resetConfigForTests} from "../lib/server/config";
import {resetPoolForTests} from "../lib/server/db";
import {createEphemeralDatabase} from "./helpers/ephemeral-db";
import {Jar,req,signIn} from "./helpers/http";
import {DOCX,docx,EICAR,pdf} from "./helpers/zip";

const base=process.env.TEST_DATABASE_URL;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P=(o:Record<string,string>)=>({params:Promise.resolve(o)}) as any;
const form=(bytes:Buffer,type:string,purpose="correspondence")=>{const f=new FormData();f.set("file",new Blob([new Uint8Array(bytes)],{type}),"Jane Doe letter.pdf");f.set("purpose",purpose);return f;};

describe.skipIf(!base)("private uploads end to end (TPR-28)",()=>{
  let eph:{url:string;drop:()=>Promise<void>};let owner:pg.Client;
  const ada=new Jar(),grace=new Jar();let draftId="";
  const env={NODE_ENV:"test",AUTH_PROVIDER:"fake",SESSION_SECRET:randomBytes(32).toString("base64url"),STORAGE_DRIVER:"memory",MALWARE_SCANNER:"fake",PRIVATE_STORAGE_KEY:randomBytes(32).toString("base64url")};
  beforeAll(async()=>{
    eph=await createEphemeralDatabase(base!);
    owner=new pg.Client({connectionString:eph.url});await owner.connect();
    resetConfigForTests(loadConfig({...env,DATABASE_URL:eph.url,DATABASE_RUNTIME_ROLE:"tpr_app_runtime"}));
    await signIn(ada,"ada");await signIn(grace,"grace");
    draftId=(await (await createDraft(req("/x",{method:"POST",jar:ada,body:"{}",headers:{"content-type":"application/json"}}))).json()).draft.id;
  });
  afterAll(async()=>{await owner?.end();await resetPoolForTests();resetConfigForTests();await eph?.drop();});
  const count=async()=>Number((await owner.query("SELECT count(*) FROM tpr_private.quarantine_objects")).rows[0].count);

  it("stores a clean file privately, encrypted, without its original filename",async()=>{
    const res=await upload(req("/x",{method:"POST",jar:ada,body:form(pdf(),"application/pdf","receipt")}),P({id:draftId}));
    expect(res.status).toBe(201);
    const {upload:u}=await res.json();
    expect(u).toMatchObject({mime:"application/pdf",purpose:"receipt",extension:"pdf"});
    const row=(await owner.query("SELECT * FROM tpr_private.quarantine_objects WHERE id=$1",[u.id])).rows[0];
    expect(row.private_storage_key).toMatch(/^private\/quarantine\/v1\/[0-9a-f]{32}\/[0-9a-f-]{36}$/);
    expect(row.private_storage_key).not.toContain("ada");
    expect(JSON.stringify(row)).not.toMatch(/Jane Doe/);
    const dl=await download(req("/x",{jar:ada}),P({id:draftId,objectId:u.id}));
    expect(dl.status).toBe(200);
    expect(Buffer.from(await dl.arrayBuffer()).equals(pdf())).toBe(true);
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(dl.headers.get("cache-control")).toBe("private, no-store");
    expect(dl.headers.get("content-security-policy")).toMatch(/sandbox/);
  });
  it("refuses infected, misdeclared, active and bomb fixtures without storing anything",async()=>{
    const before=await count();
    for(const [bytes,type,reason] of [[Buffer.from(EICAR,"latin1"),"text/plain","infected"],[pdf(),"image/png","misdeclared_type"],
      [pdf("/JavaScript (x)"),"application/pdf","active_content"],[docx({"word/media/x.xml":Buffer.alloc(2*1024*1024,0)}),DOCX,"archive_bomb"]] as const){
      const res=await upload(req("/x",{method:"POST",jar:ada,body:form(bytes,type)}),P({id:draftId}));
      expect(res.status).toBe(422);
      expect((await res.json()).reason).toBe(reason);
    }
    expect(await count()).toBe(before);
    const audits=await owner.query("SELECT count(*) FROM tpr_private.audit_events WHERE action_code='evidence_scan_result'");
    expect(Number(audits.rows[0].count)).toBe(4);
  });
  it("keeps uploads private to their owner",async()=>{
    const [u]=(await (await listUp(req("/x",{jar:ada}),P({id:draftId}))).json()).uploads;
    expect((await download(req("/x",{jar:grace}),P({id:draftId,objectId:u.id}))).status).toBe(404);
    expect(await (await listUp(req("/x",{jar:grace}),P({id:draftId}))).json()).toEqual({uploads:[]});
    expect((await upload(req("/x",{method:"POST",jar:grace,body:form(pdf(),"application/pdf")}),P({id:draftId}))).status).toBe(404);
    expect((await download(req("/x"),P({id:draftId,objectId:u.id}))).status).toBe(401);
  });
  it("disables uploads when no scanner is configured",async()=>{
    resetConfigForTests(loadConfig({...env,MALWARE_SCANNER:"none",DATABASE_URL:eph.url,DATABASE_RUNTIME_ROLE:"tpr_app_runtime"}));
    const res=await upload(req("/x",{method:"POST",jar:ada,body:form(pdf(),"application/pdf")}),P({id:draftId}));
    expect(res.status).toBe(503);
    expect((await res.json()).detail).toMatch(/malware scanner/);
  });
});
