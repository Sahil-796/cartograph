/**
 * The rejection vocabulary. Every guardrail failure is a *designed* state
 * — a human-readable, machine-tagged `IngestRejected`, never a leaked
 * stack trace. The API unit maps `reason` to an HTTP status and shows
 * `detail` to the user verbatim, so keep `detail` copy human.
 */

export type RejectionReason =
  | "invalid_url"
  | "not_found"
  | "too_large"
  | "unsupported_language"
  | "too_many_files";

/**
 * A guardrail rejection. Distinct from a plain `Error` (which signals an
 * *unexpected* failure) so callers can `instanceof IngestRejected` to tell
 * "this repo isn't allowed, tell the user why" from "something broke".
 */
export class IngestRejected extends Error {
  readonly reason: RejectionReason;
  readonly detail: string;

  constructor(reason: RejectionReason, detail: string) {
    super(detail);
    this.name = "IngestRejected";
    this.reason = reason;
    this.detail = detail;
    // Restore the prototype chain for `instanceof` across the TS→ES2022
    // `extends Error` transpile.
    Object.setPrototypeOf(this, IngestRejected.prototype);
  }
}
