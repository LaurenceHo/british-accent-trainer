import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-cleans when test globals are enabled; they are not here.
afterEach(() => cleanup());

// jsdom has no media pipeline and logs "not implemented" for every load() call. Real
// browsers implement it; silencing it here keeps genuine warnings visible.
HTMLMediaElement.prototype.load = () => undefined;

// jsdom has no playback either. These behave like a browser that starts and stops at once,
// firing the events the A/B player listens to; tests spy on them to see which clip played.
HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
  this.dispatchEvent(new Event('play'));
  return Promise.resolve();
};
HTMLMediaElement.prototype.pause = function pause(this: HTMLMediaElement) {
  this.dispatchEvent(new Event('pause'));
};
