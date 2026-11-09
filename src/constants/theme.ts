import { useColorScheme } from 'react-native';

export const Colors = {
  light: {
    bg: '#F7F5F0',
    card: '#FFFFFF',
    text: '#1B1F1C',
    muted: '#5E665F',
    border: '#E3DFD5',
    primary: '#1F6B4A',
    primaryText: '#FFFFFF',
    accent: '#E0892F',
    danger: '#B3261E',
    chip: '#EDE9DF',
  },
  dark: {
    bg: '#111412',
    card: '#1B201D',
    text: '#EEF1EC',
    muted: '#9AA39C',
    border: '#2C332E',
    primary: '#4CB585',
    primaryText: '#0B1A12',
    accent: '#F0A65A',
    danger: '#F2867E',
    chip: '#252B27',
  },
};

export type Palette = typeof Colors.light;

export function useColors(): Palette {
  return Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

export const Space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const Radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;
