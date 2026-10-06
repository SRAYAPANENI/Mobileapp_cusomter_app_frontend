import { RatingDimensions, RatingModal } from '@/components/ui/rating-modal';
import { SkoFyApi } from '@/services/api';
import { markRatingSkipped, nextPendingRating, PendingRating } from '@/services/ratingReminders';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';

/**
 * Asks the customer to rate a finished job (completed OR disputed) they
 * haven't rated yet, each time the hosting screen comes into focus.
 * "Maybe later" hides it for the rest of this app session; it comes back
 * next time the app is opened until the rating is submitted. Previously the
 * only prompts were on the live tracking/chat screens, so closing one (or
 * never being on those screens when the job finished) meant the provider
 * was never rated.
 */
export function RatingReminder() {
  const [pending, setPending] = useState<PendingRating | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      nextPendingRating().then(next => { if (active) setPending(next); });
      return () => { active = false; };
    }, [])
  );

  if (!pending) return null;

  const submit = async (ratings: RatingDimensions, comment: string) => {
    await SkoFyApi.jobs.submitReview(pending.job_id, { ...ratings, comment });
  };

  return (
    <RatingModal
      key={pending.job_id}
      visible
      providerName={pending.counterpart_name}
      onSubmit={submit}
      onClose={() => setPending(null)}
      onSkip={() => { markRatingSkipped(pending.job_id); setPending(null); }}
    />
  );
}
