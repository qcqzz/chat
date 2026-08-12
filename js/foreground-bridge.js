/**
 * foreground-bridge.js — 前台服务 + 电池优化 + 定时唤醒桥接层
 *
 * 控制 Android 前台服务，让 App 在后台保持运行，即使熄屏也能收到消息。
 * 前台服务在状态栏显示"正在后台运行"的持续通知。
 */
(function (global) {
    'use strict';

    function getCapacitor() {
        if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Foreground) {
            return global.Capacitor.Plugins.Foreground;
        }
        return null;
    }

    function getPartnerName() {
        try {
            if (typeof window.settings !== 'undefined' && window.settings && window.settings.partnerName) {
                return window.settings.partnerName;
            }
        } catch (e) {}
        try {
            if (typeof settings !== 'undefined' && settings && settings.partnerName) {
                return settings.partnerName;
            }
        } catch (e) {}
        return '对方';
    }

    var ForegroundBridge = {
        /**
         * 启动前台服务（状态栏显示持续通知，保活 + 定时唤醒）
         */
        start: function () {
            var fg = getCapacitor();
            if (!fg) {
                console.log('[ForegroundBridge] 非原生环境，跳过');
                return;
            }
            var name = getPartnerName();
            fg.start({ partnerName: name }).then(function () {
                console.log('[ForegroundBridge] 前台服务已启动, 昵称:', name);
            }).catch(function (e) {
                console.warn('[ForegroundBridge] 启动失败:', e);
            });
        },

        /**
         * 停止前台服务
         */
        stop: function () {
            var fg = getCapacitor();
            if (!fg) return;
            fg.stop().then(function () {
                console.log('[ForegroundBridge] 前台服务已停止');
            }).catch(function (e) {
                console.warn('[ForegroundBridge] 停止失败:', e);
            });
        },

        /**
         * 更新前台通知文字（昵称变化时调用）
         */
        updateNotification: function () {
            var fg = getCapacitor();
            if (!fg) return;
            var name = getPartnerName();
            fg.updateNotification({ partnerName: name }).then(function () {
                console.log('[ForegroundBridge] 前台通知已更新, 昵称:', name);
            }).catch(function (e) {
                console.warn('[ForegroundBridge] 更新失败:', e);
            });
        },

        /**
         * 请求忽略电池优化（免除 Doze 限制）
         * 如果未授权，会打开系统设置页让用户手动允许
         */
        requestBatteryOptimization: function () {
            var fg = getCapacitor();
            if (!fg) return;
            fg.requestBatteryOptimization().then(function (result) {
                if (result.alreadyGranted) {
                    console.log('[ForegroundBridge] 电池优化已豁免');
                } else if (result.needAction) {
                    console.log('[ForegroundBridge] 已打开电池优化设置页，请手动允许');
                }
            }).catch(function (e) {
                console.warn('[ForegroundBridge] 电池优化请求失败:', e);
            });
        },

        /**
         * 检查是否已忽略电池优化
         */
        isBatteryOptimized: function (callback) {
            var fg = getCapacitor();
            if (!fg) {
                if (callback) callback(true);
                return;
            }
            fg.isBatteryOptimized().then(function (result) {
                if (callback) callback(result.ignored);
            }).catch(function () {
                if (callback) callback(false);
            });
        },

        /**
         * 检查是否支持前台服务
         */
        isSupported: function () {
            return !!getCapacitor();
        }
    };

    global.ForegroundBridge = ForegroundBridge;
})(window);