import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cinehype.stream',
  appName: 'CineStream',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    // The app is always dark: light status / navigation bar icons whatever the phone's theme.
    SystemBars: {
      style: 'DARK',
    },
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;
