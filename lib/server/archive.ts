import {createFixtureCatalogSource,FIXTURE_IS_SYNTHETIC} from "../integrations/archive-fixture";
import {createHttpCatalogSource,type CatalogSource} from "../integrations/foia-catalog-export";
import {resolvePublicRecords,type ResolverResult} from "../research/archive-resolver";
import {config} from "./config";

const holder=globalThis as typeof globalThis & {__tprCatalog?:{url:string;source:CatalogSource}};
/** Live FC-13 catalog (cached per snapshot), synthetic fixture, or none. */
export async function searchArchive(query:unknown):Promise<ResolverResult> {
  const cfg=config();
  if(cfg.aggregatorUrl){
    if(holder.__tprCatalog?.url!==cfg.aggregatorUrl){
      try{holder.__tprCatalog={url:cfg.aggregatorUrl,source:createHttpCatalogSource({baseUrl:cfg.aggregatorUrl})};}
      catch{return resolvePublicRecords(query,null,null);}
    }
    return resolvePublicRecords(query,holder.__tprCatalog.source,{adapter:"http",synthetic:false});
  }
  if(cfg.aggregatorFixtures)return resolvePublicRecords(query,createFixtureCatalogSource(),{adapter:"fixture",synthetic:FIXTURE_IS_SYNTHETIC});
  return resolvePublicRecords(query,null,null);
}
