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
import android.os.IBinder;
import android.os.PowerManager;

public class ForegroundService extends Service {
    private static final String CHANNEL_ID = "foreground_service";
    private static final int NOTIFICATION_ID = 1001;
    private static final String PREFS_NAME = "chuanxun_prefs";
    private static final String KEY_PARTNER_NAME = "partnerName";
    private PowerManager.WakeLock wakeLock = null;
    private String partnerName = "对方";

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        // 从 SharedPreferences 恢复昵称（防止服务被系统重启后丢失）
        partnerName = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_PARTNER_NAME, "对方");
        acquireWakeLock();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // WakeLock 可能已过期（24h 自动释放），重新获取
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
     */
    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "chuanxun::foreground_wakelock"
                );
                wakeLock.acquire(24 * 60 * 60 * 1000L); // 最长 24 小时
            }
        } catch (Exception e) {
            // 忽略
        }
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception e) {}
            wakeLock = null;
        }
        super.onDestroy();
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