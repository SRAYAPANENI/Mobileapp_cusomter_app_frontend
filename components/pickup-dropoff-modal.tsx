import { useAppAlert } from '@/components/app-alert';
import { Colors, Fonts } from '@/constants/theme';
import { SkoFyApi } from '@/services/api';
import { GooglePlacesService, GooglePlaceSuggestion } from '@/services/google-places';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Camera, CheckCircle2, MapPin, Package, Store, Video as VideoIcon, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type MediaItem = { uri: string; type: 'image' | 'video' };

// Posted directly from the home screen's Pickup & Drop banner — no
// intermediate picker screen (same "modal, not a route" pattern as
// QuickNeedModal). The customer's already-confirmed location (from the
// shared location picker in home.tsx) becomes the DROPOFF point — "bring it
// to me here" — matching step1.tsx's manual-wizard convention. Only the
// pickup point (a verified business, same allowlist gate as everywhere
// else) and a description of what's needed are asked here.
interface Props {
  visible: boolean;
  dropoffAddress: string;
  dropoffLat: number | null;
  dropoffLng: number | null;
  onClose: () => void;
  onPosted: () => void;
}

type Phase = 'confirm' | 'posting' | 'success';

const SKILL_PROFESSION = 'Personal Errands';
const SKILL_NAME = 'Pickup & Delivery Errands';

export function PickupDropoffModal({ visible, dropoffAddress, dropoffLat, dropoffLng, onClose, onPosted }: Props) {
  const insets = useSafeAreaInsets();
  const appAlert = useAppAlert();

  const [phase, setPhase] = useState<Phase>('confirm');
  const [description, setDescription] = useState('');
  const [allowedPickupTypes, setAllowedPickupTypes] = useState<string[]>([]);
  const [pickupQuery, setPickupQuery] = useState('');
  const [pickupSuggestions, setPickupSuggestions] = useState<GooglePlaceSuggestion[]>([]);
  const [pickupSearching, setPickupSearching] = useState(false);
  const [pickupTypeError, setPickupTypeError] = useState<string | null>(null);
  const [pickupPlaceId, setPickupPlaceId] = useState<string | null>(null);
  const [pickupPlaceType, setPickupPlaceType] = useState<string | null>(null);
  const [pickupLat, setPickupLat] = useState<number | null>(null);
  const [pickupLng, setPickupLng] = useState<number | null>(null);
  const [skillId, setSkillId] = useState<string | null>(null);
  const [resolvingSkill, setResolvingSkill] = useState(false);
  const [skillResolveError, setSkillResolveError] = useState(false);
  const [media, setMedia] = useState<MediaItem[]>([]);

  useEffect(() => {
    if (!visible) return;
    setPhase('confirm');
    setDescription('');
    setPickupQuery(''); setPickupSuggestions([]); setPickupTypeError(null);
    setPickupPlaceId(null); setPickupPlaceType(null);
    setPickupLat(null); setPickupLng(null);
    setMedia([]);
    SkoFyApi.jobs.getPickupPlaceTypes().then(setAllowedPickupTypes).catch(() => {});
    resolveSkill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const resolveSkill = async () => {
    setResolvingSkill(true);
    setSkillResolveError(false);
    setSkillId(null);
    try {
      const list = await SkoFyApi.skills.list(SKILL_PROFESSION) as any;
      const match = Array.isArray(list) ? list.find((s: any) => s.name === SKILL_NAME) : null;
      if (match?.id) setSkillId(match.id);
      else setSkillResolveError(true);
    } catch {
      setSkillResolveError(true);
    } finally {
      setResolvingSkill(false);
    }
  };

  useEffect(() => {
    if (pickupQuery.length < 2) { setPickupSuggestions([]); return; }
    const handle = setTimeout(async () => {
      setPickupSearching(true);
      try {
        const bias = dropoffLat != null && dropoffLng != null
          ? { latitude: dropoffLat, longitude: dropoffLng }
          : undefined;
        const results = await GooglePlacesService.searchAddress(pickupQuery, undefined, bias, allowedPickupTypes);
        setPickupSuggestions(results);
      } catch { setPickupSuggestions([]); }
      setPickupSearching(false);
    }, 350);
    return () => clearTimeout(handle);
  }, [pickupQuery, dropoffLat, dropoffLng, allowedPickupTypes]);

  const handlePickupSelect = async (item: GooglePlaceSuggestion) => {
    setPickupSuggestions([]);
    setPickupQuery(item.description);
    try {
      const details = await GooglePlacesService.getPlaceDetails(item.place_id);
      const isAllowed = !!details.primary_type && allowedPickupTypes.includes(details.primary_type);
      setPickupPlaceId(item.place_id);
      setPickupPlaceType(details.primary_type ?? null);
      setPickupLat(details.latitude);
      setPickupLng(details.longitude);
      setPickupTypeError(isAllowed
        ? null
        : "This doesn't look like a supported pickup location (grocery, pharmacy, etc). Please choose a business.");
    } catch {
      setPickupTypeError('Could not fetch location details. Please check your internet connection.');
    }
  };

  const hasValidPickup = pickupLat != null && pickupLng != null &&
    !!pickupPlaceType && allowedPickupTypes.includes(pickupPlaceType);
  const canPost = hasValidPickup && description.trim().length > 0 &&
    !!skillId && !resolvingSkill && dropoffLat != null && dropoffLng != null;

  // Both images and videos in one picker — same mediaTypes list step1.tsx
  // uses for its own "gallery" pick path, just without the separate
  // record-video/camera entry point that flow has (this is a lightweight
  // one-step modal, not a full wizard).
  const pickMedia = async () => {
    if (media.length >= 3) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const type: MediaItem['type'] = (asset.type === 'video' || asset.duration) ? 'video' : 'image';
      setMedia(prev => [...prev, { uri: asset.uri, type }]);
    }
  };

  const handlePost = async () => {
    if (!canPost || !skillId) return;
    setPhase('posting');
    try {
      let imageUrls: string[] = [];
      if (media.length > 0) {
        try {
          const files = media.map(m => {
            const ext = m.uri.split('.').pop()?.toLowerCase();
            const type = m.type === 'video'
              ? (ext === 'mov' ? 'video/quicktime' : 'video/mp4')
              : 'image/jpeg';
            return { uri: m.uri, type, name: m.uri.split('/').pop() || 'media.jpg' };
          });
          imageUrls = await SkoFyApi.jobs.uploadMedia(files);
        } catch { /* non-fatal — job still posts without media */ }
      }
      const trimmed = description.trim();
      await SkoFyApi.jobs.create({
        title: trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed,
        description: trimmed,
        skill_id: skillId,
        urgency: 'MEDIUM',
        lat: pickupLat!, lng: pickupLng!,
        job_type: 'PICKUP_DROPOFF',
        dropoff_lat: dropoffLat!, dropoff_lng: dropoffLng!,
        pickup_place_id: pickupPlaceId ?? undefined,
        pickup_place_type: pickupPlaceType ?? undefined,
        service_mode: 'ON_SITE',
        posted_via: 'MANUAL',
        images: imageUrls,
      });
      setPhase('success');
      setTimeout(() => onPosted(), 1400);
    } catch (e: any) {
      setPhase('confirm');
      appAlert.show('error', 'Could not post', e?.message || 'Please check your connection and try again.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={phase === 'confirm' ? onClose : undefined}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={s.dragHandle} />

          <View style={s.headerRow}>
            <View style={s.iconWrap}>
              <Package size={24} color="#0EA5E9" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Pickup & Drop</Text>
              <Text style={s.subtitle}>We'll pick it up and bring it to you.</Text>
            </View>
            {phase === 'confirm' && (
              <TouchableOpacity onPress={onClose} style={s.closeBtn}>
                <X size={20} color="#6B7280" />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
            <View style={s.fieldWrap}>
              <Text style={s.fieldLabel}>Pickup from (store, pharmacy, etc.)</Text>
              <View style={s.searchInputRow}>
                <Store size={16} color="#6B7280" />
                <TextInput
                  style={s.searchInput}
                  placeholder="Search for a business"
                  placeholderTextColor="#9CA3AF"
                  value={pickupQuery}
                  onChangeText={(t) => { setPickupQuery(t); setPickupTypeError(null); }}
                  onBlur={() => { setTimeout(() => setPickupSuggestions([]), 200); }}
                  editable={phase === 'confirm'}
                />
                {pickupSearching && <ActivityIndicator size="small" color="#6B7280" />}
              </View>
              {pickupSuggestions.length > 0 && (
                <View style={s.suggestionsBox}>
                  {pickupSuggestions.map(item => (
                    <TouchableOpacity key={item.place_id} style={s.suggestionRow} onPress={() => handlePickupSelect(item)}>
                      <Text style={s.suggestionMainText} numberOfLines={1}>{item.structured_formatting.main_text}</Text>
                      <Text style={s.suggestionSecondaryText} numberOfLines={1}>{item.structured_formatting.secondary_text}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {pickupTypeError && <Text style={s.fieldError}>{pickupTypeError}</Text>}
            </View>

            <View style={s.locationRow}>
              <MapPin size={16} color="#6B7280" />
              <Text style={s.locationText} numberOfLines={2}>Deliver to: {dropoffAddress || 'Current location'}</Text>
            </View>

            <View style={s.fieldWrap}>
              <Text style={s.fieldLabel}>What do you need picked up?</Text>
              <TextInput
                style={s.notesInput}
                placeholder="e.g. Prescription for John Smith, 2 bags of groceries…"
                placeholderTextColor="#9CA3AF"
                value={description}
                onChangeText={setDescription}
                multiline
                editable={phase === 'confirm'}
              />
            </View>

            <View style={s.fieldWrap}>
              <Text style={s.fieldLabel}>Add photos or a video (optional)</Text>
              <View style={s.mediaRow}>
                {media.map((item, i) => (
                  <View key={i} style={s.mediaThumb}>
                    {item.type === 'video' ? (
                      // expo-image can't render a video file as a still frame
                      // — a plain placeholder is simpler and more reliable
                      // than pulling in thumbnail-generation for a lightweight
                      // one-step modal like this.
                      <View style={s.mediaVideoPlaceholder}>
                        <VideoIcon size={22} color="#fff" />
                      </View>
                    ) : (
                      <Image source={{ uri: item.uri }} style={s.mediaImg} contentFit="cover" />
                    )}
                    {phase === 'confirm' && (
                      <TouchableOpacity style={s.mediaRemove} onPress={() => setMedia(prev => prev.filter((_, idx) => idx !== i))}>
                        <X size={12} color="#fff" />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                {media.length < 3 && phase === 'confirm' && (
                  <TouchableOpacity style={s.mediaAdd} onPress={pickMedia}>
                    <Camera size={20} color="#6B7280" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </ScrollView>

          {skillResolveError && (
            <TouchableOpacity onPress={resolveSkill} style={s.retryRow}>
              <Text style={s.retryText}>Couldn't connect — tap to retry</Text>
            </TouchableOpacity>
          )}

          {phase === 'confirm' && (
            <TouchableOpacity
              style={[s.postButton, !canPost && s.postButtonDisabled]}
              onPress={handlePost}
              disabled={!canPost}
            >
              <Text style={s.postButtonText}>Post Now</Text>
            </TouchableOpacity>
          )}

          {phase === 'posting' && (
            <View style={s.centerRow}>
              <ActivityIndicator size="small" color="#6B7280" />
              <Text style={s.centerText}>Sending to nearby pros…</Text>
            </View>
          )}

          {phase === 'success' && (
            <View style={s.centerRow}>
              <CheckCircle2 size={20} color="#10B981" />
              <Text style={[s.centerText, { color: '#10B981', fontFamily: Fonts.poppinsSemiBold }]}>Posted! We'll match you shortly.</Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.light.card,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, gap: 14,
  },
  dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#E0F2FE', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, lineHeight: 21, fontFamily: Fonts.poppinsBold, color: '#111827' },
  subtitle: { fontSize: 12, lineHeight: 16, fontFamily: Fonts.poppins, color: '#6B7280', marginTop: 2 },
  closeBtn: { padding: 4 },

  fieldWrap: { position: 'relative', gap: 6, marginBottom: 14 },
  fieldLabel: { fontSize: 12, lineHeight: 16, fontFamily: Fonts.poppinsBold, color: '#6B7280' },
  searchInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12,
    paddingHorizontal: 12, height: 46, backgroundColor: '#F9FAFB',
  },
  searchInput: { flex: 1, fontSize: 14, lineHeight: 18, fontFamily: Fonts.poppins, color: '#111827' },
  suggestionsBox: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12,
    marginTop: 4, backgroundColor: '#F9FAFB', overflow: 'hidden',
  },
  suggestionRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  suggestionMainText: { fontSize: 13, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
  suggestionSecondaryText: { fontSize: 11, lineHeight: 15, fontFamily: Fonts.poppins, color: '#6B7280', marginTop: 2 },
  fieldError: { fontSize: 11, lineHeight: 15, fontFamily: Fonts.poppinsSemiBold, color: '#EF4444', marginTop: 4 },

  locationRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F3F4F6', borderRadius: 12, padding: 12, marginBottom: 14,
  },
  locationText: { flex: 1, fontSize: 13, lineHeight: 17, fontFamily: Fonts.poppins, color: '#111827' },

  notesInput: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12,
    padding: 12, minHeight: 70, fontSize: 14, lineHeight: 18, fontFamily: Fonts.poppins,
    color: '#111827', textAlignVertical: 'top',
  },

  mediaRow: { flexDirection: 'row', gap: 8 },
  mediaThumb: { width: 60, height: 60, borderRadius: 10, overflow: 'hidden' },
  mediaImg: { width: '100%', height: '100%' },
  mediaVideoPlaceholder: {
    width: '100%', height: '100%', backgroundColor: '#111827',
    alignItems: 'center', justifyContent: 'center',
  },
  mediaRemove: { position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, padding: 2 },
  mediaAdd: {
    width: 60, height: 60, borderRadius: 10, borderWidth: 1.5, borderColor: '#E5E7EB',
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F9FAFB',
  },

  retryRow: { alignItems: 'center', paddingVertical: 2 },
  retryText: { fontSize: 13, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#EF4444' },

  postButton: { backgroundColor: '#FFCE48', borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  postButtonDisabled: { opacity: 0.5 },
  postButtonText: { fontSize: 15, lineHeight: 19, fontFamily: Fonts.poppinsBold, color: '#111827' },

  centerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  centerText: { fontSize: 14, lineHeight: 18, fontFamily: Fonts.poppins, color: '#6B7280' },
});
