/**
 * TPR-20 — export of a saved member draft. Produces the same plain-text
 * request as the local tool plus template provenance. No network calls,
 * no submission fields, no hidden metadata: what you see is what is copied.
 */
import {renderLocalDraftText,validateLocalDraft,type LocalRequestDraft} from "./plaintext-export";

export interface ExportableDraft {
  title:string;body:string;agencyLabel:string|null;templateId:string|null;templateVersion:number|null;
  rangeStart:string|null;rangeEnd:string|null;feeCapUsd:number;electronicCopies:boolean;
}
export type ExportResult = {ready:true;text:string;filename:string}|{ready:false;problems:string[]};

export function exportMemberDraft(d:ExportableDraft):ExportResult {
  const local:LocalRequestDraft={agencyName:d.agencyLabel??"",description:d.body,startDate:d.rangeStart??"",endDate:d.rangeEnd??"",
    feeCapUsd:d.feeCapUsd,electronicCopies:d.electronicCopies};
  const problems=validateLocalDraft(local);
  if(problems.length)return {ready:false,problems};
  const provenance=d.templateId&&d.templateVersion
    ? `Prepared from reviewed template ${d.templateId}, version ${d.templateVersion}, and edited by the requester.`
    : "Prepared by the requester without a reviewed template.";
  const text=renderLocalDraftText(local)+"\n"+provenance;
  const slug=(d.title||"foia-request").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60)||"foia-request";
  return {ready:true,text,filename:`${slug}.txt`};
}
