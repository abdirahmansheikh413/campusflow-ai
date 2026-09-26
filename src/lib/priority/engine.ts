/**
 * The CampusFlow Priority Engine (v1).
 *
 * Pure arithmetic over data the learner entered. No model calls, no network,
 * no randomness — the same inputs always produce the same ranking, and every
 * point in the score can be traced to a fact the learner supplied.
 *
 * The central idea is SLACK, not deadline proximity.
 *
 *   A 5% quiz due tomorrow needing 20 minutes is not urgent — you have time.
 *   A 25% exam 10 days out needing 8 hours, at 1h/day, is ALREADY urgent —
 *   you needed to start two days ago.
 *
 * Ranking by due date cannot see that. Ranking by slack can, which is the
 * whole reason this product exists.
 *
 * v1 deliberately contains no mastery term. Mastery is an output of the
 * feedback loop, not an input to it — on day one there is no honest value for
 * it, and inventing one would put a fabricated number in front of the learner.
 * See `docs/priority-engine.md`.
 */

import type { PriorityFactor, ScoredWorkItem } from "./types";
import type { ScorableWorkItem } from "../domain/types";

const MS_PER_DAY = 86_400_000;

/**
 * How much of the time-fit bonus a task earns when it cannot be finished in
 * the available window. Low on purpose: "I have 30 minutes" should surface
 * something you can actually complete.
 */
const PARTIAL_FIT_DISCOUNT = 0.4;

export interface PriorityConfig {
  /** Points available for schedule pressure. The dominant term by design. */
  urgencyMax: number;
  /** Points available for how much of the grade rides on this. */
  weightMax: number;
  /** Points for work already past due. */
  overdueMax: number;
  /** Points for fitting the time the learner has right now. */
  timeFitMax: number;
  /** Points per level of the learner's own -2..2 override. */
  bumpPerLevel: number;

  /** Slack at or above this many days scores zero urgency. */
  slackHorizonDays: number;
  /** Grade weight at or above this percentage saturates the weight term. */
  weightSaturationPct: number;
  /** Days over which the overdue boost fades toward its floor. */
  overdueFadeDays: number;
  /** Fraction of overdueMax that never fades, so old work stays visible. */
  overdueFloorRatio: number;
  /** Below this many minutes, a sitting is not worth starting. */
  minUsefulChunkMinutes: number;
  /** Assumed daily study capacity when the learner has set no availability. */
  fallbackDailyCapacityMinutes: number;
}

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  urgencyMax: 40,
  weightMax: 25,
  overdueMax: 20,
  timeFitMax: 20,
  bumpPerLevel: 10,

  slackHorizonDays: 10,
  weightSaturationPct: 25,
  overdueFadeDays: 7,
  overdueFloorRatio: 0.25,
  minUsefulChunkMinutes: 15,
  fallbackDailyCapacityMinutes: 120,
};

export interface ScoringContext {
  /** Evaluation time. Injected so tests and replays are deterministic. */
  now: Date;
  /** Minutes the learner says they have right now. Null = not asked. */
  availableMinutes: number | null;
  /** Typical minutes of study per day, from their availability settings. */
  dailyCapacityMinutes: number;
  config?: PriorityConfig;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Minutes of work still outstanding, accounting for reported progress. */
export function remainingMinutes(estMinutes: number, completionPct: number): number {
  const remaining = estMinutes * (1 - clamp(completionPct, 0, 100) / 100);
  return Math.max(0, Math.round(remaining));
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatDays(days: number): string {
  const rounded = Math.round(days);
  if (rounded === 0) return "today";
  if (rounded === 1) return "tomorrow";
  if (rounded < 0) return `${Math.abs(rounded)} day${Math.abs(rounded) === 1 ? "" : "s"} ago`;
  return `in ${rounded} days`;
}

/**
 * Scores one work item, returning both the number and the reasoning.
 *
 * Every factor carries the raw values behind it, so the "Why this?" panel is
 * rendered from the same record that produced the ranking.
 */
export function scoreWorkItem(
  scorable: ScorableWorkItem,
  context: ScoringContext
): ScoredWorkItem {
  const config = context.config ?? DEFAULT_PRIORITY_CONFIG;
  const { item, course, componentWeightPct } = scorable;
  const factors: PriorityFactor[] = [];

  const required = remainingMinutes(item.estMinutes, item.completionPct);
  const capacity = Math.max(1, context.dailyCapacityMinutes || config.fallbackDailyCapacityMinutes);

  const daysUntilDue =
    item.dueAt === null ? null : (new Date(item.dueAt).getTime() - context.now.getTime()) / MS_PER_DAY;

  // Days of study this needs, at the learner's real pace.
  const daysOfWorkNeeded = required / capacity;

  // Slack: spare days between now and the point you must start.
  const slackDays = daysUntilDue === null ? null : daysUntilDue - daysOfWorkNeeded;

  // --- Urgency: schedule pressure ------------------------------------------
  if (slackDays !== null && daysUntilDue !== null && daysUntilDue >= 0) {
    const pressure = 1 - slackDays / config.slackHorizonDays;
    const points = clamp(pressure, 0, 1) * config.urgencyMax;
    if (points > 0) {
      const detail =
        slackDays <= 0
          ? `Needs ${formatDuration(required)}, due ${formatDays(daysUntilDue)} — less time than the work requires`
          : `Needs ${formatDuration(required)} at ${formatDuration(capacity)}/day, due ${formatDays(daysUntilDue)} — ${round1(slackDays)} days of slack`;
      factors.push({
        key: "urgency",
        label: slackDays <= 0 ? "Behind schedule" : "Deadline approaching",
        points: round1(points),
        detail,
      });
    }
  }

  // --- Overdue: past due, boosted but fading -------------------------------
  if (daysUntilDue !== null && daysUntilDue < 0) {
    const daysOverdue = -daysUntilDue;
    const fade = 1 - daysOverdue / config.overdueFadeDays;
    const multiplier = Math.max(config.overdueFloorRatio, fade);
    const points = multiplier * config.overdueMax;
    factors.push({
      key: "overdue",
      label: "Past due",
      points: round1(points),
      detail: `Was due ${formatDays(daysUntilDue)}`,
    });
    // Past-due work also carries full schedule pressure.
    factors.push({
      key: "urgency",
      label: "Behind schedule",
      points: config.urgencyMax,
      detail: `${formatDuration(required)} of work still outstanding`,
    });
  }

  // --- Weight: how much of the grade depends on it -------------------------
  if (componentWeightPct !== null && componentWeightPct > 0) {
    const saturation = clamp(componentWeightPct / config.weightSaturationPct, 0, 1);
    const points = saturation * config.weightMax;
    factors.push({
      key: "weight",
      label: "Counts for a lot",
      points: round1(points),
      detail: `${round1(componentWeightPct)}% of your ${course.code} grade`,
    });
  }

  // --- Time fit: can you actually do this right now? -----------------------
  if (context.availableMinutes !== null) {
    const available = context.availableMinutes;
    if (available < config.minUsefulChunkMinutes) {
      // Nothing fits a window this small; leave the term off entirely.
    } else if (required <= available) {
      factors.push({
        key: "timeFit",
        label: "Fits your window",
        points: config.timeFitMax,
        detail: `${formatDuration(required)} of work, ${formatDuration(available)} available`,
      });
    } else {
      // Partial progress is still progress, but finishing something in the
      // window you actually have should beat nibbling at something you can't.
      const ratio = clamp(available / required, 0, 1);
      const points = ratio * config.timeFitMax * PARTIAL_FIT_DISCOUNT;
      factors.push({
        key: "timeFit",
        label: "Partial progress possible",
        points: round1(points),
        detail: `${formatDuration(required)} of work, ${formatDuration(available)} available`,
      });
    }
  }

  // --- Learner override ----------------------------------------------------
  if (item.manualPriorityBump !== 0) {
    const points = item.manualPriorityBump * config.bumpPerLevel;
    factors.push({
      key: "manualBump",
      label: item.manualPriorityBump > 0 ? "You marked this important" : "You deprioritized this",
      points: round1(points),
      detail: "Your own adjustment",
    });
  }

  const score = round1(factors.reduce((sum, f) => sum + f.points, 0));

  return {
    item,
    course,
    score,
    factors,
    requiredMinutes: required,
    daysUntilDue: daysUntilDue === null ? null : round1(daysUntilDue),
    slackDays: slackDays === null ? null : round1(slackDays),
  };
}

/**
 * Ranks everything the learner could work on, most important first.
 *
 * Excluded: finished work, and anything extracted but not yet confirmed —
 * unconfirmed AI output must never silently shape the plan.
 */
export function rankWorkItems(
  scorables: ScorableWorkItem[],
  context: ScoringContext
): ScoredWorkItem[] {
  return scorables
    .filter((s) => s.item.status !== "done")
    .filter((s) => s.item.confirmedAt !== null)
    .map((s) => scoreWorkItem(s, context))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Deterministic tie-break: sooner deadline, then stable by id.
      const ad = a.daysUntilDue ?? Number.POSITIVE_INFINITY;
      const bd = b.daysUntilDue ?? Number.POSITIVE_INFINITY;
      if (ad !== bd) return ad - bd;
      return a.item.id.localeCompare(b.item.id);
    });
}

/**
 * The "Do This Next" pick: the single highest-scoring item.
 * Returns null when there is genuinely nothing to recommend.
 */
export function pickNext(
  scorables: ScorableWorkItem[],
  context: ScoringContext
): ScoredWorkItem | null {
  return rankWorkItems(scorables, context)[0] ?? null;
}

/**
 * "I have 30 minutes" — the best use of a specific window.
 *
 * Re-scores with the window applied, then proposes a session length that fits
 * both the window and the work remaining.
 */
export function pickForWindow(
  scorables: ScorableWorkItem[],
  context: Omit<ScoringContext, "availableMinutes">,
  windowMinutes: number
): { pick: ScoredWorkItem; suggestedMinutes: number } | null {
  const pick = pickNext(scorables, { ...context, availableMinutes: windowMinutes });
  if (!pick) return null;
  return {
    pick,
    suggestedMinutes: Math.max(1, Math.min(windowMinutes, pick.requiredMinutes)),
  };
}
