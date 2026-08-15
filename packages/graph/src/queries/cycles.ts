import { z } from "zod";
import { defineQuery } from "./types.js";

/**
 * Import cycles: files reachable back to themselves via IMPORTS.
 * `map()` de-dupes rotations of the same cycle (e.g. [a,b,c,a] and
 * [b,c,a,b] are the same cycle) by normalising on the lexicographically
 * smallest rotation before de-duplicating.
 */

const paramsSchema = z.object({
  repoId: z.string(),
  limit: z.number().int().positive().default(50),
});

export type CyclesParams = z.infer<typeof paramsSchema>;

export interface CyclesRow {
  cycle: string[];
}

const cypher = `
MATCH p = (f:File {repoId: $repoId})-[:IMPORTS*2..6]->(f)
RETURN [n IN nodes(p) | n.path] AS cycle
LIMIT $limit
`;

export const cycles = defineQuery<CyclesParams, CyclesRow>({
  name: "cycles",
  description: "Import cycles: chains of files that import each other back into a loop.",
  // Cast: zod's Input type for a schema with `.default()` fields
  // (optional on input, required on output) doesn't unify with
  // `ZodType<Params>`'s Input===Output===Params constraint. The runtime
  // contract still holds — `CyclesParams` (the full, defaulted shape) is
  // always accepted by `paramsSchema.parse(...)`.
  params: paramsSchema as unknown as import("zod").ZodType<CyclesParams>,
  cypher,
  map: (records) => {
    const seen = new Set<string>();
    const rows: CyclesRow[] = [];
    for (const rec of records) {
      const cycle = rec.get("cycle") as string[];
      // Drop the repeated closing node (nodes(p) includes the start node
      // twice — once at each end) before normalising the rotation.
      const ring = cycle.slice(0, -1);
      const key = normalizedRotation(ring).join(">");
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ cycle });
    }
    return rows;
  },
});

/** The lexicographically smallest rotation of `ring`, used as a cycle's canonical key. */
function normalizedRotation(ring: string[]): string[] {
  let best = ring;
  for (let i = 1; i < ring.length; i++) {
    const rotated = [...ring.slice(i), ...ring.slice(0, i)];
    if (rotated.join(">") < best.join(">")) best = rotated;
  }
  return best;
}
