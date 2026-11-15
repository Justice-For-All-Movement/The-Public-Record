import type {NextRequest} from "next/server";
import {json} from "../../../../../../../../lib/server/http";
import {withPublication} from "../../../../../../../../lib/server/publication-route";
import {withdrawPublication} from "../../../../../../../../lib/publication/publication";
import {logEvent} from "../../../../../../../../lib/server/log";

export const dynamic="force-dynamic";
/** Withdraw publication consent: this site stops delivering it immediately. */
export function DELETE(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  return withPublication(req,"publications.withdraw",false,async(ctx,db,svc)=>{
    const {id}=await params;
    const {request,derivativeKey}=await withdrawPublication(db,ctx.session.subject,id);
    if(derivativeKey)await svc.store.delete(derivativeKey).catch(()=>logEvent({event:"derivative_delete_failed",reason:"storage"}));
    return json({publication:request,notice:"Delivery from this site has stopped. Copies others already made cannot be recalled."});
  });
}
