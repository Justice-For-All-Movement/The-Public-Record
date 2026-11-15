import {NextResponse} from "next/server";
import {config} from "../../../lib/server/config";
import {checkDatabase} from "../../../lib/server/db";

export const dynamic="force-dynamic";

/**
 * Readiness: 200 only when every configured dependency is usable. Optional
 * services that are not configured are reported, not failed: the public
 * preview runs without credentials. Never includes secrets or connection data.
 */
export async function GET(){
  const cfg=config();
  const db=await checkDatabase();
  const failures:string[]=[];
  if(db.database==="failed")failures.push("database_unreachable");
  if(db.database==="ok" && db.migrations!=="ok")failures.push("migrations_pending_or_drifted");
  if(db.database==="ok" && db.row_security==="failed")failures.push("database_role_bypasses_row_security");
  if(cfg.authProblem)failures.push("auth_misconfigured");
  const ready=failures.length===0;
  return NextResponse.json({
    service:"the-public-record",
    ready,
    production_ready:false,
    stage:cfg.stage,
    checks:{
      ...db,
      auth:cfg.authProblem?"failed":(cfg.authMode==="disabled"?"not_configured":"ok"),
      auth_mode:cfg.authMode,
      archive_resolver:cfg.aggregatorUrl?"configured":(cfg.aggregatorFixtures?"fixtures":"not_configured")
    },
    failures
  },{status:ready?200:503,headers:{"Cache-Control":"no-store"}});
}
