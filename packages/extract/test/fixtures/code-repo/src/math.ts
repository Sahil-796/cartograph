export function add(a: number, b: number): number {
  return a + b;
}

// Arrow assigned to a top-level binding; also a same-file resolvable call.
export const double = (n: number): number => add(n, n);

// Not exported — exercises the exported/non-exported distinction.
function helper(): number {
  return 1;
}

export const VERSION = "1.0.0";

// Keep `helper` referenced so it isn't dead, but call it at module top level
// (no enclosing symbol) so the call is counted-but-unattributed.
helper();
