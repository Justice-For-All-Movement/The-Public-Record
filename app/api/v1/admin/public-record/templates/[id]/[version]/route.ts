import type {NextRequest} from "next/server";
import {authorize} from "../../../../../../../../lib/auth/authorization";
import {json,problem,readJson} from "../../../../../../../../lib/server/http";
import {withEditor} from "../../../../../../../../lib/server/admin-route";
import {getTemplateVersion,RegistryError,transitionTemplate,updateTemplateDraft,validateTemplateInput,
  type TemplateAction} from "../../../../../../../../lib/registry/reviewed-registry";

export const dynamic="force-dynamic";
type Params={params:Promise<{id:string;version:string}>};
const parse=async(p:Params)=>{const {id,version}=await p.params;const v=Number(version);
  if(!/^[a-zA-Z0-9_-]{3,128}$/.test(id)||!Number.isSafeInteger(v)||v<1)throw new RegistryError("Not found",404);return {id,v};};

/** Edit your own unsubmitted draft. */
export function PATCH(req:NextRequest,params:Params){
  return withEditor(req,"admin.template.edit",async(ctx,db)=>{
    const {id,v}=await parse(params);
    const current=await getTemplateVersion(db,id,v);
    if(!current)return problem(404,"Not found");
    if(!authorize(ctx.principal,"update",{kind:"request_template",author:current.editorId}))return problem(403,"Only the author can edit a draft");
    return json({version:await updateTemplateDraft(db,ctx.session.subject,id,v,validateTemplateInput(await readJson(req,20000)))});
  });
}
/** Body: {action:"submit"|"approve"|"reject"|"retire", note?} */
export function POST(req:NextRequest,params:Params){
  return withEditor(req,"admin.template.transition",async(ctx,db)=>{
    const {id,v}=await parse(params);
    const body=await readJson(req) as {action?:unknown;note?:unknown};
    const action=body?.action as TemplateAction;
    if(!["submit","approve","reject","retire"].includes(action))throw new RegistryError("Unknown action");
    const current=await getTemplateVersion(db,id,v);
    if(!current)return problem(404,"Not found");
    const allowed=action==="submit"
      ? authorize(ctx.principal,"update",{kind:"request_template",author:current.editorId})
      : authorize(ctx.principal,"publish",{kind:"request_template",author:current.editorId});
    if(!allowed)return problem(403,action==="submit"?"Only the author can submit":"Review requires a different editor or a records reviewer");
    const note=typeof body.note==="string"?body.note:null;
    return json({version:await transitionTemplate(db,ctx.session.subject,id,v,action,note)});
  });
}
