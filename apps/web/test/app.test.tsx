import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  vi.restoreAllMocks();
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

  it('moves focus to the new view on navigation, but not on first load', async () => {
    // A hash change swaps content silently; focus is what makes a screen reader announce it.
    renderWithClient(<App />);
    expect(screen.getByRole('main')).not.toHaveFocus();

    await navigate('#/progress');

    expect(screen.getByRole('main', { name: 'Progress' })).toHaveFocus();
  });

  it('treats an unknown address as the practice screen', async () => {
    renderWithClient(<App />);

    await navigate('#/nowhere');

    expect(screen.getByRole('link', { name: 'Practise' })).toHaveAttribute('aria-current', 'page');
  });

  it('offers a skip link that moves focus to the content without changing the view', async () => {
    // A plain "#main" anchor would rewrite the hash, which is the router.
    window.location.hash = '#/progress';
    renderWithClient(<App />);

    const skip = screen.getByRole('link', { name: 'Skip to content' });
    await userEvent.click(skip);

    expect(screen.getByRole('main')).toHaveFocus();
    expect(window.location.hash).toBe('#/progress');
  });

  it('puts the skip link first in the tab order', async () => {
    renderWithClient(<App />);

    await userEvent.tab();

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
  });

  it('says when the app is offline, and stops saying so on reconnect', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    renderWithClient(<App />);
    expect(screen.queryByText(/You are offline/)).not.toBeInTheDocument();

    onLine.mockReturnValue(false);
    await act(async () => window.dispatchEvent(new Event('offline')));
    // Inside an always-present status region, so screen readers announce it.
    expect(screen.getByRole('status')).toHaveTextContent(/You are offline/);

    onLine.mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(screen.queryByText(/You are offline/)).not.toBeInTheDocument();
  });
});
