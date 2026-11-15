/**
 * TPR-31 — explicit publication authorization, independent review and
 * withdrawal. Rules:
 *  - Only the owner can ask to publish, one specific scanned object version
 *    (SHA-256), and only objects uploaded as `released_record` (agency
 *    releases). Correspondence and receipts are never publishable here.
 *  - The request records a `web_publication` consent grant; withdrawal records
 *    a revocation. Public delivery checks the LATEST consent event every time.
 *  - A records reviewer other than the owner claims the request, reviews the
 *    exact bytes, and must affirm every privacy attestation to publish.
 *  - Publishing writes a separate encrypted derivative copy; originals are
 *    never served publicly.
 */
import {createHash,randomBytes,randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {recordAudit} from "../audit/audit-log";
import {ownerTag} from "../storage/uploads";
import type {UploadServices} from "../server/storage";

export class PublicationError extends Error {constructor(m:string,readonly status=422){super(m);this.name="PublicationError";}}
export const PUBLICATION_CONSENT="I want this released record published on The Public Record. I understand others may copy it once public, and that withdrawing stops only this site's future delivery.";
export const ATTESTATIONS={
  agency_release_verified:"The file is a record the agency released (not correspondence about the request).",
  no_requester_personal_data:"It contains no personal information about the requester (name, address, email, phone, account numbers).",
  no_third_party_private_data:"It contains no unredacted private information about other people beyond what the agency released.",
  redactions_intact:"Agency redactions are intact and cannot be recovered from the file (e.g. text under black boxes).",
  no_active_content:"The file was opened safely and contains no scripts, macros or embedded files."
} as const;
export type AttestationKey=keyof typeof ATTESTATIONS;
type Db=PoolClient;

export interface PublicationRequest {
  id:string;objectId:string;title:string;description:string;agencyLabel:string|null;status:string;
  publicId:string|null;createdAt:string;reviewedAt:string|null;publishedAt:string|null;withdrawnAt:string|null;
  reviewNote:string|null;assignedToMe?:boolean;
}
interface Row {id:string;quarantine_object_id:string;title:string;description:string;agency_label:string|null;status:string;public_id:string|null;
  created_at:Date;reviewed_at:Date|null;published_at:Date|null;withdrawn_at:Date|null;review_note:string|null;assigned_reviewer:string|null}
const cols="id::text,quarantine_object_id,title,description,agency_label,status,public_id,created_at,reviewed_at,published_at,withdrawn_at,review_note,assigned_reviewer";
const toReq=(r:Row,me?:string):PublicationRequest=>({id:r.id,objectId:r.quarantine_object_id,title:r.title,description:r.description,
  agencyLabel:r.agency_label,status:r.status,publicId:r.public_id,createdAt:r.created_at.toISOString(),reviewedAt:r.reviewed_at?.toISOString()??null,
  publishedAt:r.published_at?.toISOString()??null,withdrawnAt:r.withdrawn_at?.toISOString()??null,reviewNote:r.review_note,
  ...(me?{assignedToMe:r.assigned_reviewer===me}:{})});
const uuidRe=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const text=(v:unknown,min:number,max:number,label:string)=>{
  if(typeof v!=="string" || v.trim().length<min || v.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))
    throw new PublicationError(`${label} must be ${min}-${max} characters`);
  return v.trim();
};

// ---- Owner side
export async function requestPublication(db:Db,owner:string,input:Record<string,unknown>):Promise<PublicationRequest> {
  if(input.consent!==PUBLICATION_CONSENT)throw new PublicationError("Explicit publication consent is required");
  if(typeof input.objectId!=="string" || !uuidRe.test(input.objectId))throw new PublicationError("Choose one of your scanned documents",404);
  const title=text(input.title,3,200,"Title");
  const description=input.description===undefined?"":text(input.description,0,1000,"Description");
  const agency=input.agencyLabel===undefined||input.agencyLabel===null?null:text(input.agencyLabel,3,250,"Agency");
  const obj=await db.query<{sha256:string;purpose:string;scan_status:string}>(
    "SELECT sha256,purpose,scan_status FROM tpr_private.quarantine_objects WHERE id=$1 AND owner_subject=$2",[input.objectId,owner]);
  const o=obj.rows[0];
  if(!o || o.scan_status!=="passed")throw new PublicationError("Document not found",404);
  if(o.purpose!=="released_record")throw new PublicationError("Only records the agency released can be published; letters and receipts stay private");
  const r=await db.query<Row>(`INSERT INTO tpr_private.publication_requests(owner_subject,quarantine_object_id,object_sha256,title,description,agency_label)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING ${cols}`,[owner,input.objectId,o.sha256,title,description,agency])
    .catch((e:{code?:string})=>{if(e?.code==="23505")throw new PublicationError("This document already has an open publication request",409);throw e;});
  await db.query(`INSERT INTO tpr_private.consent_events(owner_subject,quarantine_object_id,scope,event_action,evidence_sha256)
    VALUES($1,$2,'web_publication','granted',$3)`,[owner,input.objectId,o.sha256]);
  await recordAudit(db,{owner,actor:owner,action:"consent_granted",objectKind:"publication_consent",objectId:r.rows[0].id,sha256:o.sha256});
  return toReq(r.rows[0]);
}
export async function listOwnPublications(db:Db,owner:string):Promise<PublicationRequest[]> {
  return (await db.query<Row>(`SELECT ${cols} FROM tpr_private.publication_requests WHERE owner_subject=$1 ORDER BY created_at DESC LIMIT 200`,[owner])).rows.map(r=>toReq(r));
}
/** Withdraws consent: public delivery stops immediately; returns the derivative key to delete. */
export async function withdrawPublication(db:Db,owner:string,id:string):Promise<{request:PublicationRequest;derivativeKey:string|null}> {
  if(!uuidRe.test(id))throw new PublicationError("Not found",404);
  const cur=await db.query<Row&{derivative_key:string|null}>(`SELECT ${cols},derivative_key FROM tpr_private.publication_requests WHERE id=$1 AND owner_subject=$2`,[id,owner]);
  const row=cur.rows[0];
  if(!row)throw new PublicationError("Not found",404);
  if(!["requested","in_review","published"].includes(row.status))throw new PublicationError("Already closed",409);
  const r=await db.query<Row>(`UPDATE tpr_private.publication_requests SET status='withdrawn',withdrawn_at=now() WHERE id=$1 RETURNING ${cols}`,[id]);
  await db.query(`INSERT INTO tpr_private.consent_events(owner_subject,quarantine_object_id,scope,event_action)
    VALUES($1,$2,'web_publication','revoked')`,[owner,row.quarantine_object_id]);
  await recordAudit(db,{owner,actor:owner,action:"consent_revoked",objectKind:"publication_consent",objectId:id});
  return {request:toReq(r.rows[0]),derivativeKey:row.derivative_key};
}

// ---- Reviewer side (transactions carry tpr.roles so RLS can apply reviewer policies)
export async function reviewQueue(db:Db,reviewer:string):Promise<PublicationRequest[]> {
  // Own requests are excluded explicitly (RLS also lets an owner read them as the owner).
  return (await db.query<Row>(`SELECT ${cols} FROM tpr_private.publication_requests WHERE status IN ('requested','in_review')
    AND owner_subject<>$1 ORDER BY created_at LIMIT 200`,[reviewer])).rows.map(r=>toReq(r,reviewer));
}
export async function claimForReview(db:Db,reviewer:string,id:string):Promise<PublicationRequest> {
  if(!uuidRe.test(id))throw new PublicationError("Not found",404);
  const r=await db.query<Row>(`UPDATE tpr_private.publication_requests SET status='in_review',assigned_reviewer=$2
    WHERE id=$1 AND status='requested' AND assigned_reviewer IS NULL AND owner_subject<>$2 RETURNING ${cols}`,[id,reviewer]);
  if(!r.rows[0])throw new PublicationError("Not available to claim",409);
  return toReq(r.rows[0],reviewer);
}
async function assigned(db:Db,reviewer:string,id:string){
  if(!uuidRe.test(id))throw new PublicationError("Not found",404);
  const r=await db.query<Row&{object_sha256:string;private_storage_key:string;mime:string;size_bytes:string;owner_subject:string}>(
    `SELECT ${cols.split(",").map(c=>"pr."+c).join(",")},pr.object_sha256,pr.owner_subject,q.private_storage_key,q.mime,q.size_bytes
     FROM tpr_private.publication_requests pr JOIN tpr_private.quarantine_objects q
       ON q.id=pr.quarantine_object_id AND q.owner_subject=pr.owner_subject
     WHERE pr.id=$1 AND pr.status='in_review' AND pr.assigned_reviewer=$2`,[id,reviewer]);
  if(!r.rows[0])throw new PublicationError("Not assigned to you",404);
  return r.rows[0];
}
export async function readForReview(db:Db,reviewer:string,id:string,svc:UploadServices):Promise<{bytes:Uint8Array;mime:string}> {
  const a=await assigned(db,reviewer,id);
  const bytes=await svc.store.get(a.private_storage_key);
  if(!bytes || createHash("sha256").update(bytes).digest("hex")!==a.object_sha256)throw new PublicationError("Stored object failed integrity check",409);
  return {bytes,mime:a.mime};
}
export async function decidePublication(db:Db,reviewer:string,id:string,decision:"approve"|"reject",
  attestation:Record<string,unknown>|null,note:string|null,svc:UploadServices):Promise<PublicationRequest> {
  const a=await assigned(db,reviewer,id);
  if(note!==null && (typeof note!=="string" || note.length>1000))throw new PublicationError("Note too long");
  if(decision==="reject"){
    const r=await db.query<Row>(`UPDATE tpr_private.publication_requests SET status='rejected',reviewed_at=now(),review_note=$2 WHERE id=$1 RETURNING ${cols}`,[id,note]);
    await recordAudit(db,{owner:reviewer,actor:reviewer,action:"publication_reviewed",objectKind:"publication_derivative",objectId:id});
    return toReq(r.rows[0],reviewer);
  }
  const keys=Object.keys(ATTESTATIONS) as AttestationKey[];
  if(!attestation || keys.some(k=>attestation[k]!==true) || Object.keys(attestation).some(k=>!keys.includes(k as AttestationKey)))
    throw new PublicationError("Every privacy attestation must be affirmed to publish");
  // Consent is re-checked by the public delivery functions on every request; a withdrawal
  // moves the request to 'withdrawn', so it can no longer be in review here.
  const {bytes}=await readForReview(db,reviewer,id,svc);
  const publicId="pub_"+randomBytes(10).toString("hex");
  const derivativeKey=`private/derivative/v1/${ownerTag("publication:"+publicId,svc.storageKey)}/${randomUUID()}`;
  await svc.store.put(derivativeKey,bytes);
  try{
    const r=await db.query<Row>(`UPDATE tpr_private.publication_requests SET status='published',attestation=$2::jsonb,review_note=$3,
        reviewed_at=now(),published_at=now(),public_id=$4,derivative_key=$5,mime=$6,size_bytes=$7 WHERE id=$1 RETURNING ${cols}`,
      [id,JSON.stringify(attestation),note,publicId,derivativeKey,a.mime,Number(a.size_bytes)]);
    await recordAudit(db,{owner:reviewer,actor:reviewer,action:"publication_reviewed",objectKind:"publication_derivative",objectId:id,sha256:a.object_sha256});
    return toReq(r.rows[0],reviewer);
  }catch(e){await svc.store.delete(derivativeKey).catch(()=>{});throw e;}
}

// ---- Public side (SECURITY DEFINER functions: published + currently consented only)
export interface PublishedRecord {publicId:string;title:string;description:string;agencyLabel:string|null;mime:string;sizeBytes:number;sha256:string;publishedAt:string}
export async function listPublished(db:Db,limit=100):Promise<Omit<PublishedRecord,"description"|"sizeBytes"|"sha256">[]> {
  const r=await db.query<{public_id:string;title:string;agency_label:string|null;mime:string;published_at:Date}>(
    "SELECT * FROM tpr_public.published_records($1)",[limit]);
  return r.rows.map(x=>({publicId:x.public_id,title:x.title,agencyLabel:x.agency_label,mime:x.mime,publishedAt:x.published_at.toISOString()}));
}
export async function getPublished(db:Db,publicId:string):Promise<(PublishedRecord & {derivativeKey:string})|null> {
  if(!/^pub_[0-9a-f]{20}$/.test(publicId))return null;
  const r=await db.query<{public_id:string;title:string;description:string;agency_label:string|null;mime:string;size_bytes:string;sha256:string;derivative_key:string;published_at:Date}>(
    "SELECT * FROM tpr_public.published_record($1)",[publicId]);
  const x=r.rows[0];
  return x?{publicId:x.public_id,title:x.title,description:x.description,agencyLabel:x.agency_label,mime:x.mime,sizeBytes:Number(x.size_bytes),
    sha256:x.sha256,publishedAt:x.published_at.toISOString(),derivativeKey:x.derivative_key}:null;
}
