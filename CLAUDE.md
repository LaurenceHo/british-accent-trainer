# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

A Progressive Web App for practising Received Pronunciation (RP), built as a **shadowing
trainer**: the user hears a native `en-GB` model, records themselves reading the same
sentence, and plays the two back against each other. Attempts are kept so progress is
audible over time.

**It does not grade accent, and must never claim to.** That was the original design and it
was disproven — see "Critical domain constraint" below and `spike/FINDINGS.md`. No
available API can tell RP from General American, so the learner's ear does the judging and
the app's job is to make comparison fast and repeatable. The `en-GB` score is retained only
as a *clarity* signal, always captioned as such.

TypeScript throughout: a Hono REST API on Cloudflare Workers, a React + Vite PWA frontend.

## Commands

```bash
bun install                                   # Install workspace dependencies
bun run build                                 # Build/typecheck all workspaces
bun run test                                  # Run all tests
bun run lint                                  # ESLint (--fix to autofix)
bun run dev                                   # Run the Worker API locally (from repo root)
bun run dev -- --port 8788                    # ...on a specific port
bun run --filter web dev                      # Web app on :5173, proxying /api to :8787

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
apps/web/          React + Vite PWA — shadcn/ui, Tailwind v4, Vitest + jsdom
  src/audio/       Recording → 16 kHz mono WAV (use-recorder, to-wav, wav-encoder);
                   waveforms and A/B playback (wav-reader, waveform, use-ab-player)
  src/progress/    Trend maths for the progress screen (dates → chart positions)
  src/components/ui/  shadcn components, copied in and edited directly
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

- In natural speech, *car* scored **64 non-rhotic vs 65 rhotic**; *water* **65 vs 67**.
  A deliberately rolled American r is indistinguishable from no r at all.
- In connected speech, British and American readings score **identically on every
  phoneme** — `glass` (/ɡlɑːs/ vs /ɡlæs/) scores 100 both ways.
- `car` returns **3 phonemes** where RP has 2, confirming an en-US phone inventory.

**Do not use an `en-GB` score as a measure of RP-ness, and never label it as one in the
UI.** It measures general intelligibility, which is a different question.

**2. Index-aligning scores to a British lexicon is impossible.** Azure's phone counts
follow the American inventory, so the arrays do not correspond. Use time alignment
(`Offset`/`Duration`) or word-level scores instead.

**3. Automated RP feature detection is NOT viable on Azure. Do not attempt it.**

The `en-US` inversion trick was explored thoroughly and rejected. `en-US` does return
phoneme names and `NBestPhonemes`, and *car*, *nurse* and *bath* do detect in isolation —
but only 3 contexts out of 19 probed, and rhoticity detection **disappears entirely in
connected speech**, which is the form every drill takes.

**Root cause, and it is structural:** `NBestPhonemes` can only report phones that exist in
Azure's **American** inventory — `æ ɑ ɔ ɛ ə ɝ ɑɹ oʊ`. There is no `ɒ`, no `əʊ`, and no `ɑː`
distinct from `ɑ`. RP vowels without an American counterpart are mapped to the nearest one,
destroying the contrast before it reaches us:

| RP vowel | Maps to | Same as American? |
| --- | --- | --- |
| /ɑː/ *bath* | `ɑ` | No — American uses `æ`, so this one detects |
| /ɒ/ *got* | `ɑ` | Yes — contrast lost |
| /əʊ/ *go* | `oʊ` | Yes — contrast lost |

No further probing will change this. Full evidence in `spike/FINDINGS.md`.

**Never score the user against `en-US`** either — that grades them for sounding American.

`src/spike/rhotic-detector.ts` keeps a confirm-only safety rule (report a dropped r, never
report a produced one, since that verdict carries 55% precision). It is retained as a
reference implementation, **not as a shipping feature**.

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
- **`bunx wrangler` from the repo root silently downloads a different wrangler.** Wrangler
  is a dependency of `apps/api`, not the root, so `bunx` finds nothing locally and fetches
  `wrangler@latest` into a temp directory. On Windows that download often half-fails,
  producing `Error: Cannot find module 'miniflare'` from a path under
  `AppData\Local\Temp\bunx-*-wrangler@latest`. **A `bunx-` temp path in a stack trace means
  the wrong wrangler is running.** Fix: `rm -rf "$TEMP/bunx-"*"wrangler@latest"`, then run
  `bun run dev` from the root, or `bunx wrangler` only from inside `apps/api`.
- **30-second audio cap** on the REST assessment path. Enforce as request validation.
- **F0 allows ONE concurrent transcription.** Two assessments in `Promise.all` — even of the
  same clip — return 429 "The number of parallel requests exceeded the number of allowed
  concurrent transcriptions." Always run assessments **sequentially**, and retry 429 with
  backoff. This applies to the attempts endpoint too, not just the spike.
- **Audio must be 16 kHz / 16-bit / mono PCM WAV.** Browsers emit WebM/Opus, so decode via
  `AudioContext` and re-encode client-side. Decode rather than trusting the container —
  this is also what makes Safari work.
- **Pin `vitest` to ^4.1**, not latest. `@cloudflare/vitest-plugin` peers to vitest 4.1.x;
  vitest 5 breaks it.
- **D1 needs the Workers pool.** API tests run under `@cloudflare/vitest-plugin` because
  Bun's own test runner cannot provide a D1 binding.
- **Tailwind v4 has no `tailwind.config.js`.** It is the `@tailwindcss/vite` plugin plus `@import
  "tailwindcss"` in `src/index.css`; theme tokens live in that CSS file. Tutorials written for
  v3 will tell you otherwise.
- **shadcn imports `cn` from a package called `cn`**, not from `clsx` + `tailwind-merge`.
  That is current shadcn (`shadcn-ui/cn`, published by shadcn), not a typosquat — checked.
- **`bun install` and `bunx` fail intermittently on Windows** with `EPERM … moving "x" to
  cache dir failed`. It is transient file locking; rerun and it clears.

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

**`master` keeps a linear history — no merge commits.** The repo is configured with
`merge.ff = only` and `pull.rebase = true`, so a merge that would create a merge commit
fails rather than silently branching the graph.

**One branch per task, landed by squash-merged PR.** The repository owner opens and merges
the PR; do not merge to `master` directly and do not push to `master`.

```bash
git checkout -b feat/<task>      # before starting work
# ... implement, with tests passing at each commit
git push -u origin feat/<task>   # then the owner opens a PR and squash-merges
```

Never use `--no-ff`. If `git merge` refuses with "not possible to fast-forward", rebase the
branch first — do not reach for `--no-ff` to force it through.

**Stacked PRs.** Work does not wait for merges: each task branches from the previous task's
branch, and its PR targets that branch. When the parent is squash-merged it lands as one
*new* commit, so the child still carries the parent's original commits and a plain
`git rebase master` conflicts. Replay only the child's own commits instead:

```bash
git fetch origin --prune
git rebase --onto origin/master <old-parent-tip> feat/child
git push --force-with-lease
gh pr edit <n> --base master          # if GitHub has not retargeted it already
```

`<old-parent-tip>` is the last commit of the parent branch as it was before the merge.
Use a separate `git worktree` for the next task while review agents work on the current
one, so switching branches never moves files out from under them.

**Every task ends with a review pass.** Once the work is committed and green, run both:

1. **Simplify** — reduce complexity without changing behaviour.
2. **Review** — correctness, readability, architecture, security, performance.

Act on the findings, or state plainly why a finding is being left. A task is not finished
until that pass has happened.

**CI** (`.github/workflows/ci.yml`) runs `bun run lint`, `bun run build` and `bun run test`
on every pull request and on pushes to `master`. Run all three locally before pushing —
CI is a backstop, not the first check.

It installs with `--frozen-lockfile`, so a dependency added without committing `bun.lock`
fails there. Tests need no Azure credentials; if a test ever starts requiring them, that is
a bug in the test rather than a reason to add secrets to CI.

**Ask before:** swapping the scoring vendor, adding a dependency, or changing the D1 schema
once it holds data.
