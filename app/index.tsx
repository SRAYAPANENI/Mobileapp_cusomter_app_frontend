import AnimatedBackground from '@/components/animated-background';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { TokenStore } from '@/services/api';
import { handleInitialCallAction, handleInitialNotification } from '@/services/callManager';

export default function SplashScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }).start();

    // The app was cold-started by tapping the incoming-call notification, not
    // just reopened normally — that navigation already happened, so the splash's
    // own redirect below must not run too, or it'll stomp the call screen a few
    // seconds later with whatever it decides (login or home). Two separate
    // bridges to check: Notifee's own (iOS fallback path) and the native
    // CallStyle one (Android's real colored-button notification).
    let handled = false;
    Promise.all([handleInitialNotification(), handleInitialCallAction()]).then(([a, b]) => {
      handled = a || b;
    });

    const timer = setTimeout(() => {
      if (handled) return;
      // A previous bug here always sent the user to /login on every cold start,
      // even with a perfectly valid stored session — meaning killing the app and
      // reopening it (or tapping a notification, before the fix above) always
      // demanded a fresh login. Now it actually checks for one first.
      TokenStore.getAccessToken().then(token => {
        router.replace(token ? '/home' : '/login');
      });
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <AnimatedBackground />
      <Animated.View style={[styles.content, { opacity }]}>
        <Image
          source={require('@/assets/images/logo.png')}
          style={styles.logo}
          contentFit="contain"
        />
        <Text style={styles.tagline}>Work. Earn. Grow.</Text>
      </Animated.View>
    </View>
  );
}

function makeStyles(t: typeof Colors.light) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.card,
      justifyContent: 'center',
      alignItems: 'center',
    },
    content: {
      alignItems: 'center',
    },
    logo: {
      width: 240,
      height: 80,
    },
    tagline: {
      fontSize: 16,
      color: '#8e8e93',
      letterSpacing: 2,
      fontWeight: '500',
      textAlign: 'center',
      marginTop: 8,
    },
  });
}
