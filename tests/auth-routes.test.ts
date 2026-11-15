import {afterEach,describe,expect,it} from "vitest";
import {GET as login} from "../app/api/auth/login/route";
import {GET as callback} from "../app/api/auth/callback/route";
import {POST as logout} from "../app/api/auth/logout/route";
import {GET as sessionInfo} from "../app/api/auth/session/route";
import {POST as devAuthorize} from "../app/api/auth/dev-authorize/route";
import {loadConfig,resetConfigForTests} from "../lib/server/config";
import {memoryState} from "../lib/server/member-store";
import {Jar,req,signIn} from "./helpers/http";

function useEnv(env:Record<string,string>){resetConfigForTests(loadConfig({NODE_ENV:"test",...env}));}
afterEach(()=>resetConfigForTests());

describe("sign-in routes (synthetic provider, memory store)",()=>{
  it("signs in, exposes server-owned roles only, and revokes on logout",async()=>{
    useEnv({AUTH_PROVIDER:"fake"});
    const jar=new Jar();
    await signIn(jar);
    expect(jar.cookies.has("__Host-tpr_login")).toBe(false);
    const stolen=jar.header();
    const info=await (await sessionInfo(req("/api/auth/session",{jar}))).json();
    expect(info).toMatchObject({authenticated:true,subject:"fake|ada",roles:["requester"],synthetic_identity:true,storage:"memory"});
    const out=jar.absorb(await logout(req("/api/auth/logout",{method:"POST",jar})));
    expect(out.status).toBe(303);
    // The old cookie value no longer works after server-side revocation.
    const replay=await (await sessionInfo(req("/api/auth/session",{headers:{cookie:stolen}}))).json();
    expect(replay.authenticated).toBe(false);
  });
  it("refuses cross-site posts, replayed login transactions and tampered state",async()=>{
    useEnv({AUTH_PROVIDER:"fake"});
    const jar=new Jar();
    const start=jar.absorb(await login(req("/api/auth/login",{jar})));
    const devUrl=new URL(start.headers.get("location")!);
    const form=new FormData();form.set("persona","ada");
    for(const k of ["state","nonce","code_challenge"])form.set(k,devUrl.searchParams.get(k)!);
    expect((await devAuthorize(req("/api/auth/dev-authorize",{method:"POST",jar,body:form,origin:"https://evil.example"}))).status).toBe(403);
    expect((await logout(req("/api/auth/logout",{method:"POST",jar,origin:null}))).status).toBe(403);
    const ok=await devAuthorize(req("/api/auth/dev-authorize",{method:"POST",jar,body:form}));
    const cb=new URL(ok.headers.get("location")!);
    const wrongState=await callback(req(cb.pathname+cb.search.replace(/state=[^&]+/,"state=x"),{jar:new Jar()}));
    expect(new URL(wrongState.headers.get("location")!).search).toBe("?signin=failed");
    const first=jar.absorb(await callback(req(cb.pathname+cb.search,{jar})));
    expect(new URL(first.headers.get("location")!).pathname).toBe("/me");
    // The login transaction cookie was consumed; replaying the callback fails.
    const again=await callback(req(cb.pathname+cb.search,{jar}));
    expect(new URL(again.headers.get("location")!).search).toBe("?signin=failed");
  });
  it("refuses sessions from a different issuer or a locked account",async()=>{
    useEnv({AUTH_PROVIDER:"fake"});
    const jar=new Jar();
    await signIn(jar,"grace");
    memoryState().accounts.get("fake|grace")!.status="locked";
    expect((await (await sessionInfo(req("/api/auth/session",{jar}))).json()).authenticated).toBe(false);
    const again=new Jar();
    const start=again.absorb(await login(req("/api/auth/login",{jar:again})));
    const u=new URL(start.headers.get("location")!);const f=new FormData();f.set("persona","grace");
    for(const k of ["state","nonce","code_challenge"])f.set(k,u.searchParams.get(k)!);
    const a=await devAuthorize(req("/api/auth/dev-authorize",{method:"POST",jar:again,body:f}));
    const cb=new URL(a.headers.get("location")!);
    const locked=await callback(req(cb.pathname+cb.search,{jar:again}));
    expect(new URL(locked.headers.get("location")!).search).toBe("?signin=locked");
  });
  it("never offers synthetic sign-in in production",async()=>{
    useEnv({AUTH_PROVIDER:"fake",NODE_ENV:"production",TPR_ENVIRONMENT:"production"});
    expect((await login(req("/api/auth/login"))).status).toBe(503);
    expect((await devAuthorize(req("/api/auth/dev-authorize",{method:"POST",body:new FormData()}))).status).toBe(404);
    expect((await (await sessionInfo(req("/api/auth/session"))).json()).authenticated).toBe(false);
  });
});
