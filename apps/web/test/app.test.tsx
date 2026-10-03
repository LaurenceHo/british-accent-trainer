import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/App';
import { fetchStub, json, renderWithClient } from './render';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    fetchStub({
      '/api/drills': () => json({ drills: [] }),
      '/api/progress': () => json({ measures: 'clarity', windowDays: 90, features: [] }),
      '/api/attempts': () => json({ attempts: [] }),
    }).stub,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

/** Navigates as a link click would, and lets React see the hashchange. */
async function navigate(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

describe('App', () => {
  it('renders an accessible top-level heading inside a main landmark', () => {
    renderWithClient(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'British Accent Trainer' }),
    ).toBeVisible();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('opens on practice, marked as the current page', () => {
    renderWithClient(<App />);

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav).toContainElement(screen.getByRole('link', { name: 'Practise' }));
    expect(screen.getByRole('link', { name: 'Practise' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Progress' })).not.toHaveAttribute('aria-current');
    expect(document.title).toBe('Practise · British Accent Trainer');
  });

  it('switches to progress by URL, so back and deep links work', async () => {
    renderWithClient(<App />);

    await navigate('#/progress');

    expect(await screen.findByRole('heading', { name: 'Clarity by feature' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Progress' })).toHaveAttribute('aria-current', 'page');
    expect(document.title).toBe('Progress · British Accent Trainer');

    await navigate('#/');
    expect(screen.queryByRole('heading', { name: 'Clarity by feature' })).not.toBeInTheDocument();
  });

  it('treats an unknown address as the practice screen', async () => {
    renderWithClient(<App />);

    await navigate('#/nowhere');

    expect(screen.getByRole('link', { name: 'Practise' })).toHaveAttribute('aria-current', 'page');
  });
});
