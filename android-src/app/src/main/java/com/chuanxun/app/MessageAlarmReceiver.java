package com.chuanxun.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * 到点弹消息通知的闹钟接收器。
 *
 * 背景：自动回复消息原本只靠 WebView 内的 setInterval 生成，可一旦应用进入后台，
 * WebView JS 可能被系统暂停，甚至进程被杀，导致"后台收不到消息、不弹通知"。
 * 本接收器把"下一条自动消息"作为一次 Android 闹钟原生预定：由 AlarmManager 负责
 * 准点到点弹出系统通知（即使 JS 暂停 / 进程被杀也能送达），点击通知打开 App 后，
 * 由 WebView 回到前台的补消息逻辑把真实消息写进聊天，实现"弹通知 + 聊天可见"。
 */
public class MessageAlarmReceiver extends BroadcastReceiver {
    private static final String TAG = "MessageAlarmReceiver";

    public static final String ACTION = "com.chuanxun.app.MESSAGE_ALARM";
    public static final int REQUEST_CODE = 889977;
    public static final int NOTIF_ID = 8823481;

    private static final String PREFS = "chuanxun_scheduled_msg";

    /**
     * 预定下一次消息通知。先取消旧的，再按给定时刻调度（替换式）。
     *
     * @param atMs       触发时间戳（毫秒）
     * @param intervalMs 触发后自动续下一次的间隔（毫秒）
     */
    public static void schedule(Context context, String title, String body, long atMs, long intervalMs) {
        try {
            SharedPreferences.Editor ed = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
            ed.putString("title", title);
            ed.putString("body", body);
            ed.putLong("nextAtMs", atMs);
            ed.putLong("intervalMs", intervalMs);
            ed.apply();

            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) return;

            Intent intent = new Intent(context, MessageAlarmReceiver.class);
            intent.setAction(ACTION);
            intent.putExtra("title", title);
            intent.putExtra("body", body);
            intent.putExtra("nextAtMs", atMs);
            intent.putExtra("intervalMs", intervalMs);
            PendingIntent pi = pendingIntent(context, intent);

            // 精确闹钟优先，权限被拒/受限时回退非精确，保证能到点唤醒
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi);
                } else {
                    alarmManager.setExact(AlarmManager.RTC_WAKEUP, atMs, pi);
                }
            } catch (SecurityException e) {
                Log.w(TAG, "精确闹钟受限，回退非精确: " + e.getMessage());
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi);
            }
            Log.i(TAG, "消息通知闹钟已预定: title=" + title + " at=" + atMs + " interval=" + intervalMs);
        } catch (Exception e) {
            Log.e(TAG, "预定消息通知失败: " + e.getMessage());
        }
    }

    /**
     * 取消已预定的消息通知，并清掉持久化配置（停止后台续闹钟链）。
     */
    public static void cancel(Context context) {
        try {
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager != null) {
                Intent intent = new Intent(context, MessageAlarmReceiver.class);
                intent.setAction(ACTION);
                alarmManager.cancel(pendingIntent(context, intent));
            }
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
            Log.i(TAG, "消息通知闹钟已取消");
        } catch (Exception e) {
            Log.e(TAG, "取消消息通知失败: " + e.getMessage());
        }
    }

    private static PendingIntent pendingIntent(Context context, Intent intent) {
        return PendingIntent.getBroadcast(
                context, REQUEST_CODE, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            String title = intent != null ? intent.getStringExtra("title") : null;
            String body = intent != null ? intent.getStringExtra("body") : null;
            long atMs = intent != null ? intent.getLongExtra("nextAtMs", 0L) : 0L;
            long intervalMs = intent != null ? intent.getLongExtra("intervalMs", 0L) : 0L;

            // 兜底：若 extras 缺失（例如系统恢复），从持久化配置读取
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (title == null) title = prefs.getString("title", "传讯");
            if (body == null) body = prefs.getString("body", "给你发来一条新消息");
            if (intervalMs <= 0) intervalMs = prefs.getLong("intervalMs", 5 * 60 * 1000L);

            // 自动续下一次（后台长时间也能持续收到），除非下一次时间落后于当前（说明已失联，交给前台 JS 掌控）
            long now = System.currentTimeMillis();
            long nextAt = Math.max(atMs + intervalMs, now + intervalMs);
            if (intervalMs > 0) {
                schedule(context, title, body, nextAt, intervalMs);
            }

            // 弹系统通知（复用 NotificationPlugin 的同名频道）
            postNotification(context, title, body);
        } catch (Exception e) {
            Log.e(TAG, "处理消息闹钟失败: " + e.getMessage());
        }
    }

    private void postNotification(Context context, String title, String body) {
        String channelId = "partner-messages";
        // 确保频道存在
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationPlugin.ensureChannel(context, channelId);
        }

        Intent appIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent contentIntent = null;
        if (appIntent != null) {
            appIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            contentIntent = PendingIntent.getActivity(
                    context, 0, appIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.drawable.ic_stat_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setVibrate(new long[]{0, 300, 200, 300})
                .setGroup("chuanxun-partner")
                .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_ALL)
                .setWhen(System.currentTimeMillis())
                .setOnlyAlertOnce(false);
        if (contentIntent != null) {
            builder.setContentIntent(contentIntent);
        }

        try {
            NotificationManagerCompat.from(context).notify(NOTIF_ID, builder.build());
            Log.i(TAG, "消息闹钟通知已弹出: " + title);
        } catch (SecurityException e) {
            Log.w(TAG, "通知权限未授予: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "弹出消息通知失败: " + e.getMessage());
        }
    }
}