# Task 1 — Engine Spike Findings

**Date:** 2026-09-14
**Question:** Is Azure `en-GB` pronunciation assessment fit for training Received Pronunciation?
**Verdict:** **No, not for the features this app targets.** Details below.

---

## Method

Six probes. Each word/sentence was synthesised twice — once with a **non-rhotic `en-GB`
voice** (`en-GB-SoniaNeural`) and once with a **rhotic `en-US` voice** (`en-US-JennyNeural`)
— and both were submitted to pronunciation assessment at `language=en-GB`,
`Granularity: Phoneme`, `PhonemeAlphabet: IPA`.

The A/B design matters: an absolute score is uninterpretable. If correct RP scores 65, that
only means something when you know what the American reading of the same word scores.

Raw responses: [`results/raw.json`](results/raw.json).

> **Caveat, stated up front.** These are **synthetic TTS recordings, not natural speech**,
> and n=1 per condition. The *structural* findings below (phone counts, empty names,
> timings) are facts about Azure's lexicon and response format and hold regardless of who
> speaks. The *score* findings are directional and should be re-confirmed with real
> recordings — though a 35-point gap is not a subtle signal.

---

## Structural findings — definitive

| Question | Result |
| --- | --- |
| Are phoneme **names** returned at `en-GB`? | **No.** Every `Phoneme` field is `""`, exactly as documented. |
| Are **syllable** names returned? | **No.** The `Syllables` array exists but every `Syllable` is `""`. |
| Are per-phoneme **`Offset`/`Duration`** present and non-zero? | **Yes.** Populated on every entry. **Rung 3 survives.** |
| Does the phone count match **British** RP? | **No — it matches American.** See below. |

### The response shape is not what the SDK docs describe

The REST API returns scores **flat on `NBest[0]`**, not nested under a
`PronunciationAssessment` object:

```jsonc
"NBest": [{
  "AccuracyScore": 65, "FluencyScore": 100, "CompletenessScore": 100, "PronScore": 79,
  "Words": [{
    "Word": "car", "AccuracyScore": 65, "ErrorType": "None",
    "Syllables": [{ "Syllable": "", "Offset": 1600000, "Duration": 5300000, "AccuracyScore": 90 }],
    "Phonemes": [{ "Phoneme": "", "Offset": 1600000, "Duration": 1300000, "AccuracyScore": 100 }]
  }]
}]
```

The Azure adapter (Task 4) must parse this shape, not the SDK-documented one.

### Phone counts follow an American inventory

`car` returns **3 phonemes**. RP /kɑː/ is **2 phones**; General American /kɑr/ is 3.
Azure is segmenting `en-GB` audio against an en-US phone set — consistent with the
Microsoft engineer's statement that en-US phones were copied for en-GB.

**This kills rung 2.** Index-aligning Azure's score array to a British IPA lexicon cannot
work when the arrays are different lengths and describe different segmentations.

---

## Score findings — the engine is biased against RP

### Isolated words: correct RP is *penalised*

| Word | Non-rhotic RP voice | Rhotic GA voice | Penalty for correct RP |
| --- | --- | --- | --- |
| `car` | **65** | **100** | **−35** |
| `water` | **94** | **100** | **−6** |

Per-phoneme for `car` — RP scores `100, 86, 86`; GA scores `100, 100, 100`. The two
downgraded slots are precisely the /ɑː/ and the /r/ position that RP correctly omits.

**The engine rewards the American pronunciation and marks the British one wrong** — at the
`en-GB` locale, on the single most diagnostic feature of the accent.

### Connected speech: the engine is completely blind to the contrast

Reading *"Pass me a glass of water"* with both voices:

| Word | RP voice | GA voice | RP phonemes | GA phonemes |
| --- | --- | --- | --- | --- |
| Pass | 100 | 100 | 100,100,100 | 100,100,100 |
| me | 100 | 100 | 100,100 | 100,100 |
| a | 100 | 100 | 100 | 100 |
| **glass** | **100** | **100** | 100,100,100,100 | 100,100,100,100 |
| of | 100 | 100 | 100,100 | 100,100 |
| **water** | **99** | **99** | 99,99,99,99,99 | 99,99,99,99,99 |

**Every score is identical.** `glass` (/ɡlɑːs/ vs /ɡlæs/ — the TRAP–BATH split) scores 100
either way. `water` (non-rhotic + unflapped /t/ vs rhotic + flapped) scores 99 either way,
on every phoneme.

Two independent RP features, zero discrimination.

---

## Why this is disqualifying

The app's drill format is **sentences**. In sentences, Azure `en-GB` scores a British and
an American reading identically — so it cannot tell the user when they got it right, nor
when they got it wrong. It is not measuring the thing the app exists to teach.

Switching to isolated-word drills does not rescue it, because there the engine is
*actively wrong* — it scores correct RP 35 points below the American production.

There is no configuration fix. Using `en-US` was already rejected (it scores the user
against General American, inverting the purpose). `en-GB` turns out to do much the same
thing while claiming otherwise.

---

## Ladder status

| Rung | Status |
| --- | --- |
| 1 — phoneme names + scores | **Dead.** Names are empty at `en-GB`. |
| 2 — scores index-aligned to a British lexicon | **Dead.** Azure segments `car` into 3 phones (American); RP is 2. |
| 3 — scores aligned by time over the waveform | **Technically alive** — timings are present and non-zero. But it would be painting a waveform with scores that do not track RP. |
| 4 — word-level scores + target IPA as reference | **Alive**, and honest, provided the UI does not imply the score measures RP-ness. |

Rung 3 survives mechanically but not meaningfully. **The blocker is not the feedback
granularity — it is that the underlying scores do not measure the target accent.**

---

## Recommendation

1. **Do not build the RP-feedback features on Azure `en-GB`.** The `ScoringProvider`
   interface (Task 4) was introduced for exactly this outcome, and it holds: everything
   downstream — schema, audio pipeline, endpoints, UI, progress — is vendor-agnostic.
2. **Evaluate Speechace properly, with a trial key**, against these same six probes. Its
   RP support is still an unverified third-party claim; this spike is now the benchmark it
   must beat. Re-run the identical A/B and compare.
3. **Re-run this spike with real recordings** before finalising the vendor decision.
   Synthetic audio is a strong directional signal, not proof about natural speech.
4. **Keep Azure as the reference implementation** meanwhile. It works structurally, the
   plumbing is correct, and it is the fallback if no vendor discriminates RP.
5. **Be honest in the UI.** Until a vendor is confirmed to discriminate RP features, the
   app must not label a score as "your RP accuracy". Show it as general pronunciation
   accuracy, and do not colour phonemes by a score that cannot see the contrast.

---

## Reproducing

```bash
cd apps/api && bunx wrangler dev --port 8788      # requires .dev.vars
curl -s http://127.0.0.1:8788/spike/run -o ../../spike/results/raw.json
```

The spike route (`apps/api/src/spike/`) is throwaway and should be deleted once the vendor
decision is final.

---

# UPDATE — 2026-09-14: real-voice confirmation, and a partial rescue

## 1. Real speech confirms the `en-GB` failure

Four clips recorded by a human speaker through `/spike/recorder`:

| Clip | Accuracy | Pron | Sounds |
| --- | --- | --- | --- |
| car — British (no r) | **64** | 78.4 | 3 |
| car — American (rolled r) | **65** | 79 | 3 |
| water — British | **65** | 79 | 5 |
| water — American | **67** | 80.2 | 5 |

Differences of 1–2 points. That is noise.

**This closes the ceiling-effect question.** The synthetic test scored ~100 everywhere,
so "identical scores" could have meant "both saturated the scale". Real speech scores in
the **60s** — far off the ceiling, with ample room to move in either direction — and still
shows no separation between a deliberately rolled American r and no r at all.

Azure `en-GB` does not measure rhoticity. Confirmed with natural speech.

`car` also returned **3 sounds** in the human recordings, matching the synthetic result and
confirming the en-US phone inventory independently of audio source.

## 2. The `en-US` inversion — a working rhoticity detector, with limits

`en-GB` returns no phoneme names. **`en-US` returns both names and `NBestPhonemes`** — the
phones Azure actually heard, ranked. That makes a different technique possible.

At `en-US` the reference for *car* is /k ɑɹ/. A speaker producing correct non-rhotic RP
omits the r, so Azure should report hearing bare `ɑ` rather than `ɑɹ`. Inverted, **hearing
the non-rhotic variant means the speaker got RP right.**

Synthetic probes at `en-US` with `NBestPhonemeCount: 5`:

| Probe | Expected | Actually heard | Verdict |
| --- | --- | --- | --- |
| car / non-rhotic RP | `ɑɹ` (79) | **`ɑ` (94)** | r dropped → **correct RP** ✅ |
| car / rhotic GA | `ɑɹ` (100) | `ɑɹ` (100) | r produced → American ✅ |
| water / non-rhotic RP | `ɚ` (88) | `ɚ` (100) | **wrong — says American** ❌ |
| water / rhotic GA | `ɚ` (93) | `ɚ` (100) | r produced → American ✅ |

**`car` separates cleanly and categorically.** `water` does not: both readings are heard as
`ɚ`. The `ɑ`/`ɑɹ` contrast is acoustically wide; the `ə`/`ɚ` contrast is narrow, and the
model does not offer plain `ə` as a competing candidate in that slot.

### Why this does not violate the "never use `en-US`" boundary

That rule exists because scoring a learner against General American inverts the app's
purpose. This does something different: it uses the American model purely as a **feature
detector for one contrast**, and inverts the verdict. The user is never shown an American
score, and never scored for American-ness. The distinction is between *grading against* a
model and *measuring with* one.

### Status

**Promising, not proven.** One word works, one does not, and both results are from
synthetic audio. Before any of this reaches the product it needs:

1. Confirmation on real speech — wired into `/spike/recorder`, which now runs both
   assessments and reports a rhoticity verdict per clip.
2. A wider probe set — more r-contexts (*START*, *NORTH*, *NURSE*, *letter*, *butter*) to
   find where the technique holds and where it breaks.
3. Extension testing to other features. The same trick should apply to the TRAP–BATH split:
   assess *glass* at `en-US` (expected `æ`); hearing `ɑ` means correct RP.

### Revised recommendation

Supersedes recommendation 1 in the original findings. Azure `en-GB` remains unfit for
RP scoring and must not drive the feedback UI. But Azure is **not** ruled out as a vendor —
the `en-US` + `NBestPhonemes` inversion is a genuine detection mechanism that the earlier
analysis missed, and it is worth developing before switching vendors.

A per-feature detector is arguably a **better** product than a score: "you pronounced the r
in *car* — RP drops it" is more useful teaching than "your pronunciation scored 64".
