import type { DailyProgress } from '@api/domain';

/** One day of progress on a feature. A null average is a day practised but never scored. */
export const day = (
  date: string,
  averageAccuracy: number | null,
  attempts = 1,
): DailyProgress => ({ date, attempts, averageAccuracy, averageFluency: null });
