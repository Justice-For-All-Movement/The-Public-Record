import {createCipheriv,createDecipheriv,hkdfSync,randomBytes} from "node:crypto";

/**
 * Authenticated encryption (AES-256-GCM) for short-lived server state that
 * transits the browser: login transactions and fake-provider codes. Keys are
 * derived per purpose from SESSION_SECRET so one value cannot be replayed as
 * another. Payloads carry their own expiry.
 */
function key(secret:string,purpose:string):Buffer {
  const raw=Buffer.from(secret,"base64url");
  if(raw.length<32)throw new Error("Sealing key not configured");
  return Buffer.from(hkdfSync("sha256",raw,Buffer.alloc(0),"tpr-seal-v1:"+purpose,32));
}
export function seal(secret:string,purpose:string,payload:Record<string,unknown>,ttlSeconds:number,now=Math.floor(Date.now()/1000)):string {
  if(!Number.isInteger(ttlSeconds) || ttlSeconds<1 || ttlSeconds>900)throw new Error("Invalid seal lifetime");
  const iv=randomBytes(12);
  const c=createCipheriv("aes-256-gcm",key(secret,purpose),iv);
  const body=Buffer.concat([c.update(JSON.stringify({...payload,exp:now+ttlSeconds}),"utf8"),c.final()]);
  return Buffer.concat([iv,c.getAuthTag(),body]).toString("base64url");
}
export function unseal(secret:string,purpose:string,token:unknown,now=Math.floor(Date.now()/1000)):Record<string,unknown>|null {
  if(typeof token!=="string" || token.length>4096 || !/^[A-Za-z0-9_-]+$/.test(token))return null;
  try{
    const raw=Buffer.from(token,"base64url");
    if(raw.length<29)return null;
    const d=createDecipheriv("aes-256-gcm",key(secret,purpose),raw.subarray(0,12));
    d.setAuthTag(raw.subarray(12,28));
    const obj=JSON.parse(Buffer.concat([d.update(raw.subarray(28)),d.final()]).toString("utf8")) as Record<string,unknown>;
    if(typeof obj.exp!=="number" || obj.exp<=now)return null;
    return obj;
  }catch{return null;}
}
