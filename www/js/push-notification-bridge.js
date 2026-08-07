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
    var _channelName = '';
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
        // 获取系统内的昵称
        var partnerName = '梦角';
        try {
            if (typeof window.settings !== 'undefined' && window.settings.partnerName) {
                partnerName = window.settings.partnerName;
            }
        } catch (e) {}
        var channelName = partnerName + '消息';
        var channelDesc = partnerName + '发来消息时的通知';
        // 如果渠道已创建且名称未变，跳过
        if (_channelCreated && _channelName === channelName) return Promise.resolve(true);
        return ln.createChannel({
            id: 'partner-messages',
            name: channelName,
            description: channelDesc,
            importance: 5,  // MAX — 最高优先级，类似微信
            visibility: 1,  // PUBLIC — 锁屏可见
            lights: true,
            vibration: true,
            sound: null
        }).then(function () {
            _channelCreated = true;
            _channelName = channelName;
            console.log('[PushBridge] 通知渠道创建成功 (importance=5):', channelName);
            return true;
        }).catch(function (e) {
            // 渠道可能已存在，标记为已创建
            console.log('[PushBridge] 通知渠道已存在或创建失败:', e.message);
            _channelCreated = true;
            _channelName = channelName;
            return true;
        });
    }

    // ====== 发送通知的核心函数 ======
    function _doSendNative(ln, title, body, delayMs) {
        delayMs = delayMs || 50;
        var now = Date.now();
        var id = now + Math.floor(Math.random() * 10000);
        return ln.schedule({
            notifications: [{
                title: title,
                body: body,
                id: id,
                schedule: { at: new Date(now + delayMs) },
                channelId: 'partner-messages',
                importance: 5,
                visibility: 1,
                sound: null,
                iconColor: '#488AFF'
                // 不指定 smallIcon，让 Android 使用默认应用图标
            }]
        }).then(function () {
            return id;  // 返回通知 ID 用于后续取消
        });
    }

    // ====== 提前调度通知（不等 JS 定时器，直接由原生系统触发）======
    // 保留此方法以兼容旧代码，但实际通知由 send() 直接发送
    function _scheduleNativeDelayed(ln, title, body, delayMs) {
        return ensureChannel(ln).then(function () {
            return _doSendNative(ln, title, body, delayMs);
        }).then(function (id) {
            console.log('[PushBridge] 通知已调度 #' + id + ' (' + (delayMs/1000).toFixed(1) + 's后):', title, body);
            return id;
        }).catch(function (e) {
            console.warn('[PushBridge] 调度通知失败:', e);
            return null;
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
         * 前台服务保活确保 WebView 持续运行，setTimeout 可正常触发
         * APK 环境：始终发送系统通知
         * 浏览器环境：仅页面隐藏时发送
         */
        send: function (title, body, options) {
            options = options || {};
            title = title || '传讯';
            body = body || '';

            // Capacitor 环境：始终发送系统通知（前台服务保活）
            if (getEnv() === 'capacitor') {
                var ln = getLocalNotifPlugin();
                if (!ln) {
                    console.warn('[PushBridge] LocalNotifications 插件未找到');
                    return;
                }
                ensureChannel(ln).then(function () {
                    return _doSendNative(ln, title, body, options.delay || 50);
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

        /**
         * 调度延迟通知（保留兼容，实际推荐直接使用 send()）
         */
        scheduleDelayed: function (title, body, delayMs) {
            title = title || '传讯';
            body = body || '';
            delayMs = delayMs || 3000;

            if (getEnv() !== 'capacitor') {
                return Promise.resolve(null);
            }

            var ln = getLocalNotifPlugin();
            if (!ln) {
                return Promise.resolve(null);
            }

            return _scheduleNativeDelayed(ln, title, body, delayMs);
        },

        /**
         * 取消已调度的通知（保留兼容）
         */
        cancelById: function (id) {
            if (!id || getEnv() !== 'capacitor') return;
            var ln = getLocalNotifPlugin();
            if (!ln) return;
            ln.cancel({ notifications: [{ id: id }] }).then(function () {
                console.log('[PushBridge] 已取消通知 #' + id);
            }).catch(function (e) {
                console.warn('[PushBridge] 取消通知失败:', e);
            });
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