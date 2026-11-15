import {randomBytes} from "node:crypto";
/**
 * Server-only runtime configuration. Every external service is optional: the
 * app must boot and serve public pages with no credentials at all. Values are
 * validated here and never echoed back in responses or logs.
 */
export type DeploymentStage = "local"|"test"|"preview"|"staging"|"production";
export type AuthMode = "disabled"|"fake"|"oidc";

export interface OidcEnvConfig {
  issuer:string;
  clientId:string;
  clientSecret:string|null;
  redirectUri:string;
  authorizationEndpoint:string;
  tokenEndpoint:string;
  jwksUri:string;
}
export interface RuntimeConfig {
  stage:DeploymentStage;
  databaseUrl:string|null;
  /** Optional NOLOGIN, NOBYPASSRLS role the app switches to for private work. */
  databaseRuntimeRole:string|null;
  sessionSecret:string|null;
  authMode:AuthMode;
  /** Explanation when the requested auth mode was refused (safe to display). */
  authProblem:string|null;
  oidc:OidcEnvConfig|null;
  aggregatorUrl:string|null;
  aggregatorFixtures:boolean;
  allowPrivilegedDbRole:boolean;
  /** Exact browser origin for CSRF checks, e.g. https://records.example.org (optional). */
  publicOrigin:string|null;
}

type Env = Record<string,string|undefined>;
const stages:DeploymentStage[]=["local","test","preview","staging","production"];

function clean(value:string|undefined):string|null {
  const v=value?.trim();
  return v ? v : null;
}
function httpsUrl(value:string|null):string|null {
  if(!value)return null;
  try {
    const u=new URL(value);
    if(u.protocol!=="https:" || u.username || u.password || u.hash)return null;
    return u.href;
  }catch{return null;}
}
export function stageFrom(env:Env):DeploymentStage {
  const explicit=clean(env.TPR_ENVIRONMENT);
  if(explicit && (stages as string[]).includes(explicit))return explicit as DeploymentStage;
  if(env.NODE_ENV==="test")return "test";
  // An unknown or missing stage on a production build is treated as production.
  return env.NODE_ENV==="production" ? "production" : "local";
}
export function validSessionSecret(value:string|null):boolean {
  if(!value || !/^[A-Za-z0-9_-]+$/.test(value))return false;
  const raw=Buffer.from(value,"base64url");
  return raw.length>=32 && raw.toString("base64url")===value;
}
const roleName=/^[a-z_][a-z0-9_]{0,62}$/;

export function loadConfig(env:Env=process.env):RuntimeConfig {
  const stage=stageFrom(env);
  const sessionSecret=clean(env.SESSION_SECRET);
  const requested=(clean(env.AUTH_PROVIDER)??"disabled").toLowerCase();
  let authMode:AuthMode="disabled", authProblem:string|null=null, oidc:OidcEnvConfig|null=null;
  const secretOk=validSessionSecret(sessionSecret);
  if(requested==="fake") {
    // Synthetic identities must never be reachable in production.
    if(stage==="production")authProblem="The synthetic test identity provider is never enabled in production.";
    else if(!secretOk && stage!=="local" && stage!=="test")
      authProblem="SESSION_SECRET (base64url, at least 32 bytes) is required for sign-in.";
    else authMode="fake";
  }else if(requested==="oidc") {
    const issuer=httpsUrl(clean(env.OIDC_ISSUER));
    const cfg={
      issuer:issuer?issuer.replace(/\/$/,""):"",
      clientId:clean(env.OIDC_CLIENT_ID)??"",
      clientSecret:clean(env.OIDC_CLIENT_SECRET),
      redirectUri:httpsUrl(clean(env.OIDC_REDIRECT_URI))??"",
      authorizationEndpoint:httpsUrl(clean(env.OIDC_AUTHORIZATION_ENDPOINT))??"",
      tokenEndpoint:httpsUrl(clean(env.OIDC_TOKEN_ENDPOINT))??"",
      jwksUri:httpsUrl(clean(env.OIDC_JWKS_URI))??""
    };
    const origin=(u:string)=>{try{return new URL(u).origin}catch{return "invalid"}};
    if(!secretOk)authProblem="SESSION_SECRET (base64url, at least 32 bytes) is required for sign-in.";
    else if(!cfg.issuer || !cfg.clientId || cfg.clientId.length>255 || !cfg.redirectUri ||
      !cfg.authorizationEndpoint || !cfg.tokenEndpoint || !cfg.jwksUri)
      authProblem="OIDC configuration is incomplete or not HTTPS.";
    else if([cfg.authorizationEndpoint,cfg.tokenEndpoint,cfg.jwksUri].some(u=>origin(u)!==origin(cfg.issuer)))
      authProblem="OIDC endpoints must share the issuer origin in this profile.";
    else {authMode="oidc";oidc=cfg;}
  }else if(requested!=="disabled") authProblem="Unknown AUTH_PROVIDER value.";

  // Local/test fake sign-in may use an ephemeral per-process key (sessions end on restart).
  const effectiveSecret=secretOk?sessionSecret:
    (authMode==="fake" ? randomBytes(32).toString("base64url") : null);
  const runtimeRole=clean(env.DATABASE_RUNTIME_ROLE);
  return {
    stage,
    databaseUrl:clean(env.DATABASE_URL),
    databaseRuntimeRole:runtimeRole && roleName.test(runtimeRole) ? runtimeRole : null,
    sessionSecret:effectiveSecret,
    authMode,authProblem,oidc,
    aggregatorUrl:httpsUrl(clean(env.FOIA_AGGREGATOR_PUBLIC_URL)),
    aggregatorFixtures:env.FOIA_AGGREGATOR_FIXTURES==="true" && stage!=="production",
    allowPrivilegedDbRole:env.TPR_ALLOW_PRIVILEGED_DB_ROLE==="true" && (stage==="local"||stage==="test"),
    publicOrigin:(()=>{const u=httpsUrl(clean(env.PUBLIC_ORIGIN));return u?new URL(u).origin:null;})()
  };
}

// Cached on globalThis: route bundles must share one config (and one
// ephemeral local secret) even if a module is instantiated more than once.
const holder=globalThis as typeof globalThis & {__tprConfig?:RuntimeConfig|null};
export function config():RuntimeConfig {
  if(!holder.__tprConfig)holder.__tprConfig=loadConfig();
  return holder.__tprConfig;
}
/** Tests only. */
export function resetConfigForTests(next?:RuntimeConfig):void {holder.__tprConfig=next??null;}
