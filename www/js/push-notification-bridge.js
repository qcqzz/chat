/**
 * push-notification-bridge.js — 统一通知桥接层
 *
 * 自动检测运行环境，按优先级尝试：
 *   1. 自定义 NotificationPlugin（APK，直接调用 Android NotificationManager）
 *   2. Capacitor LocalNotifications 插件（APK 回退）
 *   3. Web Notification API（浏览器）
 *
 * 用途：对方自动回复时，像微信一样弹出系统通知
 */
(function (global) {
    'use strict';

    var _initialized = false;
    var _capacitorReady = false;
    var _waitPromise = null;
    var _notifPlugin = null;   // 自定义 NotificationPlugin 引用
    var _lnPlugin = null;      // LocalNotifications 插件引用
    var _pluginChecked = false;
    var _permissionGranted = false;  // 权限是否已授予

    // ====== 等待 Capacitor 桥接就绪 ======
    function waitForCapacitor(timeoutMs) {
        timeoutMs = timeoutMs || 5000;
        if (_waitPromise) return _waitPromise;
        if (_capacitorReady) return Promise.resolve(true);

        _waitPromise = new Promise(function (resolve) {
            var start = Date.now();
            function check() {
                if (global.Capacitor && global.Capacitor.Plugins) {
                    _capacitorReady = true;
                    resolve(true);
                    return;
                }
                if (Date.now() - start > timeoutMs) {
                    console.log('[PushBridge] Capacitor 桥接超时，回退到浏览器模式');
                    resolve(false);
                    return;
                }
                setTimeout(check, 200);
            }
            check();
        });
        return _waitPromise;
    }

    // ====== 获取插件引用 ======
    function discoverPlugins() {
        if (_pluginChecked) return;
        _pluginChecked = true;
        if (!global.Capacitor || !global.Capacitor.Plugins) return;

        try {
            // 优先使用自定义 NotificationPlugin（直接调用 Android NotificationManager）
            if (global.Capacitor.Plugins.NotificationPlugin) {
                _notifPlugin = global.Capacitor.Plugins.NotificationPlugin;
                console.log('[PushBridge] 自定义 NotificationPlugin 已就绪');
            }
        } catch (e) {}

        try {
            // 回退：LocalNotifications 插件
            if (!_notifPlugin && global.Capacitor.Plugins.LocalNotifications) {
                _lnPlugin = global.Capacitor.Plugins.LocalNotifications;
                console.log('[PushBridge] LocalNotifications 插件已就绪');
            }
        } catch (e) {}

        if (!_notifPlugin && !_lnPlugin) {
            console.log('[PushBridge] 无原生通知插件，使用浏览器模式 | Plugins:',
                Object.keys(global.Capacitor.Plugins || {}).join(','));
        }
    }

    // ====== 获取对方昵称（多来源回退，每次调用都实时获取） ======
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
        try {
            var stored = localStorage.getItem('partnerName');
            if (stored) return stored;
        } catch (e) {}
        try {
            var el = document.getElementById('partner-name');
            if (el && el.textContent && el.textContent.trim()) {
                return el.textContent.trim();
            }
        } catch (e) {}
        return '对方';
    }

    // ====== 发送自定义通知插件 ======
    function _sendViaCustomPlugin(title, body) {
        if (!_notifPlugin) return Promise.resolve(false);
        var id = Date.now() + Math.floor(Math.random() * 10000);
        return _notifPlugin.send({
            title: title,
            body: body,
            id: id
        }).then(function (result) {
            console.log('[PushBridge] 自定义通知已发送 #' + id + ':', title, body);
            return id;
        }).catch(function (e) {
            console.warn('[PushBridge] 自定义通知失败:', e.message || e);
            return null;
        });
    }

    // ====== 发送 LocalNotifications 通知 ======
    function _sendViaLocalNotif(title, body) {
        if (!_lnPlugin) return Promise.resolve(false);
        var now = Date.now();
        var id = now + Math.floor(Math.random() * 10000);
        return _lnPlugin.schedule({
            notifications: [{
                title: title,
                body: body,
                id: id,
                schedule: { at: new Date(now + 50) },
                channelId: 'partner-messages',
                importance: 5,
                visibility: 1,
                sound: null,
                iconColor: '#488AFF'
            }]
        }).then(function () {
            console.log('[PushBridge] LocalNotifications 通知已发送 #' + id + ':', title, body);
            return id;
        }).catch(function (e) {
            console.warn('[PushBridge] LocalNotifications 通知失败:', e.message || e);
            return null;
        });
    }

    // ====== 浏览器通知 ======
    function _sendBrowserNotif(title, body) {
        try {
            if (typeof localStorage !== 'undefined' && localStorage.getItem('notifEnabled') !== '1') {
                return false;
            }
        } catch (e) {}
        if (!('Notification' in global)) return false;
        if (global.Notification.permission !== 'granted') return false;
        if (!document.hidden) return false;

        try {
            new global.Notification(title, {
                body: body,
                tag: 'partner-msg',
                renotify: true
            });
            console.log('[PushBridge] 浏览器通知:', title, body);
            return true;
        } catch (e) {
            console.warn('[PushBridge] 浏览器通知失败:', e);
            return false;
        }
    }

    // ====== 公开 API ======
    var PushBridge = {
        /**
         * 是否原生环境（Capacitor APK）
         */
        isNative: function () {
            return !!(global.Capacitor && global.Capacitor.Plugins);
        },

        /**
         * 通知是否可用
         */
        isAvailable: function () {
            if (global.Capacitor && global.Capacitor.Plugins) {
                discoverPlugins();
                if (_notifPlugin || _lnPlugin) return true;
            }
            return 'Notification' in global;
        },

        /**
         * 发送通知弹窗
         * 优先使用自定义 NotificationPlugin，回退到 LocalNotifications，最后回退到浏览器
         */
        send: function (title, body, options) {
            options = options || {};
            title = title || '传讯';
            body = body || '';

            // APK 环境：使用原生插件
            if (global.Capacitor && global.Capacitor.Plugins) {
                discoverPlugins();

                if (_notifPlugin) {
                    _sendViaCustomPlugin(title, body);
                    return;
                }

                if (_lnPlugin) {
                    _sendViaLocalNotif(title, body);
                    return;
                }

                // 插件未就绪，等待 Capacitor 桥接后重试
                console.log('[PushBridge] 插件未就绪，等待 Capacitor 桥接...');
                var self = this;
                waitForCapacitor(3000).then(function (ready) {
                    if (ready) {
                        discoverPlugins();
                        if (_notifPlugin) {
                            _sendViaCustomPlugin(title, body);
                        } else if (_lnPlugin) {
                            _sendViaLocalNotif(title, body);
                        }
                    }
                });
                return;
            }

            // 浏览器回退
            _sendBrowserNotif(title, body);
        },

        /**
         * 调度延迟通知
         */
        scheduleDelayed: function (title, body, delayMs) {
            title = title || '传讯';
            body = body || '';
            delayMs = delayMs || 3000;

            if (global.Capacitor && global.Capacitor.Plugins) {
                discoverPlugins();
                if (_lnPlugin) {
                    return _sendViaLocalNotif(title, body);
                }
                if (_notifPlugin) {
                    return _sendViaCustomPlugin(title, body);
                }
            }
            return Promise.resolve(null);
        },

        /**
         * 取消已调度的通知
         */
        cancelById: function (id) {
            if (!id) return;
            if (_notifPlugin) {
                _notifPlugin.cancel({ id: id }).catch(function () {});
            }
            if (_lnPlugin) {
                _lnPlugin.cancel({ notifications: [{ id: id }] }).catch(function () {});
            }
        },

        /**
         * 请求通知权限
         */
        requestPermission: function () {
            if (global.Capacitor && global.Capacitor.Plugins) {
                discoverPlugins();
                if (_notifPlugin) {
                    return _notifPlugin.requestPermission().then(function (result) {
                        _permissionGranted = (result && result.granted === true);
                        console.log('[PushBridge] 权限:', _permissionGranted);
                        return _permissionGranted ? 'granted' : 'denied';
                    }).catch(function () {
                        return 'denied';
                    });
                }
                if (_lnPlugin) {
                    return _lnPlugin.requestPermissions().then(function (result) {
                        _permissionGranted = (result && result.display === 'granted');
                        console.log('[PushBridge] 权限:', _permissionGranted);
                        return _permissionGranted ? 'granted' : 'denied';
                    }).catch(function () {
                        return 'denied';
                    });
                }
            }
            if (!('Notification' in global)) return Promise.resolve('unsupported');
            if (global.Notification.permission === 'granted') {
                _permissionGranted = true;
                return Promise.resolve('granted');
            }
            return global.Notification.requestPermission().then(function (perm) {
                _permissionGranted = (perm === 'granted');
                return perm;
            });
        },

        getStatus: function () {
            // 原生环境：返回缓存的权限状态
            if (global.Capacitor && global.Capacitor.Plugins) {
                return _permissionGranted ? 'granted' : 'unknown';
            }
            // 浏览器环境
            if (!('Notification' in global)) return 'unsupported';
            return global.Notification.permission;
        },

        /**
         * 初始化
         */
        init: function () {
            if (_initialized) return;
            _initialized = true;

            console.log('[PushBridge] 初始化 | Capacitor:', !!global.Capacitor,
                '| 昵称:', getPartnerName());

            // 等待 Capacitor 桥接就绪
            var self = this;
            waitForCapacitor(5000).then(function (ready) {
                if (ready) {
                    discoverPlugins();
                    console.log('[PushBridge] 桥接就绪 | 自定义插件:', !!_notifPlugin,
                        '| LocalNotifications:', !!_lnPlugin);

                    // 请求权限
                    if (_notifPlugin) {
                        _notifPlugin.requestPermission().then(function (result) {
                            _permissionGranted = (result && result.granted === true);
                            console.log('[PushBridge] 权限状态:', _permissionGranted);
                        }).catch(function () {});
                    }
                    if (_lnPlugin && !_notifPlugin) {
                        _lnPlugin.requestPermissions().then(function (result) {
                            _permissionGranted = (result && result.display === 'granted');
                            console.log('[PushBridge] 权限状态:', _permissionGranted);
                        }).catch(function () {});
                    }

                    if (typeof localStorage !== 'undefined') {
                        localStorage.setItem('notifEnabled', '1');
                    }
                } else {
                    console.log('[PushBridge] 桥接超时，使用浏览器模式');
                }
            });

            // 浏览器环境也请求权限
            if (!global.Capacitor && 'Notification' in global && global.Notification.permission === 'default') {
                global.Notification.requestPermission();
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