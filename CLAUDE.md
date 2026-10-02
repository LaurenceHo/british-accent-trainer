# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

A Progressive Web App for practising Received Pronunciation (RP). A user reads a target
sentence, records their voice, and receives phoneme-level pronunciation scoring against an
`en-GB` reference, with progress tracked per RP feature over time.

TypeScript throughout: a Hono REST API on Cloudflare Workers, a React + Vite PWA frontend.

## Commands

```bash
bun install                                   # Install workspace dependencies
bun run build                                 # Build/typecheck all workspaces
bun run test                                  # Run all tests
bun run lint                                  # ESLint (--fix to autofix)
bun run dev                                   # Run the Worker API locally

# Workspace-scoped (args do NOT pass through the root script cleanly)
bun run --filter api test                     # API tests only
bun run --filter api test -- path/to.test.ts  # A single test file

cd apps/api && bunx wrangler dev              # Worker with local D1/R2 simulation
cd apps/api && bun run db:migrate             # Apply D1 migrations locally
```

Always `bun`, never `npm`/`yarn`/`pnpm`.

## Architecture

```
apps/api/          Hono REST API on Cloudflare Workers
  src/routes/      HTTP handlers (drills, attempts, progress, reference-audio)
  src/scoring/     provider.ts (interface) + azure.ts (adapter)
  src/lexicon/     British IPA lookup + phone-set mapping
  migrations/      D1 SQL — schema only, never seed data
  test/fixtures/   Checked-in WAV + captured API response JSON
apps/web/          React + Vite PWA (added at Task 3; absent before then)
content/           Drill corpus as typed data, loaded by scripts/seed.ts
docs/plans/        YYYY-MM-DD-<slug>.md
docs/specs/        YYYY-MM-DD-<slug>-design.md
```

Storage: **D1** (SQLite) for drills and attempts, **R2** for audio. Both run under local
Miniflare simulation — no remote resources are provisioned.

## Critical domain constraint

Measured in `spike/FINDINGS.md`, with both synthetic and real speech. Read that before
touching scoring.

**1. Azure `en-GB` does not discriminate RP.** It returns phoneme *scores* with
`Offset`/`Duration`, but the `Phoneme` name is `""`. Syllable groups, prosody, and
`NBestPhonemes` are `en-US`-only. Worse, the scores do not track the target accent:

- Real recordings of *car* scored **64 non-rhotic vs 65 rhotic**; *water* **65 vs 67**.
  A deliberately rolled American r is indistinguishable from no r at all.
- In connected speech, British and American readings score **identically on every
  phoneme** — `glass` (/ɡlɑːs/ vs /ɡlæs/) scores 100 both ways.
- `car` returns **3 phonemes** where RP has 2, confirming an en-US phone inventory.

**Do not use an `en-GB` score as a measure of RP-ness, and never label it as one in the
UI.** It measures general intelligibility, which is a different question.

**2. Index-aligning scores to a British lexicon is impossible.** Azure's phone counts
follow the American inventory, so the arrays do not correspond. Use time alignment
(`Offset`/`Duration`) or word-level scores instead.

**3. The `en-US` rule, precisely.** Never **score** the user against `en-US` — that grades
them for sounding American and inverts the app's purpose.

> **Permitted exception:** using `en-US` as a **feature detector** with an inverted
> verdict. At `en-US` the API returns phoneme names and `NBestPhonemes` (the phones it
> actually heard). For *car* it expects `ɑɹ`; a correct RP speaker is reported as producing
> bare `ɑ` — so **hearing the non-rhotic variant means the user got RP right.** See
> `src/spike/rhotic-detector.ts`. No American score is ever shown to the user.
>
> Known limit: this works on wide contrasts (`ɑ` vs `ɑɹ` in *car*) and fails on narrow ones
> (`ə` vs `ɚ` in *water*, where both are heard as `ɚ`). Treat a non-detection as
> **unknown**, never as "rhotic".

**4. Other standing rules:**

- IPA symbols must come from the local British lexicon, never from the API response.
- **Never render a phoneme symbol the engine did not actually score.** If lexicon/score
  alignment lengths disagree, fall back to time-based highlighting.
- **Never use CMUdict as the lexicon** — it is American and rhotic, encoding exactly the
  pronunciations this app trains against. Verify any lexicon with *car*, *water*, *better*
  carrying no /r/.

## Gotchas

- **Speech endpoints are not the portal endpoint.** The Azure resource Overview shows
  `<region>.api.cognitive.microsoft.com` — unused here. Correct hosts:
  `<region>.stt.speech.microsoft.com` (assessment) and `<region>.tts.speech.microsoft.com`
  (TTS). Using the portal one yields 404s.
- **Do not use `microsoft-cognitiveservices-speech-sdk`.** It needs Node APIs and
  long-lived WebSockets and is not Workers-safe. Call the REST endpoint with `fetch()`,
  passing config as a base64 `Pronunciation-Assessment` header.
- **The REST response shape is not the SDK-documented one.** Scores sit *flat* on each
  object — `NBest[0].AccuracyScore`, `Words[i].AccuracyScore` — not nested under a
  `PronunciationAssessment` property. See `src/spike/azure-types.ts`.
- **Renaming the project directory breaks `node_modules`.** Bun symlinks use absolute
  paths, so a rename leaves every link dangling and `bunx` silently tries to reinstall.
  Fix: `rm -rf node_modules apps/api/node_modules apps/api/.wrangler && bun install`.
- **30-second audio cap** on the REST assessment path. Enforce as request validation.
- **Audio must be 16 kHz / 16-bit / mono PCM WAV.** Browsers emit WebM/Opus, so decode via
  `AudioContext` and re-encode client-side. Decode rather than trusting the container —
  this is also what makes Safari work.
- **Pin `vitest` to ^4.1**, not latest. `@cloudflare/vitest-plugin` peers to vitest 4.1.x;
  vitest 5 breaks it.
- **D1 needs the Workers pool.** API tests run under `@cloudflare/vitest-plugin` because
  Bun's own test runner cannot provide a D1 binding.

## Code style

- **Never use `any`.** Define explicit interfaces for every API response and boundary.
  Enforced by `@typescript-eslint/no-explicit-any`.
- TSDoc on exported classes and functions.
- Null/undefined handling on all public parameters.
- **React:** functional components and hooks.
- **shadcn/ui + Tailwind** for UI. Components are copied into `src/components/ui/` and are
  committed — edit them directly rather than wrapping them. Compose from Radix primitives
  for anything custom so keyboard and ARIA behaviour stays correct.
- **TanStack Query:** never call `useQuery` directly in a component — wrap it in a custom
  hook. Centralise keys in a query-key factory. Every mutation implements `onSuccess`
  invalidation.
- Accessibility is a requirement, not a polish step: semantic HTML, `alt` text, keyboard
  navigation. Never signal state by colour alone.
- Target Chrome, Firefox, and Safari.

## Testing

Write tests alongside the code, not as a later task.

- **Mock at the HTTP boundary.** The suite must never call the live Azure API.
- Use the checked-in WAV fixture and captured response JSON in `apps/api/test/fixtures/`.
- **Assert bytes, not vibes** — audio tests parse the WAV header and assert sample rate,
  bit depth, and channel count.
- Cross-browser verification is manual and called out per task.

## Environment

Secrets live in `apps/api/.dev.vars` (gitignored) locally, and in Worker secrets when
deployed. Never commit them.

```bash
AZURE_SPEECH_KEY="..."
AZURE_SPEECH_REGION="..."     # e.g. uksouth — must match the resource's region
```

The Azure resource must be a dedicated **Speech** resource (`kind: SpeechServices`), not
the multi-service AI bundle — F0 free tier, and a narrower credential scope.

## Workflow

1. Branch before starting work.
2. Consult `docs/specs/` and `docs/plans/` before implementing; update the spec *first*
   when a decision changes.
3. Tests and `bun run build` must pass before a task counts as done.
4. `docs/todo.md` is working scratch and is gitignored — do not commit it.

**Commits:** never add AI attribution of any kind — no `Co-Authored-By` trailer, no
"generated with" line, no tool name in the message. Commit messages describe the change
only. This repository is intended to be public.

**Ask before:** swapping the scoring vendor, adding a dependency, or changing the D1 schema
once it holds data.
