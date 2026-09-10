import { DatePickerModal } from '@/components/date-picker-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TimePickerModal } from '@/components/time-picker-modal';
import { Colors, Fonts } from '@/constants/theme';
import { usePostRequirement } from '@/context/PostRequirementContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Clock3,
  Plus,
  Search,
  X,
  Zap
} from 'lucide-react-native';
import { SkoFyApi } from '@/services/api';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeInUp, SlideInUp } from 'react-native-reanimated';

const { width } = Dimensions.get('window');

// Offline fallback when the backend is unreachable — real list always comes from GET /skills/professions
const FALLBACK_PROFESSIONS = [
  'AC Technician', 'Electrician', 'Plumber', 'Carpenter', 'Painter', 'House Cleaning',
];

// Offline fallback when backend is unreachable — real list always comes from GET /skills?profession=X
const SKILL_DATABASE: Record<string, string[]> = {
  'AC Technician': ['Gas Refilling', 'Leak Repair', 'Cooling Fix', 'Filter Cleaning', 'AC Installation', 'Outer Unit Service'],
  'Electrician': ['Wiring', 'Switchboard Repair', 'Short Circuit Fix', 'Lighting Installation', 'Fan Repair', 'Panel Upgrade'],
  'Plumber': ['Pipe Leak Fix', 'Tap Repair', 'Drain Cleaning', 'Toilet Repair', 'Water Heater Install'],
  'Carpenter': ['Furniture Assembly', 'Cabinet Installation', 'Door Installation', 'Wood Repair', 'Trim Work'],
  'Painter': ['Interior Painting', 'Exterior Painting', 'Wallpaper Removal', 'Drywall Repair'],
  'House Cleaning': ['Deep Cleaning', 'Move-in Cleaning', 'Carpet Cleaning', 'Window Cleaning', 'Regular Sweeping'],
};

// --- Custom Date Picker Logic Helpers ---
const getDaysInMonth = (month: number, year: number) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (month: number, year: number) => new Date(year, month, 1).getDay();

export default function VerifyProblemScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const { data, updateData } = usePostRequirement();

  // Modal States
  const [showProfessionModal, setShowProfessionModal] = useState(false);
  const [showSkillsModal, setShowSkillsModal] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Calendar State
  const [viewDate, setViewDate] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');

  // Professions — fetched live from the backend (single source of truth)
  const [allProfessions, setAllProfessions] = useState<string[]>(FALLBACK_PROFESSIONS);

  useEffect(() => {
    let cancelled = false;
    SkoFyApi.skills.professions()
      .then((list) => {
        if (!cancelled && Array.isArray(list) && list.length > 0) setAllProfessions(list);
      })
      .catch((err) => {
        console.error('Failed to fetch professions list:', err);
      });
    return () => { cancelled = true; };
  }, []);

  // Backend skills for current profession
  const [backendSkills, setBackendSkills] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    SkoFyApi.skills.list(data.profession)
      .then((list: any) => {
        if (!cancelled && Array.isArray(list) && list.length > 0) {
          setBackendSkills(list.map((s: any) => ({ id: s.id, name: s.name })));
        } else if (!cancelled) {
          setBackendSkills([]);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch skills list:', err);
        if (!cancelled) setBackendSkills([]);
      });
    return () => { cancelled = true; };
  }, [data.profession]);

  // Merged skill list — backend skills take priority, fallback to local names with empty id
  const displaySkills = useMemo(() =>
    backendSkills.length > 0
      ? backendSkills
      : (SKILL_DATABASE[data.profession] || []).map(name => ({ id: '', name })),
    [backendSkills, data.profession]
  );

  const filteredProfessions = allProfessions.filter(p =>
    p.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleSkill = (skillName: string, skillId?: string) => {
    const currentSkills = [...data.skills];
    const currentSkillIds = [...data.skill_ids];
    const index = currentSkills.indexOf(skillName);
    let newSkillId = data.skill_id;

    if (index > -1) {
      currentSkills.splice(index, 1);
      if (skillId) {
        const idIndex = currentSkillIds.indexOf(skillId);
        if (idIndex > -1) currentSkillIds.splice(idIndex, 1);
      }
      // If deselecting the current primary skill, pick the next remaining one
      if (skillId && data.skill_id === skillId) {
        newSkillId = currentSkillIds[0] ?? null;
      }
    } else {
      currentSkills.push(skillName);
      if (skillId && !currentSkillIds.includes(skillId)) currentSkillIds.push(skillId);
      // First selected skill (with a real UUID) becomes the primary skill_id
      if (skillId && !data.skill_id) newSkillId = skillId;
    }
    updateData({ skills: currentSkills, skill_id: newSkillId, skill_ids: currentSkillIds });
  };

  // --- Custom Date Picker View ---
  const calendarDays = useMemo(() => {
    const month = viewDate.getMonth();
    const year = viewDate.getFullYear();
    const daysInMonth = getDaysInMonth(month, year);
    const firstDay = getFirstDayOfMonth(month, year);
    const days = [];

    // Padding for first week
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }

    // Actual days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }

    return days;
  }, [viewDate]);

  const handleSelectDate = (date: Date) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    let dateStr = "";
    if (selectedDate.getTime() === today.getTime()) {
      dateStr = "Today";
    } else if (selectedDate.getTime() === tomorrow.getTime()) {
      dateStr = "Tomorrow";
    } else {
      dateStr = date.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric'
      });
    }
    updateData({ date: dateStr, dateISO: selectedDate.toISOString() });
    setShowDatePicker(false);
  };

  const isSelectedDate = (date: Date) => {
    if (!data.date) return false;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (data.date === "Today") return checkDate.getTime() === today.getTime();
    if (data.date === "Tomorrow") return checkDate.getTime() === tomorrow.getTime();

    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) === data.date;
  }

  const isDateDisabled = (date: Date) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return date < today;
  }

  // --- Custom Time Picker States ---
  const [selectedHour, setSelectedHour] = useState('09');
  const [selectedMinute, setSelectedMinute] = useState('00');
  const [selectedPeriod, setSelectedPeriod] = useState('AM');

  const hours = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const minutes = Array.from({ length: 60 }, (_, i) => i < 10 ? `0${i}` : `${i}`);
  const periods = ['AM', 'PM'];

  const confirmTimeSelection = () => {
    const startTime = `${selectedHour}:${selectedMinute} ${selectedPeriod}`;

    // Calculate a 2-hour window for the slot display
    let h = parseInt(selectedHour);
    let m = parseInt(selectedMinute);
    let p = selectedPeriod;

    let endH = h + 2;
    let endP = p;

    if (endH > 12) {
      endH = endH - 12;
      endP = p === "AM" ? "PM" : "AM";
    } else if (endH === 12) {
      endP = p === "AM" ? "PM" : "AM";
    }

    const formattedEndH = endH < 10 ? `0${endH}` : `${endH}`;
    const formattedEndM = selectedMinute;
    const endTime = `${formattedEndH}:${formattedEndM} ${endP}`;

    updateData({
      time: `${startTime} - ${endTime}`,
      timeHour: selectedHour,
      timeMinute: selectedMinute,
      timePeriod: selectedPeriod,
    });
    setShowTimePicker(false);
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <ArrowLeft size={24} color={themeColors.text} />
            </TouchableOpacity>

            <Image
              source={require('@/assets/images/logo-mark.png')}
              style={styles.logo}
              contentFit="contain"
            />
          </View>

          {/* Title Section */}
          <Animated.View entering={FadeInUp.delay(100)} style={styles.titleSection}>
            <ThemedText style={styles.title}>We Understood Your Problem</ThemedText>
            <ThemedText style={styles.subtitle}>You can edit anything before posting.</ThemedText>
          </Animated.View>

          {/* Detected Problem */}
          <Animated.View entering={FadeInUp.delay(200)} style={styles.problemBox}>
            <ThemedText style={styles.problemLabel}>Detected Problem</ThemedText>
            <ThemedText style={styles.problemText}>
              AC not cooling properly, water leakage observed.
            </ThemedText>
          </Animated.View>

          {/* Suggested Profession */}
          <Animated.View entering={FadeInUp.delay(300)} style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Suggested Profession</ThemedText>
              <TouchableOpacity onPress={() => setShowProfessionModal(true)}>
                <ThemedText style={styles.editLink}>Change</ThemedText>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              <View style={[styles.chip, { backgroundColor: themeColors.brand, borderColor: themeColors.brand }]}>
                <ThemedText style={[styles.chipText, { color: '#000', fontFamily: Fonts.poppinsBold }]}>
                  {data.profession}
                </ThemedText>
              </View>
            </ScrollView>
          </Animated.View>

          {/* Suggested Skills */}
          <Animated.View entering={FadeInUp.delay(400)} style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Suggested Skills</ThemedText>
              <TouchableOpacity onPress={() => setShowSkillsModal(true)}>
                <ThemedText style={styles.editLink}>Edit List</ThemedText>
              </TouchableOpacity>
            </View>
            <View style={styles.chipsRowWrap}>
              {data.skills.map((skillName) => {
                const match = displaySkills.find(s => s.name === skillName);
                return (
                  <TouchableOpacity
                    key={skillName}
                    onPress={() => toggleSkill(skillName, match?.id)}
                    style={[styles.skillChip, { backgroundColor: themeColors.inputFilled, borderColor: themeColors.brand }]}
                  >
                    <CheckCircle2 size={14} color={themeColors.brand} />
                    <ThemedText style={[styles.skillChipText, { color: themeColors.brand, fontFamily: Fonts.poppinsBold }]}>
                      {skillName}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
              {displaySkills.filter(s => !data.skills.includes(s.name)).slice(0, 3).map((skill) => (
                <TouchableOpacity
                  key={skill.name}
                  onPress={() => toggleSkill(skill.name, skill.id)}
                  style={styles.skillChip}
                >
                  <Plus size={14} color={themeColors.textSecondary} />
                  <ThemedText style={styles.skillChipText}>{skill.name}</ThemedText>
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>

          {/* Job Type */}
          <Animated.View entering={FadeInUp.delay(500)} style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Job Type</ThemedText>
            <View style={styles.jobTypeRow}>
              {[
                { label: 'Urgent', icon: Zap },
                { label: 'Normal', icon: CheckCircle2 },
                { label: 'Book Slot', icon: Clock3 },
              ].map((type) => (
                <TouchableOpacity
                  key={type.label}
                  onPress={() => updateData({ jobType: type.label as any })}
                  style={[
                    styles.jobTypeCard,
                    data.jobType === type.label && { backgroundColor: '#FFFBEB', borderColor: themeColors.brand }
                  ]}
                >
                  <type.icon size={18} color={data.jobType === type.label ? themeColors.brand : themeColors.textSecondary} />
                  <ThemedText style={[styles.jobTypeText, data.jobType === type.label && { color: '#000', fontFamily: Fonts.poppinsBold }]}>
                    {type.label}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>

          {/* Schedule - visible for Book Slot (when the work should happen)
              and Urgent (the deadline providers need to respond/arrive by) */}
          {(data.jobType === 'Book Slot' || data.jobType === 'Urgent') && (
            <Animated.View entering={FadeIn.duration(400)} style={styles.section}>
              <ThemedText style={styles.sectionTitle}>
                {data.jobType === 'Urgent' ? 'Set Your Deadline' : 'Schedule Your Slot'}
              </ThemedText>
              <ThemedText style={styles.scheduleSubtitle}>
                {data.jobType === 'Urgent'
                  ? "By when do you need this done? Providers will see a countdown to this time."
                  : 'Pick the date and time you want the provider to arrive.'}
              </ThemedText>
              <View style={styles.scheduleRow}>
                <TouchableOpacity
                  style={styles.schedulePicker}
                  onPress={() => setShowDatePicker(true)}
                >
                  <CalendarIcon size={18} color={themeColors.brand} />
                  <ThemedText style={styles.scheduleText}>{data.date}</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.schedulePicker}
                  onPress={() => setShowTimePicker(true)}
                >
                  <Clock size={18} color={themeColors.brand} />
                  <ThemedText style={styles.scheduleText}>
                    {data.time === 'Select Time' ? 'Time' : data.time.split(' - ')[0]}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </Animated.View>
          )}

        </ScrollView>

        {/* Footer Button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.summaryButton, { backgroundColor: themeColors.brand }]}
            onPress={() => router.replace('/post-requirement/summary')}
          >
            <ThemedText style={styles.summaryButtonText}>View Job Summary</ThemedText>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Profession Selection Modal */}
      <Modal visible={showProfessionModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <Animated.View entering={SlideInUp} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <ThemedText style={styles.modalTitle}>Select Profession</ThemedText>
              <TouchableOpacity onPress={() => setShowProfessionModal(false)}>
                <X size={24} color={themeColors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchBar}>
              <Search size={20} color={themeColors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search profession..."
                placeholderTextColor={themeColors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>

            <FlatList
              data={filteredProfessions}
              keyExtractor={item => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.listItem}
                  onPress={() => {
                    updateData({ profession: item, skills: [], skill_id: null, skill_ids: [] });
                    setShowProfessionModal(false);
                    setSearchQuery('');
                  }}
                >
                  <ThemedText style={styles.listItemText}>{item}</ThemedText>
                  <ChevronRight size={18} color={themeColors.border} />
                </TouchableOpacity>
              )}
              style={{ maxHeight: 300 }}
            />
          </Animated.View>
        </View>
      </Modal>

      {/* Skills Selection Modal */}
      <Modal visible={showSkillsModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <Animated.View entering={SlideInUp} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <ThemedText style={styles.modalTitle}>Edit Skills</ThemedText>
              <TouchableOpacity onPress={() => setShowSkillsModal(false)}>
                <X size={24} color={themeColors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ThemedText style={styles.modalSubtitle}>Select required skills for {data.profession}</ThemedText>

            <View style={styles.modalChipsContainer}>
              {displaySkills.map(skill => {
                const isSelected = data.skills.includes(skill.name);
                return (
                  <TouchableOpacity
                    key={skill.name}
                    style={[styles.modalSkillChip, isSelected && { backgroundColor: themeColors.brand, borderColor: themeColors.brand }]}
                    onPress={() => toggleSkill(skill.name, skill.id)}
                  >
                    <ThemedText style={[styles.modalSkillChipText, isSelected && { color: '#000', fontFamily: Fonts.poppinsBold }]}>
                      {skill.name}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={[styles.doneButton, { backgroundColor: themeColors.brand }]}
              onPress={() => setShowSkillsModal(false)}
            >
              <ThemedText style={styles.doneButtonText}>Update Skills</ThemedText>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      <DatePickerModal
        visible={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        selectedDateLabel={data.date}
        onSelect={(label, iso) => {
          updateData({ date: label, dateISO: iso });
          setShowDatePicker(false);
        }}
      />

      <TimePickerModal
        visible={showTimePicker}
        onClose={() => setShowTimePicker(false)}
        initialHour={data.timeHour}
        initialMinute={data.timeMinute}
        initialPeriod={data.timePeriod}
        selectedDateISO={data.dateISO ?? null}
        onConfirm={(label, hour, minute, period) => {
          updateData({ time: label, timeHour: hour, timeMinute: minute, timePeriod: period });
          setShowTimePicker(false);
        }}
      />

    </ThemedView>
  );
}

function makeStyles(t: typeof Colors.light) { return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.card,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  backButton: {
    position: 'absolute',
    left: 0,
    padding: 8,
  },
  logo: {
    width: 60,
    height: 60,
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  problemBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#FFCE48',
    borderStyle: 'dashed',
    marginBottom: 24,
  },
  problemLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
    marginBottom: 8,
  },
  problemText: {
    fontSize: 15,
    fontFamily: Fonts.poppins,
    color: t.textPrimary,
    lineHeight: 22,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  scheduleSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    marginTop: 2,
    marginBottom: 8,
  },
  editLink: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.poppinsBold,
    color: '#FFCE48',
  },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    backgroundColor: t.textPrimary,
    borderWidth: 1,
    borderColor: t.textPrimary,
  },
  chipText: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.poppinsBold,
    color: '#fff',
  },
  chipsRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  skillChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.border,
  },
  skillChipText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  jobTypeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  jobTypeCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.card,
  },
  jobTypeText: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  scheduleRow: {
    flexDirection: 'row',
    gap: 12,
  },
  schedulePicker: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.surface,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.inputFilled,
  },
  scheduleText: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textPrimary,
  },
  footer: {
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    backgroundColor: t.card,
  },
  summaryButton: {
    height: 60,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFCE48',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  summaryButtonText: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: t.modalBackground,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  modalSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.poppins,
    color: t.textSecondary,
    marginBottom: 20,
  },
  // Calendar Styles
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  calendarMonthText: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: Fonts.poppinsBold,
    color: t.textPrimary,
  },
  dayNamesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  dayName: {
    width: (width - 80) / 7,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.poppinsBold,
    color: t.textMuted,
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  dayCell: {
    width: (width - 48) / 7,
    height: (width - 48) / 7,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  dayText: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textPrimary,
  },
  // Time Styles
  timePickerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    height: 250,
    gap: 12,
  },
  pickerColumn: {
    flex: 1,
    alignItems: 'center',
  },
  pickerLabel: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Fonts.poppinsBold,
    color: t.textMuted,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  columnScroll: {
    width: '100%',
  },
  columnFixed: {
    width: '100%',
    gap: 8,
  },
  pickerItem: {
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  pickerItemText: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textPrimary,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.inputFilled,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 56,
    marginBottom: 16,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: Fonts.poppins,
    color: t.textPrimary,
  },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: t.inputFilled,
  },
  listItemText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textPrimary,
  },
  modalChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 32,
  },
  modalSkillChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
  },
  modalSkillChipText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.poppinsSemiBold,
    color: t.textSecondary,
  },
  doneButton: {
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  doneButtonText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Fonts.poppinsBold,
    color: '#000',
  }
}); }
