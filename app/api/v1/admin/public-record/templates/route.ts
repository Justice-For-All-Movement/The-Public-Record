import type {NextRequest} from "next/server";
import {authorize} from "../../../../../../lib/auth/authorization";
import {json,problem,readJson} from "../../../../../../lib/server/http";
import {withEditor} from "../../../../../../lib/server/admin-route";
import {createTemplateVersion,listTemplateVersions,RegistryError,validateTemplateInput} from "../../../../../../lib/registry/reviewed-registry";

export const dynamic="force-dynamic";
export function GET(req:NextRequest){
  return withEditor(req,"admin.templates.list",async(_ctx,db)=>json({versions:await listTemplateVersions(db)}));
}
/** Body: {templateId?: existing id for a new version, template:{...fields}} */
export function POST(req:NextRequest){
  return withEditor(req,"admin.templates.create",async(ctx,db)=>{
    if(!authorize(ctx.principal,"create",{kind:"request_template",author:null}))return problem(403,"Editors only");
    const body=await readJson(req,20000) as Record<string,unknown>;
    if(!body || typeof body!=="object" || Object.keys(body).some(k=>!["templateId","template"].includes(k)))throw new RegistryError("Send {templateId?, template}");
    const input=validateTemplateInput(body.template);
    const version=await createTemplateVersion(db,ctx.session.subject,input,typeof body.templateId==="string"?body.templateId:null);
    return json({version},{status:201});
  });
}
