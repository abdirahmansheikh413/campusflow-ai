import type { Course, WorkItem } from "../domain/types";

/** The terms the v1 engine can contribute. Mastery joins in v2. */
export type PriorityFactorKey =
  | "urgency"
  | "weight"
  | "overdue"
  | "timeFit"
  | "manualBump";

/**
 * One line of the "Why this?" panel.
 *
 * Stored verbatim alongside the recommendation, so the explanation shown to
 * the learner is the one that actually produced the ranking — not a later
 * recomputation against data that has since moved.
 */
export interface PriorityFactor {
  key: PriorityFactorKey;
  /** Short human label, e.g. "Behind schedule". */
  label: string;
  /** Signed contribution to the total score. */
  points: number;
  /** The raw numbers behind it, in a sentence the learner can check. */
  detail: string;
}

export interface ScoredWorkItem {
  item: WorkItem;
  course: Pick<Course, "id" | "code" | "title" | "colorToken">;
  score: number;
  factors: PriorityFactor[];
  /** Minutes of work left after accounting for reported completion. */
  requiredMinutes: number;
  /** Fractional days until due. Negative means overdue. Null = no deadline. */
  daysUntilDue: number | null;
  /** Spare days between now and the latest sane start. Negative = behind. */
  slackDays: number | null;
}
