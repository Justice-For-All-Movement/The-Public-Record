/**
 * FOIA Aggregator FC-13 export client (`foia-catalog-export/1`).
 * Upstream contract: Justice-For-All-Movement/FOIA_Aggregator
 *   docs/FC13_EXPORT_CONTRACT.md, schemas/catalog-record.v1.schema.json
 *   GET /api/v1/export/manifest, GET /api/v1/records?limit=&cursor=
 *
 * The upstream has no search endpoint, so this client pages a bounded number
 * of records from one snapshot (cursors are snapshot-bound; 409 = restart),
 * caches the parsed index per snapshot, and searches locally. Only known
 * schema fields are projected: unknown/additive fields are dropped, never
 * rendered. Only public catalog fields are requested; no participant data is
 * ever sent upstream (requests carry no query text at all).
 */
export const CATALOG_SCHEMA="foia-catalog-export/1";

export interface CatalogRecord {
  recordId:string;url:string;title:string|null;description:string|null;filename:string|null;fileType:string|null;
  publishedDate:string|null;agencyName:string|null;agencySlug:string|null;officeName:string|null;
  sources:{sourceId:string;url:string;provenance:"official"|"third_party"}[];
  preservation:{status:"archived"|"metadata_only";sha256:string|null;archivedAt:string|null};
  textIndexed:boolean;
}
export interface CatalogManifest {
  snapshotId:string;generatedAt:string|null;
  counts:{records:number;archived:number;metadataOnly:number;textIndexed:number;agencies:number;sources:number};
  archiveConnected:boolean|null;
}
export interface CatalogIndex {manifest:CatalogManifest;records:CatalogRecord[];complete:boolean;fetchedAt:number}
export interface CatalogSource {loadIndex():Promise<CatalogIndex>}
export class CatalogContractError extends Error {constructor(m="Incompatible catalog export"){super(m);this.name="CatalogContractError";}}
export class CatalogUnavailableError extends Error {constructor(m="Catalog unavailable"){super(m);this.name="CatalogUnavailableError";}}

const obj=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==="object" && !Array.isArray(v);
const str=(v:unknown,max=2000):string|null=>{
  if(v===null||v===undefined)return null;
  if(typeof v!=="string" || v.length>max)throw new CatalogContractError();
  return v;
};
const nat=(v:unknown):number=>{if(!Number.isSafeInteger(v)||(v as number)<0)throw new CatalogContractError();return v as number;};
function httpsUrl(v:unknown):string|null {
  if(typeof v!=="string" || v.length>2048)return null;
  try{const u=new URL(v);return u.protocol==="https:" && !u.username && !u.password && u.hostname.includes(".")?u.href:null;}catch{return null;}
}

export function parseManifest(input:unknown):CatalogManifest {
  if(!obj(input) || input.schema_version!==CATALOG_SCHEMA || typeof input.snapshot_id!=="string" ||
     !/^[A-Za-z0-9_-]{1,100}$/.test(input.snapshot_id) || !obj(input.counts))throw new CatalogContractError();
  const c=input.counts;
  const archive=obj(input.archive)?input.archive:null;
  // archive.public(): {mode, archive_connected, serving_placeholder_index, ...}
  const connected=archive && typeof archive.archive_connected==="boolean"?archive.archive_connected:null;
  return {snapshotId:input.snapshot_id,generatedAt:str(input.generated_at,64),
    counts:{records:nat(c.records),archived:nat(c.archived),metadataOnly:nat(c.metadata_only),textIndexed:nat(c.text_indexed),
      agencies:nat(c.agencies),sources:nat(c.sources)},archiveConnected:connected};
}

/** Parses one record; returns null for records unusable as public links (non-HTTPS). */
export function parseCatalogRecord(r:unknown):CatalogRecord|null {
  if(!obj(r) || typeof r.record_id!=="string" || !/^rec_[0-9a-f]{24}$/.test(r.record_id) ||
     !Array.isArray(r.sources) || r.sources.length>50 || !obj(r.preservation) || !obj(r.text))throw new CatalogContractError();
  const p=r.preservation;
  if(p.status!=="archived" && p.status!=="metadata_only")throw new CatalogContractError();
  const sha=p.sha256===null||p.sha256===undefined?null:(typeof p.sha256==="string" && /^[0-9a-f]{64}$/.test(p.sha256)?p.sha256:(()=>{throw new CatalogContractError();})());
  const named=(v:unknown)=>{
    if(v===null||v===undefined)return {slug:null,name:null};
    if(!obj(v) || typeof v.slug!=="string")throw new CatalogContractError();
    return {slug:str(v.slug,200),name:str(v.name,300)};
  };
  const agency=named(r.agency),office=named(r.office);
  const sources=r.sources.map(s=>{
    if(!obj(s) || typeof s.source_id!=="string" || !/^src_[0-9a-f]{16}$/.test(s.source_id) ||
       (s.provenance!=="official" && s.provenance!=="third_party"))throw new CatalogContractError();
    return {sourceId:s.source_id,url:httpsUrl(s.url),provenance:s.provenance as "official"|"third_party"};
  }).filter((s):s is {sourceId:string;url:string;provenance:"official"|"third_party"}=>!!s.url);
  if(typeof r.text.indexed!=="boolean")throw new CatalogContractError();
  const url=httpsUrl(r.url);
  const out:CatalogRecord={recordId:r.record_id,url:url??"",title:str(r.title,500),description:str(r.description,4000),
    filename:str(r.filename,300),fileType:str(r.file_type,40),publishedDate:str(r.published_date,40),
    agencyName:agency.name,agencySlug:agency.slug,officeName:office.name,sources,
    // A hash is meaningful only for an archived binary.
    preservation:{status:p.status,sha256:p.status==="archived"?sha:null,archivedAt:str(p.archived_at,64)},
    textIndexed:r.text.indexed};
  return url?out:null;
}
export function parseRecordsPage(input:unknown,snapshotId:string):{records:CatalogRecord[];skipped:number;nextCursor:string|null} {
  if(!obj(input) || input.schema_version!==CATALOG_SCHEMA || input.snapshot_id!==snapshotId ||
     !Array.isArray(input.records) || input.records.length>500 ||
     (input.next_cursor!==null && (typeof input.next_cursor!=="string" || input.next_cursor.length>512)))
    throw new CatalogContractError();
  const parsed=input.records.map(parseCatalogRecord);
  return {records:parsed.filter((x):x is CatalogRecord=>!!x),skipped:parsed.filter(x=>!x).length,nextCursor:input.next_cursor as string|null};
}

const MAX_BYTES=4*1024*1024;
async function getJson(fetcher:typeof fetch,url:URL):Promise<{status:number;body:unknown}> {
  let res:Response;
  try{
    res=await fetcher(url.href,{method:"GET",redirect:"error",cache:"no-store",credentials:"omit",
      headers:{Accept:"application/json"},signal:AbortSignal.timeout(15000)});
  }catch{throw new CatalogUnavailableError();}
  if(res.status===409)return {status:409,body:null};
  if(!res.ok)throw new CatalogUnavailableError("Catalog returned "+res.status);
  if(!/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/i.test(res.headers.get("content-type")||""))throw new CatalogUnavailableError("Not JSON");
  const reader=res.body?.getReader();
  if(!reader)throw new CatalogUnavailableError();
  const chunks:Uint8Array[]=[];let bytes=0;
  for(;;){
    const part=await reader.read();
    if(part.done)break;
    bytes+=part.value.byteLength;
    if(bytes>MAX_BYTES){await reader.cancel();throw new CatalogUnavailableError("Too large");}
    chunks.push(part.value);
  }
  try{return {status:res.status,body:JSON.parse(Buffer.concat(chunks).toString("utf8"))};}
  catch{throw new CatalogContractError();}
}

export interface HttpCatalogOptions {baseUrl:string;maxRecords?:number;ttlMs?:number;fetcher?:typeof fetch;now?:()=>number}
/** Pinned-origin HTTPS client with per-snapshot caching. */
export function createHttpCatalogSource(o:HttpCatalogOptions):CatalogSource {
  let base:URL;
  try{base=new URL(o.baseUrl);}catch{throw new Error("Invalid catalog base URL");}
  if(base.protocol!=="https:" || base.username || base.password || base.search || base.hash || !base.hostname.includes("."))
    throw new Error("Invalid catalog base URL");
  const root=base.origin+base.pathname.replace(/\/+$/,"");
  const fetcher=o.fetcher??fetch, now=o.now??Date.now;
  const maxRecords=Math.min(Math.max(o.maxRecords??5000,1),20000), ttl=o.ttlMs??10*60000;
  let cache:CatalogIndex|null=null, inflight:Promise<CatalogIndex>|null=null;
  const load=async():Promise<CatalogIndex>=>{
    for(let attempt=0;attempt<2;attempt++){
      const m=await getJson(fetcher,new URL(root+"/api/v1/export/manifest"));
      if(m.status===409)continue;
      const manifest=parseManifest(m.body);
      if(cache && cache.manifest.snapshotId===manifest.snapshotId){cache={...cache,manifest,fetchedAt:now()};return cache;}
      const records:CatalogRecord[]=[];
      let cursor:string|null=null, restarted=false, complete=true;
      do{
        const u=new URL(root+"/api/v1/records");
        u.searchParams.set("limit","500");
        if(cursor)u.searchParams.set("cursor",cursor);
        const page=await getJson(fetcher,u);
        if(page.status===409){restarted=true;break;}
        const parsed=parseRecordsPage(page.body,manifest.snapshotId);
        records.push(...parsed.records);
        cursor=parsed.nextCursor;
        if(records.length>=maxRecords && cursor){complete=false;break;}
      }while(cursor);
      if(restarted)continue; // snapshot changed mid-export: start over once
      return {manifest,records:records.slice(0,maxRecords),complete,fetchedAt:now()};
    }
    throw new CatalogUnavailableError("Catalog kept changing during export");
  };
  return {async loadIndex(){
    if(cache && now()-cache.fetchedAt<ttl)return cache;
    if(!inflight)inflight=load().then(i=>{cache=i;return i;}).finally(()=>{inflight=null;});
    return inflight;
  }};
}

/** In-memory source over a manifest + record pages (fixtures, tests). */
export function createStaticCatalogSource(manifest:unknown,pages:readonly unknown[]):CatalogSource {
  return {async loadIndex(){
    const m=parseManifest(manifest);
    const records=pages.flatMap(p=>parseRecordsPage(p,m.snapshotId).records);
    return {manifest:m,records,complete:true,fetchedAt:Date.now()};
  }};
}

/** Simple all-terms match across public text fields. */
export function searchCatalog(index:CatalogIndex,query:string,limit:number):CatalogRecord[] {
  const terms=query.toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>2);
  if(!terms.length)return [];
  return index.records.filter(r=>{
    const hay=[r.title,r.description,r.filename,r.agencyName,r.officeName].filter(Boolean).join(" ").toLowerCase();
    return terms.every(t=>hay.includes(t));
  }).slice(0,limit);
}
