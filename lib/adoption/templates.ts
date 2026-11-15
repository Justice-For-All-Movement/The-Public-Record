import data from "../../fixtures/request-templates.synthetic.json";
import {pinReviewedTemplate,validateRequestTemplate,type RequestTemplate} from "../templates/versioned-requests";

/**
 * Template catalog source. Currently the synthetic fixture only (clearly
 * labeled); a reviewed-template table replaces it in TPR-17 persistence.
 */
export interface CatalogTemplate extends RequestTemplate {agencyLabel:string}
export interface WorkCard {
  templateId:string;version:number;title:string;agencyLabel:string;recordsSummary:string;
  rangeStart:string|null;rangeEnd:string|null;synthetic:boolean;
}
export const CATALOG_IS_SYNTHETIC=data.synthetic===true;
const catalog:CatalogTemplate[]=(data.templates as CatalogTemplate[]).map(t=>{validateRequestTemplate(t);return Object.freeze({...t});});

/** Only independently reviewed, published templates are offered for adoption. */
export function publishedTemplates():CatalogTemplate[] {
  const latest=new Map<string,CatalogTemplate>();
  for(const t of catalog)if(t.state==="published" && (latest.get(t.templateId)?.version??0)<t.version)latest.set(t.templateId,t);
  return [...latest.values()].sort((a,b)=>a.title.localeCompare(b.title));
}
export function findPublishedTemplate(templateId:unknown):CatalogTemplate|null {
  return publishedTemplates().find(t=>t.templateId===templateId)??null;
}
/** Public projection: no reviewer/editor identities, no adoption counts. */
export function workCards():WorkCard[] {
  return publishedTemplates().map(t=>({templateId:t.templateId,version:t.version,title:t.title,agencyLabel:t.agencyLabel,
    recordsSummary:t.recordsDescription.length>220?t.recordsDescription.slice(0,217)+"…":t.recordsDescription,
    rangeStart:t.rangeStart,rangeEnd:t.rangeEnd,synthetic:CATALOG_IS_SYNTHETIC}));
}
export {pinReviewedTemplate};
