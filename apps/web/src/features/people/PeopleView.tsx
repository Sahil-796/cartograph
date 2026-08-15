import { EmptyState } from "../../components/states";

/**
 * STUB — to be implemented in Wave 2 (people feature agent).
 *
 * Contract this stub locks in:
 *   - default export named `PeopleView`
 *   - props: `{ repoId: string }`
 *   - renders the people/ownership view for a repo (who_touched / bus_factor
 *     across scopes). Rendered by the `/r/:repoId/people` route.
 */
export interface PeopleViewProps {
  /** The repo whose people/ownership to show. */
  repoId: string;
}

export default function PeopleView({ repoId }: PeopleViewProps) {
  return (
    <div style={{ padding: "var(--space-6)", height: "100%" }}>
      <EmptyState
        icon="👥"
        title="People coming soon"
        description={`Ownership, bus factor, and contribution history for "${repoId}" will render here.`}
      />
    </div>
  );
}
