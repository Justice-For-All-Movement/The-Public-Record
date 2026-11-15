import {CATALOG_IS_SYNTHETIC,workCards} from "../../../../../lib/adoption/templates";
import {json} from "../../../../../lib/server/http";
export const dynamic="force-dynamic";
/** Public, anonymous work cards: reviewed templates only, no participant data or counts. */
export function GET(){return json({synthetic:CATALOG_IS_SYNTHETIC,templates:workCards()});}
