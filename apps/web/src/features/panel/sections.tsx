/**
 * The panel's content sections. Each is a self-contained async row: it owns
 * one `useAsyncData` fetch (abort/refetch on `path` change) and renders its
 * own loading / empty / error via <AsyncSection>. The product rule is upheld
 * throughout — every number is delivered inside an evidence sentence.
 */

import {
  whoTouched,
  coChanged,
  busFactor,
  type WhoTouchedRow,
  type CoChangedRow,
  type BusFactorRow,
} from "../../lib/queries";
import { fileCommits, testsForFile } from "./data";
import { useAsyncData } from "./useAsyncData";
import { AsyncSection } from "./AsyncSection";
import {
  relativeTime,
  pct,
  fileCount,
  basename,
  dirname,
  commitSubject,
  shortSha,
} from "./format";

interface SectionProps {
  repoId: string;
  /** The selected file node id (its path). */
  path: string;
}

/* ------------------------------------------------------------------ *
 * Owners — who_touched scoped to the single file's path
 * ------------------------------------------------------------------ */

export function OwnersSection({ repoId, path }: SectionProps) {
  const state = useAsyncData<WhoTouchedRow[]>(
    (signal) => whoTouched(repoId, path, {}, signal),
    [repoId, path],
    true,
    `owners:${repoId}:${path}`,
  );

  return (
    <section className="panel-section">
      <h3 className="panel-section__title">Owners</h3>
      <p className="panel-section__lead">
        Who actually maintains this file, by recent time-decayed change weight.
      </p>
      <AsyncSection
        state={state}
        isEmpty={(rows) => rows.length === 0}
        emptyTitle="No attributable owners"
        emptyHint="No non-bot commits under 30 files have touched this path recently."
      >
        {(rows) => {
          const total = rows.reduce((sum, r) => sum + r.weight, 0) || 1;
          return (
            <ul className="evidence-list">
              {rows.map((r) => {
                const share = r.weight / total;
                return (
                  <li key={r.email || r.name} className="evidence-row">
                    <div className="evidence-row__head">
                      <span className="evidence-row__name">{r.name}</span>
                      <span className="evidence-row__pct">{pct(share)}</span>
                    </div>
                    <div className="meter" aria-hidden="true">
                      <span
                        className="meter__fill"
                        style={{ width: `${Math.max(2, share * 100)}%` }}
                      />
                    </div>
                    <p className="evidence-row__sentence">
                      {pct(share)} of recent weighted changes
                      {r.files > 1 ? <> across {fileCount(r.files)}</> : null},
                      last touched {relativeTime(r.lastTouch)}.
                    </p>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </AsyncSection>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Tests — tests_for_file
 * ------------------------------------------------------------------ */

export function TestsSection({ repoId, path }: SectionProps) {
  const state = useAsyncData(
    (signal) => testsForFile(repoId, path, signal),
    [repoId, path],
    true,
    `tests:${repoId}:${path}`,
  );

  return (
    <section className="panel-section">
      <h3 className="panel-section__title">Tests</h3>
      <AsyncSection
        state={state}
        isEmpty={(rows) => rows.length === 0}
        emptyTitle="No tests import this file"
        emptyHint="Nothing in the graph exercises it directly — a change here has no test safety net. Consider adding coverage."
      >
        {(rows) => (
          <>
            <p className="panel-section__lead">
              Covered by {fileCount(rows.length)} that import it directly.
            </p>
            <ul className="path-list">
              {rows.map((t) => (
                <li key={t.path} className="path-list__item">
                  <span className="path-list__name">{basename(t.path)}</span>
                  {dirname(t.path) ? (
                    <span className="path-list__dir mono">{dirname(t.path)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </AsyncSection>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Co-change partners — co_changed (mapped to the "neighbors" tab)
 * ------------------------------------------------------------------ */

function strengthWords(strength: number): string {
  if (strength >= 0.5) return "almost always together";
  if (strength >= 0.3) return "frequently together";
  if (strength >= 0.15) return "often together";
  return "occasionally together";
}

export function CoChangeSection({ repoId, path }: SectionProps) {
  const state = useAsyncData<CoChangedRow[]>(
    (signal) => coChanged(repoId, path, 3, signal),
    [repoId, path],
    true,
    `cochange:${repoId}:${path}`,
  );

  return (
    <section className="panel-section">
      <h3 className="panel-section__title">Co-change partners</h3>
      <p className="panel-section__lead">
        Files that historically change in the same commits as this one — the
        hidden coupling to watch when you edit here.
      </p>
      <AsyncSection
        state={state}
        isEmpty={(rows) => rows.length === 0}
        emptyTitle="No frequent co-change partners"
        emptyHint="No other file has changed with this one in at least 3 shared commits."
      >
        {(rows) => (
          <ul className="evidence-list">
            {rows.map((r) => (
              <li key={r.path} className="evidence-row">
                <div className="evidence-row__head">
                  <span className="evidence-row__name">{basename(r.path)}</span>
                  <span className="evidence-row__pct">{pct(r.strength)}</span>
                </div>
                {dirname(r.path) ? (
                  <div className="path-list__dir mono">{dirname(r.path)}</div>
                ) : null}
                <p className="evidence-row__sentence">
                  Changed together in {r.count} commit{r.count === 1 ? "" : "s"}{" "}
                  ({strengthWords(r.strength)}).
                </p>
              </li>
            ))}
          </ul>
        )}
      </AsyncSection>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Bus factor — bus_factor scoped to the file (mapped to "coupling" tab)
 * ------------------------------------------------------------------ */

export function BusFactorSection({ repoId, path }: SectionProps) {
  const state = useAsyncData<BusFactorRow[]>(
    (signal) => busFactor(repoId, path, {}, signal),
    [repoId, path],
    true,
    `busfactor:${repoId}:${path}`,
  );

  return (
    <section className="panel-section">
      <h3 className="panel-section__title">Bus factor</h3>
      <p className="panel-section__lead">
        How concentrated this file's knowledge is — how many people would have
        to leave before half of it is orphaned.
      </p>
      <AsyncSection
        state={state}
        isEmpty={(rows) => rows.length === 0 || rows[0].contributors.length === 0}
        emptyTitle="No ownership signal"
        emptyHint="No attributable commits touch this file, so there's nothing to concentrate."
      >
        {(rows) => {
          const { busFactor: bf, contributors } = rows[0];
          const top = contributors[0];
          const atRisk = bf <= 1;
          return (
            <>
              <div className={`bus-badge${atRisk ? " bus-badge--risk" : ""}`}>
                <span className="bus-badge__num">{bf}</span>
                <span className="bus-badge__label">
                  bus factor{atRisk ? " — single point of failure" : ""}
                </span>
              </div>
              <p className="evidence-row__sentence">
                {atRisk && top ? (
                  <>
                    {top.name} alone accounts for {pct(top.share)} of this file's
                    recent weighted work — if they leave, half its knowledge goes
                    with them.
                  </>
                ) : (
                  <>
                    It would take {bf} contributors leaving to orphan half of
                    this file's recent work.
                  </>
                )}
              </p>
              <ul className="evidence-list">
                {contributors.slice(0, 6).map((c) => (
                  <li key={c.email || c.name} className="evidence-row">
                    <div className="evidence-row__head">
                      <span className="evidence-row__name">{c.name}</span>
                      <span className="evidence-row__pct">{pct(c.share)}</span>
                    </div>
                    <div className="meter" aria-hidden="true">
                      <span
                        className="meter__fill"
                        style={{ width: `${Math.max(2, c.share * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </AsyncSection>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Recent commits — file_commits (mapped to the "history" tab)
 * ------------------------------------------------------------------ */

export function HistorySection({ repoId, path }: SectionProps) {
  const state = useAsyncData(
    (signal) => fileCommits(repoId, path, 20, signal),
    [repoId, path],
    true,
    `history:${repoId}:${path}`,
  );

  return (
    <section className="panel-section">
      <h3 className="panel-section__title">Recent commits</h3>
      <p className="panel-section__lead">
        The latest commits that touched this file, newest first.
      </p>
      <AsyncSection
        state={state}
        isEmpty={(rows) => rows.length === 0}
        emptyTitle="No commit history"
        emptyHint="No commits (under 30 files) have touched this path."
      >
        {(rows) => (
          <ul className="commit-list">
            {rows.map((c) => (
              <li key={c.sha} className="commit-row">
                <p className="commit-row__subject">{commitSubject(c.message)}</p>
                <p className="commit-row__meta">
                  <span className="commit-row__author">{c.authorName}</span>
                  <span className="commit-row__dot">·</span>
                  <span>{relativeTime(c.committedAt)}</span>
                  <span className="commit-row__dot">·</span>
                  <span className="mono commit-row__sha">{shortSha(c.sha)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </AsyncSection>
    </section>
  );
}
