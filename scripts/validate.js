// Project + data validation. Usage: node scripts/validate.js   (no dependencies)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDataset } from '../app/src/main/assets/www/js/validate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const www = path.join(root, 'app/src/main/assets/www');
let failed = 0;
const fail = (m) => { failed++; console.error('FAIL ' + m); };
const ok = (m) => console.log('ok   ' + m);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' || e.name === '.git' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));

// 1. required files
const required = ['settings.gradle', 'build.gradle', 'gradle.properties', 'gradle/wrapper/gradle-wrapper.properties', 'app/build.gradle',
  'app/src/main/AndroidManifest.xml', 'app/src/main/java/bd/bustime/app/MainActivity.kt', 'app/src/main/java/bd/bustime/app/UrlPolicy.kt',
  'app/src/test/java/bd/bustime/app/UrlPolicyTest.kt', '.github/workflows/android.yml', 'README.md', 'FILES.md',
  'docs/FIREBASE_GUIDE.md', 'docs/TROUBLESHOOTING.md', 'docs/DATA.md',
  ...['index.html', 'admin.html', 'offline.html', 'css/app.css', 'js/app.js', 'js/admin.js', 'js/util.js', 'js/i18n.js', 'js/strings.js', 'js/search.js',
    'js/validate.js', 'js/repository.js', 'js/firebase-adapter.js', 'js/firebase-config.js', 'js/auth.js', 'js/native.js', 'js/store.js', 'js/ui.js',
    'data/buses.json', 'data/routes.json', 'data/schedules.json', 'data/counters.json', 'data/app-config.json'].map((f) => 'app/src/main/assets/www/' + f)];
for (const f of required) fs.existsSync(path.join(root, f)) ? 0 : fail('missing file: ' + f);
if (!failed) ok(`${required.length} required files present`);

// 2. JSON files parse + dataset rules
const json = {};
for (const f of walk(www).filter((p) => p.endsWith('.json'))) {
  try { json[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { fail(`invalid JSON ${f}: ${e.message}`); }
}
const dataset = { buses: json.buses?.items, routes: json.routes?.items, schedules: json.schedules?.items, counters: json.counters?.items, config: json['app-config'] };
const { errors, warnings } = validateDataset(dataset);
errors.forEach((e) => fail(`data ${e.file}/${e.id} ${e.field}: ${e.code}`));
warnings.forEach((w) => console.warn(`warn ${w.file}/${w.id} ${w.field}: ${w.code}`));
if (!errors.length) ok(`data valid (${dataset.buses.length} buses, ${dataset.routes.length} routes, ${dataset.schedules.length} schedules, ${dataset.counters.length} counters)`);

// 3. demo data must never look verified
const verified = ['buses', 'routes', 'schedules', 'counters'].flatMap((k) => (dataset[k] || []).filter((r) => r.verification?.status === 'verified'));
const isDemo = (r) => r.verification?.source === 'demo-placeholder';
const demoNums = (dataset.counters || []).filter(isDemo).flatMap((c) => c.phones).concat((dataset.buses || []).filter(isDemo).flatMap((b) => b.supervisors));
if (dataset.config?.isDemoData && verified.length) fail('demo dataset contains records marked verified');
if (demoNums.some((p) => p.demo !== true) && dataset.config?.isDemoData) fail('demo dataset has phone numbers not flagged demo:true');
if (!failed) ok('demo records are all unverified/flagged');

// 4. Android consistency
const gradle = read('app/build.gradle');
const manifest = read('app/src/main/AndroidManifest.xml');
const appId = /applicationId\s+'([^']+)'/.exec(gradle)?.[1];
const ns = /namespace\s+'([^']+)'/.exec(gradle)?.[1];
if (appId !== 'bd.bustime.app' || ns !== 'bd.bustime.app') fail('applicationId/namespace mismatch');
if (!/versionCode\s+\d+/.test(gradle) || !/versionName\s+'/.test(gradle)) fail('versionCode/versionName missing');
if (!fs.existsSync(path.join(root, 'app/src/main/java', ...ns.split('.'), 'MainActivity.kt'))) fail('MainActivity.kt not in namespace dir');
if (!manifest.includes('android:name=".MainActivity"')) fail('manifest activity not declared');
const resDir = path.join(root, 'app/src/main/res');
const names = { string: new Set(), color: new Set(), style: new Set() };
for (const f of walk(path.join(resDir, 'values'))) {
  const x = fs.readFileSync(f, 'utf8');
  for (const m of x.matchAll(/<(string|color|style)\s+name="([^"]+)"/g)) names[m[1]].add(m[2].replace(/\./g, '_'));
}
const fileRes = (type) => new Set(walk(resDir).filter((f) => path.basename(path.dirname(f)).startsWith(type)).map((f) => path.basename(f).replace(/\.[^.]+$/, '')));
const have = { ...names, drawable: fileRes('drawable'), mipmap: fileRes('mipmap'), xml: fileRes('xml') };
const refs = [manifest, ...walk(resDir).filter((f) => f.endsWith('.xml')).map((f) => fs.readFileSync(f, 'utf8'))];
for (const x of refs) for (const m of x.matchAll(/@(string|color|style|drawable|mipmap|xml)\/([\w.]+)/g)) {
  if (!have[m[1]].has(m[2].replace(/\./g, '_'))) fail(`unresolved resource @${m[1]}/${m[2]}`);
}
if (!failed) ok('manifest/resources consistent');

// 5. web assets: every HTML script/css reference exists, no inline scripts/handlers (CSP)
for (const h of ['index.html', 'admin.html', 'offline.html']) {
  const x = fs.readFileSync(path.join(www, h), 'utf8');
  for (const m of x.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css|html))"/g)) if (!fs.existsSync(path.join(www, m[1]))) fail(`${h} references missing ${m[1]}`);
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(x) || /\son\w+=/.test(x)) fail(`${h} has inline script/handler (blocked by CSP)`);
}
for (const f of walk(path.join(www, 'js'))) {
  const x = fs.readFileSync(f, 'utf8');
  for (const m of x.matchAll(/from '(\.\/[^']+)'/g)) if (!fs.existsSync(path.join(path.dirname(f), m[1]))) fail(`${path.basename(f)} imports missing ${m[1]}`);
  if (/\b(localStorage\.|TODO|FIXME)/.test(x) && !f.endsWith('store.js')) fail(`${path.basename(f)}: direct localStorage use or TODO marker`);
}
if (!failed) ok('web assets consistent');

// 6. secrets scan
const secretRe = /(AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY|"private_key"|service_account)/;
for (const f of walk(root).filter((p) => /\.(js|json|kt|xml|md|yml|gradle|html)$/.test(p) && !p.endsWith('validate.js'))) {
  if (secretRe.test(fs.readFileSync(f, 'utf8'))) fail('possible secret in ' + path.relative(root, f));
}
if (!failed) ok('no secrets found');

console.log(failed ? `\n${failed} problem(s)` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
