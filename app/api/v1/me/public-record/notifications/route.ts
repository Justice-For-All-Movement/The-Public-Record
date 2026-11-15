import type {NextRequest} from "next/server";
import {BadRequest,json,readJson} from "../../../../../../lib/server/http";
import {withMember} from "../../../../../../lib/server/member-route";
import {getPreferences,listNotifications,markRead,setPreferences} from "../../../../../../lib/server/notifications";

export const dynamic="force-dynamic";
export function GET(req:NextRequest){
  return withMember(req,"notifications.list",async ctx=>json({
    notifications:await listNotifications(ctx.store,ctx.session),preferences:await getPreferences(ctx.store,ctx.session)}));
}
/** Body: {deadlineReminders:boolean} to opt in/out, or {markRead:"<id>"}. */
export function PATCH(req:NextRequest){
  return withMember(req,"notifications.update",async ctx=>{
    const b=await readJson(req) as Record<string,unknown>;
    if(!b || typeof b!=="object" || Object.keys(b).length!==1)throw new BadRequest("Send exactly one change");
    if(typeof b.deadlineReminders==="boolean")return json({preferences:await setPreferences(ctx.store,ctx.session,b.deadlineReminders)});
    if(typeof b.markRead==="string")return json({updated:await markRead(ctx.store,ctx.session,b.markRead)});
    throw new BadRequest("Unknown change");
  });
}
