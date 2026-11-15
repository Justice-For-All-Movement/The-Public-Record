import {NextResponse} from "next/server";
import {config} from "./config";

/** RFC 9457 problem details; never includes internal error text. */
export function problem(status:number,title:string,detail?:string,extra:Record<string,unknown>={}):NextResponse {
  return NextResponse.json({type:"about:blank",title,status,...(detail?{detail}:{}),...extra},
    {status,headers:{"Content-Type":"application/problem+json","Cache-Control":"no-store"}});
}
export function json(body:unknown,init:{status?:number;headers?:Record<string,string>}={}):NextResponse {
  return NextResponse.json(body,{status:init.status??200,headers:{"Cache-Control":"no-store",...(init.headers??{})}});
}
function hostOf(req:Request):string|null {
  const h=req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");
  return h ? h.toLowerCase() : null;
}
/** Absolute origin as the browser sees it (Render terminates TLS in front of us). */
export function requestOrigin(req:Request):string {
  const host=hostOf(req) ?? new URL(req.url).host;
  const proto=req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(req.url).protocol.replace(":","");
  return `${proto==="https"?"https":"http"}://${host}`;
}
/**
 * CSRF defence for state-changing requests in addition to SameSite=Lax:
 * the browser-supplied Origin must match the host we serve (and PUBLIC_ORIGIN
 * when configured), and cross-site fetch metadata is refused.
 */
export function sameOriginMutation(req:Request):boolean {
  if(req.method==="GET"||req.method==="HEAD"||req.method==="OPTIONS")return true;
  const site=req.headers.get("sec-fetch-site");
  if(site && site!=="same-origin")return false;
  const origin=req.headers.get("origin");
  if(!origin)return false;
  let o:URL;
  try{o=new URL(origin);}catch{return false;}
  const pinned=config().publicOrigin;
  if(pinned)return o.origin===pinned;
  return o.host.toLowerCase()===hostOf(req);
}
export async function readJson(req:Request,maxBytes=16384):Promise<unknown> {
  const type=req.headers.get("content-type")??"";
  if(!type.toLowerCase().startsWith("application/json"))throw new BadRequest("Expected application/json");
  const text=await req.text();
  if(text.length>maxBytes)throw new BadRequest("Request body too large");
  try{return JSON.parse(text);}catch{throw new BadRequest("Malformed JSON");}
}
export class BadRequest extends Error {constructor(m:string){super(m);this.name="BadRequest";}}
