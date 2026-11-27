import { Text } from '@/components/scaled-text';
import { Fonts } from '@/constants/theme';
import { PriceRange, SeveralSkillsGuide, SkoFyApi } from '@/services/api';
import { BadgeDollarSign } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/** What this kind of job usually costs nearby, before posting — nothing when
 * there are too few past quotes to say (docs/MONEY_RULES_DESIGN.md §11). */
export function PriceGuideNote({ skillIds, lat, lng }: { skillIds: string[]; lat: number | null; lng: number | null }) {
  const [range, setRange] = useState<PriceRange | null>(null);
  const key = skillIds.join(',');

  useEffect(() => {
    if (!key || lat == null || lng == null) { setRange(null); return; }
    let live = true;
    SkoFyApi.priceGuide.forRequest(key.split(','), lat, lng)
      .then((r) => { if (live) setRange(r); })
      .catch(() => { if (live) setRange(null); });
    return () => { live = false; };
  }, [key, lat, lng]);

  if (!range) return null;
  return (
    <View style={s.box}>
      <BadgeDollarSign size={16} color="#065F46" />
      <Text style={s.text}>
        Usually {money(range.low)}–{money(range.high)} near you, from {range.samples} recent jobs. Your provider quotes
        the exact price after seeing the job.
      </Text>
    </View>
  );
}

const UNIT_WORD = { HOUR: 'hour', DAY: 'day', NIGHT: 'night' } as const;

/** A job of several skills charged by the hour, day or night: it's charged
 * once, at the provider's highest price among them. Before posting, what that
 * comes to near you, and which skill's price it usually is. Nothing when too
 * few providers nearby do all of them to say. */
export function SeveralSkillsPriceNote({ skillIds, unit, lat, lng }: {
  skillIds: string[]; unit: string | null; lat: number | null; lng: number | null;
}) {
  const [guide, setGuide] = useState<SeveralSkillsGuide | null>(null);
  const key = skillIds.join(',');
  const timed = unit === 'HOUR' || unit === 'DAY' || unit === 'NIGHT' ? unit : null;

  useEffect(() => {
    if (skillIds.length < 2 || !timed || lat == null || lng == null) { setGuide(null); return; }
    let live = true;
    SkoFyApi.priceGuide.forSeveral(key.split(','), timed, lat, lng)
      .then((g) => { if (live) setGuide(g); })
      .catch(() => { if (live) setGuide(null); });
    return () => { live = false; };
    // skillIds is read through key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, timed, lat, lng]);

  if (!guide) return null;
  const per = UNIT_WORD[guide.unit];
  const range = guide.low === guide.high ? `${money(guide.low)}` : `${money(guide.low)}–${money(guide.high)}`;
  return (
    <View style={s.box}>
      <BadgeDollarSign size={16} color="#065F46" />
      <Text style={s.text}>
        Usually {range} per {per} near you, from {guide.providers} providers who do all of these.
        {guide.sets_price ? ` The ${guide.sets_price} price is usually the highest, so it sets the rate.` : ''}
      </Text>
    </View>
  );
}

/** Beside a quote: the usual range, and a nudge when it's well above it. */
export function QuoteGuide({ jobId }: { jobId: string }) {
  const [guide, setGuide] = useState<{ range: PriceRange | null; quote_level: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    SkoFyApi.priceGuide.forJob(jobId).then((g) => { if (live) setGuide(g); }).catch(() => {});
    return () => { live = false; };
  }, [jobId]);

  if (!guide?.range) return null;
  const above = guide.quote_level === 'ABOVE';
  return (
    <View style={[s.box, above && s.warn]}>
      <BadgeDollarSign size={16} color={above ? '#92400E' : '#065F46'} />
      <Text style={[s.text, above && s.warnText]}>
        Similar jobs near you: {money(guide.range.low)}–{money(guide.range.high)}.
        {above ? ' This quote is well above that — ask what it includes, or counter.' : ''}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 10, padding: 10, borderRadius: 12,
    backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0',
  },
  text: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: Fonts.poppins, color: '#065F46' },
  warn: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  warnText: { color: '#92400E' },
});
