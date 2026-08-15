/**
 * The three pinned demo repos, hardcoded to drive the `/` picker (the app's
 * empty state per the plan). Their `id` values are the exact repoId strings
 * loaded by the seed loader (`packages/graph/src/scripts/db-seed.ts`, reading
 * `seed/*.json`) — they are what every query's `repoId` param must be.
 */

export interface DemoRepo {
  /** Exact repoId param value used by every query. */
  id: string;
  /** Human-facing display name. */
  name: string;
  /** One-line description for the picker card. */
  blurb: string;
  /** Rough shape of the graph, for the card's stat line. */
  files: number;
  symbols: number;
}

export const DEMO_REPOS: DemoRepo[] = [
  {
    id: "hono",
    name: "hono",
    blurb: "Small, fast web framework for the edge. The lean graph to start on.",
    files: 353,
    symbols: 834,
  },
  {
    id: "drizzle-orm",
    name: "drizzle-orm",
    blurb: "TypeScript ORM with a dense symbol graph and deep call chains.",
    files: 943,
    symbols: 4216,
  },
  {
    id: "papermark",
    name: "papermark",
    blurb: "Full-stack document-sharing app — rich history and hidden coupling.",
    files: 1365,
    symbols: 3220,
  },
];

/** Look up a demo repo by its id (used to label the RepoView header). */
export function getDemoRepo(id: string | undefined): DemoRepo | undefined {
  return DEMO_REPOS.find((r) => r.id === id);
}
