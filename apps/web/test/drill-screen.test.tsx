import type { Drill } from '@api/domain';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DrillScreen } from '@/components/drill-screen';
import { fetchStub, json, renderWithClient } from './render';

/** The panel is tested on its own; here it only needs to show which drill is selected. */
vi.mock('@/components/practice-panel', () => ({
  PracticePanel: ({ drill }: { drill: Drill }) => <p>Practising: {drill.sentence}</p>,
}));

const DRILLS: Drill[] = [
  {
    id: 'w-bath',
    sentence: 'bath',
    targetIpa: 'bɑːθ',
    feature: 'BATH',
    difficulty: 1,
    coachingNote: 'Long vowel.',
    hasRContext: false,
    sortOrder: 100,
  },
  {
    id: 'w-car',
    sentence: 'car',
    targetIpa: 'kɑː',
    feature: 'NON_RHOTIC_R',
    difficulty: 1,
    coachingNote: 'No r.',
    hasRContext: true,
    sortOrder: 101,
  },
  {
    id: 's-class',
    sentence: 'Ask the class about the bath',
    targetIpa: 'ɑːsk ðə klɑːs əˈbaʊt ðə bɑːθ',
    feature: 'BATH',
    difficulty: 4,
    coachingNote: 'Three BATH words.',
    hasRContext: false,
    sortOrder: 410,
  },
];

function withDrills(response: () => Response) {
  vi.stubGlobal('fetch', fetchStub({ '/api/drills': response }).stub);
}

afterEach(() => vi.unstubAllGlobals());

describe('DrillScreen', () => {
  it('groups drills under difficulty headings, easiest first', async () => {
    withDrills(() => json({ drills: DRILLS }));
    renderWithClient(<DrillScreen />);

    const nav = await screen.findByRole('navigation', { name: 'Drills' });
    const headings = within(nav).getAllByRole('heading').map((h) => h.textContent);

    expect(headings).toEqual(['Single word', 'Full sentence']);
  });

  it('selects the first drill by default', async () => {
    withDrills(() => json({ drills: DRILLS }));
    renderWithClient(<DrillScreen />);

    expect(await screen.findByText('Practising: bath')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'bath' })).toHaveAttribute('aria-current', 'true');
  });

  it('switches drill when another is chosen, and marks it current', async () => {
    withDrills(() => json({ drills: DRILLS }));
    renderWithClient(<DrillScreen />);

    await userEvent.click(await screen.findByRole('button', { name: 'car' }));

    expect(screen.getByText('Practising: car')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'car' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'bath' })).not.toHaveAttribute('aria-current');
  });

  it('explains how to fix an empty corpus', async () => {
    withDrills(() => json({ drills: [] }));
    renderWithClient(<DrillScreen />);

    expect(await screen.findByText(/db:seed/)).toBeInTheDocument();
  });

  it('shows an error when drills cannot be loaded', async () => {
    withDrills(() => json({ error: 'down' }, 500));
    renderWithClient(<DrillScreen />);

    expect(await screen.findByText('Drills could not be loaded')).toBeInTheDocument();
  });
});
