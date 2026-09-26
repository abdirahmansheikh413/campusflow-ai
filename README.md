# CampusFlow AI

**The adaptive execution layer for learning.**

Students do not lack information. They have YouTube, ChatGPT, NotebookLM,
textbooks, an LMS, and a calendar. What they lack is a clear answer to:

> **What should I do right now — and why?**

CampusFlow exists to answer that question, and to answer it better tomorrow
than it did today.

---

## What this is not

Not a chatbot, note-taking app, LMS, calendar, or flashcard generator. Those
markets have strong products and CampusFlow is designed to coexist with them.

| Tool | Job |
|---|---|
| NotebookLM | Understand my material |
| ChatGPT | Explain something to me |
| LMS | Show me my course |
| Calendar | Show me when things happen |
| Task manager | Show me what I entered |
| **CampusFlow** | **Understand my situation and help me execute** |

---

## The loop

```
UNDERSTAND → PRIORITIZE → RECOMMEND → ACT → MEASURE → ADAPT → repeat
```

The learner's courses, deadlines, grade weights and available time go in. A
ranked recommendation comes out, with its reasoning attached. The learner
does it (or refuses it, with a reason). What happened feeds back in.

---

## Status

**Early. Under active construction.**

| Component | State |
|---|---|
| Priority Engine | Implemented, 27 tests passing |
| Domain model | Defined |
| Database schema | Not yet written |
| UI | Not yet built |
| Auth / Supabase | Not yet wired |

Nothing here has been used by a learner yet. The first milestone is a real
semester in a real database, followed by a 14-day dogfood with one student's
actual courses.

---

## Design commitments

**Recommendations are explainable.** Every recommendation shows the factors that
produced it, with the numbers behind each one. There are no mysterious scores.

**The learner decides.** CampusFlow recommends; it never compels. Every
recommendation can be refused, and refusing it is useful data rather than a
failure state.

**Missing a session is normal.** Plans are recomputed, not enforced. The overdue
signal fades instead of accumulating guilt.

**AI output is never silently trusted.** Anything extracted from a syllabus must
be confirmed by the learner before it can influence the plan — enforced at the
data layer, not by UI convention.

**No invented numbers.** If there isn't enough data to say something honestly,
the UI says so rather than showing a confident-looking figure. See
[`docs/priority-engine.md`](docs/priority-engine.md) on why v1 has no mastery
score.

---

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # priority engine test suite
npm run typecheck
npm run lint
```

### Environment

Copy `.env.example` to `.env.local` and fill it in. Never commit `.env.local` —
`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security entirely.

---

## Documentation

- [`docs/priority-engine.md`](docs/priority-engine.md) — how ranking works and
  why it uses slack rather than deadlines
