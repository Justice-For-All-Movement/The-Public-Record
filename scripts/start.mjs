// Production entrypoint for the standalone image (Render, Docker).
// 1. Binds 0.0.0.0:$PORT (Render injects PORT; default 3000).
// 2. When a database is configured, applies pending checksum-locked migrations
//    before serving (set TPR_MIGRATE_ON_START=false to run them separately,
//    e.g. as a Render pre-deploy command: `node scripts/migrate.mjs`).
// Never prints connection strings or credentials.
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.HOSTNAME=process.env.TPR_BIND_HOST||"0.0.0.0";
process.env.PORT=process.env.PORT||"3000";

const migrationUrl=process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL;
if(migrationUrl && process.env.TPR_MIGRATE_ON_START!=="false"){
  const {default:pg}=await import("pg");
  const {runMigrations}=await import("./migrate.mjs");
  const client=new pg.Client({connectionString:migrationUrl,connectionTimeoutMillis:15000});
  try{
    await client.connect();
    const applied=await runMigrations(client);
    console.log(`[start] database migrations applied: ${applied.length}`);
  }catch(error){
    console.error("[start] migration failed; refusing to serve with an unknown schema:",
      error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g,"[redacted]") : "unknown error");
    process.exit(1);
  }finally{await client.end().catch(()=>{});}
}else if(!migrationUrl){
  console.log("[start] no DATABASE_URL: serving public preview without private features");
}

await import(pathToFileURL(path.resolve(here,"..","server.js")).href);
