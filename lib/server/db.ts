import pg from "pg";
import {readdirSync,readFileSync,existsSync} from "node:fs";
import {createHash} from "node:crypto";
import path from "node:path";
import {config} from "./config";
import {withPrivateSubject,type ServerVerifiedSubject} from "../auth/private-transaction";
import type {PoolClient} from "pg";

let pool:pg.Pool|null=null;

/** Returns null when no database is configured; callers must degrade gracefully. */
export function getPool():pg.Pool|null {
  const url=config().databaseUrl;
  if(!url)return null;
  if(!pool){
    pool=new pg.Pool({connectionString:url,max:5,idleTimeoutMillis:30000,
      connectionTimeoutMillis:5000,statement_timeout:10000,application_name:"the-public-record"});
    // Never let an idle-client network error crash the process.
    pool.on("error",()=>{});
  }
  return pool;
}

/** Runs private work bound to a verified subject under row-level security. */
export async function withSubject<T>(session:ServerVerifiedSubject,fn:(db:PoolClient)=>Promise<T>):Promise<T> {
  const p=getPool();
  if(!p)throw new DatabaseUnavailableError();
  const cfg=config();
  return withPrivateSubject(p,session,fn,{runtimeRole:cfg.databaseRuntimeRole,
    requireRowSecurity:!cfg.allowPrivilegedDbRole});
}
export class DatabaseUnavailableError extends Error {
  constructor(){super("Database is not configured");this.name="DatabaseUnavailableError";}
}

export function migrationDirectory():string|null {
  for(const candidate of [path.join(process.cwd(),"db","migrations")]){
    if(existsSync(candidate))return candidate;
  }
  return null;
}
export function bundledMigrations(dir=migrationDirectory()):{name:string;sha256:string}[] {
  if(!dir)return [];
  return readdirSync(dir).filter(f=>/^\d{4}_[a-z0-9_-]+\.sql$/.test(f)).sort().map(name=>({
    name,sha256:createHash("sha256").update(readFileSync(path.join(dir,name),"utf8")).digest("hex")}));
}

export type CheckState = "ok"|"not_configured"|"failed"|"degraded";
export interface DatabaseReadiness {
  database:CheckState;
  migrations:CheckState;
  pending_migrations:number;
  row_security:CheckState;
}

/** Readiness probe: connectivity, migration ledger and RLS-safe runtime role. */
export async function checkDatabase():Promise<DatabaseReadiness> {
  const p=getPool();
  if(!p)return {database:"not_configured",migrations:"not_configured",pending_migrations:0,row_security:"not_configured"};
  let client:PoolClient|null=null;
  try{
    client=await p.connect(); // bounded by connectionTimeoutMillis
    await client.query("SELECT 1");
    const expected=bundledMigrations();
    let migrations:CheckState="failed",pending=expected.length;
    try{
      const ledger=await client.query<{name:string;sha256:string}>("SELECT name,sha256 FROM tpr_private.schema_migrations");
      const applied=new Map(ledger.rows.map(r=>[r.name,r.sha256]));
      const drift=expected.some(m=>applied.has(m.name) && applied.get(m.name)!==m.sha256);
      pending=expected.filter(m=>!applied.has(m.name)).length;
      migrations=drift?"failed":(pending===0 && expected.length>0?"ok":"failed");
    }catch{migrations="failed";}
    let rowSecurity:CheckState="failed";
    try{
      await client.query("BEGIN");
      const role=config().databaseRuntimeRole;
      if(role)await client.query(`SET LOCAL ROLE ${role}`);
      const r=await client.query<{rolsuper:boolean;rolbypassrls:boolean}>(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
      const safe=r.rows[0] && r.rows[0].rolsuper===false && r.rows[0].rolbypassrls===false;
      rowSecurity=safe?"ok":(config().allowPrivilegedDbRole?"degraded":"failed");
    }catch{rowSecurity="failed";}
    finally{await client.query("ROLLBACK").catch(()=>{});}
    return {database:"ok",migrations,pending_migrations:pending,row_security:rowSecurity};
  }catch{
    return {database:"failed",migrations:"failed",pending_migrations:-1,row_security:"failed"};
  }finally{client?.release();}
}

/** Tests only: close and forget the shared pool. */
export async function resetPoolForTests():Promise<void> {
  const p=pool;pool=null;
  if(p)await p.end();
}
