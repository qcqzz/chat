/**
 * push-notification-bridge.js — 统一通知桥接层
 *
 * 自动检测运行环境：
 *   - Capacitor APK：使用 LocalNotifications 插件 → 系统级弹窗
 *   - 浏览器：使用 Web Notification API
 *
 * 用途：梦角自动回复时，像微信一样弹出系统通知
 */
(function (global) {
    'use strict';

    var _initialized = false;

    // ====== 环境检测（动态检测，每次调用时重新判断） ======
    function detectEnv() {
        if (global.Capacitor && typeof global.Capacitor.isNativePlatform === 'function' && global.Capacitor.isNativePlatform()) {
            return 'capacitor';
        }
        // 备用检测：Android WebView 且 Capacitor 已注入
        if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.LocalNotifications) {
            return 'capacitor';
        }
        return 'browser';
    }

    function getEnv() {
        return detectEnv();
    }

    // ====== Capacitor 插件引用 ======
    function getLocalNotifPlugin() {
        var env = getEnv();
        if (env === 'capacitor' && global.Capacitor && global.Capacitor.Plugins) {
            return global.Capacitor.Plugins.LocalNotifications;
        }
        return null;
    }

    // ====== 公开 API ======
    var PushBridge = {
        isNative: function () {
            return getEnv() === 'capacitor';
        },

        isAvailable: function () {
            if (getEnv() === 'capacitor') {
                return !!(global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.LocalNotifications);
            }
            return 'Notification' in global;
        },

        /**
         * 发送通知弹窗（梦角回复时调用）
         */
        send: function (title, body, options) {
            options = options || {};
            title = title || '传讯';
            body = body || '';

            if (typeof localStorage !== 'undefined' && localStorage.getItem('notifEnabled') !== '1') {
                return;
            }

            // Capacitor 环境：使用 LocalNotifications 弹出系统通知
            if (getEnv() === 'capacitor') {
                var ln = getLocalNotifPlugin();
                if (ln) {
                    try {
                        ln.schedule({
                            notifications: [{
                                title: title,
                                body: body,
                                id: Date.now(),
                                schedule: { at: new Date(Date.now() + 100) },
                                sound: 'beep.wav',
                                smallIcon: 'ic_stat_notification',
                                iconColor: '#488AFF'
                            }]
                        });
                    } catch (e) {
                        console.warn('[PushBridge] 通知发送失败:', e);
                    }
                }
                return;
            }

            // 浏览器环境：仅页面隐藏时弹出
            if (!('Notification' in global)) return;
            if (global.Notification.permission !== 'granted') return;
            if (!document.hidden) return;

            try {
                new global.Notification(title, {
                    body: body,
                    icon: options.icon || undefined,
                    tag: options.tag || 'partner-msg',
                    renotify: true
                });
            } catch (e) {
                console.warn('[PushBridge] 浏览器通知失败:', e);
            }
        },

        /**
         * 请求通知权限
         */
        requestPermission: function () {
            if (getEnv() === 'capacitor') {
                var ln = getLocalNotifPlugin();
                if (!ln) return Promise.resolve('unsupported');
                return ln.requestPermissions().then(function (result) {
                    return result.display === 'granted' ? 'granted' : 'denied';
                }).catch(function () {
                    return 'unsupported';
                });
            }

            if (!('Notification' in global)) return Promise.resolve('unsupported');
            if (global.Notification.permission === 'granted') return Promise.resolve('granted');
            return global.Notification.requestPermission();
        },

        /**
         * 获取通知权限状态（同步）
         */
        getStatus: function () {
            if (getEnv() === 'capacitor') {
                // LocalNotifications 没有同步检查，用缓存
                return 'unknown';
            }
            if (!('Notification' in global)) return 'unsupported';
            return global.Notification.permission;
        },

        /**
         * 初始化
         */
        init: function () {
            if (_initialized) return;
            _initialized = true;

            console.log('[PushBridge] 初始化完成，环境:', getEnv(),
                this.isAvailable() ? '✓ 可用' : '✗ 不可用');
        }
    };

    global.PushBridge = PushBridge;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { PushBridge.init(); });
    } else {
        PushBridge.init();
    }

})(window);