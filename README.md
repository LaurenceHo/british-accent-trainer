# British Accent Trainer

[![CI](https://github.com/LaurenceHo/british-accent-trainer/actions/workflows/ci.yml/badge.svg)](https://github.com/LaurenceHo/british-accent-trainer/actions/workflows/ci.yml)

A Progressive Web App for practising **Received Pronunciation** — hear a native model,
record yourself, and compare the two.

> **Status:** the API, the drill corpus and the web app are built: practise, compare, track
> progress, install as an app. See [Status](#status).

---

## Read this first: what this app does *not* do

It does not score how British you sound, because **no pronunciation-assessment API
tested can tell Received Pronunciation from General American.** That was the original
design, and it was disproven with measurements rather than assumed.

The evidence is in [`spike/FINDINGS.md`](spike/FINDINGS.md). The short version, testing
Azure AI Speech's pronunciation assessment at `en-GB`:

| Test | Non-rhotic (British) | Rhotic (American) |
| --- | --- | --- |
| *car*, isolated | 64 | 65 |
| *water*, isolated | 65 | 67 |
| *"Pass me a glass of water"* | 99 on every phoneme | 99 on every phoneme |

A deliberately rolled American r scores the same as no r at all. In connected speech,
British and American readings score **identically on every phoneme** — including `glass`
(/ɡlɑːs/ vs /ɡlæs/), a completely different vowel.

**The root cause is structural.** Azure's `en-GB` locale returns no phoneme names at all.
Its `en-US` locale does, along with `NBestPhonemes` (the sounds it actually heard) — but
that inventory is American: `æ ɑ ɔ ɛ ə ɝ ɑɹ oʊ`. There is no `ɒ`, no `əʊ`, and no `ɑː`
distinct from `ɑ`. RP vowels with no American counterpart are mapped to the nearest one,
destroying the contrast before any result is returned:

| RP vowel | Mapped to | American uses | Detectable? |
| --- | --- | --- | --- |
| /ɑː/ in *bath* | `ɑ` | `æ` | ✅ different symbols |
| /ɒ/ in *got* | `ɑ` | `ɑ` | ❌ collapses |
| /əʊ/ in *go* | `oʊ` | `oʊ` | ❌ collapses |

Only 3 of 19 probed contexts detect at all, and rhoticity detection disappears entirely in
connected speech — the form every drill takes.

**If you are building something similar, this is the part worth your time.** It cost two
days to establish and would have been invisible until the feedback UI was already built on
top of it.

## How it works instead

Accent training is a **shadowing loop**, and the comparison is made by the learner's ear:

```
hear a native RP model  →  record yourself  →  play the two back  →  repeat
```

Everything that loop needs works without any accent-scoring API:

- **Reference audio** — Azure `en-GB` neural TTS, which is excellent at this
- **Your recording** — browser capture, resampled to 16 kHz mono WAV
- **A/B comparison** — signal processing on two WAV files the app owns outright
- **Drills** that concentrate one feature, so you know what to listen for
- **History**, so progress is audible over weeks

A clarity score from the `en-GB` assessment rides along as a secondary signal. It is
labelled *clarity*, never *accent*, because that is all it measures.

## Drills

27 hand-authored drills across seven RP features, graded by difficulty the way elocution
practice progresses:

| Level | Form | Example |
| --- | --- | --- |
| 1 | Single word | *bath* |
| 2 | Minimal pair | *bath, bat* |
| 3 | Short phrase | *a glass of water* |
| 4 | Full sentence | *Ask the class about the bath* |
| 5 | Connected speech | *Ask for a glass of water after the dance class* |

Features follow [J.C. Wells' standard lexical sets](https://en.wikipedia.org/wiki/Lexical_set)
where one applies — `BATH`, `LOT`, `THOUGHT`, `GOAT` — plus `NON_RHOTIC_R`,
`T_NOT_FLAPPED` and `YOD`. Wells defined those sets using RP and General American as the
two reference accents, which is exactly the contrast being trained.

From level 3 upward each item loads its target feature several times, so one recording
yields several attempts at the same contrast: *"The nurse heard the first word"* is four
NURSE vowels.

## Tech stack

| | |
| --- | --- |
| API | TypeScript, [Hono](https://hono.dev) on [Cloudflare Workers](https://workers.cloudflare.com) |
| Storage | Cloudflare D1 (SQLite) for drills and attempts, R2 for audio |
| Speech | Azure AI Speech — `en-GB` neural TTS and pronunciation assessment, via REST |
| Web | React + Vite PWA, shadcn/ui + Tailwind, TanStack Query |
| Tooling | Bun, Vitest with `@cloudflare/vitest-plugin`, ESLint |

## Getting started

Requires [Bun](https://bun.sh) and an Azure Speech resource.

```bash
bun install
```

Create an Azure **Speech** resource — `kind: SpeechServices`, not the multi-service AI
bundle. The free F0 tier is ample: 5 audio hours and 500k TTS characters per month, which
is thousands of practice attempts. Then:

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
# fill in AZURE_SPEECH_KEY and AZURE_SPEECH_REGION
```

Set up the local database and run:

```bash
cd apps/api
bun run db:migrate     # apply schema to local D1
bun run db:seed        # load the drill corpus
cd ../..
bun run dev            # API on http://127.0.0.1:8787
```

In a second terminal, the web app, which forwards `/api` to the API:

```bash
bun run --filter web dev   # http://localhost:5173
```

Verify:

```bash
curl http://127.0.0.1:8787/health
curl "http://127.0.0.1:8787/api/drills?difficulty=1"
```

Tests, typecheck and lint:

```bash
bun run --filter api test
bun run build
bun run lint
```

The test suite mocks at the HTTP boundary and never calls the live Azure API — so it needs
no Azure credentials, and the same three commands run in CI on every pull request
(`.github/workflows/ci.yml`).

## Deploying

The app runs on one hostname you own, for example `trainer.example.com`:

```
trainer.example.com/api/*   →  API Worker      (apps/api, wrangler.jsonc)
trainer.example.com/*       →  Web Worker      (apps/web, wrangler.jsonc: static assets only)
```

Page and API share one origin, so one Cloudflare Access application protects both. The
service worker can see the API, and no CORS is needed.

**The app must sit behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/).**
The API has no authentication of its own, because it is a single-user tool. It stores
your voice recordings, and its routes are public in this repository. Both Workers
have `workers.dev` and preview URLs switched off, so the protected hostname is their only
address. The route and the custom domain are bound in the dashboard, not in
`wrangler.jsonc`, so your domain never appears in this repository.

### One-time setup

**Prerequisites, in the Cloudflare dashboard:**

- Your domain is on Cloudflare.
- **R2 is enabled** (R2 → enable; a payment method may be required even on the free tier).
- **Zero Trust is set up**: choose a team name and the Free plan, which may also ask for a
  payment method. This is what provides Access. One-time PIN login to your email works with
  no identity provider.

The order below keeps the app unreachable until Access protects it. Run commands from
`apps/api` unless noted.

1. **Log in:** `bunx wrangler login`
2. **Database:** `bunx wrangler d1 create accent-trainer`. Paste the `database_id` it
   prints into `apps/api/wrangler.jsonc`, replacing the zeros, and commit it. The id is
   not a secret. Then:
   ```bash
   bun run db:migrate:remote   # create the tables
   bun run db:seed:remote      # load the drills; safe to rerun after editing content/
   ```
3. **Audio bucket:** `bunx wrangler r2 bucket create accent-trainer-audio`
4. **API Worker:** deploy it first, then set its secrets:
   ```bash
   bun run deploy                              # no route yet, so not reachable at all
   bunx wrangler secret put AZURE_SPEECH_KEY
   bunx wrangler secret put AZURE_SPEECH_REGION
   ```
   Wrangler reports "No targets deployed". That is expected: the route comes in step 7.
   Each `secret put` prompts for its value, so the key never sits in a file or your shell
   history.
5. **Access, before anything is reachable.** In Zero Trust, add a *self-hosted* Access
   application for your hostname (for example `trainer.example.com`), with an *Allow*
   policy for your own email. Then add two more applications on your hostname, each with
   a *Bypass* policy for everyone: one for the path `/manifest.webmanifest` and one for
   `/icons/*`. Browsers can fetch these without your session cookie, and without the
   bypass they would get the login page and never offer to install the app. Neither path
   holds anything private.
6. **Web app.** From `apps/web`, run `bun run deploy`. It builds the app and uploads it as
   the `accent-trainer-web` Worker. Then go to **Workers & Pages → accent-trainer-web →
   Settings → Domains & Routes → Add → Custom domain** and enter your hostname. Cloudflare
   creates its DNS record and certificate.
7. **API route.** Go to **Workers & Pages → accent-trainer-api → Settings → Domains &
   Routes → Add → Route**. Enter `trainer.example.com/api/*` (your hostname) and pick your
   domain's zone. Cloudflare gives a route precedence over a custom domain on the same
   hostname, so `/api/*` reaches the API and everything else reaches the web app. The
   route is bound there, not in `wrangler.jsonc`, so your domain stays out of the
   repository, and later deploys leave it in place.
8. **Check.** In a private window:
   - `https://trainer.example.com/` asks you to log in;
   - after logging in, `https://trainer.example.com/api/drills` returns the drills as
     JSON, and the app itself loads.

Dashboard menu names change from time to time; if one is missing, search the dashboard
for it.

### Updating

```bash
cd apps/web && bun run deploy              # web
cd apps/api && bun run db:migrate:remote   # first, if a change adds a migration
cd apps/api && bun run deploy              # API
```

`bunx wrangler deploy --dry-run` in `apps/api` or `apps/web` packages the Worker and checks
its bindings without uploading anything or needing a login.

## Project structure

```
apps/api/            Hono REST API on Cloudflare Workers
  src/routes/        HTTP handlers
  src/domain.ts      Types shared with the web app
  src/spike/         Throwaway engine evaluation — see spike/FINDINGS.md
  migrations/        D1 schema (schema only; content is seeded separately)
apps/web/            React PWA: recording, A/B comparison, progress, offline shell
content/drills.ts    The drill corpus, as typed data
scripts/seed.ts      Loads the corpus into D1
docs/specs/          Design documents
docs/plans/          Implementation plans
spike/FINDINGS.md    The engine evaluation and its evidence
```

Drill content lives in TypeScript rather than SQL migrations, so editing a sentence is a
one-line diff and a wrong feature name is a compile error.

## Status

| | |
| --- | --- |
| ✅ | Workers API scaffold, D1/R2 bindings, test harness |
| ✅ | Engine evaluation — see [`spike/FINDINGS.md`](spike/FINDINGS.md) |
| ✅ | Drill schema, corpus of 27 drills, `GET /api/drills` with filtering |
| ✅ | Scoring provider interface and Azure adapter, labelled as clarity |
| ✅ | Attempt submission, scoring and audio storage |
| ✅ | Web app: recording, reference playback, A/B waveform comparison |
| ✅ | Progress per RP feature, replay of past attempts |
| ✅ | Installable PWA that opens offline |
| ⏳ | Deployment configuration and CI/CD |
| ➖ | British pronunciation lexicon — dropped: drill IPA is hand-written and test-checked |

The spike code under `apps/api/src/spike/` is deliberately throwaway. It includes a
browser recorder at `/spike/recorder` that was used to validate the findings against real
speech, and is kept because the results are reproducible.

## Licence

Not yet specified. Until a licence is added, default copyright applies and the code is not
free to reuse — worth adding one before sharing this widely.
