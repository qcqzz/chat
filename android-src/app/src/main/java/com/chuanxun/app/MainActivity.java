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

        // 消除启动白屏：窗口与 WebView 背景统一为深色（与网页开屏 --welcome-bg 保持一致）
        try {
            android.graphics.drawable.ColorDrawable dark =
                    new android.graphics.drawable.ColorDrawable(0xFF0A0A12);
            getWindow().setBackgroundDrawable(dark);
            android.view.View decor = getWindow().getDecorView();
            if (decor != null) decor.setBackgroundColor(0xFF0A0A12);
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().setBackgroundColor(0xFF0A0A12);
            }
        } catch (Throwable ignore) {
        }
    }
}
