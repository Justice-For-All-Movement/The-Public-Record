/**
 * TPR-15 — FOIA Aggregator read-only resolver.
 *
 * Wraps the strict public-archive-search/v1 contract with provenance, per-
 * record holding status and coverage warnings. Every outcome is phrased so
 * that a miss, outage, misconfiguration or partial index is NEVER presented
 * as "these records don't exist" or "were never released".
 */
import {findPublicRecords,type PublicArchiveAdapter} from "../integrations/foia-archive";
import type {ArchiveCoverage,PublicRecord} from "../contracts/archive-v1";

export type ResolverState = "matches"|"no_matches_in_indexed_portion"|"not_configured"|"unavailable"|"incompatible_contract"|"invalid_query";
export type HoldingStatus = "archived_copy_with_hash"|"indexed_link_only";
export interface ResolvedRecord extends PublicRecord {holding:HoldingStatus}
export interface ResolverResult {
  state:ResolverState;
  query:string;
  records:ResolvedRecord[];
  provenance:{source:"FOIA_Aggregator";adapter:"http"|"fixture"|"none";contractVersion:"public-archive-search/v1"|null;
    observedAt:string|null;coverage:ArchiveCoverage|null;synthetic:boolean};
  /** The search never claims completeness. */
  exhaustive:false;
  warnings:string[];
  fallback:{label:string;url:string}[];
}
export const OFFICIAL_FALLBACKS=[
  {label:"FOIA.gov — search agency FOIA libraries and make a request",url:"https://www.foia.gov/"},
  {label:"National Archives catalog",url:"https://catalog.archives.gov/"}
];
const coverageWarning:Record<ArchiveCoverage,string>={
  unknown:"The archive's coverage for this topic is unknown.",
  partial:"The archive indexes only part of the records agencies have released.",
  broad_not_exhaustive:"The archive is broad but not exhaustive; agencies publish records in many places."
};
export const NOT_ABSENCE="A missing result does not mean the records don't exist, were never released, or were withheld.";
export const MAX_RESULTS=25;

export async function resolvePublicRecords(query:unknown,adapter:PublicArchiveAdapter|null,
  meta:{adapter:"http"|"fixture";synthetic:boolean}|null):Promise<ResolverResult> {
  const q=typeof query==="string"?query.trim().replace(/\s+/g," "):"";
  const base={query:q,records:[] as ResolvedRecord[],exhaustive:false as const,fallback:OFFICIAL_FALLBACKS,
    provenance:{source:"FOIA_Aggregator" as const,adapter:meta?.adapter??"none" as const,contractVersion:null,observedAt:null,coverage:null,synthetic:meta?.synthetic??false}};
  if(q.length<3 || q.length>300)
    return {...base,state:"invalid_query",warnings:["Enter 3 to 300 characters describing the records."]};
  const result=await findPublicRecords(q,adapter??undefined);
  if(result.state==="not_configured")
    return {...base,state:"not_configured",warnings:["The public archive search is not connected in this deployment. "+NOT_ABSENCE]};
  if(result.state==="unavailable")
    return {...base,state:"unavailable",warnings:["The public archive could not be reached. Try again later or use the official sources below. "+NOT_ABSENCE]};
  if(result.state==="incompatible_contract")
    return {...base,state:"incompatible_contract",warnings:["The public archive returned data in an unexpected format, so it was not shown. "+NOT_ABSENCE]};
  if(result.state!=="available")throw new Error("unreachable");
  const data=result.data;
  const records=data.records.map(r=>({...r,holding:(r.sha256?"archived_copy_with_hash":"indexed_link_only") as HoldingStatus}));
  const warnings=[coverageWarning[data.coverage]];
  if(meta?.synthetic)warnings.unshift("Preview data: these archive entries are fictional.");
  if(records.length>=MAX_RESULTS)warnings.push(`Only the first ${MAX_RESULTS} matches are shown; refine the search.`);
  if(records.some(r=>r.holding==="indexed_link_only"))
    warnings.push("Some entries are index links only: the archive has not verified a stored copy, and the linked page may change.");
  const provenance={...base.provenance,contractVersion:data.contract_version,observedAt:data.observed_at,coverage:data.coverage};
  if(records.length===0)
    return {...base,provenance,state:"no_matches_in_indexed_portion",
      warnings:[...warnings,"No matches in the indexed portion of the archive. "+NOT_ABSENCE]};
  return {...base,provenance,state:"matches",records,warnings};
}
