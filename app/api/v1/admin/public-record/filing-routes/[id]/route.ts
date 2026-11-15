import type {NextRequest} from "next/server";
import {authorize} from "../../../../../../../lib/auth/authorization";
import {json,problem,readJson} from "../../../../../../../lib/server/http";
import {withEditor} from "../../../../../../../lib/server/admin-route";
import {getRoute,RegistryError,reviewRoute} from "../../../../../../../lib/registry/reviewed-registry";

export const dynamic="force-dynamic";
/** Body: {action:"approve"|"reject"|"reverify"} — independent verifier only. */
export function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  return withEditor(req,"admin.routes.review",async(ctx,db)=>{
    const {id}=await params;
    const action=(await readJson(req) as {action?:unknown})?.action;
    if(action!=="approve" && action!=="reject" && action!=="reverify")throw new RegistryError("Unknown action");
    const route=await getRoute(db,id);
    if(!route)return problem(404,"Not found");
    if(!authorize(ctx.principal,"review",{kind:"filing_route",proposer:route.proposedBy}))
      return problem(403,"Verification requires a records reviewer or admin other than the proposer");
    return json({route:await reviewRoute(db,ctx.session.subject,id,action)});
  });
}
