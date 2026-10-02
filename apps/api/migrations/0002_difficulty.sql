-- Drill difficulty, mirroring how elocution practice actually progresses:
-- isolate the sound, contrast it against its neighbour, then build up to flowing speech.
--
--   1 WORD          a single word                  "bath"
--   2 MINIMAL_PAIR  the contrast against its twin  "bath, bat"
--   3 PHRASE        a short phrase                 "a glass of water"
--   4 SENTENCE      a full sentence                "Ask the class about the bath"
--   5 CONNECTED     longer, with linking           two clauses run together
--
-- Existing drills are all sentences, hence the default of 4.
ALTER TABLE drills ADD COLUMN difficulty INTEGER NOT NULL DEFAULT 4;

CREATE INDEX idx_drills_difficulty ON drills (difficulty, sort_order);
