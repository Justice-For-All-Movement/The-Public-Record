import {seal,unseal} from "../auth/sealed";
import type {PendingLogin} from "../auth/providers";

export const LOGIN_COOKIE="__Host-tpr_login";
export function loginCookie(secret:string,pending:PendingLogin):string {
  return `${LOGIN_COOKIE}=${seal(secret,"login",{...pending},300)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`;
}
export function clearLoginCookie():string {return `${LOGIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;}
export function readLoginCookie(secret:string,value:string|undefined):(PendingLogin & {exp:number})|null {
  const v=unseal(secret,"login",value);
  if(!v || typeof v.state!=="string" || typeof v.nonce!=="string" || typeof v.codeVerifier!=="string" ||
     typeof v.returnTo!=="string" || typeof v.exp!=="number")return null;
  return {state:v.state,nonce:v.nonce,codeVerifier:v.codeVerifier,returnTo:v.returnTo,exp:v.exp};
}
