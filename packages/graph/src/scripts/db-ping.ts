import "./load-env.js";
import { getDriver, withSession, closeDriver } from "../driver.js";

async function main(): Promise<void> {
  console.log("Connecting to CognoDB...");
  const serverInfo = await getDriver().getServerInfo();

  const result = await withSession(async (session) => {
    return session.run("RETURN 1 AS ok");
  });
  const raw = result.records[0]?.get("ok");
  // neo4j returns integers as its own Integer type; render as a plain number.
  const value = typeof raw?.toNumber === "function" ? raw.toNumber() : raw;

  console.log(`RETURN 1 -> ${value}`);
  console.log(`Server agent: ${serverInfo.agent}`);
  console.log(`Negotiated Bolt protocol: ${serverInfo.protocolVersion}`);
}

main()
  .then(async () => {
    await closeDriver();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("db:ping failed:", error instanceof Error ? error.message : error);
    await closeDriver();
    process.exit(1);
  });
