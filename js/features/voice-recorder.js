/* ═══════════════════════════════════════════════════════════════
   voice-recorder.js · 语音消息（仿微信按住说话）：
   · 聊天框右侧麦克风按钮，点击切换「按住说话」语音模式
   · 第一次使用请求麦克风权限
   · 按住说话录音，松开发送，上滑取消；再次点麦克风切回文字输入
   · App(Capacitor)：优先走原生 VoiceRecorder 插件（MediaRecorder），稳定可靠；
     web 预览等无原生环境时回退到 getUserMedia + MediaRecorder
   · 都产出 base64 data URL，复用既有 voice 消息结构与语音气泡播放
   ═══════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var state = {
        mode: false,        // false=文字输入 true=语音(按住说话)
        stream: null,       // 麦克风流（仅 web 回退路径使用）
        mediaRecorder: null,
        chunks: [],
        startTime: 0,
        timer: null,
        recording: false,
        cancelling: false
    };

    var micBtn = null, messageInput = null, holdWrap = null, holdBtn = null, holdLabel = null, recHint = null;

    function $(id) { return document.getElementById(id); }

    function initEls() {
        if (micBtn) return;
        micBtn = $('voice-mic-btn');
        messageInput = $('message-input');
        holdWrap = $('voice-hold-wrap');
        holdBtn = $('voice-hold-btn');
        holdLabel = $('voice-hold-label');
        recHint = $('voice-rec-hint');
    }

    function hasNativeRecorder() {
        return !!(window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.VoiceRecorder);
    }

    // web 回退：浏览器 getUserMedia 支持检测
    function supportsWebRecorder() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    }

    function notify(msg, type) {
        if (typeof showNotification === 'function') showNotification(msg, type || 'info', 2400);
    }

    async function ensurePermission() {
        // 原生路径：权限在 start() 时由系统弹窗请求，这里无需预取
        if (hasNativeRecorder()) return;
        if (!supportsWebRecorder()) throw new Error('当前环境不支持麦克风录音');
        if (!state.stream) {
            state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        return state.stream;
    }

    // ── 模式切换 ──────────────────────────────
    function enterVoiceMode() {
        initEls();
        state.mode = true;
        document.body.classList.add('voice-mode');
        if (micBtn) {
            micBtn.classList.add('active');
            micBtn.title = '切换到文字输入';
            micBtn.innerHTML = '<i class="fas fa-keyboard"></i>';
        }
        if (messageInput) messageInput.style.display = 'none';
        if (holdWrap) holdWrap.style.display = 'flex';
        // 收起可能打开的更多面板 / 表情面板（只去掉 active 收起，不 display:none 硬隐藏，
        // 这样语音输入状态下仍可通过 combo-btn 重新打开表情包栏）
        if (typeof window.closeMorePanel === 'function') window.closeMorePanel();
        var picker = $('user-sticker-picker');
        if (picker) picker.classList.remove('active');
    }

    function exitVoiceMode() {
        cancelRecording();
        initEls();
        state.mode = false;
        document.body.classList.remove('voice-mode');
        if (micBtn) {
            micBtn.classList.remove('active');
            micBtn.title = '语音消息';
            micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        }
        if (holdWrap) holdWrap.style.display = 'none';
        if (messageInput) messageInput.style.display = '';
        resetHoldUI();
        // 恢复被语音模式隐藏的表情包栏：清除 inline display:none，避免退出后无法再点开
        var sPicker = $('user-sticker-picker');
        if (sPicker) sPicker.style.display = '';
    }

    async function toggleVoiceMode() {
        initEls();
        if (state.mode) { exitVoiceMode(); return; }
        try {
            await ensurePermission(); // 首次进入触发权限请求
        } catch (e) {
            console.error('[voice-recorder] 权限获取失败', e);
            var denied = e && (e.name || e.message) && /denied|NotAllowed|permission/i.test((e.name || '') + ' ' + (e.message || ''));
            notify(denied ? '麦克风权限被拒绝，请在系统设置中开启后重试' : ('无法使用麦克风：' + (e && e.message ? e.message : '未知原因')), 'error');
            return;
        }
        enterVoiceMode();
    }

    // ── 录音 UI 通用 ──────────────────────────
    function beginRecUi() {
        if (holdWrap) { holdWrap.classList.add('recording'); holdWrap.classList.remove('cancelling'); }
        if (holdLabel) holdLabel.textContent = '松开 发送';
        if (recHint) recHint.style.opacity = '1';
        state.timer = setInterval(function () {
            var sec = Math.max(1, Math.floor((Date.now() - state.startTime) / 1000) + 1);
            if (holdLabel) holdLabel.textContent = sec + '"';
        }, 500);
    }

    function resetHoldUI() {
        if (holdWrap) { holdWrap.classList.remove('recording'); holdWrap.classList.remove('cancelling'); }
        if (holdLabel) holdLabel.textContent = '按住 说话';
        if (recHint) recHint.style.opacity = '0';
    }

    function setCancelling(on) {
        if (!state.recording) return;
        state.cancelling = on;
        if (holdWrap) holdWrap.classList.toggle('cancelling', on);
        if (holdLabel) holdLabel.textContent = on ? '松开 取消' : '松开 发送';
    }

    // ── 录音控制（原生优先）───────────────────
    function startRecording() {
        if (state.recording) return;
        if (hasNativeRecorder()) {
            state.recording = true;
            state.startTime = Date.now();
            state.cancelling = false;
            beginRecUi();
            Capacitor.Plugins.VoiceRecorder.start().catch(function (e) {
                stopNativeRec(false, e);
            });
            return;
        }
        // web 回退
        if (state.stream) {
            startWebRecorder();
        } else {
            toggleVoiceMode();
        }
    }

    function startWebRecorder() {
        try {
            var mime = pickMime();
            var rec = new MediaRecorder(state.stream, mime ? { mimeType: mime } : undefined);
            state.mediaRecorder = rec;
            state.chunks = [];
            rec.ondataavailable = function (e) { if (e.data && e.data.size > 0) state.chunks.push(e.data); };
            rec.start();
            state.recording = true;
            state.startTime = Date.now();
            state.cancelling = false;
            beginRecUi();
        } catch (e) {
            console.error('[voice-recorder] 开始录音失败', e);
            notify('开始录音失败：' + (e && e.message ? e.message : e), 'error');
            state.recording = false;
        }
    }

    function stopRecording() {
        if (!state.recording) return;
        var duration = (Date.now() - state.startTime) / 1000;
        var shouldSend = !state.cancelling;
        var tooShort = duration < 1;
        if (state.timer) { clearInterval(state.timer); state.timer = null; }
        state.recording = false;
        resetHoldUI();

        if (hasNativeRecorder()) {
            stopNativeRec(true, null, { duration: duration, shouldSend: shouldSend, tooShort: tooShort });
            return;
        }
        stopWebRecorder(duration, shouldSend, tooShort);
    }

    function stopNativeRec(send, startErr, info) {
        var duration = (info && info.duration) || 0;
        var shouldSend = send ? !!(info && info.shouldSend) : false;
        var tooShort = send ? !!(info && info.tooShort) : false;

        if (startErr) {
            if (state.timer) { clearInterval(state.timer); state.timer = null; }
            notify('无法开始录音：' + (startErr && startErr.message ? startErr.message : '未知原因'), 'error');
            return;
        }
        if (!shouldSend || tooShort) {
            // 上滑取消 / 时长过短 → 放弃
            if (Capacitor.Plugins.VoiceRecorder.cancel) {
                Capacitor.Plugins.VoiceRecorder.cancel().catch(function () {});
            }
            if (tooShort) notify('说话时间太短，请说长一点再发送', 'info');
            if (!tooShort) notify('已取消录音', 'info');
            return;
        }
        Capacitor.Plugins.VoiceRecorder.stop().then(function (res) {
            var base64 = (res && res.base64) || '';
            var mime = (res && res.mimeType) || 'audio/mp4';
            var dur = Math.max(1, Math.round((res && res.duration) || duration));
            if (!base64) { notify('录音数据无效，请重试', 'error'); return; }
            deliverVoice('data:' + mime + ';base64,' + base64, dur);
        }).catch(function (e) {
            notify('录音失败：' + (e && e.message ? e.message : '未知原因'), 'error');
        });
    }

    function stopWebRecorder(duration, shouldSend, tooShort) {
        var rec = state.mediaRecorder;
        if (!rec) return;
        rec.stop();
        rec.onstop = function () {
            var blob = new Blob(state.chunks, { type: rec.mimeType || 'audio/webm' });
            state.chunks = [];
            if (tooShort) { notify('说话时间太短，请说长一点再发送', 'info'); return; }
            if (!shouldSend) { notify('已取消录音', 'info'); return; }
            var reader = new FileReader();
            reader.onloadend = function () {
                deliverVoice(String(reader.result || ''), Math.max(1, Math.round(duration)));
            };
            reader.readAsDataURL(blob);
        };
    }

    function cancelRecording() {
        if (state.recording) {
            state.cancelling = true;
            stopRecording();
        } else {
            resetHoldUI();
        }
    }

    // ── 发送 ──────────────────────────────────
    function deliverVoice(url, duration) {
        if (!url) { notify('录音数据无效，请重试', 'error'); return; }
        if (typeof addMessage === 'function') {
            addMessage({
                id: Date.now(),
                sender: 'user',
                text: '',
                timestamp: new Date(),
                voice: { url: url, duration: duration, fakeText: '', transcript: '' },
                status: 'sent',
                favorited: false,
                note: null,
                replyTo: null,
                type: 'normal'
            });
        }
        if (typeof playSound === 'function') playSound('send');
        // 触发梦角回复（与发文字/发图一致；批量模式下不自动回复）
        if (typeof window._triggerDelayedReply === 'function' && window._isBatchMode !== true) {
            window._triggerDelayedReply(true);
        }
    }

    // web 回退：选择支持录音的 MIME 类型
    function pickMime() {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
            var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'];
            for (var i = 0; i < list.length; i++) {
                if (MediaRecorder.isTypeSupported(list[i])) return list[i];
            }
        }
        return '';
    }

    // ── 事件绑定 ──────────────────────────────
    function bind() {
        initEls();
        if (!micBtn) return;
        micBtn.addEventListener('click', function (e) {
            e.preventDefault();
            toggleVoiceMode();
        });
        if (!holdBtn) return;
        holdBtn.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            if (!state.mode) return;
            if (hasNativeRecorder()) { startRecording(); return; }
            if (!state.stream) { toggleVoiceMode(); return; }
            startRecording();
        });
        // 上滑取消：按住时监听指针位置
        document.addEventListener('pointermove', function (e) {
            if (!state.recording) return;
            var r = holdBtn.getBoundingClientRect();
            var inside = e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left && e.clientX <= r.right;
            var up = e.clientY < r.top - 40;
            if (inside) setCancelling(false);
            else if (up) setCancelling(true);
        });
        document.addEventListener('pointerup', function () {
            if (state.recording) stopRecording();
        });
        document.addEventListener('pointercancel', function () {
            if (state.recording) cancelRecording();
        });
    }

    // ── 对外暴露 ──────────────────────────────
    window.toggleVoiceMode = toggleVoiceMode;
    window.voiceRecorder = { toggle: toggleVoiceMode, exit: exitVoiceMode };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();