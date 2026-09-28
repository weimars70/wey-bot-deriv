package com.weybot.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;

/**
 * Servicio nativo de Android que corre en primer plano (ForegroundService) y
 * sondea el backend cada 12 segundos. No depende del WebView — funciona aunque
 * la app esté minimizada, en segundo plano o con la pantalla apagada.
 *
 * Flujo:
 *  1. Al iniciarse muestra una notificación persistente (requerimiento Android 8+).
 *  2. Cada 12 s llama a /strategies/crash-ia/double-wick-summary via HTTP.
 *  3. Si encuentra una señal válida dispara una notificación con sonido del sistema.
 *  4. Deduplica alertas usando SharedPreferences para no repetir la misma señal.
 */
public class BackgroundRadarService extends Service {

    private static final String TAG            = "WeyBotRadar";
    private static final String BASE_URL       = "http://2.58.80.90/bot/api";
    private static final String CHANNEL_RADAR  = "weybot_radar_service";
    private static final String CHANNEL_ALERTS = "weybot_alerts";
    private static final int    NOTIF_ID_FG    = 9001;   // notificación persistente
    private static final long   POLL_INTERVAL  = 12_000L; // 12 segundos

    private static final String PREFS_NAME     = "weybot_radar_prefs";
    private static final String PREFS_TOKEN    = "jwt_token";
    private static final String PREFS_SEEN     = "seen_signals";

    private Handler  handler;
    private Runnable pollRunnable;
    private int      notifCounter = 2000;

    // ── Ciclo de vida ─────────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
        startForeground(NOTIF_ID_FG, buildForegroundNotification());
        handler = new Handler(Looper.getMainLooper());
        Log.i(TAG, "BackgroundRadarService iniciado");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        schedulePoll();
        return START_STICKY; // Android reinicia el servicio si lo mata
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        if (handler != null && pollRunnable != null) {
            handler.removeCallbacks(pollRunnable);
        }
        Log.i(TAG, "BackgroundRadarService detenido");
        super.onDestroy();
    }

    // ── Polling ───────────────────────────────────────────────────────────────

    private void schedulePoll() {
        if (pollRunnable == null) {
            pollRunnable = new Runnable() {
                @Override
                public void run() {
                    new Thread(() -> {
                        pollDoubleWick();
                        pollCrashIaSummary();
                    }).start();
                    handler.postDelayed(this, POLL_INTERVAL);
                }
            };
        }
        handler.removeCallbacks(pollRunnable);
        handler.post(pollRunnable);
    }

    // ── Llamadas HTTP ─────────────────────────────────────────────────────────

    private String httpGet(String path) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(BASE_URL + path);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);

            // Adjuntar JWT si está guardado
            String token = getToken();
            if (token != null && !token.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + token);
            }

            int status = conn.getResponseCode();
            if (status != 200) return null;

            BufferedReader reader = new BufferedReader(
                new InputStreamReader(conn.getInputStream()));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            reader.close();
            return sb.toString();

        } catch (Exception e) {
            Log.w(TAG, "HTTP error: " + e.getMessage());
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ── Estrategia Dos Velas ──────────────────────────────────────────────────

    private void pollDoubleWick() {
        try {
            String json = httpGet("/strategies/crash-ia/double-wick-summary");
            if (json == null) return;

            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.getJSONObject(i);
                boolean isValid = item.optBoolean("isValid", false);
                if (!isValid) continue;

                String symbol    = item.optString("symbol", "");
                String mercado   = item.optString("mercado", symbol);
                String direction = item.optString("direction", "");
                double entry     = item.optDouble("entryPrice", 0);

                String dedupeKey = "dw_" + symbol + "_" + Math.round(entry * 10);
                if (alreadySeen(dedupeKey)) continue;
                markSeen(dedupeKey);

                String title = direction.equals("BUY")
                    ? "📈 " + mercado + " — BOOM BUY"
                    : "📉 " + mercado + " — CRASH SELL";
                String body = "Patrón de dos velas en M5 | Entrada: " +
                    String.format("%.3f", entry);

                fireAlertNotification(title, body);
                Log.i(TAG, "Dos velas alert: " + title);
            }
        } catch (Exception e) {
            Log.w(TAG, "pollDoubleWick error: " + e.getMessage());
        }
    }

    // ── Estrategia Crash IA (Zonas + OB) ─────────────────────────────────────

    private void pollCrashIaSummary() {
        try {
            String json = httpGet("/strategies/crash-ia/summary");
            if (json == null) return;

            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.getJSONObject(i);
                boolean canSell = item.optBoolean("canSell", false);
                boolean canBuy  = item.optBoolean("canBuy", false);
                String status   = item.optString("status", "");
                if (!canSell && !canBuy && !status.equals("EN_ZONA_50")) continue;

                String symbol  = item.optString("symbol", "");
                String mercado = item.optString("mercado", symbol);
                double entry   = item.optDouble("entryLevel50", 0);

                String dedupeKey = "cia_" + symbol + "_" + status + "_" + Math.round(entry);
                if (alreadySeen(dedupeKey)) continue;
                markSeen(dedupeKey);

                String title, body;
                if (canSell) {
                    title = "🎯 " + mercado + " — Venta Confirmada";
                    body  = "Crash IA: precio en zona M5. Entrada: " + String.format("%.3f", entry);
                } else if (canBuy) {
                    title = "🎯 " + mercado + " — Compra Confirmada";
                    body  = "Crash IA: precio en zona M5. Entrada: " + String.format("%.3f", entry);
                } else {
                    title = "⚡ " + mercado + " — En Zona 50%";
                    body  = "Crash IA: precio en zona de seguimiento. Monitoreando.";
                }

                fireAlertNotification(title, body);
                Log.i(TAG, "CrashIA alert: " + title);
            }
        } catch (Exception e) {
            Log.w(TAG, "pollCrashIaSummary error: " + e.getMessage());
        }
    }

    // ── Notificaciones ────────────────────────────────────────────────────────

    private void fireAlertNotification(String title, String body) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this, notifCounter,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ALERTS);
        } else {
            builder = new Notification.Builder(this);
            builder.setPriority(Notification.PRIORITY_HIGH);
            builder.setSound(soundUri);
            builder.setVibrate(new long[]{0, 250, 100, 250});
        }

        builder.setSmallIcon(android.R.drawable.ic_dialog_info)
               .setContentTitle(title)
               .setContentText(body)
               .setStyle(new Notification.BigTextStyle().bigText(body))
               .setContentIntent(pi)
               .setAutoCancel(true)
               .setOnlyAlertOnce(false);

        nm.notify(notifCounter++, builder.build());
    }

    // ── Notificación persistente (ForegroundService) ──────────────────────────

    private Notification buildForegroundNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_RADAR);
        } else {
            builder = new Notification.Builder(this);
        }

        return builder
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("WeyBot — Radar Activo")
            .setContentText("Monitoreando señales en vivo en segundo plano")
            .setOngoing(true)
            .setContentIntent(pi)
            .build();
    }

    // ── Canales de notificación (Android 8+) ──────────────────────────────────

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        // Canal para alertas con sonido
        Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        AudioAttributes audioAttr = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

        NotificationChannel alertChannel = new NotificationChannel(
            CHANNEL_ALERTS,
            "WeyBot Alertas",
            NotificationManager.IMPORTANCE_HIGH
        );
        alertChannel.setDescription("Señales y confirmaciones en vivo");
        alertChannel.enableVibration(true);
        alertChannel.setVibrationPattern(new long[]{0, 250, 100, 250});
        alertChannel.setSound(soundUri, audioAttr);
        alertChannel.enableLights(true);
        nm.createNotificationChannel(alertChannel);

        // Canal silencioso para la notificación persistente del servicio
        NotificationChannel radarChannel = new NotificationChannel(
            CHANNEL_RADAR,
            "WeyBot Radar",
            NotificationManager.IMPORTANCE_LOW
        );
        radarChannel.setDescription("Servicio de monitoreo en segundo plano");
        radarChannel.setSound(null, null);
        radarChannel.enableVibration(false);
        nm.createNotificationChannel(radarChannel);
    }

    // ── Deduplicación de señales ──────────────────────────────────────────────

    private boolean alreadySeen(String key) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        Set<String> seen = prefs.getStringSet(PREFS_SEEN, new HashSet<>());
        return seen != null && seen.contains(key);
    }

    private void markSeen(String key) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        Set<String> seen = new HashSet<>(prefs.getStringSet(PREFS_SEEN, new HashSet<>()));
        seen.add(key);
        // Mantener máximo 200 keys para no crecer indefinidamente
        if (seen.size() > 200) seen.clear();
        prefs.edit().putStringSet(PREFS_SEEN, seen).apply();
    }

    private String getToken() {
        // El token JWT lo guarda el WebView en localStorage con clave 'deriv_app_token'
        // Como el servicio nativo no tiene acceso a localStorage, lo leemos desde
        // SharedPreferences donde MainActivity lo escribe al iniciar sesión.
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getString(PREFS_TOKEN, "");
    }
}
