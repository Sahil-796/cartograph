/**
 * Rejection / failure states for the ingest flow. Always offers the three
 * demo repos inline so a dead end becomes a redirect, not a wall — per the
 * unit brief ("Try one of these instead:").
 */

import { useNavigate } from "react-router-dom";
import { DEMO_REPOS } from "../../data/repos";
import type { RejectionReason } from "./types";

const REASON_TITLE: Record<RejectionReason, string> = {
  invalid_url: "That doesn't look like a GitHub URL",
  not_found: "Repository not found",
  too_large: "Repository is too large",
  unsupported_language: "Unsupported language",
  too_many_files: "Too many files",
};

const REASON_ICON: Record<RejectionReason, string> = {
  invalid_url: "?",
  not_found: "∅",
  too_large: "▣",
  unsupported_language: "λ",
  too_many_files: "☰",
};

interface IngestRejectionProps {
  title: string;
  message: string;
  icon: string;
  onDismiss: () => void;
}

function RejectionPanel({ title, message, icon, onDismiss }: IngestRejectionProps) {
  const navigate = useNavigate();

  return (
    <div className="ingest-rejection">
      <div className="ingest-rejection__icon" aria-hidden="true">
        {icon}
      </div>
      <div className="ingest-rejection__title">{title}</div>
      <p className="ingest-rejection__message">{message}</p>

      <div className="ingest-rejection__actions">
        <button type="button" className="btn btn-ghost" onClick={onDismiss}>
          Try another URL
        </button>
      </div>

      <div className="ingest-rejection__demos">
        <div className="ingest-rejection__demos-label">Try one of these instead:</div>
        <div className="ingest-rejection__demos-list">
          {DEMO_REPOS.map((repo) => (
            <button
              key={repo.id}
              type="button"
              className="ingest-rejection__demo"
              onClick={() => navigate(`/r/${repo.id}`)}
            >
              <span className="ingest-rejection__demo-name">{repo.name}</span>
              <span className="ingest-rejection__demo-blurb">{repo.blurb}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function IngestReasonRejection({
  reason,
  message,
  onDismiss,
}: {
  reason: RejectionReason;
  message: string;
  onDismiss: () => void;
}) {
  return (
    <RejectionPanel
      title={REASON_TITLE[reason]}
      message={message}
      icon={REASON_ICON[reason]}
      onDismiss={onDismiss}
    />
  );
}

export function IngestQueueDownRejection({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <RejectionPanel
      title="Ingestion queue unavailable"
      message={message || "The ingestion queue is unavailable right now. Please try again shortly."}
      icon="⏸"
      onDismiss={onDismiss}
    />
  );
}

export function IngestErrorRejection({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <RejectionPanel
      title="Something went wrong"
      message={message || "Ingestion failed unexpectedly. Please try again."}
      icon="!"
      onDismiss={onDismiss}
    />
  );
}
