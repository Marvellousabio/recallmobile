import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';

import { resources } from './locales';

const deviceLang = getLocales()[0]?.languageCode ?? 'en';
const initial = deviceLang in resources ? deviceLang : 'en';

i18n.use(initReactI18next).init({
  resources,
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnObjects: true,
});

export default i18n;
