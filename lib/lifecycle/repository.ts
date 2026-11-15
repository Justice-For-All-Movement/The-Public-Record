import type {PoolClient} from "pg";
import {LifecycleEventError,canonicalJson,assertParticipantMayRecord,validateEvent,type LifecycleEvent,type LifecycleEventType,
  type LifecyclePayloads} from "./events";

/** Server-assigned fields are excluded: id, recordedAt and requestId come from the server. */
export interface NewLifecycleEvent<T extends LifecycleEventType=LifecycleEventType> {
  type:T;
  occurredOn:string;
  assertedBy:LifecycleEvent["assertedBy"];
  verification:LifecycleEvent["verification"];
  evidenceRef:string|null;
  causedBy:string|null;
  correctsEventId:string|null;
  payload:LifecyclePayloads[T];
}
interface Row {
  id:string;request_id:string;event_type:LifecycleEventType;occurred_on:string;recorded_at:Date;
  asserted_by:LifecycleEvent["assertedBy"];verification:LifecycleEvent["verification"];evidence_ref:string|null;
  caused_by:string|null;corrects_event_id:string|null;payload:Record<string,unknown>;
}
const columns=`id::text,request_id,event_type,to_char(occurred_on,'YYYY-MM-DD') AS occurred_on,recorded_at,
  asserted_by,verification,evidence_ref,caused_by::text,corrects_event_id::text,payload`;
function toEvent(r:Row):LifecycleEvent {
  return {id:r.id,requestId:r.request_id,type:r.event_type,occurredOn:r.occurred_on,recordedAt:r.recorded_at.toISOString(),
    assertedBy:r.asserted_by,verification:r.verification,evidenceRef:r.evidence_ref,causedBy:r.caused_by,
    correctsEventId:r.corrects_event_id,payload:r.payload as LifecycleEvent["payload"]};
}

/**
 * Appends a participant event inside a withPrivateSubject transaction (RLS
 * supplies ownership). Replays with the same idempotency key return the
 * original event rather than duplicating it.
 */
export async function appendParticipantEvent(db:PoolClient,owner:string,requestId:string,input:NewLifecycleEvent,
  idempotencyKey:string|null):Promise<{event:LifecycleEvent;replayed:boolean}> {
  assertParticipantMayRecord(input);
  // Validate with placeholder server fields before touching the database.
  validateEvent({...input,id:"pending-id",requestId,recordedAt:new Date().toISOString()} as LifecycleEvent);
  const r=await db.query<Row>(`INSERT INTO tpr_private.request_lifecycle_events
    (request_id,owner_subject,event_type,occurred_on,asserted_by,verification,evidence_ref,caused_by,corrects_event_id,payload,idempotency_key)
    VALUES($1,$2,$3,$4::date,$5,$6,$7,$8::uuid,$9::uuid,$10::jsonb,$11)
    ON CONFLICT (owner_subject,request_id,idempotency_key) DO NOTHING RETURNING ${columns}`,
    [requestId,owner,input.type,input.occurredOn,input.assertedBy,input.verification,input.evidenceRef,
      input.causedBy,input.correctsEventId,JSON.stringify(input.payload),idempotencyKey]);
  if(r.rows[0])return {event:toEvent(r.rows[0]),replayed:false};
  const prior=await db.query<Row>(`SELECT ${columns} FROM tpr_private.request_lifecycle_events
    WHERE owner_subject=$1 AND request_id=$2 AND idempotency_key=$3`,[owner,requestId,idempotencyKey]);
  if(!prior.rows[0])throw new Error("Event could not be recorded");
  const replay=toEvent(prior.rows[0]);
  // A reused key with different content is a client error, not a replay.
  if(replay.type!==input.type || replay.occurredOn!==input.occurredOn ||
     canonicalJson(replay.payload)!==canonicalJson(input.payload))
    throw new LifecycleEventError("Idempotency key reused for a different event");
  return {event:replay,replayed:true};
}
export async function listLifecycleEvents(db:PoolClient,requestId:string):Promise<LifecycleEvent[]> {
  const r=await db.query<Row>(`SELECT ${columns} FROM tpr_private.request_lifecycle_events
    WHERE request_id=$1 ORDER BY recorded_at,id LIMIT 5000`,[requestId]);
  return r.rows.map(toEvent);
}
