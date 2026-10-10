package io.github.root0323.astrosky;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.hardware.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.FrameLayout;
import androidx.webkit.*;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

public class MainActivity extends Activity implements SensorEventListener {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private WebView web;
    private AppUpdater updater;
    private final ExecutorService network = Executors.newFixedThreadPool(3);
    private final ExecutorService downloads = Executors.newSingleThreadExecutor();
    private SensorManager sensors;
    private Sensor rotation, accelerometer, magnetometer;
    private float[] gravity, magnetic;
    private boolean following, paused;
    private double declination;
    private long lastSensor;
    private int magneticAccuracy = SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM;
    private File dataRoot;
    private ValueCallback<Uri[]> fileCallback;
    private GeolocationPermissions.Callback locationCallback;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(Color.BLACK); getWindow().setNavigationBarColor(Color.BLACK);
        dataRoot = new File(getFilesDir(), "regional-data"); dataRoot.mkdirs();
        sensors = (SensorManager) getSystemService(SENSOR_SERVICE);
        rotation = sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
        if (rotation == null) rotation = sensors.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR);
        accelerometer = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        magnetometer = sensors.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        FrameLayout frame = new FrameLayout(this);
        web = new WebView(this); web.setBackgroundColor(Color.BLACK);
        frame.addView(web, new FrameLayout.LayoutParams(-1, -1)); setContentView(frame);
        frame.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        frame.requestApplyInsets();
        try { updater = new AppUpdater(this); } catch (Exception ignored) { }
        WebSettings s = web.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(true); s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportZoom(false); s.setMediaPlaybackRequiresUserGesture(true);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/", path -> asset(path))
            .build();
        web.setWebViewClient(new WebViewClientCompat() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) { return loader.shouldInterceptRequest(request.getUrl()); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())) return false;
                if (("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) && request.isForMainFrame()) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (ActivityNotFoundException ignored) { }
                }
                return true;
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(new ServiceWorkerClientCompat() {
                @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) { return loader.shouldInterceptRequest(request.getUrl()); }
            });
        }
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
                if (fileCallback != null) fileCallback.onReceiveValue(null); fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
                try { startActivityForResult(intent, 42); return true; } catch (ActivityNotFoundException e) { fileCallback = null; return false; }
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!origin.equals(ORIGIN)) { callback.invoke(origin, false, false); return; }
                locationCallback = callback;
                if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) { callback.invoke(ORIGIN, true, false); locationCallback = null; }
                else requestPermissions(new String[] {Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION}, 43);
            }
        });
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            new android.app.AlertDialog.Builder(this).setMessage("Android System WebView를 최신 버전으로 업데이트한 뒤 AstroSky를 다시 열어 주세요.").setPositiveButton("확인", (d, which) -> finish()).show();
            return;
        }
        Bridge bridge = new Bridge();
        WebViewCompat.addWebMessageListener(web, "AstroSkyAndroid", Collections.singleton(ORIGIN), (view, message, origin, mainFrame, reply) -> {
            if (!mainFrame) return;
            try {
                JSONObject p = new JSONObject(message.getData()); int id = p.getInt("id");
                switch (p.getString("action")) {
                    case "capabilities": result(id, new JSONObject(bridge.capabilities())); break;
                    case "request": bridge.request(id, p.getString("url")); break;
                    case "download": bridge.download(id, p.getString("url"), p.getString("name"), p.optString("hash"), p.optLong("bytes")); break;
                    case "follow": bridge.follow(p.getBoolean("enabled"), p.getDouble("latitude"), p.getDouble("longitude")); result(id, new JSONObject()); break;
                    case "updateState": if (updater != null) result(id, updater.state()); break;
                    case "updateCheck": if (updater != null) updater.check(value -> result(id, value)); break;
                    case "updateDownload": if (updater != null) updater.download(value -> result(id, value)); break;
                    case "updateInstall": if (updater != null) updater.install(value -> result(id, value)); break;
                }
            } catch (Exception ignored) { }
        });
        web.loadUrl(ORIGIN + "/index.html");
    }
    private WebResourceResponse asset(String path) {
        try {
            if (path.isEmpty()) path = "index.html";
            if (path.contains("..") || path.contains("\\")) return null;
            InputStream input;
            if (path.startsWith("native-data/")) {
                String name = path.substring(12); if (name.contains("/")) return null;
                input = new FileInputStream(new File(dataRoot, name));
            } else input = getAssets().open("web/" + path);
            String mime = path.endsWith(".wasm") ? "application/wasm" : path.endsWith(".js") || path.endsWith(".mjs") ? "application/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".html") ? "text/html" : path.endsWith(".json") ? "application/json" : path.endsWith(".png") ? "image/png" : path.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream";
            return new WebResourceResponse(mime, "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control", "no-cache"), input);
        } catch (IOException e) { return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0])); }
    }
    private void result(int id, JSONObject value) {
        web.post(() -> web.evaluateJavascript("window.__astroskyResult?.(" + id + "," + value + ")", null));
    }
    public final class Bridge {
        public String capabilities() {
            return "{\"android\":true,\"compass\":" + (rotation != null || (accelerometer != null && magnetometer != null)) + ",\"version\":\"" + BuildConfig.VERSION_NAME + "\"}";
        }
        public void request(int id, String address) {
            network.submit(() -> { try { result(id, NativeNetwork.json(address)); } catch (Exception e) { try { result(id, new JSONObject().put("error", "자료 서버 연결 실패. 네트워크와 API 권한을 확인하세요.")); } catch (JSONException ignored) { } } });
        }
        public void download(int id, String address, String name, String hash, long bytes) {
            downloads.submit(() -> { try {
                File f = NativeNetwork.download(dataRoot, address, name, hash, bytes);
                result(id, new JSONObject().put("path", "/native-data/" + f.getName()).put("bytes", f.length()));
            } catch (Exception e) { try { result(id, new JSONObject().put("error", "지역 자료 다운로드·검증 실패. 저장 공간과 네트워크를 확인하세요.")); } catch (JSONException ignored) { } } });
        }
        public void follow(boolean enabled, double latitude, double longitude) {
            web.post(() -> {
                declination = new GeomagneticField((float)latitude, (float)longitude, 0, System.currentTimeMillis()).getDeclination();
                following = enabled;
                updateSensors();
            });
        }
    }
    private void updateSensors() {
        sensors.unregisterListener(this); gravity = null; magnetic = null;
        if (!following || paused) return;
        if (rotation != null) sensors.registerListener(this, rotation, SensorManager.SENSOR_DELAY_GAME);
        else if (accelerometer != null && magnetometer != null) {
            sensors.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_GAME);
            sensors.registerListener(this, magnetometer, SensorManager.SENSOR_DELAY_GAME);
        }
    }
    @Override public void onSensorChanged(SensorEvent event) {
        float[] matrix = new float[9];
        if (event.sensor.getType() == Sensor.TYPE_ROTATION_VECTOR || event.sensor.getType() == Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR) SensorManager.getRotationMatrixFromVector(matrix, event.values);
        else {
            if (event.sensor.getType() == Sensor.TYPE_ACCELEROMETER) gravity = event.values.clone(); else magnetic = event.values.clone();
            if (gravity == null || magnetic == null || !SensorManager.getRotationMatrix(matrix, null, gravity, magnetic)) return;
        }
        if (!following || event.timestamp - lastSensor < 33_000_000) return;
        lastSensor = event.timestamp;
        double[] direction = SkyDirection.fromMatrix(matrix, declination);
        int accuracy = rotation == null ? magneticAccuracy : event.accuracy;
        web.evaluateJavascript("window.__astroskyDirection?.(" + direction[0] + "," + direction[1] + "," + accuracy + ")", null);
    }
    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { if (sensor.getType() == Sensor.TYPE_MAGNETIC_FIELD) magneticAccuracy = accuracy; }
    @Override protected void onPause() { super.onPause(); paused = true; updateSensors(); }
    @Override protected void onResume() { super.onResume(); paused = false; if (sensors != null) updateSensors(); if (updater != null) updater.resumed(); }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code == 43 && locationCallback != null) { locationCallback.invoke(ORIGIN, grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED, false); locationCallback = null; }
    }
    @Override protected void onActivityResult(int request, int result, Intent intent) {
        super.onActivityResult(request, result, intent);
        if (request == 42 && fileCallback != null) { fileCallback.onReceiveValue(result == RESULT_OK && intent != null ? new Uri[] {intent.getData()} : null); fileCallback = null; }
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("window.__astroskyBack?.()", handled -> { if (!"true".equals(handled)) MainActivity.super.onBackPressed(); });
    }
    @Override protected void onDestroy() { sensors.unregisterListener(this); network.shutdownNow(); downloads.shutdownNow(); if (updater != null) updater.close(); if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.removeWebMessageListener(web, "AstroSkyAndroid"); web.destroy(); super.onDestroy(); }
}
