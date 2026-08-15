import "./load-env.js";
import { verifyConnectivityAndLog, closeDriver } from "../driver.js";
import { initSchema, INDEX_STATEMENTS } from "../schema.js";

async function main(): Promise<void> {
  console.log("Connecting to CognoDB...");
  await verifyConnectivityAndLog();

  console.log("Creating indexes...");
  await initSchema();
  console.log(`✓ ${INDEX_STATEMENTS.length} indexes ensured`);
}

main()
  .then(async () => {
    await closeDriver();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("db:init failed:", error instanceof Error ? error.message : error);
    await closeDriver();
    process.exit(1);
  });
