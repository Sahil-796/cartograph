import { add } from "./math.js"; // NodeNext .js -> .ts source in this repo
import { readFileSync } from "node:fs"; // bare/external — dropped from the model

export function run(): number {
  const x = add(1, 2); // resolves -> src/math.ts#add
  console.log(x); // member call — ambiguous, correctly skipped
  readFileSync("nope"); // imported-but-external identifier — no known symbol id
  unknownGlobal(); // bare identifier, neither imported nor a local symbol — skipped
  return x;
}
