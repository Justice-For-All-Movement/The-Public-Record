import {timingSafeEqual,createHash} from "node:crypto";
import type {NextRequest} from "next/server";
import {config} from "../../../../../lib/server/config";
import {getPool} from "../../../../../lib/server/db";
import {json,problem} from "../../../../../lib/server/http";
import {runWorkerOnce} from "../../../../../lib/jobs/outbox";
import {handleDeadlineReminder} from "../../../../../lib/jobs/reminders";
import {logEvent} from "../../../../../lib/server/log";

export const dynamic="force-dynamic";
const digest=(v:string)=>createHash("sha256").update(v).digest();
/**
 * Runs one bounded outbox pass. Call from an authenticated external scheduler
 * (e.g. a Render cron job: curl -X POST -H "Authorization: Bearer $WORKER_TOKEN").
 * Disabled unless WORKER_TOKEN and a database are configured.
 */
export async function POST(req:NextRequest){
  const token=config().workerToken;
  const pool=getPool();
  if(!token || !pool)return problem(404,"Not found");
  const supplied=(req.headers.get("authorization")??"").replace(/^Bearer\s+/i,"");
  if(!timingSafeEqual(digest(supplied),digest(token)))return problem(401,"Unauthorized");
  try{
    const result=await runWorkerOnce(pool,"web-"+process.pid,async(db,job)=>{
      if(job.kind==="deadline_reminder")return handleDeadlineReminder(db,job);
    },{batch:25});
    logEvent({event:"worker_pass",count:result.done,status:"ok"});
    return json(result);
  }catch(error){
    logEvent({event:"worker_pass",status:"failed",reason:error instanceof Error?error.name:"unknown"});
    return problem(503,"Worker pass failed");
  }
}
