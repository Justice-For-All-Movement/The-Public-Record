import type {NextRequest} from "next/server";
import {config} from "../../../../lib/server/config";
import {resolveAuth,sessionCookieValue} from "../../../../lib/server/auth-context";
import {json,problem} from "../../../../lib/server/http";

export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
  const cfg=config();
  try{
    const auth=await resolveAuth(sessionCookieValue(n=>req.cookies.get(n)));
    if(!auth.ok)return json({authenticated:false,signin:cfg.authMode,reason:auth.reason});
    const {session,principal,store}=auth.ctx;
    return json({authenticated:true,signin:cfg.authMode,synthetic_identity:cfg.authMode==="fake",
      subject:session.subject,roles:principal.roles,expires_at:new Date(session.expiresAt*1000).toISOString(),storage:store.kind});
  }catch{return problem(503,"Member services are temporarily unavailable");}
}
