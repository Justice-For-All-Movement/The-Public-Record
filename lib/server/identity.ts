import {createFakeProvider,createOidcProvider,FAKE_ISSUER,type IdentityProvider} from "../auth/providers";
import {config} from "./config";

type Fake=ReturnType<typeof createFakeProvider>;
const holder=globalThis as typeof globalThis & {__tprProvider?:{key:string;provider:IdentityProvider}};

/** The configured identity provider, or null when sign-in is disabled/misconfigured. */
export function identityProvider():IdentityProvider|null {
  const cfg=config();
  if(cfg.authMode==="disabled" || !cfg.sessionSecret)return null;
  const key=cfg.authMode+"|"+(cfg.oidc?.issuer??"");
  if(holder.__tprProvider?.key!==key){
    const provider=cfg.authMode==="fake"?createFakeProvider(cfg.sessionSecret):createOidcProvider(cfg.oidc!);
    holder.__tprProvider={key,provider};
  }
  return holder.__tprProvider.provider;
}
export function fakeProvider():Fake|null {
  const p=identityProvider();
  return p?.kind==="fake"?p as Fake:null;
}
/** Issuer a session must carry to be accepted in this deployment. */
export function expectedIssuer():string|null {
  const cfg=config();
  if(cfg.authMode==="fake")return FAKE_ISSUER;
  if(cfg.authMode==="oidc")return cfg.oidc!.issuer;
  return null;
}
