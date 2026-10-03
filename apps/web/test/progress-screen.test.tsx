import {
  RP_FEATURE_LABELS,
  RP_FEATURES,
  type Attempt,
  type DailyProgress,
  type Drill,
  type ProgressResponse,
  type RpFeature,
} from '@api/domain';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressScreen } from '@/components/progress-screen';
import { localDateString } from '@/progress/trend';
import { fetchStub, json, renderWithClient, type Routes } from './render';

const TODAY = localDateString(new Date());

/** A progress response with the given days for some features; the rest unpractised. */
function progress(days: Partial<Record<RpFeature, DailyProgress[]>> = {}): ProgressResponse {
  return {
    measures: 'clarity',
    windowDays: 90,
    features: RP_FEATURES.map((feature) => {
      const d = days[feature] ?? [];
      return {
        feature,
        label: RP_FEATURE_LABELS[feature],
        attempts: d.reduce((sum, x) => sum + x.attempts, 0),
        days: d,
      };
    }),
  };
}

const DRILL: Drill = {
  id: 'w-bath',
  sentence: 'bath',
  targetIpa: 'bɑːθ',
  feature: 'BATH',
  difficulty: 1,
  coachingNote: '',
  hasRContext: false,
  sortOrder: 100,
};

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: 'a1',
    drillId: 'w-bath',
    createdAt: '2026-10-01T09:30:00.000Z',
    accuracyScore: 64,
    fluencyScore: null,
    completenessScore: null,
    pronScore: null,
    wordScores: [],
    featureFindings: [],
    audioKey: 'attempts/a1.wav',
    ...overrides,
  };
}

function renderScreen(routes: Routes = {}) {
  const fetch = fetchStub({
    '/api/progress': () => json(progress()),
    '/api/attempts': () => json({ attempts: [] }),
    '/api/drills': () => json({ drills: [DRILL] }),
    ...routes,
  });
  vi.stubGlobal('fetch', fetch.stub);
  renderWithClient(<ProgressScreen />);
  return fetch;
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ProgressScreen', () => {
  it('asks for 90 days, broken at the learner’s local midnight', async () => {
    // Pinned: CI runs in UTC, where an offset of 0 would hide a wrong sign. getTimezoneOffset
    // reports minutes *west*, so UTC+10 is -600; the API wants minutes east, +600.
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-600);
    const fetch = renderScreen();
    await screen.findByRole('heading', { name: 'Clarity by feature' });

    const url = fetch.calls.find((c) => c.url.startsWith('/api/progress'))!.url;
    expect(url).toBe('/api/progress?days=90&tzOffsetMinutes=600');
  });

  it('captions every number as clarity, not accent', async () => {
    renderScreen({ '/api/progress': () => json(progress({ BATH: [day(TODAY, 60)] })) });

    expect(await screen.findByText(/not a measure of accent/)).toBeInTheDocument();
    expect(screen.queryByText(/accent score|how british|RP score/i)).not.toBeInTheDocument();
  });

  it('shows one trend per feature, including the ones not practised', async () => {
    renderScreen({ '/api/progress': () => json(progress({ BATH: [day(TODAY, 60)] })) });

    const charts = await screen.findAllByRole('img', { name: /clarity/ });
    expect(charts).toHaveLength(RP_FEATURES.length);
    expect(screen.getAllByText('Not practised yet')).toHaveLength(RP_FEATURES.length - 1);
  });

  it('names each chart with what it shows, so the line need not be seen', async () => {
    renderScreen({
      '/api/progress': () =>
        json(progress({ BATH: [day(daysAgo(10), 52), day(daysAgo(3), 60), day(TODAY, 71)] })),
    });

    expect(
      await screen.findByRole('img', {
        name: 'TRAP–BATH split clarity: 3 days practised, from 52 to 71.',
      }),
    ).toBeInTheDocument();
  });

  it('places days by date, today at the right edge and the window start at the left', async () => {
    renderScreen({
      '/api/progress': () => json(progress({ BATH: [day(daysAgo(89), 40), day(TODAY, 80)] })),
    });

    const points = await screen.findAllByTestId('trend-point');
    expect(points[0]).toHaveStyle({ left: '0.00%', bottom: '40.00%' });
    expect(points[1]).toHaveStyle({ left: '100.00%', bottom: '80.00%' });
  });

  it('lists the numbers in a table', async () => {
    renderScreen({ '/api/progress': () => json(progress({ BATH: [day(TODAY, 64, 3)] })) });

    await userEvent.click(await screen.findByText('Show the numbers'));
    const row = screen.getByRole('row', { name: new RegExp(TODAY) });
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual([TODAY, '3', '64']);
  });

  it('says there is nothing yet, and points to the drills', async () => {
    renderScreen();

    expect(await screen.findByText(/No attempts in the last 90 days/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Record a drill' })).toHaveAttribute('href', '#/');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('explains when progress cannot be loaded', async () => {
    renderScreen({ '/api/progress': () => json({ error: 'down' }, 500) });

    expect(await screen.findByText('Progress could not be loaded')).toBeInTheDocument();
  });
});

describe('Recent attempts', () => {
  it('lists attempts by drill sentence, with their clarity', async () => {
    renderScreen({ '/api/attempts': () => json({ attempts: [attempt()] }) });

    const item = await screen.findByRole('listitem');
    expect(item).toHaveTextContent('bath');
    expect(item).toHaveTextContent('Clarity 64');
  });

  it('asks for the latest ten', async () => {
    const fetch = renderScreen();
    await screen.findByText('None yet.');

    expect(fetch.calls.some((c) => c.url === '/api/attempts?limit=10')).toBe(true);
  });

  it('downloads a recording only when asked to replay it', async () => {
    const fetch = renderScreen({
      '/api/attempts/a1/audio': () => new Response(new Uint8Array([1, 2, 3])),
      '/api/attempts': () => json({ attempts: [attempt()] }),
    });
    const replay = await screen.findByRole('button', { name: 'Replay' });
    expect(fetch.calls.some((c) => c.url.endsWith('/audio'))).toBe(false);

    await userEvent.click(replay);

    expect(replay).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(fetch.calls.some((c) => c.url === '/api/attempts/a1/audio')).toBe(true));
    expect(await screen.findByLabelText(/^Your attempt,/)).toBeInTheDocument();
  });

  it('says when a recording was not stored, instead of offering a broken player', async () => {
    renderScreen({ '/api/attempts': () => json({ attempts: [attempt({ audioKey: null })] }) });

    expect(await screen.findByText('Recording not stored')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replay' })).not.toBeInTheDocument();
  });

  it('says when a stored recording has since gone', async () => {
    renderScreen({
      '/api/attempts/a1/audio': () => json({ error: 'audio is no longer available' }, 404),
      '/api/attempts': () => json({ attempts: [attempt()] }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Replay' }));

    expect(await screen.findByText('This recording is no longer available.')).toBeInTheDocument();
  });
});

function day(date: string, averageAccuracy: number, attempts = 1): DailyProgress {
  return { date, attempts, averageAccuracy, averageFluency: null };
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateString(d);
}
