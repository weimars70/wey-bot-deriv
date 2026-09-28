package com.weybot.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.capacitorjs.plugins.localnotifications.LocalNotificationsPlugin;

public class MainActivity extends BridgeActivity {

    private static final String PREFS_NAME  = "weybot_radar_prefs";
    private static final String PREFS_TOKEN = "jwt_token";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalNotificationsPlugin.class);
        super.onCreate(savedInstanceState);

        try {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                WebView wv = this.bridge.getWebView();
                WebSettings settings = wv.getSettings();
                settings.setMediaPlaybackRequiresUserGesture(false);

                // Expone window.AndroidBridge al JS para que el auth store
                // pueda pasar el JWT al servicio nativo de background
                wv.addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");
            }
        } catch (Exception ignored) {}

        // Iniciar el servicio nativo de radar en segundo plano
        startRadarService();
    }

    @Override
    public void onResume() {
        super.onResume();
        // Releer el token de localStorage al volver al frente por si cambió
        try {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().evaluateJavascript(
                    "(function(){ try { var t = localStorage.getItem('deriv_app_token'); " +
                    "if(t && window.AndroidBridge) window.AndroidBridge.saveToken(t); } catch(e){} })()",
                    null
                );
            }
        } catch (Exception ignored) {}
    }

    private void startRadarService() {
        try {
            Intent intent = new Intent(this, BackgroundRadarService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent);
            } else {
                startService(intent);
            }
        } catch (Exception e) {
            android.util.Log.w("WeyBot", "No se pudo iniciar BackgroundRadarService: " + e.getMessage());
        }
    }

    // ── Puente JS → Java ──────────────────────────────────────────────────────

    public static class AndroidBridge {
        private final Context context;

        AndroidBridge(Context ctx) {
            this.context = ctx;
        }

        /** Llamado desde el auth store JS para guardar el JWT en SharedPreferences */
        @JavascriptInterface
        public void saveToken(String token) {
            if (token == null) token = "";
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(PREFS_TOKEN, token).apply();
        }
    }
}
