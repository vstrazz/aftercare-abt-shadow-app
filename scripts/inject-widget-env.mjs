/**
 * Injects .env values into aftercare-text-widget.js for public/ + min builds.
 * Source keeps @@PLACEHOLDER@@ tokens; deployed copies get real values.
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

function normalizeApiBase(raw) {
  const url = typeof raw === 'string' ? raw.trim() : '';
  if (!url) return '';
  return url.endsWith('/') ? url : url + '/';
}

function normalizeFirebaseDbUrl(raw) {
  const url = typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : '';
  if (!url) return '';
  if (/herokuapp\.com/i.test(url)) {
    console.warn(
      '[inject-widget-env] FIREBASE_DB_URL looks like an API URL, not Firebase RTDB; skipping',
    );
    return '';
  }
  return url;
}

const replacements = {
  '@@VITE_API_BASE_URL@@': normalizeApiBase(
    process.env.VITE_API_BASE_URL ||
      'https://aftercare-app-api-18edbb932ed8.herokuapp.com/api',
  ),
  '@@VITE_API_KEY@@': process.env.VITE_API_KEY || '',
  '@@FIREBASE_DB_URL@@': normalizeFirebaseDbUrl(process.env.FIREBASE_DB_URL || ''),
};

const sourcePath = resolve(root, 'aftercare-text-widget.js');
const publicDir = resolve(root, 'public');
mkdirSync(publicDir, { recursive: true });

let injected = readFileSync(sourcePath, 'utf8');
for (const [token, value] of Object.entries(replacements)) {
  if (!injected.includes(token)) {
    console.warn(`[inject-widget-env] Placeholder not found: ${token}`);
  }
  injected = injected.split(token).join(value);
}

const outPath = resolve(publicDir, 'aftercare-text-widget.js');
writeFileSync(outPath, injected);

console.log('[inject-widget-env] Wrote public/aftercare-text-widget.js', {
  apiBase: replacements['@@VITE_API_BASE_URL@@'] || '(default)',
  apiKey: replacements['@@VITE_API_KEY@@'] ? '(set)' : '(empty)',
  firebaseDbUrl: replacements['@@FIREBASE_DB_URL@@'] || '(disabled)',
});
