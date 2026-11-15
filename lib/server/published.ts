import {getPool,withPublicDb} from "./db";
import {getPublished,listPublished,type PublishedRecord} from "../publication/publication";

/** Public reads: empty when no database is configured. */
export async function publishedList(){return getPool()?withPublicDb(db=>listPublished(db,100)):[];}
export async function publishedRecord(publicId:string):Promise<(PublishedRecord&{derivativeKey:string})|null> {
  return getPool()?withPublicDb(db=>getPublished(db,publicId)):null;
}
