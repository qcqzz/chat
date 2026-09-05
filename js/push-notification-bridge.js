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

    // 通知 id 生成：单调递增并加固定大基数，保证与后台闹钟固定 id(8823481) 完全错开，
    // 相邻多条消息也不会互相覆盖（此前用 Date.now() 取模，一连发几条可能撞同 id 把上一条顶掉）。
    var _NOTIF_ID_BASE = 100000000; // 1e8 >> 后台固定 id 8823481
    var _notifSeq = 0;
    function _nextNotifId() {
        _notifSeq = (_notifSeq + 1) % _NOTIF_ID_BASE;
        return _NOTIF_ID_BASE + _notifSeq;
    }

    // 站点品牌图（与 sw.js / manifest 一致），用作通知图标兜底/角标
    var BRAND_ICON = 'https://file.youtochat.com/images/20260216/1771224856844_qdqqd.jpeg';

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

    // APK 系统通知的左侧图标：用梦角头像（跟聊天/桌面一致），没有则回退到站点品牌图
    function _avatarIcon() {
        try {
            var img = document.querySelector('#partner-avatar img');
            if (img && img.src) return img.src;
        } catch (e) {}
        return BRAND_ICON;
    }

    // ====== 发送自定义通知插件 ======
    function _sendViaCustomPlugin(title, body, options) {
        if (!_notifPlugin) return Promise.resolve(false);
        options = options || {};
        // 用单调递增的大基数 id，杜绝多条消息/与后台闹钟固定 id 撞在一起互相顶掉
        var id = _nextNotifId();
        var payload = {
            title: title,
            body: body,
            id: id
        };
        // 通知里的发件人小字（对方名字），与左侧大图和标题呼应
        if (options.sender) payload.sender = options.sender;
        // 左侧大头像：优先用对方头像，System 插件会异步加载后更新通知
        if (options.avatar) payload.avatar = options.avatar;
        if (options.urgent) payload.urgent = true;
        if (options.fullScreen) payload.urgent = true; // 别名兼容
        return _notifPlugin.send(payload).then(function (result) {
            console.log('[PushBridge] 自定义通知已发送 #' + id + ' urgent=' + (payload.urgent || false) + ':', title, body);
            return id;
        }).catch(function (e) {
            console.warn('[PushBridge] 自定义通知失败:', e.message || e);
            return null;
        });
    }

    // ====== 发送 LocalNotifications 通知 ======
    function _sendViaLocalNotif(title, body, options) {
        if (!_lnPlugin) return Promise.resolve(false);
        options = options || {};
        var now = Date.now();
        var id = _nextNotifId();
        var notif = {
            title: title,
            body: body,
            id: id,
            schedule: { at: new Date(now + 50) },
            channelId: 'partner-messages',
            importance: 5,
            visibility: 1,
            iconColor: '#488AFF',
            // 与自定义插件同分组，避免各自独立图标造成割裂
            group: 'chuanxun-partner',
            groupSummary: false
        };
        if (options.avatar) notif.largeIcon = options.avatar;
        return _lnPlugin.schedule({
            notifications: [notif]
        }).then(function () {
            console.log('[PushBridge] LocalNotifications 通知已发送 #' + id + ':', title, body);
            return id;
        }).catch(function (e) {
            console.warn('[PushBridge] LocalNotifications 通知失败:', e.message || e);
            return null;
        });
    }

    // ====== 浏览器通知（Service Worker 优先，保证后台/失焦也能弹出） ======
    // 直接 new Notification() 在 Chrome 中仅当标签页处于活动/可见时才真正显示，
    // 后台或不聚焦时会静默丢弃。正确姿势是走已注册的 Service Worker：
    // registration.showNotification() 不依赖标签页可见性/焦点，必达。
    function _sendViaServiceWorker(title, body, options) {
        try {
            var reg = (PushBridge.webKeepAlive && PushBridge.webKeepAlive._swReg) || null;
            if (!reg || !reg.showNotification) return false;
            options = options || {};
            var tag = options.urgent ? 'partner-invite' : 'partner-msg';
            var icon = _avatarIcon();
            reg.showNotification(title, {
                body: body,
                icon: icon,
                badge: BRAND_ICON,
                tag: tag,
                renotify: true,
                // 紧急邀请（视频/来电等）对应 APK 的全屏式提醒：通知常驻直到用户处理，并震动
                requireInteraction: !!options.urgent,
                vibrate: options.urgent ? [120, 80, 120] : undefined,
                data: { url: (location && location.href) || '/' }
            }).then(function () {
                console.log('[PushBridge] Service Worker 浏览器通知:', title, body);
            }).catch(function () { /* 忽略 */ });
            return true;
        } catch (e) {
            return false;
        }
    }

    function _sendBrowserNotif(title, body, options) {
        try {
            if (typeof localStorage !== 'undefined' && localStorage.getItem('notifEnabled') !== '1') {
                return false;
            }
        } catch (e) {}
        if (!('Notification' in global)) return false;
        if (global.Notification.permission !== 'granted') return false;
        // 用户正专注查看本页：不弹系统通知（应用内横幅已提示），避免打扰；
        // 后台 / 失焦 / 其他窗口时才弹。isFocused 仅在真正获焦时为 true。
        var focused = false;
        try { focused = document.visibilityState === 'visible' && document.hasFocus && document.hasFocus(); } catch (e) {}
        if (focused) return false;

        // 1) 优先 Service Worker（后台/失焦必达）
        if (_sendViaServiceWorker(title, body, options)) return true;

        // 2) 兜底：直接构造 Notification
        try {
            new global.Notification(title, {
                body: body,
                icon: _avatarIcon(),
                badge: BRAND_ICON,
                tag: options && options.urgent ? 'partner-invite' : 'partner-msg',
                renotify: true,
                requireInteraction: !!(options && options.urgent),
                vibrate: (options && options.urgent) ? [120, 80, 120] : undefined
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
         *
         * options 可选：
         *   urgent: true   → 紧急通知（视频邀请/来电等），用全屏弹窗，需用户手动处理
         *   urgent: false  → 默认，普通消息，顶部横幅几秒后自动收回（类似微信普通消息）
         */
        send: function (title, body, options) {
            options = options || {};
            title = title || '传讯';
            body = body || '';

            // APK 环境：使用原生插件
            if (global.Capacitor && global.Capacitor.Plugins) {
                discoverPlugins();

                if (_notifPlugin) {
                    _sendViaCustomPlugin(title, body, options);
                    return;
                }

                if (_lnPlugin) {
                    _sendViaLocalNotif(title, body, options);
                    return;
                }

                // 插件未就绪，等待 Capacitor 桥接后重试
                console.log('[PushBridge] 插件未就绪，等待 Capacitor 桥接...');
                var self = this;
                waitForCapacitor(3000).then(function (ready) {
                    if (ready) {
                        discoverPlugins();
                        if (_notifPlugin) {
                            _sendViaCustomPlugin(title, body, options);
                        } else if (_lnPlugin) {
                            _sendViaLocalNotif(title, body, options);
                        }
                    }
                });
                return;
            }

            // 浏览器回退
            _sendBrowserNotif(title, body, options);
        },

        /**
         * 调度延迟通知
         */
        scheduleDelayed: function (title, body, delayMs, options) {
            title = title || '传讯';
            body = body || '';
            delayMs = delayMs || 3000;
            options = options || {};

            if (global.Capacitor && global.Capacitor.Plugins) {
                discoverPlugins();
                if (_lnPlugin) {
                    return _sendViaLocalNotif(title, body, options);
                }
                if (_notifPlugin) {
                    return _sendViaCustomPlugin(title, body, options);
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
         * 浏览器后台增强控制柄（非原生环境才有意义）：把"下一次到点时刻"
         * 同步给 Service Worker，由 SW 在后台兜底弹系统通知；并尝试 Wake Lock
         * 降低页面被后台冻结的概率。
         */
        webKeepAlive: {
            _swReg: null,
            _wakeLock: null,
            _lastSync: null,

            init: function () {
                if (global.Capacitor && global.Capacitor.Plugins) return; // APK 走原生，不需要
                this._registerServiceWorker();
                this._wakeLockListeners();
            },

            _registerServiceWorker: function () {
                try {
                    if (!('serviceWorker' in global.navigator)) return;
                    var self = this;
                    global.navigator.serviceWorker.register('./sw.js', { scope: './' }).then(function (reg) {
                        self._swReg = reg;
                        console.log('[PushBridge] 后台兜底 SW 已注册', reg.scope);
                    }).catch(function (e) {
                        console.warn('[PushBridge] SW 注册失败（后台兜底通知不可用）:', e.message || e);
                    });
                } catch (e) {}
            },

            /**
             * 同步下一次到点：at 为毫秒时间戳；title/body 用于 SW 兜底通知文案。
             */
            syncNext: function (at, title, body) {
                if (global.Capacitor && global.Capacitor.Plugins) return; // APK 不走 SW
                this._lastSync = at;
                try {
                    if (this._swReg && this._swReg.active) {
                        this._swReg.active.postMessage({
                            type: 'webkeepalive:sync',
                            at: at, title: title || '', body: body || ''
                        });
                    }
                } catch (e) {}
            },

            clearNext: function () {
                if (global.Capacitor && global.Capacitor.Plugins) return;
                try {
                    if (this._swReg && this._swReg.active) {
                        this._swReg.active.postMessage({ type: 'webkeepalive:clear' });
                    }
                } catch (e) {}
            },

            _requestWakeLock: function () {
                try {
                    if (!('wakeLock' in global.navigator)) return;
                    var self = this;
                    global.navigator.wakeLock.request('screen').then(function (lock) {
                        self._wakeLock = lock;
                    }).catch(function () {});
                } catch (e) {}
            },

            _releaseWakeLock: function () {
                try {
                    if (this._wakeLock) { this._wakeLock.release(); this._wakeLock = null; }
                } catch (e) {}
            },

            _wakeLockListeners: function () {
                var self = this;
                try {
                    document.addEventListener('visibilitychange', function () {
                        if (document.visibilityState === 'hidden') {
                            self._requestWakeLock();
                        } else {
                            self._releaseWakeLock();
                        }
                    });
                } catch (e) {}
            }
        },

        /**
         * 处理来自 SW 的"到点"唤醒：页面仍存活时补一条真实消息（走原 simulateReply）。
         */
        _swDueHandler: function (event) {
            var data = event && event.data;
            if (!data) return;
            if (data.type !== 'webkeepalive:due') return;
            try {
                if (typeof global.simulateReply === 'function') {
                    global.simulateReply();
                    console.log('[PushBridge] SW 唤起到点，补发一条真实消息');
                }
            } catch (e) {}
        },

        /**
         * 初始化
         */
        init: function () {
            if (_initialized) return;
            _initialized = true;

            console.log('[PushBridge] 初始化 | Capacitor:', !!global.Capacitor,
                '| 昵称:', getPartnerName());

            // 浏览器后台增强：注册 SW + Wake Lock 保活 + 监听 SW 到点唤醒（完全跳过原生环境）
            try {
                if (!(global.Capacitor && global.Capacitor.Plugins)) {
                    this.webKeepAlive.init();
                }
            } catch (e) {}
            try {
                if (!(global.Capacitor && global.Capacitor.Plugins)
                    && global.navigator && global.navigator.serviceWorker) {
                    var self = this;
                    global.navigator.serviceWorker.addEventListener('message', function (event) {
                        self._swDueHandler(event);
                    });
                }
            } catch (e) {}

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

/* =========================================================================
 * 离线消息提醒（Periodic Background Sync，源自 Mochi 字卡传讯，零后端）
 *
 * 与根目录 sw.js 配合：页面全部关闭后，Chromium 按自身策略定期唤醒 SW，
 * SW 读本模块写入的「可发文案」快照 → 随机抽一条 → 以梦角名义弹系统通知，
 * 同时把该条追加进队列；用户回开应用后由本模块把队列安全补投递进聊天。
 *
 * 如实边界（照抄 mochi 的坦诚策略，不夸大）：仅 Chromium 系支持；需把站点
 * “添加到主屏幕”并在主屏图标里打开（standalone）才会被调度；频率由系统决定
 * （约数小时一次）；iPhone Safari 无此 API；进程被系统杀死后无法唤醒。
 * ========================================================================= */
(function () {
    'use strict';

    var IS_NATIVE = !!(window.Capacitor && window.Capacitor.Plugins);

    var FLAG = 'offlineNotifyEnabled';          // '0' = 关闭，其余 = 开启（默认开启）
    var TAG = 'chuan-ta-msg';
    var SNAP_KEY = 'chuan:psync-snap';
    var QUEUE_KEY = 'chuan:psync-queue';
    var DB = 'chuan-offline-db';
    var STORE = 'kv';
    var TTL = 7 * 24 * 60 * 60 * 1000;          // 快照/队列 7 天未刷新（长期没开应用）提醒自动失效

    var BUILTIN = [
        '刚看到一句话，想起你了。',
        '你在忙吗？我这边刚刚想到你。',
        '没什么事，就是想跟你说句话。',
        '今天也要好好吃饭呀。',
        '突然很想你，就说一声。',
        '记得喝水，别总忘了。',
        '晚安前跟你说一声，我在。',
        '有空的时候理理我呀。'
    ];

    // ---- IndexedDB 读写（与根目录 sw.js 共用同一 DB/表）----
    function openDb() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB, 1);
            req.onupgradeneeded = function () {
                try {
                    if (!req.result.objectStoreNames.contains(STORE)) {
                        req.result.createObjectStore(STORE);
                    }
                } catch (e) {}
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error('offline idb open fail')); };
        });
    }
    function idbGet(key) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx;
                try {
                    tx = db.transaction(STORE, 'readonly');
                } catch (e) { reject(e); return; }
                var rq = tx.objectStore(STORE).get(key);
                rq.onsuccess = function () { resolve(rq.result); };
                rq.onerror = function () { reject(rq.error); };
            });
        });
    }
    function idbSet(key, val) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx;
                try {
                    tx = db.transaction(STORE, 'readwrite');
                } catch (e) { reject(e); return; }
                tx.objectStore(STORE).put(val, key);
                tx.oncomplete = function () { resolve(true); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    // ---- 判定与取值（全部静默降级）----
    function supported() {
        try { return 'serviceWorker' in navigator && 'PeriodicSyncManager' in window; } catch (e) { return false; }
    }
    function standalone() {
        try {
            return !!(window.matchMedia &&
                window.matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches);
        } catch (e) { return false; }
    }
    function enabledProp() { try { return localStorage.getItem(FLAG) !== '0'; } catch (e) { return true; } }
    function currentCid() {
        try { return (typeof SESSION_ID !== 'undefined' && SESSION_ID) ? SESSION_ID : 'default'; } catch (e) { return 'default'; }
    }
    function partnerName() {
        try {
            var s = (typeof settings !== 'undefined') ? settings : null;
            if (s && s.partnerName) return String(s.partnerName);
        } catch (e) {}
        try { var el = document.getElementById('partner-name'); if (el && el.textContent.trim()) return el.textContent.trim(); } catch (e) {}
        try { var ls = localStorage.getItem('partnerName'); if (ls) return ls; } catch (e) {}
        return '对方';
    }
    function periodicManager(reg) {
        try { if (navigator.periodicSync && navigator.periodicSync.register) return navigator.periodicSync; } catch (e) {}
        try { if (reg && reg.periodicSync) return reg.periodicSync; } catch (e) {}
        return null;
    }

    // ---- 文案来源：用户「自定义回复」里的短文字字卡 + 内置兜底 ----
    function plain(t) {
        if (typeof t !== 'string') return false;
        var s = t.trim();
        if (!s || s.length > 60) return false;
        if (s.indexOf('|||') >= 0) return false;            // 语音卡
        if (s.indexOf('data:') === 0) return false;         // 图片/表情
        if (s.indexOf('http:') === 0 || s.indexOf('https:') === 0) return false;
        return true;
    }
    function shuffle(a) {
        var r = a.slice();
        for (var i = r.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = r[i]; r[i] = r[j]; r[j] = t;
        }
        return r;
    }
    var _snapCount = 0;
    function buildSnapshot() {
        var cc = [];
        try { cc = (typeof customReplies !== 'undefined' ? customReplies : []).filter(plain).slice(0, 40); } catch (e) { cc = []; }
        var picks = [];
        shuffle(cc).forEach(function (t) { picks.push({ t: String(t).trim(), k: 'cc' }); });
        shuffle(BUILTIN).slice(0, 4).forEach(function (t) { picks.push({ t: t, k: 'bl' }); });
        var snap = {
            v: 1,
            ts: Date.now(),
            cid: currentCid(),
            name: partnerName(),
            texts: shuffle(picks).slice(0, 12)
        };
        _snapCount = snap.texts.length;
        idbSet(SNAP_KEY, snap).catch(function () {});
        return Promise.resolve(snap);
    }

    // ---- 注册 / 注销 ----
    function apply() {
        if (IS_NATIVE) return Promise.resolve();
        if (!supported() || !enabledProp()) return Promise.resolve();
        return navigator.serviceWorker.ready.then(function (reg) {
            var pm = periodicManager(reg);
            if (!pm) return;
            return navigator.permissions.query({ name: 'periodic-background-sync' }).then(function (st) {
                if (st && st.state === 'denied') return;
                return pm.register(TAG, { minInterval: 4 * 60 * 60 * 1000 }).then(function () {
                    return buildSnapshot();
                });
            });
        }).catch(function () {});
    }
    function teardown() {
        if (IS_NATIVE) return Promise.resolve();
        if (!supported()) return Promise.resolve();
        return navigator.serviceWorker.ready.then(function (reg) {
            var pm = periodicManager(reg);
            if (!pm || !pm.getTags) return;
            return pm.getTags().then(function (tags) {
                if (tags.indexOf(TAG) >= 0) { try { return pm.unregister(TAG); } catch (e) {} }
            });
        }).catch(function () {});
    }

    // ---- 把队列补投递进聊天（只投递当前梦角的文案，别的不动）----
    function deliverIntoChat(it) {
        var msg = {
            id: Date.now() + Math.random(),
            sender: partnerName(),
            text: it.t,
            timestamp: new Date(),
            status: 'received',
            favorited: false,
            note: null,
            replyTo: null,
            type: 'normal'
        };
        try {
            if (typeof window.addMessage === 'function') { window.addMessage(msg); return true; }
        } catch (e) {}
        return false;
    }
    function drainQueue() {
        if (IS_NATIVE) return Promise.resolve(0);
        if (!supported()) return Promise.resolve(0);
        return idbGet(QUEUE_KEY).then(function (arr) {
            if (!Array.isArray(arr) || !arr.length) return 0;
            var cid = currentCid();
            var now = Date.now();
            var remain = [];
            var delivered = 0;
            for (var i = 0; i < arr.length; i++) {
                var it = arr[i];
                if (!it || typeof it.t !== 'string' || !it.t.trim()) continue;
                if (!it.ts || now - it.ts > TTL) continue;                       // 过期丢弃
                if ((it.cid || 'default') !== cid) { remain.push(it); continue; } // 别的梦角的留着
                // 防重复：当前聊天最近 10 条里 30 分钟内有同文本视为已投递
                var dup = false;
                try {
                    var msgs = (typeof messages !== 'undefined') ? messages : null;
                    if (Array.isArray(msgs)) {
                        for (var j = Math.max(0, msgs.length - 10); j < msgs.length; j++) {
                            var m = msgs[j];
                            if (m && m.text === it.t && Math.abs((Date.parse(m.timestamp) || 0) - it.ts) < 30 * 60000) {
                                dup = true; break;
                            }
                        }
                    }
                } catch (e) {}
                if (dup) continue;                                   // 已有同文本，丢弃
                if (deliverIntoChat(it)) delivered++;
                else remain.push(it);                                // 未投递成功（如聊天未就绪），保留待下次
            }
            idbSet(QUEUE_KEY, remain).catch(function () {});
            return delivered;
        }).catch(function () { return 0; });
    }

    // ---- 点击离线通知：聚焦已开窗口（补投递由 drainQueue 在回前台时完成）----
    try {
        if (!IS_NATIVE && navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener('message', function (e) {
                if (!e || !e.data || e.data.type !== 'CHAT_NOTIFY_CLICK') return;
                try {
                    if (document.hidden === false && window.focus) window.focus();
                    // 回到聊天区：多数页面聊天容器常驻，这里仅确保窗口前置即可
                } catch (x) {}
            });
        }
    } catch (e) {}

    // ---- 生命周期挂载 ----
    function boot() {
        if (IS_NATIVE) return;
        // 开屏就绪后注册 + 分批发补投递（等聊天权威数据就绪再动队列）
        setTimeout(function () { apply(); }, 8000);
        [12000, 27000, 47000].forEach(function (ms) {
            setTimeout(function () { try { drainQueue(); } catch (e) {} }, ms);
        });
        try {
            document.addEventListener('visibilitychange', function () {
                if (document.visibilityState !== 'visible') return;
                try { drainQueue(); } catch (e) {}
                try {
                    if (supported() && enabledProp() && standalone()) {
                        var last = window.__offlineSnapLastAt || 0;
                        if (Date.now() - last > 300000) { window.__offlineSnapLastAt = Date.now(); apply(); }
                    }
                } catch (e) {}
            });
        } catch (e) {}
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    // 暴露：供其他模块/控制台主动刷新快照或补投递
    window.OfflineReminder = {
        apply: apply,
        teardown: teardown,
        buildSnapshot: buildSnapshot,
        drain: drainQueue,
        supported: supported,
        isStandalone: standalone,
        isEnabled: enabledProp,
        snapshotCount: function () { return _snapCount; }
    };
})();