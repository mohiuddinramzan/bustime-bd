# Release minification is disabled in v1. Keep the JS bridge if you enable it later.
-keepclassmembers class bd.bustime.app.MainActivity$NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
