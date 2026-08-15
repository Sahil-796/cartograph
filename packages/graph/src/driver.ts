import neo4j, { type Driver, type Session, type SessionConfig } from "neo4j-driver";
import { config } from "@cartograph/config";

/**
 * A single `neo4j-driver` instance for the lifetime of the process.
 *
 * The driver manages its own connection pool; creating a new driver per
 * request (or per query) would exhaust CognoDB's connection ceiling. Only
 * `Session`s — cheap, short-lived — should be created per unit of work,
 * via `withSession`.
 *
 * Lazily constructed so importing this module never opens a socket by
 * itself; the first call to `getDriver()` (or any helper built on it)
 * creates the singleton.
 */
let driverInstance: Driver | undefined;

export function getDriver(): Driver {
  if (!driverInstance) {
    driverInstance = neo4j.driver(
      config.COGNODB_URI,
      neo4j.auth.basic(config.COGNODB_USER, config.COGNODB_PASSWORD),
    );
  }
  return driverInstance;
}

/**
 * Opens a session, runs `fn` against it, and closes the session in
 * `finally` — regardless of whether `fn` resolves or throws. Sessions are
 * cheap and meant to be short-lived; never hold one across requests.
 */
export async function withSession<T>(
  fn: (session: Session) => Promise<T>,
  sessionConfig?: SessionConfig,
): Promise<T> {
  const session = getDriver().session(sessionConfig);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

/**
 * Verifies connectivity to CognoDB and logs the negotiated Bolt protocol
 * version plus the server agent string. `ServerInfo.protocolVersion` is
 * the actual Bolt version the driver and server agreed on (e.g. `5.4`) —
 * distinct from the driver's own package version — which is exactly what
 * we need to catch a silent negotiation failure above CognoDB's supported
 * range (Bolt 5.0-5.4).
 */
export async function verifyConnectivityAndLog(): Promise<void> {
  const serverInfo = await getDriver().getServerInfo();
  // eslint-disable-next-line no-console
  console.log(
    `Connected to CognoDB — agent: ${serverInfo.agent}, negotiated Bolt protocol: ${serverInfo.protocolVersion}`,
  );
}

/** Closes the process-wide driver. Call once during graceful shutdown. */
export async function closeDriver(): Promise<void> {
  if (driverInstance) {
    await driverInstance.close();
    driverInstance = undefined;
  }
}
