import data from "../../fixtures/foia-aggregator.synthetic.json";
import type {PublicArchiveAdapter} from "./foia-archive";

/**
 * Offline adapter over a synthetic, contract-shaped fixture. Used for local
 * development, previews and tests until FOIA Aggregator exposes a verified
 * public JSON endpoint. Never enabled in production (config.ts).
 */
export const FIXTURE_IS_SYNTHETIC=data.synthetic===true;
export function createFixtureArchiveAdapter():PublicArchiveAdapter {
  return {async searchPublicRecords(query,limit){
    const terms=query.toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>2);
    const records=data.records.filter(r=>{
      const hay=(r.title+" "+r.agency).toLowerCase();
      return terms.length>0 && terms.every(t=>hay.includes(t));
    }).slice(0,limit);
    return {contract_version:"public-archive-search/v1",source:"FOIA_Aggregator",observed_at:data.observed_at,
      coverage:data.coverage,records};
  }};
}
