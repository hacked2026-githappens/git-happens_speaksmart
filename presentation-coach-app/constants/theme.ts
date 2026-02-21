import { Platform } from 'react-native';

const tintColorLight = '#c95f2d';
const tintColorDark = '#ffb280';

export const Colors = {
  light: {
    text: '#2c1f15',
    background: '#f6ede2',
    tint: tintColorLight,
    icon: '#7e6f62',
    tabIconDefault: '#9a8877',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#f3e7d8',
    background: '#17120e',
    tint: tintColorDark,
    icon: '#c7b5a2',
    tabIconDefault: '#9e8b78',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'AvenirNext-Regular',
    serif: 'Palatino-Roman',
    rounded: 'AvenirNext-DemiBold',
    mono: 'Menlo-Regular',
  },
  android: {
    sans: 'sans-serif',
    serif: 'serif',
    rounded: 'sans-serif-medium',
    mono: 'monospace',
  },
  default: {
    sans: 'sans-serif',
    serif: 'serif',
    rounded: 'sans-serif-medium',
    mono: 'monospace',
  },
  web: {
    sans: "'Trebuchet MS', 'Segoe UI', 'Gill Sans', sans-serif",
    serif: "'Palatino Linotype', 'Book Antiqua', Georgia, serif",
    rounded: "'Avenir Next', 'Trebuchet MS', 'Gill Sans', sans-serif",
    mono: "'Courier Prime', 'Fira Code', 'Cascadia Mono', monospace",
  },
});
