import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/App';
import { fetchStub, json, renderWithClient } from './render';

afterEach(() => vi.unstubAllGlobals());

describe('App', () => {
  it('renders an accessible top-level heading inside a main landmark', () => {
    vi.stubGlobal('fetch', fetchStub({ '/api/drills': () => json({ drills: [] }) }).stub);

    renderWithClient(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'British Accent Trainer' }),
    ).toBeVisible();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
