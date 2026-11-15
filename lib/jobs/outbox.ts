/**
 * TPR-25 — durable outbox. Producers enqueue idempotently (per-owner dedupe
 * key). Workers lease with FOR UPDATE SKIP LOCKED and a bounded lease; an
 * expired lease is recoverable by another worker; failures back off
 * exponentially and dead-letter after max attempts. Rows carry only short
 * error codes, never addresses or message bodies.
 */
import type {PoolClient} from "pg";
import {withPrivateSubject,type ServerVerifiedSubject} from "../auth/private-transaction";

export type JobKind="deadline_reminder";
export interface LeasedJob {id:string;owner:string;kind:JobKind;payload:Record<string,unknown>;attempts:number;maxAttempts:number}
export interface WorkerResult {leased:number;done:number;retried:number;dead:number;skipped:number}
export const LEASE_SECONDS=120;
export function backoffSeconds(attempt:number):number {
  return Math.min(3600,30*2**Math.max(0,attempt-1));
}

/** Enqueue inside the member's own transaction (RLS: owner only, pending only). */
export async function enqueue(db:Pick<PoolClient,"query">,owner:string,kind:JobKind,dedupeKey:string,
  payload:Record<string,unknown>,runAfter:Date):Promise<boolean> {
  const r=await db.query(`INSERT INTO tpr_private.outbox_jobs(owner_subject,kind,dedupe_key,payload,run_after)
    VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT (owner_subject,dedupe_key) DO NOTHING`,
    [owner,kind,dedupeKey,JSON.stringify(payload),runAfter.toISOString()]);
  return r.rowCount===1;
}

export type JobHandler=(db:PoolClient,job:LeasedJob)=>Promise<void>;
export class PermanentJobError extends Error {constructor(readonly code:string){super(code);this.name="PermanentJobError";}}

const workerSession=(id:string):ServerVerifiedSubject=>({subject:"worker:"+id,issuer:"https://worker.the-public-record.invalid",
  expiresAt:Math.floor(Date.now()/1000)+600});

/** One bounded worker pass. Each job is handled in its own transaction under tpr_worker_runtime. */
export async function runWorkerOnce(pool:{connect:()=>Promise<PoolClient>},workerId:string,handler:JobHandler,
  opts:{batch?:number;runtimeRole?:string|null}={}):Promise<WorkerResult> {
  if(!/^[A-Za-z0-9_-]{3,64}$/.test(workerId))throw new Error("Invalid worker id");
  const role=opts.runtimeRole===undefined?"tpr_worker_runtime":opts.runtimeRole;
  const tx=<T,>(fn:(db:PoolClient)=>Promise<T>)=>withPrivateSubject(pool,workerSession(workerId),fn,{runtimeRole:role,requireRowSecurity:true});
  const leased=await tx(async db=>(await db.query<{id:string;owner_subject:string;kind:JobKind;payload:Record<string,unknown>;attempts:number;max_attempts:number}>(
    `UPDATE tpr_private.outbox_jobs SET status='leased',lease_owner=$1,lease_expires_at=now()+make_interval(secs=>$2),attempts=attempts+1
     WHERE id IN (SELECT id FROM tpr_private.outbox_jobs
       WHERE run_after<=now() AND (status='pending' OR (status='leased' AND lease_expires_at<now()))
       ORDER BY run_after,id LIMIT $3 FOR UPDATE SKIP LOCKED)
     RETURNING id,owner_subject,kind,payload,attempts,max_attempts`,[workerId,LEASE_SECONDS,Math.min(Math.max(1,opts.batch??20),100)])).rows);
  const result:WorkerResult={leased:leased.length,done:0,retried:0,dead:0,skipped:0};
  for(const row of leased){
    const job:LeasedJob={id:row.id,owner:row.owner_subject,kind:row.kind,payload:row.payload,attempts:row.attempts,maxAttempts:row.max_attempts};
    try{
      await tx(async db=>{
        await handler(db,job);
        const r=await db.query(`UPDATE tpr_private.outbox_jobs SET status='done',lease_owner=NULL,lease_expires_at=NULL,completed_at=now(),last_error_code=NULL
          WHERE id=$1 AND status='leased' AND lease_owner=$2`,[job.id,workerId]);
        if(r.rowCount!==1)throw new PermanentJobError("lease_lost");
      });
      result.done++;
    }catch(error){
      const code=error instanceof PermanentJobError?error.code:(error as {code?:string})?.code && /^[a-z_]{1,40}$/.test((error as {code:string}).code)?(error as {code:string}).code:"handler_error";
      if(code==="lease_lost"){result.skipped++;continue;}
      const permanent=error instanceof PermanentJobError || (error as {retryable?:boolean})?.retryable===false;
      const dead=permanent || job.attempts>=job.maxAttempts;
      await tx(db=>db.query(`UPDATE tpr_private.outbox_jobs SET status=$3,lease_owner=NULL,lease_expires_at=NULL,last_error_code=$4,
        run_after=now()+make_interval(secs=>$5),completed_at=CASE WHEN $3='dead' THEN now() ELSE NULL END
        WHERE id=$1 AND lease_owner=$2`,[job.id,workerId,dead?"dead":"pending",code,backoffSeconds(job.attempts)]));
      if(dead)result.dead++;else result.retried++;
    }
  }
  return result;
}
