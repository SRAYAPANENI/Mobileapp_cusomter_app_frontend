import { isValidPassword } from '@/services/password';
import AnimatedBackground from '@/components/animated-background';
import { useAppAlert } from '@/components/app-alert';
import { CodeTimerRow } from '@/components/code-timer-row';
import { useCodeTimer } from '@/hooks/use-code-timer';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useAppContext } from '@/context/AppContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { router } from 'expo-router';
import { ArrowLeft, Eye, EyeOff, ShieldCheck } from 'lucide-react-native';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { TextInput } from '@/components/scaled-text';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { UsPhonePrefix, US_PHONE_INPUT_MAX, formatUsPhone, isUsPhone, usPhoneDigits } from '@/components/us-phone-prefix';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { padBottom, useBottomInset } from '@/hooks/use-bottom-inset';

// A 422 (request validation failure — bad phone format, malformed OTP,
// etc.) carries the actual per-field reason in details.errors[0].message;
// err.message on that response is just the generic "Request validation
// failed." set by validation_exception_handler in app/main.py. Prefer the
// specific one when it's there.
function getErrorMessage(err: any, fallback: string): string {
  return err?.details?.errors?.[0]?.message || err?.message || fallback;
}

export default function ForgotPasswordScreen() {
  const bottomInset = useBottomInset();
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const { setIsLoading, showFeedback } = useAppContext();
  const appAlert = useAppAlert();
  // How long the code lasts, and when "Resend" works again.
  const codeTimer = useCodeTimer();

  // No account for this number in this app (or only in the other one): say
  // so with a choice — a mistyped number just needs correcting.
  const offerRegister = (err: any): boolean => {
    if (err?.error_code !== 'NO_ACCOUNT' && err?.error_code !== 'OTHER_ROLE_ONLY') return false;
    appAlert.show(
      'error',
      err.error_code === 'NO_ACCOUNT' ? 'No Account Found' : 'Not a Customer Account Yet',
      err.message,
      [
        { text: 'Change number', variant: 'secondary', onPress: () => { setIsCodeSent(false); setOtp(''); codeTimer.reset(); } },
        { text: 'Register', variant: 'primary', onPress: () => router.replace({ pathname: '/register', params: { prefillPhone: phoneNumber } }) },
      ],
    );
    return true;
  };

  // US launch: US numbers only — the server accepts only +1 numbers.
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isCodeSent, setIsCodeSent] = useState(false);

  const [otp, setOtp] = useState('');
  const [showOtp, setShowOtp] = useState(true);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [focusedInput, setFocusedInput] = useState<string | null>(null);


  const handleSendCode = async () => {
    // The server only takes a real US number: catch a bad one here, plainly.
    if (!isUsPhone(phoneNumber)) {
      showFeedback('error', 'Invalid Number', 'Enter a valid 10-digit phone number.');
      return;
    }
    try {
      setIsLoading(true);
      const res = await SkoFyApi.auth.sendResetOTP(phoneNumber);
      setIsCodeSent(true);
      codeTimer.start(res.expires_in_seconds);
      if (res.mock_otp) {
        showFeedback('info', 'Dev Mode', `Your reset code is: ${res.mock_otp}`);
      }
    } catch (err: any) {
      if (offerRegister(err)) return;
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
    if (codeTimer.expired) {
      showFeedback('error', 'Code Expired', 'That code has expired. Tap Resend for a new one.');
      return;
    }
    if (!isValidPassword(newPassword)) {
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
      if (offerRegister(err)) return;
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
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={padBottom(styles.scrollContent, bottomInset)} showsVerticalScrollIndicator={false}>
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

          <Animated.View layout={Layout.duration(200)} style={styles.form}>
            {!isCodeSent ? (
              <Animated.View entering={FadeInDown.duration(400)}>
                <View style={styles.inputWrapper}>
                  <ThemedText style={styles.label}>Mobile Number</ThemedText>
                  <View style={styles.phoneInputContainer}>
                    <UsPhonePrefix
                      style={[styles.countryPickerButton, { backgroundColor: themeColors.inputBackground, borderColor: (themeColors as any).inputBorder, borderWidth: 1 }]}
                      textStyle={styles.callingCodeText}
                    />
                    <TextInput
                      style={getInputStyle('phone')}
                      placeholder="Mobile number"
                      placeholderTextColor={themeColors.icon}
                      keyboardType="phone-pad"
                      autoComplete="tel-national"
                      textContentType="telephoneNumber"
                      value={formatUsPhone(phoneNumber)}
                      onChangeText={(text) => setPhoneNumber(usPhoneDigits(text))}
                      onFocus={() => setFocusedInput('phone')}
                      onBlur={() => setFocusedInput(null)}
                      maxLength={US_PHONE_INPUT_MAX}
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
                    <TouchableOpacity onPress={() => { setIsCodeSent(false); setOtp(''); codeTimer.reset(); }}>
                      <ThemedText style={[styles.linkText, { color: themeColors.brand }]}>Change Number</ThemedText>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.otpInputContainer}>
                    <TextInput
                      style={[getInputStyle('otp'), { paddingRight: 48 }]}
                      placeholder="Enter 6-digit code"
                      placeholderTextColor={themeColors.icon}
                      keyboardType="number-pad"
                      autoComplete="sms-otp"
                      textContentType="oneTimeCode"
                      secureTextEntry={!showOtp}
                      value={otp}
                      onChangeText={(text) => setOtp(text.replace(/\D/g, ''))}
                      onFocus={() => setFocusedInput('otp')}
                      onBlur={() => setFocusedInput(null)}
                      maxLength={6}
                    />
                    <TouchableOpacity style={styles.eyeIcon} hitSlop={12} onPress={() => setShowOtp(!showOtp)}>
                      {showOtp ? <EyeOff size={20} color={themeColors.icon} /> : <Eye size={20} color={themeColors.icon} />}
                    </TouchableOpacity>
                  </View>
                </View>
                <CodeTimerRow timer={codeTimer} onResend={handleSendCode} />

                <View style={styles.inputWrapper}>
                  <ThemedText style={styles.label}>New Password</ThemedText>
                  <View style={styles.passwordInputContainer}>
                    <TextInput
                      style={[getInputStyle('newPassword'), { paddingRight: 48 }]}
                      placeholder="New password"
                      placeholderTextColor={themeColors.icon}
                      secureTextEntry={!showNewPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="new-password"
                      textContentType="newPassword"
                      value={newPassword}
                      onChangeText={setNewPassword}
                      onFocus={() => setFocusedInput('newPassword')}
                      onBlur={() => setFocusedInput(null)}
                    />
                    <TouchableOpacity style={styles.eyeIcon} hitSlop={12} onPress={() => setShowNewPassword(!showNewPassword)}>
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
                      autoCorrect={false}
                      autoComplete="new-password"
                      textContentType="newPassword"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      onFocus={() => setFocusedInput('confirmPassword')}
                      onBlur={() => setFocusedInput(null)}
                    />
                    <TouchableOpacity style={styles.eyeIcon} hitSlop={12} onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
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
      {appAlert.element}
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
