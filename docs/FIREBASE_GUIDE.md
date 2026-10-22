# Firebase setup and migration (later phase)

**Firebase is NOT active in v1.** `js/firebase-adapter.js` is an untested skeleton that runs only after `configureFirebase()`
is called. Never put service-account keys, private keys or passwords in the app or repo. The Firebase web config is not a secret,
but access control must come from Security Rules.

## 1. Create the project (browser, from your phone)
1. console.firebase.google.com → Add project. Add a **Web app** (copy its config object; it is public config).
2. Build → **Authentication** → enable Email/Password. Create your admin user.
3. Build → **Firestore Database** → create in production mode.
4. Give the admin user a custom claim `admin: true` using the Firebase Admin SDK from a trusted place (e.g. Cloud Shell):
   `getAuth().setCustomUserClaims(uid, { admin: true })`. Never do this from the app.

## 2. Security Rules (Firestore → Rules)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function isAdmin() { return request.auth != null && request.auth.token.admin == true; }
    match /buses/{id}     { allow read: if resource.data.status == 'published' || isAdmin(); allow write: if isAdmin(); }
    match /routes/{id}    { allow read: if resource.data.status == 'published' || isAdmin(); allow write: if isAdmin(); }
    match /schedules/{id} { allow read: if resource.data.status == 'published' || isAdmin(); allow write: if isAdmin(); }
    match /counters/{id}  { allow read: if resource.data.status == 'published' || isAdmin(); allow write: if isAdmin(); }
    match /config/{id}    { allow read: if true; allow write: if isAdmin(); }
  }
}
```
Users read published data only; every create/update/delete needs the admin claim. Test with the Rules Playground before launch.

## 3. Wire the app
- Bundle the modular Firebase SDK yourself (npm + a bundler in GitHub Actions) into `assets/www/`; the CSP forbids CDN scripts.
- Extend the CSP `connect-src` with the Firebase hosts, add `<uses-permission android:name="android.permission.INTERNET"/>`,
  and let the WebView load only your own pages (UrlPolicy stays as is; Firebase calls are XHR, not navigation).
- At startup call `configureFirebase({ db, auth, sdk })`, then use `FirebaseRepository` in `app.js`/`admin.js` instead of `JsonRepository`.

## 4. Adapter behaviour
- Read: users query `status == 'published'`; admins read all. Status events: `idle|syncing|synced|offline|error` via `onStatus()`.
- Offline: enable Firestore persistence in the SDK; the JSON bundle remains the fallback.
- Conflicts: each record has `rev`; `saveRecord()` writes in a transaction and throws `ConflictError` (with the server copy) if `rev` is stale. Show both versions and let the admin choose.
- Migration: admin export (JSON bundle) → `FirebaseRepository.publish(bundle)` writes in batches of 450 with `rev` set.
  Do this once, signed in as the admin, then verify in the console.

## 5. Before going live
Verify real data, set `verification.status: verified` with dates, turn off `isDemoData`, review the rules, and keep Firebase billing/quotas in view.
