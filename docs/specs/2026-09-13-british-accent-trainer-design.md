# Spec: British Accent Trainer

> **Gated workflow:** SPECIFY (this file) → [PLAN](../plans/2026-09-13-british-accent-trainer.md) → [TASKS](../todo.md) → implement.
> This document owns **what** we are building and **why**. [the plan](../plans/2026-09-13-british-accent-trainer.md) owns
> sequencing and risk. [the task list](../todo.md) owns individual tasks. Each fact lives in
> exactly one of the three — if you need to change one, change it at its source.

---

## Objective

A Progressive Web App for practising **Received Pronunciation (RP)**, installable on
desktop and mobile. It is built as a single-user tool: there are no accounts, and all
practice data stays with whoever runs the instance.

**The loop — shadowing:** the app shows a target sentence, plays a native `en-GB` reference,
and records the user reading it. The user then **plays the two back against each other** and
hears the difference themselves. Attempts are kept so progress is audible over weeks.

**Why shadowing rather than scoring.** The original design assumed an API could grade *how
British* a recording sounds. It cannot — measured, not assumed (`spike/FINDINGS.md`). Azure
`en-GB` scores British and American readings identically, and the `en-US` phone inventory
has no symbols for the RP vowels, so the contrast is destroyed before any result reaches
us. This is structural and applies to any feature we might try.

So the app does what accent coaching actually does: supply a good model, capture the
attempt, and make comparison easy and repeatable. The learner's ear does the judging —
which is the skill being trained in any case.

**What the scoring API is still good for:** a native reference voice (`en-GB` TTS), a
*clarity* measure that flags an unclear or misread word, and timings to locate it in the
sentence. Never an accent judgement.

**Non-goals:** multi-user accounts, teacher/classroom features, languages other than
British English, and live conversational feedback.

---

## Engine Capability Constraints (verified)

Confirmed against primary sources before planning. These bound what the product can
honestly promise. **Do not re-litigate them during implementation.**

### `en-GB` is supported for assessment — but phoneme *names* are `en-US` only

Two different questions with two different answers. Do not conflate them.

**`en-GB` is fully supported for pronunciation assessment.** It is one of the 33 supported
locales, and Microsoft's language support page directs you to it explicitly:

> "If you know your target learning language, set the locale accordingly. For example, if
> you're learning British English, you should specify the language as `en-GB`."

So `en-GB` yields Accuracy, Fluency, Completeness, and miscue assessment scored against
British English. That is the foundation of the app and it is sound.

**What `en-GB` does not yield is phoneme *names*.** The locale table on that page has no
capability columns — it is a flat list — so the authoritative source is the "Supported
features per locale" table in the pronunciation assessment how-to:

| Phoneme alphabet | IPA     | SAPI              |
| ---------------- | ------- | ----------------- |
| Phoneme name     | `en-US` | `en-US`, `zh-CN`  |
| Syllable group   | `en-US` | `en-US`           |
| Spoken phoneme   | `en-US` | `en-US`           |

> "For locales that support phoneme name, the phoneme name is provided together with the
> score. **For other locales, you can only get the phoneme score.**"

A Microsoft engineer further confirmed on Q&A that `en-GB` SAPI phone support was
withdrawn because the en-US phones had simply been copied for en-GB. Real `en-GB`
responses return `"Phoneme": ""` beside a populated `AccuracyScore`.

Also `en-US`-only, and therefore unavailable to us:

- **Prosody assessment** — syllable-stress metrics will not come from Azure.
- **Syllable groups.**
- **Spoken phonemes (`NBestPhonemes`)** — the most painful loss. This reports what the
  speaker *actually produced* versus what was expected (e.g. "produced `ə` where `ɛ` was
  expected; expected phoneme scored only 47"). For accent training that is the single most
  valuable output Azure produces, and `en-GB` does not provide it.

**Product consequence:** Azure scores each phoneme but will not say *which* phoneme it
scored. Symbol-level red/green highlighting therefore cannot come from the engine alone —
the symbols must come from our own lexicon.

### Cloudflare Workers is viable — via REST, not the Node SDK

`microsoft-cognitiveservices-speech-sdk` depends on Node APIs and long-lived WebSockets
and is not a safe bet on the Workers runtime. It is also unnecessary. The speech-to-text
**short audio REST endpoint** accepts a `Pronunciation-Assessment` header carrying
base64-encoded JSON:

```jsonc
{
  "ReferenceText": "Pass me a glass of water",
  "GradingSystem": "HundredMark",
  "Granularity": "Phoneme",
  "Dimension": "Comprehensive"
}
```

A plain `fetch()` POST with a WAV body — fully supported on Workers.

**Hard constraint:** the REST path caps assessment audio at **30 seconds**.

---

## Drill Difficulty

Drills progress the way elocution practice does — isolate the sound, contrast it against
its neighbour, then build up to flowing speech.

| Level | Form | Example |
| --- | --- | --- |
| 1 | Single word | *bath* |
| 2 | Minimal pair | *bath, bat* |
| 3 | Short phrase | *a glass of water* |
| 4 | Full sentence | *Ask the class about the bath* |
| 5 | Connected speech | *Ask for a glass of water after the dance class* |

Difficulty also tracks **how much the app can honestly say**. An isolated word gives the
engine the most acoustic evidence per sound; connected speech gives it the least — which is
exactly why the detector that worked on isolated *car* failed on *car* inside a sentence.
So the lower levels are both the gentler place to start and the levels where any feedback
is most trustworthy. Difficulty aligns with honesty, not just with effort.

From level 3 upward each item deliberately loads its target feature several times, so one
recording yields multiple attempts at the same contrast.

---

## Feedback Ladder

What the app promises the user, in descending order of richness. Because engine fitness is
unproven until the Engine Decision Gate, the product is specified to land on **whichever
rung survives** — this is a deliberate scope decision, not a hedge.

> **Resolved by the Engine Decision Gate on 2026-09-14.** Statuses below are measured, not
> projected. Evidence: `spike/FINDINGS.md`.

| Rung | Feedback capability | Status |
| --- | --- | --- |
| 1 | Phoneme names + scores straight from the engine | **Dead.** Names are `""` at `en-GB`. |
| 2 | Phoneme scores aligned **by index** to a local British IPA sequence | **Dead.** Azure segments *car* into 3 phones against an en-US inventory; RP has 2. The arrays cannot correspond. |
| 3 | Phoneme scores aligned **by time** (`Offset`/`Duration`) over the waveform | **Mechanically alive, semantically empty.** Timings are present, but the scores they would colour do not track RP — identical for British and American readings. |
| 4 | Word-level scores + target IPA shown from the lexicon as reference | **Alive**, and the only honest option on Azure — provided the UI never implies the score measures RP-ness. |

**The blocker is not feedback granularity — the underlying scores do not measure the target
accent.** Rungs 3 and 4 are presentation choices over a signal that is blind to RP.

### Rung 5 — per-feature detection — ❌ REJECTED 2026-09-20

> **Superseded.** The section below records the approach and why it was explored. It is
> **not viable on Azure** and must not be built. Probing 19 contexts found only *car*,
> *nurse* and *bath* detectable, all in isolation; rhoticity detection vanishes in
> connected speech, which is the form every drill takes.
>
> **Root cause is structural:** `NBestPhonemes` can only report phones in Azure's American
> inventory (`æ ɑ ɔ ɛ ə ɝ ɑɹ oʊ`). There is no `ɒ`, no `əʊ`, no `ɑː` distinct from `ɑ`. RP
> vowels lacking an American counterpart collapse onto the nearest one before we see them,
> so RP and American renditions are identical *by construction*. BATH is the single
> exception, because its RP vowel maps to `ɑ` while American uses `æ` — two symbols that
> both exist. No further probing will change this.
>
> Evidence: `spike/FINDINGS.md` UPDATE 3, `spike/results/features.json`.

#### Original rationale (retained for context)

Not in the original ladder. Instead of scoring *how British* an utterance is, **detect
specific features individually** and report each as a categorical result.

Mechanism: assess at `en-US` (which returns phoneme names and `NBestPhonemes`) and invert
the verdict — for *car*, Azure expecting `ɑɹ` but hearing bare `ɑ` means the speaker
correctly dropped the r. See `apps/api/src/spike/rhotic-detector.ts`.

| Probe | Expected | Heard | Verdict |
| --- | --- | --- | --- |
| *car*, non-rhotic | `ɑɹ` | `ɑ` | r dropped → correct RP ✅ |
| *car*, rhotic | `ɑɹ` | `ɑɹ` | r produced ✅ |
| *water*, non-rhotic | `ɚ` | `ɚ` | **false negative** ❌ |

**Final status: rejected.** 3 detectable contexts out of 19, none surviving connected
speech except *bath*. See the note above for the root cause.

---

## The design that replaces it — a shadowing trainer

Accent training is fundamentally a **shadowing loop**: hear a model, imitate it, compare
your attempt against the model, repeat. The comparison is made by the learner's ear. A
coach accelerates it; no coach makes it automatic.

Every part of that loop is available **without any accent-scoring API**:

| Need | Source | Risk |
| --- | --- | --- |
| Native RP model to imitate | Azure `en-GB` neural TTS | None — this works well |
| The learner's own recording | Browser capture → 16 kHz mono WAV | None |
| **A/B playback and waveform comparison** | Signal processing on two WAV files we own | None — no vendor involved |
| Knowing what to listen for | Drills that concentrate one feature, plus a coaching note | None |
| Progress over weeks | Stored attempts, replayable | None |

Azure's `en-GB` score rides along as a **secondary, honestly-labelled** signal: it measures
intelligibility ("this word was unclear"), never accent.

**Consequences for the plan:**

- **Task 10 (audio storage and replay) is promoted from Phase 3 to core.** A/B comparison
  against the reference is the primary learning mechanism, not a retention feature.
- **Task 8 becomes comparison UI, not scoring UI** — waveforms side by side, synchronised
  playback, the target IPA and coaching note, and the clarity score clearly captioned as
  clarity rather than accent.
- Nothing in Tasks 2–7 or 9–12 changes. They were vendor-agnostic by design, which is what
  makes this recoverable.

---

## Tech Stack

| Concern | Choice | Rationale |
| --- | --- | --- |
| Backend runtime | **Cloudflare Workers + Hono** (TypeScript) | Edge runtime with zero cold start. Hono keeps a small CRUD API small. |
| Scoring | **Pluggable `ScoringProvider` interface.** Azure REST is the first implementation — *confirmed pending the Engine Decision Gate* | The interface is the settled architectural commitment. The vendor is not yet settled; see Open Questions. |
| Azure integration | **REST** `Pronunciation-Assessment` header via `fetch()` | Node SDK is not Workers-safe; REST is. |
| Database | **Cloudflare D1** (SQLite) | Native to Workers; right size for a single-user application. |
| Audio storage | **Cloudflare R2** | Replay of past attempts. |
| Frontend | **React + Vite PWA** | Vite SPA over Next.js — the API already lives in the Worker. |
| UI components | **shadcn/ui + Tailwind** | Components are copied into the repo rather than installed, so they are editable and add no runtime dependency. Built on Radix primitives, which supply keyboard and ARIA behaviour that the accessibility requirements below depend on. |
| Data fetching | **TanStack Query** | Always wrapped in custom hooks, never called directly in components. |
| Audio capture | `MediaRecorder` → `AudioContext` decode → resample → **client-side WAV encoder** | Azure needs 16 kHz / 16-bit / mono PCM; browsers emit WebM/Opus. |
| Phoneme symbols | **Local British English lexicon** | Azure cannot supply `en-GB` phoneme names, so symbols must come from our own data. |
| Language | TypeScript strict, **no `any`** | Project standard. |
| Toolchain | **`bun`** | Project standard. |
| Python | **Excluded** | Rules out Montreal Forced Aligner, Kaldi, and FastAPI. |

---

## Commands

> **Status:** Task 0 is complete, so the API half of the next four sections is now
> *verified* — the commands below run, and `apps/api` exists as described. The `apps/web`
> half remains a **prescription**: the frontend workspace is deliberately not scaffolded
> until Task 3, since nothing before it touches the UI. Until then `bun run build` and
> `bun run test` cover `apps/api` only.

```bash
bun install                                   # Install workspace dependencies
bun run build                                 # Build both workspaces
bun run test                                  # Run all tests (both workspaces)
bun run lint                                  # Lint; --fix to autofix
bunx wrangler dev                             # Run the Worker API locally
bunx wrangler d1 migrations apply --local     # Apply D1 migrations locally
bunx wrangler deploy                          # Deploy the Worker
```

`bun run test` — **not** `bun test`. The API suite runs under vitest with the Workers
pool (see Testing Strategy); Bun's own runner will not provide a D1 binding.

---

## Project Structure

```
apps/api/                        → Cloudflare Worker (Hono) REST API
  src/index.ts                   → Worker entry, route mounting
  src/types.ts                   → Shared domain interfaces
  src/validation.ts              → Request validation (audio format, duration)
  src/routes/                    → drills, attempts, reference-audio, progress
  src/scoring/                   → provider.ts (interface) + azure.ts (adapter)
  src/lexicon/                   → lookup.ts, phone-map.ts
  src/tts/                       → azure.ts (en-GB neural TTS)
  src/storage/                   → r2.ts (attempt audio)
  migrations/                    → D1 SQL migrations
  test/                          → API tests
  test/fixtures/                 → Checked-in WAV + captured response JSON
  wrangler.jsonc                 → Bindings (D1, R2), secrets config

apps/web/                        → React + Vite PWA
  src/main.tsx                   → App entry
  src/audio/                     → recorder.ts, wav-encoder.ts
  src/screens/                   → DrillScreen, ProgressScreen
  src/hooks/                     → useDrills, useSubmitAttempt, useProgress
  src/api/queryKeys.ts           → Centralised query-key factory
  src/components/                → ReferencePlayer, PhonemeFeedback, Waveform
  src/components/ui/             → shadcn/ui components (copied in, editable, committed)
  src/scoring/align.ts           → Score ↔ IPA alignment
  test/                          → Component and unit tests
  public/manifest.json           → PWA manifest

spike/                           → Throwaway engine spike (Task 1). Not shipped.
scripts/                         → One-off tooling (lexicon import)
docs/plans/                      → YYYY-MM-DD-<slug>.md
docs/specs/                      → YYYY-MM-DD-<slug>-design.md
docs/todo.md                     → working task checklist (gitignored)
```

---

## Code Style

Google-style formatting, TSDoc on exported symbols, explicit interfaces at every
boundary, and no `any` — ever. A representative API route:

```ts
/** A single pronunciation drill the user practises against. */
export interface Drill {
  readonly id: string;
  readonly sentence: string;
  /** Target RP pronunciation in IPA, sourced from the local lexicon. */
  readonly targetIpa: string;
  /** The RP feature this drill trains, e.g. "non-rhotic-r". */
  readonly feature: RpFeature;
}

/**
 * Fetches a single drill by id.
 *
 * @param db - The D1 database binding.
 * @param id - The drill identifier.
 * @returns The drill, or `null` when no drill matches.
 */
export async function findDrill(db: D1Database, id: string): Promise<Drill | null> {
  const row = await db.prepare('SELECT * FROM drills WHERE id = ?').bind(id).first<Drill>();
  return row ?? null;
}
```

Frontend data access always goes through a custom hook with centralised keys, never
`useQuery` inline:

```ts
/** Loads all available drills. */
export function useDrills() {
  return useQuery({ queryKey: queryKeys.drills.all(), queryFn: fetchDrills });
}
```

---

## Testing Strategy

Tests are written immediately alongside the function they cover , not
deferred to a later task.

| Workspace | Runner | Notes |
| --- | --- | --- |
| `apps/api` |  **vitest 4.1.x + `@cloudflare/vitest-plugin`** | Runs tests inside the Workers runtime, which is what makes the D1 and R2 bindings available. Bun's own runner cannot provide them. Pin vitest to 4.1.x — the plugin does not support vitest 5. |
| `apps/web` | **vitest + DOM environment** | React component and unit tests. |

**Rules:**

- **Mock at the HTTP boundary.** The test suite must never call the live Azure API —
  it costs money and makes tests flaky.
- **Use checked-in fixtures.** A real WAV recording plus the response JSON captured during
  the Task 1 spike live in `apps/api/test/fixtures/` and back every scoring test.
- **Assert bytes, not vibes.** Audio tests parse the produced WAV header and assert sample
  rate, bit depth, and channel count — never "it sounds fine."
- **Cross-browser checks are manual** and explicitly listed per task: Chrome, Firefox, and
  Safari, with microphone capture the most likely point of divergence.

---

## Definition of Done

The standing bar every task clears, on top of its own acceptance criteria:

- Lint and type checks clean; no `any`
- Unit tests written and passing (`bun run test`)
- `bun run build` succeeds in both workspaces
- TSDoc on exported classes and functions
- Null/undefined handling on all public parameters

---

## Boundaries

**Always:**
- Branch before starting work
- Run `bun run test` and `bun run build` clean before calling a task done
- Define explicit interfaces for all API responses
- Implement `onSuccess` invalidation on every TanStack mutation

**Ask first:**
- Swapping the scoring vendor
- Adding a dependency
- Changing the D1 schema after it has data
- Changing CI configuration

**Never:**
- Commit the Azure key, or any secret — it belongs in `.dev.vars` (gitignored) and Worker secrets
- **Score** the user against `en-US` — that grades them for sounding American and inverts
  the entire purpose of the app. *(The `en-US` inversion detector was explored and
  rejected — see Rung 5. Do not revive it.)*
- Present an `en-GB` score as a measure of RP-ness — measured, it is not one
- Use CMUdict as the primary lexicon — it is American and rhotic, encoding the very
  pronunciations this app trains against
- Render a phoneme symbol the engine did not actually score
- Report a feature as wrong when the detector simply could not tell — non-detection is
  **unknown**, not a negative
- Use Python
- Add AI attribution to a commit — no co-author trailer, no tool name

---

## Success Criteria

Deliberately **rung-agnostic** — symbol-level highlighting is gated on the Engine Decision
Gate and is therefore not promised at project level.

- [ ] The user can open the app on an Android phone and desktop browser, installed as a PWA
- [ ] The user can select a drill and hear a native `en-GB` reference pronunciation
- [ ] The user can record themselves and get a **clarity** score within a few seconds,
      labelled so it cannot be mistaken for an accent judgement
- [ ] The recording is transmitted as valid 16 kHz / 16-bit / mono WAV, verified by
      byte-level assertion
- [ ] Each attempt is persisted and visible in history
- [ ] Score trends are viewable **per RP feature** (non-rhotic /r/, TRAP–BATH, LOT vowel) —
      not as a single meaningless global average
- [ ] The user can play their attempt back against the reference for comparison
- [ ] Feedback shows *where* in the sentence clarity dropped, captioned as clarity and
      never as an accent judgement
- [ ] Works in Chrome, Firefox, and Safari, including microphone capture
- [ ] No secrets in the repository; full suite and build clean

---

## Open Questions

1. **Scoring vendor** — deliberately open. Only the Engine Decision Gate can answer it; do
   not decide earlier. Azure is the first implementation behind the provider interface, but
   the accumulated `en-GB` losses (no phoneme names, no `NBestPhonemes`) are a live reason
   to price up Speechace rather than assume Azure wins.
2. **Drill content source** — hand-authored RP minimal-pair sentences to start, or import
   an existing dataset?
3. **Feedback granularity the user actually wants** — is "your third sound in *glass*
   scored 42" sufficient, or is "you said /æ/ where /ɑː/ was expected" the real
   requirement? If the latter, Speechace must be evaluated *alongside* Azure at the gate,
   not after it.

### Resolved — not open

- **Frontend framework: React + Vite.** Project standards cover *both* React and
  Vue + PrimeVue, so React is not in tension with it.
- **Azure resource and tier** — folded into Task 0's acceptance criteria, since the spike
  cannot run without a provisioned Speech resource and key. Confirm the F0 free tier covers
  expected usage when provisioning.
