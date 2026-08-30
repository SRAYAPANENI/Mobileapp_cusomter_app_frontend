import { EmptyJobsState } from '@/components/empty-jobs-state';
import { NoInternetState } from '@/components/no-internet-state';
import { Skeleton } from '@/components/skeleton';
import { SkoFyBottomBar } from '@/components/skofy-bottom-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useIsOnline } from '@/hooks/use-is-online';
import { GooglePlacesService, GooglePlaceSuggestion } from '@/services/google-places';
import { SkoFyApi } from '@/services/api';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  Image as ImageIcon,
  Lock,
  LogOut,
  Mail,
  Map,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Settings,
  ShieldCheck,
  Star,
  Trash2,
  User,
  XCircle
} from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

interface JobHistory {
  id: string;
  title: string;
  professional: string;
  date: string;
  price: string;
  status: 'Completed' | 'Cancelled';
  // What the customer rated the provider
  myReview: { overall: number; comment: string | null } | null;
  // What the provider rated the customer (payment, behaviour, negotiation, environment)
  receivedRating: {
    overall: number;
    payment: number;
    behaviour: number;
    negotiation: number;
    environment: number;
    comment: string | null;
  } | null;
}


const gaugeStyles = StyleSheet.create({
  container: { width: 50, height: 50, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  textContainer: { position: 'absolute', justifyContent: 'center', alignItems: 'center' },
});

function SkillGauge({ score }: { score: number }) {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const size = 50;
  const strokeWidth = 5;
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;

  return (
    <View style={gaugeStyles.container}>
      <Svg width={size} height={size}>
        <Circle cx={center} cy={center} r={radius} stroke="#F3F4F6" strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={center} cy={center} r={radius}
          stroke="#FFCE48" strokeWidth={strokeWidth} fill="none"
          strokeDasharray={`${progress} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      </Svg>
      <View style={gaugeStyles.textContainer}>
        <ThemedText style={{ fontSize: 10, fontFamily: Fonts.poppinsBold, color: themeColors.textPrimary }}>
          {score}%
        </ThemedText>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const insets = useSafeAreaInsets();
  // modalContent's static paddingBottom (Platform-based only) doesn't clear
  // a 3-button Android nav bar — the last action in these bottom sheets can
  // end up sitting behind/under it. Applied once, reused at every usage.
  const modalBottomPad = { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 40 : 24) + 16 };

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isPhotoSheetOpen, setIsPhotoSheetOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isAddAddressOpen, setIsAddAddressOpen] = useState(false);
  const [newAddressType, setNewAddressType] = useState('');
  const [newAddressValue, setNewAddressValue] = useState('');
  const [customAlert, setCustomAlert] = useState<{
    visible: boolean;
    type: 'success' | 'error';
    title: string;
    message: string;
  }>({ visible: false, type: 'success', title: '', message: '' });

  const showAlert = (type: 'success' | 'error', title: string, message: string) => {
    setCustomAlert({ visible: true, type, title, message });
  };

  const hideAlert = () => {
    setCustomAlert({ ...customAlert, visible: false });
  };

  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [jobHistory, setJobHistory] = useState<JobHistory[]>([]);
  // ID document: up to 3 slots. Display URIs (local or server base64 data URLs).
  const [idDocSlots, setIdDocSlots] = useState<(string | null)[]>([null, null, null]);
  // Parallel base64 array kept in sync for uploading
  const [idDocBase64, setIdDocBase64] = useState<(string | null)[]>([null, null, null]);

  const [userData, setUserData] = useState({
    name: '',
    phone: '',
    email: '',
    profileImage: null as string | null,
    addresses: [] as { id?: string; type: string; address: string; _origAddress?: string; _origType?: string }[],
    idType: 'Government ID',
    idNumber: '',
    isVerified: false,
    skillScore: 0,
    totalJobs: 0,
    totalSpent: 0,
  });

  const [profileLoading, setProfileLoading] = useState(true);
  const isOnline = useIsOnline();

  const loadProfile = React.useCallback(async () => {
      setProfileLoading(true);
      try {
        const [profile, addressList, summary] = await Promise.all([
          SkoFyApi.customers.getProfile(),
          SkoFyApi.addresses.list() as Promise<Array<{ id: string; label: string; full_address: string }>>,
          SkoFyApi.jobs.getSummary().catch(() => ({ total_jobs: 0, history: [] })),
        ]);

        // Already filtered to COMPLETED/CANCELLED and sorted server-side —
        // see JobRepository.get_profile_summary.
        const statusMap: Record<string, 'Completed' | 'Cancelled'> = {
          COMPLETED: 'Completed',
          CANCELLED: 'Cancelled',
        };
        const history: JobHistory[] = summary.history.map((j) => ({
          id: j.id,
          title: j.title || 'Service Request',
          professional: j.provider_name ?? 'Provider',
          date: j.updated_at ?? j.created_at
            ? new Date(j.updated_at ?? j.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
            : '—',
          price: j.inspection_fee ? `$${j.inspection_fee}` : (j.budget_min ? `$${j.budget_min}` : '—'),
          status: statusMap[j.status] ?? 'Completed',
          myReview: j.review ? { overall: j.review.overall_rating, comment: j.review.comment ?? null } : null,
          receivedRating: j.customer_review ? {
            overall: j.customer_review.overall_rating,
            payment: j.customer_review.payment_rating,
            behaviour: j.customer_review.behaviour_rating,
            negotiation: j.customer_review.negotiation_rating,
            environment: j.customer_review.environment_rating,
            comment: j.customer_review.comment ?? null,
          } : null,
        }));
        setJobHistory(history);

        setUserData(prev => ({
          ...prev,
          name: profile.name || '',
          phone: profile.phone || '',
          email: profile.email || '',
          profileImage: profile.profile_image_url || null,
          idNumber: profile.id_number || '',
          addresses: addressList.map(a => ({
            id: a.id,
            type: a.label || 'Address',
            address: a.full_address,
            _origAddress: a.full_address,
            _origType: a.label || 'Address',
          })),
          totalJobs: summary.total_jobs,
        }));

        // Load ID document slots from JSON stored in id_document_url
        if (profile.id_document_url) {
          try {
            const parsed = JSON.parse(profile.id_document_url);
            const urls: (string | null)[] = Array.isArray(parsed) ? parsed : [parsed];
            const padded: (string | null)[] = [
              urls[0] ?? null,
              urls[1] ?? null,
              urls[2] ?? null,
            ];
            setIdDocSlots(padded);
            setIdDocBase64(padded);
          } catch {
            setIdDocSlots([profile.id_document_url, null, null]);
            setIdDocBase64([profile.id_document_url, null, null]);
          }
        }
      } catch (error) {
        console.error('Failed to load profile', error);
      } finally {
        setProfileLoading(false);
      }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [addressHeights, setAddressHeights] = useState<Record<number, number>>({});
  const [newAddressHeight, setNewAddressHeight] = useState(80);
  const [suggestions, setSuggestions] = useState<GooglePlaceSuggestion[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | 'new' | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleSearch = (text: string, index: number | 'new') => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();

    setActiveSearchIndex(index);

    if (text.length > 2) {
      setSearchError(null);
      // Clear suggestions immediately when starting a fresh search 
      // to ensure we don't show old results
      setSuggestions([]);

      searchTimeoutRef.current = setTimeout(async () => {
        try {
          setIsSearching(true);
          abortControllerRef.current = new AbortController();
          const results = await GooglePlacesService.searchAddress(text, abortControllerRef.current.signal);
          setSuggestions(results);
          if (results.length === 0) {
            setSearchError('No locations found');
          }
        } catch (error: any) {
          if (error.name !== 'AbortError') {
            console.error('Profile search error:', error);
            setSearchError('Could not fetch locations. Check internet.');
          }
        } finally {
          setIsSearching(false);
        }
      }, 300);
    } else {
      setSuggestions([]);
      setSearchError(null);
      if (text.length === 0) {
        setActiveSearchIndex(null);
      }
    }
  };

  const selectSuggestion = async (item: GooglePlaceSuggestion, index: number | 'new') => {
    try {
      setIsSearching(true);
      const details = await GooglePlacesService.getPlaceDetails(item.place_id);

      if (index === 'new') {
        setNewAddressValue(details.formatted_address);
      } else {
        handleUpdateAddress(index, details.formatted_address);
      }
      setSuggestions([]);
      setActiveSearchIndex(null);
      setSearchError(null);
    } catch (error) {
      console.error('Selection details error:', error);
      showAlert('error', 'Location Error', 'Could not fetch location details. Please check your internet connection.');
    } finally {
      setIsSearching(false);
    }
  };

  const renderHighlightedText = (text: string, matches: any[]) => {
    if (!matches || matches.length === 0) return <ThemedText style={styles.suggestionMainText}>{text}</ThemedText>;

    const parts = [];
    let lastOffset = 0;

    matches.forEach((match, index) => {
      if (match.offset > lastOffset) {
        parts.push(text.substring(lastOffset, match.offset));
      }
      parts.push(
        <ThemedText key={`match-${index}`} style={[styles.suggestionMainText, { fontFamily: Fonts.poppinsBold, color: themeColors.brand }]}>
          {text.substring(match.offset, match.offset + match.length)}
        </ThemedText>
      );
      lastOffset = match.offset + match.length;
    });

    if (lastOffset < text.length) {
      parts.push(text.substring(lastOffset));
    }

    return <ThemedText style={styles.suggestionMainText}>{parts}</ThemedText>;
  };


  const handleUseCurrentLocation = async (index: number) => {
    setIsLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const pos = await Location.getCurrentPositionAsync({});
      const geocode = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude
      });

      if (geocode.length > 0) {
        const addr = geocode[0];
        const readable = `${addr.name || addr.street || ''}, ${addr.district || addr.city || ''}, ${addr.region || ''}, ${addr.postalCode || ''}`.replace(/^, |, $/g, '').replace(/, ,/g, ',');

        if (index === -1) {
          setNewAddressValue(readable);
        } else {
          const newAddresses = [...userData.addresses];
          newAddresses[index].address = readable;
          setUserData({ ...userData, addresses: newAddresses });
        }
      }
    } catch (e) {
      console.log('Location error:', e);
      showAlert('error', 'Location Error', 'Could not fetch your current location.');
    } finally {
      setIsLocating(false);
    }
  };

  const handleUpdateAddress = (index: number, text: string) => {
    const newAddresses = [...userData.addresses];
    newAddresses[index].address = text;
    setUserData({ ...userData, addresses: newAddresses });
  };

  const handleImagePickerTrigger = () => {
    setIsPhotoSheetOpen(true);
  };

  const handleImagePicker = async (useCamera: boolean) => {
    setIsPhotoSheetOpen(false);

    const permissionResult = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permissionResult.granted === false) {
      showAlert('error', 'Permission Denied', `You need to allow ${useCamera ? 'camera' : 'gallery'} access to update your photo.`);
      return;
    }

    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.5, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.5, base64: true });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const dataUrl = `data:image/jpeg;base64,${asset.base64}`;
      setUserData(prev => ({ ...prev, profileImage: asset.uri }));
      try {
        await SkoFyApi.customers.updateProfile({ profile_image_url: dataUrl });
        setTimeout(() => showAlert('success', 'Saved', 'Profile photo updated.'), 300);
      } catch (err) {
        console.error('Failed to save profile photo:', err);
        setTimeout(() => showAlert('error', 'Error', 'Failed to save photo. Try again.'), 300);
      }
    }
  };

  const handlePickDocSlot = async (slotIdx: number, useCamera: boolean) => {
    const perm = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showAlert('error', 'Permission Denied', `Please allow ${useCamera ? 'camera' : 'gallery'} access.`);
      return;
    }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [3, 2], quality: 0.75, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [3, 2], quality: 0.75, base64: true });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const dataUrl = `data:image/jpeg;base64,${asset.base64}`;

      const newSlots = [...idDocSlots] as (string | null)[];
      newSlots[slotIdx] = asset.uri;
      setIdDocSlots(newSlots);

      const newBase64 = [...idDocBase64] as (string | null)[];
      newBase64[slotIdx] = dataUrl;
      setIdDocBase64(newBase64);

      try {
        await SkoFyApi.customers.updateProfile({
          id_document_url: JSON.stringify(newBase64.filter(Boolean)),
        });
        showAlert('success', 'Saved', 'ID document updated.');
      } catch (err) {
        console.error('Failed to save ID document:', err);
        showAlert('error', 'Error', 'Failed to save ID document. Try again.');
      }
    }
  };

  const handleRemoveDocSlot = async (slotIdx: number) => {
    const prevSlot = idDocSlots[slotIdx];
    const prevBase64Val = idDocBase64[slotIdx];

    const newSlots = [...idDocSlots] as (string | null)[];
    newSlots[slotIdx] = null;
    setIdDocSlots(newSlots);

    const newBase64 = [...idDocBase64] as (string | null)[];
    newBase64[slotIdx] = null;
    setIdDocBase64(newBase64);

    try {
      await SkoFyApi.customers.updateProfile({
        id_document_url: JSON.stringify(newBase64.filter(Boolean)),
      });
    } catch (err) {
      console.error('Failed to remove ID document:', err);
      // The server still has the old document — revert the optimistic clear
      // instead of leaving the UI claiming it was removed when it wasn't.
      setIdDocSlots(prev => { const s = [...prev]; s[slotIdx] = prevSlot; return s; });
      setIdDocBase64(prev => { const s = [...prev]; s[slotIdx] = prevBase64Val; return s; });
      showAlert('error', 'Error', 'Failed to remove document. Try again.');
    }
  };

  const removeImage = async () => {
    setIsPhotoSheetOpen(false);
    const prevImage = userData.profileImage;
    setUserData(prev => ({ ...prev, profileImage: null }));
    try {
      await SkoFyApi.customers.updateProfile({ profile_image_url: '' });
      setTimeout(() => showAlert('success', 'Deleted', 'Profile photo removed.'), 300);
    } catch (err) {
      console.error('Failed to remove profile photo:', err);
      // Same reasoning as handleRemoveDocSlot — don't let the UI claim the
      // photo was removed when the server still has it. This also used to
      // show a "removed" success alert unconditionally, even on failure.
      setUserData(prev => ({ ...prev, profileImage: prevImage }));
      showAlert('error', 'Error', 'Failed to remove photo. Try again.');
    }
  };

  const handleUpdateProfile = async () => {
    try {
      await SkoFyApi.customers.updateProfile({ name: userData.name, id_number: userData.idNumber || undefined });
      // Save text edits on existing addresses
      const editPromises = userData.addresses
        .filter(a => a.id && (a.address !== a._origAddress || a.type !== a._origType))
        .map(a => SkoFyApi.addresses.update(a.id!, { label: a.type, full_address: a.address }));
      await Promise.all(editPromises);
      setUserData(prev => ({
        ...prev,
        addresses: prev.addresses.map(a => ({ ...a, _origAddress: a.address, _origType: a.type })),
      }));
      setIsEditing(false);
      showAlert('success', 'Saved', 'Profile updated successfully.');
    } catch {
      showAlert('error', 'Error', 'Failed to save profile. Please try again.');
    }
  };

  const handleAddAddress = async () => {
    if (!newAddressType.trim() || !newAddressValue.trim()) {
      showAlert('error', 'Missing Information', 'Please provide both address label and address.');
      return;
    }
    try {
      const saved = await SkoFyApi.addresses.add({
        label: newAddressType.trim(),
        full_address: newAddressValue.trim(),
        is_default: userData.addresses.length === 0,
      }) as any;
      const entry = {
        id: saved.id as string,
        type: newAddressType.trim(),
        address: newAddressValue.trim(),
        _origAddress: newAddressValue.trim(),
        _origType: newAddressType.trim(),
      };
      setUserData(prev => ({ ...prev, addresses: [...prev.addresses, entry] }));
      setIsAddAddressOpen(false);
      setNewAddressType('');
      setNewAddressValue('');
      setTimeout(() => showAlert('success', 'Success', 'New address added successfully!'), 500);
    } catch {
      showAlert('error', 'Error', 'Failed to add address. Please try again.');
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword) {
      showAlert('error', 'Current Password Required', 'Enter your current password to change it.');
      return;
    }
    if (!newPassword || newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      showAlert('error', 'Weak Password', 'Password must be at least 8 characters and contain a letter and a number.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert('error', 'Mismatch', 'Passwords do not match.');
      return;
    }
    setIsSavingPassword(true);
    try {
      await SkoFyApi.auth.setPassword(newPassword, currentPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setIsPasswordOpen(false);
      showAlert('success', 'Password Updated', 'Your password has been changed successfully. Please log in again on any other device.');
    } catch (e: any) {
      showAlert('error', 'Failed', e?.message || 'Could not update password. Try again.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleDeleteAddress = async (index: number) => {
    const addr = userData.addresses[index];
    if (addr.id) {
      try {
        await SkoFyApi.addresses.delete(addr.id);
      } catch {
        showAlert('error', 'Error', 'Failed to delete address. Please try again.');
        return;
      }
    }
    setUserData(prev => ({ ...prev, addresses: prev.addresses.filter((_, idx) => idx !== index) }));
    setTimeout(() => showAlert('success', 'Deleted', 'Address has been removed.'), 500);
  };

  const renderJobHistoryItem = ({ item, index }: { item: JobHistory; index: number }) => (
    <Animated.View entering={FadeInDown.delay(400 + index * 100)} style={styles.historyCard}>
      <View style={styles.historyHeader}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <ThemedText style={styles.historyTitle}>{item.title}</ThemedText>
          <ThemedText style={styles.historySubtitle}>By {item.professional} • {item.date}</ThemedText>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: item.status === 'Completed' ? '#ECFDF5' : '#FEF2F2' }]}>
          <ThemedText style={[styles.statusText, { color: item.status === 'Completed' ? '#10B981' : '#EF4444' }]}>
            {item.status}
          </ThemedText>
        </View>
      </View>

      <View style={styles.ratingSection}>
        {item.myReview ? (
          <View style={styles.starRow}>
            {[...Array(5)].map((_, i) => (
              <Star key={i} size={14} color={i < item.myReview!.overall ? '#FFCE48' : '#D1D5DB'} fill={i < item.myReview!.overall ? '#FFCE48' : 'none'} />
            ))}
            <ThemedText style={styles.ratingValue}>{item.myReview.overall.toFixed(1)}</ThemedText>
          </View>
        ) : (
          <ThemedText style={[styles.ratingValue, { color: '#9CA3AF' }]}>Not rated yet</ThemedText>
        )}
        <ThemedText style={styles.priceText}>{item.price}</ThemedText>
      </View>

      {item.receivedRating && (
        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F3F4F6' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <ThemedText style={{ fontSize: 11, fontFamily: Fonts.poppinsSemiBold, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Rating from Provider
            </ThemedText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Star size={13} color="#FFCE48" fill="#FFCE48" />
              <ThemedText style={{ fontSize: 13, fontFamily: Fonts.poppinsBold, color: '#111827' }}>
                {item.receivedRating.overall.toFixed(1)}
              </ThemedText>
            </View>
          </View>
          {item.receivedRating.comment && (
            <ThemedText style={styles.commentText}>"{item.receivedRating.comment}"</ThemedText>
          )}
          <View style={styles.metricsContainer}>
            {[
              { label: 'Payment', value: item.receivedRating.payment },
              { label: 'Behaviour', value: item.receivedRating.behaviour },
              { label: 'Negotiation', value: item.receivedRating.negotiation },
              { label: 'Environment', value: item.receivedRating.environment },
            ].map(m => (
              <View key={m.label} style={styles.metricItem}>
                <ThemedText style={styles.metricLabel}>{m.label}</ThemedText>
                <View style={styles.metricBar}>
                  <View style={[styles.metricFill, { width: `${(m.value / 5) * 100}%` as any }]} />
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
    </Animated.View>
  );

  useFocusEffect(
    useCallback(() => {
      const backAction = () => {
        router.replace('/(tabs)/home');
        return true;
      };
      const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
      return () => backHandler.remove();
    }, [])
  );

  // This used to render the full form immediately with userData's zeroed-
  // out defaults (0 Total Jobs, 0% HCI, $0 Spent) indistinguishable from a
  // real empty profile — no loading state ever existed here at all.
  if (profileLoading) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/(tabs)/home')}>
            <ChevronLeft size={24} color="#000" />
          </TouchableOpacity>
          <ThemedText style={styles.headerTitle}>My Profile</ThemedText>
          <View style={{ width: 22 }} />
        </View>
        {!isOnline ? (
          <NoInternetState onRetry={loadProfile} />
        ) : (
          <View style={{ paddingHorizontal: 24, paddingTop: 32, gap: 24 }}>
            <View style={{ alignItems: 'center', gap: 12 }}>
              <Skeleton width={100} height={100} borderRadius={50} />
              <Skeleton width={140} height={18} />
              <Skeleton width={100} height={14} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              <Skeleton width={60} height={40} />
              <Skeleton width={60} height={40} />
              <Skeleton width={60} height={40} />
            </View>
            <Skeleton width="100%" height={64} borderRadius={14} />
            <Skeleton width="100%" height={64} borderRadius={14} />
            <Skeleton width="100%" height={64} borderRadius={14} />
          </View>
        )}
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/(tabs)/home')}>
          <ChevronLeft size={24} color="#000" />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>My Profile</ThemedText>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => setIsSettingsOpen(true)}
        >
          <Settings size={22} color="#000" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Profile Info */}
        <Animated.View entering={FadeInUp.duration(600)} style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            {userData.profileImage ? (
              <Image source={userData.profileImage} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.initialsAvatar]}>
                <ThemedText style={styles.initialsText}>
                  {userData.name
                    ? userData.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
                    : '?'}
                </ThemedText>
              </View>
            )}
            <TouchableOpacity style={styles.editAvatarButton} onPress={handleImagePickerTrigger}>
              <Camera size={16} color="#fff" />
            </TouchableOpacity>
          </View>
          <ThemedText style={styles.userName}>{userData.name}</ThemedText>
          <View style={styles.phoneRow}>
            <ThemedText style={styles.userPhone}>{userData.phone}</ThemedText>
            {userData.isVerified && (
              <View style={styles.verifiedBadge}>
                <ShieldCheck size={12} color="#10B981" />
                <ThemedText style={styles.verifiedText}>Verified</ThemedText>
              </View>
            )}
          </View>
        </Animated.View>

        {/* Quick Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <ThemedText style={styles.statValue}>{userData.totalJobs}</ThemedText>
            <ThemedText style={styles.statLabel}>Total Jobs</ThemedText>
          </View>
          <View style={styles.divider} />
          <View style={styles.statItem}>
            <SkillGauge score={userData.skillScore} />
            <ThemedText style={styles.statLabel}>HCI Meter</ThemedText>
            <ThemedText style={[styles.statLabel, { fontSize: 9 }]}>Human Capital Index</ThemedText>
          </View>
          <View style={styles.divider} />
          <View style={styles.statItem}>
            <ThemedText style={styles.statValue}>$ {userData.totalSpent}</ThemedText>
            <ThemedText style={styles.statLabel}>Spent</ThemedText>
          </View>
        </View>

        {/* Pending Actions */}
        {!userData.email && (
          <>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Pending Actions</ThemedText>
            </View>
            <TouchableOpacity style={styles.actionCard} onPress={() => setIsEmailModalOpen(true)}>
              <View style={styles.actionIconContainer}>
                <AlertCircle size={20} color="#F59E0B" />
              </View>
              <View style={styles.actionInfo}>
                <ThemedText style={styles.actionTitle}>Update Email Address</ThemedText>
                <ThemedText style={styles.actionSubtitle}>Secure your account with an email</ThemedText>
              </View>
              <ChevronRight size={20} color="#D1D5DB" />
            </TouchableOpacity>
          </>
        )}

        {/* Contact Information */}
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionTitle}>Contact Information</ThemedText>
          <TouchableOpacity onPress={() => isEditing ? handleUpdateProfile() : setIsEditing(true)}>
            <ThemedText style={styles.editLink}>{isEditing ? 'Save' : 'Edit'}</ThemedText>
          </TouchableOpacity>
        </View>
        <View style={styles.infoList}>
          {/* Full Name */}
          <View style={styles.infoItem}>
            <User size={20} color="#6B7280" />
            <View style={styles.infoContent}>
              <ThemedText style={styles.infoLabel}>Full Name</ThemedText>
              {isEditing ? (
                <TextInput
                  style={styles.editableInput}
                  value={userData.name}
                  onChangeText={text => setUserData(prev => ({ ...prev, name: text }))}
                  placeholder="Enter your name"
                />
              ) : (
                <ThemedText style={styles.infoValue}>{userData.name || '—'}</ThemedText>
              )}
            </View>
          </View>

          {/* Phone */}
          <View style={[styles.infoItem, { borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 16, marginTop: 16, alignItems: 'center' }]}>
            <Phone size={20} color="#6B7280" />
            <View style={styles.infoContent}>
              <ThemedText style={styles.infoLabel}>Phone Number</ThemedText>
              <ThemedText style={styles.infoValue}>{userData.phone || '—'}</ThemedText>
            </View>
            <View style={{ backgroundColor: '#ECFDF5', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'center' }}>
              <ThemedText style={{ fontSize: 11, color: '#10B981', fontFamily: Fonts.poppinsBold }}>Verified</ThemedText>
            </View>
          </View>

          {/* Email */}
          <View style={[styles.infoItem, { borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 16, marginTop: 16 }]}>
            <Mail size={20} color="#6B7280" />
            <View style={styles.infoContent}>
              <ThemedText style={styles.infoLabel}>Email Address</ThemedText>
              {isEditing ? (
                <TouchableOpacity onPress={() => setIsEmailModalOpen(true)}>
                  <ThemedText style={[styles.infoValue, { color: userData.email ? '#111827' : '#FFCE48' }]}>
                    {userData.email || 'Tap to add email →'}
                  </ThemedText>
                </TouchableOpacity>
              ) : (
                <ThemedText style={[styles.infoValue, !userData.email && { color: '#9CA3AF' }]}>
                  {userData.email || 'Not added'}
                </ThemedText>
              )}
            </View>
            {!isEditing && userData.email && (
              <TouchableOpacity onPress={() => setIsEmailModalOpen(true)}>
                <ThemedText style={{ fontSize: 12, color: '#FFCE48', fontFamily: Fonts.poppinsBold }}>Change</ThemedText>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Saved Addresses */}
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionTitle}>Saved Addresses</ThemedText>
        </View>
        <View style={styles.infoList}>
          {userData.addresses.map((item, idx) => (
            <View key={idx} style={[styles.infoItem, idx !== 0 && { marginTop: 16 }]}>
              <MapPin size={20} color="#6B7280" />
              <View style={styles.infoContent}>
                <ThemedText style={styles.infoLabel}>{item.type} Address</ThemedText>
                {isEditing ? (
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={[styles.editableInput, { height: Math.max(50, addressHeights[idx] || 0) }]}
                      value={item.address}
                      onChangeText={(text) => {
                        handleUpdateAddress(idx, text);
                        handleSearch(text, idx);
                      }}
                      onContentSizeChange={(e) => {
                        const h = e.nativeEvent.contentSize.height;
                        setAddressHeights(prev => ({ ...prev, [idx]: h }));
                      }}
                      multiline
                      onBlur={() => setTimeout(() => setActiveSearchIndex(null), 200)}
                    />
                    {isSearching && activeSearchIndex === idx && (
                      <View style={styles.inputLoaderInline}>
                        <ActivityIndicator size="small" color={themeColors.brand} />
                      </View>
                    )}

                    {activeSearchIndex === idx && (suggestions.length > 0 || searchError || isSearching) && (
                      <View style={[styles.inlineSuggestions, isSearching && { minHeight: 60, justifyContent: 'center' }]}>
                        {isSearching ? (
                          <View style={styles.searchingContainer}>
                            <ThemedText style={styles.searchingText}>Searching locations...</ThemedText>
                          </View>
                        ) : searchError ? (
                          <View style={styles.errorContainer}>
                            <ThemedText style={styles.errorText}>{searchError}</ThemedText>
                            <TouchableOpacity onPress={() => setActiveSearchIndex(null)}>
                              <ThemedText style={[styles.manualText, { color: themeColors.brand }]}>Enter manually</ThemedText>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <ScrollView
                            style={{ maxHeight: 200 }}
                            keyboardShouldPersistTaps="always"
                            nestedScrollEnabled={true}
                          >
                            {suggestions.map((sug) => (
                              <TouchableOpacity key={sug.place_id} style={styles.suggestionItem} onPress={() => selectSuggestion(sug, idx)}>
                                <View style={styles.suggestionIconBox}>
                                  <MapPin size={16} color="#4B5563" fill="#E5E7EB" />
                                </View>
                                <View style={{ flex: 1 }}>
                                  {renderHighlightedText(sug.structured_formatting.main_text, sug.structured_formatting.main_text_matched_substrings || [])}
                                  <View style={styles.suggestionDetails}>
                                    {sug.distance && <ThemedText style={styles.suggestionDistance}>{sug.distance}</ThemedText>}
                                    <ThemedText style={styles.suggestionSecondaryText} numberOfLines={1}>{sug.structured_formatting.secondary_text}</ThemedText>
                                  </View>
                                </View>
                              </TouchableOpacity>
                            ))}
                            <TouchableOpacity style={styles.locateOnMapBtn} onPress={() => handleUseCurrentLocation(idx)}>
                              <Map size={14} color="#4B5563" />
                              <ThemedText style={styles.locateOnMapText}>Locate on Map</ThemedText>
                            </TouchableOpacity>
                          </ScrollView>
                        )}
                      </View>
                    )}

                    {item.address && !activeSearchIndex && (
                      <Animated.View entering={FadeIn} style={styles.addressPreviewCard}>
                        <View style={styles.previewHeader}>
                          <ThemedText style={styles.previewTitle}>Location Verified</ThemedText>
                          <CheckCircle2 size={12} color="#10B981" />
                        </View>
                        <ThemedText style={styles.previewAddress}>{item.address}</ThemedText>
                      </Animated.View>
                    )}

                    <TouchableOpacity
                      style={styles.currentLocationBtn}
                      onPress={() => handleUseCurrentLocation(idx)}
                      disabled={isLocating}
                    >
                      <Map size={14} color="#FFCE48" />
                      <ThemedText style={styles.currentLocationText}>
                        {isLocating ? 'Locating...' : 'Use Current Location'}
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <ThemedText style={styles.infoValue}>{item.address}</ThemedText>
                )}
              </View>
              {isEditing && (
                <TouchableOpacity onPress={() => handleDeleteAddress(idx)}>
                  <Trash2 size={18} color="#EF4444" />
                </TouchableOpacity>
              )}
            </View>
          ))}

          {userData.addresses.length === 0 && !isEditing && (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <ThemedText style={{ color: '#9CA3AF', fontFamily: Fonts.poppins, fontSize: 14 }}>No addresses saved yet</ThemedText>
            </View>
          )}

          {isEditing && (
            <TouchableOpacity
              style={styles.addAddressButton}
              onPress={() => setIsAddAddressOpen(true)}
            >
              <View style={styles.addAddressIconBox}>
                <Plus size={18} color="#FFCE48" />
              </View>
              <ThemedText style={styles.addAddressText}>Add New Address</ThemedText>
            </TouchableOpacity>
          )}
        </View>

        {/* Identity Verification */}
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionTitle}>Identity Verification</ThemedText>
        </View>
        <View style={styles.infoList}>
          {/* ID Number */}
          <View style={styles.infoItem}>
            <CreditCard size={20} color="#6B7280" />
            <View style={styles.infoContent}>
              <ThemedText style={styles.infoLabel}>Government ID Number</ThemedText>
              {isEditing ? (
                <TextInput
                  style={styles.editableInput}
                  value={userData.idNumber}
                  onChangeText={text => setUserData(prev => ({ ...prev, idNumber: text }))}
                  placeholder="Enter your ID number"
                />
              ) : (
                <ThemedText style={[styles.infoValue, !userData.idNumber && { color: '#9CA3AF' }]}>
                  {userData.idNumber || 'Not provided'}
                </ThemedText>
              )}
            </View>
          </View>

          {/* ID Document Photos — up to 3 (Front / Back / Additional) */}
          <View style={{ marginTop: 20, borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 16 }}>
            <ThemedText style={[styles.infoLabel, { marginBottom: 4 }]}>ID Document Photos</ThemedText>
            <ThemedText style={{ fontSize: 11, fontFamily: Fonts.poppins, color: '#9CA3AF', marginBottom: 14 }}>
              Upload front, back, and any additional page (up to 3)
            </ThemedText>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(['Front', 'Back', 'Extra'] as const).map((label, idx) => {
                const uri = idDocSlots[idx];
                return (
                  <View key={label} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                    {uri ? (
                      <View style={{ width: '100%', aspectRatio: 3 / 2 }}>
                        <Image
                          source={{ uri }}
                          style={{ width: '100%', height: '100%', borderRadius: 10 }}
                          contentFit="cover"
                        />
                        {/* Remove X */}
                        <TouchableOpacity
                          style={{ position: 'absolute', top: 4, right: 4, backgroundColor: '#EF4444', borderRadius: 10, padding: 3 }}
                          onPress={() => handleRemoveDocSlot(idx)}
                        >
                          <XCircle size={14} color="#fff" />
                        </TouchableOpacity>
                        {/* Retake */}
                        <TouchableOpacity
                          style={{ position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: 4 }}
                          onPress={() => handlePickDocSlot(idx, true)}
                        >
                          <Camera size={13} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={{ width: '100%', aspectRatio: 3 / 2, borderWidth: 1.5, borderColor: '#D1D5DB', borderStyle: 'dashed', borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#FAFAFA' }}
                        onPress={() => handlePickDocSlot(idx, false)}
                        onLongPress={() => handlePickDocSlot(idx, true)}
                      >
                        <Camera size={18} color="#9CA3AF" />
                        <ThemedText style={{ fontSize: 10, fontFamily: Fonts.poppins, color: '#9CA3AF' }}>Tap / Hold</ThemedText>
                      </TouchableOpacity>
                    )}
                    <ThemedText style={{ fontSize: 11, fontFamily: Fonts.poppinsSemiBold, color: '#6B7280' }}>{label}</ThemedText>
                  </View>
                );
              })}
            </View>
            <ThemedText style={{ fontSize: 10, fontFamily: Fonts.poppins, color: '#C4C9D4', marginTop: 8, textAlign: 'center' }}>
              Tap to pick from gallery · Long-press to take photo
            </ThemedText>
          </View>
        </View>

        {/* Job History */}
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionTitle}>Job History</ThemedText>
          {jobHistory.length > 0 && (
            <TouchableOpacity onPress={() => router.push('/job-history')}>
              <ThemedText style={styles.viewAllLink}>View All</ThemedText>
            </TouchableOpacity>
          )}
        </View>

        {jobHistory.length === 0 ? (
          <EmptyJobsState
            title="No job history yet"
            subtitle="Your completed & cancelled jobs will appear here."
          />
        ) : (
          jobHistory.slice(0, 3).map((item, index) => (
            <View key={item.id}>
              {renderJobHistoryItem({ item, index })}
            </View>
          ))
        )}

        {/* Closing spacer */}
        <View style={styles.footerSpacer} />
      </ScrollView>

      {/* Settings Modal Integrated logic */}
      <Modal
        visible={isSettingsOpen}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsSettingsOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, modalBottomPad]}>
            <View style={styles.modalHeader}>
              <ThemedText style={styles.modalTitle}>Settings</ThemedText>
              <TouchableOpacity onPress={() => setIsSettingsOpen(false)}>
                <XCircle size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.settingsList}>
              <View style={[styles.settingItem, { borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }]}>
                <View style={styles.settingInfo}>
                  <Bell size={20} color="#6B7280" />
                  <ThemedText style={styles.settingLabel}>Push Notifications</ThemedText>
                </View>
                <Switch
                  value={notificationsEnabled}
                  onValueChange={setNotificationsEnabled}
                  trackColor={{ false: '#D1D5DB', true: '#FFCE48' }}
                  thumbColor="#fff"
                />
              </View>

              <TouchableOpacity
                style={[styles.settingItem, { borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }]}
                onPress={() => {
                  setIsSettingsOpen(false);
                  setTimeout(() => setIsPasswordOpen(true), 500);
                }}
              >
                <View style={styles.settingInfo}>
                  <Lock size={20} color="#6B7280" />
                  <ThemedText style={styles.settingLabel}>Change Password</ThemedText>
                </View>
                <ChevronRight size={20} color="#D1D5DB" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.settingItem, { borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }]}
                onPress={() => {
                  setIsSettingsOpen(false);
                  setTimeout(() => setIsTermsOpen(true), 500);
                }}
              >
                <View style={styles.settingInfo}>
                  <FileText size={20} color="#6B7280" />
                  <ThemedText style={styles.settingLabel}>Terms & Conditions</ThemedText>
                </View>
                <ChevronRight size={20} color="#D1D5DB" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.settingItem, { borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }]}
                onPress={() => {
                  setIsSettingsOpen(false);
                  router.push('/help-support');
                }}
              >
                <View style={styles.settingInfo}>
                  <MessageSquare size={20} color="#6B7280" />
                  <ThemedText style={styles.settingLabel}>Help & Support</ThemedText>
                </View>
                <ChevronRight size={20} color="#D1D5DB" />
              </TouchableOpacity>

              <TouchableOpacity style={styles.settingItem} onPress={async () => {
                setIsSettingsOpen(false);
                await SkoFyApi.auth.logout().catch((err) => {
                  // Local logout proceeds regardless — this is just telling
                  // the server to invalidate the refresh token server-side.
                  console.error('Server-side logout failed:', err);
                });
                router.replace('/login');
              }}>
                <View style={styles.settingInfo}>
                  <LogOut size={20} color="#EF4444" />
                  <ThemedText style={[styles.settingLabel, { color: '#EF4444' }]}>Logout</ThemedText>
                </View>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.closeModalButton}
              onPress={() => setIsSettingsOpen(false)}
            >
              <ThemedText style={styles.closeModalButtonText}>Close</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Terms Modal */}
      <Modal visible={isTermsOpen} animationType="slide">
        <ThemedView style={{ flex: 1 }}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setIsTermsOpen(false)}>
              <ChevronLeft size={24} color="#000" />
            </TouchableOpacity>
            <ThemedText style={styles.headerTitle}>Terms & Conditions</ThemedText>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <ThemedText style={{ fontSize: 18, fontFamily: Fonts.poppinsBold, marginBottom: 12 }}>1. Agreement</ThemedText>
            <ThemedText style={{ color: '#4B5563', lineHeight: 24, marginBottom: 20 }}>
              By using SkoFy, you agree to connect with various service providers. We act as a platform for discovery...
            </ThemedText>
            <ThemedText style={{ fontSize: 18, fontFamily: Fonts.poppinsBold, marginBottom: 12 }}>2. Privacy</ThemedText>
            <ThemedText style={{ color: '#4B5563', lineHeight: 24, marginBottom: 20 }}>
              Your data is protected under our strict security policies. We never share your personal information with third parties without consent...
            </ThemedText>
            <ThemedText style={{ fontSize: 18, fontFamily: Fonts.poppinsBold, marginBottom: 12 }}>3. Payments</ThemedText>
            <ThemedText style={{ color: '#4B5563', lineHeight: 24, marginBottom: 20 }}>
              Inspection fees are paid directly to providers unless booked via the app wallet...
            </ThemedText>
          </ScrollView>
        </ThemedView>
      </Modal>

      {/* Change Password Modal */}
      <Modal
        visible={isPasswordOpen}
        animationType="fade"
        transparent
        onRequestClose={() => { setIsPasswordOpen(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }}
      >
        <KeyboardAvoidingView
          style={[styles.modalOverlay, { justifyContent: 'center', padding: 20 }]}
          behavior="padding"
          automaticOffset
        >
          <View style={[styles.modalContent, { borderRadius: 24 }, modalBottomPad]}>
            <ThemedText style={[styles.modalTitle, { marginBottom: 20 }]}>Change Password</ThemedText>
            <ThemedText style={styles.inputLabel}>Current Password</ThemedText>
            <TextInput
              placeholder="Enter current password"
              secureTextEntry
              value={currentPassword}
              onChangeText={setCurrentPassword}
              style={[styles.editableInput, { marginBottom: 16 }]}
            />
            <ThemedText style={styles.inputLabel}>New Password</ThemedText>
            <TextInput
              placeholder="Min 8 characters, 1 letter + 1 number"
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
              style={[styles.editableInput, { marginBottom: 16 }]}
            />
            <ThemedText style={styles.inputLabel}>Confirm New Password</ThemedText>
            <TextInput
              placeholder="Repeat password"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              style={[styles.editableInput, { marginBottom: 24 }]}
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                style={[styles.closeModalButton, { flex: 1, marginTop: 0 }]}
                onPress={() => { setIsPasswordOpen(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }}
              >
                <ThemedText>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.closeModalButton, { flex: 1, marginTop: 0, backgroundColor: '#FFCE48' }, isSavingPassword && { opacity: 0.6 }]}
                onPress={handleChangePassword}
                disabled={isSavingPassword}
              >
                <ThemedText style={{ fontFamily: Fonts.poppinsBold }}>{isSavingPassword ? 'Saving…' : 'Update'}</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Photo Options Modal */}
      <Modal visible={isPhotoSheetOpen} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsPhotoSheetOpen(false)}
        >
          <View style={styles.photoSheet}>
            <View style={styles.photoSheetHeader}>
              <ThemedText style={styles.photoSheetTitle}>Profile Photo</ThemedText>
            </View>

            <TouchableOpacity style={styles.photoOption} onPress={() => handleImagePicker(true)}>
              <View style={[styles.optionIconBox, { backgroundColor: '#E0F2FE' }]}>
                <Camera size={20} color="#0EA5E9" />
              </View>
              <ThemedText style={styles.photoOptionText}>Take Photo</ThemedText>
            </TouchableOpacity>

            <TouchableOpacity style={styles.photoOption} onPress={() => handleImagePicker(false)}>
              <View style={[styles.optionIconBox, { backgroundColor: '#F0F9FF' }]}>
                <ImageIcon size={20} color="#0369A1" />
              </View>
              <ThemedText style={styles.photoOptionText}>Choose from Gallery</ThemedText>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.photoOption, { borderBottomWidth: 0 }]} onPress={removeImage}>
              <View style={[styles.optionIconBox, { backgroundColor: '#FEF2F2' }]}>
                <Trash2 size={20} color="#EF4444" />
              </View>
              <ThemedText style={[styles.photoOptionText, { color: '#EF4444' }]}>Remove Photo</ThemedText>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Add Address Modal */}
      <Modal visible={isAddAddressOpen} transparent animationType="fade">
        <KeyboardAvoidingView
          style={[styles.modalOverlay, { justifyContent: 'center', padding: 20 }]}
          behavior="padding"
          automaticOffset
        >
          <View style={[styles.modalContent, { borderRadius: 24 }, modalBottomPad]}>
            <View style={styles.photoSheetHeader}>
              <ThemedText style={styles.photoSheetTitle}>Add New Address</ThemedText>
            </View>

            <ThemedText style={styles.inputLabel}>Address Label</ThemedText>
            <TextInput
              placeholder="e.g., Home, Work, Gym"
              value={newAddressType}
              onChangeText={setNewAddressType}
              style={[styles.editableInput, { marginBottom: 20 }]}
            />

            <ThemedText style={styles.inputLabel}>Address</ThemedText>
            <TextInput
              value={newAddressValue}
              onChangeText={(text) => {
                setNewAddressValue(text);
                handleSearch(text, 'new');
              }}
              multiline
              onContentSizeChange={(e) => setNewAddressHeight(e.nativeEvent.contentSize.height)}
              style={[styles.editableInput, { marginBottom: 12, minHeight: 90, height: Math.max(90, newAddressHeight) }]}
              placeholder="Search or type address..."
              textAlignVertical="top"
            />

            {activeSearchIndex === 'new' && (suggestions.length > 0 || searchError || isSearching) && (
              <View style={[styles.inlineSuggestions, { marginBottom: 12 }, isSearching && { minHeight: 60, justifyContent: 'center' }]}>
                {isSearching ? (
                  <View style={styles.searchingContainer}>
                    <ThemedText style={styles.searchingText}>Searching locations...</ThemedText>
                  </View>
                ) : searchError ? (
                  <View style={styles.errorContainer}>
                    <ThemedText style={styles.errorText}>{searchError}</ThemedText>
                    <TouchableOpacity onPress={() => setActiveSearchIndex(null)}>
                      <ThemedText style={[styles.manualText, { color: themeColors.brand }]}>Enter manually</ThemedText>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <ScrollView
                    style={{ maxHeight: 200 }}
                    keyboardShouldPersistTaps="always"
                    nestedScrollEnabled={true}
                  >
                    {suggestions.map((sug) => (
                      <TouchableOpacity key={sug.place_id} style={styles.suggestionItem} onPress={() => selectSuggestion(sug, 'new')}>
                        <View style={styles.suggestionIconBox}>
                          <MapPin size={18} color="#4B5563" fill="#E5E7EB" />
                        </View>
                        <View style={{ flex: 1 }}>
                          {renderHighlightedText(sug.structured_formatting.main_text, sug.structured_formatting.main_text_matched_substrings || [])}
                          <View style={styles.suggestionDetails}>
                            {sug.distance && <ThemedText style={styles.suggestionDistance}>{sug.distance}</ThemedText>}
                            <ThemedText style={styles.suggestionSecondaryText} numberOfLines={1}>{sug.structured_formatting.secondary_text}</ThemedText>
                          </View>
                        </View>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity style={styles.locateOnMapBtn} onPress={() => handleUseCurrentLocation(-1)}>
                      <Map size={16} color="#4B5563" />
                      <ThemedText style={styles.locateOnMapText}>Locate on Map</ThemedText>
                    </TouchableOpacity>
                  </ScrollView>
                )}
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                style={[styles.closeModalButton, { flex: 1, marginTop: 0 }]}
                onPress={() => {
                  setIsAddAddressOpen(false);
                  setNewAddressType('');
                  setNewAddressValue('');
                }}
              >
                <ThemedText>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.closeModalButton, { flex: 1, marginTop: 0, backgroundColor: '#FFCE48' }]}
                onPress={handleAddAddress}
              >
                <ThemedText style={{ fontFamily: Fonts.poppinsBold }}>Add Address</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Update Email Modal */}
      <Modal visible={isEmailModalOpen} transparent animationType="fade">
        <KeyboardAvoidingView
          style={[styles.modalOverlay, { justifyContent: 'center', padding: 20 }]}
          behavior="padding"
          automaticOffset
        >
          <View style={[styles.modalContent, { borderRadius: 24 }, modalBottomPad]}>
            <ThemedText style={[styles.modalTitle, { marginBottom: 8 }]}>Update Email Address</ThemedText>
            <ThemedText style={{ color: '#6B7280', fontFamily: Fonts.poppins, fontSize: 13, marginBottom: 20 }}>
              We'll use this to secure your account and send receipts.
            </ThemedText>
            <TextInput
              placeholder="Enter your email address"
              value={emailInput}
              onChangeText={setEmailInput}
              keyboardType="email-address"
              autoCapitalize="none"
              style={[styles.editableInput, { marginBottom: 24 }]}
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                style={[styles.closeModalButton, { flex: 1, marginTop: 0 }]}
                onPress={() => { setIsEmailModalOpen(false); setEmailInput(''); }}
              >
                <ThemedText>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.closeModalButton, { flex: 1, marginTop: 0, backgroundColor: '#FFCE48' }]}
                disabled={emailSaving}
                onPress={async () => {
                  if (!emailInput.includes('@')) {
                    showAlert('error', 'Invalid Email', 'Please enter a valid email address.');
                    return;
                  }
                  try {
                    setEmailSaving(true);
                    await SkoFyApi.customers.updateProfile({ email: emailInput.trim() });
                    setUserData(prev => ({ ...prev, email: emailInput.trim() }));
                    setIsEmailModalOpen(false);
                    setEmailInput('');
                    showAlert('success', 'Email Updated', 'Your email address has been saved.');
                  } catch (error: any) {
                    const message = error?.error_code === 'EMAIL_ALREADY_EXISTS'
                      ? error.message
                      : 'Could not update email. Please try again.';
                    showAlert('error', 'Update Failed', message);
                  } finally {
                    setEmailSaving(false);
                  }
                }}
              >
                <ThemedText style={{ fontFamily: Fonts.poppinsBold }}>
                  {emailSaving ? 'Saving...' : 'Save'}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Custom Alert Modal */}
      <Modal visible={customAlert.visible} transparent animationType="fade">
        <View style={[styles.modalOverlay, { justifyContent: 'center', padding: 20 }]}>
          <View style={[styles.customAlertContainer, customAlert.type === 'success' ? styles.successAlert : styles.errorAlert]}>
            <View style={[styles.alertIconContainer, { backgroundColor: customAlert.type === 'success' ? '#ECFDF5' : '#FEF2F2' }]}>
              {customAlert.type === 'success' ? (
                <CheckCircle2 size={32} color="#10B981" />
              ) : (
                <AlertTriangle size={32} color="#EF4444" />
              )}
            </View>

            <ThemedText style={styles.alertTitle}>{customAlert.title}</ThemedText>
            <ThemedText style={styles.alertMessage}>{customAlert.message}</ThemedText>

            <TouchableOpacity
              style={[styles.alertButton, { backgroundColor: customAlert.type === 'success' ? '#10B981' : '#EF4444' }]}
              onPress={hideAlert}
            >
              <ThemedText style={styles.alertButtonText}>OK</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Fixed Bottom Navigation Dock ── */}
      <SkoFyBottomBar activeTab="profile" />
    </ThemedView>
  );
}

function makeStyles(t: typeof Colors.light) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 20,
    backgroundColor: t.card,
    borderBottomWidth: 1,
    borderBottomColor: t.borderSubtle,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
  settingsButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  profileSection: {
    alignItems: 'center',
    backgroundColor: t.card,
    paddingVertical: 30,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: t.inputFilled,
  },
  editAvatarButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#111827',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: t.card,
  },
  userName: {
    fontSize: 22,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  userPhone: {
    fontSize: 14,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  verifiedText: {
    fontSize: 10,
    fontFamily: Fonts.poppinsBold,
    color: '#10B981',
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: t.card,
    marginHorizontal: 20,
    marginTop: -25,
    borderRadius: 20,
    paddingVertical: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 5,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  divider: {
    width: 1,
    height: '60%',
    backgroundColor: t.borderSubtle,
    alignSelf: 'center',
  },
  statValue: {
    fontSize: 18,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  statLabel: {
    fontSize: 12,
    fontFamily: Fonts.poppins,
    color: t.textMuted,
    marginTop: 2,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 32,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  editLink: {
    fontSize: 13,
    fontFamily: Fonts.poppinsBold,
    color: '#FFCE48',
  },
  viewAllLink: {
    fontSize: 13,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#6B7280',
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    marginHorizontal: 20,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FEF3C7',
  },
  actionIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  actionInfo: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 14,
    fontFamily: Fonts.poppinsBold,
    color: '#92400E',
  },
  actionSubtitle: {
    fontSize: 12,
    fontFamily: Fonts.poppins,
    color: '#B45309',
  },
  infoList: {
    backgroundColor: t.card,
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 16,
    gap: 20,
  },
  infoItem: {
    flexDirection: 'row',
    gap: 16,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    fontFamily: Fonts.poppins,
    color: t.textMuted,
  },
  infoValue: {
    fontSize: 14,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
    marginTop: 2,
  },
  historyCard: {
    backgroundColor: t.card,
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.borderSubtle,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  historyTitle: {
    fontSize: 15,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  historySubtitle: {
    fontSize: 12,
    fontFamily: Fonts.poppins,
    color: t.textMuted,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 10,
    fontFamily: Fonts.poppinsBold,
  },
  ratingSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  starRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingValue: {
    fontSize: 12,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginLeft: 4,
  },
  priceText: {
    fontSize: 14,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  commentText: {
    fontSize: 13,
    fontFamily: Fonts.poppins,
    fontStyle: 'italic',
    color: t.textSecondary,
    backgroundColor: t.surface,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  metricsContainer: {
    gap: 10,
  },
  metricItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metricLabel: {
    width: 80,
    fontSize: 11,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  metricBar: {
    flex: 1,
    height: 4,
    backgroundColor: t.borderSubtle,
    borderRadius: 2,
  },
  metricFill: {
    height: '100%',
    backgroundColor: '#FFCE48',
    borderRadius: 2,
  },
  settingsList: {
    backgroundColor: t.card,
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 8,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingLabel: {
    fontSize: 14,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  footerSpacer: {
    height: 40,
  },
  gaugeContainer: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  gaugeTextContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gaugeLabelText: {
    fontSize: 10,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: t.card,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  closeModalButton: {
    backgroundColor: t.inputFilled,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  closeModalButtonText: {
    fontSize: 16,
    fontFamily: Fonts.poppinsBold,
    color: t.textSecondary,
  },
  editableInput: {
    fontFamily: Fonts.poppins,
    fontSize: 14,
    color: t.textSecondary,
    backgroundColor: t.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: t.border,
    textAlignVertical: 'top',
  },
  inlineSuggestions: {
    backgroundColor: t.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    marginTop: 4,
    maxHeight: 200,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.borderSubtle,
  },
  suggestionIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.inputFilled,
    justifyContent: 'center',
    alignItems: 'center',
  },
  suggestionMainText: {
    fontSize: 14,
    color: t.textPrimary,
    fontFamily: Fonts.poppinsSemiBold,
  },
  suggestionDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 1,
  },
  suggestionDistance: {
    fontSize: 10,
    color: t.textSecondary,
    fontFamily: Fonts.poppins,
    borderRightWidth: 1,
    borderRightColor: t.border,
    paddingRight: 6,
  },
  suggestionSecondaryText: {
    fontSize: 11,
    color: t.textSecondary,
    fontFamily: Fonts.poppins,
    flex: 1,
  },
  locateOnMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: t.borderSubtle,
  },
  locateOnMapText: {
    fontSize: 12,
    color: t.textSecondary,
    fontFamily: Fonts.poppinsBold,
  },
  errorContainer: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 13,
    color: t.textSecondary,
    fontFamily: Fonts.poppins,
    textAlign: 'center',
    marginBottom: 8,
  },
  manualText: {
    fontSize: 12,
    fontFamily: Fonts.poppinsBold,
  },
  currentLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 6,
  },
  currentLocationText: {
    fontSize: 12,
    fontFamily: Fonts.poppinsBold,
    color: '#FFCE48',
  },
  inputLoaderInline: {
    position: 'absolute',
    right: 12,
    top: 16,
  },
  searchingContainer: {
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchingText: {
    fontSize: 12,
    color: t.textSecondary,
    fontFamily: Fonts.poppins,
  },
  photoSheet: {
    backgroundColor: t.card,
    width: '90%',
    borderRadius: 24,
    padding: 24,
    alignSelf: 'center',
    marginBottom: 40,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  addressPreviewCard: {
    backgroundColor: t.surface,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: t.borderSubtle,
    borderLeftWidth: 3,
    borderLeftColor: '#10B981',
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  previewTitle: {
    fontSize: 10,
    fontFamily: Fonts.poppinsBold,
    color: t.textSecondary,
    textTransform: 'uppercase',
  },
  previewAddress: {
    fontSize: 12,
    color: '#344054',
    fontFamily: Fonts.poppinsSemiBold,
    lineHeight: 18,
  },
  photoSheetHeader: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: t.borderSubtle,
    paddingBottom: 12,
  },
  photoSheetTitle: {
    fontSize: 18,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  photoOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 12,
  },
  optionIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoOptionText: {
    fontSize: 15,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#344054',
  },
  addAddressButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FEF3C7',
    borderStyle: 'dashed',
    marginTop: 12,
  },
  addAddressIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addAddressText: {
    fontSize: 14,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#92400E',
  },
  inputLabel: {
    fontSize: 13,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
    marginBottom: 8,
  },
  customAlertContainer: {
    backgroundColor: t.card,
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  successAlert: {
    borderTopWidth: 4,
    borderTopColor: '#10B981',
  },
  errorAlert: {
    borderTopWidth: 4,
    borderTopColor: '#EF4444',
  },
  alertIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  alertTitle: {
    fontSize: 20,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  alertMessage: {
    fontSize: 14,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  alertButton: {
    width: '100%',
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertButtonText: {
    fontSize: 16,
    fontFamily: Fonts.poppinsBold,
    color: '#fff',
  },
  initialsAvatar: {
    backgroundColor: '#FFCE48',
    justifyContent: 'center',
    alignItems: 'center',
  },
  initialsText: {
    fontSize: 32,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  });
}
