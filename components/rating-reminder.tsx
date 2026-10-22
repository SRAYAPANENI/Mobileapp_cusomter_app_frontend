import { RatingDimensions, RatingModal } from '@/components/ui/rating-modal';
import type { OffAppAnswer } from '@/components/off-app-question';
import { TipSheet } from '@/components/tip-sheet';
import { useAppAlert } from '@/components/app-alert';
import { SkoFyApi } from '@/services/api';
import { isRatingSkipped, markRatingSkipped, markRatingSubmitted, nextPendingRating, PendingRating } from '@/services/ratingReminders';
import { useIsFocused } from '@react-navigation/native';
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
  // A Modal shows over everything even when its screen isn't the one on top
  // — a reminder loaded by a screen further down the stack stayed visible
  // over the tracking screen's own rating sheet: two rating popups at once.
  const isFocused = useIsFocused();
  // After rating: an optional tip (§11).
  const [tip, setTip] = useState<{ jobId: string; name: string } | null>(null);
  const appAlert = useAppAlert();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      nextPendingRating().then(next => { if (active) setPending(next); });
      return () => { active = false; };
    }, [])
  );

  const tipSheet = (
    <>
      <TipSheet
        jobId={isFocused ? tip?.jobId ?? null : null}
        providerName={tip?.name ?? 'your provider'}
        onClose={() => setTip(null)}
        onMessage={(kind, title, message) => appAlert.show(kind, title, message)}
      />
      {appAlert.element}
    </>
  );

  // Answered on another screen since this one loaded it.
  if (!pending || !isFocused || isRatingSkipped(pending.job_id)) return tipSheet;

  const submit = async (ratings: RatingDimensions, comment: string, offApp: OffAppAnswer) => {
    await SkoFyApi.jobs.submitReview(pending.job_id, { ...ratings, comment, ...offApp });
    markRatingSubmitted(pending.job_id);
  };

  return (
    <RatingModal
      key={pending.job_id}
      visible
      providerName={pending.counterpart_name}
      onSubmit={submit}
      onClose={() => setPending(null)}
      onSkip={() => { markRatingSkipped(pending.job_id); setPending(null); }}
      onTip={() => { setTip({ jobId: pending.job_id, name: pending.counterpart_name }); setPending(null); }}
    />
  );
}
