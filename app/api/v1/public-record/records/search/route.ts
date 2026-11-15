import type {NextRequest} from "next/server";
import {searchArchive} from "../../../../../../lib/server/archive";
import {json} from "../../../../../../lib/server/http";

export const dynamic="force-dynamic";
/** Public, read-only. Sends only the query text upstream; no participant data. */
export async function GET(req:NextRequest){
  const result=await searchArchive(req.nextUrl.searchParams.get("q"));
  const status=result.state==="invalid_query"?400:200;
  return json(result,{status,headers:{"Cache-Control":"public, max-age=60"}});
}
