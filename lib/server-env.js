import fs from 'node:fs';
import path from 'node:path';

let loaded = false;

function parseEnvLine(line = '') {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;

  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return key ? { key, value } : null;
}

export function ensureServerEnv(cwd = process.cwd()) {
  if (loaded) return;
  loaded = true;

  for (const file of ['.env.local', '.env']) {
    const envPath = path.join(cwd, file);
    if (!fs.existsSync(envPath)) continue;

    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      if (process.env[parsed.key] == null || process.env[parsed.key] === '') {
        process.env[parsed.key] = parsed.value;
      }
    }
  }
}

export function hasAnyEnv(...names) {
  ensureServerEnv();
  return names.some(name => Boolean(process.env[name]));
}

export function getServerEnv(...names) {
  ensureServerEnv();
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return '';
}
