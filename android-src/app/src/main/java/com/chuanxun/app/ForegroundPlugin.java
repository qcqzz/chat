package com.chuanxun.app;

import android.content.Intent;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Foreground")
public class ForegroundPlugin extends Plugin {

    private ForegroundService getService() {
        // Not directly accessible, but we can use the context
        return null;
    }

    @PluginMethod
    public void start(PluginCall call) {
        String partnerName = call.getString("partnerName", "对方");
        Intent serviceIntent = new Intent(getContext(), ForegroundService.class);
        serviceIntent.putExtra("partnerName", partnerName);
        getContext().startForegroundService(serviceIntent);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent serviceIntent = new Intent(getContext(), ForegroundService.class);
        getContext().stopService(serviceIntent);
        call.resolve();
    }

    @PluginMethod
    public void updateNotification(PluginCall call) {
        String partnerName = call.getString("partnerName", "对方");
        // 通过 Intent 更新前台通知文字
        Intent updateIntent = new Intent(getContext(), ForegroundService.class);
        updateIntent.setAction("UPDATE_NOTIFICATION");
        updateIntent.putExtra("partnerName", partnerName);
        getContext().startService(updateIntent);
        call.resolve();
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", true);
        call.resolve(ret);
    }
}