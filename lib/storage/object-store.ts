/**
 * TPR-09 — private object storage behind one interface.
 *
 * Every driver stores only ciphertext: `createEncryptedStore` wraps a raw
 * driver with AES-256-GCM using a per-object key derived (HKDF) from
 * PRIVATE_STORAGE_KEY and bound to the object key, so a ciphertext copied to
 * another key fails authentication. No method produces a public URL.
 * Drivers: memory (tests/previews), local filesystem, and S3-compatible
 * (Backblaze B2) with SigV4 — the last is configured but never exercised
 * against a live bucket by this repository's tests.
 */
import {createCipheriv,createDecipheriv,createHash,createHmac,hkdfSync,randomBytes} from "node:crypto";
import {mkdir,readFile,rm,writeFile,rename} from "node:fs/promises";
import path from "node:path";

export interface RawObjectDriver {
  readonly kind:"memory"|"local"|"s3";
  put(key:string,bytes:Uint8Array):Promise<void>;
  get(key:string):Promise<Uint8Array|null>;
  delete(key:string):Promise<void>;
}
export interface PrivateObjectStore {
  readonly kind:RawObjectDriver["kind"];
  put(key:string,plaintext:Uint8Array):Promise<{storedBytes:number}>;
  get(key:string):Promise<Uint8Array|null>;
  delete(key:string):Promise<void>;
}
export class StorageError extends Error {constructor(m:string){super(m);this.name="StorageError";}}

const KEY_RE=/^private\/(quarantine|derivative)\/v1\/[0-9a-f]{32}\/[0-9a-f-]{36}$/;
export function assertPrivateKey(key:string):void {
  if(typeof key!=="string" || !KEY_RE.test(key))throw new StorageError("Invalid private object key");
}

export function createMemoryDriver():RawObjectDriver & {objects:Map<string,Uint8Array>} {
  const objects=new Map<string,Uint8Array>();
  return {kind:"memory",objects,
    async put(k,b){assertPrivateKey(k);objects.set(k,new Uint8Array(b));},
    async get(k){assertPrivateKey(k);const v=objects.get(k);return v?new Uint8Array(v):null;},
    async delete(k){assertPrivateKey(k);objects.delete(k);}};
}

export function createLocalDriver(root:string):RawObjectDriver {
  if(!path.isAbsolute(root))throw new StorageError("PRIVATE_STORAGE_DIR must be absolute");
  const file=(k:string)=>{assertPrivateKey(k);const f=path.resolve(root,k);
    if(!f.startsWith(path.resolve(root)+path.sep))throw new StorageError("Path escapes storage root");return f;};
  return {kind:"local",
    async put(k,b){const f=file(k);await mkdir(path.dirname(f),{recursive:true,mode:0o700});
      const tmp=f+".tmp-"+randomBytes(6).toString("hex");await writeFile(tmp,b,{mode:0o600});await rename(tmp,f);},
    async get(k){try{return new Uint8Array(await readFile(file(k)));}catch(e){if((e as {code?:string}).code==="ENOENT")return null;throw e;}},
    async delete(k){await rm(file(k),{force:true});}};
}

// ---- S3-compatible driver (AWS Signature Version 4, path-style).
export interface S3Config {endpoint:string;region:string;bucket:string;accessKeyId:string;secretAccessKey:string}
const sha256hex=(b:Uint8Array|string)=>createHash("sha256").update(b).digest("hex");
const hmac=(k:Buffer|string,v:string)=>createHmac("sha256",k).update(v).digest();
const encodePath=(p:string)=>p.split("/").map(s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase())).join("/");
/** SigV4 Authorization header for a request (exported for test vectors). */
export function signV4(o:{method:string;host:string;path:string;query?:string;headers:Record<string,string>;payloadHash:string;
  region:string;service?:string;accessKeyId:string;secretAccessKey:string;amzDate:string}):string {
  const service=o.service??"s3";
  const day=o.amzDate.slice(0,8);
  const headers:Record<string,string>={...Object.fromEntries(Object.entries(o.headers).map(([k,v])=>[k.toLowerCase(),v.trim()])),host:o.host};
  const names=Object.keys(headers).sort();
  const canonical=[o.method,encodePath(o.path),o.query??"",names.map(n=>`${n}:${headers[n]}\n`).join(""),names.join(";"),o.payloadHash].join("\n");
  const scope=`${day}/${o.region}/${service}/aws4_request`;
  const toSign=["AWS4-HMAC-SHA256",o.amzDate,scope,sha256hex(canonical)].join("\n");
  const kSigning=hmac(hmac(hmac(hmac("AWS4"+o.secretAccessKey,day),o.region),service),"aws4_request");
  return `AWS4-HMAC-SHA256 Credential=${o.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${createHmac("sha256",kSigning).update(toSign).digest("hex")}`;
}
export function createS3Driver(cfg:S3Config,fetcher:typeof fetch=fetch,now:()=>Date=()=>new Date()):RawObjectDriver {
  let endpoint:URL;
  try{endpoint=new URL(cfg.endpoint);}catch{throw new StorageError("Invalid S3 endpoint");}
  if(endpoint.protocol!=="https:" || endpoint.pathname!=="/" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(cfg.bucket) ||
     !cfg.accessKeyId || !cfg.secretAccessKey || !/^[a-z0-9-]{2,40}$/.test(cfg.region))throw new StorageError("Invalid S3 configuration");
  const call=async(method:"PUT"|"GET"|"DELETE",key:string,body?:Uint8Array)=>{
    assertPrivateKey(key);
    const amzDate=now().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
    const payloadHash=sha256hex(body??"");
    const p=`/${cfg.bucket}/${key}`;
    const headers:Record<string,string>={"x-amz-content-sha256":payloadHash,"x-amz-date":amzDate};
    const authorization=signV4({method,host:endpoint.host,path:p,headers,payloadHash,region:cfg.region,
      accessKeyId:cfg.accessKeyId,secretAccessKey:cfg.secretAccessKey,amzDate});
    let res:Response;
    try{
      res=await fetcher(endpoint.origin+encodePath(p),{method,redirect:"error",cache:"no-store",
        headers:{...headers,Authorization:authorization,...(body?{"Content-Type":"application/octet-stream"}:{})},
        body:body?Buffer.from(body):undefined,signal:AbortSignal.timeout(30000)});
    }catch{throw new StorageError("Object storage unreachable");}
    return res;
  };
  return {kind:"s3",
    async put(k,b){const r=await call("PUT",k,b);if(!r.ok)throw new StorageError("Object storage rejected write ("+r.status+")");},
    async get(k){const r=await call("GET",k);if(r.status===404)return null;if(!r.ok)throw new StorageError("Object storage read failed ("+r.status+")");
      return new Uint8Array(await r.arrayBuffer());},
    async delete(k){const r=await call("DELETE",k);if(!r.ok && r.status!==404)throw new StorageError("Object storage delete failed ("+r.status+")");}};
}

// ---- Encryption wrapper.
const MAGIC=Buffer.from("TPR1");
function objectKeyFor(master:Buffer,key:string):Buffer {
  return Buffer.from(hkdfSync("sha256",master,Buffer.alloc(0),"tpr-object-v1:"+key,32));
}
export function createEncryptedStore(driver:RawObjectDriver,masterKeyB64url:string):PrivateObjectStore {
  const master=Buffer.from(masterKeyB64url??"","base64url");
  if(master.length!==32 || master.toString("base64url")!==masterKeyB64url)throw new StorageError("PRIVATE_STORAGE_KEY must be 32 bytes base64url");
  return {kind:driver.kind,
    async put(key,plaintext){
      assertPrivateKey(key);
      const iv=randomBytes(12);
      const c=createCipheriv("aes-256-gcm",objectKeyFor(master,key),iv);
      c.setAAD(Buffer.from(key));
      const body=Buffer.concat([MAGIC,iv,c.update(plaintext),c.final()]);
      const sealed=Buffer.concat([body,c.getAuthTag()]);
      await driver.put(key,sealed);
      return {storedBytes:sealed.length};
    },
    async get(key){
      const raw=await driver.get(key);
      if(!raw)return null;
      const b=Buffer.from(raw);
      if(b.length<4+12+16 || !b.subarray(0,4).equals(MAGIC))throw new StorageError("Stored object is not a sealed object");
      try{
        const d=createDecipheriv("aes-256-gcm",objectKeyFor(master,key),b.subarray(4,16));
        d.setAAD(Buffer.from(key));
        d.setAuthTag(b.subarray(b.length-16));
        return new Uint8Array(Buffer.concat([d.update(b.subarray(16,b.length-16)),d.final()]));
      }catch{throw new StorageError("Stored object failed authentication");}
    },
    delete:k=>driver.delete(k)};
}
