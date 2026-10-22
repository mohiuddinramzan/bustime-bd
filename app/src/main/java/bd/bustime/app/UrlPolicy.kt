package bd.bustime.app

import java.net.URI

/** Decides what the WebView may do with a URL. Pure Kotlin so it is unit-testable. */
object UrlPolicy {
    const val HOST = "appassets.androidplatform.net"
    const val START_URL = "https://$HOST/assets/www/index.html"
    const val OFFLINE_URL = "https://$HOST/assets/www/offline.html"

    enum class Decision { ALLOW, DIAL, BLOCK }

    private val dialable = Regex("^\\+?[0-9]{6,15}$")

    fun isDialable(number: String): Boolean = dialable.matches(number)

    fun dialNumber(url: String): String =
        url.trim().substring(4).trim().replace("%2B", "+", ignoreCase = true)

    fun decide(url: String): Decision {
        val u = url.trim()
        if (u.startsWith("tel:", ignoreCase = true)) {
            return if (isDialable(dialNumber(u))) Decision.DIAL else Decision.BLOCK
        }
        return try {
            val uri = URI(u)
            val path = uri.rawPath ?: ""
            val ok = uri.scheme.equals("https", ignoreCase = true) &&
                uri.host?.equals(HOST, ignoreCase = true) == true &&
                path.startsWith("/assets/www/") &&
                !path.contains("..")
            if (ok) Decision.ALLOW else Decision.BLOCK
        } catch (e: Exception) {
            Decision.BLOCK
        }
    }
}
