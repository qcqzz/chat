package com.chuanxun.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

/**
 * 极轻量级前台保活宿主。
 * 主题 NoDisplay、没有窗口、完全不可见；excludeFromRecents + noHistory，不污染最近任务。
 * 仅用于"任务被划掉"的瞬时窗口：配合前台服务把本 App 的 task 维持一瞬"前台身份"，
 * 避免系统刚划掉就立刻回收 WebView 渲染进程/重置后台会话；随后自动 finish 释放，
 * 长期不驻留、不打扰用户正在使用的其他 App。
 */
public class KeepAliveActivity extends Activity {

    private static final long HOLD_MS = 1500L;

    public static void start(Context context) {
        try {
            Intent i = new Intent(context, KeepAliveActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(i);
        } catch (Exception e) {
            Log.w("KeepAlive", "后台拉起保活宿主受限(已由服务重启兜底): " + e.getMessage());
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 短暂维持前台身份后立即释放，不长期驻留
        if (getWindow() != null && getWindow().getDecorView() != null) {
            getWindow().getDecorView().postDelayed(new Runnable() {
                @Override
                public void run() {
                    try { KeepAliveActivity.this.finish(); } catch (Exception ignored) {}
                }
            }, HOLD_MS);
        } else {
            finish();
        }
    }
}