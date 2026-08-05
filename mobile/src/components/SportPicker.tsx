import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ExerciseCategoryInfo, getExerciseCategories } from '../api/exercises';
import { sportEmoji } from '../api/profile';
import { colors, spacing } from '../theme';

interface Props {
  value: string | null;
  onChange: (key: string) => void;
  accentColor: string;
  accentOn: string;
}

// Reusable "nicely styled boxes" sport picker — one card per
// exercise_categories row (currently General Fitness / Padel / Tennis), an
// emoji + label each, wrapping into rows. Same visual language as
// SignUpScreen.tsx's existing RoleCard (bordered surface, colored icon
// chip), just DB-driven instead of a fixed 2-item list, and used in every
// place a user picks their own main sport (signup, athlete Settings,
// manager Settings) so the look stays identical across all three.
export default function SportPicker({ value, onChange, accentColor, accentOn }: Props) {
  const [categories, setCategories] = useState<ExerciseCategoryInfo[] | null>(null);

  useEffect(() => {
    let active = true;
    getExerciseCategories()
      .then((list) => { if (active) setCategories(list.filter((c) => c.enabled)); })
      .catch(() => { if (active) setCategories([]); });
    return () => { active = false; };
  }, []);

  if (categories === null) {
    return <ActivityIndicator color={accentColor} style={styles.loading} />;
  }

  return (
    <View style={styles.grid}>
      {categories.map((c) => {
        const selected = c.key === value;
        return (
          <Pressable
            key={c.key}
            onPress={() => onChange(c.key)}
            style={({ pressed }) => [
              styles.card,
              selected
                ? { backgroundColor: accentColor, borderColor: accentColor }
                : { borderColor: colors.border },
              pressed && !selected && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.icon}>{sportEmoji(c.key)}</Text>
            <Text style={[styles.label, { color: selected ? accentOn : colors.text }]}>{c.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 6,
  },
  icon: { fontSize: 26 },
  label: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
});
