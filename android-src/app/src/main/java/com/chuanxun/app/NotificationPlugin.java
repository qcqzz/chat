package com.chuanxun.app;

import android.Manifest;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
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
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(
    name = "NotificationPlugin",
    permissions = {
        @Permission(alias = "notification", strings = {Manifest.permission.POST_NOTIFICATIONS})
    }
)
public class NotificationPlugin extends Plugin {

    private static final String CHANNEL_ID = "partner-messages";
    private static final String CHANNEL_NAME = "消息通知";
    private static final String CHANNEL_DESC = "对方发来消息时的系统通知";
    private static final String TAG = "NotificationPlugin";

    // 紧急来电/邀请的全屏通知自动收回超时：30 秒内用户未处理则自动收起，避免无限响铃打扰
    private static final long CALL_TIMEOUT_MS = 30_000L;

    /**
     * 创建/更新"消息通知"频道，供本插件与 MessageAlarmReceiver 复用。
     */
    public static void ensureChannel(Context context, String channelId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel existing = manager.getNotificationChannel(channelId);
            if (existing == null) {
                NotificationChannel channel = new NotificationChannel(
                    channelId,
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
                Log.i(TAG, "Notification channel created: " + channelId);
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
                Log.i(TAG, "Notification channel updated: " + channelId);
            }
        }
    }

    private void createChannel() {
        ensureChannel(getContext(), CHANNEL_ID);
    }

    /** 点击通知打开 App 的 PendingIntent（用消息 id 作 requestCode，避免互相覆盖）。 */
    private PendingIntent contentIntent(Context context, int id) {
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            context, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    /**
     * 构建系统通知。
     * - 长文本自动用 BigTextStyle，下拉/展开可看完整内容，避免被截断；
     * - sender 作为底部发件人小字，与左侧大图、标题形成完整联系人式通知；
     * - urgent（来电/邀请）用 PRIORITY_MAX + 全屏弹窗，普通消息用 PRIORITY_HIGH 横幅。
     */
    private NotificationCompat.Builder buildNotification(Context context, int id, String title, String body,
                                                         String sender, boolean urgent, Bitmap largeIcon, PendingIntent pi) {
        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(urgent ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_HIGH)
            .setCategory(urgent ? NotificationCompat.CATEGORY_CALL : NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setVibrate(urgent ? new long[]{0, 500, 300, 500, 300} : new long[]{0, 300, 200, 300})
            .setGroup("chuanxun-partner")
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_ALL)
            .setWhen(System.currentTimeMillis())
            .setOnlyAlertOnce(false)
            .setShowWhen(true);

        if (sender != null && !sender.isEmpty()) {
            b.setSubText(sender);      // 底部小字：发件人
            b.setContentInfo(sender);  // 右上角/紧凑时的发件人
        }
        if (largeIcon != null) b.setLargeIcon(largeIcon);

        // 长文本：用 BigTextStyle 展开，避免长消息在横幅里被截断成省略号
        if (body.length() > 80) {
            b.setStyle(new NotificationCompat.BigTextStyle()
                .bigText(body)
                .setBigContentTitle(title));
        }

        // 紧急来电/邀请：全屏弹窗打断用户（微信来电式），并带上自动收回超时
        if (urgent && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            b.setFullScreenIntent(pi, true);
            b.setTimeoutAfter(CALL_TIMEOUT_MS);
        }

        return b;
    }

    /** 从 URL 下载头像位图（失败返回 null，不影响通知主干）。 */
    private Bitmap loadBitmap(String urlStr) {
        if (urlStr == null || urlStr.isEmpty()) return null;
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.setInstanceFollowRedirects(true);
            conn.connect();
            if (conn.getResponseCode() == HttpURLConnection.HTTP_OK) {
                InputStream in = new BufferedInputStream(conn.getInputStream());
                Bitmap bmp = BitmapFactory.decodeStream(in);
                in.close();
                return bmp;
            }
        } catch (Exception e) {
            Log.w(TAG, "loadBitmap failed: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
        return null;
    }

    @PluginMethod
    public void send(PluginCall call) {
        String title = call.getString("title", "传讯");
        String body = call.getString("body", "");
        int id = call.getInt("id", (int) (System.currentTimeMillis() % Integer.MAX_VALUE));
        // urgent=true：视频邀请/来电等紧急场景，用 FullScreenIntent 弹全屏弹窗（类似微信来电）
        // urgent=false：普通聊天消息等，只用 Heads-up 横幅，几秒后自动收回（类似微信普通消息）
        boolean urgent = call.getBoolean("urgent", false);
        String sender = call.getString("sender", null);
        String avatar = call.getString("avatar", null);

        createChannel();

        Context context = getContext();
        PendingIntent pendingIntent = contentIntent(context, id);

        // 先发一版（可能无大图），保证横幅/弹窗第一时间弹出，绝不因加载头像而延迟
        NotificationCompat.Builder builder = buildNotification(context, id, title, body, sender, urgent, null, pendingIntent);

        try {
            NotificationManagerCompat.from(context).notify(id, builder.build());
            Log.i(TAG, "Notification sent: id=" + id + " urgent=" + urgent + " title=" + title);

            // 若提供了对方头像，后台线程加载成功后原地更新成大图头像（来电/播单联系人式更醒目）
            if (avatar != null && !avatar.isEmpty()) {
                final int fid = id;
                final String furi = avatar;
                new Thread(() -> {
                    Bitmap bmp = loadBitmap(furi);
                    if (bmp == null) return;
                    try {
                        NotificationCompat.Builder up = buildNotification(context, fid, title, body, sender, urgent, bmp, pendingIntent);
                        NotificationManagerCompat.from(context).notify(fid, up.build());
                        Log.i(TAG, "Notification large icon updated: id=" + fid);
                    } catch (Exception e) {
                        Log.w(TAG, "large icon update failed: " + e.getMessage());
                    }
                }).start();
            }

            call.resolve(new JSObject().put("success", true).put("id", id));
        } catch (SecurityException e) {
            Log.e(TAG, "Permission denied: " + e.getMessage());
            call.reject("Permission denied: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "Failed to send notification: " + e.getMessage());
            call.reject("Failed: " + e.getMessage());
        }
    }
