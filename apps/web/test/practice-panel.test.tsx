import type { Drill } from '@api/domain';
import { focusManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recorder, RecorderState } from '@/audio/use-recorder';
import { encodeWav } from '@/audio/wav-encoder';
import { PracticePanel } from '@/components/practice-panel';
import { fetchStub, json, renderWithClient, type Routes } from './render';

/**
 * The recorder is replaced with one whose state each test sets directly — it has its own
 * tests against fake media APIs. These cover what the learner sees and what is submitted.
 */
let recorderState: RecorderState = { status: 'idle' };
const recorderActions = { start: vi.fn(async () => undefined), stop: vi.fn(), reset: vi.fn() };

vi.mock('@/audio/use-recorder', () => ({
  useRecorder: (): Recorder => ({ state: recorderState, ...recorderActions }),
}));

const DRILL: Drill = {
  id: 'w-bath',
  sentence: 'bath',
  targetIpa: 'bɑːθ',
  feature: 'BATH',
  difficulty: 1,
  coachingNote: 'The long vowel of "father".',
  hasRContext: false,
  sortOrder: 100,
};

const TAKE = new ArrayBuffer(64);

/**
 * A reference-audio response. The body is bytes, not a `Blob`: under jsdom, `Blob` is
 * jsdom's, which has no `stream()`, and older Node `fetch` implementations throw when
 * handed one. The stub then rejects, the query retries after a second, and every test
 * waiting on the audio times out — on CI only, where Node is older than locally.
 */
const referenceAudio = () => new Response(new Uint8Array([1, 2, 3]));

/** Serves the reference audio (plus any extra routes) and renders the panel. */
function renderPanel(extra: Routes = {}) {
  const fetch = fetchStub({
    '/api/drills/w-bath/reference-audio': referenceAudio,
    ...extra,
  });
  vi.stubGlobal('fetch', fetch.stub);
  const { container } = renderWithClient(<PracticePanel drill={DRILL} />);
  return { ...fetch, container };
}

/** Renders the panel holding a finished take, and submits it to be answered by `response`. */
async function submitTake(response: Routes[string]) {
  recorderState = { status: 'done', wav: TAKE };
  const fetch = renderPanel({ '/api/attempts': response });
  await userEvent.click(screen.getByRole('button', { name: 'Check clarity' }));
  return fetch;
}

const scored = (overrides: Record<string, unknown> = {}) => () =>
  json(
    {
      attempt: { id: 'a1', drillId: 'w-bath', accuracyScore: 64 },
      recognisedText: 'Bath.',
      audioStored: true,
      ...overrides,
    },
    201,
  );

beforeEach(() => {
  recorderState = { status: 'idle' };
  // jsdom lacks object URLs. Assigned onto the real URL rather than replacing the global,
  // which would leave `new URL()` broken for anything else in the code path.
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PracticePanel', () => {
  it('shows the sentence, its target IPA marked as IPA, and the coaching note', () => {
    renderPanel();

    expect(screen.getByRole('heading', { level: 2, name: 'bath' })).toBeInTheDocument();
    // und-fonipa stops screen readers reading the IPA as if it were English.
    expect(screen.getByText('/bɑːθ/')).toHaveAttribute('lang', 'und-fonipa');
    expect(screen.getByText('The long vowel of "father".')).toBeInTheDocument();
  });

  it('labels the feature and difficulty in words', () => {
    renderPanel();

    expect(screen.getByText('TRAP–BATH split')).toBeInTheDocument();
    expect(screen.getByText('Single word')).toBeInTheDocument();
  });

  it('loads the native reference for playback', async () => {
    const fetch = renderPanel();

    expect(await screen.findByLabelText('Native reference')).toBeInTheDocument();
    expect(fetch.calls[0]?.url).toBe('/api/drills/w-bath/reference-audio');
  });

  it('submits the take for this drill', async () => {
    const fetch = await submitTake(scored());

    await waitFor(() => {
      const post = fetch.calls.find((c) => c.url.startsWith('/api/attempts'));
      expect(post?.url).toBe('/api/attempts?drillId=w-bath');
      expect(post?.init?.body).toBe(TAKE);
    });
  });

  it('captions the score as clarity and says it is not an accent measure', async () => {
    // Uncaptioned, "64" would read as "64% British", which the API cannot measure.
    await submitTake(scored());

    expect(await screen.findByRole('heading', { name: 'Clarity' })).toBeInTheDocument();
    expect(screen.getByText('64')).toBeInTheDocument();
    expect(screen.getByText(/not a measure of accent/i)).toBeInTheDocument();
    expect(screen.queryByText(/accent score|how british/i)).not.toBeInTheDocument();
  });

  it('shows what the recogniser heard', async () => {
    await submitTake(scored());

    expect(await screen.findByText('Bath.')).toBeInTheDocument();
  });

  it('warns when the score was kept but the audio could not be stored', async () => {
    await submitTake(scored({ audioStored: false }));

    expect(await screen.findByText(/could not be stored for later replay/)).toBeInTheDocument();
  });

  it('shows the API message when scoring fails', async () => {
    await submitTake(() => json({ error: 'The scoring service is busy.', code: 'throttled' }, 503));

    expect(await screen.findByText('The scoring service is busy.')).toBeInTheDocument();
  });

  it('asks for a new take rather than resubmitting audio the recogniser could not hear', async () => {
    // Resubmitting the same unheard take would spend another transcription on a known result.
    await submitTake(() =>
      json({ error: 'No speech was recognised.', code: 'not-recognised' }, 400),
    );

    expect(await screen.findByText(/No speech was recognised\./)).toBeInTheDocument();
    expect(screen.getByText(/Record a new take/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check clarity' })).not.toBeInTheDocument();
  });

  it('explains a network failure rather than showing a generic error', async () => {
    await submitTake(() => Promise.reject(new TypeError('Failed to fetch')));

    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument();
  });

  it.each([
    ['denied', /refused/],
    ['no-device', /No microphone/],
    ['unsupported', /HTTPS/],
    ['too-short', /too short to check/],
    ['failed', /could not be processed/],
  ] as const)('explains a %s recording failure in plain words', (reason, message) => {
    recorderState = { status: 'error', reason };
    renderPanel();

    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('offers stop while recording, and nothing to submit yet', () => {
    recorderState = { status: 'recording' };
    renderPanel();

    expect(screen.getByRole('button', { name: 'Stop recording' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check clarity' })).not.toBeInTheDocument();
  });
});

describe('after a result', () => {
  it('clears the old score when a new take is recorded, and lets the new take be submitted', async () => {
    // Previously the old score stayed beside a recording it never scored, and "Check
    // clarity" stayed hidden, so the new take could not be submitted at all.
    await submitTake(scored());
    expect(await screen.findByRole('heading', { name: 'Clarity' })).toBeInTheDocument();

    recorderState = { status: 'done', wav: new ArrayBuffer(128) };
    await userEvent.click(screen.getByRole('button', { name: 'Record again' }));

    expect(screen.queryByRole('heading', { name: 'Clarity' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check clarity' })).toBeInTheDocument();
  });

  it('shows the score inside the clarity section, not merely somewhere on the page', async () => {
    await submitTake(scored());

    const section = (await screen.findByRole('heading', { name: 'Clarity' })).closest('section');
    expect(section).not.toBeNull();
    expect(within(section as HTMLElement).getByText('64')).toBeInTheDocument();
    expect(within(section as HTMLElement).getByText(/not a measure of accent/i)).toBeInTheDocument();
  });

  it('moves focus to the result, rather than dropping it to the page body', async () => {
    // The focused "Check clarity" button unmounts as the result appears.
    await submitTake(scored());

    const heading = await screen.findByRole('heading', { name: 'Clarity' });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('returns focus to the record button after "Try again"', async () => {
    await submitTake(scored());
    await screen.findByRole('heading', { name: 'Clarity' });

    recorderState = { status: 'idle' };
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByRole('button', { name: 'Record' })).toHaveFocus();
  });
});

describe('the reference recording', () => {
  it('is not refetched when the window regains focus, which would restart playback', async () => {
    // Every refetch yields a new Blob, and a new Blob reloads the player from zero.
    const fetch = renderPanel();
    await screen.findByLabelText('Native reference');

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const referenceCalls = fetch.calls.filter((c) => c.url.endsWith('/reference-audio'));
    expect(referenceCalls).toHaveLength(1);
    focusManager.setFocused(undefined);
  });

  it('keeps cached audio playable when a later refetch fails', async () => {
    // A failed background refetch must not replace playable audio with an error.
    let fail = false;
    const fetch = fetchStub({
      '/api/drills/w-bath/reference-audio': () =>
        fail ? json({ error: 'down' }, 500) : referenceAudio(),
    });
    vi.stubGlobal('fetch', fetch.stub);
    const { client } = renderWithClient(<PracticePanel drill={DRILL} />);
    await screen.findByLabelText('Native reference');

    fail = true;
    await client.refetchQueries();
    await waitFor(() => expect(fetch.calls).toHaveLength(2));

    expect(screen.getByLabelText('Native reference')).toBeInTheDocument();
    expect(screen.queryByText(/unavailable right now/)).not.toBeInTheDocument();
  });
});

describe('comparing a take with the reference', () => {
  /** A real 1 s WAV, so the take's waveform is drawn. */
  const wavTake = () => encodeWav(new Float32Array(16_000).fill(0.1), 16_000);
  const bathUnclear = {
    wordScores: [{ word: 'bath', score: 30, phonemes: [{ score: 30, offset: 0, duration: 5_000_000 }] }],
  };

  it('replaces the standalone reference player with the comparison once there is a take', () => {
    recorderState = { status: 'done', wav: wavTake() };
    const { container } = renderPanel();

    expect(screen.getByRole('heading', { name: 'Compare' })).toBeInTheDocument();
    // Two reference players could play over each other.
    expect(container.querySelector('audio[aria-label="Native reference"]')).toBeNull();
  });

  it('marks unclear words once the take is scored', async () => {
    recorderState = { status: 'done', wav: wavTake() };
    renderPanel({ '/api/attempts': scored({ attempt: { id: 'a1', drillId: 'w-bath', accuracyScore: 64, ...bathUnclear } }) });

    await userEvent.click(screen.getByRole('button', { name: 'Check clarity' }));

    expect(await screen.findByTestId('unclear-marker')).toHaveTextContent('bath');
  });

  it('drops the old markers when a new take is recorded', async () => {
    recorderState = { status: 'done', wav: wavTake() };
    renderPanel({ '/api/attempts': scored({ attempt: { id: 'a1', drillId: 'w-bath', accuracyScore: 64, ...bathUnclear } }) });
    await userEvent.click(screen.getByRole('button', { name: 'Check clarity' }));
    await screen.findByTestId('unclear-marker');

    recorderState = { status: 'done', wav: wavTake() };
    await userEvent.click(screen.getByRole('button', { name: 'Record again' }));

    expect(screen.queryByTestId('unclear-marker')).not.toBeInTheDocument();
  });
});

describe('a failed reference alongside a take', () => {
  it('says the reference is unavailable, rather than loading forever', async () => {
    recorderState = { status: 'done', wav: TAKE };
    vi.stubGlobal(
      'fetch',
      fetchStub({ '/api/drills/w-bath/reference-audio': () => json({ error: 'down' }, 500) }).stub,
    );
    renderWithClient(<PracticePanel drill={DRILL} />);

    expect(await screen.findByText('The reference recording is unavailable right now.')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });
});

describe('offline', () => {
  afterEach(() => vi.restoreAllMocks());

  it('disables checking clarity while offline, saying why, and re-enables it on reconnect', async () => {
    // Offline the request could only fail; the learner is told before trying, not after.
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    recorderState = { status: 'done', wav: TAKE };
    renderPanel();

    const check = screen.getByRole('button', { name: 'Check clarity' });
    expect(check).toBeDisabled();
    expect(check).toHaveAccessibleDescription('Checking clarity needs a connection.');

    onLine.mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event('online')));

    expect(screen.getByRole('button', { name: 'Check clarity' })).toBeEnabled();
    expect(screen.queryByText('Checking clarity needs a connection.')).not.toBeInTheDocument();
  });
});
