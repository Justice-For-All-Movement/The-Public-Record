import {NextRequest} from "next/server";
import {expect} from "vitest";
import {GET as login} from "../../app/api/auth/login/route";
import {GET as callback} from "../../app/api/auth/callback/route";
import {POST as devAuthorize} from "../../app/api/auth/dev-authorize/route";

/** Minimal browser-like cookie jar for exercising route handlers in-process. */
export class Jar {
  cookies=new Map<string,string>();
  absorb(res:Response){
    for(const c of res.headers.getSetCookie()){
      const [pair,...attrs]=c.split(";");
      const i=pair.indexOf("=");
      const name=pair.slice(0,i).trim(),value=pair.slice(i+1);
      if(attrs.some(a=>/max-age=0/i.test(a.trim())) || !value)this.cookies.delete(name);else this.cookies.set(name,value);
    }
    return res;
  }
  header(){return [...this.cookies].map(([k,v])=>`${k}=${v}`).join("; ");}
}
export const ORIGIN="http://localhost:3000";
export function req(path:string,init:{method?:string;jar?:Jar;origin?:string|null;body?:BodyInit;headers?:Record<string,string>}={}):NextRequest {
  const headers=new Headers({host:"localhost:3000",...(init.headers??{})});
  if(init.jar)headers.set("cookie",init.jar.header());
  if(init.origin!==null && init.method && init.method!=="GET")headers.set("origin",init.origin??ORIGIN);
  return new NextRequest(new URL(path,ORIGIN),{method:init.method??"GET",headers,body:init.body});
}

/** Drives the full synthetic sign-in like a browser would. */
export async function signIn(jar:Jar,persona="ada"):Promise<void> {
  const start=jar.absorb(await login(req("/api/auth/login?returnTo=/me",{jar})));
  expect(start.status).toBe(303);
  const devUrl=new URL(start.headers.get("location")!);
  const form=new FormData();
  form.set("persona",persona);
  for(const k of ["state","nonce","code_challenge"])form.set(k,devUrl.searchParams.get(k)!);
  const authorized=await devAuthorize(req("/api/auth/dev-authorize",{method:"POST",jar,body:form}));
  expect(authorized.status).toBe(303);
  const cb=new URL(authorized.headers.get("location")!);
  const done=jar.absorb(await callback(req(cb.pathname+cb.search,{jar})));
  expect(done.status).toBe(303);
  expect(new URL(done.headers.get("location")!).pathname).toBe("/me");
}

