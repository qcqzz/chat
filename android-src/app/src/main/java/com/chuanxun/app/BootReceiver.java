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
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        Log.i(TAG, "设备启动，恢复前台服务和定时唤醒");

        // 启动前台服务
        Intent serviceIntent = new Intent(context, ForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }

        // 启动定时唤醒
        KeepAliveReceiver.scheduleNext(context);
    }
}