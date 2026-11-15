import type {NextRequest} from "next/server";
import {authorize} from "../../../../../../lib/auth/authorization";
import {json,problem,readJson} from "../../../../../../lib/server/http";
import {withEditor} from "../../../../../../lib/server/admin-route";
import {addTrustedHost,trustedHosts} from "../../../../../../lib/registry/reviewed-registry";

export const dynamic="force-dynamic";
export function GET(req:NextRequest){return withEditor(req,"admin.hosts.list",async(_c,db)=>json(await trustedHosts(db)));}
/** Body: {host, purpose:"source"|"channel"|"both", reason}. Admin only. */
export function POST(req:NextRequest){
  return withEditor(req,"admin.hosts.add",async(ctx,db)=>{
    if(!authorize(ctx.principal,"manage",{kind:"trusted_host_list"}))return problem(403,"Admins only");
    const b=await readJson(req) as Record<string,unknown>;
    await addTrustedHost(db,ctx.session.subject,b?.host,b?.purpose,b?.reason);
    return json(await trustedHosts(db),{status:201});
  });
}
