import {NextResponse,type NextRequest} from "next/server";
import {config} from "../../../../lib/server/config";
import {identityProvider} from "../../../../lib/server/identity";
import {problem,requestOrigin} from "../../../../lib/server/http";
import {loginCookie} from "../../../../lib/server/login-cookie";

export const dynamic="force-dynamic";
export function GET(req:NextRequest){
  const provider=identityProvider();
  const secret=config().sessionSecret;
  if(!provider || !secret)return problem(503,"Sign-in is not available in this deployment");
  const origin=requestOrigin(req);
  const {redirectUrl,pending}=provider.begin(req.nextUrl.searchParams.get("returnTo")??"/me",origin);
  const res=NextResponse.redirect(new URL(redirectUrl,origin),303);
  res.headers.append("Set-Cookie",loginCookie(secret,pending));
  res.headers.set("Cache-Control","no-store");
  return res;
}
