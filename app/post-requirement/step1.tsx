import { useAppAlert } from '@/components/app-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { usePostRequirement } from '@/context/PostRequirementContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { Image } from 'expo-image';
import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronRight,
  MapPin,
  PlayCircle,
  Sparkles,
  Video,
  X,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';

interface AiResult {
  problem_summary: string;
  profession: string;
  skills: string[];
  urgency: string;
}

export default function DescribeProblemScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const appAlert = useAppAlert();
  const { data, updateData } = usePostRequirement();
  const params = useLocalSearchParams<{ selectedAddress?: string; lat?: string; lng?: string; profession?: string }>();

  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const updates: Partial<Parameters<typeof updateData>[0]> = {};
    if (params.selectedAddress) {
      updates.address = params.selectedAddress;
      updates.lat = params.lat ? parseFloat(params.lat) : null;
      updates.lng = params.lng ? parseFloat(params.lng) : null;
    }
    if (params.profession) {
      updates.profession = params.profession;
    }
    if (Object.keys(updates).length > 0) updateData(updates);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickMedia = async (type: 'image' | 'video' | 'record') => {
    let result;
    if (type === 'record') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        appAlert.show('warning', 'Camera Permission Required', 'Please allow camera access in your device settings to record a video.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], quality: 0.8 });
    } else {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: type === 'image' ? ['images'] : ['videos'],
        allowsMultipleSelection: true,
        quality: 0.8,
      });
    }
    if (!result.canceled) {
      const newMedia = result.assets.map(asset => ({
        uri: asset.uri,
        type: (asset.type === 'video' || asset.duration) ? 'video' as const : 'image' as const,
      }));
      updateData({ media: [...data.media, ...newMedia] });
      setAiResult(null); // Reset AI result when new media added
    }
  };

  const removeMedia = (index: number) => {
    const updated = [...data.media];
    updated.splice(index, 1);
    updateData({ media: updated });
    setAiResult(null);
  };

  const handleAnalyze = async () => {
    const images = data.media.filter(m => m.type === 'image');
    if (images.length === 0 && !data.description.trim()) {
      setAiError('Please upload at least one photo or describe your problem.');
      return;
    }

    setAnalyzing(true);
    setAiError(null);
    setAiResult(null);

    try {
      const base64Images: string[] = [];
      for (const img of images.slice(0, 2)) {
        // Resize to max 512px — reduces tokens ~4-8x vs full-res, cuts cost significantly
        const resized = await ImageManipulator.manipulateAsync(
          img.uri,
          [{ resize: { width: 512 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
        );
        // expo-file-system 19's File API — the old readAsStringAsync /
        // EncodingType throw at runtime in this version, which made every
        // analysis with a photo fail.
        const b64 = await new File(resized.uri).base64();
        base64Images.push(b64);
      }

      const result = await SkoFyApi.ai.analyzeProblem(base64Images, data.description);
      setAiResult(result);

      // Pre-fill context so step2 starts with AI suggestions. An empty
      // profession means the suggestion wasn't in the catalogue — keep
      // whatever is selected and let the customer choose.
      updateData({
        ...(result.profession ? { profession: result.profession, skills: result.skills } : {}),
        jobType: result.urgency === 'Urgent' ? 'Urgent' : 'Normal',
        // Work that can be done remotely starts as Remote (no address, no
        // distance limit); the customer can still switch on the summary.
        serviceMode: result.venue === 'ONLINE' ? 'REMOTE' : 'ON_SITE',
      });
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg.includes('401') || msg.includes('auth')) {
        setAiError('AI service not configured. Please contact support.');
      } else if (msg.includes('Network')) {
        setAiError('Cannot reach server. Check your connection.');
      } else {
        setAiError('AI analysis failed. You can still continue manually.');
      }
    } finally {
      setAnalyzing(false);
    }
  };


  const canAnalyze = data.media.filter(m => m.type === 'image').length > 0 || data.description.trim().length > 0;
  // The location-required check moved to the summary screen (the last
  // step) — it now depends on which service mode gets chosen there
  // (On-site needs one, Remote doesn't), which isn't decided yet here.
  const canContinue = data.description.trim().length > 0 || data.media.length > 0 || aiResult !== null;

  useFocusEffect(
    useCallback(() => {
      const backAction = () => {
        router.canGoBack() ? router.back() : router.replace('/(tabs)/home');
        return true;
      };
      const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
      return () => backHandler.remove();
    }, [])
  );

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/home')}>
              <ArrowLeft size={24} color={themeColors.text} />
            </TouchableOpacity>
            <Image source={require('@/assets/images/logo-mark.png')} style={styles.logo} contentFit="contain" />
          </View>

          {/* Title */}
          <Animated.View entering={FadeInUp.delay(200)} style={styles.titleSection}>
            <ThemedText style={styles.title}>Describe Your Problem</ThemedText>
            <ThemedText style={styles.subtitle}>Upload photos – AI will identify the problem and suggest the right professional.</ThemedText>
          </Animated.View>

          {/* Whether this is On-site or Remote is decided later, as the
              last step before posting — not here. If a location was
              already picked from Home, show it for context; it's just
              informational at this point. */}
          {data.address ? (
            <Animated.View entering={FadeInUp.delay(260)} style={styles.locationBadgeContainer}>
              <View style={styles.locationBadge}>
                <MapPin size={14} color="#111827" fill="#FFCE48" />
                <ThemedText style={styles.locationBadgeText} numberOfLines={1}>{data.address}</ThemedText>
              </View>
            </Animated.View>
          ) : null}

          {/* Media Upload */}
          <Animated.View entering={FadeInUp.delay(400)} style={styles.mediaContainer}>
            <View style={styles.mediaGrid}>
              <TouchableOpacity style={styles.mediaCard} onPress={() => pickMedia('image')}>
                <View style={[styles.iconCircle, { backgroundColor: themeColors.inputFilled }]}>
                  <Camera size={28} color={themeColors.textPrimary} />
                </View>
                <ThemedText style={styles.mediaLabel}>Upload Photos</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity style={styles.mediaCard} onPress={() => pickMedia('video')}>
                <View style={[styles.iconCircle, { backgroundColor: themeColors.inputFilled }]}>
                  <Video size={28} color={themeColors.textPrimary} />
                </View>
                <ThemedText style={styles.mediaLabel}>Upload Videos</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity style={styles.mediaCard} onPress={() => pickMedia('record')}>
                <View style={[styles.iconCircle, { backgroundColor: '#FFF1F2' }]}>
                  <PlayCircle size={28} color="#EF4444" />
                </View>
                <ThemedText style={styles.mediaLabel}>Record Video</ThemedText>
              </TouchableOpacity>
            </View>

            {data.media.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaPreviewList}>
                {data.media.map((item, index) => (
                  <View key={index} style={styles.previewCard}>
                    <Image source={{ uri: item.uri }} style={styles.previewImage} contentFit="cover" />
                    {item.type === 'video' && (
                      <View style={styles.videoBadge}><Video size={10} color="#FFF" /></View>
                    )}
                    <TouchableOpacity style={styles.removeMediaButton} onPress={() => removeMedia(index)}>
                      <X size={12} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.textInput}
                placeholder="Describe the issue in your own words (optional)"
                placeholderTextColor="#9CA3AF"
                multiline
                numberOfLines={4}
                value={data.description}
                onChangeText={(text) => { updateData({ description: text }); setAiResult(null); }}
                textAlignVertical="top"
              />
            </View>
          </Animated.View>

          {/* Analyze Button */}
          <Animated.View entering={FadeInUp.delay(500)}>
            <TouchableOpacity
              style={[styles.analyzeButton, !canAnalyze && styles.analyzeButtonDisabled]}
              onPress={handleAnalyze}
              disabled={analyzing}
            >
              {analyzing ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Sparkles size={20} color="#000" />
              )}
              <Text style={styles.analyzeButtonText}>
                {analyzing ? 'Analyzing with AI...' : 'Analyze with AI'}
              </Text>
            </TouchableOpacity>
          </Animated.View>

          {/* AI Error */}
          {aiError && (
            <Animated.View entering={FadeIn} style={styles.errorBox}>
              <ThemedText style={styles.errorText}>{aiError}</ThemedText>
            </Animated.View>
          )}

          {/* AI Result Card */}
          {aiResult && (
            <Animated.View entering={FadeIn} style={styles.aiResultCard}>
              <View style={styles.aiResultHeader}>
                <View style={styles.aiResultBadge}>
                  <Sparkles size={14} color="#000" />
                  <Text style={styles.aiResultBadgeText}>AI Analysis</Text>
                </View>
                <View style={[
                  styles.urgencyBadge,
                  { backgroundColor: aiResult.urgency === 'Urgent' ? '#FEF2F2' : '#F0FDF4' }
                ]}>
                  <Text style={[
                    styles.urgencyText,
                    { color: aiResult.urgency === 'Urgent' ? '#EF4444' : '#10B981' }
                  ]}>
                    {aiResult.urgency}
                  </Text>
                </View>
              </View>

              <ThemedText style={styles.problemSummary}>{aiResult.problem_summary}</ThemedText>

              <View style={styles.aiResultRow}>
                <View style={styles.aiResultItem}>
                  <ThemedText style={styles.aiResultLabel}>Suggested Professional</ThemedText>
                  <View style={styles.professionChip}>
                    <CheckCircle2 size={14} color="#10B981" />
                    <ThemedText style={styles.professionChipText}>{aiResult.profession}</ThemedText>
                  </View>
                </View>
              </View>

              <View>
                <ThemedText style={styles.aiResultLabel}>Skills Needed</ThemedText>
                <View style={styles.skillsRow}>
                  {aiResult.skills.map((skill, i) => (
                    <View key={i} style={styles.skillChip}>
                      <Text style={styles.skillChipText}>{skill}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <ThemedText style={styles.aiResultHint}>
                These suggestions are pre-filled in the next step. You can change them.
              </ThemedText>
            </Animated.View>
          )}
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.continueButton, { backgroundColor: themeColors.brand, opacity: canContinue ? 1 : 0.5 }]}
            onPress={() => router.replace('/post-requirement/step2')}
            disabled={!canContinue}
          >
            <ThemedText style={styles.continueButtonText}>Continue</ThemedText>
            <ChevronRight size={20} color="#000" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      {appAlert.element}

    </ThemedView>
  );
}

function makeStyles(t: typeof Colors.light) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: t.card },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 120,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  backButton: { position: 'absolute', left: 0, padding: 8 },
  logo: { width: 60, height: 60 },
  titleSection: { alignItems: 'center', marginBottom: 32 },
  title: { fontSize: 26, fontFamily: Fonts.poppinsBold, color: t.textPrimary, textAlign: 'center' },
  subtitle: {
    fontSize: 14,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  locationBadgeContainer: { alignItems: 'center', marginBottom: 24 },
  locationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FEF3C7',
    gap: 8,
  },
  locationBadgeText: { fontSize: 13, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary },
  mediaContainer: {
    backgroundColor: t.card,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#FFCE48',
    borderStyle: 'dashed',
    marginBottom: 20,
  },
  mediaGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: t.card,
    borderRadius: 22,
  },
  mediaCard: { flex: 1, alignItems: 'center', gap: 8 },
  iconCircle: { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center' },
  mediaLabel: { fontSize: 12, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary, textAlign: 'center' },
  mediaPreviewList: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  previewCard: { width: 100, height: 100, borderRadius: 12, overflow: 'hidden', backgroundColor: t.inputFilled },
  previewImage: { width: '100%', height: '100%' },
  videoBadge: {
    position: 'absolute', top: 6, left: 6,
    backgroundColor: 'rgba(0,0,0,0.5)', padding: 4, borderRadius: 4,
  },
  removeMediaButton: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 20, height: 20, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  inputWrapper: { padding: 16, borderTopWidth: 1, borderTopColor: t.inputFilled },
  textInput: { fontSize: 15, fontFamily: Fonts.poppins, minHeight: 90, color: t.textPrimary },
  voiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#111827',
    height: 56,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#FFCE48',
  },
  voiceButtonText: { fontSize: 16, fontFamily: Fonts.poppinsBold, color: '#FFCE48' },
  analyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFCE48',
    height: 56,
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: '#FFCE48',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  analyzeButtonDisabled: { backgroundColor: t.inputFilled, shadowOpacity: 0 },
  analyzeButtonText: { fontSize: 16, fontFamily: Fonts.poppinsBold, color: '#000' },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: { fontSize: 13, fontFamily: Fonts.poppinsSemiBold, color: '#EF4444', textAlign: 'center' },
  aiResultCard: {
    backgroundColor: t.surface,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: t.border,
  },
  aiResultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  aiResultBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFCE48', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
  },
  aiResultBadgeText: { fontSize: 12, fontFamily: Fonts.poppinsBold, color: '#000' },
  urgencyBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  urgencyText: { fontSize: 12, fontFamily: Fonts.poppinsBold },
  problemSummary: {
    fontSize: 14, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary,
    lineHeight: 20, marginBottom: 16,
  },
  aiResultRow: { marginBottom: 14 },
  aiResultItem: { gap: 6 },
  aiResultLabel: { fontSize: 11, fontFamily: Fonts.poppinsBold, color: t.textSecondary, textTransform: 'uppercase', marginBottom: 6 },
  professionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#ECFDF5', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, alignSelf: 'flex-start',
  },
  professionChipText: { fontSize: 14, fontFamily: Fonts.poppinsBold, color: '#065F46' },
  skillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  skillChip: {
    backgroundColor: '#EFF6FF', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: '#BFDBFE',
  },
  skillChipText: { fontSize: 12, fontFamily: Fonts.poppinsSemiBold, color: '#1D4ED8' },
  aiResultHint: {
    fontSize: 11, fontFamily: Fonts.poppins, color: t.textMuted,
    marginTop: 14, textAlign: 'center',
  },
  footer: {
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    backgroundColor: t.card,
  },
  continueButton: {
    height: 60, borderRadius: 16,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
    shadowColor: '#FFCE48',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  continueButtonText: { fontSize: 18, fontFamily: Fonts.poppinsBold, color: '#000' },
}); }
