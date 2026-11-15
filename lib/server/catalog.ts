import {publishedTemplates,CATALOG_IS_SYNTHETIC,type CatalogTemplate,type WorkCard} from "../adoption/templates";
import {filingRegistry as fixtureRegistry} from "../filing/registry";
import type {FilingRegistry} from "../filing/self-filing-guide";
import {filingRegistryFromDb,publishedTemplatesFromDb} from "../registry/reviewed-registry";
import {config} from "./config";
import {getPool,withPublicDb} from "./db";

/**
 * Source selection for TPR-12/17 reference data: the reviewed database
 * registry when it has entries; otherwise the labeled synthetic fixtures,
 * but only outside production. Production never shows fixtures.
 */
export interface TemplateCatalog {source:"database"|"fixture"|"none";synthetic:boolean;templates:CatalogTemplate[]}
export async function templateCatalog():Promise<TemplateCatalog> {
  const stage=config().stage;
  if(getPool()){
    try{
      const rows=await withPublicDb(publishedTemplatesFromDb);
      if(rows.length || stage==="production")return {source:"database",synthetic:false,templates:rows};
    }catch{if(stage==="production")return {source:"none",synthetic:false,templates:[]};}
  }
  if(stage==="production")return {source:"none",synthetic:false,templates:[]};
  return {source:"fixture",synthetic:CATALOG_IS_SYNTHETIC,templates:publishedTemplates()};
}
export async function findCatalogTemplate(templateId:unknown):Promise<CatalogTemplate|null> {
  return (await templateCatalog()).templates.find(t=>t.templateId===templateId)??null;
}
export function toWorkCards(c:TemplateCatalog):WorkCard[] {
  return c.templates.map(t=>({templateId:t.templateId,version:t.version,title:t.title,agencyLabel:t.agencyLabel,
    recordsSummary:t.recordsDescription.length>220?t.recordsDescription.slice(0,217)+"…":t.recordsDescription,
    rangeStart:t.rangeStart,rangeEnd:t.rangeEnd,synthetic:c.synthetic}));
}
export async function filingRegistry():Promise<FilingRegistry> {
  const stage=config().stage;
  if(getPool()){
    try{
      const reg=await withPublicDb(filingRegistryFromDb);
      if(reg.routes.length || stage==="production")return reg;
    }catch{if(stage==="production")return fixtureRegistry("production");}
  }
  return fixtureRegistry(stage);
}
