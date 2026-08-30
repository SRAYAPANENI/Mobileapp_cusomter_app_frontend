import AnimatedBackground from '@/components/animated-background';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useAppContext } from '@/context/AppContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { registerFcmToken } from '@/services/callManager';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { AlertTriangle, ChevronDown, Eye, EyeOff, LogOut } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import CountryPicker, { Country, CountryCode } from 'react-native-country-picker-modal';
import Animated, { FadeIn, FadeInUp, FadeOut, Layout } from 'react-native-reanimated';

export default function LoginScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const [loginMethod, setLoginMethod] = useState<'otp' | 'password'>('otp');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [countryCode, setCountryCode] = useState<CountryCode>('US');
  const [callingCode, setCallingCode] = useState('1');
  const [isCountryPickerVisible, setIsCountryPickerVisible] = useState(false);
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isExitModalVisible, setIsExitModalVisible] = useState(false);

  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const lastBackPressTime = useRef<number>(0);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 400));
        if (!isMounted) return;
        await Location.requestForegroundPermissionsAsync();
      } catch (err) {
        console.warn('Failed requesting location on login mount:', err);
      }
    })();
    return () => { isMounted = false; };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const backAction = () => {
        // ALWAYS trigger exit prompt on Login screen when focused
        // This prevents going back to the Dashboard after logout
        const currentTime = Date.now();
        if (currentTime - lastBackPressTime.current < 2000) {
          setIsExitModalVisible(true);
        } else {
          lastBackPressTime.current = currentTime;
        }
        return true;
      };

      const backHandler = BackHandler.addEventListener(
        'hardwareBackPress',
        backAction
      );

      return () => backHandler.remove();
    }, [isExitModalVisible])
  );

  const toggleLoginMethod = () => {
    setLoginMethod(prev => (prev === 'otp' ? 'password' : 'otp'));
    setIsOtpSent(false);
  };

  const { setIsLoading, showFeedback } = useAppContext();

  const handleLogin = async () => {
    if (loginMethod === 'otp' && !isOtpSent) {
      await handleSendOtp();
      return;
    }
    if (loginMethod === 'password') {
      if (!phoneNumber || !password) {
        showFeedback('error', 'Missing Fields', 'Please enter your phone number and password.');
        return;
      }
      try {
        setIsLoading(true);
        await SkoFyApi.auth.loginWithPassword(phoneNumber, password);
        registerFcmToken();
        router.replace('/home');
      } catch (err: any) {
        showFeedback('error', 'Login Failed', err?.message || 'Invalid phone number or password.');
      } finally {
        setIsLoading(false);
      }
      return;
    }
    try {
      setIsLoading(true);
      await SkoFyApi.auth.verifyOTP(phoneNumber, otp);
      registerFcmToken();
      router.replace('/home');
    } catch (err: any) {
      showFeedback('error', 'Login Failed', err?.message || 'Invalid OTP. Please try again.');
    } finally {
      setIsLoading(false);
    }
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
    return lengths[cca2] || 10;
  };

  const handleSendOtp = async () => {
    const requiredLength = getPhoneNumberLength(countryCode);
    if (phoneNumber.length !== requiredLength) return;
    try {
      setIsLoading(true);
      const res = await SkoFyApi.auth.sendOTP(phoneNumber);
      setIsOtpSent(true);
      if (res.mock_otp) {
        showFeedback('info', 'Dev Mode', `Your OTP is: ${res.mock_otp}`);
      }
    } catch (err: any) {
      showFeedback('error', 'Failed to Send OTP', err?.message || 'Please check your number and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const validateEmail = (text: string) => {
    setEmail(text);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (text && !emailRegex.test(text)) {
      setEmailError('Please enter a valid email address');
    } else {
      setEmailError('');
    }
  };

  const onSelectCountry = (country: Country) => {
    setCountryCode(country.cca2);
    setCallingCode(country.callingCode[0]);
    setIsCountryPickerVisible(false);
    setPhoneNumber('');
  };

  const getInputStyle = (name: string) => [
    styles.input,
    {
      backgroundColor: themeColors.inputBackground,
      color: themeColors.text,
      borderColor: focusedInput === name ? themeColors.brand : (themeColors as any).inputBorder,
      borderWidth: 1,
      // Premium shadow effect
      shadowColor: focusedInput === name ? themeColors.brand : themeColors.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: focusedInput === name ? 0.2 : 0.05,
      shadowRadius: 8,
      elevation: focusedInput === name ? 4 : 2,
    },
  ];

  return (
    <ThemedView style={styles.container}>
      <AnimatedBackground />
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Image
              source={require('@/assets/images/logo.png')}
              style={styles.logo}
              contentFit="contain"
            />
            <ThemedText type="title" style={styles.title}>Welcome Back</ThemedText>
            <ThemedText style={styles.subtitle}>Login to start posting needs</ThemedText>
          </View>

          <Animated.View layout={Layout.springify()} style={styles.form}>
            {loginMethod === 'otp' ? (
              <Animated.View key="otp-form" entering={FadeIn.duration(400)} exiting={FadeOut.duration(300)}>
                <View style={styles.inputWrapper}>
                  <ThemedText style={styles.label}>Mobile Number</ThemedText>
                  <View style={styles.phoneInputContainer}>
                    <TouchableOpacity
                      style={[styles.countryPickerButton, {
                        backgroundColor: themeColors.inputBackground,
                        borderColor: isCountryPickerVisible ? themeColors.brand : (themeColors as any).inputBorder,
                        borderWidth: 1,
                        shadowColor: themeColors.shadow,
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.05,
                        shadowRadius: 4,
                        elevation: 2,
                      }]}
                      onPress={() => setIsCountryPickerVisible(true)}
                    >
                      <CountryPicker
                        countryCode={countryCode}
                        withFilter={true}
                        withFlag={true}
                        withEmoji={false}
                        withCallingCode={false}
                        withCountryNameButton={false}
                        withAlphaFilter={true}
                        onSelect={onSelectCountry}
                        visible={isCountryPickerVisible}
                        onClose={() => setIsCountryPickerVisible(false)}
                        containerButtonStyle={{
                          padding: 0,
                          margin: 0,
                        }}
                        theme={{
                          backgroundColor: themeColors.background,
                          onBackgroundTextColor: themeColors.text,
                          fontSize: 16,
                          fontFamily: Fonts.poppins,
                          itemHeight: 50,
                        }}
                      />
                      <ThemedText style={styles.callingCodeText}>+{callingCode}</ThemedText>
                      <ChevronDown size={14} color={themeColors.icon} />
                    </TouchableOpacity>
                    <TextInput
                      style={getInputStyle('phone')}
                      placeholder="Enter mobile number"
                      placeholderTextColor={themeColors.icon}
                      keyboardType="numeric"
                      numberOfLines={1}
                      value={phoneNumber}
                      onChangeText={(text) => {
                        const cleaned = text.replace(/[^0-9]/g, '');
                        setPhoneNumber(cleaned);
                      }}
                      onFocus={() => setFocusedInput('phone')}
                      onBlur={() => setFocusedInput(null)}
                      maxLength={getPhoneNumberLength(countryCode)}
                      editable={!isOtpSent}
                    />
                  </View>
                </View>

                {isOtpSent && (
                  <Animated.View entering={FadeIn.duration(400)} style={[styles.inputWrapper, { marginTop: 8 }]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <ThemedText style={styles.label}>One Time Password</ThemedText>
                      <TouchableOpacity onPress={() => setIsOtpSent(false)}>
                        <ThemedText style={[styles.linkText, { color: themeColors.brand, fontSize: 12, marginBottom: 8 }]}>Change Number</ThemedText>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.otpInputContainer}>
                      <TextInput
                        style={[getInputStyle('otp'), { paddingRight: 48 }]}
                        placeholder="Enter 4-6 digit OTP"
                        placeholderTextColor={themeColors.icon}
                        keyboardType="numeric"
                        secureTextEntry={!showOtp}
                        value={otp}
                        onChangeText={setOtp}
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
                    <TouchableOpacity style={[styles.resendRow, { backgroundColor: themeColors.background }]} onPress={handleSendOtp}>
                      <ThemedText style={styles.resendRowText}>
                        Didn't get a code? <ThemedText style={[styles.resendRowText, styles.resendRowTextBold, { color: themeColors.brand }]}>Resend</ThemedText>
                      </ThemedText>
                    </TouchableOpacity>
                  </Animated.View>
                )}
              </Animated.View>
            ) : (
              <Animated.View key="password-form" entering={FadeIn.duration(400)} exiting={FadeOut.duration(300)}>
                <View style={styles.inputWrapper}>
                  <ThemedText style={styles.label}>Mobile Number</ThemedText>
                  <View style={styles.phoneInputContainer}>
                    <TouchableOpacity
                      style={[styles.countryPickerButton, {
                        backgroundColor: themeColors.inputBackground,
                        borderColor: isCountryPickerVisible ? themeColors.brand : (themeColors as any).inputBorder,
                        borderWidth: 1,
                      }]}
                      onPress={() => setIsCountryPickerVisible(true)}
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
                      style={[getInputStyle('phone-pw'), { flex: 1 }]}
                      placeholder="Enter mobile number"
                      placeholderTextColor={themeColors.icon}
                      keyboardType="numeric"
                      numberOfLines={1}
                      value={phoneNumber}
                      onChangeText={(text) => setPhoneNumber(text.replace(/[^0-9]/g, ''))}
                      onFocus={() => setFocusedInput('phone-pw')}
                      onBlur={() => setFocusedInput(null)}
                      maxLength={getPhoneNumberLength(countryCode)}
                    />
                  </View>
                </View>

                <View style={[styles.inputWrapper, { marginTop: 8 }]}>
                  <ThemedText style={styles.label}>Password</ThemedText>
                  <View style={styles.passwordInputContainer}>
                    <TextInput
                      style={getInputStyle('password')}
                      placeholder="Enter your password"
                      placeholderTextColor={themeColors.icon}
                      secureTextEntry={!showPassword}
                      value={password}
                      onChangeText={setPassword}
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
                </View>

                <TouchableOpacity
                  style={styles.forgotPassword}
                  onPress={() => router.push('/forgot-password' as any)}
                >
                  <ThemedText style={[styles.linkText, { alignSelf: 'flex-end', marginBottom: 20, color: themeColors.icon }]}>Forgot Password?</ThemedText>
                </TouchableOpacity>
              </Animated.View>
            )}

            <TouchableOpacity
              style={[styles.loginButton, { backgroundColor: themeColors.brand }]}
              onPress={handleLogin}
            >
              <ThemedText style={styles.loginButtonText}>
                {loginMethod === 'otp' && !isOtpSent ? 'Send OTP' : 'Login'}
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity style={styles.switchButton} onPress={toggleLoginMethod}>
              <ThemedText style={styles.switchButtonText}>
                {loginMethod === 'otp' ? 'Try login with another way' : 'Login with OTP instead'}
              </ThemedText>
            </TouchableOpacity>

            <View style={styles.footer}>
              <ThemedText style={styles.footerText}>Don't have an account? </ThemedText>
              <TouchableOpacity onPress={() => {
                requestAnimationFrame(() => {
                  router.push('/register');
                });
              }}>
                <ThemedText style={[styles.linkText, { color: themeColors.brand }]}>Register here</ThemedText>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Exit Confirmation Modal */}
      <Modal visible={isExitModalVisible} transparent animationType="fade">
        <View style={styles.exitModalOverlay}>
          <Animated.View entering={FadeInUp.duration(400)} style={styles.exitModalContent}>
            <View style={styles.exitIconContainer}>
              <AlertTriangle size={36} color="#F59E0B" />
            </View>
            <ThemedText style={styles.exitTitle}>Exit Skofy?</ThemedText>
            <ThemedText style={styles.exitMessage}>Are you sure you want to close the app?</ThemedText>

            <View style={styles.exitActionRow}>
              <TouchableOpacity
                style={[styles.exitButton, styles.exitCancelButton]}
                onPress={() => setIsExitModalVisible(false)}
              >
                <ThemedText style={styles.exitCancelText}>No</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.exitButton, styles.exitConfirmButton]}
                onPress={() => {
                  // Android doesn't always fully destroy the JS process on
                  // exitApp() — it can keep it alive in the background for
                  // a fast relaunch. Without resetting this first, reopening
                  // resumes the same component state with the modal still
                  // "visible", so it pops right back up on next launch.
                  setIsExitModalVisible(false);
                  BackHandler.exitApp();
                }}
              >
                <ThemedText style={styles.exitConfirmText}>Yes</ThemedText>
                <LogOut size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </ThemedView>
  );
}

function makeStyles(t: typeof Colors.light) { return StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    lineHeight: 36,
    textAlign: 'center',
    marginBottom: 8,
    fontFamily: Fonts.poppinsBold,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    opacity: 0.6,
  },
  form: {
    width: '100%',
  },
  inputWrapper: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontFamily: Fonts.poppinsSemiBold,
    marginBottom: 8,
    opacity: 0.8,
  },
  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  countryPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 60,
    paddingHorizontal: 14,
    borderRadius: 16,
    gap: 10,
  },
  countryPickerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  isoCodeText: {
    fontFamily: Fonts.poppinsSemiBold,
    fontSize: 14,
    opacity: 0.8,
    marginLeft: 2,
  },
  // No divider line here on purpose — with only 3 elements (flag, code,
  // chevron) in a compact pill, a hard divider reads as visual clutter;
  // consistent gap spacing groups them just as clearly without it.
  callingCodeText: {
    fontFamily: Fonts.poppinsSemiBold,
    fontSize: 16,
  },
  passwordInputContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  otpInputContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 60,
    borderRadius: 16,
    paddingHorizontal: 20,
    fontSize: 16,
    fontFamily: Fonts.poppins,
  },
  eyeIcon: {
    position: 'absolute',
    right: 20,
  },
  // A lightweight text link, not a filled button — "Resend" is a secondary
  // action that shouldn't visually compete with the primary Login CTA
  // below it the way a solid yellow pill would.
  resendRow: {
    alignSelf: 'flex-end',
    marginTop: 10,
    // The animated background's decorative icons float at fully random
    // screen positions on every mount — this row (like any bare text on
    // this screen) sits on a transparent backdrop, so whichever one
    // happens to land here would otherwise show straight through it.
    // Matching the page's own background color here masks that reliably,
    // regardless of where the decoration ends up.
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  resendRowText: {
    fontSize: 13,
    fontFamily: Fonts.poppins,
    opacity: 0.7,
  },
  resendRowTextBold: {
    fontFamily: Fonts.poppinsBold,
    opacity: 1,
  },
  forgotPassword: {
    alignSelf: 'stretch',
    marginTop: 4,
  },
  loginButton: {
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
    shadowColor: '#FFCE48',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  loginButtonText: {
    fontFamily: Fonts.poppinsBold,
    fontSize: 18,
    color: '#000',
  },
  switchButton: {
    alignItems: 'center',
    marginBottom: 32,
  },
  switchButtonText: {
    fontFamily: Fonts.poppinsSemiBold,
    fontSize: 14,
    opacity: 0.7,
  },
  linkText: {
    fontFamily: Fonts.poppinsSemiBold,
    fontSize: 14,
  },
  errorText: {
    color: '#FF4B4B',
    fontSize: 12,
    marginTop: 4,
    marginLeft: 4,
    fontFamily: Fonts.poppins,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 'auto',
  },
  footerText: {
    fontSize: 14,
    opacity: 0.6,
  },
  exitModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  exitModalContent: {
    backgroundColor: t.modalBackground,
    borderRadius: 32,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 5,
  },
  exitIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FFFBEB',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  exitTitle: {
    fontSize: 22,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginBottom: 8,
  },
  exitMessage: {
    fontSize: 15,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  exitActionRow: {
    flexDirection: 'row',
    gap: 16,
    width: '100%',
  },
  exitButton: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  exitCancelButton: {
    backgroundColor: t.inputFilled,
  },
  exitCancelText: {
    fontSize: 16,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  exitConfirmButton: {
    backgroundColor: t.textPrimary,
  },
  exitConfirmText: {
    fontSize: 16,
    fontFamily: Fonts.poppinsBold,
    color: '#fff',
  },
}); }