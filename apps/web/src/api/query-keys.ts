/**
 * Every TanStack Query key in the app, in one place.
 *
 * Keys are hierarchical so invalidation can be broad or narrow: invalidating
 * `queryKeys.attempts.all` clears every attempt list regardless of filter.
 */
export const queryKeys = {
  drills: {
    all: ['drills'] as const,
  },
  attempts: {
    all: ['attempts'] as const,
    forDrill: (drillId: string) => ['attempts', { drillId }] as const,
  },
  progress: {
    all: ['progress'] as const,
  },
  audio: {
    clip: (url: string) => ['audio', url] as const,
  },
} as const;
