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

**Azure returns phoneme *names* for `en-US` only. At `en-GB` you get phoneme *scores* with
`Offset`/`Duration`, but the `Phoneme` field is an empty string.** Syllable groups, prosody,
and `NBestPhonemes` are likewise `en-US`-only.

Consequences, and they are not negotiable:

- **Never switch the locale to `en-US`** to obtain phoneme names. That scores the user
  against General American and inverts the purpose of the app.
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
