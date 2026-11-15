import {NextResponse,type NextRequest} from "next/server";
import {fakeProvider} from "../../../../lib/server/identity";
import {problem,requestOrigin,sameOriginMutation} from "../../../../lib/server/http";

export const dynamic="force-dynamic";
/** Synthetic authorization step for AUTH_PROVIDER=fake (never production). */
export async function POST(req:NextRequest){
  const provider=fakeProvider();
  if(!provider)return problem(404,"Not found");
  if(!sameOriginMutation(req))return problem(403,"Cross-site request refused");
  const form=await req.formData().catch(()=>null);
  const state=form?.get("state");
  const code=provider.authorize(form?.get("persona"),{state,nonce:form?.get("nonce"),codeChallenge:form?.get("code_challenge")});
  if(!code || typeof state!=="string")return problem(400,"Invalid synthetic sign-in request");
  const target=new URL("/api/auth/callback",requestOrigin(req));
  target.searchParams.set("code",code);target.searchParams.set("state",state);
  return NextResponse.redirect(target,303);
}
