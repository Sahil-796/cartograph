/**
 * Shared state components consumed by every feature. Import from here:
 *   import { Skeleton, EmptyState, ErrorBanner, NoResults } from "@/components/states";
 * (or via relative path). The side-effect CSS import wires their styles.
 */
import "./states.css";

export { Skeleton, SkeletonText } from "./Skeleton";
export type { SkeletonProps, SkeletonTextProps } from "./Skeleton";
export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";
export { ErrorBanner } from "./ErrorBanner";
export type { ErrorBannerProps } from "./ErrorBanner";
export { NoResults } from "./NoResults";
export type { NoResultsProps } from "./NoResults";
