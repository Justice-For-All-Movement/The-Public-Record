import {NextResponse} from "next/server";
import {config} from "../../../lib/server/config";

export const dynamic="force-dynamic";
const started=Date.now();

/** Liveness only: no external calls. Use /api/ready for dependency checks. */
export function GET(){
  const cfg=config();
  return NextResponse.json({
    service:"the-public-record",
    status:"scaffold",
    production_ready:false,
    stage:cfg.stage,
    commit:(process.env.RENDER_GIT_COMMIT||process.env.TPR_BUILD_COMMIT||"unknown").slice(0,40),
    uptime_seconds:Math.floor((Date.now()-started)/1000),
    database:cfg.databaseUrl?"configured":"not_configured",
    auth:cfg.authMode
  },{headers:{"Cache-Control":"no-store"}});
}
