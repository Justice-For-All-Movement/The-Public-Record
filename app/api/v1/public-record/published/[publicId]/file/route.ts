import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {problem} from "../../../../../../../lib/server/http";
import {publishedRecord} from "../../../../../../../lib/server/published";
import {uploadServices} from "../../../../../../../lib/server/storage";
export const dynamic="force-dynamic";
/** Serves the approved derivative only while published and consented; never cached. */
export async function GET(_req:Request,{params}:{params:Promise<{publicId:string}>}){
  const r=await publishedRecord((await params).publicId);
  const svc=uploadServices();
  if(!r || !svc.ok)return problem(404,"Not found or no longer published");
  const bytes=await svc.services.store.get(r.derivativeKey);
  if(!bytes || createHash("sha256").update(bytes).digest("hex")!==r.sha256)return problem(404,"Not found or no longer published");
  return new NextResponse(Buffer.from(bytes),{headers:{"Content-Type":r.mime==="text/plain"?"text/plain; charset=utf-8":r.mime,
    "Content-Disposition":`attachment; filename="${r.publicId}"`,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
    "Content-Security-Policy":"default-src 'none'; sandbox","Digest":"sha-256="+Buffer.from(r.sha256,"hex").toString("base64")}});
}
