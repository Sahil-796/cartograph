import {
  whoTouched,
  busFactor,
  type WhoTouchedRow,
  type BusFactorRow,
} from "../../lib/queries";
import { getDemoRepo } from "../../data/repos";
import { useAsyncData } from "../panel/useAsyncData";
import { AsyncSection } from "../panel/AsyncSection";
import { relativeTime, pct, fileCount } from "../panel/format";
import "./people.css";

/**
 * The `/r/:repoId/people` full-page contributors view.
 *
 * Repo-wide ownership from `who_touched` at repo scope (path scope `""` — the
 * query's `f.path STARTS WITH ""` matches every file). Ranked by time-decayed
 * weight; each person is an evidence sentence, never a bare score. A repo-wide
 * `bus_factor` callout gives concentration context up top (flagged when the
 * truck factor is 1).
 */
export interface PeopleViewProps {
  /** The repo whose people/ownership to show. */
  repoId: string;
}

export default function PeopleView({ repoId }: PeopleViewProps) {
  const repo = getDemoRepo(repoId);

  const people = useAsyncData<WhoTouchedRow[]>(
    (signal) => whoTouched(repoId, "", {}, signal),
    [repoId],
    true,
    `people:${repoId}`,
  );
  const bus = useAsyncData<BusFactorRow[]>(
    (signal) => busFactor(repoId, "", {}, signal),
    [repoId],
    true,
    `repobus:${repoId}`,
  );

  return (
    <div className="people">
      <div className="people__inner">
        <header className="people__header">
          <div className="people__eyebrow">
            {repo?.name ?? repoId} · Contributors
          </div>
          <h1 className="people__title">Who owns this repo</h1>
          <p className="people__lead">
            Ranked by recent time-decayed contribution weight — recent, focused
            work counts more than old, sprawling commits. Bots excluded.
          </p>
        </header>

        {/* Repo-wide bus factor context. */}
        <section className="people__callout-wrap">
          <AsyncSection
            state={bus}
            isEmpty={(rows) =>
              rows.length === 0 || rows[0].contributors.length === 0
            }
            emptyTitle="No ownership signal"
            emptyHint="No attributable commits found for this repo."
            skeletonLines={2}
          >
            {(rows) => {
              const { busFactor: bf, contributors } = rows[0];
              const atRisk = bf <= 1;
              const top = contributors[0];
              return (
                <div
                  className={`people-callout${atRisk ? " people-callout--risk" : ""}`}
                >
                  <span className="people-callout__num">{bf}</span>
                  <div className="people-callout__text">
                    <div className="people-callout__head">
                      Repo bus factor {bf}
                      {atRisk ? " — single point of failure" : ""}
                    </div>
                    <p className="people-callout__body">
                      {atRisk && top ? (
                        <>
                          {top.name} alone accounts for {pct(top.share)} of the
                          repo's recent weighted work — losing them would orphan
                          half of it.
                        </>
                      ) : (
                        <>
                          It would take {bf} contributors leaving to orphan half
                          of the repo's recent work.
                        </>
                      )}
                    </p>
                  </div>
                </div>
              );
            }}
          </AsyncSection>
        </section>

        {/* Ranked contributors. */}
        <section className="people__list-wrap">
          <AsyncSection
            state={people}
            isEmpty={(rows) => rows.length === 0}
            emptyTitle="No contributors"
            emptyHint="No non-bot commits under 30 files were found for this repo."
            skeletonLines={6}
          >
            {(rows) => {
              const total = rows.reduce((sum, r) => sum + r.weight, 0) || 1;
              return (
                <ol className="people-list">
                  {rows.map((r, i) => {
                    const share = r.weight / total;
                    return (
                      <li key={r.email || r.name} className="people-row">
                        <span className="people-row__rank">{i + 1}</span>
                        <div className="people-row__main">
                          <div className="people-row__head">
                            <span className="people-row__name">{r.name}</span>
                            <span className="people-row__pct">{pct(share)}</span>
                          </div>
                          <div className="meter" aria-hidden="true">
                            <span
                              className="meter__fill"
                              style={{ width: `${Math.max(2, share * 100)}%` }}
                            />
                          </div>
                          <p className="people-row__sentence">
                            {pct(share)} of recent weighted changes across{" "}
                            {fileCount(r.files)}, last active{" "}
                            {relativeTime(r.lastTouch)}.
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              );
            }}
          </AsyncSection>
        </section>
      </div>
    </div>
  );
}
