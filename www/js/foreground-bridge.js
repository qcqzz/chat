/**
 * foreground-bridge.js — 前台服务桥接层
 *
 * 控制 Android 前台服务，让 App 在后台保持运行。
 * 前台服务会在状态栏显示"传讯正在后台运行"的持续通知。
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
         * 启动前台服务（状态栏显示持续通知，保活）
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
         * 检查是否支持前台服务
         */
        isSupported: function () {
            return !!getCapacitor();
        }
    };

    global.ForegroundBridge = ForegroundBridge;
})(window);