# Troubleshooting

**Push rejected / "Authentication failed"**: GitHub no longer accepts account passwords. Use a Personal Access Token as the password.

**`git push` says branch `master`/`main` mismatch**: run `git branch -M main` then push again.

**Actions: "gradlew: not found" / wrapper errors**: the workflow generates the wrapper when `gradle-wrapper.jar` is missing. Check the step "Create Gradle wrapper if it is not committed". Do not commit a half-copied wrapper.

**"SDK location not found"**: only on local builds. GitHub runners have the SDK. Never commit `local.properties`.

**"Unsupported class file major version" / Java errors**: the workflow uses JDK 17 (needed for AGP 8.5). Keep `java-version: '17'`.

**"Could not resolve ..." / network timeouts**: re-run the job (Actions → Re-run failed jobs); repositories are Google + Maven Central.

**Kotlin/AGP version mismatch**: versions are pinned together (AGP 8.5.2, Kotlin 1.9.24, Gradle 8.7). Change them as a set.

**`validate.js` or `test.js` fails**: read the first `FAIL` line; it names the file and rule (e.g. data record id and error code). Fix the JSON and re-run `npm run check`.

**No artifact appears**: the build step failed earlier, or the path changed. The APK is `app/build/outputs/apk/debug/app-debug.apk`; failed runs upload `build-reports`.

**APK will not install**: allow "install unknown apps"; uninstall an older build signed with a different key (debug keys differ between machines).

**White/blank screen**: open the app again; if the offline page shows, update the Android System WebView app in Play Store.

**Bengali text shows boxes**: update Android System WebView / system fonts; stock Android 5+ ships Bengali fonts.

**Call button does nothing**: the phone has no dialer app (a toast says so). Copy still works.

**Admin edits missing for other users**: by design. Local edits live on that phone only. Shared publishing needs Firebase (`docs/FIREBASE_GUIDE.md`).
