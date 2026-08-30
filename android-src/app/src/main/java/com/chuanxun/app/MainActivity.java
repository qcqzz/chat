package com.chuanxun.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;

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
        registerPlugin(ExportPlugin.class);
        registerPlugin(MediaNotificationPlugin.class);
        super.onCreate(savedInstanceState);

        // 覆盖 WebChromeClient，直接放行 WebView 的麦克风/摄像头权限请求。
        // Capacitor 默认用异步权限 launcher，系统权限已授予时仍可能拒绝 getUserMedia，
        // 导致语音"按住说话"一直提示权限被拒绝。这里在已持有权限时同步 grant，
        // 尚未授权时回退到 Capacitor 默认的运行时授权弹窗。
        try {
            Bridge bridge = getBridge();
            if (bridge != null && bridge.getWebView() != null) {
                // 保护 WebView 渲染进程：声明"重要"优先级且后台不豁免，
                // 配合前台服务避免系统在后台/内存紧张时回收渲染进程——渲染进程一旦被杀，
                // 页面 JS 冻结，后台保活（静音音频 + 回复定时器）全部失效。
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    try {
                        bridge.getWebView().setRendererPriorityPolicy(
                                android.webkit.WebView.RENDERER_PRIORITY_IMPORTANT, false);
                    } catch (Exception rpE) {
                        android.util.Log.w("MainActivity", "设置渲染进程优先级失败: " + rpE.getMessage());
                    }
                }
                // 混合内容放行：App 用 https 原生 scheme 加载，而网易云等"外链音乐"的 CDN 最终
                // 是 http:// 地址（music.163.com outer 链接 302 到 http://m*.music.126.net）。若不放开，
                // https 页面请求 http 音频会被 WebView 当 Mixed Content 直接拦截，导致导入的歌曲在
                // 手机里能下、非 VIP、CORS 全开却依然"无法播放"。这里放行混合内容解决该问题。
                bridge.getWebView().getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
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

        // 启动前台服务保活。
        // 注意：startForegroundService() 后必须在 5 秒内调用 startForeground()，
        // 否则系统抛 ForegroundServiceDidNotStartInTimeException 崩溃。此处整体包一层防御，
        // 个别厂商或深度后台限制前台服务启动时，后台保活会退化为由 KeepAliveReceiver 的
        // 定时唤醒 + 前端静音音频自播兜底，绝不因启动失败拖垮整个 App。
        try {
            Intent serviceIntent = new Intent(this, ForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception e) {
            // 前台服务启动被系统/厂商拒绝：仅记录日志，不影响主流程。
            android.util.Log.w("MainActivity", "启动前台服务受限: " + e.getMessage());
        }
    }
}