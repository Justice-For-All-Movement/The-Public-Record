import type {NextRequest} from "next/server";
import {json} from "../../../../../../lib/server/http";
import {withPublication} from "../../../../../../lib/server/publication-route";
import {ATTESTATIONS,reviewQueue} from "../../../../../../lib/publication/publication";

export const dynamic="force-dynamic";
export function GET(req:NextRequest){
  return withPublication(req,"publications.queue",true,async(ctx,db)=>json({queue:await reviewQueue(db,ctx.session.subject),attestations:ATTESTATIONS}));
}
