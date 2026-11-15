import {NextResponse,type NextRequest} from "next/server";
import {clearSessionCookie} from "../../../../lib/auth/session";
import {resolveAuth,sessionCookieValue} from "../../../../lib/server/auth-context";
import {problem,requestOrigin,sameOriginMutation} from "../../../../lib/server/http";

export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
  if(!sameOriginMutation(req))return problem(403,"Cross-site request refused");
  try{
    const auth=await resolveAuth(sessionCookieValue(n=>req.cookies.get(n)));
    if(auth.ok)await auth.ctx.store.endSession(auth.ctx.session);
  }catch{/* Clearing the cookie still signs the browser out. */}
  const res=NextResponse.redirect(new URL("/",requestOrigin(req)),303);
  res.headers.append("Set-Cookie",clearSessionCookie());
  res.headers.set("Cache-Control","no-store");
  return res;
}
