import type {NextRequest} from "next/server";
import {canUseOwnDraft} from "../../../../../../../../../lib/server/auth-context";
import {problem} from "../../../../../../../../../lib/server/http";
import {withMember} from "../../../../../../../../../lib/server/member-route";
import {withSubject} from "../../../../../../../../../lib/server/db";
import {uploadServices} from "../../../../../../../../../lib/server/storage";
import {isDraftId} from "../../../../../../../../../lib/server/draft-store";
import {readUpload} from "../../../../../../../../../lib/storage/uploads";
import {NextResponse} from "next/server";

export const dynamic="force-dynamic";
/** Owner-only download of a scanned private object. Never cached, never rendered inline. */
export function GET(req:NextRequest,{params}:{params:Promise<{id:string;objectId:string}>}){
  return withMember(req,"uploads.read",async ctx=>{
    const {id,objectId}=await params;
    const svc=uploadServices();
    if(!canUseOwnDraft(ctx,ctx.session.subject,"read") || !isDraftId(id) || !svc.ok || ctx.store.kind!=="postgres")return problem(404,"Not found");
    const found=await withSubject(ctx.session,db=>readUpload(db,id,objectId,svc.services));
    if(!found)return problem(404,"Not found");
    return new NextResponse(Buffer.from(found.bytes),{status:200,headers:{
      "Content-Type":found.upload.mime==="text/plain"?"text/plain; charset=utf-8":found.upload.mime,
      "Content-Disposition":`attachment; filename="record-${found.upload.id.slice(0,8)}.${found.upload.extension}"`,
      "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
      "Content-Security-Policy":"default-src 'none'; sandbox","Cross-Origin-Resource-Policy":"same-origin"}});
  });
}
