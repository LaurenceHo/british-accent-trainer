import type { Drill } from '@api/domain';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recorder, RecorderState } from '@/audio/use-recorder';
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

/** Serves the reference audio (plus any extra routes) and renders the panel. */
function renderPanel(extra: Routes = {}) {
  const fetch = fetchStub({
    '/api/drills/w-bath/reference-audio': () => new Response(new Blob(['ref'])),
    ...extra,
  });
  vi.stubGlobal('fetch', fetch.stub);
  renderWithClient(<PracticePanel drill={DRILL} />);
  return fetch;
}

/** Renders the panel holding a finished take, and submits it to be answered by `response`. */
async function submitTake(response: () => Response) {
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
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
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
    await submitTake(() =>
      json({ error: 'No speech was recognised.', code: 'not-recognised' }, 400),
    );

    expect(await screen.findByText('No speech was recognised.')).toBeInTheDocument();
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
