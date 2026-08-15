import { useNavigate } from "react-router-dom";
import { DEMO_REPOS } from "../data/repos";
import IngestBox from "../features/ingest/IngestBox";

/**
 * The `/` route: the repo picker. Leads with the paste-a-URL ingestion box
 * (Phase 6), then falls back to the app's original empty state — three
 * pinned demo seed repos as cards, each navigating into the RepoView at
 * `/r/:repoId`.
 */
export default function RepoPicker() {
  const navigate = useNavigate();

  return (
    <div className="picker">
      <header className="landing-nav">
        <div className="landing-nav__brand">
          <span className="landing-nav__mark" aria-hidden="true">◆</span>
          <span>Cartograph</span>
        </div>
        <span className="landing-nav__status"><i /> Graph intelligence for codebases</span>
      </header>

      <main>
        <section className="picker__hero" aria-labelledby="landing-title">
          <div className="picker__hero-copy">
            <p className="picker__eyebrow">Your codebase, made legible</p>
            <h1 id="landing-title" className="picker__title">
              See how your code<br />
              <em>actually connects.</em>
            </h1>
            <p className="picker__lede">
              Cartograph turns a repository into an explorable map of files,
              symbols, history and the people behind it — then lets you ask
              focused questions of the whole system.
            </p>
            <IngestBox />
            <p className="picker__trust">
              <span aria-hidden="true">↗</span> Public GitHub repositories · analysis stays scoped to your repo
            </p>
          </div>

          <div className="picker__map-preview" aria-hidden="true">
            <div className="map-preview__bar">
              <span className="map-preview__signal" />
              <span>LIVE GRAPH</span>
              <span className="map-preview__count">1,247 NODES</span>
            </div>
            <svg viewBox="0 0 600 460" role="presentation">
              <g className="map-preview__lines">
                <path d="M105 290L206 220L316 275L430 175L510 235" />
                <path d="M105 290L182 354L316 275L402 358L510 235" />
                <path d="M206 220L250 124L430 175L500 85" />
                <path d="M250 124L336 78L430 175" />
                <path d="M182 354L280 402L402 358" />
              </g>
              <g className="map-preview__minor-lines">
                <path d="M62 190L105 290L206 220" />
                <path d="M316 275L360 216L430 175" />
                <path d="M402 358L466 391L510 235" />
              </g>
              <g className="map-preview__node map-preview__node--large">
                <circle cx="316" cy="275" r="27" />
                <circle cx="316" cy="275" r="10" />
              </g>
              <g className="map-preview__node map-preview__node--primary">
                <circle cx="206" cy="220" r="18" />
                <circle cx="206" cy="220" r="6" />
              </g>
              <g className="map-preview__node map-preview__node--primary">
                <circle cx="430" cy="175" r="18" />
                <circle cx="430" cy="175" r="6" />
              </g>
              <g className="map-preview__node">
                <circle cx="105" cy="290" r="12" /><circle cx="182" cy="354" r="12" />
                <circle cx="402" cy="358" r="12" /><circle cx="510" cy="235" r="12" />
                <circle cx="250" cy="124" r="12" /><circle cx="336" cy="78" r="12" />
              </g>
              <g className="map-preview__node map-preview__node--quiet">
                <circle cx="62" cy="190" r="8" /><circle cx="360" cy="216" r="8" />
                <circle cx="466" cy="391" r="8" /><circle cx="500" cy="85" r="8" />
                <circle cx="280" cy="402" r="8" />
              </g>
            </svg>
            <div className="map-preview__label map-preview__label--one"><b>src/router.ts</b><span>high coupling</span></div>
            <div className="map-preview__label map-preview__label--two"><b>parseAst()</b><span>127 callers</span></div>
            <div className="map-preview__legend"><span><i /> symbols</span><span><i /> files</span><span><i /> commits</span></div>
          </div>
        </section>

        <section className="picker__how" aria-label="How Cartograph works">
          <p>Map the ground truth</p>
          <div>
            <span><b>01</b> Paste a repository</span>
            <span><b>02</b> Build the graph</span>
            <span><b>03</b> Follow the evidence</span>
          </div>
        </section>

        <section className="picker__demos" aria-labelledby="demo-title">
          <div className="picker__section-heading">
            <div>
              <p className="picker__eyebrow">Start exploring</p>
              <h2 id="demo-title">Take a guided walk through a real codebase.</h2>
            </div>
            <p>Each map is pre-built and ready to inspect.</p>
          </div>
          <div className="picker__grid">
            {DEMO_REPOS.map((repo, index) => (
              <button
                key={repo.id}
                type="button"
                className="card repo-card"
                onClick={() => navigate(`/r/${repo.id}`)}
              >
                <span className="repo-card__index">0{index + 1}</span>
                <div className="repo-card__name">{repo.name}</div>
                <div className="repo-card__blurb">{repo.blurb}</div>
                <div className="repo-card__stats">
                  <span>{repo.files.toLocaleString()} files</span>
                  <span>{repo.symbols.toLocaleString()} symbols</span>
                </div>
                <span className="repo-card__cta">Open the map <b>→</b></span>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
