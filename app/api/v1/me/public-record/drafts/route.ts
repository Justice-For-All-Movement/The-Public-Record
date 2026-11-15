import type {NextRequest} from "next/server";
import {findPublishedTemplate} from "../../../../../../lib/adoption/templates";
import {BadRequest,json,problem,readJson} from "../../../../../../lib/server/http";
import {canUseOwnDraft} from "../../../../../../lib/server/auth-context";
import {idempotencyKeyFrom,withMember} from "../../../../../../lib/server/member-route";

export const dynamic="force-dynamic";
export function GET(req:NextRequest){
  return withMember(req,"drafts.list",async ctx=>{
    if(!canUseOwnDraft(ctx,ctx.session.subject,"read"))return problem(403,"Not permitted");
    return json({drafts:await ctx.drafts.list(ctx.session)});
  });
}
/** Adopt a reviewed template (pinned copy) or start a blank draft. */
export function POST(req:NextRequest){
  return withMember(req,"drafts.create",async ctx=>{
    if(!canUseOwnDraft(ctx,ctx.session.subject,"create"))return problem(403,"Not permitted");
    const body=await readJson(req) as Record<string,unknown>;
    if(!body || typeof body!=="object" || Object.keys(body).some(k=>k!=="templateId"))throw new BadRequest("Only templateId may be supplied");
    let template=null;
    if(body.templateId!==undefined && body.templateId!==null){
      template=findPublishedTemplate(body.templateId);
      if(!template)return problem(404,"Template not found or not published");
    }
    const {draft,replayed}=await ctx.drafts.create(ctx.session,template,idempotencyKeyFrom(req));
    return json({draft,replayed},{status:replayed?200:201,headers:{ETag:`"v${draft.version}"`,Location:`/api/v1/me/public-record/drafts/${draft.id}`}});
  });
}
