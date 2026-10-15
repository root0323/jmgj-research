package io.github.root0323.astrosky;

import java.net.URL;
import java.io.IOException;

/** Only stable releases from the developer's repository can install over AstroSky. */
final class UpdatePolicy {
    static final String API = "https://api.github.com/repos/root0323/jmgj-research/releases/latest";
    static final String RELEASES = "https://github.com/root0323/jmgj-research/releases/download/";
    static final long MAX_BYTES = 350_000_000;
    static int versionCode(String version) throws IOException {
        if (!version.matches("\\d{1,5}\\.\\d{1,2}\\.\\d{1,2}")) throw new IOException("unsupported version");
        String[] parts = version.split("\\.");
        return Integer.parseInt(parts[0]) * 10000 + Integer.parseInt(parts[1]) * 100 + Integer.parseInt(parts[2]);
    }
    static boolean secure(URL url) {
        return "https".equals(url.getProtocol()) && url.getUserInfo() == null && (url.getPort() == -1 || url.getPort() == 443);
    }
    static boolean downloadUrl(URL url, String version) {
        return secure(url) && url.toString().equals(RELEASES + "v" + version + "/AstroSky-" + version + "-Android.apk");
    }
    static boolean redirectUrl(URL url) {
        if (!secure(url)) return false;
        return url.getHost().equals("release-assets.githubusercontent.com") && url.getPath().startsWith("/github-production-release-asset/");
    }
    static void verifyDigest(String digest, long bytes) throws IOException {
        if (!digest.matches("sha256:[a-f0-9]{64}") || bytes < 1024 || bytes > MAX_BYTES) throw new IOException("invalid release asset");
    }
}
