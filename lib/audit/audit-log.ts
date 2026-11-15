import type {PoolClient} from "pg";

/**
 * TPR-10: privacy-safe audit records. Only pseudonymous subjects, typed codes,
 * object ids and optional SHA-256 fingerprints are stored — never request
 * bodies, tokens, names, emails or free text. Must run in the SAME transaction
 * as the business change so neither can exist without the other.
 */
export const auditActions=["draft_created","draft_updated","request_self_reported","agency_evidence_reviewed",
  "evidence_quarantined","evidence_scan_result","consent_granted","consent_revoked","publication_reviewed",
  "access_grant_changed","retention_requested","retention_resolved",
  "session_started","session_ended","draft_adopted","lifecycle_event_recorded","notification_preference_changed",
  "template_version_saved","template_version_reviewed","filing_route_proposed","filing_route_reviewed","trusted_host_added"] as const;
export type AuditAction=typeof auditActions[number];
export const auditObjectKinds=["request_draft","request_event","quarantine_object","publication_consent",
  "publication_derivative","retention_request","role_grant","session","lifecycle_event","member_account","notification_preference","request_template","filing_route","trusted_host"] as const;
export type AuditObjectKind=typeof auditObjectKinds[number];
export interface AuditEntry {
  owner:string;actor:string;action:AuditAction;objectKind:AuditObjectKind;objectId:string;sha256?:string|null;
}
export interface AuditRecord {action:AuditAction;objectKind:AuditObjectKind;objectId:string;occurredAt:string;byOwner:boolean}

export function validateAuditEntry(e:AuditEntry):void {
  if(!e || typeof e.owner!=="string" || !e.owner || e.owner.length>255 || typeof e.actor!=="string" || !e.actor ||
     e.actor.length>255 || !(auditActions as readonly string[]).includes(e.action) ||
     !(auditObjectKinds as readonly string[]).includes(e.objectKind) || typeof e.objectId!=="string" ||
     !/^[A-Za-z0-9:_.-]{1,160}$/.test(e.objectId) ||
     (e.sha256!=null && !/^[a-f0-9]{64}$/.test(e.sha256)))
    throw new Error("Invalid audit entry");
}
export async function recordAudit(db:Pick<PoolClient,"query">,e:AuditEntry):Promise<void> {
  validateAuditEntry(e);
  await db.query(`INSERT INTO tpr_private.audit_events(owner_subject,actor_subject,action_code,object_kind,object_id,source_sha256)
    VALUES($1,$2,$3,$4,$5,$6)`,[e.owner,e.actor,e.action,e.objectKind,e.objectId,e.sha256??null]);
}
export async function listOwnAudit(db:Pick<PoolClient,"query">,limit=100):Promise<AuditRecord[]> {
  const r=await db.query<{action_code:AuditAction;object_kind:AuditObjectKind;object_id:string;occurred_at:Date;by_owner:boolean}>(
    `SELECT action_code,object_kind,object_id,occurred_at,actor_subject=owner_subject AS by_owner
     FROM tpr_private.audit_events ORDER BY occurred_at DESC,id DESC LIMIT $1`,[Math.min(Math.max(1,limit),500)]);
  return r.rows.map(x=>({action:x.action_code,objectKind:x.object_kind,objectId:x.object_id,occurredAt:x.occurred_at.toISOString(),byOwner:x.by_owner}));
}
