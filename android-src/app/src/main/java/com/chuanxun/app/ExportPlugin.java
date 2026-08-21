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

/**
 * 导出插件：把 base64 内容（备份文件等）直接保存到手机「下载」目录，
 * 保存后手机文件管理器立即可见，无需再走分享面板手动选位置。
 *
 * - Android 10+（API 29+）：使用 MediaStore.Downloads 写入「Download/ChuanXun」，无需任何权限
 * - Android 9-（API ≤28）：先申请 WRITE_EXTERNAL_STORAGE，再写入公共下载目录「Download/ChuanXun」
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
                // 先删除同名文件，实现"覆盖导出"，避免重复文件堆积
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
            } catch (Exception e) {
                Log.e(TAG, "MediaStore save failed: " + e.getMessage(), e);
                getBridge().executeOnMainThread(() -> call.reject("Save failed: " + e.getMessage()));
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
            } catch (Exception e) {
                Log.e(TAG, "Legacy download save failed: " + e.getMessage(), e);
                getBridge().executeOnMainThread(() -> call.reject("Save failed: " + e.getMessage()));
            }
        }).start();
    }
}
