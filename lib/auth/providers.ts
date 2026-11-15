import {createHash,generateKeyPairSync,randomBytes,sign,type JsonWebKey,type KeyObject} from "node:crypto";
import {beginOidcLogin} from "./oidc-login";
import {verifyOidcIdToken,IdentityError,type TrustedJwkResolver,type VerifiedIdentity} from "./oidc-id-token";
import {createTrustedJwksResolver} from "./trusted-jwks";
import {exchangeAuthorizationCode} from "./oidc-token-exchange";
import {seal,unseal} from "./sealed";
import type {OidcEnvConfig} from "../server/config";

/** State the browser carries (sealed) between login start and callback. */
export interface PendingLogin {state:string;nonce:string;codeVerifier:string;returnTo:string}
export interface IdentityProvider {
  readonly kind:"oidc"|"fake";
  readonly issuer:string;
  begin(returnTo:string,appOrigin:string):{redirectUrl:string;pending:PendingLogin};
  complete(code:unknown,pending:PendingLogin):Promise<VerifiedIdentity>;
}

/** Only same-site relative paths; never an absolute or protocol-relative URL. */
export function safeReturnPath(value:unknown):string {
  if(typeof value!=="string" || value.length>200 || !/^\/(?![/\\])[A-Za-z0-9/_\-?=&.%]*$/.test(value))return "/me";
  return value;
}

export function createOidcProvider(cfg:OidcEnvConfig,fetcher:typeof fetch=fetch):IdentityProvider {
  const keys:TrustedJwkResolver=createTrustedJwksResolver({issuer:cfg.issuer,jwksUri:cfg.jwksUri},fetcher);
  return {
    kind:"oidc",issuer:cfg.issuer,
    begin(returnTo){
      const p=beginOidcLogin({issuer:cfg.issuer,authorizationEndpoint:cfg.authorizationEndpoint,clientId:cfg.clientId,redirectUri:cfg.redirectUri});
      return {redirectUrl:p.authorizationUrl,pending:{state:p.state,nonce:p.nonce,codeVerifier:p.codeVerifier,returnTo:safeReturnPath(returnTo)}};
    },
    async complete(code,pending){
      const idToken=await exchangeAuthorizationCode({issuer:cfg.issuer,tokenEndpoint:cfg.tokenEndpoint,clientId:cfg.clientId,
        clientSecret:cfg.clientSecret,redirectUri:cfg.redirectUri},code,pending.codeVerifier,fetcher);
      return verifyOidcIdToken(idToken,{issuer:cfg.issuer,clientId:cfg.clientId},pending.nonce,keys);
    }
  };
}

/**
 * TEST/PREVIEW ONLY synthetic identity provider. It runs the real
 * authorization-code + PKCE + signed-ID-token verification path, but the
 * "authorization server" is in-process with an ephemeral per-process RSA key.
 * config.ts refuses to enable it in production. Subjects are prefixed `fake|`
 * and the issuer is a reserved .invalid domain, so they can never collide
 * with real accounts.
 */
export const FAKE_ISSUER="https://fake-oidc.the-public-record.invalid";
export const FAKE_CLIENT_ID="the-public-record-synthetic";
export const FAKE_PERSONAS=[
  {id:"ada",label:"Ada (synthetic requester)"},
  {id:"grace",label:"Grace (synthetic requester)"},
  {id:"lin",label:"Lin (synthetic member, no extra roles)"}
] as const;
let fakeKeys:{privateKey:KeyObject;jwk:JsonWebKey}|null=null;
function fakeKeyPair(){
  if(!fakeKeys){
    const pair=generateKeyPairSync("rsa",{modulusLength:2048});
    const jwk=pair.publicKey.export({format:"jwk"}) as JsonWebKey;
    jwk.kid="fake-"+randomBytes(6).toString("hex");jwk.alg="RS256";jwk.use="sig";
    fakeKeys={privateKey:pair.privateKey,jwk};
  }
  return fakeKeys;
}
export function createFakeProvider(secret:string):IdentityProvider & {
  authorize(persona:unknown,params:{state:unknown;nonce:unknown;codeChallenge:unknown}):string|null;
} {
  const resolver:TrustedJwkResolver={async resolve(kid){
    const {jwk}=fakeKeyPair();if(kid!==jwk.kid)throw new IdentityError();return jwk;}};
  return {
    kind:"fake",issuer:FAKE_ISSUER,
    begin(returnTo,appOrigin){
      const pending:PendingLogin={state:randomBytes(32).toString("base64url"),nonce:randomBytes(32).toString("base64url"),
        codeVerifier:randomBytes(32).toString("base64url"),returnTo:safeReturnPath(returnTo)};
      const url=new URL("/auth/dev-login",appOrigin);
      url.searchParams.set("state",pending.state);
      url.searchParams.set("nonce",pending.nonce);
      url.searchParams.set("code_challenge",createHash("sha256").update(pending.codeVerifier).digest("base64url"));
      return {redirectUrl:url.pathname+url.search,pending};
    },
    /** The synthetic "authorization server" step: returns a one-time sealed code. */
    authorize(persona,params){
      const p=FAKE_PERSONAS.find(x=>x.id===persona);
      const ok=(v:unknown)=>typeof v==="string" && /^[A-Za-z0-9_-]{32,128}$/.test(v);
      if(!p || !ok(params.state) || !ok(params.nonce) || !ok(params.codeChallenge))return null;
      return seal(secret,"fake-code",{sub:"fake|"+p.id,nonce:params.nonce,cc:params.codeChallenge},120);
    },
    async complete(code,pending){
      const c=unseal(secret,"fake-code",code);
      if(!c || typeof c.sub!=="string" || c.nonce!==pending.nonce ||
         c.cc!==createHash("sha256").update(pending.codeVerifier).digest("base64url"))throw new IdentityError();
      const {privateKey,jwk}=fakeKeyPair();
      const now=Math.floor(Date.now()/1000);
      const h=Buffer.from(JSON.stringify({alg:"RS256",typ:"JWT",kid:jwk.kid})).toString("base64url");
      const b=Buffer.from(JSON.stringify({iss:FAKE_ISSUER,sub:c.sub,aud:FAKE_CLIENT_ID,nonce:pending.nonce,iat:now,exp:now+900})).toString("base64url");
      const idToken=h+"."+b+"."+sign("RSA-SHA256",Buffer.from(h+"."+b,"ascii"),privateKey).toString("base64url");
      return verifyOidcIdToken(idToken,{issuer:FAKE_ISSUER,clientId:FAKE_CLIENT_ID},pending.nonce,resolver);
    }
  };
}
