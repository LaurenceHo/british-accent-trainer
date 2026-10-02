# Implementation Plan: British Accent Improver

> **Gated workflow:** [SPECIFY](../specs/2026-09-13-british-accent-improver-design.md) → PLAN (this file) → [TASKS](../todo.md) → implement.
> This document owns **how** the work is sequenced and **what could go wrong**.
> What we are building, the stack, and the engine constraints live in [the spec](../specs/2026-09-13-british-accent-improver-design.md);
> individual task detail lives in [the task list](../todo.md). Do not duplicate them here.

---

## Strategy

Almost everything in this project is conventional work: a small CRUD REST API, a record
button, some charts. Exactly one component can invalidate the entire design — the
**speech scoring engine**.

So the plan inverts the usual order and spikes the engine first, before any UI, schema, or
endpoint exists. If the engine turns out to be unfit for RP, that costs a day of throwaway
code rather than a restructure in week three.

Everything after the spike is **vertically sliced** — each task delivers a working path
through the whole system rather than a horizontal layer, so the app is demonstrable at
every checkpoint rather than only at the end.

---

## Dependency Graph

```
Task 0  Repo, scaffold, test harness, Azure key
   │
   └── Task 1  ENGINE SPIKE — the non-rhotic test
          │
          ▼
       ╔═══════════════════════════════╗
       ║  CHECKPOINT: Engine Decision  ║   ← blocks everything below
       ╚═══════════════════════════════╝
          │
          ├── Task 2  D1 schema + GET /api/drills ──┐
          │      │                                  │
          │      └── Task 9  British IPA lexicon    │
          │                                         │
          ├── Task 3  Audio capture → WAV ──────────┤
          │                                         │
          └── Task 4  Scoring provider + adapter ───┤
                                                    ▼
                                        Task 5  POST /api/attempts
                                                    │
                                                    ▼
                                        Task 6  Drill screen (E2E)
                                                    │
                        ┌───────────────────────────┼───────────────┐
                        ▼                           ▼               ▼
                 Task 7  Reference TTS      Task 10  Audio     Task 11  Progress
                        │                         replay            trends
                        ▼                                              │
                 Task 8  Feedback UI ◄── scope set by Task 1           │
                        │                                              │
                        └──────────────┬───────────────────────────────┘
                                       ▼
                             Task 12  PWA + a11y + cross-browser
```

---

## Phases

### Phase 0: Foundation and De-risking

- [ ] Task 0: Repository, scaffold, and branch
- [ ] Task 1: **Scoring engine spike — the non-rhotic test** *(highest risk, run first)*

**Checkpoint: Engine Decision Gate** — blocking. Determines which rung of the
[feedback ladder](../specs/2026-09-13-british-accent-improver-design.md#feedback-ladder) the product lands on, and therefore the scope of
Task 8. Do not begin Phase 1 until resolved with a human.

### Phase 1: First Vertical Slice — record one drill and get a score

- [ ] Task 2: D1 schema, drill seed data, and `GET /api/drills`
- [ ] Task 3: Browser audio capture → 16 kHz mono WAV
- [ ] Task 4: Scoring provider interface + Azure adapter
- [ ] Task 5: `POST /api/attempts` scoring endpoint
- [ ] Task 6: Drill screen — record, submit, see a score

**Checkpoint: End-to-End Flow** — the loop works in a browser.

### Phase 2: Meaningful Feedback

- [ ] Task 7: Reference `en-GB` TTS with R2 caching
- [ ] Task 8: Detailed pronunciation feedback UI (per surviving rung)
- [ ] Task 9: Local British IPA lexicon

**Checkpoint: Feedback Quality** — feedback is honest about what the engine measured.

### Phase 3: Progress and Polish

- [ ] Task 10: Attempt audio storage and replay
- [ ] Task 11: Progress history and trends
- [ ] Task 12: PWA, accessibility, and cross-browser hardening

**Checkpoint: Complete** — all [success criteria](../specs/2026-09-13-british-accent-improver-design.md#success-criteria) met.

> Full checkpoint criteria are in [the task list](../todo.md) alongside the tasks they gate.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **Azure scores correct RP non-rhotic /r/ as an error** | **Critical** — would make the engine unfit for the app's core purpose | Task 1 tests exactly this, A/B against a rhotic control, before any UI is built |
| Azure `en-GB` phone count does not match a British lexicon | High — kills rung 2 index alignment | Task 1 measures parity; product falls back to rung 3 (time alignment) |
| Per-phoneme `Offset`/`Duration` absent at `en-GB` | High — would kill rung 3 as well, collapsing Task 8 to rung 4 | Explicitly confirmed in Task 1 rather than assumed |
| Vendor swap needed (Azure → Speechace) | Medium | `ScoringProvider` interface in Task 4 confines the change to one adapter |
| Safari `MediaRecorder` format differences | Medium — CLAUDE.md requires Safari support | Acceptance criterion in Task 3; decode via `AudioContext` rather than trusting the container |
| Azure REST 30-second audio cap | Low | Enforced as request validation in Task 5 |
| Live API calls inside the test suite (cost, flakiness) | Medium | Checked-in WAV fixture + captured response JSON; mock at the HTTP boundary |
| Speechace RP claim is unverified | Medium | Originates from an AI-generated suggestion, not a primary source. Verify against Speechace docs or a trial key **before** committing to a swap |
| Lexicon source is not IPA-native | Low | BEEP ships ASCII phones, needing a mapping layer. Task 9 selects the source before writing code |

---

## Parallelisation

Mostly sequential, but once the Engine Decision Gate clears:

- **Tasks 2, 3, and 9 are independent** — schema/API, browser audio, and the lexicon share
  no files and can run concurrently.
- **Tasks 10 and 11 are independent** of each other, both depending only on Task 5.
- **Task 4 must wait for Task 1** — it needs the real response shape and the captured fixture.
- **Task 8 must wait for Task 1's *verdict*** on scope, not merely its completion.

---

## Scope Note

Phases 0–2 constitute a genuinely useful MVP: pick a drill, hear the reference, record,
get scored, see where it went wrong. Phase 3 is the retention layer — replay, trends, and
installability.

If the project needs trimming, **cut from Phase 3, not from Phase 0**. The spike is the
cheapest task here and the only one that cannot be skipped.
