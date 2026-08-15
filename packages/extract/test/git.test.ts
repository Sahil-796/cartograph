import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractHistory } from "../src/git.js";

const execFileAsync = promisify(execFile);

const REPO_ID = "test-repo";

/**
 * Runs `git` against `cwd`, throwing on non-zero exit. Used only to build
 * the throwaway fixture repo below — never to touch the Cartograph repo
 * itself.
 */
async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

describe("extractHistory", () => {
  let repoDir: string;
  let firstSha = "";
  let secondSha = "";
  let botSha = "";

  beforeAll(async () => {
    // A throwaway git repo created solely for this test, inside the OS
    // temp dir — never the Cartograph repo's own history. Removed in
    // afterAll below.
    repoDir = await mkdtemp(join(tmpdir(), "cartograph-git-test-"));

    await git(repoDir, ["init", "-q", "-b", "main"]);
    await git(repoDir, ["config", "user.email", "alice@example.com"]);
    await git(repoDir, ["config", "user.name", "Alice Example"]);
    // Avoid GPG-signing / other machine-local config interfering with the test run.
    await git(repoDir, ["config", "commit.gpgsign", "false"]);

    // Commit 1: a tricky subject line containing characters that would
    // corrupt naive delimiter-based parsing (tabs, "=>", pipes).
    await mkdir(join(repoDir, "src"), { recursive: true });
    await writeFile(join(repoDir, "src", "foo.ts"), "line1\nline2\nline3\n");
    await git(repoDir, ["add", "."]);
    await git(repoDir, [
      "commit",
      "-q",
      "-m",
      "feat: handle a => b renames | and \"quotes\" plus 100% coverage",
    ]);
    const rev1 = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });
    firstSha = rev1.stdout.trim();

    // Commit 2: a different author, modifies foo.ts and adds bar.ts.
    await git(repoDir, ["config", "user.email", "bob@example.com"]);
    await git(repoDir, ["config", "user.name", "Bob Example"]);
    await writeFile(join(repoDir, "src", "foo.ts"), "line1\nline2\nline3\nline4\n");
    await writeFile(join(repoDir, "src", "bar.ts"), "hello\n");
    await git(repoDir, ["add", "."]);
    await git(repoDir, ["commit", "-q", "-m", "feat: add bar.ts and extend foo.ts"]);
    const rev2 = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });
    secondSha = rev2.stdout.trim();

    // Commit 3: a synthetic dependabot-style bot commit.
    await git(repoDir, ["config", "user.email", "support@dependabot.com"]);
    await git(repoDir, ["config", "user.name", "dependabot[bot]"]);
    await writeFile(join(repoDir, "package.json"), '{"name":"x"}\n');
    await git(repoDir, ["add", "."]);
    await git(repoDir, ["commit", "-q", "-m", "chore(deps): bump x from 1 to 2"]);
    const rev3 = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });
    botSha = rev3.stdout.trim();
  }, 30_000);

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("throws a clear error for a non-git directory", async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), "cartograph-nongit-test-"));
    try {
      await expect(extractHistory(nonGitDir, REPO_ID)).rejects.toThrow(/not a readable git repository/);
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });

  it("parses commits in log order (newest first) with full sha, ISO timestamp, and subject-only message", async () => {
    const { commits } = await extractHistory(repoDir, REPO_ID);

    expect(commits).toHaveLength(3);
    expect(commits.map((c) => c.sha)).toEqual([botSha, secondSha, firstSha]);

    for (const c of commits) {
      expect(c.repoId).toBe(REPO_ID);
      expect(c.sha).toMatch(/^[0-9a-f]{40}$/);
      // Strict ISO-8601 with an explicit offset (%aI), no embedded newline.
      expect(c.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
      expect(c.message).not.toContain("\n");
    }
  });

  it("keeps a tricky subject line (tabs/=>/quotes) intact via delimiter-safe parsing", async () => {
    const { commits } = await extractHistory(repoDir, REPO_ID);
    const first = commits.find((c) => c.sha === firstSha);
    expect(first?.message).toBe('feat: handle a => b renames | and "quotes" plus 100% coverage');
  });

  it("de-duplicates authors by normalised (trimmed, lowercased) email", async () => {
    const { authors } = await extractHistory(repoDir, REPO_ID);

    expect(authors).toHaveLength(3);
    const emails = authors.map((a) => a.email).sort();
    expect(emails).toEqual(["alice@example.com", "bob@example.com", "support@dependabot.com"]);
    for (const a of authors) {
      expect(a.email).toBe(a.email.toLowerCase());
      expect(a.repoId).toBe(REPO_ID);
    }
  });

  it("flags a synthetic dependabot[bot] identity as isBot, and human authors as not", async () => {
    const { authors } = await extractHistory(repoDir, REPO_ID);

    const bot = authors.find((a) => a.email === "support@dependabot.com");
    expect(bot?.isBot).toBe(true);
    expect(bot?.name).toBe("dependabot[bot]");

    const alice = authors.find((a) => a.email === "alice@example.com");
    expect(alice?.isBot).toBe(false);
  });

  it("joins commits to authors via authorEmail", async () => {
    const { commits } = await extractHistory(repoDir, REPO_ID);

    const first = commits.find((c) => c.sha === firstSha);
    const second = commits.find((c) => c.sha === secondSha);
    const bot = commits.find((c) => c.sha === botSha);

    expect(first?.authorEmail).toBe("alice@example.com");
    expect(second?.authorEmail).toBe("bob@example.com");
    expect(bot?.authorEmail).toBe("support@dependabot.com");
  });

  it("parses numstat additions/deletions per touched file", async () => {
    const { touched } = await extractHistory(repoDir, REPO_ID);

    const firstFoo = touched.find((t) => t.sha === firstSha && t.path === "src/foo.ts");
    expect(firstFoo).toMatchObject({ repoId: REPO_ID, additions: 3, deletions: 0 });

    const secondFoo = touched.find((t) => t.sha === secondSha && t.path === "src/foo.ts");
    expect(secondFoo).toMatchObject({ additions: 1, deletions: 0 });

    const secondBar = touched.find((t) => t.sha === secondSha && t.path === "src/bar.ts");
    expect(secondBar).toMatchObject({ additions: 1, deletions: 0 });
  });

  it("returns repo-relative posix paths", async () => {
    const { touched } = await extractHistory(repoDir, REPO_ID);
    for (const t of touched) {
      expect(t.path).not.toMatch(/^\//);
      expect(t.path).not.toContain("\\");
    }
  });
});

describe("extractHistory with a binary file", () => {
  let repoDir: string;

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "cartograph-git-binary-test-"));
    await git(repoDir, ["init", "-q", "-b", "main"]);
    await git(repoDir, ["config", "user.email", "carol@example.com"]);
    await git(repoDir, ["config", "user.name", "Carol Example"]);
    await git(repoDir, ["config", "commit.gpgsign", "false"]);

    // A file with a NUL byte forces git to treat it as binary, so
    // --numstat reports "-\t-\t<path>" instead of line counts.
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(join(repoDir, "logo.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    await git(repoDir, ["add", "."]);
    await git(repoDir, ["commit", "-q", "-m", "chore: add binary asset"]);
  }, 30_000);

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("records a TouchedEdge for a binary file with additions/deletions as 0", async () => {
    const { touched } = await extractHistory(repoDir, REPO_ID);
    expect(touched).toHaveLength(1);
    expect(touched[0]).toMatchObject({ path: "logo.bin", additions: 0, deletions: 0 });
  });
});
