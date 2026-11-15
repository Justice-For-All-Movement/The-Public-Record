import type {NextRequest} from "next/server";
import {authorize} from "../../../../../../lib/auth/authorization";
import {json,problem,readJson} from "../../../../../../lib/server/http";
import {withEditor} from "../../../../../../lib/server/admin-route";
import {listRoutes,proposeRoute,trustedHosts} from "../../../../../../lib/registry/reviewed-registry";

export const dynamic="force-dynamic";
export function GET(req:NextRequest){
  return withEditor(req,"admin.routes.list",async(_c,db)=>json({routes:await listRoutes(db),trustedHosts:await trustedHosts(db)}));
}
/** Body: {agencyComponentId, sourceUrl, channelKind:"portal"|"email", channelValue, acknowledgement} */
export function POST(req:NextRequest){
  return withEditor(req,"admin.routes.propose",async(ctx,db)=>{
    if(!authorize(ctx.principal,"create",{kind:"filing_route",proposer:null}))return problem(403,"Not permitted");
    return json({route:await proposeRoute(db,ctx.session.subject,await readJson(req))},{status:201});
  });
}
