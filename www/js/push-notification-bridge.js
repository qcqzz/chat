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
    var _cachedEnv = null;
    var _channelCreated = false;

    // ====== 环境检测（动态检测，每次调用时重新判断） ======
    function detectEnv() {
        // 1. Capacitor 标准检测
        if (global.Capacitor && typeof global.Capacitor.isNativePlatform === 'function' && global.Capacitor.isNativePlatform()) {
            return 'capacitor';
        }
        // 2. 备用：Capacitor 插件已注入
        if (global.Capacitor && global.Capacitor.Plugins) {
            var plugins = global.Capacitor.Plugins;
            if (plugins.LocalNotifications || plugins.Share) {
                return 'capacitor';
            }
        }
        // 3. 备用：Android WebView 且 bridge 已注入
        var ua = navigator.userAgent || '';
        if (/Android/.test(ua) && /wv/.test(ua) && global.Capacitor) {
            return 'capacitor';
        }
        return 'browser';
    }

    function getEnv() {
        if (_cachedEnv === 'capacitor') return 'capacitor';
        var env = detectEnv();
        if (env === 'capacitor') _cachedEnv = env;
        return env;
    }

    // ====== Capacitor 插件引用 ======
    function getLocalNotifPlugin() {
        if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.LocalNotifications) {
            return global.Capacitor.Plugins.LocalNotifications;
        }
        return null;
    }

    // ====== 创建通知渠道（Android 8.0+ 必需） ======
    function ensureChannel(ln) {
        if (!ln || _channelCreated) return Promise.resolve();
        try {
            return ln.createChannel({
                id: 'partner-messages',
                name: '梦角消息',
                description: '梦角发来消息时的通知',
                importance: 4,  // HIGH
                visibility: 1,  // PUBLIC
                sound: null,
                lights: true,
                vibration: true
            }).then(function () {
                _channelCreated = true;
                console.log('[PushBridge] 通知渠道创建成功');
            }).catch(function (e) {
                console.warn('[PushBridge] 通知渠道创建失败（可能已存在）:', e.message);
                _channelCreated = true;  // 即使失败也标记，避免重复尝试
            });
        } catch (e) {
            console.warn('[PushBridge] createChannel 调用异常:', e);
            _channelCreated = true;
            return Promise.resolve();
        }
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
                console.log('[PushBridge] 通知未启用，跳过');
                return;
            }

            // Capacitor 环境：使用 LocalNotifications 弹出系统通知
            if (getEnv() === 'capacitor') {
                var ln = getLocalNotifPlugin();
                if (ln) {
                    // 先确保通知渠道已创建，再发送通知
                    ensureChannel(ln).then(function () {
                        try {
                            ln.schedule({
                                notifications: [{
                                    title: title,
                                    body: body,
                                    id: Date.now(),
                                    schedule: { at: new Date(Date.now() + 100) },
                                    sound: null,
                                    smallIcon: 'ic_stat_notification',
                                    iconColor: '#488AFF',
                                    channelId: 'partner-messages',
                                    channelName: '梦角消息',
                                    importance: 4,
                                    visibility: 1
                                }]
                            });
                            console.log('[PushBridge] 通知已发送:', title);
                        } catch (e) {
                            console.warn('[PushBridge] 通知发送失败:', e);
                        }
                    }).catch(function (e) {
                        console.warn('[PushBridge] 渠道创建失败，仍尝试发送:', e);
                        try {
                            ln.schedule({
                                notifications: [{
                                    title: title,
                                    body: body,
                                    id: Date.now(),
                                    schedule: { at: new Date(Date.now() + 100) },
                                    sound: null,
                                    smallIcon: 'ic_stat_notification',
                                    iconColor: '#488AFF',
                                    channelId: 'partner-messages',
                                    channelName: '梦角消息',
                                    importance: 4,
                                    visibility: 1
                                }]
                            });
                        } catch (e2) {
                            console.warn('[PushBridge] 通知发送失败:', e2);
                        }
                    });
                } else {
                    console.warn('[PushBridge] LocalNotifications 插件未找到');
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
                if (!ln) {
                    console.warn('[PushBridge] 无法请求权限：LocalNotifications 插件未找到');
                    return Promise.resolve('unsupported');
                }
                return ln.requestPermissions().then(function (result) {
                    console.log('[PushBridge] 权限请求结果:', result);
                    return result.display === 'granted' ? 'granted' : 'denied';
                }).catch(function (e) {
                    console.warn('[PushBridge] 权限请求失败:', e);
                    return 'denied';
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

            var env = getEnv();
            var available = this.isAvailable();
            console.log('[PushBridge] 初始化完成');
            console.log('[PushBridge]   环境:', env);
            console.log('[PushBridge]   可用:', available ? '✓' : '✗');
            console.log('[PushBridge]   Capacitor:', !!global.Capacitor);
            if (global.Capacitor && global.Capacitor.Plugins) {
                console.log('[PushBridge]   已注册插件:', Object.keys(global.Capacitor.Plugins).join(', '));
            }

            // APK 环境：创建通知渠道并请求权限
            if (env === 'capacitor' && available) {
                var ln = getLocalNotifPlugin();
                if (ln) {
                    // 先创建通知渠道
                    ensureChannel(ln).then(function () {
                        // 再请求权限
                        return ln.requestPermissions();
                    }).then(function (result) {
                        console.log('[PushBridge] 权限请求结果:', result.display);
                        if (result.display === 'granted') {
                            localStorage.setItem('notifEnabled', '1');
                        }
                    }).catch(function (e) {
                        console.warn('[PushBridge] 初始化权限请求失败:', e);
                    });
                }
            }
        }
    };

    global.PushBridge = PushBridge;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { PushBridge.init(); });
    } else {
        PushBridge.init();
    }

})(window);