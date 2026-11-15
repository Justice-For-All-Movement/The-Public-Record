import {createFixtureArchiveAdapter,FIXTURE_IS_SYNTHETIC} from "../integrations/archive-fixture";
import {createPublicArchiveHttpAdapter} from "../integrations/foia-archive-http";
import {resolvePublicRecords,type ResolverResult} from "../research/archive-resolver";
import {config} from "./config";

/** Chooses the configured archive transport: live HTTPS endpoint, synthetic fixture, or none. */
export async function searchArchive(query:unknown):Promise<ResolverResult> {
  const cfg=config();
  if(cfg.aggregatorUrl){
    let adapter;
    try{adapter=createPublicArchiveHttpAdapter({endpoint:cfg.aggregatorUrl});}
    catch{return resolvePublicRecords(query,null,null);}
    return resolvePublicRecords(query,adapter,{adapter:"http",synthetic:false});
  }
  if(cfg.aggregatorFixtures)return resolvePublicRecords(query,createFixtureArchiveAdapter(),{adapter:"fixture",synthetic:FIXTURE_IS_SYNTHETIC});
  return resolvePublicRecords(query,null,null);
}
