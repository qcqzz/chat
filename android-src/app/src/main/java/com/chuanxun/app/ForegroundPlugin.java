package com.chuanxun.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Foreground")
public class ForegroundPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String partnerName = call.getString("partnerName", "对方");
        Intent serviceIntent = new Intent(getContext(), ForegroundService.class);
        serviceIntent.putExtra("partnerName", partnerName);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(serviceIntent);
        } else {
            getContext().startService(serviceIntent);
        }

        // 启动定时唤醒
        KeepAliveReceiver.scheduleNext(getContext());

        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent serviceIntent = new Intent(getContext(), ForegroundService.class);
        getContext().stopService(serviceIntent);
        // 取消定时唤醒
        KeepAliveReceiver.cancel(getContext());
        call.resolve();
    }

    @PluginMethod
    public void updateNotification(PluginCall call) {
        String partnerName = call.getString("partnerName", "对方");
        Intent updateIntent = new Intent(getContext(), ForegroundService.class);
        updateIntent.setAction("UPDATE_NOTIFICATION");
        updateIntent.putExtra("partnerName", partnerName);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(updateIntent);
        } else {
            getContext().startService(updateIntent);
        }
        call.resolve();
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", true);
        call.resolve(ret);
    }

    /**
     * 请求忽略电池优化（免除 Doze 限制）
     * 返回 true 表示已在白名单，false 表示需要用户手动操作
     */
    @PluginMethod
    public void requestBatteryOptimization(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(PowerManager.class);
            if (pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName())) {
                JSObject ret = new JSObject();
                ret.put("alreadyGranted", true);
                ret.put("needAction", false);
                call.resolve(ret);
                return;
            }

            // 引导用户打开电池优化设置页
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                getContext().startActivity(intent);
                JSObject ret = new JSObject();
                ret.put("alreadyGranted", false);
                ret.put("needAction", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("无法打开电池优化设置");
            }
        } else {
            JSObject ret = new JSObject();
            ret.put("alreadyGranted", true);
            ret.put("needAction", false);
            call.resolve(ret);
        }
    }

    /**
     * 检查是否已忽略电池优化
     */
    @PluginMethod
    public void isBatteryOptimized(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(PowerManager.class);
            if (pm != null) {
                JSObject ret = new JSObject();
                ret.put("ignored", pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
                call.resolve(ret);
                return;
            }
        }
        JSObject ret = new JSObject();
        ret.put("ignored", true);
        call.resolve(ret);
    }
}