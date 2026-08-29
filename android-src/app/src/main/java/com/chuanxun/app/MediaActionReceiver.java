package com.chuanxun.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * MediaActionReceiver — 系统通知栏媒体播放条按钮的点击接收器。
 * 收到"上一首/播放暂停/下一首"后，转交 MediaNotificationPlugin 回发事件给 JS。
 */
public class MediaActionReceiver extends BroadcastReceiver {

    private static final String TAG = "MediaActionReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!"com.chuanxun.app.MEDIA_ACTION".equals(action)) return;

        int code = intent.getIntExtra("action", MediaNotificationPlugin.ACTION_PLAY_PAUSE);
        Log.i(TAG, "收到媒体通知按钮: " + code);
        MediaNotificationPlugin.emitAction(code);
    }
}