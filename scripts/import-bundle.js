// Turn an admin export (single bundle JSON) back into the bundled data files.
// Usage: node scripts/import-bundle.js path/to/bustime-bd-export-YYYYMMDD.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBundle } from '../app/src/main/assets/www/js/validate.js';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/import-bundle.js <bundle.json>'); process.exit(1); }
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app/src/main/assets/www/data');
const b = JSON.parse(fs.readFileSync(file, 'utf8'));
const { errors } = validateBundle(b);
if (errors.length) { errors.forEach((e) => console.error(`${e.file}/${e.id} ${e.field}: ${e.code}`)); process.exit(1); }
for (const k of ['buses', 'routes', 'schedules', 'counters']) {
  const old = JSON.parse(fs.readFileSync(path.join(dir, `${k}.json`), 'utf8'));
  fs.writeFileSync(path.join(dir, `${k}.json`), JSON.stringify({ ...old, items: b[k] }, null, 2) + '\n');
}
if (b.config) fs.writeFileSync(path.join(dir, 'app-config.json'), JSON.stringify(b.config, null, 2) + '\n');
console.log('Data files updated. Now: node scripts/validate.js, commit and push.');
