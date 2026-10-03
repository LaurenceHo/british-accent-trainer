import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchDrills, submitAttempt } from './client';
import { queryKeys } from './query-keys';

/**
 * Data hooks. Components never call `useQuery` or `useMutation` directly — they use these,
 * so query keys, fetchers and cache invalidation live in one place.
 */

/** Every drill, easiest first. Drills change only on re-seed, so they rarely refetch. */
export function useDrills() {
  return useQuery({
    queryKey: queryKeys.drills.all,
    queryFn: fetchDrills,
    staleTime: 5 * 60 * 1000,
  });
}

/** Variables for {@link useSubmitAttempt}. */
export interface SubmitAttemptVariables {
  readonly drillId: string;
  readonly wav: ArrayBuffer;
}

/**
 * Submits a recording for scoring.
 *
 * On success it invalidates attempt history and progress, since a new attempt changes both.
 * It does not retry: a failed submission is usually unrecognised speech or a throttled
 * free tier, and silently resubmitting would spend another transcription on the same take.
 */
export function useSubmitAttempt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ drillId, wav }: SubmitAttemptVariables) => submitAttempt(drillId, wav),
    retry: false,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.attempts.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.progress.all }),
      ]);
    },
  });
}

/**
 * Fetches a recording as a Blob, for playback through an object URL.
 *
 * Playing from a blob rather than `<audio src>` sidesteps Safari, which expects byte-range
 * (206) responses for media elements and gets none from these endpoints.
 *
 * @param url - A reference or attempt audio URL, or null to fetch nothing.
 * @param immutable - Attempt audio never changes once written, so it never refetches.
 *   Reference audio can change when a drill is edited, so it revalidates; its ETag makes
 *   an unchanged recording a cheap 304.
 */
export function useAudioBlob(url: string | null, immutable = false) {
  return useQuery({
    queryKey: queryKeys.audio.clip(url ?? ''),
    queryFn: async () => {
      const response = await fetch(url ?? '');
      if (!response.ok) throw new Error(`Audio unavailable (${response.status})`);
      return response.blob();
    },
    enabled: url !== null,
    staleTime: immutable ? Infinity : 0,
  });
}
