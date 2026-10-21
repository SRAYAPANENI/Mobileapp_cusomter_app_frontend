import { useAppAlert } from '@/components/app-alert';
import { Colors, Fonts } from '@/constants/theme';
import { SkoFyApi } from '@/services/api';
import { GooglePlacesService, GooglePlaceSuggestion } from '@/services/google-places';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Camera, CheckCircle2, Home, IdCard, MapPin, Package, ShieldAlert, Square, SquareCheck, Store, Video as VideoIcon, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Text, TextInput } from '@/components/scaled-text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PickupOptions } from '@/components/pickup-options';
import {
  DEFAULT_PERSON_PICKUP_RULES, PersonPickupRules, PickupDetails, PickupPurchase, PickupSource, PickupTiming,
  ShoppingItem, hasIdOnFile, newShoppingItem, parseLimit, personPickupError, pickupJobFields, purchaseError,
  shoppingListError, timingError,
} from '@/services/pickupOptions';

type MediaItem = { uri: string; type: 'image' | 'video' };

// Posted directly from the home screen's Pickup & Drop banner — no
// intermediate picker screen (same "modal, not a route" pattern as
// QuickNeedModal). The customer's already-confirmed location (from the
// shared location picker in home.tsx) becomes the DROPOFF point — "bring it
// to me here". The pickup is either a store (an allowlisted business) or a
// person at any address — a friend's house — with its own safeguards
// (services/pickupOptions.ts, server: app/domain/pickup.py).
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
  const [source, setSource] = useState<PickupSource>('STORE');
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
  // When, who pays for the goods, and how to find the door (PickupOptions).
  const [timing, setTiming] = useState<PickupTiming>({ kind: 'ASAP' });
  const [purchase, setPurchase] = useState<PickupPurchase>('PREPAID');
  const [limitText, setLimitText] = useState('');
  const [dropoffNotes, setDropoffNotes] = useState('');
  // What to collect: order details (already paid) or a shopping list (buy for me).
  const [pickupDetails, setPickupDetails] = useState<PickupDetails>({});
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([newShoppingItem()]);
  // From a person: the item, its value, who hands it over, and the declaration.
  const [personItem, setPersonItem] = useState('');
  const [valueText, setValueText] = useState('');
  const [handoverName, setHandoverName] = useState('');
  const [handoverPhone, setHandoverPhone] = useState('');
  const [declared, setDeclared] = useState(false);
  const [rules, setRules] = useState<PersonPickupRules>(DEFAULT_PERSON_PICKUP_RULES);
  // An ID on their profile — needed for a pickup from a person (null = still checking).
  const [idOnFile, setIdOnFile] = useState<boolean | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPhase('confirm');
    setSource('STORE');
    setDescription('');
    resetPickupPlace();
    setMedia([]);
    setTiming({ kind: 'ASAP' }); setPurchase('PREPAID'); setLimitText(''); setDropoffNotes('');
    setPickupDetails({}); setShoppingItems([newShoppingItem()]);
    setPersonItem(''); setValueText(''); setHandoverName(''); setHandoverPhone(''); setDeclared(false);
    setIdOnFile(null);
    SkoFyApi.jobs.getPickupPlaceTypes().then(setAllowedPickupTypes).catch(() => {});
    SkoFyApi.jobs.getPersonPickupRules().then(setRules).catch(() => {});
    SkoFyApi.customers.getProfile()
      .then((p) => setIdOnFile(hasIdOnFile(p)))
      .catch(() => setIdOnFile(null));
    resolveSkill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const resetPickupPlace = () => {
    setPickupQuery(''); setPickupSuggestions([]); setPickupTypeError(null);
    setPickupPlaceId(null); setPickupPlaceType(null);
    setPickupLat(null); setPickupLng(null);
  };

  const chooseSource = (next: PickupSource) => {
    if (next === source) return;
    setSource(next);
    resetPickupPlace(); // a store must be re-picked from the allowlist, and vice versa
    if (next === 'PERSON') setPurchase('PREPAID'); // nothing is bought from a person
  };

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
        // A store: only allowlisted businesses. A person: any address.
        const results = await GooglePlacesService.searchAddress(
          pickupQuery, undefined, bias, source === 'STORE' ? allowedPickupTypes : undefined,
        );
        setPickupSuggestions(results);
      } catch { setPickupSuggestions([]); }
      setPickupSearching(false);
    }, 350);
    return () => clearTimeout(handle);
  }, [pickupQuery, dropoffLat, dropoffLng, allowedPickupTypes, source]);

  const handlePickupSelect = async (item: GooglePlaceSuggestion) => {
    setPickupSuggestions([]);
    setPickupQuery(item.description);
    try {
      const details = await GooglePlacesService.getPlaceDetails(item.place_id);
      setPickupPlaceId(item.place_id);
      setPickupPlaceType(details.primary_type ?? null);
      setPickupLat(details.latitude);
      setPickupLng(details.longitude);
      const isAllowed = source === 'PERSON'
        || (!!details.primary_type && allowedPickupTypes.includes(details.primary_type));
      setPickupTypeError(isAllowed
        ? null
        : "This doesn't look like a supported store (grocery, pharmacy, etc). Choose a business — or a pickup from a person.");
    } catch {
      setPickupTypeError('Could not fetch location details. Please check your internet connection.');
    }
  };

  const hasPickupPoint = pickupLat != null && pickupLng != null;
  const hasValidPickup = hasPickupPoint && (source === 'PERSON' || (!!pickupPlaceType && allowedPickupTypes.includes(pickupPlaceType)));
  // What's still missing, in the order the form asks for it.
  const formError = source === 'PERSON'
    ? personPickupError(personItem, valueText, declared, rules)
      ?? (handoverName.trim() ? null : 'Add who will hand it over.')
      ?? (idOnFile === false ? 'Add your ID in Profile first — it’s needed for a pickup from a person.' : null)
      ?? timingError(timing)
    : (description.trim() ? null : 'Say what you need picked up.')
      ?? timingError(timing) ?? purchaseError(purchase, limitText) ?? shoppingListError(purchase, shoppingItems);
  // A missing ID is in formError; if the profile couldn't be read, the server still checks it.
  const ready = hasValidPickup && !formError && !!skillId && !resolvingSkill && dropoffLat != null && dropoffLng != null;

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

  const goAddId = () => {
    onClose();
    router.push('/profile');
  };

  const handlePost = async () => {
    if (!ready || !skillId) return;
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
      const fromPerson = source === 'PERSON';
      const item = personItem.trim();
      const notes = description.trim();
      const title = fromPerson ? `Pick up: ${item}` : notes;
      await SkoFyApi.jobs.create({
        title: title.length > 80 ? `${title.slice(0, 77)}...` : title,
        description: fromPerson ? (notes || `Pick up ${item} and bring it to me.`) : notes,
        skill_id: skillId,
        ...pickupJobFields({
          timing,
          purchase: fromPerson ? 'PREPAID' : purchase,
          limitText,
          notes: dropoffNotes,
          dropoffAddress,
          details: fromPerson
            ? { handover_name: handoverName.trim(), ...(handoverPhone.trim() ? { handover_phone: handoverPhone.trim() } : {}) }
            : pickupDetails,
          items: shoppingItems,
        }),
        lat: pickupLat!, lng: pickupLng!,
        job_type: 'PICKUP_DROPOFF',
        dropoff_lat: dropoffLat!, dropoff_lng: dropoffLng!,
        pickup_source: source,
        ...(fromPerson
          ? { pickup_item: item, item_value: parseLimit(valueText) ?? undefined, item_declared: declared }
          : { pickup_place_id: pickupPlaceId ?? undefined, pickup_place_type: pickupPlaceType ?? undefined }),
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

  const fromPerson = source === 'PERSON';

  return (
    <Modal statusBarTranslucent navigationBarTranslucent visible={visible} animationType="slide" transparent onRequestClose={phase === 'confirm' ? onClose : undefined}>
      <KeyboardAvoidingView behavior="padding" automaticOffset style={s.backdrop}>
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

          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }}>
            {/* Where from: a store, or a person at any address */}
            <View style={s.sourceRow}>
              {([['STORE', 'From a store', Store], ['PERSON', 'From a person', Home]] as const).map(([key, label, Icon]) => {
                const on = source === key;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[s.sourceChip, on && s.sourceChipOn]}
                    onPress={() => chooseSource(key)}
                    disabled={phase !== 'confirm'}
                  >
                    <Icon size={15} color={on ? '#111827' : '#6B7280'} />
                    <Text style={[s.sourceText, on && s.sourceTextOn]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={s.fieldWrap}>
              <Text style={s.fieldLabel}>{fromPerson ? 'Pickup address (a friend, family, anyone)' : 'Pickup from (store, pharmacy, etc.)'}</Text>
              <View style={s.searchInputRow}>
                {fromPerson ? <Home size={16} color="#6B7280" /> : <Store size={16} color="#6B7280" />}
                <TextInput
                  style={s.searchInput}
                  placeholder={fromPerson ? 'Search for an address' : 'Search for a business'}
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

            {fromPerson ? (
              <>
                {idOnFile === false && (
                  <TouchableOpacity style={s.idNotice} onPress={goAddId}>
                    <IdCard size={18} color="#B45309" />
                    <Text style={s.idNoticeText}>A pickup from a person needs your ID on your profile. <Text style={s.idNoticeLink}>Add it now</Text></Text>
                  </TouchableOpacity>
                )}

                <View style={s.fieldWrap}>
                  <Text style={s.fieldLabel}>What's the item?</Text>
                  <TextInput
                    style={s.input}
                    placeholder="e.g. House keys, a phone charger, a box of clothes"
                    placeholderTextColor="#9CA3AF"
                    value={personItem}
                    onChangeText={setPersonItem}
                    maxLength={200}
                    editable={phase === 'confirm'}
                  />
                </View>

                <View style={s.fieldWrap}>
                  <Text style={s.fieldLabel}>What's it worth? (up to ${rules.max_value})</Text>
                  <View style={s.amountRow}>
                    <Text style={s.dollar}>$</Text>
                    <TextInput
                      style={s.amountInput}
                      placeholder="40"
                      placeholderTextColor="#9CA3AF"
                      value={valueText}
                      onChangeText={setValueText}
                      keyboardType="decimal-pad"
                      maxLength={7}
                      editable={phase === 'confirm'}
                    />
                  </View>
                </View>

                <View style={s.fieldWrap}>
                  <Text style={s.fieldLabel}>Who's handing it over?</Text>
                  <TextInput
                    style={s.input}
                    placeholder="Their name"
                    placeholderTextColor="#9CA3AF"
                    value={handoverName}
                    onChangeText={setHandoverName}
                    maxLength={120}
                    editable={phase === 'confirm'}
                  />
                  <TextInput
                    style={[s.input, { marginTop: 8 }]}
                    placeholder="Their phone (optional) — shared only with the provider you hire"
                    placeholderTextColor="#9CA3AF"
                    value={handoverPhone}
                    onChangeText={setHandoverPhone}
                    keyboardType="phone-pad"
                    maxLength={30}
                    editable={phase === 'confirm'}
                  />
                </View>

                <TouchableOpacity style={s.declareRow} onPress={() => setDeclared(d => !d)} disabled={phase !== 'confirm'}>
                  {declared ? <SquareCheck size={20} color="#10B981" /> : <Square size={20} color="#6B7280" />}
                  <Text style={s.declareText}>
                    It isn't {rules.banned}. It will be shown to the provider before they take it — they can refuse it.
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}

            <View style={s.fieldWrap}>
              <Text style={s.fieldLabel}>{fromPerson ? 'Anything else the provider should know? (optional)' : 'What do you need picked up?'}</Text>
              <TextInput
                style={s.notesInput}
                placeholder={fromPerson ? 'e.g. Ring the bell, it’s in a blue bag' : 'e.g. Prescription for John Smith, 2 bags of groceries…'}
                placeholderTextColor="#9CA3AF"
                value={description}
                onChangeText={setDescription}
                multiline
                editable={phase === 'confirm'}
              />
            </View>

            <PickupOptions
              timing={timing}
              onTimingChange={setTiming}
              purchase={purchase}
              onPurchaseChange={setPurchase}
              limitText={limitText}
              onLimitTextChange={setLimitText}
              notes={dropoffNotes}
              onNotesChange={setDropoffNotes}
              details={pickupDetails}
              onDetailsChange={setPickupDetails}
              items={shoppingItems}
              onItemsChange={setShoppingItems}
              editable={phase === 'confirm'}
              source={source}
            />

            {fromPerson && (
              <View style={s.safetyNote}>
                <ShieldAlert size={14} color="#B45309" />
                <Text style={s.safetyText}>The provider checks the item before taking it and can refuse anything on the list — the trip is still paid.</Text>
              </View>
            )}

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

          {phase === 'confirm' && hasValidPickup && formError && (
            <Text style={s.fieldError}>{formError}</Text>
          )}
          {phase === 'confirm' && (
            <TouchableOpacity
              style={[s.postButton, !ready && s.postButtonDisabled]}
              onPress={handlePost}
              disabled={!ready}
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

  sourceRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  sourceChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB',
  },
  sourceChipOn: { backgroundColor: '#FFF6D6', borderColor: '#FFCE48' },
  sourceText: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#6B7280' },
  sourceTextOn: { color: '#111827', fontFamily: Fonts.poppinsBold },

  fieldWrap: { position: 'relative', gap: 6, marginBottom: 14 },
  fieldLabel: { fontSize: 12, lineHeight: 16, fontFamily: Fonts.poppinsBold, color: '#6B7280' },
  searchInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12,
    paddingHorizontal: 12, height: 46, backgroundColor: '#F9FAFB',
  },
  searchInput: { flex: 1, fontSize: 14, lineHeight: 18, fontFamily: Fonts.poppins, color: '#111827' },
  input: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 12, height: 46,
    fontSize: 14, lineHeight: 18, fontFamily: Fonts.poppins, color: '#111827', backgroundColor: '#F9FAFB',
  },
  amountRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12,
    paddingHorizontal: 12, height: 46, backgroundColor: '#F9FAFB', width: 140,
  },
  dollar: { fontSize: 15, lineHeight: 20, fontFamily: Fonts.poppinsBold, color: '#111827', marginRight: 4 },
  amountInput: { flex: 1, fontSize: 15, lineHeight: 20, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
  suggestionsBox: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12,
    marginTop: 4, backgroundColor: '#F9FAFB', overflow: 'hidden',
  },
  suggestionRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  suggestionMainText: { fontSize: 13, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
  suggestionSecondaryText: { fontSize: 11, lineHeight: 15, fontFamily: Fonts.poppins, color: '#6B7280', marginTop: 2 },
  fieldError: { fontSize: 11, lineHeight: 15, fontFamily: Fonts.poppinsSemiBold, color: '#EF4444', marginTop: 4 },

  idNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12,
    backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', marginBottom: 14,
  },
  idNoticeText: { flex: 1, fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppins, color: '#92400E' },
  idNoticeLink: { fontFamily: Fonts.poppinsBold, color: '#B45309', textDecorationLine: 'underline' },
  declareRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  declareText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: Fonts.poppins, color: '#374151' },
  safetyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 14 },
  safetyText: { flex: 1, fontSize: 11.5, lineHeight: 16, fontFamily: Fonts.poppins, color: '#92400E' },

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
