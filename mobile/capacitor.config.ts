import type { CapacitorConfig } from '@capacitor/cli';

// Two targets (INKWELL_TARGET):
//   dev      (default) opens the published site https://inkwell.com.br — development only, never for the stores
//   release  opens the app's own copy of the site (node build-release.mjs -> build/release); card images and prices
//            still come from inkwell.com.br. See README.md, "Dev e release".
const release = process.env.INKWELL_TARGET === 'release';

const config: CapacitorConfig = {
  appId: 'br.com.inkwell.app',
  appName: 'Inkwell',
  webDir: release ? 'build/release' : 'www',
  server: release
    ? { androidScheme: 'https', errorPath: undefined }
    : { url: 'https://inkwell.com.br/feed/', errorPath: 'offline.html', allowNavigation: ['inkwell.com.br', '*.supabase.co'] },
  android: { allowMixedContent: false, backgroundColor: '#0b192c' },
  ios: { contentInset: 'never', backgroundColor: '#0b192c', limitsNavigationsToAppBoundDomains: true },
};
export default config;
