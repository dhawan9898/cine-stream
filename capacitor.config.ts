import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cinehype.stream',
  appName: 'CineStream',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: [
      '*'
    ]
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;
