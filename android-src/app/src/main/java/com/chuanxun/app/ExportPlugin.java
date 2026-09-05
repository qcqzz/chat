package com.chuanxun.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 导出插件：把备份文件直接保存到手机「下载」目录，保存后手机文件管理器立即可见。
 *
 * - Android 10+（API 29+）：使用 MediaStore.Downloads 写入「Download/ChuanXun」，无需任何权限
 * - Android 9-（API ≤28）：先申请 WRITE_EXTERNAL_STORAGE，再写入公共下载目录「Download/ChuanXun」
 *
 * 内存安全说明：
 * 早期 saveBase64 把整份 base64 一次性 decode 成 byte[] 再整写，WebView 里前端也会先把整个
 * Blob 一次性转成 dataURL——备份越大，内存峰值越高，在部分机型（尤其 Android 15 低内存机）会
 * 直接 OOM 闪退。因此新增 openSave / writeChunk / finishSave / abortSave 四步分块流式写入：
 * 前端把文件切成小块逐块上传，Native 端边收边写，全程峰值内存恒定（≈一块大小），彻底消除闪退。
 */
@CapacitorPlugin(
    name = "ExportPlugin",
    permissions = {
        @Permission(alias = "storage", strings = {Manifest.permission.WRITE_EXTERNAL_STORAGE})
    }
)
public class ExportPlugin extends Plugin {

    private static final String TAG = "ExportPlugin";
    private static final String FOLDER = "ChuanXun";

    // 分块流式保存：token -> 已打开的 OutputStream / Uri
    private static final Map<String, OutputStream> openStreams = new HashMap<>();
    private static final Map<String, Uri> openUris = new HashMap<>();

    /** 兼容旧用法（一次性整写，新前端优先用分块流式）。仍保留 catch(Throwable) 防止 OOM 闪退。 */
    @PluginMethod
    public void saveBase64(PluginCall call) {
        String data = call.getString("data");
        String fileName = call.getString("fileName", "chatapp-backup.json");
        String mimeType = call.getString("mimeType", "application/octet-stream");

        if (data == null || data.isEmpty()) {
            call.reject("data is required");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveViaMediaStore(data, fileName, mimeType, call);
        } else {
            // Android 9- 需要 WRITE_EXTERNAL_STORAGE 运行时权限
            if (getContext().checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    == PackageManager.PERMISSION_GRANTED) {
                saveToLegacyDownload(data, fileName, mimeType, call);
            } else {
                requestPermissionForAlias("storage", call, "storagePermissionCallback");
            }
        }
    }

    // ==== 分块流式保存三步曲 ====

    /** 打开一个新输出目标，返回 token。 */
    @PluginMethod
    public void openSave(PluginCall call) {
        final String fileName = call.getString("fileName", "chatapp-backup.json");
        final String mimeType = call.getString("mimeType", "application/octet-stream");
        new Thread(() -> {
            try {
                OutputStream os;
                Uri uri = null;
                ContentResolver resolver = getContext().getContentResolver();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    // 先删除同名文件，实现"覆盖导出"，避免重复文件堆积
                    deleteExisting(resolver, fileName);
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                            Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER);
                    uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) throw new Exception("MediaStore insert returned null");
                    os = resolver.openOutputStream(uri);
                } else {
                    // Android 9- 需要写权限；未授权则直接失败，前端会回退到分享面板
                    if (getContext().checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                            != PackageManager.PERMISSION_GRANTED) {
                        throw new Exception("WRITE_EXTERNAL_STORAGE not granted");
                    }
                    File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    File dir = new File(downloads, FOLDER);
                    if (!dir.exists() && !dir.mkdirs()) {
                        throw new Exception("Failed to create directory: " + dir.getAbsolutePath());
                    }
                    os = new FileOutputStream(new File(dir, fileName));
                }
                if (os == null) throw new Exception("Failed to open output stream");

                String token = UUID.randomUUID().toString();
                synchronized (openStreams) {
                    openStreams.put(token, os);
                    if (uri != null) openUris.put(token, uri);
                }
                JSObject result = new JSObject();
                result.put("token", token);
                result.put("success", true);
                getBridge().executeOnMainThread(() -> call.resolve(result));
            } catch (Throwable t) {
                Log.e(TAG, "openSave failed: " + t.getMessage(), t);
                final String msg = "Open failed: " + t.getMessage();
                getBridge().executeOnMainThread(() -> call.reject(msg));
            }
        }).start();
    }

    /** 写一小块 base64 数据到已打开的流。 */
    @PluginMethod
    public void writeChunk(PluginCall call) {
        final String token = call.getString("token");
        final String data = call.getString("data");
        new Thread(() -> {
            OutputStream os;
            synchronized (openStreams) { os = token == null ? null : openStreams.get(token); }
            if (os == null) {
                getBridge().executeOnMainThread(() -> call.reject("no open stream for token"));
                return;
            }
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                os.write(bytes);
                JSObject r = new JSObject();
                r.put("ok", true);
                getBridge().executeOnMainThread(() -> call.resolve(r));
            } catch (Throwable t) {
                Log.e(TAG, "writeChunk failed: " + t.getMessage(), t);
                final String msg = "Write failed: " + t.getMessage();
                getBridge().executeOnMainThread(() -> call.reject(msg));
            }
        }).start();
    }

    /** 完成写入：flush + close + 释放 token。 */
    @PluginMethod
    public void finishSave(PluginCall call) {
        final String token = call.getString("token");
        new Thread(() -> {
            try {
                OutputStream os;
                synchronized (openStreams) {
                    os = token == null ? null : openStreams.remove(token);
                    if (token != null) openUris.remove(token);
                }
                if (os != null) { os.flush(); os.close(); }
                JSObject r = new JSObject();
                r.put("success", true);
                getBridge().executeOnMainThread(() -> call.resolve(r));
            } catch (Throwable t) {
                Log.e(TAG, "finishSave failed: " + t.getMessage(), t);
                final String msg = "Finish failed: " + t.getMessage();
                getBridge().executeOnMainThread(() -> call.reject(msg));
            }
        }).start();
    }

    /** 出错时中止：关闭流并删除已写入的半成品。 */
    @PluginMethod
    public void abortSave(PluginCall call) {
        final String token = call.getString("token");
        new Thread(() -> {
            try {
                OutputStream os;
                Uri uri = null;
                synchronized (openStreams) {
                    os = token == null ? null : openStreams.remove(token);
                    if (token != null) uri = openUris.remove(token);
                }
                if (os != null) {
                    try { os.close(); } catch (Throwable ignored) {}
                }
                if (uri != null) {
                    try { getContext().getContentResolver().delete(uri, null, null); } catch (Throwable ignored) {}
                }
                JSObject r = new JSObject();
                r.put("ok", true);
                getBridge().executeOnMainThread(() -> call.resolve(r));
            } catch (Throwable t) {
                getBridge().executeOnMainThread(() -> call.reject("Abort failed"));
            }
        }).start();
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (getContext().checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED) {
            String data = call.getString("data");
            String fileName = call.getString("fileName", "chatapp-backup.json");
            String mimeType = call.getString("mimeType", "application/octet-stream");
            saveToLegacyDownload(data, fileName, mimeType, call);
        } else {
            call.reject("WRITE_EXTERNAL_STORAGE permission denied");
        }
    }

    private void saveViaMediaStore(String data, String fileName, String mimeType, PluginCall call) {
        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                ContentResolver resolver = getContext().getContentResolver();
                deleteExisting(resolver, fileName);
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                        Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER);
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    throw new Exception("MediaStore insert returned null");
                }
                try (OutputStream os = resolver.openOutputStream(uri)) {
                    os.write(bytes);
                    os.flush();
                }
                JSObject result = new JSObject();
                result.put("success", true);
                result.put("uri", uri.toString());
                result.put("fileName", fileName);
                result.put("folder", "Download/" + FOLDER);
                getBridge().executeOnMainThread(() -> call.resolve(result));
            } catch (Throwable t) {
                Log.e(TAG, "MediaStore save failed: " + t.getMessage(), t);
                getBridge().executeOnMainThread(() -> call.reject("Save failed: " + t.getMessage()));
            }
        }).start();
    }

    private void deleteExisting(ContentResolver resolver, String fileName) {
        try {
            resolver.delete(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                MediaStore.MediaColumns.DISPLAY_NAME + "=?",
                new String[]{fileName}
            );
        } catch (Exception ignored) {
            // 删除失败不阻塞导出
        }
    }

    private void saveToLegacyDownload(String data, String fileName, String mimeType, PluginCall call) {
        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File dir = new File(downloads, FOLDER);
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new Exception("Failed to create directory: " + dir.getAbsolutePath());
                }
                File outFile = new File(dir, fileName);
                if (outFile.exists() && !outFile.delete()) {
                    // 无法删除旧文件时直接覆盖写入
                }
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(bytes);
                    fos.flush();
                }
                JSObject result = new JSObject();
                result.put("success", true);
                result.put("path", outFile.getAbsolutePath());
                result.put("fileName", fileName);
                result.put("folder", "Download/" + FOLDER);
                getBridge().executeOnMainThread(() -> call.resolve(result));
            } catch (Throwable t) {
                Log.e(TAG, "Legacy download save failed: " + t.getMessage(), t);
                getBridge().executeOnMainThread(() -> call.reject("Save failed: " + t.getMessage()));
            }
        }).start();
    }
}