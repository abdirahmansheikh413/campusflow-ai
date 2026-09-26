/**
 * The CampusFlow learning graph, as plain types.
 *
 * Deliberately relational — these map 1:1 onto Postgres tables. Nothing here
 * needs a graph database; the "graph" is just foreign keys.
 */

export type WorkItemType =
  | "assignment"
  | "exam"
  | "quiz"
  | "project"
  | "reading"
  | "lab"
  | "other";

export type WorkItemStatus = "not_started" | "in_progress" | "done";

/** Where a work item came from. Extraction is not trusted until confirmed. */
export type WorkItemSource = "manual" | "syllabus_extraction" | "import";

export interface Semester {
  id: string;
  userId: string;
  name: string;
  startDate: string; // ISO date
  endDate: string; // ISO date
}

export interface Course {
  id: string;
  semesterId: string;
  code: string; // "FI 3300"
  title: string;
  colorToken: string; // index into the app palette, not a raw hex
}

/**
 * A weighted bucket from the syllabus: "Exams — 50%", "Homework — 20%".
 * This is the truth layer the Priority Engine leans on.
 */
export interface GradeComponent {
  id: string;
  courseId: string;
  name: string;
  weightPct: number; // 0..100
}

export interface WorkItem {
  id: string;
  courseId: string;
  componentId: string | null;
  type: WorkItemType;
  title: string;
  /** ISO timestamp. Null means "no deadline" — scored, but never urgent. */
  dueAt: string | null;
  /** Learner's estimate of total effort, in minutes. */
  estMinutes: number;
  status: WorkItemStatus;
  /** 0..100. Drives how much work is actually left. */
  completionPct: number;
  source: WorkItemSource;
  /**
   * Null means the learner has never confirmed this item.
   * Unconfirmed items must never enter a priority calculation.
   */
  confirmedAt: string | null;
  /** Learner override, -2..2. Their judgment beats the formula. */
  manualPriorityBump: number;
}

/** Minutes the learner expects to have, per weekday (0 = Sunday). */
export interface Availability {
  id: string;
  userId: string;
  weekday: number; // 0..6
  minutes: number;
}

export type SessionOutcome = "too_easy" | "good" | "difficult";

export interface StudySession {
  id: string;
  userId: string;
  workItemId: string;
  plannedMinutes: number;
  actualMinutes: number | null;
  startedAt: string;
  endedAt: string | null;
  outcome: SessionOutcome | null;
  scoreCorrect: number | null;
  scoreTotal: number | null;
  /** Free-text note from the learner at completion. */
  note: string | null;
}

/** What the learner did when shown a recommendation. */
export type RecommendationAction = "started" | "deferred" | "rejected" | "ignored";

export type RejectReason =
  | "not_enough_time"
  | "already_understand"
  | "too_tired"
  | "more_urgent_work"
  | "other";

/**
 * Every recommendation the engine makes is recorded before the learner acts.
 * `factors` stores the exact breakdown that produced `score`, so the "why"
 * panel renders what was actually decided rather than a later recomputation.
 */
export interface RecommendationRecord {
  id: string;
  userId: string;
  workItemId: string;
  score: number;
  factors: unknown; // PriorityFactor[] — jsonb at rest
  shownAt: string;
  action: RecommendationAction | null;
  rejectReason: RejectReason | null;
  resolvedAt: string | null;
}

/** A work item joined with the context the engine needs to score it. */
export interface ScorableWorkItem {
  item: WorkItem;
  course: Pick<Course, "id" | "code" | "title" | "colorToken">;
  /** Weight of the grade component this item belongs to, if known. */
  componentWeightPct: number | null;
}
