/**
 * Authorization-code + PKCE token exchange against an operator-configured,
 * issuer-origin token endpoint. Only the ID token is used; access/refresh
 * tokens are discarded and never logged or stored.
 */
export interface TokenEndpointConfig {
  issuer:string;
  tokenEndpoint:string;
  clientId:string;
  clientSecret:string|null;
  redirectUri:string;
}
export class TokenExchangeError extends Error {
  constructor(){super("Sign-in could not be completed");this.name="TokenExchangeError";}
}
export async function exchangeAuthorizationCode(cfg:TokenEndpointConfig,code:unknown,codeVerifier:string,
  fetcher:typeof fetch=fetch):Promise<string> {
  if(typeof code!=="string" || code.length<1 || code.length>2048 || !/^[\x21-\x7e]+$/.test(code))throw new TokenExchangeError();
  let endpoint:URL;
  try{
    endpoint=new URL(cfg.tokenEndpoint);
    if(endpoint.protocol!=="https:" || endpoint.origin!==new URL(cfg.issuer).origin || endpoint.username || endpoint.password)
      throw new Error("untrusted");
  }catch{throw new TokenExchangeError();}
  const form=new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:cfg.redirectUri,
    client_id:cfg.clientId,code_verifier:codeVerifier});
  if(cfg.clientSecret)form.set("client_secret",cfg.clientSecret);
  let raw:string;
  try{
    const response=await fetcher(endpoint.href,{method:"POST",redirect:"error",cache:"no-store",
      headers:{"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},
      body:form.toString(),signal:AbortSignal.timeout(8000)});
    if(!response.ok || Number(response.headers.get("content-length")||0)>65536)throw new Error("rejected");
    raw=await response.text();
    if(raw.length>65536)throw new Error("oversized");
  }catch{throw new TokenExchangeError();}
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{throw new TokenExchangeError();}
  if(!parsed || typeof parsed!=="object" || Array.isArray(parsed))throw new TokenExchangeError();
  const idToken=(parsed as Record<string,unknown>).id_token;
  const tokenType=(parsed as Record<string,unknown>).token_type;
  if(typeof idToken!=="string" || idToken.length>16000 ||
     (tokenType!==undefined && (typeof tokenType!=="string" || tokenType.toLowerCase()!=="bearer")))
    throw new TokenExchangeError();
  return idToken;
}
