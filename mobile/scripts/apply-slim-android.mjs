/**
 * Keeps phone APK slim after `expo prebuild` regenerates android/.
 * Drops emulator ABIs and turns on size-oriented flags.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const propsPath = path.join(root, 'android', 'gradle.properties');

if (!fs.existsSync(propsPath)) {
  console.error('android/gradle.properties missing — run expo prebuild first');
  process.exit(1);
}

let text = fs.readFileSync(propsPath, 'utf8');

const setProp = (key, value) => {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) text = text.replace(re, `${key}=${value}`);
  else text += `\n${key}=${value}\n`;
};

setProp('reactNativeArchitectures', 'armeabi-v7a,arm64-v8a');
setProp('android.enableMinifyInReleaseBuilds', 'true');
setProp('android.enableShrinkResourcesInReleaseBuilds', 'true');
setProp('android.enablePngCrunchInReleaseBuilds', 'true');
setProp('expo.gif.enabled', 'false');
setProp('expo.webp.enabled', 'false');
setProp('expo.webp.animated', 'false');
setProp('expo.useLegacyPackaging', 'true');
setProp('EX_DEV_CLIENT_NETWORK_INSPECTOR', 'false');

fs.writeFileSync(propsPath, text);
console.log('slim-android: phone ABIs + minify/shrink applied');
