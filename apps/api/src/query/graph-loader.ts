/**
 * The ESM/CJS boundary crossing.
 *
 * `apps/api` compiles to CommonJS (`"type": "commonjs"`, built by
 * `nest`/`tsc --module commonjs`), but `@cartograph/graph` (and
 * `@cartograph/tools`) are ESM-only packages. A *static*
 * `import { getQuery } from "@cartograph/graph"` would get downleveled
 * by TypeScript's CommonJS emit into `require("@cartograph/graph")` —
 * and `require()` cannot load an ESM-only package. That failure happens
 * at runtime, not compile time, so it's easy to miss until the route is
 * actually hit.
 *
 * Step 1 — a genuine dynamic `import()` at runtime. Naively writing
 * `await import("@cartograph/graph")` doesn't work either: with
 * `"module": "commonjs"`, tsc *also* downlevels dynamic `import()`
 * expressions into `Promise.resolve().then(() => require(...))`
 * (verified empirically against this repo's tsc — dump the emitted
 * `.js` for this file to see it). `apps/cli` never hits this because the
 * CLI itself is ESM, so its dynamic imports are never downleveled in the
 * first place; `apps/api` doesn't have that luxury. The standard
 * workaround (used by CJS packages bridging to ESM-only deps) is to
 * build the `import()` call via `new Function(...)` — a string tsc's
 * compiler never parses as an import statement, so it can't downlevel
 * it. At runtime `new Function` still evaluates to a real ESM dynamic
 * import.
 *
 * Step 2 — `@cartograph/graph` ships as raw, unbuilt TypeScript
 * (`"main": "./src/index.ts"`, matching every other package in this
 * monorepo; there is no compiled `dist/`). Every existing consumer
 * (its own tests, the CLI) runs it through `tsx`, which both strips
 * types AND resolves the `./driver.js`-imports-`driver.ts` convention
 * TypeScript's `NodeNext` module resolution requires. Plain Node's
 * native ESM loader does neither — even Node 24's built-in TS type
 * stripping resolves `.js` specifiers to on-disk `.js` files only, not
 * to sibling `.ts` files (confirmed empirically: `node --eval
 * "import('.../graph/src/index.ts')"` fails with `ERR_MODULE_NOT_FOUND`
 * on the first `./driver.js` import inside it). So the raw `import()`
 * from step 1 needs `tsx`'s ESM loader hooks registered first. `tsx`
 * ships exactly this as a runtime API for cases like this one —
 * `tsx/esm/api`'s `register()` — instead of requiring `--import tsx` on
 * the process's own command line (which would additionally affect how
 * `apps/api`'s own compiled CJS code loads, and isn't this agent's
 * script to change). Registered once, lazily, only when a query request
 * actually needs `@cartograph/graph`.
 */
import type * as GraphModule from "@cartograph/graph";

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<typeof GraphModule>;

let tsxRegistered = false;
let graphModulePromise: Promise<typeof GraphModule> | undefined;

/** Loads `@cartograph/graph` via a real dynamic import, once, and caches the result. */
export async function loadGraph(): Promise<typeof GraphModule> {
  if (!tsxRegistered) {
    tsxRegistered = true;
    // CJS `require` here is fine — `tsx/esm/api`'s CJS build only
    // *registers* Node ESM loader hooks; it doesn't itself need to be
    // loaded as ESM. This is a value import (not `import type`), so it's
    // deliberately kept out of the top-level `import` list above and
    // only pulled in the first time a query route actually runs.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { register } = require("tsx/esm/api") as { register: () => void };
    register();
  }
  if (!graphModulePromise) {
    graphModulePromise = dynamicImport("@cartograph/graph");
  }
  return graphModulePromise;
}
