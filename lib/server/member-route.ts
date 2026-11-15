import type {NextRequest,NextResponse} from "next/server";
import {LifecycleEventError} from "../lifecycle/events";
import {validateIdempotencyKey} from "../contracts/request-options";
import {resolveAuth,sessionCookieValue,type AuthContext} from "./auth-context";
import {BadRequest,problem,sameOriginMutation} from "./http";
import {DraftValidationError,draftStoreFor,type DraftStore} from "./draft-store";
import {logEvent} from "./log";

export interface MemberRouteContext extends AuthContext {drafts:DraftStore}
/**
 * Wraps a private member API handler: CSRF check for mutations, verified
 * session, server-owned principal, and uniform problem responses. Internal
 * errors are never echoed to the client.
 */
export async function withMember(req:NextRequest,route:string,
  handler:(ctx:MemberRouteContext)=>Promise<NextResponse>):Promise<NextResponse> {
  if(!sameOriginMutation(req))return problem(403,"Cross-site request refused");
  try{
    const auth=await resolveAuth(sessionCookieValue(n=>req.cookies.get(n)));
    if(!auth.ok)return auth.status===401?problem(401,"Sign in required"):problem(503,"Member features are not available in this deployment");
    return await handler({...auth.ctx,drafts:draftStoreFor(auth.ctx.store)});
  }catch(error){
    if(error instanceof DraftValidationError||error instanceof LifecycleEventError||error instanceof BadRequest)
      return problem(422,"Invalid request",error.message);
    logEvent({event:"member_route_error",route,reason:error instanceof Error?error.name:"unknown"});
    return problem(503,"Member services are temporarily unavailable");
  }
}
export function idempotencyKeyFrom(req:NextRequest):string|null {
  const raw=req.headers.get("idempotency-key");
  if(raw===null)return null;
  try{return validateIdempotencyKey(raw);}catch{throw new BadRequest("Invalid Idempotency-Key header");}
}
