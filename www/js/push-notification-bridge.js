/**
 * push-notification-bridge.js — 统一推送通知桥接层
 *
 * 自动检测运行环境：
 *   - Capacitor APK：使用 @capacitor/push-notifications + FCM 推送
 *   - Android WebView：通过 window.Android 原生接口
 *   - 浏览器：使用 Web Notification API
 *
 * 提供：
 *   - PushBridge.isNative()         是否在 APK 环境中
 *   - PushBridge.send(title, body)   本地发送通知
 *   - PushBridge.requestPermission() 请求通知权限
 *   - PushBridge.getStatus()         获取当前通知状态（同步）
 *   - PushBridge.onFCMToken(cb)      注册 FCM/Push token 回调
 *   - PushBridge.onPushMessage(cb)   注册收到推送消息的回调
 */
(function (global) {
    'use strict';

    var _fcmTokenCallbacks = [];
    var _pushMessageCallbacks = [];
    var _initialized = false;
    var _permissionStatus = 'unknown'; // 缓存权限状态

    // ====== 环境检测 ======
    function detectEnv() {
        // Capacitor 环境（优先级最高）
        if (global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform()) {
            return 'capacitor';
        }
        // Android WebView 环境
        if (global.Android && typeof global.Android.showNotification === 'function') return 'android-native';
        var ua = navigator.userAgent;
        if (/Android/.test(ua) && /wv/.test(ua)) return 'android-webview';
        // 普通浏览器
        return 'browser';
    }

    var _env = detectEnv();

    // ====== Capacitor 插件引用（延迟获取） ======
    function getPushPlugin() {
        if (_env === 'capacitor' && global.Capacitor && global.Capacitor.Plugins) {
            return global.Capacitor.Plugins.PushNotifications;
        }
        return null;
    }

    function getLocalNotifPlugin() {
        if (_env === 'capacitor' && global.Capacitor && global.Capacitor.Plugins) {
            return global.Capacitor.Plugins.LocalNotifications;
        }
        return null;
    }

    // ====== 公开 API ======
    var PushBridge = {
        isNative: function () {
            return _env === 'capacitor' || _env === 'android-webview' || _env === 'android-native';
        },

        isAvailable: function () {
            if (_env === 'capacitor') {
                return !!(global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.PushNotifications);
            }
            if (_env === 'android-webview' || _env === 'android-native') {
                return !!(global.Android && typeof global.Android.showNotification === 'function');
            }
            return 'Notification' in global;
        },

        /**
         * 发送本地通知
         */
        send: function (title, body, options) {
            options = options || {};
            title = title || '传讯';
            body = body || '';

            if (typeof localStorage !== 'undefined' && localStorage.getItem('notifEnabled') !== '1') {
                return;
            }

            // Capacitor 环境：使用 LocalNotifications
            if (_env === 'capacitor') {
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
                        console.warn('[PushBridge] Capacitor 本地通知失败:', e);
                    }
                }
                return;
            }

            // Android WebView 原生接口
            if ((_env === 'android-webview' || _env === 'android-native') &&
                global.Android && typeof global.Android.showNotification === 'function') {
                try {
                    global.Android.showNotification(title, body, options.icon || '', options.tag || 'partner-msg');
                } catch (e) {
                    console.warn('[PushBridge] 原生通知发送失败:', e);
                }
                return;
            }

            // 浏览器 Web Notification API（仅页面隐藏时）
            if (!('Notification' in global)) return;
            if (global.Notification.permission !== 'granted') return;
            if (!document.hidden) return;

            try {
                new global.Notification(title, {
                    body: body,
                    icon: options.icon || undefined,
                    tag: options.tag || 'partner-msg',
                    renotify: true,
                    data: options.data || null
                });
            } catch (e) {
                console.warn('[PushBridge] 浏览器通知发送失败:', e);
            }
        },

        /**
         * 请求通知权限
         * @returns {Promise<string>} "granted" | "denied" | "unsupported"
         */
        requestPermission: function () {
            var self = this;

            // Capacitor 环境
            if (_env === 'capacitor') {
                var push = getPushPlugin();
                if (!push) return Promise.resolve('unsupported');
                return push.requestPermissions().then(function (result) {
                    var perm = result.receive;
                    _permissionStatus = perm;
                    // 权限授予后自动注册推送
                    if (perm === 'granted') {
                        try { push.register(); } catch (e) {}
                    }
                    return perm;
                }).catch(function () {
                    return 'unsupported';
                });
            }

            // Android WebView 原生接口
            if (_env === 'android-webview' || _env === 'android-native') {
                if (global.Android && typeof global.Android.requestNotificationPermission === 'function') {
                    return new Promise(function (resolve) {
                        try {
                            global.Android.requestNotificationPermission();
                            self._permissionResolve = resolve;
                            setTimeout(function () {
                                if (self._permissionResolve) {
                                    self._permissionResolve('unknown');
                                    self._permissionResolve = null;
                                }
                            }, 5000);
                        } catch (e) {
                            resolve('unsupported');
                        }
                    });
                }
                return Promise.resolve('unsupported');
            }

            // 浏览器
            if (!('Notification' in global)) return Promise.resolve('unsupported');
            if (global.Notification.permission === 'granted') return Promise.resolve('granted');
            return global.Notification.requestPermission();
        },

        /**
         * 获取通知权限状态（同步）
         */
        getStatus: function () {
            if (_env === 'capacitor') {
                return _permissionStatus;
            }
            if (_env === 'android-webview' || _env === 'android-native') {
                if (global.Android && typeof global.Android.getNotificationStatus === 'function') {
                    try { return global.Android.getNotificationStatus(); } catch (e) {}
                }
                return 'unknown';
            }
            if (!('Notification' in global)) return 'unsupported';
            return global.Notification.permission;
        },

        /**
         * 注册 FCM/Push Token 回调
         */
        onFCMToken: function (callback) {
            if (typeof callback !== 'function') return;
            _fcmTokenCallbacks.push(callback);
            if (global.Android && typeof global.Android.getFCMToken === 'function') {
                try {
                    var token = global.Android.getFCMToken();
                    if (token) callback(token);
                } catch (e) {}
            }
        },

        /**
         * 注册收到推送消息的回调
         */
        onPushMessage: function (callback) {
            if (typeof callback !== 'function') return;
            _pushMessageCallbacks.push(callback);
        },

        // ====== 内部方法 ======

        _onPermissionResult: function (result) {
            _permissionStatus = result;
            if (this._permissionResolve) {
                this._permissionResolve(result);
                this._permissionResolve = null;
            }
        },

        _onFCMToken: function (token) {
            _fcmTokenCallbacks.forEach(function (cb) {
                try { cb(token); } catch (e) {}
            });
        },

        _onPushMessage: function (data) {
            _pushMessageCallbacks.forEach(function (cb) {
                try { cb(data); } catch (e) {}
            });
        },

        /**
         * 初始化桥接层
         */
        init: function () {
            if (_initialized) return;
            _initialized = true;

            // Capacitor 环境：注册推送监听
            if (_env === 'capacitor') {
                var push = getPushPlugin();
                if (!push) {
                    console.warn('[PushBridge] PushNotifications 插件不可用');
                    return;
                }

                // 监听注册成功（获取 FCM Token）
                push.addListener('registration', function (token) {
                    console.log('[PushBridge] 推送注册成功');
                    _permissionStatus = 'granted';
                    PushBridge._onFCMToken(token.value);
                });

                // 监听注册失败
                push.addListener('registrationError', function (err) {
                    console.error('[PushBridge] 推送注册失败:', err);
                });

                // 监听收到推送
                push.addListener('pushNotificationReceived', function (notification) {
                    console.log('[PushBridge] 收到推送:', notification);
                    PushBridge._onPushMessage(notification);
                });

                // 检查权限并注册
                push.checkPermissions().then(function (result) {
                    _permissionStatus = result.receive;
                    if (result.receive === 'granted') {
                        try { push.register(); } catch (e) {}
                    }
                }).catch(function () {});

                // 同步权限状态
                push.checkPermissions().then(function (r) {
                    _permissionStatus = r.receive;
                }).catch(function () {});

                console.log('[PushBridge] Capacitor 推送初始化完成');
                return;
            }

            // Android WebView 环境
            if ((_env === 'android-webview' || _env === 'android-native') &&
                global.Android && typeof global.Android.registerFCMTokenCallback === 'function') {
                try {
                    global.Android.registerFCMTokenCallback();
                } catch (e) {
                    console.warn('[PushBridge] FCM 注册失败:', e);
                }
            }

            console.log('[PushBridge] 初始化完成，环境:', _env,
                this.isAvailable() ? '✓ 可用' : '✗ 不可用');
        }
    };

    // 暴露到全局
    global.PushBridge = PushBridge;

    // 自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { PushBridge.init(); });
    } else {
        PushBridge.init();
    }

})(window);