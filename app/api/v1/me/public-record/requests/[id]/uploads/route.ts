import type {NextRequest} from "next/server";
import {canUseOwnDraft} from "../../../../../../../../lib/server/auth-context";
import {json,problem} from "../../../../../../../../lib/server/http";
import {withMember} from "../../../../../../../../lib/server/member-route";
import {withSubject} from "../../../../../../../../lib/server/db";
import {uploadServices} from "../../../../../../../../lib/server/storage";
import {isDraftId} from "../../../../../../../../lib/server/draft-store";
import {acceptUpload,listUploads,type UploadPurpose} from "../../../../../../../../lib/storage/uploads";
import {MAX_UPLOAD_BYTES} from "../../../../../../../../lib/storage/inspection";

export const dynamic="force-dynamic";
type Params={params:Promise<{id:string}>};
const messages:Record<string,string>={empty:"The file is empty.",oversize:"The file is larger than 25 MB.",
  unsupported_type:"Only PDF, plain text, PNG, JPEG, DOCX and XLSX files are accepted.",
  misdeclared_type:"The file's contents do not match its type.",active_content:"Files with scripts, macros, embedded files or launch actions are refused.",
  archive_bomb:"The document expands to an unsafe size.",malformed:"The file appears damaged.",infected:"The malware scanner flagged this file. It was not stored.",
  scanner_unavailable:"The malware scanner is unavailable, so nothing was stored. Try again later."};

export function GET(req:NextRequest,{params}:Params){
  return withMember(req,"uploads.list",async ctx=>{
    const {id}=await params;
    if(!canUseOwnDraft(ctx,ctx.session.subject,"read") || ctx.store.kind!=="postgres" || !isDraftId(id))return problem(404,"Not found");
    return json({uploads:await withSubject(ctx.session,db=>listUploads(db,id))});
  });
}
/** multipart/form-data: file, purpose (correspondence|receipt|released_record). Private only. */
export function POST(req:NextRequest,{params}:Params){
  return withMember(req,"uploads.create",async ctx=>{
    const {id}=await params;
    if(!canUseOwnDraft(ctx,ctx.session.subject,"create") || !isDraftId(id))return problem(404,"Not found");
    const svc=uploadServices();
    if(!svc.ok || ctx.store.kind!=="postgres")return problem(503,"Private uploads are not available",svc.ok?"Uploads need the database.":svc.reason);
    if(Number(req.headers.get("content-length")??0)>MAX_UPLOAD_BYTES+65536)return problem(413,"File too large");
    const form=await req.formData().catch(()=>null);
    const file=form?.get("file");
    const purpose=(form?.get("purpose")??"correspondence") as UploadPurpose;
    if(!(file instanceof Blob) || !["correspondence","receipt","released_record"].includes(purpose))return problem(422,"Send a file and a valid purpose");
    if(file.size>MAX_UPLOAD_BYTES)return problem(413,"File too large",messages.oversize);
    const bytes=new Uint8Array(await file.arrayBuffer());
    const result=await withSubject(ctx.session,db=>acceptUpload(db,ctx.session.subject,id,bytes,file.type,purpose,svc.services));
    if(!result.ok){
      if(result.reason==="not_found")return problem(404,"Not found");
      return problem(result.reason==="scanner_unavailable"?503:422,"Upload refused",messages[result.reason],{reason:result.reason});
    }
    return json({upload:result.upload},{status:201});
  });
}
