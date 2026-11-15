import {cookies} from "next/headers";
import {resolveAuth,sessionCookieValue,type AuthResult} from "./auth-context";

/** Server-component helper: resolve the member from the request cookie. */
export async function pageAuth():Promise<AuthResult|{ok:false;status:503;reason:"error"}> {
  const jar=await cookies();
  try{return await resolveAuth(sessionCookieValue(n=>jar.get(n)));}
  catch{return {ok:false,status:503,reason:"error"};}
}
