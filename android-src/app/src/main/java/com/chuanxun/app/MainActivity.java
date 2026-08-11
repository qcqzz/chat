package com.chuanxun.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // registerPlugin 必须在 super.onCreate() 之前调用（Capacitor 8 要求）
        registerPlugin(ForegroundPlugin.class);
        registerPlugin(NotificationPlugin.class);
        super.onCreate(savedInstanceState);

        // 启动前台服务保活
        Intent serviceIntent = new Intent(this, ForegroundService.class);
        startForegroundService(serviceIntent);
    }
}
