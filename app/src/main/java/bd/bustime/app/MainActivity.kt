package bd.bustime.app

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.File

private val FIREBASE_HOSTS = setOf("firestore.googleapis.com", "identitytoolkit.googleapis.com")

/** Hosts the bundled web UI. Only https://appassets.androidplatform.net/assets/www/ is loaded in-app. */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val picker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        fileCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val loader = WebViewAssetLoader.Builder()
            .setDomain(UrlPolicy.HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportZoom(false)
        }
        webView.addJavascriptInterface(NativeBridge(), "BusTimeNative")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                loader.shouldInterceptRequest(request.url)?.let { return it }
                // Only the two Firebase REST hosts may be reached (fetch from our own pages); everything else is blocked.
                if (!request.isForMainFrame && request.url.scheme == "https" && request.url.host in FIREBASE_HOSTS) return null
                // Never let any other sub-resource reach the network.
                return WebResourceResponse(
                    "text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0))
                )
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                when (UrlPolicy.decide(url)) {
                    UrlPolicy.Decision.ALLOW -> return false
                    UrlPolicy.Decision.DIAL -> startDial(UrlPolicy.dialNumber(url))
                    UrlPolicy.Decision.BLOCK -> Toast.makeText(
                        this@MainActivity, R.string.blocked_link, Toast.LENGTH_SHORT
                    ).show()
                }
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame && request.url.toString() != UrlPolicy.OFFLINE_URL) {
                    view.loadUrl(UrlPolicy.OFFLINE_URL)
                }
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                recreate()
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: WebChromeClient.FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                picker.launch("*/*")
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        else webView.loadUrl(UrlPolicy.START_URL)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    /** Opens the dialer (ACTION_DIAL): no CALL_PHONE permission needed; the user presses call. */
    private fun startDial(number: String) {
        try {
            startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number")))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, R.string.no_dialer, Toast.LENGTH_SHORT).show()
        }
    }

    /** Methods exposed to the bundled pages as window.BusTimeNative. All inputs are validated. */
    inner class NativeBridge {
        @JavascriptInterface
        fun copyText(text: String): Boolean {
            if (text.length > 20000) return false
            return try {
                val cm = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("BusTime BD", text))
                true
            } catch (e: Exception) {
                false
            }
        }

        @JavascriptInterface
        fun dial(number: String): Boolean {
            if (!UrlPolicy.isDialable(number)) return false
            runOnUiThread { startDial(number) }
            return true
        }

        /** Saves a JSON export. Returns a human-readable location, or "" on failure. */
        @JavascriptInterface
        fun saveText(fileName: String, text: String): String {
            if (!Regex("^[A-Za-z0-9._-]{1,80}\\.json$").matches(fileName) || text.length > 5_000_000) return ""
            return try {
                if (Build.VERSION.SDK_INT >= 29) {
                    val values = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                        put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
                        put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return ""
                    contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray(Charsets.UTF_8)) }
                        ?: return ""
                    "Downloads/$fileName"
                } else {
                    val dir = getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS) ?: filesDir
                    dir.mkdirs()
                    val f = File(dir, fileName)
                    f.writeText(text)
                    f.absolutePath
                }
            } catch (e: Exception) {
                ""
            }
        }
    }
}
