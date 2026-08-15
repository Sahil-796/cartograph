/**
 * A shimmering placeholder block for loading states.
 *
 * Use one `<Skeleton>` per piece of content you're waiting on, sized to
 * roughly match what will replace it. `SkeletonText` stacks several lines.
 */

export interface SkeletonProps {
  /** CSS width (e.g. "100%", 120). Default "100%". */
  width?: number | string;
  /** CSS height (e.g. 16, "1.2em"). Default 16. */
  height?: number | string;
  /** Border radius override. */
  radius?: number | string;
  /** Extra class names. */
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({
  width = "100%",
  height = 16,
  radius,
  className,
  style,
}: SkeletonProps) {
  return (
    <span
      className={`cg-skeleton${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      style={{
        width,
        height,
        ...(radius !== undefined ? { borderRadius: radius } : null),
        ...style,
      }}
    />
  );
}

export interface SkeletonTextProps {
  /** Number of lines to render. Default 3. */
  lines?: number;
  /** Gap between lines. Default var(--space-2). */
  gap?: number | string;
}

/** A stack of skeleton lines; the last line is shortened for realism. */
export function SkeletonText({ lines = 3, gap = "var(--space-2)" }: SkeletonTextProps) {
  return (
    <span
      style={{ display: "flex", flexDirection: "column", gap }}
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} height={12} />
      ))}
    </span>
  );
}

export default Skeleton;
