/**
 * foreground-bridge.js — 前台服务桥接层
 *
 * 控制 Android 前台服务，让 App 在后台保持运行。
 * 前台服务会在状态栏显示"传讯正在后台运行"的持续通知。
 */
(function (global) {
    'use strict';

    var ForegroundBridge = {
        /**
         * 启动前台服务（状态栏显示持续通知，保活）
         */
        start: function () {
            if (!global.Capacitor || !global.Capacitor.Plugins || !global.Capacitor.Plugins.Foreground) {
                console.log('[ForegroundBridge] 非原生环境，跳过');
                return;
            }
            global.Capacitor.Plugins.Foreground.start().then(function () {
                console.log('[ForegroundBridge] 前台服务已启动');
            }).catch(function (e) {
                console.warn('[ForegroundBridge] 启动失败:', e);
            });
        },

        /**
         * 停止前台服务
         */
        stop: function () {
            if (!global.Capacitor || !global.Capacitor.Plugins || !global.Capacitor.Plugins.Foreground) {
                return;
            }
            global.Capacitor.Plugins.Foreground.stop().then(function () {
                console.log('[ForegroundBridge] 前台服务已停止');
            }).catch(function (e) {
                console.warn('[ForegroundBridge] 停止失败:', e);
            });
        },

        /**
         * 检查是否支持前台服务
         */
        isSupported: function () {
            return !!(global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Foreground);
        }
    };

    global.ForegroundBridge = ForegroundBridge;
})(window);