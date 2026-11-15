import data from "../../fixtures/foia-aggregator.synthetic.json";
import {createStaticCatalogSource,type CatalogSource} from "./foia-catalog-export";

/**
 * Offline FC-13 (`foia-catalog-export/1`) catalog over a synthetic fixture,
 * for local development, previews and tests. Never enabled in production.
 */
export const FIXTURE_IS_SYNTHETIC=data.synthetic===true;
export function createFixtureCatalogSource():CatalogSource {
  return createStaticCatalogSource(data.manifest,data.pages);
}
