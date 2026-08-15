/**
 * ESM/CJS boundary crossing for the ingestion surface.
 *
 * This mirrors `apps/api/src/query/graph-loader.ts` (read that file's long
 * comment for the full rationale). `apps/api` compiles to CommonJS, but
 * `@cartograph/ingest` — the pure ingest engine — is an ESM-only package that
 * ships as raw, unbuilt TypeScript (`"main": "./src/index.ts"`) and pulls in
 * ESM-only deps (`@cartograph/graph`, `@cartograph/extract`). A static
 * `import { runIngest } from "@cartograph/ingest"` would get downleveled by
 * tsc's CommonJS emit into a `require()` that cannot load ESM, failing at
 * runtime. So we do a genuine dynamic `import()` built via `new Function(...)`
 * (a string tsc never parses as an import, so it can't downlevel it), after
 * registering `tsx/esm/api`'s loader hooks so Node can resolve the packages'
 * `.js`-specifier-for-`.ts` imports and strip types. Registered once, lazily,
 * the first time an ingest request actually needs the engine.
 */
import type * as IngestModule from '@cartograph/ingest';

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof IngestModule>;

let tsxRegistered = false;
let ingestModulePromise: Promise<typeof IngestModule> | undefined;

/** Loads `@cartograph/ingest` via a real dynamic import, once, and caches the result. */
export function loadIngest(): Promise<typeof IngestModule> {
  if (!tsxRegistered) {
    tsxRegistered = true;
    // CJS `require` here is fine — `tsx/esm/api`'s CJS build only *registers*
    // Node ESM loader hooks; it doesn't itself need to be loaded as ESM.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { register } = require('tsx/esm/api') as { register: () => void };
    register();
  }
  if (!ingestModulePromise) {
    ingestModulePromise = dynamicImport('@cartograph/ingest');
  }
  return ingestModulePromise;
}
