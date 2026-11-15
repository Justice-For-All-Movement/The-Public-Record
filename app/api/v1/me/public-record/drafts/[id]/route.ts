import type {NextRequest} from "next/server";
import {lintDraft} from "../../../../../../../lib/adoption/draft-lint";
import {BadRequest,json,problem,readJson} from "../../../../../../../lib/server/http";
import {canUseOwnDraft} from "../../../../../../../lib/server/auth-context";
import {validateDraftPatch} from "../../../../../../../lib/server/draft-store";
import {withMember} from "../../../../../../../lib/server/member-route";

export const dynamic="force-dynamic";
type Params={params:Promise<{id:string}>};
export function GET(req:NextRequest,{params}:Params){
  return withMember(req,"draft.get",async ctx=>{
    const {id}=await params;
    if(!canUseOwnDraft(ctx,ctx.session.subject,"read"))return problem(403,"Not permitted");
    const draft=await ctx.drafts.get(ctx.session,id);
    if(!draft)return problem(404,"Draft not found");
    return json({draft,lint:lintDraft(draft)},{headers:{ETag:`"v${draft.version}"`}});
  });
}
/** Optimistic concurrency: If-Match "v<version>" is required. */
export function PATCH(req:NextRequest,{params}:Params){
  return withMember(req,"draft.update",async ctx=>{
    const {id}=await params;
    if(!canUseOwnDraft(ctx,ctx.session.subject,"update"))return problem(403,"Not permitted");
    const match=/^"v(\d{1,9})"$/.exec(req.headers.get("if-match")??"");
    if(!match)return problem(428,"If-Match with the draft version is required");
    const patch=validateDraftPatch(await readJson(req,40000));
    if(!Object.keys(patch).length)throw new BadRequest("Nothing to update");
    const result=await ctx.drafts.update(ctx.session,id,Number(match[1]),patch);
    if(result.status==="not_found")return problem(404,"Draft not found");
    if(result.status==="conflict")return problem(412,"Draft changed elsewhere; reload before saving",undefined,{current_version:result.current.version});
    return json({draft:result.draft,lint:lintDraft(result.draft)},{headers:{ETag:`"v${result.draft.version}"`}});
  });
}
