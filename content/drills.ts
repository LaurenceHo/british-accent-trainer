import type { Drill } from '../apps/api/src/domain';

/**
 * The drill corpus.
 *
 * Version-controlled content, not database seed data — edit here and re-run
 * `bun run db:seed`. Keeping it out of migrations means a wording fix is a one-line diff
 * rather than another append-only migration, and a wrong `feature` value is a compile
 * error rather than a bad row.
 *
 * Each sentence deliberately **loads its target feature several times**, so a single
 * recording yields multiple data points on the same contrast. That density is the reason
 * these are hand-authored rather than lifted from a found corpus.
 *
 * IPA is RP, transcribed for careful connected speech. `hasRContext` marks sentences with
 * a post-vocalic r position — only those can be judged by the rhoticity detector.
 */
export const DRILLS: readonly Drill[] = [
  // ─── Non-rhotic /r/ — the single most diagnostic RP feature ───
  {
    id: 'rhotic-car-park',
    sentence: 'The car park is over there',
    targetIpa: 'ðə ˈkɑː pɑːk ɪz ˈəʊvə ðeə',
    feature: 'NON_RHOTIC_R',
    coachingNote:
      'Four r-positions, none of them pronounced: ca(r), pa(r)k, ove(r), the(re). The vowel simply lengthens and stops.',
    hasRContext: true,
    sortOrder: 10,
  },
  {
    id: 'rhotic-better-water',
    sentence: 'Better water for my father',
    targetIpa: 'ˈbetə ˈwɔːtə fə maɪ ˈfɑːðə',
    feature: 'NON_RHOTIC_R',
    coachingNote:
      'Every word ends in a plain schwa — "bettuh", "watuh", "fathuh". Resist curling the tongue at the end.',
    hasRContext: true,
    sortOrder: 11,
  },
  {
    id: 'rhotic-nurse-work',
    sentence: 'The nurse heard the first word',
    targetIpa: 'ðə nɜːs hɜːd ðə fɜːst wɜːd',
    feature: 'NON_RHOTIC_R',
    coachingNote:
      'The NURSE vowel /ɜː/ is a long, flat, centre-of-the-mouth sound with no r-colouring at all.',
    hasRContext: true,
    sortOrder: 12,
  },

  // ─── TRAP–BATH split ───
  {
    id: 'bath-class-ask',
    sentence: 'Ask the class about the bath',
    targetIpa: 'ɑːsk ðə klɑːs əˈbaʊt ðə bɑːθ',
    feature: 'BATH',
    coachingNote:
      'Ask, class and bath all take the long /ɑː/ of "father" — not the short /æ/ of "cat".',
    hasRContext: false,
    sortOrder: 20,
  },
  {
    id: 'bath-half-past',
    sentence: 'Half past, after the dance',
    targetIpa: 'hɑːf pɑːst ˈɑːftə ðə dɑːns',
    feature: 'BATH',
    coachingNote: 'Four BATH words in a row. Keep the vowel long and open throughout.',
    hasRContext: true,
    sortOrder: 21,
  },

  // ─── LOT vowel /ɒ/ ───
  {
    id: 'lot-tom-job',
    sentence: 'Tom got a job in the shop',
    targetIpa: 'tɒm ɡɒt ə dʒɒb ɪn ðə ʃɒp',
    feature: 'LOT',
    coachingNote:
      'Four short, rounded /ɒ/ vowels. The lips round; American English unrounds this to /ɑ/.',
    hasRContext: false,
    sortOrder: 30,
  },
  {
    id: 'lot-hot-coffee',
    sentence: 'The dog wants a lot of hot coffee',
    targetIpa: 'ðə dɒɡ wɒnts ə lɒt əv hɒt ˈkɒfi',
    feature: 'LOT',
    coachingNote: 'Short and rounded every time — "coffee" is /ˈkɒfi/, never "cawfee".',
    hasRContext: false,
    sortOrder: 31,
  },

  // ─── THOUGHT vowel /ɔː/ ───
  {
    id: 'thought-saw-four',
    sentence: 'I thought I saw four tall walls',
    targetIpa: 'aɪ θɔːt aɪ sɔː fɔː tɔːl wɔːlz',
    feature: 'THOUGHT',
    coachingNote:
      'THOUGHT /ɔː/ is longer and more rounded than LOT /ɒ/. RP keeps "caught" and "cot" clearly apart.',
    hasRContext: true,
    sortOrder: 40,
  },

  // ─── Unflapped /t/ ───
  {
    id: 't-little-butter',
    sentence: 'A little bit of butter',
    targetIpa: 'ə ˈlɪtl bɪt əv ˈbʌtə',
    feature: 'T_NOT_FLAPPED',
    coachingNote:
      'Each /t/ is a real, crisp t. American English turns these into a quick d — "liddle bidda budder".',
    hasRContext: true,
    sortOrder: 50,
  },
  {
    id: 't-water-bottle',
    sentence: 'Get a better water bottle',
    targetIpa: 'ɡet ə ˈbetə ˈwɔːtə ˈbɒtl',
    feature: 'T_NOT_FLAPPED',
    coachingNote: 'Four /t/ sounds between vowels. Tap the tongue tip firmly for each one.',
    hasRContext: true,
    sortOrder: 51,
  },

  // ─── GOAT diphthong ───
  {
    id: 'goat-go-home',
    sentence: 'Go home slowly on your own',
    targetIpa: 'ɡəʊ həʊm ˈsləʊli ɒn jɔːr əʊn',
    feature: 'GOAT',
    coachingNote:
      'RP starts this diphthong from a central schwa — /əʊ/, not the American /oʊ/ which begins rounded.',
    hasRContext: true,
    sortOrder: 60,
  },

  // ─── Retained yod ───
  {
    id: 'yod-new-tune',
    sentence: 'A new tune on Tuesday',
    targetIpa: 'ə njuː tjuːn ɒn ˈtjuːzdeɪ',
    feature: 'YOD',
    coachingNote:
      'RP keeps the "y" glide after n, t and d — "nyoo", "tyoon", "Tyoosday", never "noo" or "toon".',
    hasRContext: false,
    sortOrder: 70,
  },
];
