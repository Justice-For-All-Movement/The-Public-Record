import data from "../../fixtures/filing-routes.synthetic.json";
import type {FilingRegistry,RouteWithInstructions} from "./self-filing-guide";

/**
 * Reviewed filing routes. Only the synthetic fixture exists today (TPR-12
 * persistence pending); its review timestamps are pinned to "now minus one
 * day" so the preview demonstrates the verified path, and it is never loaded
 * in production.
 */
export function filingRegistry(stage:string,now=new Date()):FilingRegistry {
  if(stage==="production")return {synthetic:false,trustedSourceHosts:[],trustedChannelHosts:[],routes:[]};
  const reviewed=new Date(now.getTime()-86400000).toISOString();
  return {synthetic:true,trustedSourceHosts:data.trustedSourceHosts,trustedChannelHosts:data.trustedChannelHosts,
    routes:(data.routes as RouteWithInstructions[]).map(r=>({...r,verifiedAt:r.verifiedAt==="REVIEWED_RECENTLY"?reviewed:r.verifiedAt}))};
}
