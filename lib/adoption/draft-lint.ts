import {lintFoiaDraft} from "../templates/drafting-lint";
import type {DraftRecord} from "../server/draft-store";

/** Advisory lint only; never blocks saving. Verified filing channels are not live yet. */
export function lintDraft(d:DraftRecord){
  return lintFoiaDraft({selectedAgencyComponentId:d.agencyComponentRef??"",verifiedAgencyComponentId:null,
    officialAgencyChannelVerified:false,description:d.body,startDate:d.rangeStart,endDate:d.rangeEnd,feeCapUsd:d.feeCapUsd,
    feeWaiverRequested:false,feeWaiverExplanation:null,electronicDeliveryRequested:d.electronicCopies,documentedSourceIds:[]});
}
