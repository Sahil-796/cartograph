import { describe, expect, it } from "vitest";
import { parseGitHubUrl, deriveRepoId } from "../src/slug.js";

describe("parseGitHubUrl", () => {
  it("parses the canonical https URL", () => {
    expect(parseGitHubUrl("https://github.com/honojs/hono")).toEqual({
      owner: "honojs",
      repo: "hono",
      cloneUrl: "https://github.com/honojs/hono.git",
    });
  });

  it("strips a trailing .git", () => {
    expect(parseGitHubUrl("https://github.com/honojs/hono.git")?.repo).toBe("hono");
  });

  it("tolerates a trailing slash and extra path segments", () => {
    expect(parseGitHubUrl("https://github.com/honojs/hono/tree/main")).toMatchObject({
      owner: "honojs",
      repo: "hono",
    });
  });

  it("accepts a scheme-less URL", () => {
    expect(parseGitHubUrl("github.com/sindresorhus/is-odd")).toMatchObject({
      owner: "sindresorhus",
      repo: "is-odd",
    });
  });

  it("accepts www.github.com and http", () => {
    expect(parseGitHubUrl("http://www.github.com/a/b")).toMatchObject({ owner: "a", repo: "b" });
  });

  it("rejects non-github hosts", () => {
    expect(parseGitHubUrl("https://gitlab.com/a/b")).toBeNull();
  });

  it("rejects a URL without owner/repo", () => {
    expect(parseGitHubUrl("https://github.com/honojs")).toBeNull();
  });

  it("rejects SSH remotes and junk", () => {
    expect(parseGitHubUrl("git@github.com:honojs/hono.git")).toBeNull();
    expect(parseGitHubUrl("not a url")).toBeNull();
    expect(parseGitHubUrl("")).toBeNull();
  });
});

describe("deriveRepoId", () => {
  it("slugs owner/repo, lowercased with dashes", () => {
    expect(deriveRepoId("honojs", "hono")).toBe("honojs-hono");
    expect(deriveRepoId("drizzle-team", "drizzle-orm")).toBe("drizzle-team-drizzle-orm");
  });

  it("collapses non-alphanumeric runs and trims dashes", () => {
    expect(deriveRepoId("Foo.Bar", "baz_qux!!")).toBe("foo-bar-baz-qux");
  });

  it("never collides with the bare-name seed ids", () => {
    // Seeds are `hono`, `drizzle-orm`, `papermark`; derived ids carry the owner.
    expect(deriveRepoId("honojs", "hono")).not.toBe("hono");
    expect(deriveRepoId("drizzle-team", "drizzle-orm")).not.toBe("drizzle-orm");
  });
});
