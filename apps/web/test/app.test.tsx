import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '@/App';

describe('App', () => {
  it('renders an accessible top-level heading', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'British Accent Trainer' })).toBeVisible();
  });

  it('places content in a main landmark', () => {
    render(<App />);

    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
