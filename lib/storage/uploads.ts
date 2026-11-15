/**
 * TPR-28 upload pipeline: inspect → scan → encrypt+store → record, all for
 * the verified owner of an existing private draft. Rejected bytes are never
 * stored. Original filenames are not kept (they often contain personal data).
 */
import {createHmac,randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {recordAudit} from "../audit/audit-log";
import {inspectUpload,type RejectReason} from "./inspection";
import type {UploadServices} from "../server/storage";

export type UploadPurpose="correspondence"|"receipt"|"released_record";
export interface StoredUpload {id:string;draftId:string;mime:string;sizeBytes:number;sha256:string;extension:string;purpose:UploadPurpose;createdAt:string}
export type UploadOutcome = {ok:true;upload:StoredUpload}|{ok:false;reason:RejectReason|"infected"|"scanner_unavailable"|"not_found";sha256?:string};

export function ownerTag(subject:string,storageKey:string):string {
  return createHmac("sha256",Buffer.from(storageKey,"base64url")).update("owner-v1:"+subject).digest("hex").slice(0,32);
}
const cols=`id,draft_id,mime,size_bytes,sha256,extension,purpose,created_at`;
interface Row {id:string;draft_id:string;mime:string;size_bytes:string;sha256:string;extension:string;purpose:UploadPurpose;created_at:Date}
const toUpload=(r:Row):StoredUpload=>({id:r.id,draftId:r.draft_id,mime:r.mime,sizeBytes:Number(r.size_bytes),sha256:r.sha256,
  extension:r.extension,purpose:r.purpose,createdAt:r.created_at.toISOString()});

/** Runs in the owner's RLS transaction. The draft must belong to the caller (RLS hides others'). */
export async function acceptUpload(db:PoolClient,owner:string,draftId:string,bytes:Uint8Array,declaredType:string,
  purpose:UploadPurpose,svc:UploadServices):Promise<UploadOutcome> {
  const draft=await db.query("SELECT 1 FROM tpr_private.request_drafts WHERE id=$1",[draftId]);
  if(!draft.rowCount)return {ok:false,reason:"not_found"};
  const inspection=inspectUpload(bytes,declaredType);
  const rejectAudit=async(sha:string)=>recordAudit(db,{owner,actor:owner,action:"evidence_scan_result",objectKind:"quarantine_object",objectId:"rejected-"+sha.slice(0,32),sha256:sha});
  if(!inspection.ok){await rejectAudit(inspection.sha256);return {ok:false,reason:inspection.reason,sha256:inspection.sha256};}
  const verdict=await svc.scanner.scan(bytes);
  if(verdict.verdict==="error")return {ok:false,reason:"scanner_unavailable"};
  if(verdict.verdict==="infected"){await rejectAudit(inspection.sha256);return {ok:false,reason:"infected",sha256:inspection.sha256};}
  const id=randomUUID();
  const key=`private/quarantine/v1/${ownerTag(owner,svc.storageKey)}/${id}`;
  await svc.store.put(key,bytes);
  try{
    const r=await db.query<Row>(`INSERT INTO tpr_private.quarantine_objects(id,draft_id,owner_subject,private_storage_key,sha256,scan_status,
        mime,size_bytes,extension,purpose,scanner,scanned_at,storage_driver)
      VALUES($1,$2,$3,$4,$5,'passed',$6,$7,$8,$9,$10,now(),$11) RETURNING ${cols}`,
      [id,draftId,owner,key,inspection.sha256,inspection.mime,inspection.size,inspection.extension,purpose,svc.scanner.kind,svc.store.kind]);
    await recordAudit(db,{owner,actor:owner,action:"evidence_quarantined",objectKind:"quarantine_object",objectId:id,sha256:inspection.sha256});
    return {ok:true,upload:toUpload(r.rows[0])};
  }catch(e){await svc.store.delete(key).catch(()=>{});throw e;} // no orphaned ciphertext
}
export async function listUploads(db:PoolClient,draftId:string):Promise<StoredUpload[]> {
  return (await db.query<Row>(`SELECT ${cols} FROM tpr_private.quarantine_objects WHERE draft_id=$1 AND scan_status='passed' ORDER BY created_at DESC LIMIT 200`,[draftId])).rows.map(toUpload);
}
/** Owner-only, scanned objects only; integrity re-checked against the recorded SHA-256. */
export async function readUpload(db:PoolClient,draftId:string,id:string,svc:UploadServices):Promise<{upload:StoredUpload;bytes:Uint8Array}|null> {
  if(!/^[0-9a-f-]{36}$/.test(id))return null;
  const r=await db.query<Row&{private_storage_key:string}>(`SELECT ${cols},private_storage_key FROM tpr_private.quarantine_objects
    WHERE id=$1 AND draft_id=$2 AND scan_status='passed'`,[id,draftId]);
  if(!r.rows[0])return null;
  const bytes=await svc.store.get(r.rows[0].private_storage_key);
  if(!bytes)return null;
  const {createHash}=await import("node:crypto");
  if(createHash("sha256").update(bytes).digest("hex")!==r.rows[0].sha256)throw new Error("Stored object integrity check failed");
  return {upload:toUpload(r.rows[0]),bytes};
}
