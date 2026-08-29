package com.chuanxun.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * MediaNotificationPlugin — 系统通知栏媒体播放条（类似网易云音乐）。
 *
 * WebView 里的 <audio> 播放音乐时，通过前端桥把歌曲信息/进度/播停状态发到这里，
 * 原生在系统通知栏渲染一条媒体通知：封面 + 标题/歌手 + 进度条 + 播放/暂停、上一首、下一首。
 * 用户点通知栏按钮时，通过 mediaAction 事件回发给 JS，由 JS 继续驱动 <audio>。
 */
@CapacitorPlugin(name = "MediaNotification")
public class MediaNotificationPlugin extends Plugin {

    private static final String TAG = "MediaNotificationPlugin";
    private static final String CHANNEL_ID = "media-player";
    private static final int NOTIFICATION_ID = 8009;

    static final int ACTION_PREV = 0;
    static final int ACTION_PLAY_PAUSE = 1;
    static final int ACTION_NEXT = 2;

    // 当前媒体状态（供 ActionReceiver 与 JS 跨线程读取）
    static volatile String sTitle = "";
    static volatile String sSub = "";
    static volatile long sDuration = 0;
    static volatile long sPosition = 0;
    static volatile boolean sPlaying = false;
    static volatile boolean sEnabled = false;
    private static volatile Bitmap sLargeIcon = null;
    private static volatile String sCoverKey = "";   // 封面尚未变化时避免重复加载
    private static volatile MediaNotificationPlugin sInstance = null;

    private final Handler mMain = new Handler(Looper.getMainLooper());
    private final ExecutorService mExecutor = Executors.newSingleThreadExecutor();

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel existing = manager.getNotificationChannel(CHANNEL_ID);
            if (existing == null) {
                // 媒体通知渠道：纯静音、低打扰，不在锁屏亮屏
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "音乐播放",
                    NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("正在播放的歌曲控制通知");
                channel.setSound(null, null);
                channel.enableVibration(false);
                channel.setShowBadge(false);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                manager.createNotificationChannel(channel);
            }
        }
    }

    private boolean hasPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private Bitmap decodeCover(String base64, String coverUrl) {
        try {
            if (base64 != null && !base64.isEmpty()) {
                String data = base64;
                int comma = data.indexOf(',');
                if (comma >= 0) data = data.substring(comma + 1);
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            }
            if (coverUrl != null && !coverUrl.isEmpty()) {
                HttpURLConnection conn = (HttpURLConnection) new URL(coverUrl).openConnection();
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(9000);
                conn.connect();
                if (conn.getResponseCode() == HttpURLConnection.HTTP_OK) {
                    java.io.InputStream is = conn.getInputStream();
                    Bitmap bmp = BitmapFactory.decodeStream(is);
                    is.close();
                    return bmp;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "封面加载失败: " + e.getMessage());
        }
        return null;
    }

    private PendingIntent actionIntent(Context context, int action) {
        Intent intent = new Intent(context, MediaActionReceiver.class);
        intent.setAction("com.chuanxun.app.MEDIA_ACTION");
        intent.putExtra("action", action);
        return PendingIntent.getBroadcast(
            context,
            action,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void postNotification(Context context) {
        if (!hasPermission()) return;

        ensureChannel();

        Intent openIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setContentTitle(sTitle.isEmpty() ? "正在播放" : sTitle)
            .setContentText(sSub)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(false)
            .setOnlyAlertOnce(true)
            .setContentIntent(PendingIntent.getActivity(
                context, NOTIFICATION_ID, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            ))
            .setShowWhen(false);

        if (sLargeIcon != null) {
            b.setLargeIcon(sLargeIcon);
        }

        if (sDuration > 0) {
            long max = sDuration;
            long pos = Math.min(sPosition, max);
            long remain = max - pos;
            b.setProgress((int) (max / 1000), (int) (pos / 1000), false);
            b.setWhen(System.currentTimeMillis() - remain);
        }

        NotificationCompat.Action prev = new NotificationCompat.Action.Builder(
            0, "上一首", actionIntent(context, ACTION_PREV)).build();
        NotificationCompat.Action playPause = new NotificationCompat.Action.Builder(
            0, sPlaying ? "暂停" : "播放", actionIntent(context, ACTION_PLAY_PAUSE)).build();
        NotificationCompat.Action next = new NotificationCompat.Action.Builder(
            0, "下一首", actionIntent(context, ACTION_NEXT)).build();

        b.addAction(prev);
        b.addAction(playPause);
        b.addAction(next);

        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, b.build());
            sEnabled = true;
        } catch (SecurityException e) {
            Log.e(TAG, "通知权限被拒，跳过: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "发送媒体通知失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void show(PluginCall call) {
        sTitle = call.getString("title", "");
        sSub = call.getString("sub", "");
        sDuration = call.getLong("duration", 0L);
        sPosition = call.getLong("position", 0L);
        sPlaying = call.getBoolean("playing", true);

        String coverKey = call.getString("coverKey", "");
        String coverB64 = call.getString("cover", "");
        String coverUrl = call.getString("coverUrl", "");
        String wantKey = sCoverKey + "|" + coverKey;
        if (!wantKey.equals(sCoverKey)) {
            sCoverKey = wantKey;
            final Context ctx = getContext();
            final String b64 = coverB64;
            final String url = coverUrl;
            mExecutor.execute(() -> {
                final Bitmap bmp = decodeCover(b64, url);
                if (bmp != null) {
                    sLargeIcon = Bitmap.createScaledBitmap(bmp, 192, 192, true);
                }
                mMain.post(() -> postNotification(ctx));
            });
        }
        postNotification(getContext());
        call.resolve();
    }

    /** 播放层实时回调：更新秒级进度与播停状态。 */
    @PluginMethod
    public void update(PluginCall call) {
        sDuration = call.getLong("duration", sDuration);
        sPosition = call.getLong("position", sPosition);
        sPlaying = call.getBoolean("playing", sPlaying);
        if (sEnabled) {
            postNotification(getContext());
        }
        call.resolve();
    }

    @PluginMethod
    public void setPlaying(PluginCall call) {
        sPlaying = call.getBoolean("playing", sPlaying);
        if (sEnabled) {
            postNotification(getContext());
        }
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        sEnabled = false;
        NotificationManagerCompat.from(getContext()).cancel(NOTIFICATION_ID);
        call.resolve();
    }

    /** 供 MediaActionReceiver 在任意线程回调 JS。 */
    static void emitAction(int action) {
        final String name;
        switch (action) {
            case ACTION_PREV: name = "prev"; break;
            case ACTION_NEXT: name = "next"; break;
            default: name = sPlaying ? "pause" : "play"; break;
        }
        final String actName = name;
        final Plugin inst = sInstance;
        if (inst == null) return;
        inst.getBridge().executeOnMainThread(() -> {
            try {
                JSObject payload = new JSObject();
                payload.put("action", actName);
                inst.notifyListeners("mediaAction", payload);
            } catch (Exception e) {
                Log.e(TAG, "回发 mediaAction 失败: " + e.getMessage());
            }
        });
    }

    @Override
    public void load() {
        super.load();
        sInstance = this;
    }

    @Override
    public void handleOnDestroy() {
        if (sInstance == this) {
            sInstance = null;
        }
        super.handleOnDestroy();
    }
}