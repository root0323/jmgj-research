package io.github.root0323.astrosky;

import android.util.Base64;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Fixed data providers only. Keys never appear in logs or errors. */
final class NativeNetwork {
    static final String CLOUD = "astrosky-black-marble.jmgj-kakao-search.workers.dev";
    static boolean permitted(URL url, boolean data) {
        if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null || (url.getPort() != -1 && url.getPort() != 443)) return false;
        String host = url.getHost(), path = url.getPath();
        if (data) return (host.equals(CLOUD) && path.matches("/VJ146A4-2025/(index\\.json|compact/VJ146A4\\.[A-Za-z0-9.]+\\.h5)")) ||
            (host.equals("copernicus-dem-90m.s3.amazonaws.com") && (path.equals("/tileList.txt") || path.matches("/Copernicus_DSM_COG_30_[NS]\\d{2}_00_[EW]\\d{3}_00_DEM/Copernicus_DSM_COG_30_[NS]\\d{2}_00_[EW]\\d{3}_00_DEM\\.tif")));
        return (host.equals("my.meteoblue.com") && (path.matches("/packages/(airquality-3h|clouds-3h|air-3h)") || path.equals("/account/usage"))) ||
            (host.equals("www.7timer.info") && path.equals("/bin/api.pl")) ||
            (host.equals("jmgj-kakao-search.jmgj-kakao-search.workers.dev") && path.matches("/v2/local/(search/(keyword|address)|geo/coord2address)\\.json")) ||
            (host.equals("photon.komoot.io") && (path.equals("/api/") || path.equals("/reverse"))) ||
            (host.equals("api.github.com") && path.equals("/repos/root0323/jmgj-research/releases/latest"));
    }
    static HttpURLConnection open(URL url, boolean data) throws Exception {
        if (!permitted(url, data)) throw new IOException("unsupported data provider");
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(15000); c.setReadTimeout(data ? 90000 : 30000);
        c.setRequestProperty("User-Agent", "AstroSky-Android/0.8.0 (https://github.com/root0323/jmgj-research)");
        return c;
    }
    static JSONObject json(String address) throws Exception {
        HttpURLConnection c = open(new URL(address), false);
        try {
            int status = c.getResponseCode();
            InputStream stream = status >= 200 && status < 300 ? c.getInputStream() : c.getErrorStream();
            byte[] body = stream == null ? "{}".getBytes(StandardCharsets.UTF_8) : read(stream, 12 * 1024 * 1024);
            JSONObject result = new JSONObject().put("status", status).put("body", Base64.encodeToString(body, Base64.NO_WRAP));
            JSONObject headers = new JSONObject();
            String credits = c.getHeaderField("MB-Credits-Accounted");
            if (credits != null) headers.put("MB-Credits-Accounted", credits);
            return result.put("headers", headers);
        } finally { c.disconnect(); }
    }
    static byte[] read(InputStream stream, int limit) throws IOException {
        try (InputStream input = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[32768]; int count;
            while ((count = input.read(buffer)) != -1) { if (out.size() + count > limit) throw new IOException("response too large"); out.write(buffer, 0, count); }
            return out.toByteArray();
        }
    }
    static String digest(File file) throws Exception {
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) { byte[] buffer = new byte[65536]; int count; while ((count = input.read(buffer)) != -1) sha.update(buffer, 0, count); }
        StringBuilder s = new StringBuilder(); for (byte b : sha.digest()) s.append(String.format("%02x", b & 255)); return s.toString();
    }
    static File download(File root, String address, String name, String hash, long bytes) throws Exception {
        if (!name.matches("(tileList\\.txt|VJ146A4\\.[A-Za-z0-9.]+\\.h5|Copernicus_DSM_COG_30_[NS]\\d{2}_00_[EW]\\d{3}_00_DEM\\.tif)")) throw new IOException("invalid data name");
        URL source = new URL(address);
        if (!source.getPath().endsWith("/" + name) || (name.endsWith(".h5") && (!hash.matches("[a-f0-9]{64}") || bytes < 8))) throw new IOException("invalid data catalogue");
        File file = new File(root, name);
        if (file.isFile() && file.length() > 8 && (bytes <= 0 || bytes == file.length()) && (hash.isEmpty() || digest(file).equals(hash))) return file;
        HttpURLConnection c = open(new URL(address), true);
        File temp = new File(root, name + ".part");
        try {
            if (c.getResponseCode() != 200) throw new IOException("data unavailable");
            long count = 0;
            try (InputStream input = c.getInputStream(); OutputStream out = new FileOutputStream(temp)) {
                byte[] buffer = new byte[65536]; int n;
                while ((n = input.read(buffer)) != -1) { count += n; if (count > 150_000_000) throw new IOException("data too large"); out.write(buffer, 0, n); }
            }
            if (count < 8 || (bytes > 0 && bytes != count) || (!hash.isEmpty() && !digest(temp).equals(hash))) throw new IOException("data verification failed");
            try (RandomAccessFile raf = new RandomAccessFile(temp, "rw")) { raf.getFD().sync(); }
            if (!temp.renameTo(file)) throw new IOException("data save failed");
            return file;
        } finally { c.disconnect(); if (temp.exists()) temp.delete(); }
    }
}
