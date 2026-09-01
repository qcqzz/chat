package com.chuanxun.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Foreground")
public class ForegroundPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String partnerName = call.getString("partnerName", "对方");
        Intent serviceIntent = new Intent(getContext(), ForegroundService.class);
        serviceIntent.putExtra("partnerName", partnerName);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(serviceIntent);
        } else {
            getContext().startService(serviceIntent);
        }

        // 启动定时唤醒
        KeepAliveReceiver.scheduleNext(getContext());

        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent serviceIntent = new Intent(getContext(), ForegroundService.class);
        getContext().stopService(serviceIntent);
        // 取消定时唤醒
        KeepAliveReceiver.cancel(getContext());
        call.resolve();
    }

    @PluginMethod
    public void updateNotification(PluginCall call) {
        String partnerName = call.getString("partnerName", "对方");
        Intent updateIntent = new Intent(getContext(), ForegroundService.class);
        updateIntent.setAction("UPDATE_NOTIFICATION");
        updateIntent.putExtra("partnerName", partnerName);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(updateIntent);
        } else {
            getContext().startService(updateIntent);
        }
        call.resolve();
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", true);
        call.resolve(ret);
    }

    /**
     * 请求忽略电池优化（免除 Doze 限制）
     * 返回 true 表示已在白名单，false 表示需要用户手动操作
     */
    @PluginMethod
    public void requestBatteryOptimization(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(PowerManager.class);
            if (pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName())) {
                JSObject ret = new JSObject();
                ret.put("alreadyGranted", true);
                ret.put("needAction", false);
                call.resolve(ret);
                return;
            }

            // 引导用户打开电池优化设置页
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                getContext().startActivity(intent);
                JSObject ret = new JSObject();
                ret.put("alreadyGranted", false);
                ret.put("needAction", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("无法打开电池优化设置");
            }
        } else {
            JSObject ret = new JSObject();
            ret.put("alreadyGranted", true);
            ret.put("needAction", false);
            call.resolve(ret);
        }
    }

    /**
     * 检查是否已忽略电池优化
     */
    @PluginMethod
    public void isBatteryOptimized(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(PowerManager.class);
            if (pm != null) {
                JSObject ret = new JSObject();
                ret.put("ignored", pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
                call.resolve(ret);
                return;
            }
        }
        JSObject ret = new JSObject();
        ret.put("ignored", true);
        call.resolve(ret);
    }

    /**
     * 是否已授予悬浮窗权限。Android 12+ 持有悬浮窗可豁免后台启动前台服务限制，
     * 能显著提升"进程被系统/厂商回收后重新拉起保活服务"的成功率。
     */
    @PluginMethod
    public void isOverlayEnabled(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", Settings.canDrawOverlays(getContext()));
        call.resolve(ret);
    }

    /**
     * 引导开启悬浮窗权限（Android M+）。仅作为"增强后台启动成功率"的可选项，
     * 不强制用户开启，未开启也不影响保活主链路。
     */
    @PluginMethod
    public void requestOverlay(PluginCall call) {
        Context ctx = getContext();
        if (Settings.canDrawOverlays(ctx)) {
            JSObject ret = new JSObject();
            ret.put("alreadyGranted", true);
            ret.put("needAction", false);
            call.resolve(ret);
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("alreadyGranted", false);
            ret.put("needAction", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("无法打开悬浮窗权限设置");
        }
    }

    /** 归一化厂商名，供前端展示对应引导文案。 */
    @PluginMethod
    public void getManufacturer(PluginCall call) {
        String brand = normalizeBrand(Build.MANUFACTURER);
        JSObject ret = new JSObject();
        ret.put("brand", brand);
        ret.put("model", Build.MODEL);
        call.resolve(ret);
    }

    /**
     * 打开当前厂商的"自启动 / 后台管理"白名单设置面板。
     * 各家入口不同且都可能不存在或被移除，逐个尝试；全部失败则回退到标准电池优化申请页，
     * 返回 opened:false 让前端提示用户手动进入"自启动/省电"白名单。
     */
    @PluginMethod
    public void openBatterySaverGuide(PluginCall call) {
        Context ctx = getContext();
        String brand = normalizeBrand(Build.MANUFACTURER);
        String[] targets = manufacturerTargets(brand);
        for (String t : targets) {
            try {
                Intent intent = Intent.parseUri(t, Intent.URI_INTENT_SCHEME);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
                JSObject ret = new JSObject();
                ret.put("opened", true);
                ret.put("brand", brand);
                call.resolve(ret);
                return;
            } catch (ActivityNotFoundException e) {
                // 该组件不存在，尝试下一个
            } catch (Exception e) {
                // 某些厂商未导出或被系统拦截，继续尝试下一个
            }
        }
        // 兜底：打开电池优化设置页（系统标准入口）
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            ret.put("brand", brand);
            ret.put("fallbackToBattery", true);
            call.resolve(ret);
            return;
        } catch (Exception e) {
            // 忽略
        }
        JSObject ret = new JSObject();
        ret.put("opened", false);
        ret.put("brand", brand);
        call.resolve(ret);
    }

    private String normalizeBrand(String manufacturer) {
        if (manufacturer == null) return "unknown";
        String m = manufacturer.toLowerCase();
        if (m.contains("xiaomi") || m.contains("redmi") || m.contains("poco")) return "xiaomi";
        if (m.contains("huawei") || m.contains("honor")) return "huawei";
        if (m.contains("oppo") || m.contains("oneplus") || m.contains("realme")) return "oppo";
        if (m.contains("vivo") || m.contains("iqoo")) return "vivo";
        if (m.contains("meizu")) return "meizu";
        if (m.contains("samsung")) return "samsung";
        if (m.contains("sony")) return "unknown";
        return "unknown";
    }

    /** 生成某个厂商可跳转的白名单设置入口（按可靠性排序，intent 字符串协议）。 */
    private String[] manufacturerTargets(String brand) {
        switch (brand) {
            case "xiaomi":
                return new String[]{
                        "intent:#Intent;component=com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity;end",
                        "intent:#Intent;component=com.miui.securitycenter/com.miui.securitycenter.autostart.AutoStartManagementActivity;end",
                        "intent:#Intent;action=miui.intent.action.OP_AUTO_START;end"
                };
            case "huawei":
                return new String[]{
                        "intent:#Intent;component=com.huawei.systemmanager/com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity;end",
                        "intent:#Intent;component=com.huawei.systemmanager/com.huawei.systemmanager.optimize.process.ProtectActivity;end"
                };
            case "oppo":
                return new String[]{
                        "intent:#Intent;component=com.coloros.safecenter/com.coloros.safecenter.permission.startup.StartupAppListActivity;end",
                        "intent:#Intent;component=com.coloros.safecenter/com.coloros.safecenter.startupapp.StartupAppListActivity;end"
                };
            case "vivo":
                return new String[]{
                        "intent:#Intent;action=com.iqoo.secure.action.BG_START_MANAGER;end",
                        "intent:#Intent;component=com.vivo.permissionmanager/com.vivo.permissionmanager.activity.BgStartUpManagerActivity;end"
                };
            case "meizu":
                return new String[]{
                        "intent:#Intent;component=com.meizu.safe/com.meizu.safe.permission.SmartBGActivity;end"
                };
            case "samsung":
                return new String[]{
                        "intent:#Intent;component=com.samsung.android.lool/com.samsung.android.sm.ui.battery.BatteryActivity;end"
                };
            default:
                return new String[]{};
        }
    }
}