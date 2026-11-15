import type {NextRequest} from "next/server";
import {json,problem,readJson} from "../../../../../../../lib/server/http";
import {withPublication} from "../../../../../../../lib/server/publication-route";
import {claimForReview,decidePublication} from "../../../../../../../lib/publication/publication";

export const dynamic="force-dynamic";
/** Body: {action:"claim"} | {action:"approve",attestation:{...all true},note?} | {action:"reject",note?} */
export function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  return withPublication(req,"publications.review",true,async(ctx,db,svc)=>{
    const {id}=await params;
    const b=await readJson(req) as {action?:unknown;attestation?:unknown;note?:unknown};
    const note=typeof b?.note==="string"?b.note:null;
    if(b?.action==="claim")return json({publication:await claimForReview(db,ctx.session.subject,id)});
    if(b?.action==="approve"||b?.action==="reject")
      return json({publication:await decidePublication(db,ctx.session.subject,id,b.action,
        b.attestation && typeof b.attestation==="object"?b.attestation as Record<string,unknown>:null,note,svc)});
    return problem(422,"Unknown action");
  });
}
