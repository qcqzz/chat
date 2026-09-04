/**
 * sw.js — Service Worker（浏览器后台）
 *
 * 功能（零后端，纯本地架构）：
 *   1. 离线消息提醒（Periodic Background Sync，源自 Mochi 字卡传讯）
 *      页面全关后，Chromium 按自身策略定期唤醒本 SW：读页面端写入的「可发文案」
 *      快照 → 随机抽一条 → 以梦角名义弹系统通知，同时把该条追加进待投递队列；
 *      用户回开应用后由页面端安全补投递进聊天。
 *      如实边界：仅 Chromium 系支持、需 PWA 添加到主屏、频率由浏览器决定（约数小时一次）、
 *      iOS Safari 无此 API、进程被系统杀死后无法唤醒（那需要真推送服务端，本项目不引入）。
 *   2. 兼容原 push-notification-bridge 的 webkeepalive 消息（webkeepalive:sync/clear）：
 *      页面端把「下一次到点」发给 SW，SW 在后台到点后弹通知或唤醒页面补发真实消息。
 *
 * 注：本 SW 不接管 fetch / 不做离线缓存，避免干扰站点既有加载流程。
 */

var PSYNC_DB = 'chuan-offline-db';
var PSYNC_STORE = 'kv';
var PSYNC_SNAP_KEY = 'chuan:psync-snap';
var PSYNC_QUEUE_KEY = 'chuan:psync-queue';
var PSYNC_TAG = 'chuan-ta-msg';
var PSYNC_TTL = 7 * 24 * 60 * 60 * 1000; // 快照 7 天未刷新（长期没开应用）不再打扰

// ===== IndexedDB 读写（页面端与本 SW 共用同一 DB/表，见 sw.js 注释）=====
function psyncOpenDb() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(PSYNC_DB, 1);
    req.onupgradeneeded = function () {
      try {
        if (!req.result.objectStoreNames.contains(PSYNC_STORE)) {
          req.result.createObjectStore(PSYNC_STORE);
        }
      } catch (e) {}
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('psync idb open fail')); };
  });
}
function psyncIdbGet(key) {
  return psyncOpenDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx;
      try {
        tx = db.transaction(PSYNC_STORE, 'readonly');
      } catch (e) { reject(e); return; }
      var rq = tx.objectStore(PSYNC_STORE).get(key);
      rq.onsuccess = function () { resolve(rq.result); };
      rq.onerror = function () { reject(rq.error); };
    });
  });
}
function psyncIdbSet(key, val) {
  return psyncOpenDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx;
      try {
        tx = db.transaction(PSYNC_STORE, 'readwrite');
      } catch (e) { reject(e); return; }
      tx.objectStore(PSYNC_STORE).put(val, key);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

// ===== 离线消息提醒：periodicsync =====
self.addEventListener('periodicsync', function (e) {
  if (e.tag !== PSYNC_TAG) return;
  e.waitUntil((async function () {
    var snap = await psyncIdbGet(PSYNC_SNAP_KEY);
    if (!snap || !Array.isArray(snap.texts) || !snap.texts.length) return;
    if (!snap.ts || Date.now() - snap.ts > PSYNC_TTL) return;
    var pick = snap.texts[Math.floor(Math.random() * snap.texts.length)];
    var text = pick && pick.t ? String(pick.t) : '';
    if (!text) return;
    // 追加进待投递队列（回前台后由页面端补投递进聊天）
    var arr = [];
    try {
      var q = await psyncIdbGet(PSYNC_QUEUE_KEY);
      if (Array.isArray(q)) arr = q;
    } catch (e2) {}
    arr.push({ t: text, cid: snap.cid || 'default', ts: Date.now(), k: pick.k || '' });
    while (arr.length > 20) arr.shift();
    await psyncIdbSet(PSYNC_QUEUE_KEY, arr);
    // 弹系统通知
    try {
      await self.registration.showNotification(snap.name || '对方', {
        body: text,
        tag: PSYNC_TAG,
        renotify: true,
        icon: 'https://file.youtochat.com/images/20260216/1771224856844_qdqqd.jpeg',
        badge: 'https://file.youtochat.com/images/20260216/1771224856844_qdqqd.jpeg'
      });
    } catch (e3) {
      // 无图标资源时降级为无图标通知，不阻断
      try { await self.registration.showNotification(snap.name || '对方', { body: text, tag: PSYNC_TAG }); } catch (e4) {}
    }
  })().catch(function () {}));
});

// ===== 通知点击：聚焦已有窗口 / 开新窗口，并通知页面端跳聊天 =====
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var tag = (e.notification && e.notification.tag) || '';
  e.waitUntil((function () {
    return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
      if (cs && cs.length) {
        var c = cs[0];
        try { c.focus(); } catch (x) {}
        try { c.postMessage({ type: 'CHAT_NOTIFY_CLICK', tag: tag }); } catch (x) {}
        return;
      }
      return self.clients.openWindow('./').then(function (w) {
        if (!w || !w.postMessage) return;
        // 新开窗口页面脚本可能尚未注册 message 监听，重试几次
        var i = 0;
        var t = setInterval(function () {
          i++;
          try { w.postMessage({ type: 'CHAT_NOTIFY_CLICK', tag: tag }); } catch (x) {}
          if (i >= 3) clearInterval(t);
        }, 800);
      }).catch(function () {});
    });
  })());
});

// ===== 兼容原 webKeepalive 消息（页面后台保活到点弹窗）=====
var _wkTimer = null;
var _wkPending = null;

self.addEventListener('message', function (e) {
  var data = (e && e.data) || {};
  if (data.type === 'webkeepalive:sync') {
    try {
      if (_wkTimer !== null) { clearTimeout(_wkTimer); _wkTimer = null; }
      _wkPending = data;
      var at = Number(data.at) || 0;
      var delay = at - Date.now();
      if (delay < 0) delay = 0;
      _wkTimer = setTimeout(function () { _wkFire(); }, delay);
    } catch (x) {}
    return;
  }
  if (data.type === 'webkeepalive:clear') {
    _wkPending = null;
    if (_wkTimer !== null) { clearTimeout(_wkTimer); _wkTimer = null; }
  }
});

function _wkFire() {
  _wkTimer = null;
  var p = _wkPending;
  _wkPending = null;
  if (!p) return;
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    var anyAlive = cs && cs.length > 0;
    if (anyAlive) {
      // 页面仍存活：唤醒它补一条真实消息
      try { cs[0].postMessage({ type: 'webkeepalive:due' }); } catch (x) {}
      return;
    }
    // 页面全关：直接弹系统通知
    try {
      self.registration.showNotification((p.title || '对方'), {
        body: (p.body || ''),
        tag: 'chuan-wk-due',
        renotify: true,
        icon: 'https://file.youtochat.com/images/20260216/1771224856844_qdqqd.jpeg',
        badge: 'https://file.youtochat.com/images/20260216/1771224856844_qdqqd.jpeg'
      }).catch(function () {
        try { self.registration.showNotification((p.title || '对方'), { body: (p.body || ''), tag: 'chuan-wk-due' }); } catch (e2) {}
      });
    } catch (x) {}
  }).catch(function () {});
}