/**
 * TPR-26 — fee decisions. A participant's fee ceiling is a limit they chose;
 * recording "accepted" for an agency estimate above that ceiling is refused
 * unless the participant states an explicit maximum covering the estimate.
 * Nothing here pays, promises payment or picks a fee category for anyone.
 */
import type {LifecycleEvent,LifecyclePayloads} from "./events";

export type FeeState = "no_estimate"|"within_ceiling"|"above_ceiling_awaiting_decision"|"accepted_explicitly"|
  "narrowed"|"declined"|"waiver_requested"|"estimate_amount_unknown";
export interface FeeStatus {
  state:FeeState;
  ceilingUsd:number;
  latestEstimateUsd:number|null;
  estimateEventId:string|null;
  message:string;
}
export class FeeDecisionError extends Error {constructor(m:string){super(m);this.name="FeeDecisionError";}}

const usd=(n:number)=>"$"+n.toFixed(2);
/** Latest estimate and the response that answers it (by causal link or later date). */
export function feeStatus(events:readonly LifecycleEvent[],ceilingUsd:number):FeeStatus {
  const ordered=[...events].sort((a,b)=>a.occurredOn.localeCompare(b.occurredOn)||a.recordedAt.localeCompare(b.recordedAt));
  const estimate=[...ordered].reverse().find(e=>e.type==="fee_estimate_received");
  if(!estimate)return {state:"no_estimate",ceilingUsd,latestEstimateUsd:null,estimateEventId:null,message:"No fee estimate recorded."};
  const amount=(estimate.payload as LifecyclePayloads["fee_estimate_received"]).amountUsd ?? null;
  const response=ordered.find(e=>e.type==="fee_response_sent" &&
    (e.causedBy===estimate.id || (e.causedBy===null && (e.occurredOn>estimate.occurredOn ||
      (e.occurredOn===estimate.occurredOn && e.recordedAt>estimate.recordedAt)))));
  const base={ceilingUsd,latestEstimateUsd:amount,estimateEventId:estimate.id};
  if(response){
    const p=response.payload as LifecyclePayloads["fee_response_sent"];
    if(p.decision==="accepted")return {...base,state:"accepted_explicitly",
      message:`You recorded agreeing to pay up to ${usd(p.acceptedMaxUsd ?? ceilingUsd)}.`};
    if(p.decision==="narrowed")return {...base,state:"narrowed",message:"You recorded narrowing the request in response to the estimate."};
    if(p.decision==="declined")return {...base,state:"declined",message:"You recorded declining the estimated fees."};
    return {...base,state:"waiver_requested",message:"You recorded asking the agency to waive or reduce fees."};
  }
  if(amount===null)return {...base,state:"estimate_amount_unknown",message:"A fee estimate was recorded without an amount. Check the agency's letter."};
  if(amount<=ceilingUsd)return {...base,state:"within_ceiling",message:`The estimate (${usd(amount)}) is within your ceiling (${usd(ceilingUsd)}).`};
  return {...base,state:"above_ceiling_awaiting_decision",
    message:`The estimate (${usd(amount)}) is above your ceiling (${usd(ceilingUsd)}). Nothing is agreed until you decide: narrow the request, decline, ask about a waiver, or explicitly agree to a higher maximum.`};
}

/** Server-side guard used before recording a fee response. */
export function assertFeeResponseAllowed(events:readonly LifecycleEvent[],ceilingUsd:number,
  response:Pick<LifecycleEvent,"type"|"payload">):void {
  if(response.type!=="fee_response_sent")return;
  const p=response.payload as LifecyclePayloads["fee_response_sent"];
  if(p.decision!=="accepted")return;
  const status=feeStatus(events,ceilingUsd);
  const estimate=status.latestEstimateUsd;
  if(status.state==="no_estimate")throw new FeeDecisionError("Record the agency's fee estimate before accepting fees.");
  if(estimate===null){
    if(p.acceptedMaxUsd===undefined)throw new FeeDecisionError("State the maximum you agree to pay.");
    return;
  }
  if(estimate>ceilingUsd && (p.acceptedMaxUsd===undefined || p.acceptedMaxUsd<estimate))
    throw new FeeDecisionError(`The estimate (${usd(estimate)}) is above your ceiling (${usd(ceilingUsd)}). Enter a maximum of at least the estimate to accept it, or record another decision.`);
  if(p.acceptedMaxUsd!==undefined && p.acceptedMaxUsd<estimate)
    throw new FeeDecisionError("The maximum you agree to pay is below the estimate.");
}
