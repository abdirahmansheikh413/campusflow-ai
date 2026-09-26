import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRIORITY_CONFIG,
  pickForWindow,
  pickNext,
  rankWorkItems,
  remainingMinutes,
  scoreWorkItem,
  type ScoringContext,
} from "./engine";
import type { ScorableWorkItem, WorkItem } from "../domain/types";

const NOW = new Date("2026-10-01T09:00:00.000Z");
const MS_PER_DAY = 86_400_000;

/** A date `days` from NOW. Fractional days allowed. */
const inDays = (days: number) => new Date(NOW.getTime() + days * MS_PER_DAY).toISOString();

let idCounter = 0;

function makeItem(overrides: Partial<WorkItem> = {}): WorkItem {
  idCounter += 1;
  return {
    id: `item-${String(idCounter).padStart(3, "0")}`,
    courseId: "course-1",
    componentId: "comp-1",
    type: "assignment",
    title: "Untitled",
    dueAt: inDays(5),
    estMinutes: 60,
    status: "not_started",
    completionPct: 0,
    source: "manual",
    confirmedAt: NOW.toISOString(),
    manualPriorityBump: 0,
    ...overrides,
  };
}

function scorable(
  item: Partial<WorkItem>,
  componentWeightPct: number | null = 10,
  course = { id: "course-1", code: "FI 3300", title: "Corporate Finance", colorToken: "1" }
): ScorableWorkItem {
  return { item: makeItem(item), course, componentWeightPct };
}

const ctx = (overrides: Partial<ScoringContext> = {}): ScoringContext => ({
  now: NOW,
  availableMinutes: null,
  dailyCapacityMinutes: 60,
  ...overrides,
});

describe("remainingMinutes", () => {
  it("subtracts reported progress", () => {
    expect(remainingMinutes(120, 0)).toBe(120);
    expect(remainingMinutes(120, 50)).toBe(60);
    expect(remainingMinutes(120, 100)).toBe(0);
  });

  it("clamps nonsense completion values", () => {
    expect(remainingMinutes(120, -20)).toBe(120);
    expect(remainingMinutes(120, 250)).toBe(0);
  });
});

describe("slack-based urgency — the signature behavior", () => {
  // The whole reason the product exists: a big, heavily-weighted exam that is
  // still over a week away can matter more RIGHT NOW than a small quiz due
  // tomorrow, because there isn't enough time left to absorb the work.
  const bigExam = scorable(
    { title: "Exam 1", type: "exam", dueAt: inDays(10), estMinutes: 480 },
    25
  );
  const smallQuiz = scorable(
    { title: "Quiz 3", type: "quiz", dueAt: inDays(1), estMinutes: 20 },
    5
  );

  it("ranks the distant heavy exam above the imminent trivial quiz", () => {
    const ranked = rankWorkItems([smallQuiz, bigExam], ctx());
    expect(ranked[0].item.title).toBe("Exam 1");
    expect(ranked[1].item.title).toBe("Quiz 3");
  });

  it("would rank the other way on deadline alone", () => {
    // Guard against someone quietly reducing this to a due-date sort.
    const byDueDate = [smallQuiz, bigExam].sort(
      (a, b) => new Date(a.item.dueAt!).getTime() - new Date(b.item.dueAt!).getTime()
    );
    expect(byDueDate[0].item.title).toBe("Quiz 3");
  });

  it("reports negative slack when the work exceeds the time left", () => {
    // 8h of work, 10 days out, but only 1h/day available => needs 8 days.
    const scored = scoreWorkItem(bigExam, ctx({ dailyCapacityMinutes: 60 }));
    expect(scored.slackDays).toBeCloseTo(2, 1);

    // Same exam with only 30 min/day => 16 days of work, already behind.
    const squeezed = scoreWorkItem(bigExam, ctx({ dailyCapacityMinutes: 30 }));
    expect(squeezed.slackDays).toBeLessThan(0);
    expect(squeezed.score).toBeGreaterThan(scored.score);
  });

  it("gives more capacity more slack, and lowers the score", () => {
    const tight = scoreWorkItem(bigExam, ctx({ dailyCapacityMinutes: 60 }));
    const roomy = scoreWorkItem(bigExam, ctx({ dailyCapacityMinutes: 240 }));
    expect(roomy.slackDays!).toBeGreaterThan(tight.slackDays!);
    expect(roomy.score).toBeLessThan(tight.score);
  });

  it("scores zero urgency once slack exceeds the horizon", () => {
    const distant = scorable({ dueAt: inDays(60), estMinutes: 30 }, null);
    const scored = scoreWorkItem(distant, ctx());
    expect(scored.factors.find((f) => f.key === "urgency")).toBeUndefined();
    expect(scored.score).toBe(0);
  });
});

describe("progress reduces pressure", () => {
  it("lowers required minutes and score as completion rises", () => {
    const base = { title: "Project", dueAt: inDays(4), estMinutes: 300 };
    const fresh = scoreWorkItem(scorable({ ...base, completionPct: 0 }, 20), ctx());
    const mostlyDone = scoreWorkItem(scorable({ ...base, completionPct: 80 }, 20), ctx());

    expect(mostlyDone.requiredMinutes).toBe(60);
    expect(mostlyDone.requiredMinutes).toBeLessThan(fresh.requiredMinutes);
    expect(mostlyDone.score).toBeLessThan(fresh.score);
  });
});

describe("overdue work", () => {
  it("boosts recently missed work", () => {
    const missed = scoreWorkItem(scorable({ dueAt: inDays(-1), estMinutes: 60 }, 10), ctx());
    const overdue = missed.factors.find((f) => f.key === "overdue");
    expect(overdue).toBeDefined();
    expect(overdue!.points).toBeGreaterThan(DEFAULT_PRIORITY_CONFIG.overdueMax * 0.8);
  });

  it("fades the boost over time rather than escalating forever", () => {
    // "Recover from imperfect behavior instead of punishing it."
    const day1 = scoreWorkItem(scorable({ dueAt: inDays(-1) }, 10), ctx());
    const day5 = scoreWorkItem(scorable({ dueAt: inDays(-5) }, 10), ctx());
    const day30 = scoreWorkItem(scorable({ dueAt: inDays(-30) }, 10), ctx());

    const pts = (s: typeof day1) => s.factors.find((f) => f.key === "overdue")!.points;
    expect(pts(day5)).toBeLessThan(pts(day1));
    expect(pts(day30)).toBeLessThan(pts(day5));
  });

  it("keeps a floor so old work never disappears entirely", () => {
    const ancient = scoreWorkItem(scorable({ dueAt: inDays(-365) }, 10), ctx());
    const floor = DEFAULT_PRIORITY_CONFIG.overdueMax * DEFAULT_PRIORITY_CONFIG.overdueFloorRatio;
    expect(ancient.factors.find((f) => f.key === "overdue")!.points).toBeCloseTo(floor, 5);
  });
});

describe("grade weight", () => {
  it("scores heavier components higher", () => {
    const light = scoreWorkItem(scorable({ dueAt: inDays(5) }, 5), ctx());
    const heavy = scoreWorkItem(scorable({ dueAt: inDays(5) }, 30), ctx());
    expect(heavy.score).toBeGreaterThan(light.score);
  });

  it("saturates so one 60% component cannot swamp everything", () => {
    const at25 = scoreWorkItem(scorable({ dueAt: inDays(5) }, 25), ctx());
    const at60 = scoreWorkItem(scorable({ dueAt: inDays(5) }, 60), ctx());
    const weightOf = (s: typeof at25) => s.factors.find((f) => f.key === "weight")!.points;
    expect(weightOf(at60)).toBe(weightOf(at25));
    expect(weightOf(at60)).toBe(DEFAULT_PRIORITY_CONFIG.weightMax);
  });

  it("omits the term entirely when weight is unknown", () => {
    const unknown = scoreWorkItem(scorable({ dueAt: inDays(5) }, null), ctx());
    expect(unknown.factors.find((f) => f.key === "weight")).toBeUndefined();
  });
});

describe('"I have 30 minutes"', () => {
  const bigExam = scorable({ title: "Exam 1", dueAt: inDays(10), estMinutes: 480 }, 25);
  const smallQuiz = scorable({ title: "Quiz 3", dueAt: inDays(1), estMinutes: 20 }, 5);

  it("prefers work that actually fits the window", () => {
    // Without a window the exam wins; with 30 minutes, finishing the quiz wins.
    expect(pickNext([smallQuiz, bigExam], ctx())!.item.title).toBe("Exam 1");
    expect(pickNext([smallQuiz, bigExam], ctx({ availableMinutes: 30 }))!.item.title).toBe("Quiz 3");
  });

  it("suggests a session length that fits both the window and the work", () => {
    const short = pickForWindow([smallQuiz], { now: NOW, dailyCapacityMinutes: 60 }, 30);
    expect(short!.suggestedMinutes).toBe(20); // capped by work remaining

    const long = pickForWindow([bigExam], { now: NOW, dailyCapacityMinutes: 60 }, 45);
    expect(long!.suggestedMinutes).toBe(45); // capped by the window
  });

  it("ignores time fit when the window is too small to be useful", () => {
    const scored = scoreWorkItem(smallQuiz, ctx({ availableMinutes: 5 }));
    expect(scored.factors.find((f) => f.key === "timeFit")).toBeUndefined();
  });
});

describe("what never gets recommended", () => {
  it("excludes finished work", () => {
    const done = scorable({ title: "Done", status: "done", dueAt: inDays(-1) }, 25);
    const open = scorable({ title: "Open", dueAt: inDays(3) }, 10);
    const ranked = rankWorkItems([done, open], ctx());
    expect(ranked.map((r) => r.item.title)).toEqual(["Open"]);
  });

  it("excludes AI-extracted items the learner has not confirmed", () => {
    // Unconfirmed extraction must never silently shape the plan.
    const unconfirmed = scorable(
      { title: "Guessed exam", source: "syllabus_extraction", confirmedAt: null, dueAt: inDays(1) },
      30
    );
    const confirmed = scorable({ title: "Real work", dueAt: inDays(6) }, 10);
    const ranked = rankWorkItems([unconfirmed, confirmed], ctx());
    expect(ranked.map((r) => r.item.title)).toEqual(["Real work"]);
  });

  it("returns null when there is nothing to do", () => {
    expect(pickNext([], ctx())).toBeNull();
  });
});

describe("explainability", () => {
  it("always sums the factors to exactly the reported score", () => {
    const items = [
      scorable({ dueAt: inDays(2), estMinutes: 200, manualPriorityBump: 1 }, 30),
      scorable({ dueAt: inDays(-3), estMinutes: 45 }, 15),
      scorable({ dueAt: inDays(8), estMinutes: 600, completionPct: 25 }, 20),
      scorable({ dueAt: null, estMinutes: 60 }, 10),
    ];
    for (const s of rankWorkItems(items, ctx({ availableMinutes: 60 }))) {
      const sum = s.factors.reduce((total, f) => total + f.points, 0);
      expect(sum).toBeCloseTo(s.score, 5);
    }
  });

  it("gives every factor a detail string containing the numbers behind it", () => {
    const scored = scoreWorkItem(
      scorable({ dueAt: inDays(3), estMinutes: 180 }, 20),
      ctx({ availableMinutes: 60 })
    );
    expect(scored.factors.length).toBeGreaterThan(0);
    for (const f of scored.factors) {
      expect(f.detail.trim().length).toBeGreaterThan(0);
      expect(f.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("learner override", () => {
  it("lets the learner push an item up or down", () => {
    const neutral = scoreWorkItem(scorable({ dueAt: inDays(5) }, 10), ctx());
    const boosted = scoreWorkItem(scorable({ dueAt: inDays(5), manualPriorityBump: 2 }, 10), ctx());
    const buried = scoreWorkItem(scorable({ dueAt: inDays(5), manualPriorityBump: -2 }, 10), ctx());

    expect(boosted.score).toBeGreaterThan(neutral.score);
    expect(buried.score).toBeLessThan(neutral.score);
  });
});

describe("edge cases", () => {
  it("handles items with no deadline without crashing", () => {
    const scored = scoreWorkItem(scorable({ dueAt: null }, 10), ctx());
    expect(scored.daysUntilDue).toBeNull();
    expect(scored.slackDays).toBeNull();
    expect(Number.isFinite(scored.score)).toBe(true);
  });

  it("handles zero estimated effort", () => {
    const scored = scoreWorkItem(scorable({ dueAt: inDays(2), estMinutes: 0 }, 10), ctx());
    expect(scored.requiredMinutes).toBe(0);
    expect(Number.isFinite(scored.score)).toBe(true);
  });

  it("falls back to a sane capacity when availability is unset", () => {
    const scored = scoreWorkItem(
      scorable({ dueAt: inDays(3), estMinutes: 120 }, 10),
      ctx({ dailyCapacityMinutes: 0 })
    );
    expect(Number.isFinite(scored.score)).toBe(true);
    expect(scored.slackDays).not.toBeNull();
  });

  it("is deterministic and stable for identical scores", () => {
    const a = scorable({ id: "aaa", dueAt: inDays(4), estMinutes: 60 }, 10);
    const b = scorable({ id: "bbb", dueAt: inDays(4), estMinutes: 60 }, 10);
    const first = rankWorkItems([a, b], ctx()).map((r) => r.item.id);
    const second = rankWorkItems([b, a], ctx()).map((r) => r.item.id);
    expect(first).toEqual(second);
  });
});
