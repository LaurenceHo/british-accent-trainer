import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-cleans when test globals are enabled; they are not here.
afterEach(() => cleanup());

// jsdom has no media pipeline and logs "not implemented" for every load() call. Real
// browsers implement it; silencing it here keeps genuine warnings visible.
HTMLMediaElement.prototype.load = () => undefined;
