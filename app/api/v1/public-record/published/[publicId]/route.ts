import {json,problem} from "../../../../../../lib/server/http";
import {publishedRecord} from "../../../../../../lib/server/published";
export const dynamic="force-dynamic";
export async function GET(_req:Request,{params}:{params:Promise<{publicId:string}>}){
  const r=await publishedRecord((await params).publicId);
  if(!r)return problem(404,"Not found or no longer published");
  const {derivativeKey:_k,...pub}=r;void _k;
  return json({record:pub});
}
