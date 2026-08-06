/* ────────────────────────────────────────────────────────────────
 * 首页改造 · 梦角伪语音模块
 *   - 对方文本消息 20% 概率渲染成语音条样式（下方贴原文字）
 *   - 点击语音条：等待动效（三点跳动）→ 播放动效（wifi弧线循环）→ 静态
 * ──────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    const FAKE_VOICE_PROBABILITY = 0.20;
    const FAKE_VOICE_KEY = 'fakeVoiceEnabled';

    function _isFakeVoiceOn() {
        const stored = localStorage.getItem(FAKE_VOICE_KEY);
        return stored === null ? true : stored === 'true';
    }

    function _syncFakeVoiceUI() {
        const row = document.getElementById('fake-voice-toggle');
        if (row) row.classList.toggle('active', _isFakeVoiceOn());
    }

    window._toggleFakeVoice = function() {
        localStorage.setItem(FAKE_VOICE_KEY, String(!_isFakeVoiceOn()));
        _syncFakeVoiceUI();
    };

    document.addEventListener('DOMContentLoaded', _syncFakeVoiceUI);
    setTimeout(_syncFakeVoiceUI, 500);

    // ─────────── 注入动效 CSS ───────────
    (function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* 等待状态：三点跳动 */
            .voice-bubble.tts-loading .voice-wifi-icon { display: none; }
            .voice-bubble.tts-loading .voice-duration { display: none; }
            .voice-bubble.tts-loading .voice-loading-dots { display: flex; }

            /* 播放状态：弧线动画 */
            .voice-bubble.playing .voice-arc-mid { animation: voiceArcMid 1.6s ease-in-out infinite; }
            .voice-bubble.playing .voice-arc-out { animation: voiceArcOut 1.6s ease-in-out infinite; }

            .voice-arc-mid { opacity: 1; }
            .voice-arc-out { opacity: 1; }

            /* 播放时弧线从动画起点开始 */
            .voice-bubble.playing .voice-arc-mid,
            .voice-bubble.playing .voice-arc-out { opacity: 0; }

            @keyframes voiceArcMid {
                0%    { opacity: 0; }
                15%   { opacity: 1; }
                60%   { opacity: 1; }
                75%   { opacity: 0; }
                100%  { opacity: 0; }
            }
            @keyframes voiceArcOut {
                0%    { opacity: 0; }
                35%   { opacity: 0; }
                50%   { opacity: 1; }
                60%   { opacity: 1; }
                75%   { opacity: 0; }
                100%  { opacity: 0; }
            }

            /* 三点跳动 */
            .voice-loading-dots {
                display: none;
                align-items: center;
                gap: 4px;
                height: 20px;
            }
            .voice-loading-dots span {
                width: 5px; height: 5px;
                border-radius: 50%;
                background: currentColor;
                opacity: 0.5;
                animation: voiceDotBounce 1s ease-in-out infinite;
            }
            .voice-loading-dots span:nth-child(2) { animation-delay: 0.2s; }
            .voice-loading-dots span:nth-child(3) { animation-delay: 0.4s; }
            @keyframes voiceDotBounce {
                0%, 80%, 100% { transform: translateY(0); opacity: 0.3; }
                40% { transform: translateY(-6px); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    })();

    function ready(fn) {
        if (document.readyState !== 'loading') {
            setTimeout(fn, 80);
        } else {
            document.addEventListener('DOMContentLoaded', () => setTimeout(fn, 80));
        }
    }

    ready(function init() {
        const chatContainer = document.getElementById('chat-container');
        if (!chatContainer) return;

        // ─────────── 视频通话按钮 ───────────
        const videocallBtn = document.getElementById('videocall-btn');
        if (videocallBtn) {
            videocallBtn.addEventListener('click', () => {
                if (window.callFeature && typeof window.callFeature.startCall === 'function') {
                    // 如果通话已在进行中，恢复窗口并提示
                    if (window.callFeature.isActive && window.callFeature.isActive()) {
                        window.callFeature.restoreWindow && window.callFeature.restoreWindow();
                        if (typeof showNotification === 'function') showNotification('正在进行视频通话', 'info');
                        return;
                    }
                    window.callFeature.startCall(false);
                } else {
                    if (typeof showNotification === 'function') {
                        showNotification('视频通话功能未就绪', 'error');
                    }
                }
            });
        }

        // ─────────── 监听新消息 ───────────
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((m) => {
                m.addedNodes.forEach((node) => {
                    if (!(node instanceof HTMLElement)) return;
                    if (node.classList && node.classList.contains('message-wrapper')) {
                        maybeFakeVoiceForPartner(node);
                        renderVoiceIfNeeded(node);
                    }
                });
            });
        });
        observer.observe(chatContainer, { childList: true });
        chatContainer.querySelectorAll('.message-wrapper').forEach(renderVoiceIfNeeded);

        // ─────────── 对方文本消息 → 20% 概率改成伪语音 ───────────
        function maybeFakeVoiceForPartner(wrapper) {
            if (!wrapper.classList.contains('received')) return;
            const msgId = wrapper.dataset.msgId || wrapper.dataset.id;
            if (!msgId) return;
            const msg = findMessage(msgId);
            if (!msg) return;
            if (msg.voice || msg.image || msg.type === 'system') return;
            if (!msg.text || !msg.text.trim()) return;
            if (msg._fakeVoiceConsidered) return;
            msg._fakeVoiceConsidered = true;

            if (!_isFakeVoiceOn()) return;
            if (Math.random() >= FAKE_VOICE_PROBABILITY) return;

            const textLen = msg.text.trim().length;
            const duration = Math.max(1, Math.floor(textLen / 3) + Math.floor(Math.random() * 4));
            msg.voice = { url: '', duration: duration, fakeText: msg.text, transcript: '' };
            msg.text = '';
            if (typeof throttledSaveData === 'function') throttledSaveData();
        }

        // ─────────── 渲染语音气泡 ───────────
        function renderVoiceIfNeeded(wrapper) {
            const msgId = wrapper.dataset.msgId || wrapper.dataset.id;
            if (!msgId) return;
            const msg = findMessage(msgId);
            if (!msg || !msg.voice) return;
            if (wrapper.dataset.voiceRendered === '1') return;
            wrapper.dataset.voiceRendered = '1';

            const bubble = wrapper.querySelector('.message');
            if (!bubble) return;

            wrapper.classList.add('has-voice');

            const duration = msg.voice.duration || 0;
            const fakeText = msg.voice.fakeText || '';
            const widthPx = Math.round(80 + Math.min(duration, 60) / 60 * 120);

            bubble.innerHTML = `
                <div class="voice-bubble" data-fake="1" data-duration="${duration}" data-msg-id="${msgId}" style="width:${widthPx}px; display:flex; align-items:center; gap:6px;">
                    <svg class="voice-wifi-icon" viewBox="0 0 22 22" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="6" cy="11" r="1.3" fill="currentColor" stroke="none"/>
                        <path class="voice-arc-mid" d="M10 8 A 3.5 3.5 0 0 1 10 14"/>
                        <path class="voice-arc-out" d="M13 5 A 7 7 0 0 1 13 17"/>
                    </svg>
                    <div class="voice-loading-dots">
                        <span></span><span></span><span></span>
                    </div>
                    <span class="voice-duration">${duration}"</span>
                </div>
                ${fakeText ? `<div class="voice-fake-text">${escapeHtml(fakeText)}</div>` : ''}
            `;
        }

        // ─────────── 当前播放状态 ───────────
        let _currentAudio = null;
        let currentBubble = null;

        function _stopCurrentAudio() {
            if (_currentAudio) {
                _currentAudio.pause();
                _currentAudio = null;
            }
            if (currentBubble) {
                currentBubble.classList.remove('playing', 'tts-loading');
                if (currentBubble._fakeTimer) {
                    clearTimeout(currentBubble._fakeTimer);
                    currentBubble._fakeTimer = null;
                }
                currentBubble = null;
            }
        }

        // ─────────── 点击语音条 ───────────
        document.body.addEventListener('click', async (e) => {
            // 点击语音条本身或字卡文字都触发
            const voiceEl = e.target.closest('.voice-bubble') || 
                            (e.target.closest('.voice-fake-text') && e.target.closest('.message'));
            if (!voiceEl) return;

            // 找到实际的voice-bubble（可能是点字卡区域触发的）
            const messageEl = e.target.closest('.message');
            const bubble = messageEl ? messageEl.querySelector('.voice-bubble') : e.target.closest('.voice-bubble');
            if (!bubble) return;

            if (bubble.classList.contains('tts-loading')) return;

            if (currentBubble === bubble && bubble.classList.contains('playing')) {
                _stopCurrentAudio();
                return;
            }

            _stopCurrentAudio();

            const duration = Number(bubble.dataset.duration) || 3;
            const msgId = bubble.dataset.msgId;

            // ── 有 TTS 配置：走真实语音 ──
            if (window.voiceTTS && window.voiceTTS.isTtsReady() && msgId) {
                const msg = findMessage(msgId);
                const textToSpeak = msg && msg.voice && msg.voice.fakeText ? msg.voice.fakeText : null;

                if (textToSpeak) {
                    currentBubble = bubble;
                    bubble.classList.add('tts-loading');

                    // 在用户点击的瞬间创建 Audio 并静音播放一帧
                    // 目的是让浏览器记住「这是用户交互触发的」
                    const audio = new Audio();
                    audio.volume = 0;
                    audio.play().catch(() => {});

                    try {
                        const audioUrl = await window.voiceTTS.getAudioForMessage(msgId, textToSpeak);
                        if (currentBubble !== bubble) return;

                        bubble.classList.remove('tts-loading');
                        bubble.classList.add('playing');

                        // 复用同一个 Audio 对象，保持用户交互上下文
                        audio.volume = 1;
                        audio.src = audioUrl;
                        audio.load();
                        // 应用用户设置的语速（变速不变调）
                        if (window.voiceTTS && window.voiceTTS.applyPlaybackSettings) {
                            window.voiceTTS.applyPlaybackSettings(audio);
                        }
                        _currentAudio = audio;
                        audio.onended = () => {
                            bubble.classList.remove('playing');
                            if (currentBubble === bubble) currentBubble = null;
                            if (_currentAudio === audio) _currentAudio = null;
                        };
                        audio.onerror = () => {
                            bubble.classList.remove('playing');
                            if (currentBubble === bubble) currentBubble = null;
                            if (_currentAudio === audio) _currentAudio = null;
                            if (typeof showNotification === 'function') showNotification('语音播放失败', 'error');
                        };
                        audio.play().catch(() => {
                            bubble.classList.remove('playing');
                            if (currentBubble === bubble) currentBubble = null;
                            if (_currentAudio === audio) _currentAudio = null;
                        });
                    } catch (err) {
                        bubble.classList.remove('tts-loading', 'playing');
                        currentBubble = null;
                        console.error('[voice-tts] 生成语音失败:', err);
                        if (typeof showNotification === 'function') showNotification('语音生成失败，请检查 API 配置', 'error');
                    }
                    return;
                }
            }

            // ── 无配置：假装播放 ──
            currentBubble = bubble;
            bubble.classList.add('playing');
            bubble._fakeTimer = setTimeout(() => {
                bubble.classList.remove('playing');
                bubble._fakeTimer = null;
                if (currentBubble === bubble) currentBubble = null;
            }, duration * 1000);
        });

        // ─────────── helpers ───────────
        function findMessage(id) {
            if (typeof messages === 'undefined' || !Array.isArray(messages)) return null;
            return messages.find(m => String(m.id) === String(id));
        }
        function escapeHtml(s) {
            return String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }
    });
})();
