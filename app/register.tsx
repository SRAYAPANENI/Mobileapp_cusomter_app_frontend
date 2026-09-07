import AnimatedBackground from '@/components/animated-background';
import AnimatedBrandMark from '@/components/animated-brand-mark';
import { useAppAlert } from '@/components/app-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { GooglePlacesService, GooglePlaceSuggestion } from '@/services/google-places';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ExpoLocation from 'expo-location';
import { router } from 'expo-router';
import {
  Briefcase,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Circle,
  Eye,
  EyeOff,
  Home,
  Layers,
  LocateFixed,
  Mail,
  MapPin,
  Plus,
  ShieldCheck,
  Upload,
  X
} from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import CountryPicker, { Country, CountryCode } from 'react-native-country-picker-modal';
import Animated, {
  FadeIn,
  FadeInLeft,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

export default function RegisterScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const appAlert = useAppAlert();

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    mobileNumber: '',
    otp: '',
    address: '',
    idNumber: '',
    password: '',
    confirmPassword: '',
  });

  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [idDocumentImages, setIdDocumentImages] = useState<(string | null)[]>([null, null, null]);
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  // True when this phone already had a Provider account and is now adding a
  // Customer profile (dual-role, same identity) — as opposed to a genuinely
  // brand-new account. A password already exists for this identity, so the
  // password step below is skipped rather than calling setPassword without
  // the current_password it would then require.
  const [isAddingRole, setIsAddingRole] = useState(false);

  const [countryCode, setCountryCode] = useState<CountryCode>('US');
  const [callingCode, setCallingCode] = useState('1');
  const [isCountryPickerVisible, setIsCountryPickerVisible] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [addressType, setAddressType] = useState<'Home' | 'Work' | 'Other'>('Home');
  const [customLabel, setCustomLabel] = useState('');

  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [addressHeight, setAddressHeight] = useState(80);
  const [suggestions, setSuggestions] = useState<GooglePlaceSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const searchTimeoutRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const progressValue = useSharedValue(0);

  // Form completion calculation for progress bar. When adding a role to an
  // existing account (isAddingRole), the password step doesn't apply — a
  // password already exists for this identity — so it's excluded from the
  // total instead of permanently blocking the submit button below 100%.
  const calculateProgress = () => {
    let completed = 0;
    const total = isAddingRole ? 7 : 8; // Name, Phone, OTP, Address, AddressType, ID Number, ID Doc, [Password]
    if (formData.fullName) completed++;
    if (isOtpVerified) completed++;
    if (formData.address) completed++;
    if (addressType) completed++; // Always has a value
    if (formData.idNumber) completed++;
    if (idDocumentImages.some(Boolean)) completed++;
    if (!isAddingRole && formData.password && formData.password === formData.confirmPassword && formData.password.length >= 6) completed++;
    if (agreedToTerms && agreedToPrivacy) completed++;

    return completed / total;
  };

  useEffect(() => {
    progressValue.value = withSpring(calculateProgress(), { damping: 15 });
  }, [formData, isOtpVerified, addressType, idDocumentImages, agreedToTerms, agreedToPrivacy, isAddingRole]);

  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${progressValue.value * 100}%` as any,
  }));

  // button pulse removed — withRepeat(-1) caused OOM on low-end devices

  const getPasswordStrength = (pass: string) => {
    if (!pass) return { label: '', color: '#E5E7EB', width: '0%', score: 0 };
    if (pass.length < 6) return { label: 'Too Short', color: '#FF4B4B', width: '20%', score: 1 };

    let score = 0;
    if (pass.length >= 8) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;

    if (score <= 1) return { label: 'Weak', color: '#FF4B4B', width: '33%', score: 2 };
    if (score <= 2) return { label: 'Medium', color: '#FFA500', width: '66%', score: 3 };
    return { label: 'Strong', color: '#4CAF50', width: '100%', score: 4 };
  };

  const getCurrentLocation = async () => {
    setIsLocating(true);
    try {
      let { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        appAlert.show('warning', 'Location Permission Denied', 'Please allow location access in your device settings to use this feature.');
        setIsLocating(false);
        return;
      }

      let location = await ExpoLocation.getCurrentPositionAsync({});
      const reverseGeocode = await ExpoLocation.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      if (reverseGeocode.length > 0) {
        const addr = reverseGeocode[0];
        const formattedAddr = `${addr.name || ''} ${addr.street || ''}, ${addr.city || ''}, ${addr.region || ''} ${addr.postalCode || ''} `.trim().replace(/^,/, '').trim();
        setFormData(prev => ({ ...prev, address: formattedAddr }));
        setSelectedCoords({ lat: location.coords.latitude, lng: location.coords.longitude });
      }
    } catch (error) {
      console.error(error);
      appAlert.show('error', 'Location Error', 'Could not fetch your current location. Please try again.');
    } finally {
      setIsLocating(false);
    }
  };

  const renderHighlightedText = (text: string, matches: any[]) => {
    if (!matches || matches.length === 0) return <ThemedText style={styles.suggestionMainText}>{text}</ThemedText>;

    const parts = [];
    let lastOffset = 0;

    matches.forEach((match, index) => {
      // Add plain text before match
      if (match.offset > lastOffset) {
        parts.push(text.substring(lastOffset, match.offset));
      }
      // Add matched (bold) text
      parts.push(
        <ThemedText key={`match-${index}`} style={[styles.suggestionMainText, { fontFamily: Fonts.poppinsBold, color: themeColors.brand }]}>
          {text.substring(match.offset, match.offset + match.length)}
        </ThemedText>
      );
      lastOffset = match.offset + match.length;
    });

    // Add remaining plain text
    if (lastOffset < text.length) {
      parts.push(text.substring(lastOffset));
    }

    return <ThemedText style={styles.suggestionMainText}>{parts}</ThemedText>;
  };

  const handleSuggestionPress = async (item: GooglePlaceSuggestion) => {
    try {
      setIsSearching(true);
      setShowSuggestions(false);
      const details = await GooglePlacesService.getPlaceDetails(item.place_id);

      setFormData({ ...formData, address: details.formatted_address });
      setSelectedCoords({ lat: details.latitude, lng: details.longitude });
      setAddressHeight(56); // Reset height for new address
    } catch (error) {
      console.error('Details error:', error);
      appAlert.show('error', 'Location Error', 'Could not fetch location details. Please check your internet connection.');
    } finally {
      setIsSearching(false);
    }
  };

  const onSelectCountry = (country: Country) => {
    setCountryCode(country.cca2);
    setCallingCode(country.callingCode[0]);
    setIsCountryPickerVisible(false);
    // Clear phone number if it exceeds new country's limit
    setFormData(prev => ({ ...prev, mobileNumber: '' }));
  };

  const getPhoneNumberLength = (cca2: CountryCode) => {
    const lengths: Record<string, number> = {
      'IN': 10,
      'US': 10,
      'GB': 10,
      'AE': 9,
      'KW': 8,
      'QA': 8,
      'SA': 9,
    };
    return lengths[cca2] || 10; // Default to 10
  };

  const pickImage = async (type: 'profile' | 'document', docSlot?: number, useCamera = false) => {
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: type === 'profile' ? [1, 1] : [3, 2], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: type === 'profile' ? [1, 1] : [3, 2], quality: 0.8 });

    if (!result.canceled && result.assets[0]) {
      if (type === 'profile') {
        setProfileImage(result.assets[0].uri);
      } else if (docSlot !== undefined) {
        const updated = [...idDocumentImages] as (string | null)[];
        updated[docSlot] = result.assets[0].uri;
        setIdDocumentImages(updated);
      }
    }
  };

  const handleSendOtp = async () => {
    const requiredLength = getPhoneNumberLength(countryCode);
    if (formData.mobileNumber.length === requiredLength) {
      try {
        await SkoFyApi.auth.sendOTP(formData.mobileNumber);
        setIsOtpSent(true);
      } catch (error) {
        appAlert.show('error', 'OTP Not Sent', 'Could not send OTP to this number. Please check the number and try again.');
      }
    }
  };

  const handleVerifyOtp = async () => {
    if (formData.otp.length >= 4) {
      try {
        const user = await SkoFyApi.auth.verifyOTP(formData.mobileNumber, formData.otp);
        // is_new_role (not is_new_user) is what actually gates whether
        // there's a Customer profile left to fill in — is_new_user alone
        // can't distinguish "brand-new account" from "this phone already
        // has a Provider account and just got a Customer profile added"
        // (dual-role support, same identity/phone). Only a phone that
        // already has a Customer profile is genuinely "already registered."
        if (!user.is_new_role) {
          appAlert.show(
            'error',
            'Already Registered',
            'This mobile number already has an account. Please log in instead.',
            [{ text: 'Go to Login', onPress: () => router.replace('/login') }],
          );
          return;
        }
        setIsAddingRole(!user.is_new_user);
        setIsOtpVerified(true);
        setIsOtpSent(false);
      } catch (error: any) {
        appAlert.show('error', 'Verification Failed', error?.message || 'The OTP you entered is incorrect. Please check and try again.');
      }
    }
  };

  const getInputStyle = (name: string) => [
    styles.input,
    {
      backgroundColor: themeColors.inputBackground,
      color: themeColors.text,
      borderColor: focusedInput === name ? themeColors.brand : (themeColors as any).inputBorder,
      borderWidth: 1,
    },
  ];

  return (
    <ThemedView style={styles.container}>
      <AnimatedBackground />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={styles.topProgressBarContainer}>
          <Animated.View style={[styles.topProgressBar, progressBarStyle, { backgroundColor: themeColors.brand }]} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <ChevronLeft size={24} color={themeColors.text} />
            </TouchableOpacity>

            <AnimatedBrandMark size={44} nameSize={26} />

            <ThemedText style={styles.title}>Create Your Account</ThemedText>
            <ThemedText style={styles.subtitle}>Get trusted help from verified professionals near you</ThemedText>
          </View>

          {/* Section: Personal Details */}
          <Animated.View entering={FadeInLeft.delay(200).springify()} style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionLabel}>Personal Details</ThemedText>

              <TouchableOpacity
                style={styles.photoContainer}
                onPress={() => pickImage('profile')}
              >
                <View style={[styles.photoCircle, profileImage ? { borderWidth: 2, borderColor: themeColors.brand } : {}]}>
                  {profileImage ? (
                    <Image source={{ uri: profileImage }} style={styles.profilePreview} />
                  ) : (
                    <Camera size={24} color={themeColors.icon} />
                  )}
                  <View style={[styles.plusBadge, { backgroundColor: themeColors.brand }]}>
                    <Plus size={12} color="#000" strokeWidth={3} />
                  </View>
                </View>
                <ThemedText style={styles.photoLabel}>{profileImage ? 'Change Photo' : 'Add Profile Photo'}</ThemedText>
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.fieldLabel}>Full Name<ThemedText style={styles.requiredMark}> *</ThemedText></ThemedText>
              <TextInput
                style={getInputStyle('fullName')}
                placeholder="Full Name"
                placeholderTextColor={themeColors.icon}
                value={formData.fullName}
                onChangeText={(text) => setFormData({ ...formData, fullName: text })}
                onFocus={() => setFocusedInput('fullName')}
                onBlur={() => setFocusedInput(null)}
              />
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.fieldLabel}>Email Address</ThemedText>
              <View style={[...getInputStyle('email'), { flexDirection: 'row', alignItems: 'center' }]}>
                <Mail size={18} color={themeColors.icon} style={{ marginRight: 8 }} />
                <TextInput
                  style={{ flex: 1, color: themeColors.text, fontFamily: Fonts.poppins, fontSize: 15 }}
                  placeholder="you@example.com"
                  placeholderTextColor={themeColors.icon}
                  value={formData.email}
                  onChangeText={(text) => setFormData({ ...formData, email: text })}
                  onFocus={() => setFocusedInput('email')}
                  onBlur={() => setFocusedInput(null)}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              {!!formData.email && !formData.email.includes('@') && (
                <ThemedText style={{ fontSize: 12, color: '#EF4444', marginTop: 4, fontFamily: Fonts.poppins }}>
                  Please enter a valid email address.
                </ThemedText>
              )}
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.fieldLabel}>Mobile Number<ThemedText style={styles.requiredMark}> *</ThemedText></ThemedText>
              <View style={styles.phoneInputContainer}>
                <TouchableOpacity
                  style={[styles.countryPickerButton, {
                    backgroundColor: themeColors.inputBackground,
                    borderColor: isCountryPickerVisible ? themeColors.brand : (themeColors as any).inputBorder,
                    borderWidth: 1,
                  }]}
                  onPress={() => !isOtpVerified && setIsCountryPickerVisible(true)}
                  disabled={isOtpVerified}
                >
                  <CountryPicker
                    countryCode={countryCode}
                    withFilter={true}
                    withFlag={true}
                    withEmoji={false}
                    withCallingCode={false}
                    withAlphaFilter={true}
                    onSelect={onSelectCountry}
                    visible={isCountryPickerVisible}
                    onClose={() => setIsCountryPickerVisible(false)}
                    containerButtonStyle={{ padding: 0, margin: 0 }}
                    theme={{
                      backgroundColor: themeColors.background,
                      onBackgroundTextColor: themeColors.text,
                      fontSize: 16,
                      fontFamily: Fonts.poppins,
                    }}
                  />
                  <ThemedText style={styles.callingCodeText}>+{callingCode}</ThemedText>
                  <ChevronDown size={14} color={themeColors.icon} />
                </TouchableOpacity>
                <TextInput
                  style={[getInputStyle('mobileNumber'), { flex: 1 }]}
                  placeholder="Mobile Number"
                  placeholderTextColor={themeColors.icon}
                  keyboardType="numeric"
                  numberOfLines={1}
                  value={formData.mobileNumber}
                  onChangeText={(text) => {
                    // Only allow numbers
                    const cleaned = text.replace(/[^0-9]/g, '');
                    setFormData({ ...formData, mobileNumber: cleaned });
                  }}
                  onFocus={() => setFocusedInput('mobileNumber')}
                  onBlur={() => setFocusedInput(null)}
                  editable={!isOtpVerified}
                  maxLength={getPhoneNumberLength(countryCode)}
                />
              </View>

              {!isOtpVerified && !isOtpSent && (
                <TouchableOpacity
                  style={[styles.verifyButtonAction, { marginTop: 12 }]}
                  onPress={handleSendOtp}
                >
                  <ThemedText style={styles.verifyButtonText}>Verify with OTP</ThemedText>
                </TouchableOpacity>
              )}

              {isOtpVerified && (
                <View style={[styles.verifiedBadge, { marginTop: 12 }]}>
                  <CheckCircle2 size={16} color="#4CAF50" />
                  <ThemedText style={styles.verifiedText}>Mobile Number Verified</ThemedText>
                  <TouchableOpacity onPress={() => setIsOtpVerified(false)} style={{ marginLeft: 'auto' }}>
                    <ThemedText style={{ color: themeColors.brand, fontSize: 12, fontFamily: Fonts.poppinsBold }}>Edit</ThemedText>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {isOtpSent && (
              <Animated.View entering={FadeIn} style={styles.otpSection}>
                <View style={styles.otpHeader}>
                  <ThemedText style={styles.fieldLabel}>Enter OTP</ThemedText>
                  <TouchableOpacity onPress={() => setIsOtpSent(false)}>
                    <X size={16} color={themeColors.icon} />
                  </TouchableOpacity>
                </View>
                <View style={styles.otpInputRow}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                    <TextInput
                      style={[getInputStyle('otp'), { flex: 1, paddingRight: 50 }]}
                      placeholder="Enter 4-6 digit OTP"
                      placeholderTextColor={themeColors.icon}
                      keyboardType="numeric"
                      secureTextEntry={!showOtp}
                      value={formData.otp}
                      onChangeText={(text) => setFormData({ ...formData, otp: text })}
                      onFocus={() => setFocusedInput('otp')}
                      onBlur={() => setFocusedInput(null)}
                      maxLength={6}
                    />
                    <TouchableOpacity style={styles.eyeIcon} onPress={() => setShowOtp(!showOtp)}>
                      {showOtp ? (
                        <EyeOff size={20} color={themeColors.icon} />
                      ) : (
                        <Eye size={20} color={themeColors.icon} />
                      )}
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.verifyConfirmButton}
                    onPress={handleVerifyOtp}
                  >
                    <ThemedText style={styles.verifyConfirmText}>Verify</ThemedText>
                  </TouchableOpacity>
                </View>
              </Animated.View>
            )}

            {/* Password Fields — not applicable when adding a role to an
                existing account (dual-role): a password already exists for
                this identity, and this screen's submit step deliberately
                skips setPassword() in that case. */}
            {!isAddingRole && (
            <>
            <View style={[styles.inputGroup, { marginTop: 16 }]}>
              <ThemedText style={styles.fieldLabel}>Create Password<ThemedText style={styles.requiredMark}> *</ThemedText></ThemedText>
              <View style={styles.passwordInputContainer}>
                <TextInput
                  style={[getInputStyle('password'), { flex: 1, paddingRight: 50 }]}
                  placeholder="Password"
                  placeholderTextColor={themeColors.icon}
                  secureTextEntry={!showPassword}
                  value={formData.password}
                  onChangeText={(text) => setFormData({ ...formData, password: text })}
                  onFocus={() => setFocusedInput('password')}
                  onBlur={() => setFocusedInput(null)}
                />
                <TouchableOpacity
                  style={styles.eyeIcon}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff size={20} color={themeColors.icon} />
                  ) : (
                    <Eye size={20} color={themeColors.icon} />
                  )}
                </TouchableOpacity>
              </View>

              {/* Strength Indicator */}
              <View style={styles.strengthContainer}>
                <View style={styles.strengthBarBackground}>
                  <View
                    style={[
                      styles.strengthBarActive,
                      {
                        width: getPasswordStrength(formData.password).width as any,
                        backgroundColor: getPasswordStrength(formData.password).color
                      }
                    ]}
                  />
                </View>
                {formData.password.length > 0 && (
                  <ThemedText style={[styles.strengthText, { color: getPasswordStrength(formData.password).color }]}>
                    {getPasswordStrength(formData.password).label}
                  </ThemedText>
                )}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.fieldLabel}>Confirm Password<ThemedText style={styles.requiredMark}> *</ThemedText></ThemedText>
              <View style={styles.passwordInputContainer}>
                <TextInput
                  style={[getInputStyle('confirmPassword'), { flex: 1, paddingRight: 50 }]}
                  placeholder="Confirm Password"
                  placeholderTextColor={themeColors.icon}
                  secureTextEntry={!showConfirmPassword}
                  value={formData.confirmPassword}
                  onChangeText={(text) => setFormData({ ...formData, confirmPassword: text })}
                  onFocus={() => setFocusedInput('confirmPassword')}
                  onBlur={() => setFocusedInput(null)}
                />
                <TouchableOpacity
                  style={styles.eyeIcon}
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? (
                    <EyeOff size={20} color={themeColors.icon} />
                  ) : (
                    <Eye size={20} color={themeColors.icon} />
                  )}
                </TouchableOpacity>
              </View>
              {formData.confirmPassword.length > 0 && formData.password !== formData.confirmPassword && (
                <ThemedText style={styles.passwordErrorText}>Passwords do not match</ThemedText>
              )}
              {formData.confirmPassword.length > 0 && formData.password === formData.confirmPassword && (
                <View style={styles.passwordMatchRow}>
                  <CheckCircle2 size={14} color="#4CAF50" />
                  <ThemedText style={styles.passwordMatchText}>Passwords match</ThemedText>
                </View>
              )}
            </View>
            </>
            )}
          </Animated.View>

          {/* Section: Contact Information */}
          <Animated.View entering={FadeInLeft.delay(400).springify()} style={styles.section}>
            <ThemedText style={styles.sectionLabel}>Contact Information</ThemedText>

            <View style={[styles.inputGroup, { marginTop: 16 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <ThemedText style={styles.fieldLabel}>Address<ThemedText style={styles.requiredMark}> *</ThemedText></ThemedText>
                <TouchableOpacity
                  style={styles.locationButton}
                  onPress={getCurrentLocation}
                  disabled={isLocating}
                >
                  <LocateFixed size={14} color={themeColors.brand} />
                  <ThemedText style={styles.locationButtonText}>
                    {isLocating ? 'Locating...' : 'Current Location'}
                  </ThemedText>
                </TouchableOpacity>
              </View>

              <View style={styles.locationInputContainer}>
                <View style={styles.inputIconWrapper}>
                  <MapPin size={20} color={themeColors.brand} />
                </View>
                <TextInput
                  style={[getInputStyle('address'), styles.inputWithIcon, { height: Math.max(90, addressHeight) }]}
                  placeholder="Search House No, Street or Area..."
                  placeholderTextColor={themeColors.icon}
                  value={formData.address}
                  onChangeText={(text) => {
                    setFormData({ ...formData, address: text });
                    setSearchError(null);

                    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
                    if (abortControllerRef.current) abortControllerRef.current.abort();

                    if (text.length > 2) {
                      setShowSuggestions(true);
                      setSearchError(null);
                      setSuggestions([]); // Clear old results while searching
                      searchTimeoutRef.current = setTimeout(async () => {
                        try {
                          setIsSearching(true);
                          abortControllerRef.current = new AbortController();
                          const results = await GooglePlacesService.searchAddress(text);
                          setSuggestions(results);
                          if (results.length === 0) {
                            setSearchError('No locations found');
                          }
                        } catch (error: any) {
                          if (error.name !== 'AbortError') {
                            console.error('Search error:', error);
                            setSearchError('Could not fetch locations. Check internet.');
                          }
                        } finally {
                          setIsSearching(false);
                        }
                      }, 300);
                    } else {
                      setShowSuggestions(false);
                      setSuggestions([]);
                    }
                  }}
                  onFocus={() => setFocusedInput('address')}
                  onBlur={() => {
                    setFocusedInput(null);
                    // Delay close to allow tap on suggestion
                    setTimeout(() => setShowSuggestions(false), 200);
                  }}
                  multiline
                  onContentSizeChange={(e) => setAddressHeight(e.nativeEvent.contentSize.height)}
                  textAlignVertical="top"
                />
                {isSearching && (
                  <View style={styles.inputLoader}>
                    <ActivityIndicator size="small" color={themeColors.brand} />
                  </View>
                )}
              </View>

              {showSuggestions && (suggestions.length > 0 || searchError || isSearching) && (
                <View style={[styles.suggestionsDropdown, isSearching && { minHeight: 80, justifyContent: 'center' }]}>
                  {isSearching ? (
                    <View style={styles.searchingContainer}>
                      <ActivityIndicator size="small" color={themeColors.brand} />
                      <ThemedText style={styles.searchingText}>Searching locations...</ThemedText>
                    </View>
                  ) : searchError ? (
                    <View style={styles.errorContainer}>
                      <ThemedText style={styles.errorText}>{searchError}</ThemedText>
                      <TouchableOpacity onPress={() => setShowSuggestions(false)}>
                        <ThemedText style={styles.manualText}>Enter address manually</ThemedText>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <ScrollView
                      style={{ maxHeight: 250 }}
                      keyboardShouldPersistTaps="always"
                      nestedScrollEnabled={true}
                    >
                      {suggestions.map((item) => (
                        <TouchableOpacity
                          key={item.place_id}
                          style={styles.suggestionItem}
                          onPress={() => handleSuggestionPress(item)}
                        >
                          <View style={styles.suggestionIconBox}>
                            <MapPin size={18} color="#4B5563" fill="#E5E7EB" />
                          </View>
                          <View style={{ flex: 1 }}>
                            {renderHighlightedText(item.structured_formatting.main_text, item.structured_formatting.main_text_matched_substrings || [])}
                            <View style={styles.suggestionDetails}>
                              {item.distance && (
                                <ThemedText style={styles.suggestionDistance}>{item.distance}</ThemedText>
                              )}
                              <ThemedText style={styles.suggestionSecondaryText} numberOfLines={1}>
                                {item.structured_formatting.secondary_text}
                              </ThemedText>
                            </View>
                          </View>
                        </TouchableOpacity>
                      ))}
                      <TouchableOpacity style={styles.locateOnMapBtn} onPress={getCurrentLocation}>
                        <LocateFixed size={18} color={themeColors.brand} />
                        <ThemedText style={styles.locateOnMapText}>Locate on Map</ThemedText>
                      </TouchableOpacity>
                    </ScrollView>
                  )}
                </View>
              )}
            </View>

            {formData.address && !showSuggestions && !isSearching && (
              <Animated.View entering={FadeIn} style={styles.addressPreviewCard}>
                <View style={styles.previewHeader}>
                  <ThemedText style={styles.previewTitle}>Selected Address</ThemedText>
                  <MapPin size={14} color="#10B981" />
                </View>
                <ThemedText style={styles.previewAddress}>{formData.address}</ThemedText>
                {selectedCoords && (
                  <View style={styles.coordsRow}>
                    <ThemedText style={styles.coordsText}>Coordinates: {selectedCoords.lat.toFixed(4)}, {selectedCoords.lng.toFixed(4)}</ThemedText>
                    <View style={styles.validBadge}>
                      <CheckCircle2 size={10} color="#059669" />
                      <ThemedText style={styles.validText}>Verified</ThemedText>
                    </View>
                  </View>
                )}
              </Animated.View>
            )}

            <View style={styles.addressTypeContainer}>
              <ThemedText style={[styles.fieldLabel, { marginBottom: 12 }]}>Save As</ThemedText>
              <View style={styles.typeChips}>
                {(['Home', 'Work', 'Other'] as const).map((type) => {
                  const Icon = type === 'Home' ? Home : type === 'Work' ? Briefcase : Layers;
                  return (
                    <TouchableOpacity
                      key={type}
                      onPress={() => setAddressType(type)}
                      style={[
                        styles.typeChip,
                        addressType === type && { backgroundColor: themeColors.brand, borderColor: themeColors.brand }
                      ]}
                    >
                      <Icon size={16} color={addressType === type ? '#000' : themeColors.icon} />
                      <ThemedText style={[
                        styles.typeChipText,
                        addressType === type && { color: '#000', fontFamily: Fonts.poppinsBold }
                      ]}>
                        {type}
                      </ThemedText>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {addressType === 'Other' && (
              <View style={{ marginTop: 16 }}>
                <ThemedText style={styles.fieldLabel}>Custom Label</ThemedText>
                <TextInput
                  style={getInputStyle('customLabel')}
                  placeholder="e.g. GYM, Parent's House"
                  placeholderTextColor={themeColors.icon}
                  value={customLabel}
                  onChangeText={setCustomLabel}
                  onFocus={() => setFocusedInput('customLabel')}
                  onBlur={() => setFocusedInput(null)}
                />
              </View>
            )}
          </Animated.View>

          {/* Section: National Identity Verification */}
          <Animated.View entering={FadeInLeft.delay(600).springify()} style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <ShieldCheck size={20} color={themeColors.brand} />
              <View>
                <ThemedText style={styles.sectionLabelSmall}>National Identity Verification</ThemedText>
                <ThemedText style={styles.sectionSubLabel}>(Recommended for account recovery)</ThemedText>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.fieldLabel}>National ID Number</ThemedText>
              <TextInput
                style={getInputStyle('idNumber')}
                placeholder="Ex: 1234 5678 9012"
                placeholderTextColor={themeColors.icon}
                value={formData.idNumber}
                onChangeText={(text) => setFormData({ ...formData, idNumber: text })}
                onFocus={() => setFocusedInput('idNumber')}
                onBlur={() => setFocusedInput(null)}
              />
            </View>

            <View style={{ marginTop: 8 }}>
              <ThemedText style={styles.fieldLabel}>ID Document Photos</ThemedText>
              <ThemedText style={[styles.sectionSubLabel, { marginBottom: 12 }]}>
                Upload up to 3 photos — front, back, and any additional page
              </ThemedText>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {(['Front', 'Back', 'Extra'] as const).map((label, idx) => {
                  const uri = idDocumentImages[idx];
                  return (
                    <View key={label} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                      {uri ? (
                        <View style={{ width: '100%', aspectRatio: 3 / 2 }}>
                          <Image
                            source={{ uri }}
                            style={{ width: '100%', height: '100%', borderRadius: 10 }}
                            contentFit="cover"
                          />
                          <TouchableOpacity
                            style={{ position: 'absolute', top: 4, right: 4, backgroundColor: '#EF4444', borderRadius: 10, padding: 3 }}
                            onPress={() => {
                              const updated = [...idDocumentImages] as (string | null)[];
                              updated[idx] = null;
                              setIdDocumentImages(updated);
                            }}
                          >
                            <X size={13} color="#fff" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={{ position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: 4 }}
                            onPress={() => pickImage('document', idx, true)}
                          >
                            <Camera size={13} color="#fff" />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={{ width: '100%', aspectRatio: 3 / 2, borderWidth: 1.5, borderColor: themeColors.brand + '60', borderStyle: 'dashed', borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: themeColors.brand + '08' }}
                          onPress={() => pickImage('document', idx, false)}
                          onLongPress={() => pickImage('document', idx, true)}
                        >
                          <Camera size={18} color={themeColors.brand} />
                          <ThemedText style={{ fontSize: 10, fontFamily: Fonts.poppins, color: themeColors.brand }}>Tap / Hold</ThemedText>
                        </TouchableOpacity>
                      )}
                      <ThemedText style={{ fontSize: 11, fontFamily: Fonts.poppinsBold, color: themeColors.text, opacity: 0.6 }}>{label}</ThemedText>
                    </View>
                  );
                })}
              </View>
              <ThemedText style={[styles.sectionSubLabel, { textAlign: 'center', marginTop: 8 }]}>
                Tap for gallery · Long-press for camera
              </ThemedText>
            </View>

            <ThemedText style={styles.statusLabel}>Verification Status: <Text style={{ color: themeColors.brand, fontFamily: Fonts.poppinsBold }}>Pending</Text></ThemedText>
          </Animated.View>

          {/* Section: Consent & Compliance */}
          <Animated.View entering={FadeInLeft.delay(800).springify()} style={styles.section}>
            <ThemedText style={styles.sectionLabel}>Consent & Compliance</ThemedText>

            <View style={{ marginTop: 8 }}>
              <TouchableOpacity
                style={styles.checkboxItem}
                onPress={() => setAgreedToTerms(!agreedToTerms)}
              >
                {agreedToTerms ? (
                  <CheckCircle2 size={22} color={themeColors.brand} />
                ) : (
                  <Circle size={22} color={themeColors.icon} />
                )}
                <ThemedText style={styles.checkboxLabel}>I agree to <Text style={{ color: themeColors.brand }}>Terms & Conditions</Text></ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.checkboxItem}
                onPress={() => setAgreedToPrivacy(!agreedToPrivacy)}
              >
                {agreedToPrivacy ? (
                  <CheckCircle2 size={22} color={themeColors.brand} />
                ) : (
                  <Circle size={22} color={themeColors.icon} />
                )}
                <ThemedText style={styles.checkboxLabel}>I consent to <Text style={{ color: themeColors.brand }}>Privacy Policy</Text></ThemedText>
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* Footer Button */}
          <View>
            <TouchableOpacity
              style={[styles.createButton, { backgroundColor: themeColors.brand, opacity: (calculateProgress() === 1 && !isSubmitting) ? 1 : 0.7 }]}
              onPress={async () => {
                if (isSubmitting) return;
                if (formData.email && !formData.email.includes('@')) {
                  appAlert.show('error', 'Invalid Email', 'Please enter a valid email address or leave it blank.');
                  return;
                }
                setIsSubmitting(true);
                try {
                  // 1. Save name + email + ID number
                  await SkoFyApi.auth.updateProfile({
                    name: formData.fullName,
                    email: formData.email.trim() || undefined,
                    id_number: formData.idNumber || undefined,
                  });

                  // Save ID document images as JSON array (base64 data URLs would need
                  // a second pass with base64:true; for now we store display URIs at
                  // registration and the user can retake from profile if needed).
                  // Both of these are intentionally non-fatal — shouldn't block account
                  // creation — but failures used to be totally invisible, so the user
                  // had no way to know they'd need to redo this from their profile.
                  const failedSteps: string[] = [];
                  const docUris = idDocumentImages.filter(Boolean) as string[];
                  if (docUris.length > 0) {
                    await SkoFyApi.customers.updateProfile({
                      id_document_url: JSON.stringify(docUris),
                    }).catch((err) => {
                      console.error('Failed to save ID document:', err);
                      failedSteps.push('ID document');
                    });
                  }

                  // 2. Save password so user can log in with phone + password later.
                  // Skipped when adding a role to an existing account — a
                  // password already exists for this identity, and
                  // setPassword() would require current_password to change it.
                  if (formData.password && !isAddingRole) {
                    await SkoFyApi.auth.setPassword(formData.password);
                  }

                  // 2. Save address if provided
                  if (formData.address.trim()) {
                    const label = addressType === 'Other'
                      ? (customLabel.trim() || 'Other')
                      : addressType;
                    await SkoFyApi.addresses.add({
                      label,
                      full_address: formData.address.trim(),
                      lat: selectedCoords?.lat ?? undefined,
                      lng: selectedCoords?.lng ?? undefined,
                      is_default: true,
                    }).catch((err) => {
                      console.error('Failed to save address:', err);
                      failedSteps.push('address');
                    });
                  }

                  if (failedSteps.length > 0) {
                    appAlert.show(
                      'warning',
                      'Account Created',
                      `Your account is ready, but your ${failedSteps.join(' and ')} didn't save. Please add it again from your profile.`,
                    );
                  }

                  router.replace('/home');
                } catch (e: any) {
                  const message = e?.error_code === 'EMAIL_ALREADY_EXISTS'
                    ? e.message
                    : 'Something went wrong. Please try again.';
                  appAlert.show('error', 'Account Creation Failed', message);
                  setIsSubmitting(false);
                }
              }}
              disabled={calculateProgress() < 1 || isSubmitting}
            >
              <ThemedText style={styles.createButtonText}>{isSubmitting ? 'Creating Account...' : 'Create Account'}</ThemedText>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 24, marginBottom: 20 }}>
            <ThemedText style={{ opacity: 0.6, fontFamily: Fonts.poppins, color: themeColors.text }}>Already have an account? </ThemedText>
            <TouchableOpacity onPress={() => router.push('/login')}>
              <ThemedText style={{ color: themeColors.brand, fontFamily: Fonts.poppinsBold }}>Login here</ThemedText>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {appAlert.element}
    </ThemedView>
  );
}

function makeStyles(t: typeof Colors.light) { return StyleSheet.create({
  container: {
    flex: 1,
  },
  topProgressBarContainer: {
    height: 4,
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.05)',
    position: 'absolute',
    top: 0,
    zIndex: 100,
  },
  topProgressBar: {
    height: '100%',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 50,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  backButton: {
    position: 'absolute',
    left: 0,
    top: 5,
    padding: 8,
  },
  title: {
    fontSize: 24,
    textAlign: 'center',
    marginBottom: 4,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.5,
    paddingHorizontal: 20,
    fontFamily: Fonts.poppins,
  },
  section: {
    backgroundColor: t.card,
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 18,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  sectionLabelSmall: {
    fontSize: 16,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  sectionSubLabel: {
    fontSize: 11,
    opacity: 0.5,
    fontFamily: Fonts.poppins,
  },
  fieldLabel: {
    fontSize: 14,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginBottom: 8,
  },
  requiredMark: {
    fontSize: 14,
    fontFamily: Fonts.poppinsBold,
    color: '#EF4444',
  },
  photoContainer: {
    alignItems: 'center',
  },
  photoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: t.inputFilled,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.border,
    marginBottom: 8,
    overflow: 'hidden',
  },
  profilePreview: {
    width: '100%',
    height: '100%',
  },
  plusBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: t.card,
  },
  photoLabel: {
    fontSize: 11,
    opacity: 0.6,
    fontFamily: Fonts.poppinsBold,
  },
  inputGroup: {
    marginBottom: 16,
  },
  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  countryPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: 14,
    borderRadius: 16,
    gap: 8,
  },
  // No divider line here on purpose — with only 3 elements (flag, code,
  // chevron) in a compact pill, a hard divider reads as visual clutter;
  // consistent gap spacing groups them just as clearly without it.
  callingCodeText: {
    fontFamily: Fonts.poppinsBold,
    fontSize: 15,
  },
  input: {
    height: 56,
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 15,
    fontFamily: Fonts.poppins,
  },
  verifyButtonAction: {
    backgroundColor: '#FFCE48',
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFCE48',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  verifyButtonText: {
    color: '#000',
    fontFamily: Fonts.poppinsBold,
    fontSize: 14,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0FDF4',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },
  verifiedText: {
    color: '#166534',
    fontSize: 13,
    fontFamily: Fonts.poppinsBold,
  },
  otpSection: {
    marginTop: 20,
    padding: 16,
    backgroundColor: t.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.borderSubtle,
  },
  otpHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  otpInputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  verifyConfirmButton: {
    backgroundColor: t.textPrimary,
    paddingHorizontal: 20,
    borderRadius: 12,
    justifyContent: 'center',
  },
  verifyConfirmText: {
    color: '#FFF',
    fontFamily: Fonts.poppinsBold,
    fontSize: 14,
  },
  locationInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF9E6',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  locationButtonText: {
    fontSize: 11,
    fontFamily: Fonts.poppinsBold,
    color: '#FFB800',
  },
  addressTypeContainer: {
    marginTop: 8,
  },
  typeChips: {
    flexDirection: 'row',
    gap: 12,
  },
  typeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface,
  },
  typeChipText: {
    fontSize: 13,
    color: t.textSecondary,
    fontFamily: Fonts.poppinsSemiBold,
  },
  inputIcon: {
    position: 'absolute',
    left: 16,
    zIndex: 1,
    top: 18,
  },
  dropdownIcon: {
    position: 'absolute',
    right: 16,
    zIndex: 1,
    top: 18,
  },
  inputIconWrapper: {
    position: 'absolute',
    left: 16,
    top: 18,
    zIndex: 2,
  },
  inputWithIcon: {
    flex: 1,
    paddingLeft: 48,
    paddingRight: 16,
    minHeight: 90,
    textAlignVertical: 'top',
    paddingTop: 20,
    paddingBottom: 16,
    borderRadius: 20,
  },
  suggestionsDropdown: {
    backgroundColor: t.card,
    borderRadius: 20,
    marginTop: 10,
    borderWidth: 1,
    borderColor: t.border,
    overflow: 'hidden',
    zIndex: 10,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 15,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: t.borderSubtle,
  },
  suggestionIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.inputFilled,
    justifyContent: 'center',
    alignItems: 'center',
  },
  suggestionMainText: {
    fontSize: 15,
    color: t.textPrimary,
    fontFamily: Fonts.poppinsSemiBold,
  },
  suggestionDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  suggestionDistance: {
    fontSize: 11,
    color: t.textSecondary,
    fontFamily: Fonts.poppins,
    borderRightWidth: 1,
    borderRightColor: t.border,
    paddingRight: 6,
  },
  suggestionSecondaryText: {
    fontSize: 12,
    color: t.textSecondary,
    fontFamily: Fonts.poppins,
    flex: 1,
  },
  locateOnMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: t.borderSubtle,
  },
  locateOnMapText: {
    fontSize: 13,
    color: '#344054',
    fontFamily: Fonts.poppinsBold,
  },
  inputLoader: {
    position: 'absolute',
    right: 12,
    top: 18,
  },
  searchingContainer: {
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchingText: {
    fontSize: 13,
    color: t.textSecondary,
    fontFamily: Fonts.poppins,
  },
  errorContainer: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 14,
    color: t.textSecondary,
    fontFamily: Fonts.poppins,
    textAlign: 'center',
    marginBottom: 8,
  },
  manualText: {
    fontSize: 13,
    color: '#FFCE48',
    fontFamily: Fonts.poppinsBold,
  },
  addressPreviewCard: {
    backgroundColor: t.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: t.borderSubtle,
    borderLeftWidth: 4,
    borderLeftColor: '#10B981',
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  previewTitle: {
    fontSize: 12,
    fontFamily: Fonts.poppinsBold,
    color: t.textSecondary,
    textTransform: 'uppercase',
  },
  previewAddress: {
    fontSize: 14,
    color: '#344054',
    fontFamily: Fonts.poppinsSemiBold,
    lineHeight: 20,
  },
  coordsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: t.borderSubtle,
  },
  coordsText: {
    fontSize: 10,
    color: t.textMuted,
    fontFamily: Fonts.poppins,
  },
  validBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  validText: {
    fontSize: 10,
    color: '#059669',
    fontFamily: Fonts.poppinsBold,
  },
  checkboxItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  checkboxLabel: {
    fontSize: 14,
    color: t.textSecondary,
    fontFamily: Fonts.poppinsSemiBold,
    flex: 1,
  },
  uploadBox: {
    height: 120,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: t.border,
    backgroundColor: t.surface,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  uploadBoxText: {
    fontSize: 12,
    color: t.textSecondary,
    fontFamily: Fonts.poppinsSemiBold,
  },
  documentPreviewContainer: {
    height: 160,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.border,
  },
  documentPreview: {
    width: '100%',
    height: '100%',
  },
  removeDocButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 12,
    fontFamily: Fonts.poppinsSemiBold,
    marginTop: 16,
    color: t.textSecondary,
  },
  createButton: {
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#FFCE48',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  createButtonText: {
    fontFamily: Fonts.poppinsBold,
    fontSize: 18,
    color: '#000',
  },
  passwordInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eyeIcon: {
    position: 'absolute',
    right: 16,
    zIndex: 1,
  },
  strengthContainer: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  strengthBarBackground: {
    flex: 1,
    height: 4,
    backgroundColor: t.inputFilled,
    borderRadius: 2,
    overflow: 'hidden',
  },
  strengthBarActive: {
    height: '100%',
    borderRadius: 2,
  },
  strengthText: {
    fontSize: 11,
    fontFamily: Fonts.poppinsBold,
    minWidth: 60,
  },
  passwordErrorText: {
    color: '#FF4B4B',
    fontSize: 11,
    fontFamily: Fonts.poppins,
    marginTop: 4,
  },
  passwordMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  passwordMatchText: {
    color: '#4CAF50',
    fontSize: 11,
    fontFamily: Fonts.poppins,
  },
}); }
