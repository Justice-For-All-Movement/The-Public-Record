import {afterAll,beforeAll,describe,expect,it} from "vitest";
import pg from "pg";
import {createEphemeralDatabase} from "./helpers/ephemeral-db";
import {withPrivateSubject,PrivilegedDatabaseRoleError} from "../lib/auth/private-transaction";
import {loadConfig,resetConfigForTests} from "../lib/server/config";
import {checkDatabase,resetPoolForTests} from "../lib/server/db";

const base=process.env.TEST_DATABASE_URL;
const session=(subject:string)=>({subject,issuer:"https://fake-oidc.invalid",expiresAt:Math.floor(Date.now()/1000)+600});

describe.skipIf(!base)("least-privilege runtime role",()=>{
  let eph:{url:string;drop:()=>Promise<void>};
  let pool:pg.Pool;
  beforeAll(async()=>{
    eph=await createEphemeralDatabase(base!);
    pool=new pg.Pool({connectionString:eph.url,max:2});
  });
  afterAll(async()=>{
    await pool?.end();await resetPoolForTests();resetConfigForTests();await eph?.drop();
  });
  const opts={runtimeRole:"tpr_app_runtime",requireRowSecurity:true};

  it("refuses private work under a role that bypasses row-level security",async()=>{
    await expect(withPrivateSubject(pool,session("subject-A"),async()=>1,{requireRowSecurity:true}))
      .rejects.toBeInstanceOf(PrivilegedDatabaseRoleError);
  });
  it("isolates owners when the app assumes the runtime role",async()=>{
    await withPrivateSubject(pool,session("subject-A"),async db=>{
      await db.query("INSERT INTO tpr_private.request_drafts(id,owner_subject,draft_body) VALUES('d-1','subject-A','Synthetic')");
    },opts);
    const seenByB=await withPrivateSubject(pool,session("subject-B"),async db=>
      (await db.query("SELECT id FROM tpr_private.request_drafts")).rows,opts);
    expect(seenByB).toEqual([]);
    await expect(withPrivateSubject(pool,session("subject-B"),async db=>
      db.query("INSERT INTO tpr_private.request_drafts(id,owner_subject) VALUES('d-2','subject-A')"),opts))
      .rejects.toThrow(/row-level security/);
    const seenByA=await withPrivateSubject(pool,session("subject-A"),async db=>
      (await db.query("SELECT id FROM tpr_private.request_drafts")).rows,opts);
    expect(seenByA).toEqual([{id:"d-1"}]);
  });
  it("denies deletes and history rewrites to the runtime role",async()=>{
    await expect(withPrivateSubject(pool,session("subject-A"),async db=>
      db.query("DELETE FROM tpr_private.request_drafts WHERE id='d-1'"),opts)).rejects.toThrow(/permission denied/);
    await expect(withPrivateSubject(pool,session("subject-A"),async db=>
      db.query("ALTER TABLE tpr_private.request_drafts DISABLE ROW LEVEL SECURITY"),opts)).rejects.toThrow();
  });
  it("reports readiness only when migrations are applied and the role is safe",async()=>{
    resetConfigForTests(loadConfig({NODE_ENV:"test",DATABASE_URL:eph.url,DATABASE_RUNTIME_ROLE:"tpr_app_runtime"}));
    expect(await checkDatabase()).toMatchObject({database:"ok",migrations:"ok",pending_migrations:0,row_security:"ok"});
    await resetPoolForTests();
    resetConfigForTests(loadConfig({NODE_ENV:"test",DATABASE_URL:eph.url}));
    expect((await checkDatabase()).row_security).toBe("failed");
    await resetPoolForTests();
  });
});
