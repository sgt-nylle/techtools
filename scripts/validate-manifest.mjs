// Store-readiness checks for the Chromium MV3 manifest (Edge Add-ons / Chrome Web Store rules).
//   node scripts/validate-manifest.mjs [path=extension/dist/manifest.json]
import fs from 'node:fs';

const file = process.argv[2] ?? 'extension/dist/manifest.json';
const m = JSON.parse(fs.readFileSync(file, 'utf8'));
const errors = [];

if (m.manifest_version !== 3) errors.push('manifest_version must be 3');
if (!m.name || m.name.length > 45) errors.push(`name must be 1-45 chars (is ${m.name?.length})`);
if (m.short_name && m.short_name.length > 12) errors.push(`short_name must be <= 12 chars (is ${m.short_name.length})`);
if (!m.description || m.description.length > 132) errors.push(`description must be <= 132 chars (is ${m.description?.length})`);
if (!m.version || !/^\d+(\.\d+){0,3}$/.test(m.version)) errors.push(`invalid version "${m.version}"`);
if (m.background?.scripts) errors.push('background.scripts is not allowed in MV3 - use background.service_worker only');
if (!m.background?.service_worker) errors.push('background.service_worker is required');
for (const size of ['16', '48', '128']) if (!m.icons?.[size]) errors.push(`icons.${size} missing`);
if (m.browser_specific_settings) errors.push('browser_specific_settings belongs in the Firefox build only');

if (errors.length) {
  console.error('Manifest validation FAILED:\n - ' + errors.join('\n - '));
  process.exit(1);
}
console.log(`Manifest OK (v${m.version}, description ${m.description.length}/132 chars)`);
