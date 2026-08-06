package com.chuanxun.app;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Foreground")
public class ForegroundPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Intent serviceIntent = new Intent(getContext(), ForegroundService.class);
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
    public void isRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", true);
        call.resolve(ret);
    }
}