/**
 * The graded "watching a codebase turn into a graph" progress panel — an
 * ordered checklist of the real backend phases, lighting up the current one
 * and surfacing `counts` as they arrive.
 */

import { PHASE_STEPS, formatCount, phaseIndex } from "./phases";
import type { IngestCounts, IngestPhase } from "./types";

interface IngestStepperProps {
  phase: IngestPhase | null;
  counts?: IngestCounts;
  url: string;
}

export default function IngestStepper({ phase, counts, url }: IngestStepperProps) {
  const currentIdx = phaseIndex(phase);

  return (
    <div className="ingest-stepper">
      <div className="ingest-stepper__header">
        <span className="ingest-stepper__spinner" aria-hidden="true" />
        <div>
          <div className="ingest-stepper__title">Building the graph</div>
          <div className="ingest-stepper__url">{url}</div>
        </div>
      </div>

      <ol className="ingest-stepper__list">
        {PHASE_STEPS.map((step) => {
          const stepIdx = phaseIndex(step.phase);
          const state =
            stepIdx < currentIdx ? "done" : stepIdx === currentIdx ? "active" : "pending";
          const chips =
            state !== "pending" && step.countKeys
              ? step.countKeys
                  .filter((k) => counts?.[k] !== undefined)
                  .map((k) => formatCount(k, counts![k] as number))
              : [];

          return (
            <li key={step.phase} className={`ingest-step ingest-step--${state}`}>
              <span className="ingest-step__marker" aria-hidden="true">
                {state === "done" ? "✓" : state === "active" ? "" : ""}
              </span>
              <div className="ingest-step__body">
                <div className="ingest-step__label">{step.label}</div>
                <div className="ingest-step__detail">
                  {chips.length > 0 ? chips.join(" · ") : step.detail}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
