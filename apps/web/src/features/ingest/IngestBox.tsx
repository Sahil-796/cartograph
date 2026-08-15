/**
 * `IngestBox` — the lead element of the `/` picker: paste a GitHub URL,
 * watch it ingest with real phase names, land in `/r/:repoId`. Owns the
 * input + submit and switches between idle/progress/rejection views based
 * on `useIngest`'s status.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import IngestStepper from "./IngestStepper";
import { IngestErrorRejection, IngestQueueDownRejection, IngestReasonRejection } from "./IngestRejection";
import { useIngest } from "./useIngest";
import "./ingest.css";

const GITHUB_URL_HINT = "e.g. https://github.com/honojs/hono";

export default function IngestBox() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const { status, phase, counts, repoId, rejection, error, start, reset } = useIngest();

  const isBusy = status === "starting" || status === "polling";
  const isDone = status === "completed";

  useEffect(() => {
    if (isDone && repoId) {
      navigate(`/r/${repoId}`);
    }
  }, [isDone, repoId, navigate]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || isBusy) return;
    void start(trimmed);
  };

  const handleDismiss = () => {
    reset();
  };

  if (status === "polling" || status === "starting") {
    return (
      <div className="ingest-box">
        <IngestStepper
          phase={status === "starting" ? "queued" : phase}
          counts={counts}
          url={url.trim()}
        />
      </div>
    );
  }

  if (status === "rejected" && rejection) {
    return (
      <div className="ingest-box">
        <IngestReasonRejection reason={rejection.reason} message={rejection.message} onDismiss={handleDismiss} />
      </div>
    );
  }

  if (status === "queueDown") {
    return (
      <div className="ingest-box">
        <IngestQueueDownRejection message={error?.message ?? ""} onDismiss={handleDismiss} />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="ingest-box">
        <IngestErrorRejection message={error?.message ?? ""} onDismiss={handleDismiss} />
      </div>
    );
  }

  return (
    <div className="ingest-box">
      <form className="ingest-form" onSubmit={handleSubmit}>
        <label className="ingest-form__label" htmlFor="ingest-url">
          Ingest a GitHub repository
        </label>
        <div className="ingest-form__row">
          <input
            id="ingest-url"
            className="ingest-form__input"
            type="text"
            placeholder={GITHUB_URL_HINT}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="btn btn-primary" disabled={!url.trim()}>
            Build the graph
          </button>
        </div>
        <div className="ingest-form__hint">
          Paste any public GitHub repo URL — Cartograph will clone it, parse its symbols and
          history, and drop you into the map.
        </div>
      </form>
    </div>
  );
}
