import type {NextRequest} from "next/server";
import {json,readJson} from "../../../../../../lib/server/http";
import {withPublication} from "../../../../../../lib/server/publication-route";
import {listOwnPublications,requestPublication} from "../../../../../../lib/publication/publication";

export const dynamic="force-dynamic";
export function GET(req:NextRequest){
  return withPublication(req,"publications.list",false,async(ctx,db)=>json({publications:await listOwnPublications(db,ctx.session.subject)}));
}
/** Body: {objectId,title,description?,agencyLabel?,consent:<exact PUBLICATION_CONSENT text>} */
export function POST(req:NextRequest){
  return withPublication(req,"publications.request",false,async(ctx,db)=>
    json({publication:await requestPublication(db,ctx.session.subject,await readJson(req) as Record<string,unknown>)},{status:201}));
}
