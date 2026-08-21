package com.chuanxun.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // registerPlugin 必须在 super.onCreate() 之前调用（Capacitor 8 要求）
        registerPlugin(ForegroundPlugin.class);
        registerPlugin(NotificationPlugin.class);
        registerPlugin(VoiceRecorderPlugin.class);
        super.onCreate(savedInstanceState);

        // 覆盖 WebChromeClient，直接放行 WebView 的麦克风/摄像头权限请求。
        // Capacitor 默认用异步权限 launcher，系统权限已授予时仍可能拒绝 getUserMedia，
        // 导致语音"按住说话"一直提示权限被拒绝。这里在已持有权限时同步 grant，
        // 尚未授权时回退到 Capacitor 默认的运行时授权弹窗。
        try {
            Bridge bridge = getBridge();
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
                    @Override
                    public void onPermissionRequest(final PermissionRequest request) {
                        for (String resource : request.getResources()) {
                            if ("android.webkit.resource.AUDIO_CAPTURE".equals(resource)) {
                                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                                    super.onPermissionRequest(request);
                                    return;
                                }
                            } else if ("android.webkit.resource.VIDEO_CAPTURE".equals(resource)) {
                                if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                                    super.onPermissionRequest(request);
                                    return;
                                }
                            }
                        }
                        request.grant(request.getResources());
                    }
                });
            }
        } catch (Exception ignored) {
            // 若桥尚未就绪，回退到默认行为，不阻塞启动
        }

        // 启动前台服务保活
        Intent serviceIntent = new Intent(this, ForegroundService.class);
        startForegroundService(serviceIntent);
    }
}