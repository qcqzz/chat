package com.chuanxun.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "NotificationPlugin")
public class NotificationPlugin extends Plugin {

    private static final String CHANNEL_ID = "partner-messages";
    private static final String CHANNEL_NAME = "消息通知";
    private static final String CHANNEL_DESC = "对方发来消息时的系统通知";
    private static final String TAG = "NotificationPlugin";

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel existing = manager.getNotificationChannel(CHANNEL_ID);
            if (existing == null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription(CHANNEL_DESC);
                channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
                channel.enableVibration(true);
                channel.enableLights(true);
                channel.setBypassDnd(true);
                channel.setShowBadge(true);
                manager.createNotificationChannel(channel);
                Log.i(TAG, "Notification channel created: " + CHANNEL_ID);
            } else {
                // 确保已有 channel 也启用了振动、免打扰绕过和锁屏显示
                if (existing.getImportance() < NotificationManager.IMPORTANCE_HIGH) {
                    existing.setImportance(NotificationManager.IMPORTANCE_HIGH);
                }
                existing.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
                existing.enableVibration(true);
                existing.enableLights(true);
                existing.setBypassDnd(true);
                existing.setShowBadge(true);
                manager.createNotificationChannel(existing);
                Log.i(TAG, "Notification channel updated: " + CHANNEL_ID);
            }
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        String title = call.getString("title", "传讯");
        String body = call.getString("body", "");
        int id = call.getInt("id", (int) (System.currentTimeMillis() % Integer.MAX_VALUE));
        // urgent=true：视频邀请/来电等紧急场景，用 FullScreenIntent 弹全屏弹窗（类似微信来电）
        // urgent=false：普通聊天消息等，只用 Heads-up 横幅，几秒后自动收回（类似微信普通消息）
        boolean urgent = call.getBoolean("urgent", false);

        createChannel();

        Context context = getContext();

        // 点击通知打开 App
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(urgent ? NotificationCompat.CATEGORY_CALL : NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setVibrate(new long[]{0, 300, 200, 300})
            .setGroup("chuanxun-partner")
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_ALL)
            .setWhen(System.currentTimeMillis())
            .setOnlyAlertOnce(false);

        // 关键区分：
        // 1) 普通消息（urgent=false）：不用 FullScreenIntent
        //    —— 只用 PRIORITY_HIGH + IMPORTANCE_HIGH，
        //       系统会在顶部弹出 Heads-up 横幅，几秒后自动收回，
        //       通知留在下拉栏中等待用户点击，行为完全等同于微信普通消息。
        // 2) 紧急场景（urgent=true）：保留 FullScreenIntent
        //    —— 视频邀请/来电等需要立刻打断用户的场景，类似微信来电全屏弹窗，
        //       用户手动接听/拒接或响铃超时后才会消失。
        if (urgent && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            builder.setFullScreenIntent(pendingIntent, true);
        }

        try {
            NotificationManagerCompat.from(context).notify(id, builder.build());
            Log.i(TAG, "Notification sent: id=" + id + " urgent=" + urgent + " title=" + title);
            call.resolve(new JSObject().put("success", true).put("id", id));
        } catch (SecurityException e) {
            Log.e(TAG, "Permission denied: " + e.getMessage());
            call.reject("Permission denied: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "Failed to send notification: " + e.getMessage());
            call.reject("Failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ needs POST_NOTIFICATIONS permission
            if (getContext().checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                call.resolve(new JSObject().put("granted", true));
            } else {
                // Request at runtime — but Capacitor handles this, we just report
                call.resolve(new JSObject().put("granted", false).put("reason", "Permission not granted"));
            }
        } else {
            call.resolve(new JSObject().put("granted", true));
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        int id = call.getInt("id", -1);
        if (id >= 0) {
            NotificationManagerCompat.from(getContext()).cancel(id);
            Log.i(TAG, "Notification cancelled: id=" + id);
        }
        call.resolve();
    }

    // 下载状态跟踪（供 JS 轮询进度）
    private static volatile DownloadState sDownloadState = null;

    private static class DownloadState {
        volatile boolean active = false;
        volatile long totalBytes = 0;
        volatile long downloadedBytes = 0;
        volatile int progress = 0;
        volatile String error = null;
        volatile boolean complete = false;
    }

    /**
     * 获取当前下载进度（JS 轮询调用）
     */
    @PluginMethod
    public void getDownloadProgress(PluginCall call) {
        DownloadState state = sDownloadState;
        if (state == null || !state.active) {
            call.resolve(new JSObject().put("active", false));
            return;
        }
        JSObject result = new JSObject();
        result.put("active", state.active);
        result.put("totalBytes", state.totalBytes);
        result.put("downloadedBytes", state.downloadedBytes);
        result.put("progress", state.progress);
        result.put("complete", state.complete);
        if (state.error != null) {
            result.put("error", state.error);
        }
        call.resolve(result);
    }

    /**
     * 下载 APK 并触发系统安装
     * 下载过程中更新 DownloadState，JS 可通过 getDownloadProgress 轮询进度。
     * 仅在下载完成并触发安装后才 resolve。
     */
    @PluginMethod
    public void downloadApk(PluginCall call) {
        String urlStr = call.getString("url");
        String version = call.getString("version", "");

        if (urlStr == null || urlStr.isEmpty()) {
            call.reject("URL is required");
            return;
        }

        // 初始化下载状态
        final DownloadState state = new DownloadState();
        state.active = true;
        sDownloadState = state;

        new Thread(() -> {
            try {
                Context ctx = getContext();
                File cacheDir = ctx.getExternalCacheDir();
                if (cacheDir == null) {
                    cacheDir = ctx.getCacheDir();
                }
                File apkFile = new File(cacheDir, "update-v" + version + ".apk");

                Log.i(TAG, "Downloading APK from: " + urlStr);
                URL url = new URL(urlStr);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(60000);
                conn.setReadTimeout(300000);
                conn.setInstanceFollowRedirects(true);
                conn.connect();

                int responseCode = conn.getResponseCode();
                if (responseCode != HttpURLConnection.HTTP_OK) {
                    Log.e(TAG, "Download failed: HTTP " + responseCode);
                    state.error = "HTTP " + responseCode;
                    state.active = false;
                    final int code = responseCode;
                    getBridge().executeOnMainThread(() -> {
                        call.reject("Download failed: HTTP " + code);
                    });
                    return;
                }

                state.totalBytes = conn.getContentLengthLong();
                Log.i(TAG, "Content-Length: " + state.totalBytes + " bytes");

                // 删除旧文件
                if (apkFile.exists()) {
                    apkFile.delete();
                }

                try (InputStream in = new BufferedInputStream(conn.getInputStream());
                     FileOutputStream out = new FileOutputStream(apkFile)) {
                    byte[] buffer = new byte[8192];
                    int bytesRead;
                    while ((bytesRead = in.read(buffer)) != -1) {
                        out.write(buffer, 0, bytesRead);
                        state.downloadedBytes += bytesRead;
                        if (state.totalBytes > 0) {
                            state.progress = (int) ((state.downloadedBytes * 100) / state.totalBytes);
                        }
                    }
                    out.flush();
                }

                conn.disconnect();
                state.progress = 100;
                state.complete = true;
                state.active = false;
                Log.i(TAG, "APK downloaded: " + apkFile.getAbsolutePath() + " size=" + apkFile.length());

                // 通过 FileProvider 获取 URI 并触发安装
                Uri apkUri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apkFile);

                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                ctx.startActivity(installIntent);
                Log.i(TAG, "Install intent launched for: " + apkUri);

                getBridge().executeOnMainThread(() -> {
                    call.resolve(new JSObject().put("success", true).put("message", "Download complete, installing"));
                });

            } catch (Exception e) {
                Log.e(TAG, "APK download/install failed: " + e.getMessage());
                state.error = e.getMessage();
                state.active = false;
                getBridge().executeOnMainThread(() -> {
                    call.reject("Download failed: " + e.getMessage());
                });
            }
        }).start();
    }

    /**
     * 安装已下载的 APK 文件
     * 接收 base64 编码的 APK 数据，写入文件后触发安装
     */
    @PluginMethod
    public void installApk(PluginCall call) {
        String base64Data = call.getString("data");
        String version = call.getString("version", "");

        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("APK data is required");
            return;
        }

        new Thread(() -> {
            try {
                Context ctx = getContext();
                File cacheDir = ctx.getExternalCacheDir();
                if (cacheDir == null) {
                    cacheDir = ctx.getCacheDir();
                }
                File apkFile = new File(cacheDir, "update-v" + version + ".apk");

                // 删除旧文件
                if (apkFile.exists()) {
                    apkFile.delete();
                }

                byte[] apkBytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
                try (FileOutputStream out = new FileOutputStream(apkFile)) {
                    out.write(apkBytes);
                    out.flush();
                }

                Log.i(TAG, "APK written: " + apkFile.getAbsolutePath() + " size=" + apkFile.length());

                // 通过 FileProvider 获取 URI 并触发安装
                Uri apkUri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apkFile);

                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                ctx.startActivity(installIntent);
                Log.i(TAG, "Install intent launched for: " + apkUri);

                getBridge().executeOnMainThread(() -> {
                    call.resolve(new JSObject().put("success", true).put("message", "Install triggered"));
                });

            } catch (Exception e) {
                Log.e(TAG, "APK install failed: " + e.getMessage());
                getBridge().executeOnMainThread(() -> {
                    call.reject("Install failed: " + e.getMessage());
                });
            }
        }).start();
    }
}