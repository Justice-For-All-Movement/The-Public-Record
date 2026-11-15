/**
 * TPR-21 — Official self-filing guide. Produces step-by-step instructions for
 * the participant to file THEMSELVES. There is no submission path: the only
 * outbound destination ever shown is one that passes evaluateFilingRoute()
 * (reviewed, fresh, exact allow-listed host, no open redirects).
 */
import {evaluateFilingRoute,type FilingGuidance,type ReviewedFilingRoute} from "./verified-channel";

export interface RouteWithInstructions extends ReviewedFilingRoute {acknowledgement:string}
export interface FilingRegistry {
  synthetic:boolean;
  trustedSourceHosts:readonly string[];
  trustedChannelHosts:readonly string[];
  routes:readonly RouteWithInstructions[];
}
export interface GuideStep {id:string;title:string;detail:string;link?:{href:string;label:string}}
export interface SelfFilingGuide {
  status:"ready"|"needs_verification"|"no_verified_route";
  guidance:FilingGuidance|null;
  synthetic:boolean;
  steps:GuideStep[];
  /** Exact text the participant must affirm before recording "filed". */
  confirmation:string;
}
export const SELF_FILING_CONFIRMATION="I personally submitted this request to the agency using its official instructions.";
const GENERAL={href:"https://www.foia.gov/how-to.html",label:"Official FOIA.gov filing guidance"};

export function buildSelfFilingGuide(agencyComponentId:string|null,registry:FilingRegistry,now=new Date()):SelfFilingGuide {
  const route=agencyComponentId?registry.routes.find(r=>r.agencyComponentId===agencyComponentId):undefined;
  const guidance=route?evaluateFilingRoute(route,registry.trustedSourceHosts,registry.trustedChannelHosts,now):null;
  const steps:GuideStep[]=[
    {id:"check",title:"Check the final text",detail:"Make sure it describes existing records, a date range and your fee limit. Remove anything you would not want an agency to see."},
  ];
  let status:SelfFilingGuide["status"]="no_verified_route";
  if(guidance?.status==="verified" && route){
    status="ready";
    steps.push({id:"verify",title:"Confirm the official instructions",detail:"Open the agency's own instructions and confirm they still match.",
      link:{href:guidance.sourceUrl!,label:"Agency FOIA instructions"}});
    steps.push(guidance.kind==="portal"
      ? {id:"file",title:"File it yourself on the agency portal",detail:"Create or use your own account there and paste your request. The Public Record cannot and will not submit it for you.",
          link:{href:guidance.destination!,label:"Open the agency's request portal"}}
      : {id:"file",title:"Email it yourself",detail:"Send your request from your own email account to the address below. The Public Record does not send email on your behalf.",
          link:{href:guidance.destination!,label:guidance.destination!.replace(/^mailto:/,"")}});
    steps.push({id:"ack",title:"Keep the acknowledgement",detail:route.acknowledgement.slice(0,400)});
  }else{
    status=guidance?.status==="stale"?"needs_verification":"no_verified_route";
    steps.push({id:"find",title:"Find the agency's official instructions",
      detail:status==="needs_verification"
        ? "Our reviewed instructions for this agency are out of date, so no direct link is shown. Use FOIA.gov to find the agency's current process."
        : "We have no reviewed filing route for this agency yet. Use FOIA.gov to find the agency's official process. Never send requests to addresses found in unofficial sources.",
      link:GENERAL});
    steps.push({id:"ack",title:"Keep the acknowledgement",detail:"Save the confirmation page, tracking number or reply the agency gives you."});
  }
  steps.push({id:"record",title:"Record that you filed",detail:"Come back and record the filing date. You can attach a private fingerprint of your receipt; the file itself stays on your device."});
  return {status,guidance,synthetic:registry.synthetic,steps,confirmation:SELF_FILING_CONFIRMATION};
}
