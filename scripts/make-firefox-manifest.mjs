// Derives the Firefox build from the Chromium MV3 build.
//   node scripts/make-firefox-manifest.mjs [srcDir=extension/dist] [outDir=extension/dist-firefox]
// Chromium uses `background.service_worker` (and warns if `background.scripts` is present);
// Firefox MV3 only supports `background.scripts` and has no side panel API.
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve(process.argv[2] ?? 'extension/dist');
const out = path.resolve(process.argv[3] ?? 'extension/dist-firefox');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

const file = path.join(out, 'manifest.json');
const m = JSON.parse(fs.readFileSync(file, 'utf8'));
m.background = { scripts: [m.background.service_worker] };
delete m.side_panel;
m.permissions = (m.permissions ?? []).filter((p) => p !== 'sidePanel');
if (m.commands) delete m.commands['open-side-panel'];
m.browser_specific_settings = { gecko: { id: 'techtools@subwrite.se', strict_min_version: '121.0' } };
fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
console.log(`Firefox build written to ${out}`);
