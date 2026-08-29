package com.chuanxun.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * 开机自启动接收器 — 设备重启后自动恢复前台服务和定时唤醒
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        // 正常开机 / 厂商快速开机 / App 升级完成后，都恢复前台服务与定时唤醒
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                && !"com.htc.intent.action.QUICKBOOT_POWERON".equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }
        Log.i(TAG, "收到恢复事件(" + action + ")，恢复前台服务和定时唤醒");

        // 启动前台服务（BOOT_COMPLETED/升级等场景系统允许，但个别厂商或深度后台可能受限，
        // 单独包一层防御，避免广播线程抛未捕获异常导致崩溃）
        try {
            Intent serviceIntent = new Intent(context, ForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        } catch (Exception e) {
            Log.w(TAG, "启动前台服务受限(仅续闹钟): " + e.getMessage());
        }

        // 启动定时唤醒
        try {
            KeepAliveReceiver.scheduleNext(context);
        } catch (Exception e) {
            Log.e(TAG, "续调闹钟失败: " + e.getMessage());
        }

        // 恢复"后台预定消息通知"闹钟：如果设备重启前已预定过下一条消息，则按原时刻重新调度；
        // 若原时刻已过期（关机期间到达），则顺延一个间隔，避免开机后一次也不弹。
        try {
            android.content.SharedPreferences prefs =
                    context.getSharedPreferences("chuanxun_scheduled_msg", Context.MODE_PRIVATE);
            if (prefs.contains("nextAtMs")) {
                String title = prefs.getString("title", "传讯");
                String body = prefs.getString("body", "给你发来一条新消息");
                long intervalMs = prefs.getLong("intervalMs", 5 * 60 * 1000L);
                long nextAtMs = prefs.getLong("nextAtMs", 0L);
                if (nextAtMs > 0) {
                    if (nextAtMs <= System.currentTimeMillis()) {
                        nextAtMs = System.currentTimeMillis() + intervalMs;
                    }
                    MessageAlarmReceiver.schedule(context, title, body, nextAtMs, intervalMs);
                    Log.i(TAG, "已恢复后台消息通知闹钟: at=" + nextAtMs);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "恢复消息通知闹钟失败: " + e.getMessage());
        }
    }
}