-- Schema only. Drill content is NOT seeded here — it lives in `content/drills.ts` and is
-- loaded by `scripts/seed.ts`. Migrations are append-only, so content edits would otherwise
-- accumulate as an unreadable pile of INSERT/UPDATE migrations.

CREATE TABLE drills (
  id            TEXT PRIMARY KEY,
  -- The sentence the user reads aloud.
  sentence      TEXT    NOT NULL,
  -- Target RP pronunciation in IPA, from the British lexicon. Never from the scoring API.
  target_ipa    TEXT    NOT NULL,
  -- The RP feature this drill trains, named after Wells' standard lexical sets where one
  -- applies. Progress is grouped by this rather than by a meaningless global average.
  feature       TEXT    NOT NULL,
  -- Plain-language description of what to listen for.
  coaching_note TEXT    NOT NULL,
  -- Whether the sentence contains a post-vocalic r position. Gates the extra en-US
  -- detector call so it is not spent on drills it can say nothing about.
  has_r_context INTEGER NOT NULL DEFAULT 0 CHECK (has_r_context IN (0, 1)),
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE attempts (
  id                 TEXT    PRIMARY KEY,
  drill_id           TEXT    NOT NULL REFERENCES drills(id),
  created_at         TEXT    NOT NULL,

  -- Scores from the en-GB assessment. These measure general intelligibility, NOT
  -- RP-ness — the engine does not discriminate accent. See spike/FINDINGS.md.
  accuracy_score     REAL,
  fluency_score      REAL,
  completeness_score REAL,
  pron_score         REAL,

  -- JSON: per-word scores with phoneme timings, for time-aligned feedback.
  word_scores        TEXT,
  -- JSON: per-feature categorical verdicts from the detector. Each is
  -- 'correct' | 'incorrect' | 'unknown' — 'unknown' must never be shown as a failure.
  feature_verdicts   TEXT,

  -- R2 object key for the submitted audio, when retained.
  audio_key          TEXT
);

CREATE INDEX idx_attempts_drill      ON attempts (drill_id);
CREATE INDEX idx_attempts_created_at ON attempts (created_at);
