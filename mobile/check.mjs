// Inkwell Mobile: static checks of the Capacitor projects that need no Android SDK or Xcode.
// Run: cd mobile && npm ci && npm run check
// What this does NOT do: compile, install or run the apps (see mobile/README.md, "O que depende de quê").
import fs from 'node:fs';

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error('FAIL', m); } };
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const exists = (p) => fs.existsSync(new URL(p, import.meta.url));

// capacitor.config.ts, as the Capacitor CLI resolves it, for both targets
import { execSync } from 'node:child_process';
const conf = (target) => JSON.parse(execSync('npx cap config --json', { cwd: new URL('.', import.meta.url), env: { ...process.env, INKWELL_TARGET: target }, stdio: ['ignore', 'pipe', 'ignore'] }).toString()).app.extConfig;
const cfg = conf('dev'), rel = conf('release');
ok(cfg.appId === 'br.com.inkwell.app' && rel.appId === cfg.appId, 'appId (both targets)');
ok(cfg.appName === 'Inkwell', 'appName');
ok(/^https:\/\/inkwell\.com\.br\//.test(cfg.server?.url || ''), 'dev: opens the published site over https');
ok(!cfg.server?.cleartext && !rel.server?.cleartext, 'no cleartext traffic');
ok(exists(`./${cfg.webDir}/${cfg.server.errorPath}`), 'dev: offline page exists');
ok(exists(`./${cfg.webDir}/index.html`), 'dev: web folder has index.html');
ok((cfg.server.allowNavigation || []).every((h) => /inkwell\.com\.br$|supabase\.co$/.test(h)), 'dev: only Inkwell and Supabase open inside the app (other links go to the browser)');
ok(!rel.server?.url && rel.webDir === 'build/release', 'release: the app opens its own bundled copy, not the remote site');
if (exists('./build/release/app-build.json')) {   // node build-release.mjs has run
  const meta = JSON.parse(read('./build/release/app-build.json'));
  ok(!exists('./build/release/lorcana-card-images'), 'release: card images are not bundled');
  ok(meta.bytes < 50 * 1048576, `release: bundle under 50 MB (${(meta.bytes / 1048576).toFixed(1)} MB)`);
  const html = fs.readdirSync(new URL('./build/release/', import.meta.url), { recursive: true }).filter((f) => f.endsWith('.html')).map((f) => read(`./build/release/${f}`)).join('\n');
  ok(!html.includes('../lorcana-card-images/'), 'release: card images point to inkwell.com.br');
  ok(exists('./build/release/data/cards.json') && exists('./build/release/data/scan-index.bin') && !exists('./build/release/data/prices.json'), 'release: catalog bundled, prices from the network');
}

// versions: core, cli and the platforms move together
const pkg = JSON.parse(read('./package.json')), v = (k) => (pkg.dependencies[k] || pkg.devDependencies[k] || '').replace(/^\^/, '');
ok(v('@capacitor/core') === v('@capacitor/cli') && v('@capacitor/core') === v('@capacitor/android') && v('@capacitor/core') === v('@capacitor/ios'), 'Capacitor versions match');

// Android
const man = read('./android/app/src/main/AndroidManifest.xml');
ok(man.includes('android.permission.CAMERA'), 'Android: camera permission (Escanear)');
ok(/android.hardware.camera"\s+android:required="false"/.test(man), 'Android: camera not required to install');
ok(man.includes('android:allowBackup="false"') && exists('./android/app/src/main/res/xml/data_extraction_rules.xml'), 'Android: sign-in session kept out of backups');
ok(/android:autoVerify="true"[\s\S]*android:host="inkwell.com.br"/.test(man), 'Android: inkwell.com.br links open the app');
ok(!/usesCleartextTraffic="true"/.test(man), 'Android: no cleartext');
const gradle = read('./android/app/build.gradle');
ok(/applicationId\s+"br\.com\.inkwell\.app"/.test(gradle), 'Android: applicationId');
for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) ok(exists(`./android/app/src/main/res/mipmap-${d}/ic_launcher.png`), `Android icon ${d}`);

// iOS
const plist = read('./ios/App/App/Info.plist');
ok(/NSCameraUsageDescription<\/key>\s*<string>[^<]{20,}/.test(plist), 'iOS: camera usage text');
ok(/WKAppBoundDomains<\/key>\s*<array>\s*<string>inkwell\.com\.br<\/string>/.test(plist), 'iOS: inkwell.com.br is an app-bound domain');
ok(cfg.ios?.limitsNavigationsToAppBoundDomains === true && rel.ios?.limitsNavigationsToAppBoundDomains === true, 'iOS: navigation limited to app-bound domains');
const pbx = read('./ios/App/App.xcodeproj/project.pbxproj');
ok(pbx.includes('PRODUCT_BUNDLE_IDENTIFIER = br.com.inkwell.app;'), 'iOS: bundle id');
ok(exists('./ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'), 'iOS: app icon');
ok(exists('./ios/App/CapApp-SPM/Package.swift'), 'iOS: Swift Package Manager (no CocoaPods needed)');

console.log(`${n - bad}/${n} mobile checks passed`);
if (bad) process.exit(1);
