import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  View,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { ThemedText } from '../themed-text';
import { Fonts } from '@/constants/theme';
import { Star, CheckCircle2 } from 'lucide-react-native';
import Animated, { FadeInDown, SlideInDown } from 'react-native-reanimated';

export interface RatingDimensions {
  skill_rating: number;
  punctuality_rating: number;
  behaviour_rating: number;
  communication_rating: number;
}

interface RatingModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (ratings: RatingDimensions, comment: string) => Promise<void>;
  providerName: string;
}

const DIMENSIONS: { key: keyof RatingDimensions; label: string; hint: string }[] = [
  { key: 'skill_rating', label: 'Skill Quality', hint: 'Was the work done well?' },
  { key: 'punctuality_rating', label: 'Punctuality', hint: 'Did they show up / finish on time?' },
  { key: 'behaviour_rating', label: 'Behaviour', hint: 'Professionalism and courtesy' },
  { key: 'communication_rating', label: 'Communication', hint: 'Responsiveness and clarity' },
];

export function RatingModal({ visible, onClose, onSubmit, providerName }: RatingModalProps) {
  const [ratings, setRatings] = useState<RatingDimensions>({
    skill_rating: 0,
    punctuality_rating: 0,
    behaviour_rating: 0,
    communication_rating: 0,
  });
  const [comment, setComment] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setDimension = (key: keyof RatingDimensions, value: number) => {
    setRatings(prev => ({ ...prev, [key]: value }));
  };

  const allRated = Object.values(ratings).every(v => v > 0);

  const handleSubmit = async () => {
    if (!allRated || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(ratings, comment);
      setIsSubmitted(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to submit rating. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <KeyboardAvoidingView style={styles.overlay} behavior="padding" automaticOffset>
        {!isSubmitted ? (
          <Animated.View entering={SlideInDown.springify()} style={styles.card}>
            <ThemedText style={styles.title}>Rate Your Experience</ThemedText>
            <ThemedText style={styles.subtitle}>
              How was your service with {providerName}?
            </ThemedText>

            {DIMENSIONS.map(dim => (
              <View key={dim.key} style={styles.dimensionRow}>
                <View style={{ marginBottom: 8 }}>
                  <ThemedText style={styles.dimensionLabel}>{dim.label}</ThemedText>
                  <ThemedText style={styles.dimensionHint}>{dim.hint}</ThemedText>
                </View>
                <View style={styles.starsContainer}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <TouchableOpacity
                      key={star}
                      onPress={() => setDimension(dim.key, star)}
                      style={styles.starTouch}
                    >
                      <Star
                        size={26}
                        color={star <= ratings[dim.key] ? '#FFCE48' : '#D1D5DB'}
                        fill={star <= ratings[dim.key] ? '#FFCE48' : 'none'}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}

            <TextInput
              style={styles.input}
              placeholder="Tell us more about the service (optional)"
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={4}
              value={comment}
              onChangeText={setComment}
            />

            {error && (
              <ThemedText style={styles.errorText}>{error}</ThemedText>
            )}

            {!allRated && (
              <ThemedText style={styles.hintText}>Rate all 4 categories to submit</ThemedText>
            )}

            <TouchableOpacity
              style={[styles.submitButton, (!allRated || submitting) && styles.disabledButton]}
              onPress={handleSubmit}
              disabled={!allRated || submitting}
            >
              <ThemedText style={[styles.submitButtonText, (!allRated || submitting) && styles.disabledButtonText]}>
                {submitting ? 'Submitting...' : 'Submit Rating'}
              </ThemedText>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeInDown.springify()} style={styles.successCard}>
            <View style={styles.successIconContainer}>
              <CheckCircle2 size={60} color="#10B981" />
            </View>
            <ThemedText style={styles.successTitle}>Thank You!</ThemedText>
            <ThemedText style={styles.successSubtitle}>
              Your rating helps us improve our services and recognize good work.
            </ThemedText>
            <TouchableOpacity style={styles.submitButton} onPress={onClose}>
              <ThemedText style={styles.submitButtonText}>Done</ThemedText>
            </TouchableOpacity>
          </Animated.View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 32,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontFamily: Fonts.poppinsBold,
    color: '#111827',
    marginTop: 0,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: Fonts.poppins,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  dimensionRow: {
    width: '100%',
    marginBottom: 12,
  },
  dimensionLabel: {
    fontSize: 14,
    fontFamily: Fonts.poppinsSemiBold,
    color: '#111827',
  },
  dimensionHint: {
    fontSize: 11,
    fontFamily: Fonts.poppins,
    color: '#9CA3AF',
    marginTop: 1,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 4,
  },
  starTouch: {
    padding: 2,
  },
  input: {
    width: '100%',
    backgroundColor: '#F3F4F6',
    borderRadius: 16,
    padding: 16,
    minHeight: 80,
    textAlignVertical: 'top',
    fontFamily: Fonts.poppins,
    fontSize: 14,
    color: '#111827',
    marginTop: 8,
    marginBottom: 16,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    fontFamily: Fonts.poppinsSemiBold,
    textAlign: 'center',
    marginBottom: 12,
  },
  submitButton: {
    backgroundColor: '#111827',
    width: '100%',
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  disabledButton: {
    backgroundColor: '#E5E7EB',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: Fonts.poppinsBold,
  },
  disabledButtonText: {
    color: '#9CA3AF',
  },
  hintText: {
    fontSize: 12,
    fontFamily: Fonts.poppins,
    color: '#F59E0B',
    marginBottom: 8,
    textAlign: 'center',
  },
  successCard: {
    backgroundColor: '#fff',
    borderRadius: 32,
    padding: 32,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  successIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F0FDF4',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 22,
    fontFamily: Fonts.poppinsBold,
    color: '#111827',
    marginBottom: 12,
  },
  successSubtitle: {
    fontSize: 14,
    fontFamily: Fonts.poppins,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
});
