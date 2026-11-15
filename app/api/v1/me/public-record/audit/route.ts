import type {NextRequest} from "next/server";
import {json} from "../../../../../../lib/server/http";
import {withMember} from "../../../../../../lib/server/member-route";
export const dynamic="force-dynamic";
/** A member's own privacy-safe activity trail. */
export function GET(req:NextRequest){
  return withMember(req,"audit.list",async ctx=>json({events:await ctx.store.listAudit(ctx.session)}));
}
