package com.chuanxun.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;

/**
 * 定时唤醒接收器 — 确保 App 在熄屏/Doze 模式下也能被唤醒
 * 每 5 分钟触发一次，检查是否有待处理消息并发送通知
 */
public class KeepAliveReceiver extends BroadcastReceiver {
    private static final String TAG = "KeepAliveReceiver";
    private static final String ACTION_KEEP_ALIVE = "com.chuanxun.app.KEEP_ALIVE";
    private static final long INTERVAL_MS = 5 * 60 * 1000; // 5 分钟

    @Override
    public void onReceive(Context context, Intent intent) {
        Log.i(TAG, "定时唤醒触发");

        // 获取短暂 WakeLock 确保 CPU 不立即休眠
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wl = null;
        if (pm != null) {
            wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "chuanxun::keepalive");
            wl.acquire(10 * 1000L); // 10 秒
        }

        try {
            // 启动前台服务（如果未运行），确保 WebView 保持活跃
            Intent serviceIntent = new Intent(context, ForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }

            // 重新调度下一次唤醒
            scheduleNext(context);
        } catch (Exception e) {
            Log.e(TAG, "唤醒处理失败: " + e.getMessage());
        } finally {
            if (wl != null && wl.isHeld()) {
                try { wl.release(); } catch (Exception e) {}
            }
        }
    }

    /**
     * 调度下一次定时唤醒（使用 setExactAndAllowWhileIdle 确保 Doze 模式下也能唤醒）
     */
    public static void scheduleNext(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        Intent intent = new Intent(context, KeepAliveReceiver.class);
        intent.setAction(ACTION_KEEP_ALIVE);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        long triggerAt = System.currentTimeMillis() + INTERVAL_MS;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent
                );
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
            } else {
                alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
            }
            Log.i(TAG, "下次唤醒已调度: " + triggerAt);
        } catch (Exception e) {
            Log.e(TAG, "调度唤醒失败: " + e.getMessage());
        }
    }

    /**
     * 取消所有定时唤醒
     */
    public static void cancel(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        Intent intent = new Intent(context, KeepAliveReceiver.class);
        intent.setAction(ACTION_KEEP_ALIVE);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        alarmManager.cancel(pendingIntent);
        Log.i(TAG, "定时唤醒已取消");
    }
}