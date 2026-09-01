package com.chuanxun.app;

import android.annotation.TargetApi;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.ServiceCompat;

/**
 * 前台保活服务。
 *
 * 前台服务类型策略：Android 15+（API 35）对 dataSync 这类后台型前台服务有 6 小时强制
 * 超时——超时后系统直接销毁服务并杀死进程，保活链无声断裂，即使从未被用户清除后台也会死。
 * 为满足"只要没被清除后台就能一直运行"，Android 14+（API 34）改用 specialUse 类型
 * （无超时、无需持续音频、侧载 App 无审核问题），低版本继续用 dataSync 兼容。
 */
public class ForegroundService extends Service {
    private static final String CHANNEL_ID = "foreground_service";
    private static final int NOTIFICATION_ID = 1001;
    private static final String PREFS_NAME = "chuanxun_prefs";
    private static final String KEY_PARTNER_NAME = "partnerName";

    // 保活续锁周期：每 1 分钟重新检查一次 WakeLock，缩短"锁被系统回收后到重新抢回"的空窗，
    // 尽量不给系统利用单次锁超时杀死后台 JS 的机会。锁用较短的 10 分钟超时，由上方循环持续续期。
    private static final long WAKELOCK_RENEW_INTERVAL_MS = 1 * 60 * 1000L;
    private static final long WAKELOCK_TIMEOUT_MS = 10 * 60 * 1000L;

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

        startForegroundCompat(notification);
        return START_STICKY;
    }

    /**
     * 按系统版本选择前台服务类型并提升为前台：
     * API 34+（Android 14+）用 specialUse —— 免除 Android 15+ 对 dataSync 的 6 小时强杀；
     * 更早版本用 dataSync 兼容。
     */
    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceCompat.startForeground(
                    this, NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            ServiceCompat.startForeground(
                    this, NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        }
    }

    /**
     * Android 15+（API 35）对非 specialUse 类型前台服务超时（默认 6h）后会回调这里。
     * 我们 API 34+ 已改用 specialUse 不会触发；此处兜底覆盖个别厂商/异常将类型解析为
     * dataSync 的情况——超时被杀后立即重排闹钟，并由闹钟拉起服务，尽量缩短保活空窗。
     */
    @TargetApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    @Override
    public void onTimeout(int startId) {
        Log.w("ForegroundService", "前台服务触发 onTimeout(超时)，重排定时唤醒兜底恢复");
        try {
            KeepAliveReceiver.scheduleNext(this);
            Intent restart = new Intent(this, ForegroundService.class);
            startForegroundService(restart);
        } catch (Exception e) {
            Log.w("ForegroundService", "onTimeout 恢复失败: " + e.getMessage());
        }
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
        // 服务被系统杀死后，重排定时唤醒，保证保活机制不被中断
        try {
            KeepAliveReceiver.scheduleNext(this);
            Log.i("ForegroundService", "服务销毁，已重排定时唤醒");
        } catch (Exception e) {
            Log.w("ForegroundService", "重排唤醒失败: " + e.getMessage());
        }
        super.onDestroy();
    }

    /**
     * 用户从最近任务中划掉 App 时，立即重启前台服务并重新调度定时唤醒，防止保活机制丢失
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        try {
            KeepAliveReceiver.scheduleNext(this);
            // 立即尝试重新拉起前台服务，降低被划掉后被系统回收的概率
            Intent restart = new Intent(this, ForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(restart);
            } else {
                startService(restart);
            }
            Log.i("ForegroundService", "任务被划掉，已重启服务并重排定时唤醒");
        } catch (Exception e) {
            Log.w("ForegroundService", "任务被划掉时重启服务受限(闹钟已重排): " + e.getMessage());
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