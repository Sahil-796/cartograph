/**
 * Small pure formatting helpers shared by the panel's evidence sentences.
 * The product rule: never a bare number — every helper here turns a value
 * into words a reader can act on.
 */

/** Human "N ago" for an epoch-SECONDS timestamp. */
export function relativeTime(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return "unknown";
  const secs = Math.max(0, Date.now() / 1000 - epochSeconds);
  const mins = secs / 60;
  const hours = mins / 60;
  const days = hours / 24;
  const weeks = days / 7;
  const months = days / 30;
  const years = days / 365;

  if (mins < 1) return "just now";
  if (hours < 1) return plural(Math.round(mins), "minute");
  if (days < 1) return plural(Math.round(hours), "hour");
  if (days < 7) return plural(Math.round(days), "day");
  if (weeks < 5) return plural(Math.round(weeks), "week");
  if (months < 12) return plural(Math.round(months), "month");
  return plural(Math.round(years), "year");
}

function plural(n: number, unit: string): string {
  const v = Math.max(1, n);
  return `${v} ${unit}${v === 1 ? "" : "s"} ago`;
}

/** A whole-number percent from a 0..1 share (e.g. 0.581 -> "58%"). */
export function pct(share: number): string {
  if (!Number.isFinite(share)) return "0%";
  return `${Math.round(share * 100)}%`;
}

/** "3 files" / "1 file". */
export function fileCount(n: number): string {
  return `${n} file${n === 1 ? "" : "s"}`;
}

/** Last path segment (basename), tolerant of trailing slash. */
export function basename(path: string): string {
  const clean = path.replace(/\/+$/, "");
  const i = clean.lastIndexOf("/");
  return i === -1 ? clean : clean.slice(i + 1);
}

/** Directory portion of a path ("" when top-level). */
export function dirname(path: string): string {
  const clean = path.replace(/\/+$/, "");
  const i = clean.lastIndexOf("/");
  return i === -1 ? "" : clean.slice(0, i);
}

/** First line of a commit message, truncated to `max` chars. */
export function commitSubject(message: string, max = 72): string {
  const first = (message ?? "").split("\n", 1)[0].trim();
  if (first.length <= max) return first;
  return `${first.slice(0, max - 1).trimEnd()}…`;
}

/** Short 7-char sha. */
export function shortSha(sha: string): string {
  return (sha ?? "").slice(0, 7);
}
