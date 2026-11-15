import {authorize,type Action,type Principal} from "../auth/authorization";
import {SESSION_COOKIE_NAME,verifySession} from "../auth/session";
import {config} from "./config";
import {expectedIssuer} from "./identity";
import {memberStore,type AuthSession,type MemberStore} from "./member-store";

export interface AuthContext {session:AuthSession;principal:Principal;store:MemberStore}
export type AuthResult =
  | {ok:true;ctx:AuthContext}
  | {ok:false;status:401|503;reason:"signin_disabled"|"storage_unavailable"|"not_signed_in"};

/**
 * Resolves the verified member for a request from the HttpOnly session cookie
 * only. Roles come from server-owned grants, never from the identity token or
 * request body. Revoked/expired sessions and locked accounts are rejected.
 */
export async function resolveAuth(cookieValue:string|undefined):Promise<AuthResult> {
  const cfg=config();
  const issuer=expectedIssuer();
  if(!issuer || !cfg.sessionSecret)return {ok:false,status:503,reason:"signin_disabled"};
  const store=memberStore();
  if(!store)return {ok:false,status:503,reason:"storage_unavailable"};
  const verified=verifySession(cookieValue,cfg.sessionSecret);
  if(!verified || verified.issuer!==issuer)return {ok:false,status:401,reason:"not_signed_in"};
  const session:AuthSession={id:verified.id,subject:verified.subject,issuer:verified.issuer,expiresAt:verified.expiresAt};
  if(!(await store.isSessionActive(session)))return {ok:false,status:401,reason:"not_signed_in"};
  const roles=await store.rolesFor(session);
  return {ok:true,ctx:{session,principal:{subject:session.subject,roles},store}};
}
export function sessionCookieValue(get:(name:string)=>{value:string}|undefined):string|undefined {
  return get(SESSION_COOKIE_NAME)?.value;
}
/** Deny-by-default object check for a member's own private draft. */
export function canUseOwnDraft(ctx:AuthContext,owner:string,action:Action):boolean {
  return authorize(ctx.principal,action,{kind:"request_draft",owner});
}
