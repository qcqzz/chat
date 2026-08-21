package com.chuanxun.app;

import android.Manifest;
import android.media.MediaRecorder;
import android.util.Base64;

import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;

/**
 * 原生语音录音插件。
 * 使用 android.media.MediaRecorder 直接录制麦克风，彻底绕开 WebView getUserMedia
 * 在部分设备上权限回调被拒导致「无法使用麦克风」的问题。停止后以 base64 回传前端，
 * 前端拼成 data URL 复用既有语音气泡（<audio>）播放。
 */
@CapacitorPlugin(
    name = "VoiceRecorder",
    permissions = {
        @Permission(alias = "recording", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class VoiceRecorderPlugin extends Plugin {

    private MediaRecorder recorder;
    private File outputFile;
    private long startTimeMs;

    /**
     * 开始录音。首次调用会请求麦克风权限。
     */
    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("recording") != PermissionState.GRANTED) {
            requestPermissionForAlias("recording", call, "startPermissionCallback");
        } else {
            startRecorder(call);
        }
    }

    @PermissionCallback
    private void startPermissionCallback(PluginCall call) {
        if (getPermissionState("recording") == PermissionState.GRANTED) {
            startRecorder(call);
        } else {
            call.reject("麦克风权限被拒绝");
        }
    }

    private void startRecorder(PluginCall call) {
        try {
            releaseRecorder();
            String dir = getContext().getCacheDir().getAbsolutePath();
            outputFile = new File(dir, "voice_temp_" + System.currentTimeMillis() + ".m4a");
            MediaRecorder r = new MediaRecorder();
            r.setAudioSource(MediaRecorder.AudioSource.MIC);
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            r.setAudioSamplingRate(44100);
            r.setAudioEncodingBitRate(96000);
            r.setOutputFile(outputFile.getAbsolutePath());
            r.prepare();
            r.start();
            recorder = r;
            startTimeMs = System.currentTimeMillis();
            call.resolve();
        } catch (Exception e) {
            releaseRecorder();
            call.reject("无法获取麦克风：" + (e.getMessage() == null ? e.toString() : e.getMessage()));
        }
    }

    /**
     * 停止录音，读取文件并返回 { base64, mimeType, duration }。
     */
    @PluginMethod
    public void stop(PluginCall call) {
        MediaRecorder r = recorder;
        File file = outputFile;
        if (r == null) {
            call.reject("尚未开始录音");
            return;
        }
        long durationMs = System.currentTimeMillis() - startTimeMs;
        try {
            r.stop();
        } catch (Exception ignored) {
            // 录音过短或异常时 stop 可能抛 RuntimeException，忽略并继续读文件
        } finally {
            releaseRecorder();
        }
        try {
            String base64 = fileToBase64(file);
            JSObject ret = new JSObject();
            ret.put("base64", base64);
            ret.put("mimeType", "audio/mp4");
            ret.put("duration", Math.round(durationMs / 1000.0));
            if (file != null && file.exists()) file.delete();
            call.resolve(ret);
        } catch (Exception e) {
            if (file != null && file.exists()) file.delete();
            call.reject("读取录音失败：" + (e.getMessage() == null ? e.toString() : e.getMessage()));
        }
    }

    /**
     * 放弃本次录音（上滑取消 / 时长过短），不返回录音数据。
     */
    @PluginMethod
    public void cancel(PluginCall call) {
        releaseRecorder();
        call.resolve();
    }

    private void releaseRecorder() {
        if (recorder != null) {
            try { recorder.reset(); } catch (Exception ignored) {}
            try { recorder.release(); } catch (Exception ignored) {}
            recorder = null;
        }
    }

    private String fileToBase64(File file) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        FileInputStream in = new FileInputStream(file);
        byte[] buf = new byte[8192];
        int n;
        try {
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
        } finally {
            in.close();
        }
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }
}