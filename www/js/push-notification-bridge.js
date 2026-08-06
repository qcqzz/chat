/**
 * push-notification-bridge.js — 统一通知桥接层
 *
 * 自动检测运行环境：
 *   - Capacitor APK：使用 LocalNotifications 插件 → 系统级弹窗（微信式）
 *   - 浏览器：使用 Web Notification API
 *
 * 用途：梦角自动回复时，像微信一样弹出系统通知
 */
(function (global) {
    'use strict';

    var _initialized = false;
    var _cachedEnv = null;
    var _channelCreated = false;
    var _permissionGranted = false;

    // ====== 环境检测 ======
    function detectEnv() {
        if (global.Capacitor && typeof global.Capacitor.isNativePlatform === 'function' && global.Capacitor.isNativePlatform()) {
            return 'capacitor';
        }
        if (global.Capacitor && global.Capacitor.Plugins) {
            var plugins = global.Capacitor.Plugins;
            if (plugins.LocalNotifications || plugins.Share || plugins.Filesystem) {
                return 'capacitor';
            }
        }
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

    function getLocalNotifPlugin() {
        if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.LocalNotifications) {
            return global.Capacitor.Plugins.LocalNotifications;
        }
        return null;
    }

    // ====== 创建通知渠道（Android 8.0+ 必需，同步阻塞直到完成） ======
    function ensureChannel(ln) {
        if (!ln) return Promise.resolve(false);
        if (_channelCreated) return Promise.resolve(true);
        return ln.createChannel({
            id: 'partner-messages',
            name: '梦角消息',
            description: '梦角发来消息时的通知',
            importance: 5,  // MAX — 最高优先级，类似微信
            visibility: 1,  // PUBLIC — 锁屏可见
            lights: true,
            vibration: true,
            sound: null
        }).then(function () {
            _channelCreated = true;
            console.log('[PushBridge] 通知渠道创建成功 (importance=5)');
            return true;
        }).catch(function (e) {
            // 渠道可能已存在，标记为已创建
            console.log('[PushBridge] 通知渠道已存在或创建失败:', e.message);
            _channelCreated = true;
            return true;
        });
    }

    // ====== 发送通知的核心函数 ======
    function _doSendNative(ln, title, body) {
        // 使用 Date.now() 确保立即触发
        var now = Date.now();
        return ln.schedule({
            notifications: [{
                title: title,
                body: body,
                id: now,
                schedule: { at: new Date(now + 50) },
                channelId: 'partner-messages',
                importance: 5,
                visibility: 1,
                sound: null,
                iconColor: '#488AFF'
                // 不指定 smallIcon，让 Android 使用默认应用图标
            }]
        });
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
         * APK 环境：始终尝试发送，不受 notifEnabled 限制
         */
        send: function (title, body, options) {
            options = options || {};
            title = title || '传讯';
            body = body || '';

            // Capacitor 环境：直接发送系统通知，不检查 notifEnabled
            if (getEnv() === 'capacitor') {
                var ln = getLocalNotifPlugin();
                if (!ln) {
                    console.warn('[PushBridge] LocalNotifications 插件未找到');
                    return;
                }
                // 确保渠道存在后立即发送
                ensureChannel(ln).then(function () {
                    return _doSendNative(ln, title, body);
                }).then(function () {
                    console.log('[PushBridge] 通知已发送:', title, body);
                }).catch(function (e) {
                    console.warn('[PushBridge] 通知发送失败:', e);
                });
                return;
            }

            // 浏览器环境：检查权限和页面状态
            if (typeof localStorage !== 'undefined' && localStorage.getItem('notifEnabled') !== '1') {
                return;
            }
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

        requestPermission: function () {
            if (getEnv() === 'capacitor') {
                var ln = getLocalNotifPlugin();
                if (!ln) {
                    return Promise.resolve('unsupported');
                }
                return ln.requestPermissions().then(function (result) {
                    _permissionGranted = (result.display === 'granted');
                    console.log('[PushBridge] 权限请求结果:', result.display);
                    return _permissionGranted ? 'granted' : 'denied';
                }).catch(function (e) {
                    console.warn('[PushBridge] 权限请求失败:', e);
                    return 'denied';
                });
            }

            if (!('Notification' in global)) return Promise.resolve('unsupported');
            if (global.Notification.permission === 'granted') return Promise.resolve('granted');
            return global.Notification.requestPermission();
        },

        getStatus: function () {
            if (getEnv() === 'capacitor') {
                return _permissionGranted ? 'granted' : 'unknown';
            }
            if (!('Notification' in global)) return 'unsupported';
            return global.Notification.permission;
        },

        init: function () {
            if (_initialized) return;
            _initialized = true;

            var env = getEnv();
            var available = this.isAvailable();
            console.log('[PushBridge] 初始化');
            console.log('[PushBridge]   环境:', env, '| 可用:', available, '| Capacitor:', !!global.Capacitor);
            if (global.Capacitor && global.Capacitor.Plugins) {
                console.log('[PushBridge]   已注册插件:', Object.keys(global.Capacitor.Plugins).join(', '));
            }

            if (env === 'capacitor' && available) {
                var ln = getLocalNotifPlugin();
                if (ln) {
                    // 1. 创建通知渠道
                    // 2. 请求权限
                    // 3. 标记可用
                    ensureChannel(ln).then(function () {
                        return ln.requestPermissions();
                    }).then(function (result) {
                        _permissionGranted = (result.display === 'granted');
                        console.log('[PushBridge] 权限:', result.display, '| 渠道:', _channelCreated);
                        // 始终设置 notifEnabled，让 send() 可以工作
                        if (typeof localStorage !== 'undefined') {
                            localStorage.setItem('notifEnabled', '1');
                        }
                    }).catch(function (e) {
                        console.warn('[PushBridge] 初始化失败:', e);
                        // 即使失败也尝试设置
                        if (typeof localStorage !== 'undefined') {
                            localStorage.setItem('notifEnabled', '1');
                        }
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