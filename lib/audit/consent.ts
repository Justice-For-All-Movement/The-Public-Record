/**
 * TPR-10 current-effective-consent service. A grant is effective only if the
 * LATEST event for that (object, scope) is a grant — the existence of any
 * historical grant never implies current permission. Unknown → not granted.
 */
export type ConsentScope="web_publication"|"distributed_replication";
export interface ConsentEvent {
  id:string;objectId:string;scope:ConsentScope;action:"granted"|"revoked";recordedAt:string;
}
export interface EffectiveConsent {objectId:string;scope:ConsentScope;granted:boolean;since:string|null;basisEventId:string|null}

export function effectiveConsent(events:readonly ConsentEvent[],objectId:string,scope:ConsentScope):EffectiveConsent {
  const latest=events.filter(e=>e.objectId===objectId && e.scope===scope)
    .sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)||b.id.localeCompare(a.id))[0];
  if(!latest)return {objectId,scope,granted:false,since:null,basisEventId:null};
  // Distributed replication additionally requires current web publication consent.
  if(scope==="distributed_replication" && latest.action==="granted" &&
     !effectiveConsent(events,objectId,"web_publication").granted)
    return {objectId,scope,granted:false,since:null,basisEventId:latest.id};
  return {objectId,scope,granted:latest.action==="granted",since:latest.recordedAt,basisEventId:latest.id};
}
/** SQL equivalent for use inside an owner-scoped transaction. */
export const EFFECTIVE_CONSENT_SQL=`SELECT DISTINCT ON (quarantine_object_id,scope) quarantine_object_id,scope,
  event_action='granted' AS granted,recorded_at FROM tpr_private.consent_events
  ORDER BY quarantine_object_id,scope,recorded_at DESC,id DESC`;
