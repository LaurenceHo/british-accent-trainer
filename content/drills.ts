import { DIFFICULTY, type Drill } from '../apps/api/src/domain';

/**
 * The drill corpus.
 *
 * Version-controlled content, not database seed data — edit here and re-run
 * `bun run db:seed`. Keeping it out of migrations means a wording fix is a one-line diff
 * rather than another append-only migration, and a wrong `feature` value is a compile
 * error rather than a bad row.
 *
 * Ordered by **difficulty**, mirroring how elocution practice progresses: isolate the
 * sound, contrast it against its neighbour, then build up to flowing speech. From level 3
 * upward each item deliberately **loads its target feature several times**, so a single
 * recording yields multiple attempts at the same contrast.
 *
 * IPA is RP, transcribed for careful connected speech. `hasRContext` marks items with a
 * post-vocalic r position.
 */
export const DRILLS: readonly Drill[] = [
  // ═══ Level 1 — single words. Isolate the sound. ═══
  {
    id: 'w-bath',
    sentence: 'bath',
    targetIpa: 'bɑːθ',
    feature: 'BATH',
    difficulty: DIFFICULTY.WORD,
    coachingNote: 'The long /ɑː/ of "father", not the short /æ/ of "cat".',
    hasRContext: false,
    sortOrder: 100,
  },
  {
    id: 'w-car',
    sentence: 'car',
    targetIpa: 'kɑː',
    feature: 'NON_RHOTIC_R',
    difficulty: DIFFICULTY.WORD,
    coachingNote: '"kah" — the vowel lengthens and stops. No r at the end.',
    hasRContext: true,
    sortOrder: 101,
  },
  {
    id: 'w-nurse',
    sentence: 'nurse',
    targetIpa: 'nɜːs',
    feature: 'NON_RHOTIC_R',
    difficulty: DIFFICULTY.WORD,
    coachingNote: 'A long, flat, centre-of-the-mouth vowel with no r-colouring.',
    hasRContext: true,
    sortOrder: 102,
  },
  {
    id: 'w-got',
    sentence: 'got',
    targetIpa: 'ɡɒt',
    feature: 'LOT',
    difficulty: DIFFICULTY.WORD,
    coachingNote: 'Short and rounded. The lips round; American English unrounds it.',
    hasRContext: false,
    sortOrder: 103,
  },
  {
    id: 'w-tune',
    sentence: 'tune',
    targetIpa: 'tjuːn',
    feature: 'YOD',
    difficulty: DIFFICULTY.WORD,
    coachingNote: '"tyoon", with a y-glide after the t. Never "toon".',
    hasRContext: false,
    sortOrder: 104,
  },
  {
    id: 'w-butter',
    sentence: 'butter',
    targetIpa: 'ˈbʌtə',
    feature: 'T_NOT_FLAPPED',
    difficulty: DIFFICULTY.WORD,
    coachingNote: 'A real, crisp t in the middle — not the quick d of "budder".',
    hasRContext: true,
    sortOrder: 105,
  },

  // ═══ Level 2 — minimal pairs. Hear the contrast directly. ═══
  {
    id: 'p-bath-bat',
    sentence: 'bath, bat',
    targetIpa: 'bɑːθ bæt',
    feature: 'BATH',
    difficulty: DIFFICULTY.MINIMAL_PAIR,
    coachingNote:
      'The first vowel is long and open, the second short and flat. RP keeps them clearly apart.',
    hasRContext: false,
    sortOrder: 200,
  },
  {
    id: 'p-cart-cat',
    sentence: 'cart, cat',
    targetIpa: 'kɑːt kæt',
    feature: 'BATH',
    difficulty: DIFFICULTY.MINIMAL_PAIR,
    coachingNote: 'Same contrast, and "cart" has no r — it is simply a longer vowel.',
    hasRContext: true,
    sortOrder: 201,
  },
  {
    id: 'p-cot-caught',
    sentence: 'cot, caught',
    targetIpa: 'kɒt kɔːt',
    feature: 'THOUGHT',
    difficulty: DIFFICULTY.MINIMAL_PAIR,
    coachingNote:
      'RP keeps these distinct: short rounded /ɒ/ against longer, tighter /ɔː/. Many American accents merge them.',
    hasRContext: false,
    sortOrder: 202,
  },
  {
    id: 'p-tune-toon',
    sentence: 'tune, soon',
    targetIpa: 'tjuːn suːn',
    feature: 'YOD',
    difficulty: DIFFICULTY.MINIMAL_PAIR,
    coachingNote: '"tune" keeps the y-glide; "soon" has none. Feel the difference.',
    hasRContext: false,
    sortOrder: 203,
  },

  // ═══ Level 3 — short phrases. The sound in context, still slow. ═══
  {
    id: 'ph-glass-of-water',
    sentence: 'a glass of water',
    targetIpa: 'ə ɡlɑːs əv ˈwɔːtə',
    feature: 'BATH',
    difficulty: DIFFICULTY.PHRASE,
    coachingNote: 'Long /ɑː/ in "glass", and "water" ends in a plain schwa with a crisp t.',
    hasRContext: true,
    sortOrder: 300,
  },
  {
    id: 'ph-half-past-four',
    sentence: 'half past four',
    targetIpa: 'hɑːf pɑːst fɔː',
    feature: 'BATH',
    difficulty: DIFFICULTY.PHRASE,
    coachingNote: 'Two BATH vowels, then "four" with no r at all.',
    hasRContext: true,
    sortOrder: 301,
  },
  {
    id: 'ph-hot-coffee',
    sentence: 'a lot of hot coffee',
    targetIpa: 'ə lɒt əv hɒt ˈkɒfi',
    feature: 'LOT',
    difficulty: DIFFICULTY.PHRASE,
    coachingNote: 'Three rounded /ɒ/ vowels. "Coffee" is /ˈkɒfi/, never "cawfee".',
    hasRContext: false,
    sortOrder: 302,
  },

  // ═══ Level 4 — full sentences. The feature in running speech. ═══
  {
    id: 'rhotic-car-park',
    sentence: 'The car park is over there',
    targetIpa: 'ðə ˈkɑː pɑːk ɪz ˈəʊvə ðeə',
    feature: 'NON_RHOTIC_R',
    difficulty: DIFFICULTY.SENTENCE,
    coachingNote:
      'Four r-positions, none of them pronounced: ca(r), pa(r)k, ove(r), the(re). The vowel simply lengthens and stops.',
    hasRContext: true,
    sortOrder: 400,
  },
  {
    id: 'rhotic-better-water',
    sentence: 'Better water for my father',
    targetIpa: 'ˈbetə ˈwɔːtə fə maɪ ˈfɑːðə',
    feature: 'NON_RHOTIC_R',
    difficulty: DIFFICULTY.SENTENCE,
    coachingNote:
      'Every word ends in a plain schwa — "bettuh", "watuh", "fathuh". Resist curling the tongue at the end.',
    hasRContext: true,
    sortOrder: 401,
  },
  {
    id: 'rhotic-nurse-work',
    sentence: 'The nurse heard the first word',
    targetIpa: 'ðə nɜːs hɜːd ðə fɜːst wɜːd',
    feature: 'NON_RHOTIC_R',
    difficulty: DIFFICULTY.SENTENCE,
    coachingNote:
      'The NURSE vowel /ɜː/ is a long, flat, centre-of-the-mouth sound with no r-colouring at all.',
    hasRContext: true,
    sortOrder: 402,
  },
  {
    id: 'bath-class-ask',
    sentence: 'Ask the class about the bath',
    targetIpa: 'ɑːsk ðə klɑːs əˈbaʊt ðə bɑːθ',
    feature: 'BATH',
    difficulty: DIFFICULTY.SENTENCE,
    coachingNote:
      'Ask, class and bath all take the long /ɑː/ of "father" — not the short /æ/ of "cat".',
    hasRContext: false,
    sortOrder: 410,
  },
  {
    id: 'bath-half-past',
    sentence: 'Half past, after the dance',
    targetIpa: 'hɑːf pɑːst ˈɑːftə ðə dɑːns',
    feature: 'BATH',
    difficulty: DIFFICULTY.SENTENCE,
    coachingNote: 'Four BATH words in a row. Keep the vowel long and open throughout.',
    hasRContext: true,
    sortOrder: 411,
  },
  {
    id: 'lot-tom-job',
    sentence: 'Tom got a job in the shop',
    targetIpa: 'tɒm ɡɒt ə dʒɒb ɪn ðə ʃɒp',
    feature: 'LOT',
    difficulty: DIFFICULTY.SENTENCE,
    coachingNote:
      'Four short, rounded /ɒ/ vowels. The lips round; American English unrounds this to /ɑ/.',
    hasRContext: false,
    sortOrder: 420,
  },
  {
    id: 'lot-hot-coffee',
    sentence: 'The dog wants a lot of hot coffee',
    targetIpa: 'ðə dɒɡ wɒnts ə lɒt əv hɒt ˈkɒfi',
    feature: 'LOT',
    difficulty: DIFFICULTY.SENTENCE,
    coachingNote: 'Short and rounded every time — "coffee" is /ˈkɒfi/, never "cawfee".',
    hasRContext: false,
    sortOrder: 421,
  },
  {
    id: 'thought-saw-four',
    sentence: 'I thought I saw four tall walls',
    targetIpa: 'aɪ θɔːt aɪ sɔː fɔː tɔːl wɔːlz',
    feature: 'THOUGHT',
    difficulty: DIFFICULTY.SENTENCE,
    coachingNote:
      'THOUGHT /ɔː/ is longer and more rounded than LOT /ɒ/. RP keeps "caught" and "cot" clearly apart.',
    hasRContext: true,
    sortOrder: 430,
  },
  {
    id: 't-little-butter',
    sentence: 'A little bit of butter',
    targetIpa: 'ə ˈlɪtl bɪt əv ˈbʌtə',
    feature: 'T_NOT_FLAPPED',
    difficulty: DIFFICULTY.SENTENCE,
    coachingNote:
      'Each /t/ is a real, crisp t. American English turns these into a quick d — "liddle bidda budder".',
    hasRContext: true,
    sortOrder: 440,
  },
  {
    id: 't-water-bottle',
    sentence: 'Get a better water bottle',
    targetIpa: 'ɡet ə ˈbetə ˈwɔːtə ˈbɒtl',
    feature: 'T_NOT_FLAPPED',
    difficulty: DIFFICULTY.SENTENCE,
    coachingNote: 'Four /t/ sounds between vowels. Tap the tongue tip firmly for each one.',
    hasRContext: true,
    sortOrder: 441,
  },
  {
    id: 'goat-go-home',
    sentence: 'Go home slowly on your own',
    targetIpa: 'ɡəʊ həʊm ˈsləʊli ɒn jɔːr əʊn',
    feature: 'GOAT',
    difficulty: DIFFICULTY.SENTENCE,
    coachingNote:
      'RP starts this diphthong from a central schwa — /əʊ/, not the American /oʊ/ which begins rounded.',
    hasRContext: true,
    sortOrder: 450,
  },
  {
    id: 'yod-new-tune',
    sentence: 'A new tune on Tuesday',
    targetIpa: 'ə njuː tjuːn ɒn ˈtjuːzdeɪ',
    feature: 'YOD',
    difficulty: DIFFICULTY.SENTENCE,
    coachingNote:
      'RP keeps the "y" glide after n, t and d — "nyoo", "tyoon", "Tyoosday", never "noo" or "toon".',
    hasRContext: false,
    sortOrder: 460,
  },

  // ═══ Level 5 — connected speech. Linking, reduction, natural pace. ═══
  {
    id: 'c-car-park-after',
    sentence: 'After we parked the car, we walked rather far to the shops',
    targetIpa: 'ˈɑːftə wi pɑːkt ðə kɑː wi wɔːkt ˈrɑːðə fɑː tə ðə ʃɒps',
    feature: 'NON_RHOTIC_R',
    difficulty: DIFFICULTY.CONNECTED,
    coachingNote:
      'Two clauses at natural pace. Five r-positions, none pronounced, plus BATH vowels in "after" and "rather".',
    hasRContext: true,
    sortOrder: 500,
  },
  {
    id: 'c-glass-water-dance',
    sentence: 'Ask for a glass of water after the dance class',
    targetIpa: 'ɑːsk fər ə ɡlɑːs əv ˈwɔːtə ˈɑːftə ðə dɑːns klɑːs',
    feature: 'BATH',
    difficulty: DIFFICULTY.CONNECTED,
    coachingNote:
      'Six BATH vowels at speed. Note the linking r in "for a" — RP does pronounce r before a vowel.',
    hasRContext: true,
    sortOrder: 501,
  },
];
