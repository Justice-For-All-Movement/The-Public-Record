/**
 * TPR-15 — FOIA Aggregator read-only resolver over the FC-13 catalog export
 * (`foia-catalog-export/1`). Adds provenance, per-record preservation status
 * and coverage warnings. Every outcome is phrased so that a miss, outage,
 * empty or partial catalog, or misconfiguration is NEVER presented as "these
 * records don't exist" or "were never released".
 */
import {CatalogContractError,searchCatalog,type CatalogIndex,type CatalogSource} from "../integrations/foia-catalog-export";

export type ResolverState = "matches"|"no_matches_in_indexed_portion"|"not_configured"|"unavailable"|"incompatible_contract"|"invalid_query";
export type HoldingStatus = "archived_copy_with_hash"|"indexed_link_only";
export interface ResolvedRecord {
  id:string;title:string;agency:string;office:string|null;recordUrl:string;
  sourceUrl:string|null;sourceProvenance:"official"|"third_party"|null;publishedDate:string|null;
  holding:HoldingStatus;sha256:string|null;textIndexed:boolean;
}
export interface ResolverResult {
  state:ResolverState;
  query:string;
  records:ResolvedRecord[];
  provenance:{source:"FOIA_Aggregator";adapter:"http"|"fixture"|"none";contractVersion:"foia-catalog-export/1"|null;
    snapshotId:string|null;observedAt:string|null;catalogRecords:number|null;searchedRecords:number|null;
    archiveConnected:boolean|null;synthetic:boolean};
  /** The search never claims completeness. */
  exhaustive:false;
  warnings:string[];
  fallback:{label:string;url:string}[];
}
export const OFFICIAL_FALLBACKS=[
  {label:"FOIA.gov — search agency FOIA libraries and make a request",url:"https://www.foia.gov/"},
  {label:"National Archives catalog",url:"https://catalog.archives.gov/"}
];
export const NOT_ABSENCE="A missing result does not mean the records don't exist, were never released, or were withheld.";
export const MAX_RESULTS=25;

function project(r:CatalogIndex["records"][number]):ResolvedRecord {
  const src=r.sources.find(s=>s.provenance==="official")??r.sources[0]??null;
  return {id:r.recordId,title:r.title??r.filename??r.url,agency:r.agencyName??r.agencySlug??"Agency not recorded",office:r.officeName,
    recordUrl:r.url,sourceUrl:src?.url??null,sourceProvenance:src?.provenance??null,publishedDate:r.publishedDate,
    holding:r.preservation.status==="archived" && r.preservation.sha256?"archived_copy_with_hash":"indexed_link_only",
    sha256:r.preservation.sha256,textIndexed:r.textIndexed};
}

export async function resolvePublicRecords(query:unknown,source:CatalogSource|null,
  meta:{adapter:"http"|"fixture";synthetic:boolean}|null):Promise<ResolverResult> {
  const q=typeof query==="string"?query.trim().replace(/\s+/g," "):"";
  const base={query:q,records:[] as ResolvedRecord[],exhaustive:false as const,fallback:OFFICIAL_FALLBACKS,
    provenance:{source:"FOIA_Aggregator" as const,adapter:meta?.adapter??"none" as const,contractVersion:null,snapshotId:null,
      observedAt:null,catalogRecords:null,searchedRecords:null,archiveConnected:null,synthetic:meta?.synthetic??false}};
  if(q.length<3 || q.length>300)
    return {...base,state:"invalid_query",warnings:["Enter 3 to 300 characters describing the records."]};
  if(!source)
    return {...base,state:"not_configured",warnings:["The public archive search is not connected in this deployment. "+NOT_ABSENCE]};
  let index:CatalogIndex;
  try{index=await source.loadIndex();}
  catch(error){
    if(error instanceof CatalogContractError)
      return {...base,state:"incompatible_contract",warnings:["The public archive returned data in an unexpected format, so it was not shown. "+NOT_ABSENCE]};
    return {...base,state:"unavailable",warnings:["The public archive could not be reached. Try again later or use the official sources below. "+NOT_ABSENCE]};
  }
  const m=index.manifest;
  const provenance={...base.provenance,contractVersion:"foia-catalog-export/1" as const,snapshotId:m.snapshotId,observedAt:m.generatedAt,
    catalogRecords:m.counts.records,searchedRecords:index.records.length,archiveConnected:m.archiveConnected};
  const warnings:string[]=[];
  if(meta?.synthetic)warnings.push("Preview data: these archive entries are fictional.");
  warnings.push("The archive indexes only part of the records agencies have released.");
  if(m.counts.records===0)warnings.push("The archive catalog is currently empty.");
  if(m.archiveConnected===false)warnings.push("The archive reports that its document storage is not connected; listed entries may be links only.");
  if(!index.complete)warnings.push(`Only the first ${index.records.length} of ${m.counts.records} catalog entries were searched.`);
  const records=searchCatalog(index,q,MAX_RESULTS).map(project);
  if(records.length>=MAX_RESULTS)warnings.push(`Only the first ${MAX_RESULTS} matches are shown; refine the search.`);
  if(records.some(r=>r.holding==="indexed_link_only"))
    warnings.push("Some entries are index links only: the archive has not preserved a copy, and the linked page may change.");
  if(records.some(r=>r.sourceProvenance==="third_party"))
    warnings.push("Some entries come from third-party sources, not the agency itself.");
  if(records.length===0)
    return {...base,provenance,state:"no_matches_in_indexed_portion",
      warnings:[...warnings,"No matches in the indexed portion of the archive. "+NOT_ABSENCE]};
  return {...base,provenance,state:"matches",records,warnings};
}
