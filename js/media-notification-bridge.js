/**
 * media-notification-bridge.js — 系统通知栏媒体播放条桥接层
 *
 * 把 WebView 里 <audio> 的播放信息（歌名/歌手/封面/时长/进度/播停）投送到原生
 * MediaNotificationPlugin，在 Android 系统通知栏渲染一条类似网易云音乐的媒体播放条。
 * 用户点通知栏的 播放/暂停、上一首、下一首 时，原生通过 mediaAction 事件回调到这里，
 * 由上层注册的 controlHandler 继续驱动 <audio>。
 */
(function (global) {
    'use strict';

    var LOG_PREFIX = '[MediaNotif]';

    function getPlugin() {
        if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.MediaNotification) {
            return global.Capacitor.Plugins.MediaNotification;
        }
        return null;
    }

    var controlHandler = null;
    var lastPing = 0;

    function log() {
        if (global.console) {
            console.log.apply(console, [LOG_PREFIX].concat(Array.prototype.slice.call(arguments)));
        }
    }

    // 节流：进度更新不要每次都跨桥，约每 500ms 一次即可
    function maybeUpdateProgress(meta, force) {
        var now = Date.now();
        if (!force && now - lastPing < 500) return;
        lastPing = now;
        var p = getPlugin();
        if (!p || !p.update) return;
        try {
            p.update({
                duration: Math.round(meta.duration || 0),
                position: Math.round(meta.position || 0),
                playing: !!meta.playing
            }).catch(function () {});
        } catch (e) { /* 非原生环境静默 */ }
    }

    var MediaNotif = {
        isSupported: function () {
            try {
                return !!getPlugin();
            } catch (e) {
                return false;
            }
        },

        /**
         * 显示（或刷新）通知栏媒体条。
         * @param meta { title, sub, coverKey, cover, coverUrl, duration, position, playing }
         */
        show: function (meta) {
            var p = getPlugin();
            if (!p || !p.show) return;
            try {
                p.show(meta).catch(function () {});
                lastPing = Date.now();
            } catch (e) { /* 非原生环境静默 */ }
        },

        getProgress: function () { return lastPing; },
        setProgress: function (t) { lastPing = t; },

        /** 更新秒级进度与播停状态。 */
        update: function (position, duration, playing) {
            maybeUpdateProgress({ position: position, duration: duration, playing: playing }, false);
        },

        /** 仅切换播停图标。 */
        setPlaying: function (playing) {
            var p = getPlugin();
            if (!p || !p.setPlaying) return;
            try {
                p.setPlaying({ playing: !!playing }).catch(function () {});
            } catch (e) { /* 非原生环境静默 */ }
        },

        /** 关闭通知栏媒体条。 */
        cancel: function () {
            var p = getPlugin();
            if (!p || !p.cancel) return;
            try {
                p.cancel().catch(function () {});
            } catch (e) { /* 非原生环境静默 */ }
        },

        /**
         * 注册通知栏按钮回调：play / pause / next / prev
         */
        setControlHandler: function (fn) {
            controlHandler = typeof fn === 'function' ? fn : null;
            var p = getPlugin();
            if (!p) return;
            try {
                p.addListener('mediaAction', function (data) {
                    if (controlHandler && data && data.action) {
                        controlHandler(data.action);
                    }
                }).catch(function (e) {
                    console.warn(LOG_PREFIX + ' 监听失败:', e);
                });
            } catch (e) {
                console.warn(LOG_PREFIX + ' 注册媒体通知控制失败:', e);
            }
        },

        /** 手动触发（供单元/调试用）。 */
        _dispatch: function (action) {
            if (controlHandler) controlHandler(action);
        }
    };

    global.MediaNotif = MediaNotif;
})(window);