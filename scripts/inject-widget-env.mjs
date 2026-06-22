/**
 * Injects FIREBASE_DB_URL from .env into aftercare-text-widget.js for public/ + min builds.
 * Source keeps the @@FIREBASE_DB_URL@@ placeholder; deployed copies get the real URL.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(resolve(root, '.env'));
loadEnvFile(resolve(root, '.env.local'));

const PLACEHOLDER = '@@FIREBASE_DB_URL@@';
const firebaseDbUrl = process.env.FIREBASE_DB_URL || '';

const sourcePath = resolve(root, 'aftercare-text-widget.js');
const publicDir = resolve(root, 'public');
mkdirSync(publicDir, { recursive: true });

const source = readFileSync(sourcePath, 'utf8');
if (!source.includes(PLACEHOLDER)) {
  console.warn('[inject-widget-env] Placeholder not found in aftercare-text-widget.js');
}

const injected = source.split(PLACEHOLDER).join(firebaseDbUrl);
const outPath = resolve(publicDir, 'aftercare-text-widget.js');
writeFileSync(outPath, injected);

if (firebaseDbUrl) {
  console.log('[inject-widget-env] Wrote public/aftercare-text-widget.js with FIREBASE_DB_URL');
} else {
  console.warn('[inject-widget-env] FIREBASE_DB_URL is unset; widget realtime signals disabled');
}
