# Implementation Plan: British Accent Trainer

> **Gated workflow:** [SPECIFY](../specs/2026-09-13-british-accent-trainer-design.md) → PLAN (this file) → [TASKS](../todo.md) → implement.
> This document owns **how** the work is sequenced and **what could go wrong**.
> What we are building, the stack, and the engine constraints live in [the spec](../specs/2026-09-13-british-accent-trainer-design.md);
> individual task detail lives in [the task list](../todo.md). Do not duplicate them here.

---

> ## ⚠ Gate outcome — 2026-09-14
>
> **Task 1 ran and Azure `en-GB` failed it.** The critical risk in the table below
> materialised: the engine does not discriminate RP. Real recordings of *car* scored 64
> non-rhotic vs 65 rhotic; connected speech scores British and American readings
> identically on every phoneme.
>
> Phases 1–3 remain valid — they are vendor-agnostic by design, which is exactly why the
> `ScoringProvider` interface was introduced. What changed is **Task 8's scope**: the
> feedback UI cannot be driven by an `en-GB` score.
>
> **Final verdict, 2026-09-20.** The `en-US` inversion detector (Rung 5) was explored and
> **rejected**. Only 3 of 19 probed contexts detect, and rhoticity detection disappears in
> connected speech — the form every drill takes. The cause is structural: Azure's American
> phone inventory has no `ɒ`, no `əʊ`, and no `ɑː` distinct from `ɑ`, so RP and American
> renditions collapse onto the same symbol before anything reaches us.
>
> **The product is now a shadowing trainer**: native reference audio, the user's recording,
> and A/B comparison between them — none of which needs an accent-scoring API. Azure
> contributes the reference voice and a clarity score, honestly labelled.
>
> **Two resequencing consequences:**
> - **Task 10 (audio storage + replay) is promoted from Phase 3 to core** — A/B comparison
>   is the primary learning mechanism, not a retention feature.
> - **Task 8 becomes comparison UI, not scoring UI.**
>
> Full evidence: `spike/FINDINGS.md`.

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
                 Task 7  Reference TTS      Task 10  Attempt   Task 11  Progress
                    (the model to             audio in R2         trends
                     shadow) │                       │               │
                        ▼                            ▼               │
                 Task 8  COMPARISON UI ◄── needs BOTH ──┘            │
                    reference vs attempt, synced playback            │
                        │                                              │
                        └──────────────┬───────────────────────────────┘
                                       ▼
                             Task 12  PWA + a11y + cross-browser
```

---

## Phases

### Phase 0: Foundation and De-risking

- [x] Task 0: Repository, scaffold, and branch ✅
- [x] Task 1: **Scoring engine spike — the non-rhotic test** ✅ — **Azure failed the gate**

**Checkpoint: Engine Decision Gate** — ⚠ **RESOLVED: Azure `en-GB` rejected for RP scoring.** Determines which rung of the
[feedback ladder](../specs/2026-09-13-british-accent-trainer-design.md#feedback-ladder) the product lands on, and therefore the scope of
Task 8. Do not begin Phase 1 until resolved with a human.

### Phase 1: First Vertical Slice — record one drill and get a score

- [x] Task 2: D1 schema, drill seed data, and `GET /api/drills` ✅
- [x] Task 3: Browser audio capture → 16 kHz mono WAV ✅
- [x] Task 4: Scoring provider interface + Azure adapter ✅
- [x] Task 5: `POST /api/attempts` scoring endpoint ✅
- [x] Task 6: Drill screen — record, submit, see a score ✅

**Checkpoint: End-to-End Flow** — the loop works in a browser.

### Phase 2: Shadowing and Comparison

- [x] Task 7: Reference `en-GB` TTS with R2 caching ✅
- [x] Task 8: **Comparison UI** — reference vs attempt waveforms, synchronised playback (design: [spec](../specs/2026-09-13-british-accent-trainer-design.md#comparison-screen-task-8)) ✅
- [ ] Task 9: Local British IPA lexicon
- [x] Task 10: Attempt audio storage and replay **(core — A/B comparison depends on it)** ✅

**Checkpoint: Shadowing works** — the user can hear the reference, record, and compare the two. Feedback is honest about measuring clarity, not accent.

### Phase 3: Progress and Polish

- [x] Task 11: Progress history and trends ✅ (design: [spec](../specs/2026-09-13-british-accent-trainer-design.md#progress-screen-task-11))
- [ ] Task 12: PWA, accessibility, and cross-browser hardening — manifest, service worker, offline handling and skip link done ([spec](../specs/2026-09-13-british-accent-trainer-design.md#installable-and-offline-task-12)); install on a real phone and Chrome/Firefox/Safari microphone checks are manual and pending

**Checkpoint: Complete** — all [success criteria](../specs/2026-09-13-british-accent-trainer-design.md#success-criteria) met.

> Full checkpoint criteria are in [the task list](../todo.md) alongside the tasks they gate.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| ~~Azure scores correct RP non-rhotic /r/ as an error~~ | **MATERIALISED** | Confirmed 2026-09-14. Worse than predicted: it does not discriminate the feature at all. Mitigated by the provider interface; see gate outcome above |
| ~~Azure `en-GB` phone count does not match a British lexicon~~ | **MATERIALISED** | Confirmed: *car* = 3 phones vs 2 in RP. Rung 2 is dead |
| ~~Per-phoneme `Offset`/`Duration` absent at `en-GB`~~ | **Did not occur** | Timings are present and non-zero — though the scores they carry do not track RP |
| Vendor swap needed (Azure → alternative) | **Now likely** | `ScoringProvider` interface confines the change to one adapter. Evaluate candidates against the six probes in `spike/FINDINGS.md` before committing |
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
- **Task 8 depends on Task 10** — comparison UI needs stored audio to compare.

---

## Scope Note

Phases 0–2 constitute a genuinely useful MVP: pick a drill, hear a native RP model, record
yourself, and **play the two back against each other**. That is the whole shadowing loop,
and it is the product. Phase 3 adds trends and installability.

If the project needs trimming, **cut from Phase 3, not from Phase 2**. Task 10 in
particular is no longer optional — without stored attempt audio there is nothing to compare
the reference against, and the app degrades to a clarity scorer that cannot hear accent.

The spike was the cheapest task here and the one that could not be skipped: it cost two
days and prevented building an entire feedback UI on a signal that does not measure the
target accent.
