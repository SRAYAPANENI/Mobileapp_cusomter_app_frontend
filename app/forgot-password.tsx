import AnimatedBackground from '@/components/animated-background';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useAppContext } from '@/context/AppContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { router } from 'expo-router';
import { ArrowLeft, ChevronDown, Eye, EyeOff, ShieldCheck } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import CountryPicker, { Country, CountryCode } from 'react-native-country-picker-modal';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';

// Only US numbers actually validate server-side (_validate_phone in
// app/schemas/auth.py) — the picker still lists other countries for visual
// consistency with login/register, which have the same characteristic.
const PHONE_NUMBER_LENGTH: Record<string, number> = {
  US: 10, IN: 10, GB: 10, AE: 9, KW: 8, QA: 8, SA: 9,
};

// A 422 (request validation failure — bad phone format, malformed OTP,
// etc.) carries the actual per-field reason in details.errors[0].message;
// err.message on that response is just the generic "Request validation
// failed." set by validation_exception_handler in app/main.py. Prefer the
// specific one when it's there.
function getErrorMessage(err: any, fallback: string): string {
  return err?.details?.errors?.[0]?.message || err?.message || fallback;
}

export default function ForgotPasswordScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const { setIsLoading, showFeedback } = useAppContext();

  const [countryCode, setCountryCode] = useState<CountryCode>('US');
  const [callingCode, setCallingCode] = useState('1');
  const [isCountryPickerVisible, setIsCountryPickerVisible] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isCodeSent, setIsCodeSent] = useState(false);

  const [otp, setOtp] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  const onSelectCountry = (country: Country) => {
    setCountryCode(country.cca2);
    setCallingCode(country.callingCode[0]);
    setIsCountryPickerVisible(false);
    setPhoneNumber('');
  };

  const requiredPhoneLength = PHONE_NUMBER_LENGTH[countryCode] ?? 10;

  const handleSendCode = async () => {
    // Length must match whatever the picker/maxLength above actually
    // allows for the selected country (a fixed 10 here would make AE/KW/QA
    // — 9 or 8 digits — impossible to ever pass, since the input can't
    // even reach 10 digits for them). The leading-digit check catches the
    // actual reported bug — sendOTP/resetPassword always force a +1 prefix
    // and the backend only ever validates as a 10-digit US number
    // regardless of country selected, so an obviously-fake test number
    // like 1234567890 or 0000000000 passed this check before and only
    // failed with a confusing 422 from the server.
    if (phoneNumber.length !== requiredPhoneLength || !/^[2-9]/.test(phoneNumber)) {
      showFeedback('error', 'Invalid Number', `Enter a valid ${requiredPhoneLength}-digit phone number.`);
      return;
    }
    try {
      setIsLoading(true);
      const res = await SkoFyApi.auth.sendResetOTP(phoneNumber);
      setIsCodeSent(true);
      if (res.mock_otp) {
        showFeedback('info', 'Dev Mode', `Your reset code is: ${res.mock_otp}`);
      }
    } catch (err: any) {
      showFeedback('error', 'Could Not Send Code', getErrorMessage(err, 'Please check your number and try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (otp.length !== 6) {
      showFeedback('error', 'Invalid Code', 'Enter the 6-digit code sent to your phone.');
      return;
    }
    if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      showFeedback('error', 'Weak Password', 'Password must be at least 8 characters with a letter and a number.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showFeedback('error', 'Passwords Don\'t Match', 'Make sure both passwords are the same.');
      return;
    }
    try {
      setIsLoading(true);
      await SkoFyApi.auth.resetPassword(phoneNumber, otp, newPassword);
      showFeedback('success', 'Password Reset', 'Your password has been reset. Please log in with your new password.');
      router.replace('/login');
    } catch (err: any) {
      showFeedback('error', 'Could Not Reset Password', getErrorMessage(err, 'The code may be wrong or expired. Try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const getInputStyle = (name: string) => [
    styles.input,
    {
      backgroundColor: themeColors.inputBackground,
      color: themeColors.text,
      borderColor: focusedInput === name ? themeColors.brand : (themeColors as any).inputBorder,
      borderWidth: 1,
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
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={24} color={themeColors.text} />
          </TouchableOpacity>

          <View style={styles.header}>
            <View style={[styles.iconContainer, { backgroundColor: themeColors.brand + '20' }]}>
              <ShieldCheck size={40} color={themeColors.brand} />
            </View>
            <ThemedText type="title" style={styles.title}>Forgot Password</ThemedText>
            <ThemedText style={styles.subtitle}>
              {isCodeSent
                ? 'Enter the code sent to your phone and choose a new password'
                : 'Enter your phone number to receive a reset code'}
            </ThemedText>
          </View>

          <Animated.View layout={Layout.springify()} style={styles.form}>
            {!isCodeSent ? (
              <Animated.View entering={FadeInDown.duration(400)}>
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
                        withCountryNameButton={false}
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
                      style={getInputStyle('phone')}
                      placeholder="Enter mobile number"
                      placeholderTextColor={themeColors.icon}
                      keyboardType="numeric"
                      value={phoneNumber}
                      onChangeText={(text) => setPhoneNumber(text.replace(/[^0-9]/g, ''))}
                      onFocus={() => setFocusedInput('phone')}
                      onBlur={() => setFocusedInput(null)}
                      maxLength={requiredPhoneLength}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: themeColors.brand }]}
                  onPress={handleSendCode}
                >
                  <ThemedText style={styles.actionButtonText}>Send Reset Code</ThemedText>
                </TouchableOpacity>
              </Animated.View>
            ) : (
              <Animated.View entering={FadeInDown.duration(400)}>
                <View style={styles.inputWrapper}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <ThemedText style={styles.label}>Verification Code</ThemedText>
                    <TouchableOpacity onPress={() => { setIsCodeSent(false); setOtp(''); }}>
                      <ThemedText style={[styles.linkText, { color: themeColors.brand }]}>Change Number</ThemedText>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.otpInputContainer}>
                    <TextInput
                      style={[getInputStyle('otp'), { paddingRight: 48 }]}
                      placeholder="Enter 6-digit code"
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
                      {showOtp ? <EyeOff size={20} color={themeColors.icon} /> : <Eye size={20} color={themeColors.icon} />}
                    </TouchableOpacity>
                  </View>
                </View>
                <TouchableOpacity style={[styles.resendRow, { backgroundColor: themeColors.background }]} onPress={handleSendCode}>
                  <ThemedText style={styles.resendRowText}>
                    Didn't get a code? <ThemedText style={[styles.resendRowText, styles.resendRowTextBold, { color: themeColors.brand }]}>Resend</ThemedText>
                  </ThemedText>
                </TouchableOpacity>

                <View style={styles.inputWrapper}>
                  <ThemedText style={styles.label}>New Password</ThemedText>
                  <View style={styles.passwordInputContainer}>
                    <TextInput
                      style={[getInputStyle('newPassword'), { paddingRight: 48 }]}
                      placeholder="At least 8 characters, with a number"
                      placeholderTextColor={themeColors.icon}
                      secureTextEntry={!showNewPassword}
                      autoCapitalize="none"
                      value={newPassword}
                      onChangeText={setNewPassword}
                      onFocus={() => setFocusedInput('newPassword')}
                      onBlur={() => setFocusedInput(null)}
                    />
                    <TouchableOpacity style={styles.eyeIcon} onPress={() => setShowNewPassword(!showNewPassword)}>
                      {showNewPassword ? <EyeOff size={20} color={themeColors.icon} /> : <Eye size={20} color={themeColors.icon} />}
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.inputWrapper}>
                  <ThemedText style={styles.label}>Confirm New Password</ThemedText>
                  <View style={styles.passwordInputContainer}>
                    <TextInput
                      style={[getInputStyle('confirmPassword'), { paddingRight: 48 }]}
                      placeholder="Re-enter new password"
                      placeholderTextColor={themeColors.icon}
                      secureTextEntry={!showConfirmPassword}
                      autoCapitalize="none"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      onFocus={() => setFocusedInput('confirmPassword')}
                      onBlur={() => setFocusedInput(null)}
                    />
                    <TouchableOpacity style={styles.eyeIcon} onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                      {showConfirmPassword ? <EyeOff size={20} color={themeColors.icon} /> : <Eye size={20} color={themeColors.icon} />}
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: themeColors.brand }]}
                  onPress={handleResetPassword}
                >
                  <ThemedText style={styles.actionButtonText}>Reset Password</ThemedText>
                </TouchableOpacity>
              </Animated.View>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 28, lineHeight: 35,
    fontFamily: Fonts.poppinsBold,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    opacity: 0.6,
    lineHeight: 24,
    paddingHorizontal: 20,
  },
  form: {
    width: '100%',
  },
  inputWrapper: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14, lineHeight: 18,
    fontFamily: Fonts.poppinsSemiBold,
    marginBottom: 10,
    opacity: 0.8,
  },
  linkText: {
    fontSize: 12, lineHeight: 16,
    fontFamily: Fonts.poppinsSemiBold,
    marginBottom: 8,
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
  callingCodeText: {
    fontFamily: Fonts.poppinsSemiBold,
    fontSize: 16, lineHeight: 20,
  },
  otpInputContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInputContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 60,
    borderRadius: 16,
    paddingHorizontal: 20,
    fontSize: 16, lineHeight: 20,
    fontFamily: Fonts.poppins,
  },
  eyeIcon: {
    position: 'absolute',
    right: 20,
  },
  resendRow: {
    alignSelf: 'flex-end',
    marginTop: -10,
    marginBottom: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  resendRowText: {
    fontSize: 13, lineHeight: 17,
    fontFamily: Fonts.poppins,
    opacity: 0.7,
  },
  resendRowTextBold: {
    fontFamily: Fonts.poppinsBold,
    opacity: 1,
  },
  actionButton: {
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    shadowColor: Colors.light.brand,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  actionButtonText: {
    fontFamily: Fonts.poppinsBold,
    fontSize: 18, lineHeight: 22,
    color: '#000',
  },
}); }
