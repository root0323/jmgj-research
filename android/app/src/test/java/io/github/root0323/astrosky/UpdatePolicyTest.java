package io.github.root0323.astrosky;
import java.net.URL;
import java.io.IOException;
import org.junit.Test;
import static org.junit.Assert.*;
public class UpdatePolicyTest {
    @Test public void versionOrderingAndStableReleases() throws Exception {
        assertEquals(801, UpdatePolicy.versionCode("0.8.1"));
        assertTrue(UpdatePolicy.versionCode("0.10.0") > UpdatePolicy.versionCode("0.9.99"));
        for (String invalid : new String[]{"0.8.1-beta", "../0.8.1", "0.100.0", "2147483648.1.1"}) {
            try { UpdatePolicy.versionCode(invalid); fail(invalid); } catch (IOException expected) { }
        }
    }
    @Test public void onlyExactDeveloperAssetAndSecureGithubRedirect() throws Exception {
        String asset = UpdatePolicy.RELEASES + "v0.8.1/AstroSky-0.8.1-Android.apk";
        assertTrue(UpdatePolicy.downloadUrl(new URL(asset), "0.8.1"));
        for (String invalid : new String[]{asset.replace("https:", "http:"), asset.replace("github.com", "github.com.evil.test"), asset.replace("root0323", "someone"), asset + "?other=1", asset.replace("Android.apk", "Windows.exe")})
            assertFalse(UpdatePolicy.downloadUrl(new URL(invalid), "0.8.1"));
        assertTrue(UpdatePolicy.redirectUrl(new URL("https://release-assets.githubusercontent.com/github-production-release-asset/123/abc?token=short-lived")));
        assertFalse(UpdatePolicy.redirectUrl(new URL("https://release-assets.githubusercontent.com.evil.test/github-production-release-asset/123")));
        assertFalse(UpdatePolicy.redirectUrl(new URL("https://name:secret@release-assets.githubusercontent.com/github-production-release-asset/123")));
        assertFalse(UpdatePolicy.redirectUrl(new URL("https://release-assets.githubusercontent.com/arbitrary")));
    }
    @Test public void requiresDigestAndBoundsDownloadSize() throws Exception {
        String valid = "sha256:" + "a".repeat(64);
        UpdatePolicy.verifyDigest(valid, 76_000_000);
        for (String bad : new String[]{"", "md5:" + "a".repeat(64), "sha256:bad"}) {
            try { UpdatePolicy.verifyDigest(bad, 76_000_000); fail(); } catch (IOException expected) { }
        }
        try { UpdatePolicy.verifyDigest(valid, 350_000_001); fail(); } catch (IOException expected) { }
    }
}
