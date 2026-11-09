import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Chip, Field, Screen, T } from '@/components/ui';
import { Radius, Space, useColors } from '@/constants/theme';
import { saveProfile } from '@/db/repo';
import i18n from '@/i18n';
import { INTEREST_KEYS, LANGUAGES } from '@/i18n/locales';
import { useApp } from '@/state/app';

const LEVELS = ['100', '200', '300', '400', '500', '600'];

export default function Onboarding() {
  const { t } = useTranslation();
  const c = useColors();
  const { refresh } = useApp();
  const [step, setStep] = useState(0);
  const [language, setLanguage] = useState(i18n.language);
  const [name, setName] = useState('');
  const [university, setUniversity] = useState('');
  const [department, setDepartment] = useState('');
  const [level, setLevel] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [analogies, setAnalogies] = useState(true);

  const pickLanguage = (code: string) => {
    setLanguage(code);
    i18n.changeLanguage(code);
  };

  const toggleInterest = (k: string) =>
    setInterests((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]));

  const finish = async () => {
    await saveProfile({
      name: name.trim(),
      university: university.trim() || null,
      department: department.trim() || null,
      level,
      language,
      interests,
      analogies_enabled: analogies,
      onboarded: true,
    });
    await refresh();
  };

  return (
    <Screen>
      <View style={styles.dots}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.dot, { backgroundColor: i <= step ? c.primary : c.border }]} />
        ))}
      </View>

      {step === 0 && (
        <>
          <T v="title">{t('onboard.welcomeTitle')}</T>
          <T v="muted">{t('onboard.welcomeBody')}</T>
          <T v="heading" style={{ marginTop: Space.md }}>{t('lang.title')}</T>
          <T v="small">{t('lang.subtitle')}</T>
          {LANGUAGES.map((l) => {
            const on = l.code === language;
            return (
              <Pressable
                key={l.code}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => pickLanguage(l.code)}
                style={[styles.langRow, { borderColor: on ? c.primary : c.border, backgroundColor: c.card }]}>
                <T v="body" style={{ fontWeight: on ? '700' : '400' }}>{l.native}</T>
                <View style={[styles.radio, { borderColor: on ? c.primary : c.border }]}>
                  {on && <View style={[styles.radioDot, { backgroundColor: c.primary }]} />}
                </View>
              </Pressable>
            );
          })}
          <Button label={t('common.continue')} onPress={() => setStep(1)} />
        </>
      )}

      {step === 1 && (
        <>
          <Field label={t('onboard.nameLabel')} placeholder={t('onboard.namePh')} value={name} onChangeText={setName} autoFocus />
          <Field label={t('onboard.uniLabel')} placeholder={t('onboard.uniPh')} value={university} onChangeText={setUniversity} />
          <Field label={t('onboard.deptLabel')} placeholder={t('onboard.deptPh')} value={department} onChangeText={setDepartment} />
          <T v="small">{t('onboard.levelLabel')}</T>
          <View style={styles.wrap}>
            {LEVELS.map((l) => (
              <Chip key={l} label={l} selected={level === l} onPress={() => setLevel(l)} />
            ))}
          </View>
          <Button label={t('common.continue')} onPress={() => setStep(2)} disabled={!name.trim()} />
          <Button label={t('common.back')} kind="ghost" onPress={() => setStep(0)} />
        </>
      )}

      {step === 2 && (
        <>
          <T v="title">{t('onboard.interestsTitle')}</T>
          <T v="muted">{t('onboard.interestsBody')}</T>
          <View style={styles.wrap}>
            {INTEREST_KEYS.map((k) => (
              <Chip key={k} label={t(`interests.${k}`)} selected={interests.includes(k)} onPress={() => toggleInterest(k)} />
            ))}
          </View>
          <View style={styles.switchRow}>
            <T v="body" style={{ flex: 1 }}>{t('onboard.analogies')}</T>
            <Switch value={analogies} onValueChange={setAnalogies} trackColor={{ true: c.primary }} />
          </View>
          <Button label={t('onboard.finish')} onPress={finish} />
          <Button label={t('common.back')} kind="ghost" onPress={() => setStep(1)} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', gap: 6, marginBottom: Space.sm },
  dot: { height: 4, flex: 1, borderRadius: 2 },
  langRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderRadius: Radius.md, padding: Space.md, minHeight: 56,
  },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.sm },
});
