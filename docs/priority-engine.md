# The Priority Engine

The engine answers one question: **what should I do right now, and why?**

It is pure arithmetic over data the learner entered. No model calls, no
network, no randomness. The same inputs always produce the same ranking, which
means it is fast, free, testable, and — most importantly — explainable.

Source: `src/lib/priority/engine.ts`. Tests: `engine.test.ts`.

---

## The core idea: slack, not deadlines

Every other planner ranks by due date. That is the thing it gets wrong.

> A 5% quiz due tomorrow needing 20 minutes is **not urgent** — there is plenty
> of time.
>
> A 25% exam ten days away needing 8 hours, when you study 1 hour a day, is
> **already urgent** — you needed to start two days ago.

A due-date sort puts the quiz first. It cannot see the exam coming, because the
exam does not look close yet. By the time it does, it is too late.

So the engine computes **slack**:

```
requiredMinutes   = estMinutes × (1 − completionPct/100)
daysOfWorkNeeded  = requiredMinutes / dailyCapacityMinutes
slackDays         = daysUntilDue − daysOfWorkNeeded
```

`slackDays ≤ 0` means there is less time left than the work requires. That is
the moment the learner needs to know about, and it usually arrives well before
the deadline feels close.

This single change is what makes the product something other than a task list.

---

## The terms

Each factor contributes points. The score is their sum — nothing hidden, no
normalization step that would make the total untraceable.

| Factor | Max | What it measures |
|---|---:|---|
| `urgency` | 40 | Schedule pressure, from slack. The dominant term. |
| `weight` | 25 | Share of the course grade riding on it. Saturates at 25%. |
| `overdue` | 20 | Past-due work. **Fades** over ~7 days to a 25% floor. |
| `timeFit` | 20 | Whether it fits the window the learner has right now. |
| `manualBump` | ±20 | The learner's own override. Their judgment beats the formula. |

### Why overdue fades

An overdue penalty that grows forever turns the product into the nagging task
manager it is meant to replace. Missing a session is normal; the system's job is
to **recompute**, not to accumulate guilt. The boost decays to a floor so old
work stays visible without dominating.

### Why weight saturates

Without saturation, a single 60%-weighted final would outrank everything else
all semester, including work due tomorrow. Saturating at 25% keeps weight
meaningful without letting it swamp schedule pressure.

### Why time fit discounts partial work

With `PARTIAL_FIT_DISCOUNT = 0.4`, a task you can *finish* in the window beats
one you can only nibble at. This is what makes "I have 30 minutes" return
something satisfying rather than 30 minutes of a 12-hour project.

---

## What is deliberately absent

**There is no mastery term in v1.**

The obvious design shows `Current mastery: 61%` in the "why" panel. On day one
that number cannot exist — a learner who just entered their courses has no
sessions, no scores, no self-ratings. Any figure shown then is invented.

Mastery is an **output** of the feedback loop, not an input to it. It becomes
real only after roughly 2–3 weeks of completed sessions.

So v1 uses only facts the learner supplied: due dates, grade weights, effort
estimates, reported progress, declared availability. Every line of the "why"
panel is checkable against something they typed.

Mastery joins in v2, gated behind a minimum number of sessions per topic, and
labelled in the UI as an **inference** rather than a measurement. Until that
threshold is met the UI says *"not enough data yet"* — never a number.

---

## Trust categories

The "why" panel must not blur these:

| Category | Example | v1 status |
|---|---|---|
| Source fact | "Exam is October 12" | Used |
| Learner input | "This takes me about 3 hours" | Used |
| Derived value | "You have 2 days of slack" | Used, arithmetic is shown |
| AI inference | "You seem weak on annuities" | **Not in v1** |
| AI recommendation | "Review annuities tonight" | Only as the ranked pick |

---

## Tuning

`DEFAULT_PRIORITY_CONFIG` holds every constant. Changing behavior means
changing numbers there, not logic scattered through the codebase — and the test
suite asserts behavior (orderings, fades, saturation), not magic totals, so
retuning does not require rewriting tests.

---

## What the tests guarantee

- The heavy distant exam outranks the trivial imminent quiz, and a due-date
  sort would get it backwards. (Guards the core premise.)
- Overdue boosts fade rather than escalate, and never vanish.
- Weight saturates.
- Progress lowers pressure.
- A 30-minute window prefers work that fits in 30 minutes.
- Finished work and **unconfirmed AI extractions** are never recommended.
- Factors always sum to exactly the reported score.
- Scoring is deterministic and stable under reordering.

Run them with `npm test`.
