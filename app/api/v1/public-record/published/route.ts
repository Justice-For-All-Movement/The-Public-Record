import {json} from "../../../../../lib/server/http";
import {publishedList} from "../../../../../lib/server/published";
export const dynamic="force-dynamic";
/** Records published with current owner consent and independent review. */
export async function GET(){return json({records:await publishedList()});}
