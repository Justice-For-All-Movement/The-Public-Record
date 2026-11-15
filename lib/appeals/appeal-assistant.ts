/**
 * TPR-27 — administrative appeal and OGIS assistance. Explains options after
 * an adverse determination and prepares an editable letter the participant
 * files THEMSELVES. It never files, never promises an outcome and never states
 * a deadline as certain: the agency's letter controls.
 */
import type {ClockResult} from "../clock/foia-clock";
import type {LifecycleProjection} from "../lifecycle/projection";
import type {DeterminationOutcome} from "../lifecycle/events";

export const appealGrounds = {
  search_adequacy:"I ask that the agency conduct a new search, because I believe the search was not reasonably calculated to find all responsive records.",
  exemptions:"I ask that the agency reconsider the withholdings, release all reasonably segregable non-exempt material, and identify the exemption applied to each withholding.",
  no_records:"I ask that the agency reconsider its finding that no responsive records exist and describe the search it performed.",
  fees:"I ask that the agency reconsider its fee determination, including my fee category and any request for a waiver or reduction.",
  expedite:"I ask that the agency reconsider its denial of expedited processing.",
  other:"I ask that the agency reconsider its determination for the reasons explained below."
} as const;
export type AppealGround = keyof typeof appealGrounds;
export const APPEAL_RESOURCES=[
  {label:"Department of Justice OIP guidance on administrative appeals",url:"https://www.justice.gov/oip/oip-guidance/oip-guidance-adjudicating-administrative-appeals-under-foia"},
  {label:"Office of Government Information Services (OGIS) mediation",url:"https://www.archives.gov/ogis/mediation-program/request-assistance"},
  {label:"FOIA.gov — agency contacts and FOIA Public Liaisons",url:"https://www.foia.gov/"}
];
const suggested:Record<DeterminationOutcome,AppealGround[]>={
  full_grant:[],partial_grant:["exemptions","search_adequacy"],full_denial:["exemptions"],no_records:["no_records","search_adequacy"],
  fee_related:["fees"],other_adverse:["other"],withdrawn_by_agency:["other"]
};

export interface AppealAssistance {
  eligible:boolean;
  reason:string;
  determinationOn:string|null;
  outcome:DeterminationOutcome|null;
  suggestedGrounds:AppealGround[];
  windowText:string|null;
  alreadyAppealed:boolean;
  resources:typeof APPEAL_RESOURCES;
}
export function appealAssistance(p:LifecycleProjection,clock:ClockResult):AppealAssistance {
  const d=p.facts.determination;
  const base={resources:APPEAL_RESOURCES,alreadyAppealed:!!p.facts.appeal};
  if(p.disputed)return {...base,eligible:false,reason:"The request's records conflict; resolve them before preparing an appeal.",determinationOn:null,outcome:null,suggestedGrounds:[],windowText:null};
  if(!d)return {...base,eligible:false,reason:"No final determination is recorded yet.",determinationOn:null,outcome:null,suggestedGrounds:[],windowText:null};
  if(d.outcome==="full_grant")return {...base,eligible:false,reason:"The recorded determination released the records in full.",determinationOn:d.on,outcome:d.outcome,suggestedGrounds:[],windowText:null};
  const min=clock.appeal.minimumWindowEndsOn;
  const stated=clock.appeal.statedDeadline;
  const windowText=(stated?`The determination letter states a deadline of ${stated}. `:"")+
    (min?`Federal law provides at least 90 days after the determination (through ${min} at minimum), but follow the deadline and address in the agency's letter.`:"");
  return {...base,eligible:true,reason:"An adverse determination is recorded. An administrative appeal is optional; OGIS mediation is another option.",
    determinationOn:d.on,outcome:d.outcome,suggestedGrounds:suggested[d.outcome],windowText};
}

export interface AppealLetterInput {
  agencyLabel:string|null;
  trackingNumber:string|null;
  requestTitle:string;
  determinationOn:string;
  grounds:readonly AppealGround[];
  explanation:string;
}
/** Editable plain-text letter. Placeholders are left for the participant to fill in. */
export function draftAppealLetter(i:AppealLetterInput):string {
  if(!i.grounds.length || i.grounds.some(g=>!(g in appealGrounds)))throw new Error("Choose at least one appeal ground");
  if(i.explanation.length>4000)throw new Error("Explanation too long");
  return [
    "FREEDOM OF INFORMATION ACT APPEAL",
    "",
    "[Date]",
    "",
    "To: "+(i.agencyLabel??"[Agency appeals office — use the address in your determination letter]"),
    "",
    `Re: Appeal of FOIA request ${i.trackingNumber?`no. ${i.trackingNumber}`:"[tracking number]"} — "${i.requestTitle}"`,
    "",
    `I am appealing the determination dated ${i.determinationOn} on my request under the Freedom of Information Act, 5 U.S.C. § 552.`,
    "",
    ...i.grounds.map(g=>"- "+appealGrounds[g]),
    "",
    i.explanation.trim()?i.explanation.trim():"[Explain, in your own words, why you believe the determination should be reconsidered.]",
    "",
    "Please let me know if you need anything further to process this appeal.",
    "",
    "Sincerely,",
    "[Your name]",
    "[Your contact information]"
  ].join("\n");
}
