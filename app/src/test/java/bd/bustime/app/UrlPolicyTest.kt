package bd.bustime.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlPolicyTest {
    @Test fun allowsBundledPages() {
        assertEquals(UrlPolicy.Decision.ALLOW, UrlPolicy.decide(UrlPolicy.START_URL))
        assertEquals(UrlPolicy.Decision.ALLOW, UrlPolicy.decide("https://appassets.androidplatform.net/assets/www/admin.html#/login"))
    }

    @Test fun blocksExternalAndTricks() {
        assertEquals(UrlPolicy.Decision.BLOCK, UrlPolicy.decide("https://example.com/"))
        assertEquals(UrlPolicy.Decision.BLOCK, UrlPolicy.decide("http://appassets.androidplatform.net/assets/www/index.html"))
        assertEquals(UrlPolicy.Decision.BLOCK, UrlPolicy.decide("https://appassets.androidplatform.net@evil.com/assets/www/index.html"))
        assertEquals(UrlPolicy.Decision.BLOCK, UrlPolicy.decide("https://appassets.androidplatform.net/assets/www/../secret"))
        assertEquals(UrlPolicy.Decision.BLOCK, UrlPolicy.decide("javascript:alert(1)"))
        assertEquals(UrlPolicy.Decision.BLOCK, UrlPolicy.decide("file:///etc/hosts"))
        assertEquals(UrlPolicy.Decision.BLOCK, UrlPolicy.decide("intent://x#Intent;end"))
    }

    @Test fun dialOnlyValidNumbers() {
        assertEquals(UrlPolicy.Decision.DIAL, UrlPolicy.decide("tel:+8801000000101"))
        assertEquals(UrlPolicy.Decision.DIAL, UrlPolicy.decide("tel:%2B8801000000101"))
        assertEquals(UrlPolicy.Decision.BLOCK, UrlPolicy.decide("tel:*21*123#"))
        assertTrue(UrlPolicy.isDialable("01000000101"))
        assertFalse(UrlPolicy.isDialable("12"))
    }
}
