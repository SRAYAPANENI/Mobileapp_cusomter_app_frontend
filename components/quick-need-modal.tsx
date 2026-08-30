import { useAppAlert } from '@/components/app-alert';
import { Colors, Fonts } from '@/constants/theme';
import { QuickNeed } from '@/constants/quick-needs';
import { SkoFyApi } from '@/services/api';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Camera, CheckCircle2, MapPin, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Posted directly from the Explore Services tile row (see home.tsx) — no
// intermediate picker screen. Title/description/skill come from the tapped
// QuickNeed; the only inputs here are the (already-confirmed) location, an
// optional note, and optional photos.
interface Props {
  visible: boolean;
  need: QuickNeed | null;
  lat: number | null;
  lng: number | null;
  address: string;
  onClose: () => void;
  onPosted: () => void;
}

type Phase = 'confirm' | 'posting' | 'success';

export function QuickNeedModal({ visible, need, lat, lng, address, onClose, onPosted }: Props) {
  const insets = useSafeAreaInsets();
  const appAlert = useAppAlert();

  const [phase, setPhase] = useState<Phase>('confirm');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [skillId, setSkillId] = useState<string | null>(null);
  const [resolvingSkill, setResolvingSkill] = useState(false);
  const [skillResolveError, setSkillResolveError] = useState(false);

  useEffect(() => {
    if (!visible || !need) return;
    setPhase('confirm');
    setNotes('');
    setPhotos([]);
    resolveSkill(need);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, need?.id]);

  const resolveSkill = async (n: QuickNeed) => {
    setResolvingSkill(true);
    setSkillResolveError(false);
    setSkillId(null);
    try {
      const list = await SkoFyApi.skills.list(n.profession) as any;
      const match = Array.isArray(list) ? list.find((s: any) => s.name === n.skillName) : null;
      if (match?.id) setSkillId(match.id);
      else setSkillResolveError(true);
    } catch {
      setSkillResolveError(true);
    } finally {
      setResolvingSkill(false);
    }
  };

  const pickPhoto = async () => {
    if (photos.length >= 3) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      setPhotos(prev => [...prev, result.assets[0].uri]);
    }
  };

  const handlePost = async () => {
    if (!need || !skillId || lat == null || lng == null) return;
    setPhase('posting');
    try {
      let imageUrls: string[] = [];
      if (photos.length > 0) {
        try {
          const files = photos.map(uri => ({ uri, type: 'image/jpeg', name: uri.split('/').pop() || 'photo.jpg' }));
          imageUrls = await SkoFyApi.jobs.uploadMedia(files);
        } catch { /* non-fatal — job posts without photos */ }
      }
      await SkoFyApi.jobs.create({
        title: need.title,
        description: notes.trim() ? `${need.description} ${notes.trim()}` : need.description,
        skill_id: skillId,
        urgency: 'HIGH',
        lat, lng,
        images: imageUrls,
        posted_via: 'MANUAL',
      });
      setPhase('success');
      setTimeout(() => onPosted(), 1400);
    } catch (e: any) {
      setPhase('confirm');
      appAlert.show('error', 'Could not post', e?.message || 'Please check your connection and try again.');
    }
  };

  if (!need) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={phase === 'confirm' ? onClose : undefined}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={s.dragHandle} />

          <View style={s.headerRow}>
            <View style={s.iconWrap}>
              <need.Icon size={24} color="#DC2626" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{need.label}</Text>
              <Text style={s.subtitle}>Marked urgent — sent to nearby pros right away.</Text>
            </View>
            {phase === 'confirm' && (
              <TouchableOpacity onPress={onClose} style={s.closeBtn}>
                <X size={20} color="#6B7280" />
              </TouchableOpacity>
            )}
          </View>

          <View style={s.locationRow}>
            <MapPin size={16} color="#6B7280" />
            <Text style={s.locationText} numberOfLines={2}>{address || 'Current location'}</Text>
          </View>

          <View style={s.notesWrap}>
            <Text style={s.notesLabel}>Anything specific? (optional)</Text>
            <TextInput
              style={s.notesInput}
              placeholder="e.g. front-left tire, second floor unit…"
              placeholderTextColor="#9CA3AF"
              value={notes}
              onChangeText={setNotes}
              multiline
              editable={phase === 'confirm'}
            />
          </View>

          <View style={s.photoRow}>
            {photos.map((uri, i) => (
              <View key={i} style={s.photoThumb}>
                <Image source={{ uri }} style={s.photoImg} contentFit="cover" />
                <TouchableOpacity style={s.photoRemove} onPress={() => setPhotos(prev => prev.filter((_, idx) => idx !== i))}>
                  <X size={12} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
            {photos.length < 3 && phase === 'confirm' && (
              <TouchableOpacity style={s.photoAdd} onPress={pickPhoto}>
                <Camera size={20} color="#6B7280" />
              </TouchableOpacity>
            )}
          </View>

          {skillResolveError && (
            <TouchableOpacity onPress={() => resolveSkill(need)} style={s.retryRow}>
              <Text style={s.retryText}>Couldn't connect — tap to retry</Text>
            </TouchableOpacity>
          )}

          {phase === 'confirm' && (
            <TouchableOpacity
              style={[s.postButton, (resolvingSkill || skillResolveError) && s.postButtonDisabled]}
              onPress={handlePost}
              disabled={resolvingSkill || skillResolveError}
            >
              {resolvingSkill ? <ActivityIndicator size="small" color="#111827" /> : <Text style={s.postButtonText}>Post Now</Text>}
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
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.light.card,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, gap: 16,
  },
  dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontFamily: Fonts.poppinsBold, color: '#111827' },
  subtitle: { fontSize: 12, fontFamily: Fonts.poppins, color: '#6B7280', marginTop: 2 },
  closeBtn: { padding: 4 },

  locationRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F3F4F6', borderRadius: 12, padding: 12,
  },
  locationText: { flex: 1, fontSize: 13, fontFamily: Fonts.poppins, color: '#111827' },

  notesWrap: { gap: 6 },
  notesLabel: { fontSize: 12, fontFamily: Fonts.poppinsBold, color: '#6B7280' },
  notesInput: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12,
    padding: 12, minHeight: 56, fontSize: 14, fontFamily: Fonts.poppins,
    color: '#111827', textAlignVertical: 'top',
  },

  photoRow: { flexDirection: 'row', gap: 8 },
  photoThumb: { width: 60, height: 60, borderRadius: 10, overflow: 'hidden' },
  photoImg: { width: '100%', height: '100%' },
  photoRemove: { position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, padding: 2 },
  photoAdd: {
    width: 60, height: 60, borderRadius: 10, borderWidth: 1.5, borderColor: '#E5E7EB',
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6',
  },

  retryRow: { alignItems: 'center', paddingVertical: 2 },
  retryText: { fontSize: 13, fontFamily: Fonts.poppinsSemiBold, color: '#EF4444' },

  postButton: { backgroundColor: '#FFCE48', borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  postButtonDisabled: { opacity: 0.5 },
  postButtonText: { fontSize: 15, fontFamily: Fonts.poppinsBold, color: '#111827' },

  centerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  centerText: { fontSize: 14, fontFamily: Fonts.poppins, color: '#6B7280' },
});
