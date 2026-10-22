# BusTime BD

বাংলাদেশের বাসের সময়সূচি ও রুট ডিরেক্টরি (ঢাকা ↔ শ্রীবরদী, ঢাকা ↔ বকশীগঞ্জ ও সংযোগ রুট)।
A Bengali-first bus timetable app: native Android WebView wrapper + HTML/CSS/vanilla JS + JSON data.

> **All bundled data is DEMO.** Bus names, times, counters and phone numbers are placeholders marked
> "unverified / demo". Replace them with verified data before real use. Nothing here is confirmed real-world data.

## Honest status

| Item | Status |
|---|---|
| JSON validation + 24 JS tests (search, filters, phone, i18n, admin rules) | Run and passing when packaged |
| Kotlin unit test (`UrlPolicyTest`) | Written, **not run** here. GitHub Actions runs it |
| Gradle / APK build | **Not run here** (no Android SDK, no network). First real build is on GitHub Actions |
| Gradle wrapper JAR | Binary, not included. The workflow generates the wrapper (Gradle 8.7) if it is missing |
| UI in a real WebView / on a phone | **Not tested here**. Test the APK and report problems |
| Firebase | **Not active.** Adapter only, no credentials |

## Permissions

None. Pages are bundled assets (no INTERNET). Calls use the dialer (`ACTION_DIAL`, no CALL_PHONE). Clipboard and file picker need no permission.
Add `INTERNET` only when you enable Firebase.

## Architecture

```
WebView (https://appassets.androidplatform.net/assets/www/...)  <- WebViewAssetLoader, no file:// access
  index.html  -> js/app.js     user app (Home, Search, Routes, Favorites, Settings)
  admin.html  -> js/admin.js   separate admin page (login gate, CRUD, import/export)
  js/repository.js  DataRepository contract + JsonRepository (bundled JSON, offline cache, local edits)
  js/firebase-adapter.js  FirebaseRepository / FirebaseAuthAdapter (inactive)
  js/auth.js  AuthProvider contract; LocalDemoAuth (not security, never "publish")
Kotlin: MainActivity (WebView, bridge: copy / dial / save file / file picker), UrlPolicy (URL allow-list)
```
Security notes: CSP blocks inline scripts and remote origins; external URLs are blocked, `tel:` opens the dialer;
the JS bridge exposes only copy/dial/save. The admin "local demo mode" is **not authentication**. It only lets you edit a
copy on your own phone. Secure shared publishing needs Firebase Auth + Security Rules (see `docs/FIREBASE_GUIDE.md`).

## Phone-only setup (Termux)

1. Create an empty repo on GitHub website: **+ → New repository**, name `bustime-bd`, **no** README/.gitignore, Create.
2. In Termux:
```sh
termux-setup-storage
pkg update -y && pkg install -y unzip git nodejs
cd ~ && unzip ~/storage/downloads/bustime-bd.zip && cd bustime-bd
npm run check          # validates files/data and runs tests
git init -b main
git config user.name "Your Name" && git config user.email "you@example.com"
git add . && git commit -m "BusTime BD v1"
git remote add origin https://github.com/YOUR_USER/bustime-bd.git
git push -u origin main
```
When Git asks for a password, paste a **Personal Access Token** (GitHub → Settings → Developer settings →
Personal access tokens → Fine-grained, repo access to `bustime-bd`, Contents: Read and write).

3. Build: GitHub repo → **Actions** → *Android Debug APK* (it starts by itself on push to `main`; or **Run workflow**).
4. When green, open the run → **Artifacts** → `bustime-bd-debug-apk` → download the zip, extract, install `app-debug.apk`
   (allow "install unknown apps" for your browser/file manager).

## Updating data

Edit `app/src/main/assets/www/data/*.json` (see `docs/DATA.md`), or use the in-app admin, export a bundle, then:
```sh
node scripts/import-bundle.js ~/storage/downloads/bustime-bd-export-YYYYMMDD.json
npm run check && git add -A && git commit -m "Update data" && git push
```
Bump `dataVersion` and `dataUpdated` in `app-config.json`. Phone numbers: keep `"demo": true` until verified.

## Run in a browser (optional)
`python3 -m http.server 8000 -d app/src/main/assets/www` then open `http://localhost:8000/`.
(The native call/copy/save bridge falls back to browser behaviour.)

## Troubleshooting / Firebase
`docs/TROUBLESHOOTING.md`, `docs/FIREBASE_GUIDE.md`, `docs/DATA.md`, `FILES.md`.
