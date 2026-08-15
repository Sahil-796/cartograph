import { withSession } from "./driver.js";

/**
 * The five indexes required by the plan. Each is `IF NOT EXISTS`, so
 * running this list is idempotent — safe to call on every boot/deploy,
 * not just once.
 */
export const INDEX_STATEMENTS: readonly string[] = [
  "CREATE INDEX file_repo_path   IF NOT EXISTS FOR (f:File)   ON (f.repoId, f.path)",
  "CREATE INDEX symbol_repo_id   IF NOT EXISTS FOR (s:Symbol) ON (s.repoId, s.id)",
  "CREATE INDEX symbol_repo_name IF NOT EXISTS FOR (s:Symbol) ON (s.repoId, s.name)",
  "CREATE INDEX commit_repo_sha  IF NOT EXISTS FOR (c:Commit) ON (c.repoId, c.sha)",
  "CREATE INDEX author_repo_mail IF NOT EXISTS FOR (a:Author) ON (a.repoId, a.email)",
];

/**
 * Ensures all five indexes exist. Runs each `CREATE INDEX ... IF NOT
 * EXISTS` statement in its own session run; safe to call repeatedly.
 */
export async function initSchema(): Promise<void> {
  await withSession(async (session) => {
    for (const statement of INDEX_STATEMENTS) {
      await session.run(statement);
    }
  });
}
