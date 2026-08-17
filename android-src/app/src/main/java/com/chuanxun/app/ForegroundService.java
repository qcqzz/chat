package com.chuanxun.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

public class ForegroundService extends Service {
    private static final String CHANNEL_ID = "foreground_service";
    private static final int NOTIFICATION_ID = 1001;
    private static final String PREFS_NAME = "chuanxun_prefs";
    private static final String KEY_PARTNER_NAME = "partnerName";

    // 保活续锁周期：每 15 分钟重新获取一次 WakeLock，避免单一 24h 锁被占用超时
    private static final long WAKELOCK_RENEW_INTERVAL_MS = 15 * 60 * 1000L;
    private static final long WAKELOCK_TIMEOUT_MS = 30 * 60 * 1000L;

    private PowerManager.WakeLock wakeLock = null;
    private String partnerName = "对方";
    private Handler keepAliveHandler;
    private final Runnable wakelockRenewRunnable = new Runnable() {
        @Override
        public void run() {
            try {
                if (wakeLock == null || !wakeLock.isHeld()) {
                    acquireWakeLock();
                    Log.i("ForegroundService", "WakeLock 已续期");
                }
                if (keepAliveHandler != null) {
                    keepAliveHandler.postDelayed(this, WAKELOCK_RENEW_INTERVAL_MS);
                }
            } catch (Exception e) {
                Log.w("ForegroundService", "续锁失败: " + e.getMessage());
            }
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        // 从 SharedPreferences 恢复昵称（防止服务被系统重启后丢失）
        partnerName = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_PARTNER_NAME, "对方");
        acquireWakeLock();
        startWakelockRenewLoop();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // WakeLock 可能已超时自动释放，重新获取
        if (wakeLock == null || !wakeLock.isHeld()) {
            acquireWakeLock();
        }

        // 处理更新通知文字请求
        if (intent != null && "UPDATE_NOTIFICATION".equals(intent.getAction())) {
            String name = intent.getStringExtra("partnerName");
            updateNotification(name);
            return START_STICKY;
        }

        // 从 Intent 获取昵称
        if (intent != null && intent.hasExtra("partnerName")) {
            partnerName = intent.getStringExtra("partnerName");
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit().putString(KEY_PARTNER_NAME, partnerName).apply();
        }

        // 点击通知回到 App
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("传讯")
                .setContentText("正在后台运行，等待" + partnerName + "消息…")
                .setSmallIcon(R.drawable.ic_stat_notification)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(Notification.PRIORITY_LOW)
                .build();

        startForeground(NOTIFICATION_ID, notification);
        return START_STICKY;
    }

    /**
     * 更新前台通知文字（跟随昵称变化）
     */
    public void updateNotification(String name) {
        partnerName = (name != null && !name.isEmpty()) ? name : "对方";
        // 持久化昵称，防止服务被系统重启后丢失
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putString(KEY_PARTNER_NAME, partnerName).apply();

        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("传讯")
                .setContentText("正在后台运行，等待" + partnerName + "消息…")
                .setSmallIcon(R.drawable.ic_stat_notification)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(Notification.PRIORITY_LOW)
                .build();

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, notification);
        }
    }

    /**
     * 获取 WakeLock 防止 CPU 休眠导致 WebView JavaScript 暂停
     * 使用较短超时，由 Handler 定时续期，避免单一超长锁被系统回收
     */
    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                if (wakeLock == null) {
                    wakeLock = pm.newWakeLock(
                            PowerManager.PARTIAL_WAKE_LOCK,
                            "chuanxun::foreground_wakelock"
                    );
                }
                if (!wakeLock.isHeld()) {
                    wakeLock.acquire(WAKELOCK_TIMEOUT_MS); // 30 分钟超时
                }
            }
        } catch (Exception e) {
            // 忽略
        }
    }

    /**
     * 启动 WakeLock 定时续期循环，确保长时间后台不被中断
     */
    private void startWakelockRenewLoop() {
        if (keepAliveHandler != null) return;
        keepAliveHandler = new Handler(Looper.getMainLooper());
        keepAliveHandler.postDelayed(wakelockRenewRunnable, WAKELOCK_RENEW_INTERVAL_MS);
    }

    @Override
    public void onDestroy() {
        if (keepAliveHandler != null) {
            keepAliveHandler.removeCallbacks(wakelockRenewRunnable);
            keepAliveHandler = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception e) {}
            wakeLock = null;
        }
        super.onDestroy();
    }

    /**
     * 用户从最近任务中划掉 App 时，重新调度定时唤醒，防止保活机制丢失
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        try {
            KeepAliveReceiver.scheduleNext(this);
            Log.i("ForegroundService", "任务被划掉，已重新调度定时唤醒");
        } catch (Exception e) {
            Log.w("ForegroundService", "重新调度失败: " + e.getMessage());
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "后台运行",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("传讯后台保活通知");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
}