/**
 * sw.js — 手机浏览器后台标签页的"到点系统通知"兜底 Service Worker
 *
 * 背景：浏览器会节流/冻结后台标签页的 JS 定时器（尤其隐藏 5 分钟后的
 * intensive throttling），导致主页面"正在输入→回复→通知"的 setTimeout 链
 * 在后台不执行，只有切回前台才补发——这远不如 APK 端"强保活"。
 *
 * 本 SW 的作用（纯前端尽力而为，与 APK 对齐）：
 *   1. 页面把"下一次自动回复/来信/动态产生时刻"通过 postMessage 同步过来；
 *   2. 无论因何被唤醒（periodic sync / 页面切回 / 浏览器调度），只要到点，
 *      就直接 showNotification 弹系统通知，并尝试唤醒主页面补一条真实消息；
 *   3. 注册 short-term periodic background sync，提升后台被唤醒的机会（能力则用）。
 *
 * 纯增量：不改任何现有页面逻辑；每个环节独立 try，失败不影响主流程。
 */
const SW_VERSION = '1.0.0';

self.addEventListener('install', function () {
    // 新版本立即接管，避免老版本长期占用
    try { self.skipWaiting(); } catch (e) {}
});

self.addEventListener('activate', function (e) {
    e.waitUntil((function () {
        try { return self.clients.claim(); } catch (err) { return Promise.resolve(); }
    })());
});

// 点击通知：聚焦已打开的页面；否则新开/回到应用
self.addEventListener('notificationclick', function (event) {
    if (typeof event.notification !== 'undefined') { try { event.notification.close(); } catch (e) {} }
    var target = '/';
    try {
        if (event.notification && event.notification.data && event.notification.data.url) {
            target = event.notification.data.url;
        } else if (self.registration && self.registration.scope) {
            target = self.registration.scope;
        }
    } catch (e) {}
    var dispatch = function (url) {
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
            for (var i = 0; i < clients.length; i++) {
                if (!clients[i].focused && clients[i].focus) { try { clients[i].focus(); } catch (e2) {} }
                if (clients[i].navigate && clients[i].url && url.indexOf(clients[i].url) === 0) {
                    try { return clients[i].navigate(url); } catch (e2) {}
                }
            }
            if (self.clients.openWindow) { return self.clients.openWindow(url); }
        });
    };
    if (typeof event.waitUntil === 'function') {
        event.waitUntil(dispatch(target));
    } else {
        dispatch(target);
    }
});

// 当前待触发的一次"到点通知"任务：{ at, title, body, tag }
var job = null;

function schedulePeriodicSync() {
    try {
        if (self.registration && self.registration.periodicSync) {
            self.registration.periodicSync.register('reply-due-check', {
                minInterval: 15 * 60 * 1000 // 15 分钟起，浏览器自行折算
            }).catch(function () {}); // 权限/能力不支持则静默放弃
        }
    } catch (e) {}
}

// 到点检查：若任务已到期且未被消费，弹系统通知并唤醒页面补一条真实消息
function fireIfDue() {
    if (!job || !job.at) return;
    var now = Date.now();
    if (job.at > now) return; // 未到点
    var t = job.title || '';
    var b = job.body || '';
    job = null; // 先消费，避免重复

    // 1) 唤醒主页面补真实消息（页面仍 alive 时走原有 simulateReply 链路）
    try {
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
            for (var i = 0; i < clients.length; i++) {
                try { clients[i].postMessage({ type: 'webkeepalive:due' }); } catch (e2) {}
            }
        });
    } catch (e) {}

    // 2) 系统通知兜底：即使主页面被冻结，也保证"到点有新内容即必达"
    try {
        var options = {
            body: b,
            icon: './assets/ct-heart-wings.png',
            badge: './assets/ct-heart-wings.png',
            tag: 'webkeepalive-due',
            renotify: true,
            data: { url: (self.registration && self.registration.scope) || '/' }
        };
        self.registration.showNotification(t, options).then(function () {
            // 用户点击通知时回到应用
        }).catch(function () {});
    } catch (e) {}
}

// 收到页面的消息：同步下一次到点任务 / 手动触发一次检查
self.addEventListener('message', function (event) {
    var data = event.data;
    if (!data) return;
    if (data.type === 'webkeepalive:sync') {
        job = { at: data.at || 0, title: data.title || '', body: data.body || '' };
        try {
            if (typeof event.waitUntil === 'function') {
                event.waitUntil(Promise.all([ fireIfDue() ]));
            }
        } catch (e) {}
        fireIfDue();
    } else if (data.type === 'webkeepalive:check') {
        fireIfDue();
    } else if (data.type === 'webkeepalive:clear') {
        job = null;
    }
});

// 后台周期同步唤醒时检查是否到点
self.addEventListener('periodicsync', function (event) {
    if (event && event.tag === 'reply-due-check') {
        if (typeof event.waitUntil === 'function') {
            event.waitUntil((function () { fireIfDue(); return Promise.resolve(); })());
        } else {
            fireIfDue();
        }
    }
});

// 页面每次被加载/切回，也会触发本 function —— 作为一次随时检查的兜底
schedulePeriodicSync();