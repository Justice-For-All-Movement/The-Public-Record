import pg from "pg";
import {randomBytes} from "node:crypto";
import {runMigrations} from "../../scripts/migrate.mjs";

/**
 * Creates a disposable, migrated database next to TEST_DATABASE_URL so DB
 * suites can run in parallel without sharing state. Test-only credentials.
 */
export async function createEphemeralDatabase(baseUrl:string):Promise<{url:string;drop:()=>Promise<void>}> {
  const name="tpr_eph_"+randomBytes(6).toString("hex");
  const admin=new pg.Client({connectionString:baseUrl});
  await admin.connect();
  try{await admin.query(`CREATE DATABASE ${name}`);}finally{await admin.end();}
  const url=new URL(baseUrl);url.pathname="/"+name;
  const db=new pg.Client({connectionString:url.href});
  await db.connect();
  try{await runMigrations(db);}finally{await db.end();}
  return {url:url.href,async drop(){
    const c=new pg.Client({connectionString:baseUrl});
    await c.connect();
    try{await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);}finally{await c.end();}
  }};
}
