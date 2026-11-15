import {NextResponse,type NextRequest} from "next/server";
import {withPublication} from "../../../../../../../../lib/server/publication-route";
import {readForReview} from "../../../../../../../../lib/publication/publication";

export const dynamic="force-dynamic";
/** Assigned reviewer's private copy of the exact bytes under review. */
export function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  return withPublication(req,"publications.review_file",true,async(ctx,db,svc)=>{
    const {id}=await params;
    const f=await readForReview(db,ctx.session.subject,id,svc);
    return new NextResponse(Buffer.from(f.bytes),{headers:{"Content-Type":f.mime,"Content-Disposition":`attachment; filename="review-${id.slice(0,8)}"`,
      "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
  });
}
