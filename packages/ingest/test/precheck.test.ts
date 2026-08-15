import { describe, expect, it, vi } from "vitest";
import { precheckRepo } from "../src/precheck.js";
import { IngestRejected } from "../src/errors.js";

/** A minimal fake of the fetch Response shape precheck reads. */
function fakeResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => fakeResponse(status, body)) as unknown as typeof fetch;
}

const repoAbsent = async () => false;
const repoPresent = async () => true;

describe("precheckRepo guardrails", () => {
  it("rejects a non-GitHub URL as invalid_url before any fetch", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    await expect(
      precheckRepo("https://gitlab.com/a/b", { fetchFn, repoExistsFn: repoAbsent }),
    ).rejects.toMatchObject({ reason: "invalid_url" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps a 404 to not_found", async () => {
    await expect(
      precheckRepo("https://github.com/ghost/nope", {
        fetchFn: fetchReturning(404, {}),
        repoExistsFn: repoAbsent,
      }),
    ).rejects.toMatchObject({ reason: "not_found" });
  });

  it("rejects an over-size repo as too_large", async () => {
    const err = await precheckRepo("https://github.com/big/repo", {
      fetchFn: fetchReturning(200, { size: 184_320, language: "TypeScript" }),
      repoExistsFn: repoAbsent,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(IngestRejected);
    expect(err.reason).toBe("too_large");
    expect(err.detail).toContain("180 MB");
  });

  it("rejects a non-TS/JS repo as unsupported_language", async () => {
    await expect(
      precheckRepo("https://github.com/py/thon", {
        fetchFn: fetchReturning(200, { size: 1000, language: "Python" }),
        repoExistsFn: repoAbsent,
      }),
    ).rejects.toMatchObject({ reason: "unsupported_language" });
  });

  it("rejects a null-language repo as unsupported_language", async () => {
    await expect(
      precheckRepo("https://github.com/empty/repo", {
        fetchFn: fetchReturning(200, { size: 10, language: null }),
        repoExistsFn: repoAbsent,
      }),
    ).rejects.toMatchObject({ reason: "unsupported_language" });
  });

  it("accepts TypeScript and JavaScript (case-insensitive)", async () => {
    const ts = await precheckRepo("https://github.com/honojs/hono", {
      fetchFn: fetchReturning(200, { size: 20_000, language: "TypeScript" }),
      repoExistsFn: repoAbsent,
    });
    expect(ts).toMatchObject({
      owner: "honojs",
      repo: "hono",
      repoId: "honojs-hono",
      sizeKb: 20_000,
      language: "TypeScript",
      alreadyIngested: false,
    });

    const js = await precheckRepo("https://github.com/a/b", {
      fetchFn: fetchReturning(200, { size: 1, language: "javascript" }),
      repoExistsFn: repoAbsent,
    });
    expect(js.language).toBe("javascript");
  });

  it("reports alreadyIngested from the DB check", async () => {
    const res = await precheckRepo("https://github.com/honojs/hono", {
      fetchFn: fetchReturning(200, { size: 1, language: "TypeScript" }),
      repoExistsFn: repoPresent,
    });
    expect(res.alreadyIngested).toBe(true);
  });

  it("surfaces a non-404 API failure as a plain Error, not a rejection", async () => {
    const err = await precheckRepo("https://github.com/a/b", {
      fetchFn: fetchReturning(403, {}),
      repoExistsFn: repoAbsent,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(IngestRejected);
  });
});
