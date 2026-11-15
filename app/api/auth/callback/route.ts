import {NextResponse,type NextRequest} from "next/server";
import {validateOidcCallbackState} from "../../../../lib/auth/oidc-login";
import {issueSession,sessionCookie} from "../../../../lib/auth/session";
import {config} from "../../../../lib/server/config";
import {identityProvider} from "../../../../lib/server/identity";
import {problem,requestOrigin} from "../../../../lib/server/http";
import {clearLoginCookie,LOGIN_COOKIE,readLoginCookie} from "../../../../lib/server/login-cookie";
import {memberStore} from "../../../../lib/server/member-store";
import {logEvent} from "../../../../lib/server/log";

export const dynamic="force-dynamic";
function finish(origin:string,path:string,cookies:string[]):NextResponse {
  const res=NextResponse.redirect(new URL(path,origin),303);
  for(const c of cookies)res.headers.append("Set-Cookie",c);
  res.headers.set("Cache-Control","no-store");
  return res;
}
export async function GET(req:NextRequest){
  const provider=identityProvider();
  const secret=config().sessionSecret;
  const store=memberStore();
  if(!provider || !secret)return problem(503,"Sign-in is not available in this deployment");
  if(!store)return problem(503,"Member storage is not available in this deployment");
  const origin=requestOrigin(req);
  const pending=readLoginCookie(secret,req.cookies.get(LOGIN_COOKIE)?.value);
  const params=req.nextUrl.searchParams;
  // The transaction cookie is single-use: always cleared, success or not.
  if(!pending || params.get("error") ||
     !validateOidcCallbackState(params.get("state"),{state:pending.state,expiresAt:pending.exp})){
    logEvent({event:"login_failed",reason:"state"});
    return finish(origin,"/me?signin=failed",[clearLoginCookie()]);
  }
  try{
    const identity=await provider.complete(params.get("code"),pending);
    const issued=issueSession(identity,secret);
    const status=await store.startSession({id:issued.id,subject:issued.subject,issuer:issued.issuer,expiresAt:issued.expiresAt});
    if(status!=="active"){
      logEvent({event:"login_refused",reason:"account_locked"});
      return finish(origin,"/me?signin=locked",[clearLoginCookie()]);
    }
    logEvent({event:"login",mode:provider.kind});
    return finish(origin,pending.returnTo,[clearLoginCookie(),sessionCookie(issued.token,issued.expiresAt-issued.issuedAt)]);
  }catch(error){
    logEvent({event:"login_failed",reason:error instanceof Error?error.name:"unknown"});
    return finish(origin,"/me?signin=failed",[clearLoginCookie()]);
  }
}
