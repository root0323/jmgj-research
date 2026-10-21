package io.github.root0323.astrosky;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.*;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

final class AppUpdater {
    private final Activity activity;
    private final File root, apk, metadata;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final int installedCode;
    private final String installedVersion;
    private JSONObject state = new JSONObject();
    private Release release;
    private boolean permissionPending;
    interface Reply { void send(JSONObject value); }
    private static final class Release {
        final String version, url, digest; final int code; final long bytes;
        Release(JSONObject data) throws Exception {
            version = data.getString("version"); code = UpdatePolicy.versionCode(version);
            url = data.getString("url"); digest = data.getString("digest"); bytes = data.getLong("bytes");
            if (!UpdatePolicy.downloadUrl(new URL(url), version)) throw new IOException("invalid release URL");
            UpdatePolicy.verifyDigest(digest, bytes);
        }
        JSONObject json() throws JSONException { return new JSONObject().put("version", version).put("url", url).put("digest", digest).put("bytes", bytes); }
    }
    AppUpdater(Activity activity) throws Exception {
        this.activity = activity;
        PackageInfo current = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
        installedCode = (int) code(current); installedVersion = current.versionName;
        root = new File(activity.getCacheDir(), "app-updates"); root.mkdirs();
        apk = new File(root, "update.apk"); metadata = new File(root, "update.json");
        set("idle", "", 0);
        executor.submit(() -> {
            try {
                if (!metadata.isFile()) return;
                Release saved = new Release(new JSONObject(new String(NativeNetwork.read(new FileInputStream(metadata), 4096), StandardCharsets.UTF_8)));
                if (saved.code <= installedCode) { cleanupApplied(); return; }
                validateApk(apk, saved); release = saved; set("ready", "", 100);
            } catch (Exception ignored) { /* An incomplete download can always be downloaded again. */ }
            finally { new File(root, "update.part").delete(); new File(root, "update.json.part").delete(); }
        });
    }
    private synchronized void set(String status, String message, int progress) {
        try {
            state = new JSONObject().put("status", status).put("version", installedVersion).put("progress", progress).put("message", message);
            if (release != null) state.put("targetVersion", release.version).put("bytes", release.bytes);
        } catch (JSONException ignored) { }
    }
    synchronized JSONObject state() {
        try { return new JSONObject(state.toString()).put("installAllowed", activity.getPackageManager().canRequestPackageInstalls()); }
        catch (JSONException e) { return new JSONObject(); }
    }
    void check(Reply reply) {
        executor.submit(() -> {
            try {
                set("checking", "", 0);
                HttpURLConnection c = connection(new URL(UpdatePolicy.API));
                JSONObject latest;
                try {
                    if (c.getResponseCode() == 403 || c.getResponseCode() == 429) throw new IOException("rate limit");
                    if (c.getResponseCode() != 200) throw new IOException("release unavailable");
                    latest = new JSONObject(new String(NativeNetwork.read(c.getInputStream(), 2 * 1024 * 1024), StandardCharsets.UTF_8));
                } finally { c.disconnect(); }
                if (latest.optBoolean("draft") || latest.optBoolean("prerelease")) throw new IOException("not stable");
                String tag = latest.getString("tag_name");
                if (!tag.startsWith("v")) throw new IOException("invalid tag");
                String version = tag.substring(1);
                int target = UpdatePolicy.versionCode(version);
                if (target <= installedCode) { set("current", "현재 최신 버전입니다.", 0); cleanupApplied(); reply.send(state()); return; }
                String name = "AstroSky-" + version + "-Android.apk";
                JSONArray assets = latest.getJSONArray("assets"); Release found = null;
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject asset = assets.getJSONObject(i);
                    if (!name.equals(asset.optString("name")) || !"uploaded".equals(asset.optString("state"))) continue;
                    found = new Release(new JSONObject().put("version", version).put("url", asset.getString("browser_download_url"))
                        .put("digest", asset.getString("digest")).put("bytes", asset.getLong("size")));
                    break;
                }
                if (found == null) { set("current", "새 Android 업데이트는 아직 없습니다.", 0); reply.send(state()); return; }
                release = found;
                try { validateApk(apk, found); set("ready", "", 100); }
                catch (Exception ignored) { set("available", "", 0); }
            } catch (Exception e) { set("error", "업데이트를 확인하지 못했습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.", 0); }
            reply.send(state());
        });
    }
    void download(Reply reply) {
        executor.submit(() -> {
            File part = new File(root, "update.part"); HttpURLConnection c = null;
            try {
                Release next = release;
                if (next == null || next.code <= installedCode) throw new IOException("no update");
                set("downloading", "", 0);
                URL url = new URL(next.url);
                for (int redirects = 0; ; redirects++) {
                    c = connection(url);
                    int status = c.getResponseCode();
                    if (status == 200) break;
                    if (redirects >= 3 || (status != 301 && status != 302 && status != 303 && status != 307 && status != 308)) throw new IOException("asset unavailable");
                    URL redirected = new URL(url, c.getHeaderField("Location"));
                    if (!UpdatePolicy.redirectUrl(redirected)) throw new IOException("invalid redirect");
                    c.disconnect(); c = null; url = redirected;
                }
                long total = 0, lastNotice = 0;
                try (InputStream input = c.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                    byte[] buffer = new byte[65536]; int n;
                    while ((n = input.read(buffer)) != -1) {
                        if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
                        total += n; if (total > next.bytes) throw new IOException("asset too large"); out.write(buffer, 0, n);
                        long now = System.currentTimeMillis();
                        if (now - lastNotice > 300) { set("downloading", "", (int)(total * 100 / next.bytes)); lastNotice = now; }
                    }
                    out.getFD().sync();
                }
                validateApk(part, next);
                android.system.Os.rename(part.getPath(), apk.getPath());
                File jsonPart = new File(root, "update.json.part");
                try (FileOutputStream out = new FileOutputStream(jsonPart)) { out.write(next.json().toString().getBytes(StandardCharsets.UTF_8)); out.getFD().sync(); }
                android.system.Os.rename(jsonPart.getPath(), metadata.getPath());
                set("ready", "", 100);
            } catch (Exception e) { set("error", "업데이트 다운로드·검증에 실패했습니다. 인터넷 연결과 저장 공간을 확인하고 다시 시도해 주세요.", 0); }
            finally { if (c != null) c.disconnect(); part.delete(); }
            reply.send(state());
        });
    }
    void install(Reply reply) {
        executor.submit(() -> {
            try {
                if (release == null || release.code <= installedCode) throw new IOException("no update");
                validateApk(apk, release);
                activity.runOnUiThread(() -> {
                    try {
                        if (!activity.getPackageManager().canRequestPackageInstalls()) {
                            permissionPending = true; set("permission", "AstroSky의 앱 설치 허용을 켠 뒤 돌아와 주세요.", 100);
                            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
                        } else {
                            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".updates", apk);
                            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            intent.setClipData(android.content.ClipData.newRawUri("AstroSky update", uri));
                            activity.startActivity(intent); set("ready", "Android 설치 화면에서 업데이트를 확인해 주세요.", 100);
                        }
                    } catch (Exception e) { set("error", "설치 화면을 열지 못했습니다. 앱 설치 허용 설정을 확인해 주세요.", 100); }
                    reply.send(state());
                });
            } catch (Exception e) { set("error", "설치 파일 검증에 실패했습니다. 업데이트를 다시 내려받아 주세요.", 0); reply.send(state()); }
        });
    }
    void resumed() {
        if (!permissionPending) return;
        permissionPending = false;
        if (activity.getPackageManager().canRequestPackageInstalls()) install(value -> {});
        else set("ready", "앱 설치 허용이 필요합니다. 설치 버튼으로 다시 시도할 수 있습니다.", 100);
    }
    private static long code(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    private void validateApk(File file, Release target) throws Exception {
        if (!file.isFile() || file.length() != target.bytes || !NativeNetwork.digest(file).equals(target.digest.substring(7))) throw new IOException("digest mismatch");
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageManager pm = activity.getPackageManager();
        PackageInfo info = pm.getPackageArchiveInfo(file.getPath(), flags), installed = pm.getPackageInfo(activity.getPackageName(), flags);
        if (info == null || !activity.getPackageName().equals(info.packageName) || code(info) != target.code || code(info) <= installedCode) throw new IOException("package mismatch");
        Signature[] incoming = Build.VERSION.SDK_INT >= 28 ? info.signingInfo.getApkContentsSigners() : info.signatures;
        Signature[] current = Build.VERSION.SDK_INT >= 28 ? installed.signingInfo.getApkContentsSigners() : installed.signatures;
        if (incoming == null || current == null || incoming.length == 0 || !new HashSet<>(Arrays.asList(incoming)).equals(new HashSet<>(Arrays.asList(current)))) throw new IOException("signer mismatch");
    }
    private static HttpURLConnection connection(URL url) throws Exception {
        if (!UpdatePolicy.secure(url)) throw new IOException("https required");
        HttpURLConnection c = (HttpURLConnection) url.openConnection(); c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(15000); c.setReadTimeout(60000);
        c.setRequestProperty("User-Agent", "AstroSky-Android (https://github.com/root0323/jmgj-research)");
        c.setRequestProperty("Accept", "application/vnd.github+json"); return c;
    }
    private void cleanupApplied() { apk.delete(); metadata.delete(); release = null; }
    void close() { executor.shutdownNow(); }
}
