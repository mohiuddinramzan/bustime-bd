# Files

```
bustime-bd/
├─ README.md, FILES.md, package.json, .gitignore, .gitattributes
├─ settings.gradle, build.gradle, gradle.properties
├─ gradle/wrapper/gradle-wrapper.properties
├─ .github/workflows/android.yml
├─ docs/ DATA.md  FIREBASE_GUIDE.md  TROUBLESHOOTING.md
├─ scripts/ validate.js  test.js  import-bundle.js
└─ app/
   ├─ build.gradle, proguard-rules.pro
   └─ src/
      ├─ main/
      │  ├─ AndroidManifest.xml
      │  ├─ java/bd/bustime/app/ MainActivity.kt  UrlPolicy.kt
      │  ├─ res/ values/{strings,colors,themes}.xml  xml/network_security_config.xml
      │  │       drawable/ic_launcher_foreground.xml  mipmap-anydpi{,-v26}/ic_launcher.xml
      │  └─ assets/www/
      │     ├─ index.html  admin.html  offline.html  css/app.css
      │     ├─ data/ buses.json routes.json schedules.json counters.json app-config.json
      │     └─ js/ app.js admin.js util.js i18n.js strings.js search.js validate.js
      │            repository.js firebase-adapter.js auth.js native.js store.js ui.js
      └─ test/java/bd/bustime/app/UrlPolicyTest.kt
```

| File | Purpose |
|---|---|
| `.github/workflows/android.yml` | Validate, JS tests, Kotlin tests, build debug APK, upload artifact |
| `settings.gradle`, `build.gradle`, `gradle.properties` | Gradle 8.7 / AGP 8.5.2 / Kotlin 1.9.24, pinned |
| `app/build.gradle` | `bd.bustime.app`, minSdk 24, target/compile 34, version 1 / 1.0.0 |
| `MainActivity.kt` | WebView host, asset loader, URL policy, JS bridge, offline fallback, back handling |
| `UrlPolicy.kt` / `UrlPolicyTest.kt` | Allow-list for URLs (app pages + valid `tel:`) and its tests |
| `index.html` / `app.js` | User app |
| `admin.html` / `admin.js` | Admin: login gate, CRUD, validation, duplicates, import/export |
| `search.js` | Normalisation, aliases, fuzzy match, filters, next departures |
| `validate.js` | JSON-schema-equivalent rules, duplicates, references, delete blockers |
| `repository.js` / `firebase-adapter.js` / `auth.js` | Data + auth contracts; JSON implementation; inactive Firebase adapter |
| `strings.js` / `i18n.js` | Bengali/English strings, time/date/duration formatting |
| `native.js` / `store.js` / `ui.js` | Android bridge wrapper, safe storage, toast/confirm dialog |
| `data/*.json` | Demo data (all unverified) and config with spelling aliases |
| `scripts/*.js` | Project validation, tests, bundle import |
