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
    private static final String ACTION_KEEP_ALIVE_BACKUP = "com.chuanxun.app.KEEP_ALIVE_BACKUP";
    private static final long INTERVAL_MS = 5 * 60 * 1000; // 5 分钟

    @Override
    public void onReceive(Context context, Intent intent) {
        Log.i(TAG, "定时唤醒触发: " + (intent != null ? intent.getAction() : "null"));

        // 获取短暂 WakeLock 确保 CPU 不立即休眠。
        // 单独包一层保护：个别厂商/低内存场景下 newWakeLock 或 acquire 可能抛异常，
        // 这里绝不因取锁失败拖垮广播线程，导致下方续闹钟自愈链也被打断。
        PowerManager.WakeLock wl = null;
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "chuanxun::keepalive");
                wl.acquire(10 * 1000L); // 10 秒
            }
        } catch (Exception wlE) {
            Log.w(TAG, "获取 WakeLock 失败(忽略，仅尽力续闹钟): " + wlE.getMessage());
        }

        try {
            // 启动前台服务（如果未运行），确保 WebView 保持活跃。
            // 注意：Android 12+ 在深度后台（没有可见 Activity）时 startForegroundService()
            // 会抛 ForegroundServiceStartNotAllowedException。这里单独捕获，避免它中断下方
            // 的闹钟自愈调度——一次失败的拉起绝不能让整个保活链断裂。
            try {
                Intent serviceIntent = new Intent(context, ForegroundService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent);
                } else {
                    context.startService(serviceIntent);
                }
            } catch (Exception se) {
                Log.w(TAG, "后台拉起前台服务受限(忽略，仅续闹钟): " + se.getMessage());
            }

            // 重新调度下一次唤醒（主 + 后备）——无论服务是否启动成功都必须续上，
            // 否则 Android 后台限制会让保活闹钟链断裂，之后系统不再定时唤醒，收不到消息。
            try {
                scheduleNext(context);
            } catch (Exception e) {
                Log.e(TAG, "续调闹钟失败: " + e.getMessage());
            }
        } finally {
            if (wl != null && wl.isHeld()) {
                try { wl.release(); } catch (Exception e) {}
            }
        }
    }

    /**
     * 调度下一次定时唤醒。
     * 主闹钟：精确可用则用 setExactAndAllowWhileIdle，被拒则自动回退非精确；
     * 后备闹钟：错开 60 秒走非精确（无需权限），抵御厂商/Doze 下精确闹钟被丢弃。
     * 两个闹钟任何一个触发都会重新调度双方，形成自愈闭环。
     */
    public static void scheduleNext(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        long triggerAt = System.currentTimeMillis() + INTERVAL_MS;
        // 主闹钟
        scheduleOne(context, alarmManager, ACTION_KEEP_ALIVE, 0, triggerAt);
        // 后备闹钟（错开 60 秒）
        scheduleOne(context, alarmManager, ACTION_KEEP_ALIVE_BACKUP, 1, triggerAt + 60 * 1000L);
        Log.i(TAG, "保活闹钟已调度(主+60s后备): " + triggerAt);
    }

    private static void scheduleOne(Context context, AlarmManager alarmManager,
                                    String action, int requestCode, long triggerAt) {
        try {
            Intent intent = new Intent(context, KeepAliveReceiver.class);
            intent.setAction(action);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                    context, requestCode, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            // Android 12+ 精确闹钟需要权限，未授权时使用非精确仍然能唤醒
            boolean canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                    || alarmManager.canScheduleExactAlarms();
            if (canExact && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
            } else {
                alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
            }
        } catch (SecurityException e) {
            // 精确闹钟权限被拒：回退到非精确，保活不中断
            try {
                Intent intent = new Intent(context, KeepAliveReceiver.class);
                intent.setAction(action);
                PendingIntent pendingIntent = PendingIntent.getBroadcast(
                        context, requestCode, intent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
                Log.w(TAG, "精确闹钟受限，已回退非精确: " + action);
            } catch (Exception e2) {
                Log.e(TAG, "调度" + action + "失败: " + e2.getMessage());
            }
        } catch (Exception e) {
            Log.e(TAG, "调度" + action + "失败: " + e.getMessage());
        }
    }

    /**
     * 取消所有定时唤醒（主 + 后备）
     */
    public static void cancel(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        cancelOne(context, alarmManager, ACTION_KEEP_ALIVE, 0);
        cancelOne(context, alarmManager, ACTION_KEEP_ALIVE_BACKUP, 1);
        Log.i(TAG, "定时唤醒已取消");
    }

    private static void cancelOne(Context context, AlarmManager alarmManager,
                                  String action, int requestCode) {
        try {
            Intent intent = new Intent(context, KeepAliveReceiver.class);
            intent.setAction(action);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                    context, requestCode, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            alarmManager.cancel(pendingIntent);
        } catch (Exception e) {
            Log.e(TAG, "取消失败: " + e.getMessage());
        }
    }
}