import {templateCatalog,toWorkCards} from "../../../../../lib/server/catalog";
import {json} from "../../../../../lib/server/http";
export const dynamic="force-dynamic";
/** Public, anonymous work cards: reviewed published templates only, no participant data or counts. */
export async function GET(){
  const c=await templateCatalog();
  return json({synthetic:c.synthetic,source:c.source,templates:toWorkCards(c)});
}
