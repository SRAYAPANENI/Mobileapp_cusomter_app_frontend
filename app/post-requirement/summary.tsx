import { ThemedText } from '@/components/themed-text';
import { PriceGuideNote, SeveralSkillsPriceNote } from '@/components/price-guide-note';
import { useAppConfig } from '@/services/queries/app-config';
import { JobShapePicker } from '@/components/job-shape-picker';
import { CareSheetForm } from '@/components/care-sheet-form';
import { CareSheet, EMPTY_CARE_SHEET, careSheetPayload, careSheetProblem } from '@/services/care-sheet';
import { DEFAULT_CHOICE, JobChoice, deviceTimeZone, normalize, shapeFor } from '@/services/job-shape';
import { SkillGroup, groupName, groupNotBookable, groupPriceNote, groupPricing, groupSkills, groupVenues } from '@/services/skill-groups';
import { useJobSkills } from '@/hooks/use-job-skills';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { usePostRequirement } from '@/context/PostRequirementContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { fromParts, hasPassed } from '@/services/schedule-slots';
import { router } from 'expo-router';
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  MapPin,
  Sparkles,
  Zap
} from 'lucide-react-native';
import { useAppAlert } from '@/components/app-alert';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { FadeInUp, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function JobSummaryScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const insets = useSafeAreaInsets();
  const { data, updateData, resetData } = usePostRequirement();
  const alert = useAppAlert();
  const [isPosting, setIsPosting] = useState(false);
  // Posted: the draft is cleared when the customer leaves this screen, not
  // while they're still on it — clearing it here re-rendered the form empty
  // behind the success popup ("No location selected" in red), and left a
  // live Post button that could send the same job twice.
  const [posted, setPosted] = useState(false);
  const postedRef = useRef(false);
  useEffect(() => () => { if (postedRef.current) resetData(); }, []);

  // Where (and so On-site vs Remote) is decided here, as the LAST thing
  // before posting — not up front: a remote job needs no location at all,
  // and where it happens is a decision, not information the customer had to
  // have when they started describing the problem (JobShapePicker below).

  // An ordinary job's where / how long / in care (services/job-shape.ts);
  // a pickup and delivery has its own flow.
  const ordinary = data.jobKind !== 'PICKUP_DROPOFF';

  // How the chosen skill is priced (one standard way per profession) — only
  // the questions it needs are asked, and the job is posted that way.
  const { data: appConfig } = useAppConfig();
  const hosting = appConfig?.modules.hosting !== false;
  const { state: skillsState, skills, retry: retrySkills } = useJobSkills(data.profession, ordinary);
  // The jobs the chosen skills make: usually one; several when they can't
  // share a price or a place (services/skill-groups.ts).
  const groups = React.useMemo<SkillGroup[]>(() => {
    if (!ordinary || skillsState !== 'ready') return [];
    const chosen = data.skill_ids.map((id) => skills.find((sk) => sk.id === id)).filter((sk) => !!sk);
    // Chosen by name while the list couldn't load. Never one they didn't choose.
    for (const name of data.skill_ids.length ? [] : data.skills) {
      const sk = skills.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (sk) chosen.push(sk);
    }
    return groupSkills(chosen, hosting);
  }, [ordinary, skillsState, skills, data.skill_ids, data.skills, hosting]);
  const choiceOf = (g: SkillGroup): JobChoice =>
    normalize(data.jobChoices[g.key] ?? { ...DEFAULT_CHOICE, where: data.startOnline ? 'ONLINE' : DEFAULT_CHOICE.where }, groupPricing(g), groupVenues(g), hosting);
  const careOf = (g: SkillGroup): CareSheet => data.careSheets[g.key] ?? EMPTY_CARE_SHEET;
  const changeChoice = (g: SkillGroup, next: JobChoice) => updateData({ jobChoices: { ...data.jobChoices, [g.key]: next } });
  const changeCare = (g: SkillGroup, next: CareSheet) => updateData({ careSheets: { ...data.careSheets, [g.key]: next } });

  // Not wanted after all (the AI can suggest more skills than they meant).
  const removeGroup = (g: SkillGroup) => {
    const gone = g.skills.map((sk) => sk.id);
    const ids = data.skill_ids.filter((id) => !gone.includes(id));
    updateData({
      skill_ids: ids, skill_id: ids[0] ?? null,
      skills: data.skills.filter((name) => !g.skills.some((sk) => sk.name === name)),
    });
  };

  // Those already posted: if one fails, trying again sends only the rest.
  const [sentKeys, setSentKeys] = useState<string[]>([]);
  const uploadedRef = useRef<string[] | null>(null);
  const bookable = groups.filter((g) => !groupNotBookable(g, hosting));
  const toPost = bookable.filter((g) => !sentKeys.includes(g.key));
  const several = groups.length > 1;
  const nothingToPost = ordinary && skillsState === 'ready' && groups.length > 0 && bookable.length === 0;
  // An online job needs no location; anything else does.
  const remote = ordinary && bookable.length > 0 && bookable.every((g) => choiceOf(g).where === 'ONLINE');
  const hasLocation = remote || (data.lat != null && data.lng != null);
  // A job with no times of its own goes by the date and time from step 2.
  const usesStep2Time = !ordinary || bookable.some((g) => choiceOf(g).howLong === 'ONCE');

  const urgencyMap: Record<string, string> = {
    Urgent: 'HIGH',
    Normal: 'MEDIUM',
    'Book Slot': 'LOW',
  };

  // data.date/time are friendly display strings ("Today", "09:00 AM - 11:00
  // AM") that can't be reliably parsed back — dateISO/timeHour/timeMinute/
  // timePeriod are the raw values captured alongside them in step2, used
  // here to build the real timestamp that actually gets sent to the
  // backend (previously this was silently never sent at all).
  // Only when a time was picked, and only for the job types that have one
  // (a time picked, then the type switched to Normal, isn't sent). No date
  // picked means the default, "Today" — the time used to be dropped then.
  const scheduledFor = (): Date | null => {
    const hasTime = (data.jobType === 'Urgent' || data.jobType === 'Book Slot') && data.time !== 'Select Time';
    if (!hasTime) return null;
    return fromParts(data.dateISO, { hour: data.timeHour, minute: data.timeMinute, period: data.timePeriod as 'AM' | 'PM' });
  };

  const handleProceedToPayment = async () => {
    if (!data.profession) {
      alert.show('error', 'Choose a Profession', 'Go back and choose who you need for this job.');
      return;
    }
    if (ordinary && skillsState !== 'ready') {
      if (skillsState === 'failed') retrySkills();
      alert.show('info', 'One Moment', 'We’re getting the details for this service. Please try again.');
      return;
    }
    if (ordinary && groups.length === 0) {
      alert.show('error', 'Choose a Skill', 'Choose at least one skill, so the job reaches the right people.',
        [{ text: 'Choose', onPress: () => router.replace('/post-requirement/step2') }]);
      return;
    }
    if (ordinary && toPost.length === 0 && sentKeys.length > 0) {
      setPosted(true);
      router.replace('/my-jobs');
      return;
    }
    // Every job is checked before any is sent.
    type Ready = { group: SkillGroup | null; shape?: any; when: Date | null };
    const ready: Ready[] = [];
    for (const g of toPost) {
      const choice = choiceOf(g);
      const which = several ? `${groupName(g)}: ` : '';
      // Where / how long / in care, as the job's shape — or what's missing.
      const shaped = shapeFor(choice, new Date(), groupPricing(g));
      // What the provider needs to look after a pet or an item.
      const problem = 'error' in shaped ? shaped.error : careSheetProblem(choice.inCare, careOf(g));
      if (problem || 'error' in shaped) {
        alert.show('error', 'Almost there', `${which}${problem}`);
        return;
      }
      const when = choice.howLong !== 'ONCE' && choice.startISO ? new Date(choice.startISO) : scheduledFor();
      // Someone has to be in to receive them (the server refuses without a time).
      if (!when && choice.where === 'THEIR_PLACE') {
        alert.show('error', 'Pick a Time', 'Choose Book Slot and say when you’ll come, so the provider is there.',
          [{ text: 'Choose', onPress: () => router.replace('/post-requirement/step2') }]);
        return;
      }
      ready.push({ group: g, shape: { ...shaped.shape, care_sheet: careSheetPayload(choice.inCare, careOf(g)) }, when });
    }
    if (!ordinary) ready.push({ group: null, when: scheduledFor() });
    // Urgent's deadline, Book Slot's time (step 2 asks; a stay has its own start).
    if (ready.some((r) => !r.when) && data.jobType !== 'Normal') {
      alert.show('error', data.jobType === 'Urgent' ? 'Set Your Deadline' : 'Pick a Time',
        data.jobType === 'Urgent' ? 'Say by when you need this done.' : 'Say when you want the provider to arrive.',
        [{ text: 'Choose', onPress: () => router.replace('/post-requirement/step2') }]);
      return;
    }
    // The time may have gone by while they were deciding on this screen.
    if (ready.some((r) => r.when && hasPassed(r.when, new Date()))) {
      alert.show('error', 'That Time Has Passed', 'Go back and pick a later time.');
      return;
    }
    if (!hasLocation) {
      alert.show('error', 'No Location Selected', "Go back to Home and choose a location before posting, or this job won't reach any providers.");
      return;
    }
    setIsPosting(true);
    // Kept as we go: one that fails leaves the others posted.
    const sent = [...sentKeys];
    try {
      // Use the full set of skills selected in step2 (real backend skill IDs)
      let skillIds = data.skill_ids;

      // A pickup's profession has the one skill.
      if (!ordinary && skillIds.length === 0) {
        const skillList: any[] = await SkoFyApi.skills.list(data.profession).catch(() => []);
        const fallbackId = skillList?.[0]?.id;
        if (fallbackId) skillIds = [fallbackId];
      }
      if (!ordinary && skillIds.length === 0) throw new Error('Could not find a matching skill. Please go back and select a skill.');

      const title = data.skills.length > 0
        ? `${data.profession} – ${data.skills[0]}`
        : data.profession;

      // Upload any photos/videos the customer attached in step 1
      // Once for all the jobs, and not again on a retry.
      let imageUrls: string[] = uploadedRef.current ?? [];
      if (!uploadedRef.current && Array.isArray(data.media) && data.media.length > 0) {
        try {
          const files = data.media.map((m: any) => ({
            uri: m.uri,
            type: m.type === 'video' ? 'video/mp4' : 'image/jpeg',
            name: m.uri.split('/').pop() || 'media.jpg',
          }));
          imageUrls = await SkoFyApi.jobs.uploadMedia(files);
          uploadedRef.current = imageUrls;
        } catch (err: any) {
          // Not posted without them: the customer is told, the photos stay,
          // and they try again or remove them.
          alert.show('error', 'Photos Not Uploaded', err?.message);
          return;
        }
      }

      for (const { group, shape, when } of ready) {
      const groupIds = group ? group.skills.map((sk) => sk.id) : skillIds;
      const online = group ? choiceOf(group).where === 'ONLINE' : false;
      await SkoFyApi.jobs.create({
        title: group && several ? `${data.profession} – ${group.skills[0].name}` : title,
        description: data.description || `${data.profession} service required.`,
        skill_ids: groupIds,
        urgency: (urgencyMap[data.jobType] || 'MEDIUM') as any,
        lat: data.lat ?? undefined,
        lng: data.lng ?? undefined,
        scheduled_at: when?.toISOString(),
        images: imageUrls,
        posted_via: 'MANUAL',
        shape,
        timezone: deviceTimeZone(),
        job_type: data.jobKind,
        dropoff_lat: data.jobKind === 'PICKUP_DROPOFF' ? (data.dropoffLat ?? undefined) : undefined,
        dropoff_lng: data.jobKind === 'PICKUP_DROPOFF' ? (data.dropoffLng ?? undefined) : undefined,
        pickup_place_id: data.jobKind === 'PICKUP_DROPOFF' ? (data.pickupPlaceId ?? undefined) : undefined,
        pickup_place_type: data.jobKind === 'PICKUP_DROPOFF' ? (data.pickupPlaceType ?? undefined) : undefined,
        // The store and the drop-off as the customer chose them (only pins were sent).
        pickup_address: data.jobKind === 'PICKUP_DROPOFF' ? (data.address?.slice(0, 300) || undefined) : undefined,
        dropoff_address: data.jobKind === 'PICKUP_DROPOFF' ? (data.dropoffAddress?.slice(0, 300) || undefined) : undefined,
        service_mode: online ? 'REMOTE' : 'ON_SITE',
      });
      if (group) { sent.push(group.key); setSentKeys([...sent]); }
      }

      postedRef.current = true;
      setPosted(true);
      alert.show(
        'success',
        ready.length > 1 ? 'Jobs Posted!' : 'Requirement Posted!',
        remote
          ? "Skilled providers have been notified. You'll see who applies in My Jobs."
          : "Nearby providers have been notified. You'll see who applies in My Jobs.",
        [
          { text: 'Back to Home', variant: 'secondary', onPress: () => router.dismissTo('/(tabs)/home' as any) },
          { text: 'View My Jobs', onPress: () => router.replace('/my-jobs') },
        ],
      );
    } catch (err: any) {
      // A field the server refused (e.g. in the care details) carries its
      // reason in details.errors, under a generic "Request validation failed."
      const reason = err?.details?.errors?.[0]?.message?.replace(/^Value error, /, '');
      const why = reason || err?.message || 'Something went wrong. Please try again.';
      const left = bookable.filter((g) => !sent.includes(g.key));
      // Some are out already: leaving now clears this form, as a full post does.
      if (several && sent.length > 0) {
        postedRef.current = true;
        alert.show('error', 'Not All Posted',
          `${sent.length} of ${bookable.length} posted. ${left.map(groupName).join(' and ')} wasn’t: ${why} Tap Post to try again.`);
        return;
      }
      alert.show('error', 'Failed to Post', why);
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={{ flex: 1 }}>
        {/* Keyboard-aware: the box being typed in (the care details) stays above the keyboard. */}
        <KeyboardAwareScrollView keyboardShouldPersistTaps="handled" bottomOffset={24}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <ArrowLeft size={24} color={themeColors.text} />
          </TouchableOpacity>
          <ThemedText style={styles.headerTitle}>Job Summary</ThemedText>
        </View>

        {/* --- Summary Main Card --- */}
        <View style={styles.summaryCard}>
          <Animated.View entering={ZoomIn.delay(200)} style={styles.successIconContainer}>
            <View style={[styles.successCircle, { backgroundColor: themeColors.brand }]}>
              <Sparkles size={32} color="#000" />
            </View>
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(400)} style={styles.summaryHeader}>
            <ThemedText style={styles.summaryTitle}>Review Your Requirement</ThemedText>
            <ThemedText style={styles.summarySubtitle}>Double check the details before we find you the best pros.</ThemedText>
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(600)} style={styles.detailsList}>
            <SummaryItem
              styles={styles}
              icon={Briefcase}
              label="Profession"
              value={data.profession}
              color="#3B82F6"
            />
            <SummaryItem
              styles={styles}
              icon={Zap}
              label="Job Type"
              value={data.jobType}
              color="#EF4444"
            />
            {data.skills.length > 0 && (
              <SummaryItem
                styles={styles}
                icon={CheckCircle2}
                label="Selected Skills"
                value={data.skills.join(', ')}
                color="#8B5CF6"
              />
            )}
            {/* By the hour, night or day: its dates are below, with how long. */}
            {usesStep2Time && (<>
            <SummaryItem
              styles={styles}
              icon={Calendar}
              label="Date"
              value={data.jobType === 'Normal' ? 'As soon as possible' : data.date}
              color="#10B981"
            />
            <SummaryItem
              styles={styles}
              icon={Clock}
              label="Time Slot"
              value={data.jobType === 'Normal' ? 'No set time' : data.time === 'Select Time' ? 'Not chosen yet' : data.time}
              color="#F59E0B"
            />
            </>)}
            {remote ? (
              <SummaryItem
                styles={styles}
                icon={MapPin}
                label="Location"
                value="Remote — no location needed"
                color="#7C3AED"
              />
            ) : (
              <>
                <SummaryItem
                  styles={styles}
                  icon={MapPin}
                  label={data.jobKind === 'PICKUP_DROPOFF' ? 'Pickup from' : 'Location'}
                  value={data.address || 'No location selected'}
                  color="#6366F1"
                />
                {data.jobKind === 'PICKUP_DROPOFF' && (
                  <SummaryItem
                    styles={styles}
                    icon={MapPin}
                    label="Deliver to"
                    value={data.dropoffAddress || 'No drop-off address selected'}
                    color="#0EA5E9"
                  />
                )}
              </>
            )}
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(800)} style={styles.descriptionBox}>
            <ThemedText style={styles.descriptionLabel}>Problem Description</ThemedText>
            <ThemedText style={styles.descriptionText}>
              {data.description || 'No additional description provided.'}
            </ThemedText>
          </Animated.View>
        </View>

        {/* --- Where, how long, in care — the last decision before posting --- */}
        <Animated.View entering={FadeInUp.delay(900)} style={styles.rangeSection}>
          <ThemedText style={styles.sectionTitle}>
            {several ? `We’ll post this as ${bookable.length} job${bookable.length === 1 ? '' : 's'}` : 'How should this be done?'}
          </ThemedText>
          {several && (
            <ThemedText style={styles.severalHint}>
              These are booked or priced differently, so each is its own job. The description, photos and address go on all of them, and each can have a different provider.
            </ThemedText>
          )}
          {ordinary && skillsState === 'loading' && (
            <ActivityIndicator style={{ paddingVertical: 16 }} color={themeColors.textSecondary} />
          )}
          {ordinary && skillsState === 'failed' && (
            <View style={styles.remoteNoticeBox}>
              <ThemedText style={styles.remoteNoticeText}>We couldn’t load how this service is booked. Check your connection.</ThemedText>
              <TouchableOpacity onPress={retrySkills} hitSlop={8} accessibilityRole="button">
                <ThemedText style={styles.noticeAction}>Try again</ThemedText>
              </TouchableOpacity>
            </View>
          )}
          {groups.map((g, i) => {
            const blocked = groupNotBookable(g, hosting);
            const sent = sentKeys.includes(g.key);
            const note = groupPriceNote(g);
            const choice = choiceOf(g);
            return (
              <View key={g.key} style={several ? styles.groupCard : undefined}>
                {several && (
                  <View style={styles.groupHead}>
                    <ThemedText style={styles.groupTitle}>{i + 1}. {groupName(g)}</ThemedText>
                    {sent ? <ThemedText style={styles.groupSent}>Posted ✓</ThemedText> : (
                      <TouchableOpacity onPress={() => removeGroup(g)} disabled={isPosting} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${groupName(g)}`}>
                        <ThemedText style={styles.noticeAction}>Remove</ThemedText>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                {blocked ? (
                  <View style={styles.remoteNoticeBox}>
                    <ThemedText style={styles.remoteNoticeText}>
                      {blocked.text}{several && bookable.length > 0 ? ' It won’t be posted.' : ''}
                    </ThemedText>
                    <TouchableOpacity
                      onPress={() => (blocked.pickup ? router.replace('/pickup-drop') : router.replace('/post-requirement/step2'))}
                      hitSlop={8}
                      accessibilityRole="button"
                    >
                      <ThemedText style={styles.noticeAction}>{blocked.pickup ? 'Open Pickup & Delivery' : 'Choose another skill'}</ThemedText>
                    </TouchableOpacity>
                  </View>
                ) : sent ? null : (
                  <>
                    {!!note && <ThemedText style={styles.severalHint}>{note}</ThemedText>}
                    {/* Charged at the highest of its skills' prices: what that comes to near here
                        (not for online work, done from anywhere). */}
                    {choice.where !== 'ONLINE' && (
                      <SeveralSkillsPriceNote skillIds={g.skills.map((sk) => sk.id)} unit={g.pricing}
                        lat={data.lat ?? null} lng={data.lng ?? null} />
                    )}
                    <JobShapePicker value={choice} onChange={(next) => changeChoice(g, next)} pricing={groupPricing(g)} venues={groupVenues(g)} hosting={hosting} />
                    <CareSheetForm custody={choice.inCare} value={careOf(g)} onChange={(next) => changeCare(g, next)} />
                  </>
                )}
              </View>
            );
          })}

          {remote ? (
            <View style={styles.remoteNoticeBox}>
              <ThemedText style={styles.remoteNoticeText}>
                No location needed — this job will be matched to skilled providers by skill and availability, wherever they are.
              </ThemedText>
            </View>
          ) : !hasLocation && !posted ? (
            <View style={styles.locationWarningBox}>
              <MapPin size={14} color="#EF4444" />
              <ThemedText style={styles.locationWarningText}>
                No location selected — go back to Home and choose one before posting.
              </ThemedText>
            </View>
          ) : null}
          {!remote && (
            <PriceGuideNote skillIds={data.skill_ids} lat={data.lat ?? null} lng={data.lng ?? null} />
          )}
        </Animated.View>
      </KeyboardAwareScrollView>

      {/* Footer Button */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 40 : 24) + 12 }]}>
        <TouchableOpacity
          style={[styles.postButton, { backgroundColor: themeColors.brand, opacity: (isPosting || posted || !hasLocation || nothingToPost) ? 0.5 : 1 }]}
          onPress={handleProceedToPayment}
          disabled={isPosting || posted || !hasLocation || nothingToPost}
        >
          {isPosting
            ? <ActivityIndicator size="small" color="#111827" style={{ marginRight: 8 }} />
            : <CreditCard size={20} color="#111827" style={{ marginRight: 8 }} />
          }
          <ThemedText style={styles.postButtonText}>
            {isPosting ? 'Posting...' : posted ? 'Posted ✓' : toPost.length === 0 && sentKeys.length > 0 ? 'Done' : toPost.length > 1 ? `Post ${toPost.length} Jobs` : 'Post Requirement'}
          </ThemedText>
        </TouchableOpacity>
      </View>
      </View>

      {alert.element}
    </ThemedView>
  );
}

function SummaryItem({ styles, icon: Icon, label, value, color }: any) {
  return (
    <View style={styles.summaryItem}>
      <View style={[styles.itemIconContainer, { backgroundColor: color + '15' }]}>
        <Icon size={20} color={color} />
      </View>
      <View style={styles.itemContent}>
        <ThemedText style={styles.itemLabel}>{label}</ThemedText>
        <ThemedText style={styles.itemValue}>{value}</ThemedText>
      </View>
    </View>
  );
}

function makeStyles(t: typeof Colors.light) { return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.surface,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 120,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 20, lineHeight: 25,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  summaryCard: {
    backgroundColor: t.card,
    borderRadius: 32,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 4,
    marginBottom: 24,
  },
  successIconContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  successCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFCE48',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  summaryHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  summaryTitle: {
    fontSize: 22, lineHeight: 28,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    textAlign: 'center',
  },
  summarySubtitle: {
    fontSize: 13,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },
  detailsList: {
    gap: 16,
    marginBottom: 32,
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  itemIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemContent: {
    flex: 1,
  },
  itemLabel: {
    fontSize: 12, lineHeight: 16,
    fontFamily: Fonts.poppins,
    color: t.textMuted,
  },
  itemValue: {
    fontSize: 15, lineHeight: 19,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  descriptionBox: {
    backgroundColor: t.surface,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.inputFilled,
  },
  descriptionLabel: {
    fontSize: 14, lineHeight: 18,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginBottom: 8,
  },
  descriptionText: {
    fontSize: 14,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    lineHeight: 20,
  },
  // Range Styles
  rangeSection: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18, lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginBottom: 16,
  },
  jobKindRow: { flexDirection: 'row', gap: 10 },
  jobKindChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12,
    borderWidth: 1, borderColor: t.border, backgroundColor: t.card,
  },
  jobKindChipActive: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  jobKindChipText: { fontSize: 13, fontFamily: Fonts.poppinsSemiBold, color: t.textSecondary },
  jobKindChipTextActive: { color: '#111827', fontFamily: Fonts.poppinsBold },
  remoteNoticeBox: {
    backgroundColor: '#F5F3FF', borderRadius: 12, borderWidth: 1, borderColor: '#DDD6FE',
    paddingHorizontal: 14, paddingVertical: 12, marginTop: 16,
  },
  severalHint: { fontSize: 12.5, lineHeight: 18, fontFamily: Fonts.poppins, color: t.textSecondary, marginBottom: 8 },
  groupCard: { backgroundColor: t.card, borderWidth: 1, borderColor: t.borderSubtle, borderRadius: 18, padding: 14, marginTop: 10 },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  groupTitle: { flex: 1, fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  groupSent: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppinsBold, color: '#047857' },
  noticeAction: { marginTop: 6, fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
  remoteNoticeText: { fontSize: 12.5, fontFamily: Fonts.poppinsSemiBold, color: '#5B21B6', lineHeight: 18 },
  locationWarningBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 16,
  },
  locationWarningText: { fontSize: 12, color: '#EF4444', flex: 1, fontFamily: Fonts.poppins },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    backgroundColor: t.card,
    borderTopWidth: 1,
    borderTopColor: t.inputFilled,
  },
  postButton: {
    height: 60,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFCE48',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  postButtonText: {
    fontSize: 18, lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
  // Success Modal Styles
  successModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  successCard: {
    backgroundColor: t.card,
    borderRadius: 32,
    padding: 32,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.15,
    shadowRadius: 30,
    elevation: 10,
  },
  successIconOuter: {
    width: 90,
    height: 90,
    borderRadius: 45,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successIconInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  successTitle: {
    fontSize: 22, lineHeight: 28,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    textAlign: 'center',
    marginBottom: 12,
  },
  successMessage: {
    fontSize: 15,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.inputFilled,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 32,
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F59E0B',
  },
  statusText: {
    fontSize: 13, lineHeight: 17,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  successButtonContainer: {
    width: '100%',
    gap: 12,
  },
  primaryModalButton: {
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFCE48',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryModalButtonText: {
    fontSize: 16, lineHeight: 20,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
  secondaryModalButton: {
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.border,
  },
  secondaryModalButtonText: {
    fontSize: 16, lineHeight: 20,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
}); }
