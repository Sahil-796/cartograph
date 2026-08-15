import { useNavigate } from "react-router-dom";
import { DEMO_REPOS } from "../data/repos";

/**
 * The `/` route: the repo picker. This IS the app's empty state (per the
 * plan) — three pinned demo seed repos as cards, each navigating into the
 * RepoView at `/r/:repoId`.
 */
export default function RepoPicker() {
  const navigate = useNavigate();

  return (
    <div className="picker">
      <div className="picker__eyebrow">CARTOGRAPH</div>
      <h1 className="picker__title">Pick a repository to explore</h1>
      <p className="picker__lede">
        Cartograph turns a repo into a graph of files, symbols, commits and
        authors — then lets you ask it questions. Start with one of the three
        pinned demo repositories below.
      </p>

      <div className="picker__grid">
        {DEMO_REPOS.map((repo) => (
          <button
            key={repo.id}
            type="button"
            className="card repo-card"
            onClick={() => navigate(`/r/${repo.id}`)}
          >
            <div className="repo-card__name">{repo.name}</div>
            <div className="repo-card__blurb">{repo.blurb}</div>
            <div className="repo-card__stats">
              <span>{repo.files.toLocaleString()} files</span>
              <span>{repo.symbols.toLocaleString()} symbols</span>
            </div>
            <span className="repo-card__cta">Open map →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
