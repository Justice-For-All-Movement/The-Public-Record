import {createHash,generateKeyPairSync,randomBytes,sign,type JsonWebKey} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {createFakeProvider,createOidcProvider,FAKE_ISSUER,safeReturnPath} from "../lib/auth/providers";
import {exchangeAuthorizationCode,TokenExchangeError} from "../lib/auth/oidc-token-exchange";

const secret=randomBytes(32).toString("base64url");
const cfg={issuer:"https://id.example.org",clientId:"public-record",clientSecret:null,
  redirectUri:"https://records.example.org/api/auth/callback",authorizationEndpoint:"https://id.example.org/authorize",
  tokenEndpoint:"https://id.example.org/token",jwksUri:"https://id.example.org/jwks"};

describe("synthetic identity provider",()=>{
  it("runs authorization code + PKCE + signed ID token verification",async()=>{
    const p=createFakeProvider(secret);
    const {redirectUrl,pending}=p.begin("/me/drafts","http://localhost:3000");
    const url=new URL(redirectUrl,"http://localhost:3000");
    expect(url.pathname).toBe("/auth/dev-login");
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(pending.codeVerifier).digest("base64url"));
    const code=p.authorize("ada",{state:pending.state,nonce:pending.nonce,codeChallenge:url.searchParams.get("code_challenge")});
    const identity=await p.complete(code,pending);
    expect(identity).toMatchObject({issuer:FAKE_ISSUER,subject:"fake|ada"});
    expect(pending.returnTo).toBe("/me/drafts");
  });
  it("rejects unknown personas, wrong verifiers, wrong nonces and forged codes",async()=>{
    const p=createFakeProvider(secret);
    const {pending}=p.begin("/me","http://localhost:3000");
    const cc=createHash("sha256").update(pending.codeVerifier).digest("base64url");
    expect(p.authorize("root",{state:pending.state,nonce:pending.nonce,codeChallenge:cc})).toBeNull();
    const code=p.authorize("grace",{state:pending.state,nonce:pending.nonce,codeChallenge:cc});
    await expect(p.complete(code,{...pending,codeVerifier:randomBytes(32).toString("base64url")})).rejects.toThrow();
    await expect(p.complete(code,{...pending,nonce:randomBytes(32).toString("base64url")})).rejects.toThrow();
    await expect(p.complete("forged",pending)).rejects.toThrow();
    await expect(createFakeProvider(randomBytes(32).toString("base64url")).complete(code,pending)).rejects.toThrow();
  });
  it("only returns to same-site relative paths",()=>{
    expect(safeReturnPath("/me?x=1")).toBe("/me?x=1");
    for(const bad of ["https://evil.example","//evil.example","/\\evil.example","javascript:alert(1)",null])
      expect(safeReturnPath(bad)).toBe("/me");
  });
});

describe("OIDC token exchange",()=>{
  const keys=generateKeyPairSync("rsa",{modulusLength:2048});
  const jwk={...keys.publicKey.export({format:"jwk"}),kid:"k1",alg:"RS256",use:"sig"} as JsonWebKey;
  function idToken(nonce:string,claims:Record<string,unknown>={}){
    const now=Math.floor(Date.now()/1000);
    const h=Buffer.from(JSON.stringify({alg:"RS256",kid:"k1"})).toString("base64url");
    const b=Buffer.from(JSON.stringify({iss:cfg.issuer,sub:"member-42",aud:cfg.clientId,nonce,iat:now,exp:now+300,...claims})).toString("base64url");
    return h+"."+b+"."+sign("RSA-SHA256",Buffer.from(h+"."+b),keys.privateKey).toString("base64url");
  }
  it("exchanges the code with the PKCE verifier and verifies the returned ID token",async()=>{
    const p0=createOidcProvider(cfg,vi.fn() as unknown as typeof fetch);
    const {pending,redirectUrl}=p0.begin("/me","https://records.example.org");
    expect(new URL(redirectUrl).searchParams.get("code_challenge_method")).toBe("S256");
    const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
      if(url===cfg.tokenEndpoint){
        const body=new URLSearchParams(String(init!.body));
        expect(body.get("code_verifier")).toBe(pending.codeVerifier);
        expect(init!.redirect).toBe("error");
        return new Response(JSON.stringify({id_token:idToken(pending.nonce),token_type:"Bearer",access_token:"discarded"}));
      }
      if(url===cfg.jwksUri)return new Response(JSON.stringify({keys:[jwk]}));
      throw new Error("unexpected "+url);
    });
    const p=createOidcProvider(cfg,fetcher as unknown as typeof fetch);
    await expect(p.complete("auth-code-1",pending)).resolves.toMatchObject({issuer:cfg.issuer,subject:"member-42"});
  });
  it("fails closed on untrusted endpoints and bad responses",async()=>{
    const ok=(body:unknown,status=200)=>vi.fn(async()=>new Response(JSON.stringify(body),{status})) as unknown as typeof fetch;
    const tcfg={...cfg};
    await expect(exchangeAuthorizationCode({...tcfg,tokenEndpoint:"https://evil.example/token"},"c","v",ok({id_token:"x"}))).rejects.toBeInstanceOf(TokenExchangeError);
    await expect(exchangeAuthorizationCode(tcfg,"c","v",ok({error:"invalid_grant"},400))).rejects.toBeInstanceOf(TokenExchangeError);
    await expect(exchangeAuthorizationCode(tcfg,"c","v",ok({access_token:"only"}))).rejects.toBeInstanceOf(TokenExchangeError);
    await expect(exchangeAuthorizationCode(tcfg,"c","v",ok({id_token:"x",token_type:"mac"}))).rejects.toBeInstanceOf(TokenExchangeError);
    await expect(exchangeAuthorizationCode(tcfg,"bad code\n","v",ok({id_token:"x"}))).rejects.toBeInstanceOf(TokenExchangeError);
    const big=vi.fn(async()=>new Response("x".repeat(70000))) as unknown as typeof fetch;
    await expect(exchangeAuthorizationCode(tcfg,"c","v",big)).rejects.toBeInstanceOf(TokenExchangeError);
  });
});
