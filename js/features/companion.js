/**
 * companion.js — 陪伴功能模块
 * 依赖：localforage, APP_PREFIX, getStorageKey, showNotification
 */

(function () {
    'use strict';

    // ─── 常量 ────────────────────────────────────────────────────────────────

    const STORAGE_KEY = 'companionData';

    const MODES = {
        study:    {
            label: '一起学习',
            icon:  'fa-book-open',
            hint:  '正在一起学习 · 加油',
            times: [5,10,15,20,25,30],          // 用户可选
            inviteTimes: [15, 20, 25],          // 梦角主动邀请时随机选
        },
        work:     {
            label: '一起工作',
            icon:  'fa-laptop-code',
            hint:  '正在一起工作 · 专注中',
            times: [5,10,15,20,25,30],
            inviteTimes: [15, 20, 25, 30],
        },
        exercise: {
            label: '一起运动',
            icon:  'fa-person-running',
            hint:  '正在一起运动 · 不要偷懒哦',
            times: [5,10,15,20,25,30],
            inviteTimes: [10, 15, 20],
        },
        sleep:    {
            label: '一起睡觉',
            icon:  'fa-moon',
            hint:  '正在一起睡觉 · 好梦',
            times: [10,20,30,60,'rest'],
            inviteTimes: [30, 60, 'rest'],
        },
    };

    // ─── 运行时状态 ──────────────────────────────────────────────────────────

    let companionData = {
        backgrounds: { study: [], work: [], exercise: [], sleep: [] },
        voices:      { study: [], work: [], exercise: [], sleep: [] },
        noises:      { study: [], work: [], exercise: [], sleep: [] },
        selectedBg:  { study: null, work: null, exercise: null, sleep: null }, // 选中的背景 id
        lastNoiseChoice: { study: null, work: null, exercise: null, sleep: null },
        lastPlayMode:    { study: 'single', work: 'single', exercise: 'single', sleep: 'single' },
        history: []
    };

    let currentMode   = null;   // 'study' | 'work' | 'exercise' | 'sleep'
    let timerInterval = null;
    let timerSeconds  = 0;
    let isCountdown   = true;   // false = 正计时（好好休息）
    let totalSeconds  = 0;
    let currentAudio  = null;
    let currentNoiseAudio = null;  // 白噪音独立 Audio 实例（与 currentAudio 叠加播放）
    let isVoicePanelOpen = false;

    // ─── 存储 ────────────────────────────────────────────────────────────────

    function _emptyData() {
        return {
            backgrounds: { study: [], work: [], exercise: [], sleep: [] },
            voices:      { study: [], work: [], exercise: [], sleep: [] },
            noises:      { study: [], work: [], exercise: [], sleep: [] },
            selectedBg:  { study: null, work: null, exercise: null, sleep: null },
            lastNoiseChoice: { study: null, work: null, exercise: null, sleep: null },
            lastPlayMode:    { study: 'single', work: 'single', exercise: 'single', sleep: 'single' },
            history: []
        };
    }

    async function loadCompanionData() {
        try {
            const key = typeof getStorageKey === 'function'
                ? getStorageKey(STORAGE_KEY)
                : (window.APP_PREFIX || 'CHAT_APP_V3_') + STORAGE_KEY;
            const saved = await localforage.getItem(key);
            if (saved) {
                companionData = Object.assign(_emptyData(), saved);
                // 确保每个场景的 backgrounds 数组存在
                for (const m of Object.keys(MODES)) {
                    if (!companionData.backgrounds[m]) companionData.backgrounds[m] = [];
                }
                // ── 数据迁移：voices 之前是数组（全局共享），现在改成按场景分的对象 ──
                if (Array.isArray(companionData.voices)) {
                    const oldVoices = companionData.voices;
                    companionData.voices = { study: [], work: [], exercise: [], sleep: [] };
                    if (oldVoices.length > 0) {
                        // 旧数据复制到所有场景（不丢失，但用户可以后续去删除）
                        for (const m of Object.keys(MODES)) {
                            companionData.voices[m] = oldVoices.map(v => ({ ...v }));
                        }
                        console.log('[companion] 检测到旧的全局语音库，已迁移到 4 个场景');
                    }
                }
                // 确保每个场景的 voices 数组存在
                if (typeof companionData.voices !== 'object' || Array.isArray(companionData.voices)) {
                    companionData.voices = { study: [], work: [], exercise: [], sleep: [] };
                }
                for (const m of Object.keys(MODES)) {
                    if (!companionData.voices[m]) companionData.voices[m] = [];
                }
                // ── noises 字段补全（老用户没有这个字段）──
                if (typeof companionData.noises !== 'object' || Array.isArray(companionData.noises)) {
                    companionData.noises = { study: [], work: [], exercise: [], sleep: [] };
                }
                for (const m of Object.keys(MODES)) {
                    if (!companionData.noises[m]) companionData.noises[m] = [];
                }
                // ── lastNoiseChoice 字段补全 ──
                if (typeof companionData.lastNoiseChoice !== 'object' || !companionData.lastNoiseChoice) {
                    companionData.lastNoiseChoice = { study: null, work: null, exercise: null, sleep: null };
                }
                for (const m of Object.keys(MODES)) {
                    if (!(m in companionData.lastNoiseChoice)) companionData.lastNoiseChoice[m] = null;
                }
                // ── lastPlayMode 字段补全 ──
                if (typeof companionData.lastPlayMode !== 'object' || !companionData.lastPlayMode) {
                    companionData.lastPlayMode = { study: 'single', work: 'single', exercise: 'single', sleep: 'single' };
                }
                for (const m of Object.keys(MODES)) {
                    if (!(m in companionData.lastPlayMode)) companionData.lastPlayMode[m] = 'single';
                }
            }
        } catch (e) {
            console.warn('[companion] 加载数据失败', e);
        }
    }

    async function saveCompanionData() {
        try {
            const key = typeof getStorageKey === 'function'
                ? getStorageKey(STORAGE_KEY)
                : (window.APP_PREFIX || 'CHAT_APP_V3_') + STORAGE_KEY;

            // 保存前深拷贝并过滤掉：blob URL（刷新失效）、临时上传状态字段
            const toSave = JSON.parse(JSON.stringify(companionData, function (k, v) {
                // 过滤临时字段
                if (k === '_uploading' || k === '_progress' || k === '_localOnly') return undefined;
                // 过滤 blob URL（data 字段只允许 base64 或 oss://）
                if (k === 'data' && typeof v === 'string' && v.startsWith('blob:')) return undefined;
                return v;
            }));
            // 过滤掉 data 为空（被上面过滤掉 blob URL）的背景条目
            const modes = ['study', 'work', 'exercise', 'sleep'];
            modes.forEach(function (m) {
                if (toSave.backgrounds && Array.isArray(toSave.backgrounds[m])) {
                    toSave.backgrounds[m] = toSave.backgrounds[m].filter(function (bg) {
                        return bg && bg.data; // data 为空的条目（blob URL 被过滤）不保存
                    });
                }
            });

            await localforage.setItem(key, toSave);
        } catch (e) {
            console.warn('[companion] 保存数据失败', e);
        }
    }

    // ─── 阶段三B：云端媒体缓存（session 内复用 blob URL，退出陪伴时清理）────
    var _mediaUrlCache = new Map(); // ossRef → blobUrl

    function _clearMediaCache() {
        _mediaUrlCache.forEach(function (blobUrl) {
            try { URL.revokeObjectURL(blobUrl); } catch (e) {}
        });
        _mediaUrlCache.clear();
    }

    /**
     * 从 oss:// 引用获取可播放/可显示的 URL
     * 内存命中直接返回；否则 fetch 后缓存
     */
    async function _resolveMediaUrl(ossRef) {
        if (!ossRef || ossRef.indexOf('oss://') !== 0) return ossRef;
        if (_mediaUrlCache.has(ossRef)) return _mediaUrlCache.get(ossRef);
        if (!window.CloudMedia) throw new Error('CloudMedia 未加载');
        const blobUrl = await window.CloudMedia.fetchUrl(ossRef);
        _mediaUrlCache.set(ossRef, blobUrl);
        return blobUrl;
    }

    /**
     * 上传媒体到云端（8 处上传点共用）
     * @param {string|File} source  base64 字符串或 File 对象（File 优先，避免大文件内存爆炸）
     * @param {string} category
     * @returns {Promise<{data: string, cloudKey: string}>}
     */
    async function _uploadCompanionMedia(source, category) {
        if (!window.CloudMedia || !window.CloudSync || !window.CloudSync.isConnected()) {
            throw new Error('未连接云端');
        }
        const result = await window.CloudMedia.upload(source, category);
        return { data: result.url, cloudKey: result.key };
    }

    // ─── 文件读取工具 ────────────────────────────────────────────────────────

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    // ─── DOM 工具 ────────────────────────────────────────────────────────────

    function $(id) { return document.getElementById(id); }

    function notify(msg, type = 'info') {
        if (typeof showNotification === 'function') showNotification(msg, type);
    }

    // ─── 弹窗：陪伴选择（第一层：选场景）────────────────────────────────────

    function openCompanionModal() {
        // 先移除可能残留的旧弹窗
        const existing = document.getElementById('companion-modal-dynamic');
        if (existing) existing.remove();

        // 动态创建弹窗，用内联样式强制覆盖，避免被原项目的 hideModal 干扰
        // 注意：内层不再用 .modal-content（避免被 hideModal querySelector 抓到）
        const modal = document.createElement('div');
        modal.id = 'companion-modal-dynamic';
        modal.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99998',
            'background:rgba(0,0,0,0.5)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'opacity:1', 'pointer-events:all',
            'animation:companionFadeIn 0.25s ease'
        ].join(';'));

        modal.innerHTML = `
            <div id="companion-modal-card" style="
                background:var(--secondary-bg, #fff);border-radius:20px;padding:28px 24px 20px;
                width:min(92vw, 420px);max-height:85vh;overflow-y:auto;
                box-shadow:0 20px 60px rgba(0,0,0,0.18);
                opacity:1 !important;transform:none !important;
                animation:companionPopIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
            ">
                <div style="display:flex;align-items:center;gap:8px;font-size:18px;font-weight:600;color:var(--text-primary, #1a1a1a);margin-bottom:18px;justify-content:center;">
                    <i class="fas fa-hand-holding-heart" style="color:var(--accent-color, #c5a47e);"></i>
                    <span>陪伴</span>
                </div>
                <div id="companion-cards-wrap" style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;padding:6px 4px;">
                    ${Object.entries(MODES).map(([key, cfg]) => `
                        <div class="companion-mode-card-dyn" data-mode="${key}" style="
                            background:var(--primary-bg, #fafafa);border-radius:14px;padding:22px 12px;cursor:pointer;
                            border:1px solid var(--border-color, rgba(0,0,0,0.06));
                            display:flex;flex-direction:column;align-items:center;gap:10px;
                            transition:all 0.25s ease;user-select:none;
                        ">
                            <div style="
                                width:56px;height:56px;border-radius:50%;
                                background:rgba(var(--accent-color-rgb,197,164,126),0.12);
                                display:flex;align-items:center;justify-content:center;
                            ">
                                <i class="fas ${cfg.icon}" style="font-size:24px;color:var(--accent-color, #c5a47e);"></i>
                            </div>
                            <span style="font-size:14px;font-weight:600;color:var(--text-primary, #1a1a1a);">${cfg.label}</span>
                        </div>
                    `).join('')}
                </div>
                <div style="margin-top:18px;text-align:right;">
                    <button id="companion-dynamic-close" style="
                        padding:8px 20px;border-radius:10px;border:1px solid var(--border-color, rgba(0,0,0,0.1));
                        background:var(--primary-bg, #f5f5f5);color:var(--text-secondary, #666);font-size:13px;cursor:pointer;
                    ">关闭</button>
                </div>
            </div>
        `;

        // 点遮罩关闭
        modal.addEventListener('click', e => {
            if (e.target === modal) closeCompanionModal();
        });

        // 关闭按钮
        modal.querySelector('#companion-dynamic-close').addEventListener('click', closeCompanionModal);

        // 点卡片
        modal.querySelectorAll('.companion-mode-card-dyn').forEach(card => {
            card.addEventListener('click', e => {
                e.stopPropagation();
                selectMode(card.dataset.mode);
            });
            // hover 效果（用 JS 因为内联样式没法用 :hover）
            card.addEventListener('mouseenter', () => {
                card.style.transform = 'translateY(-3px)';
                card.style.borderColor = 'var(--accent-color, #c5a47e)';
                card.style.boxShadow = '0 10px 24px rgba(0,0,0,0.08)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
                card.style.borderColor = 'var(--border-color, rgba(0,0,0,0.06))';
                card.style.boxShadow = '';
            });
        });

        // 注入动画 keyframes（一次性）
        injectKeyframes();

        document.documentElement.appendChild(modal);
        console.log('[companion] 弹窗已创建并挂到 documentElement');
    }

    function closeCompanionModal() {
        // 清理所有可能的弹窗实例（防止守护残留）
        document.querySelectorAll('#companion-modal-dynamic').forEach(el => el.remove());
        // 兼容旧的静态弹窗
        const oldModal = document.getElementById('companion-modal');
        if (oldModal) oldModal.classList.remove('active');
    }

    // ─── 工具：获取梦角信息 + 发送聊天事件（复用通话的接口） ─────────────────

    function getPartnerName() {
        return window.settings?.partnerName ||
            document.getElementById('partner-name')?.textContent.trim() ||
            '梦角';
    }

    function getMyName() {
        return window.settings?.myName || '我';
    }

    function getPartnerAvatarSrc() {
        const img = document.querySelector('#partner-avatar img,[id*="partner-avatar"] img,.partner-avatar img');
        return img ? img.src : null;
    }

    function getMyAvatarSrc() {
        const img = document.querySelector('#my-avatar img,.my-avatar img');
        return img ? img.src : null;
    }

    function sendChatEvent(icon, label, detail) {
        // 复用原项目通话事件的接口，往聊天里加一条记录
        if (typeof window._addCallEvent === 'function') {
            window._addCallEvent(icon, label, detail);
        } else {
            let tries = 0;
            const t = setInterval(() => {
                if (typeof window._addCallEvent === 'function') {
                    clearInterval(t);
                    window._addCallEvent(icon, label, detail);
                }
                if (++tries > 25) clearInterval(t);
            }, 200);
        }
    }

    // ─── 内置台词库 ────────────────────────────────────────────────────────

    const REJECT_LINES = [
        '现在有点事，下次吧',
        '等我一会儿，现在不行',
        '抱歉，现在没空',
        '还在忙，晚点再说',
        '现在不方便',
    ];

    // 梦角主动邀请的台词（按场景区分）
    const INVITE_LINES = {
        study: ['要一起学习吗？', '陪我看会书好吗？'],
        work:  ['一起加油工作吧', '可以陪我一起工作吗？'],
        exercise: ['一起活动一下？', '我想锻炼了，陪我一会？'],
        sleep: ['困了，陪我睡觉好吗？', '一起入睡吧'],
    };

    // ─── 过渡画面文案库（梦角第一人称）──────────────────────────────────────
    const TRANSITION_LINES = {
        userInviteAccept: ['我来了……', '抱歉，久等了……', '在你身边了……'],    // 1
        partnerInviteAccept: ['我在等你……', '等你好久了……', '你终于来了……'],  // 2
        extendUserAccept: ['好，再陪你一会……', '正好，我也不想这么快就走……'],   // 3
        userAcceptExtend: ['再陪我一会', '不想离开你'],                            // 4
        partnerInviteReject: ['好，下次见……', '好，你先忙……', '下次再见……'],   // 5
        userRejectExtend: ['好，下次见……', '好，你先忙……', '下次再见……'],      // 6
        userExit: ['那下次再见……', '那这次先到这里……'],                          // 7
        timeUp: ['时间到了……', '时间过得好快……'],                                // 9
        partnerEarlyLeave: ['我先走了……', '下次再与你一起……'],                   // 10
        partnerGoodbye: ['该起床啦……', '天亮了，新的一天开始了……'],              // 11
    };

    // ─── 过渡画面工具：显示一段 3.5s 的过渡，回调在结束时触发 ──────────────
    let _transitionTimers = []; // 存当前所有 timer，新过渡触发时清除旧的
    // text:      显示的文字
    // onComplete: 过渡完全消失后的回调
    // onShown:    过渡画面完全盖住屏幕后立刻触发的回调（用于"悄悄关闭陪伴页"）
    function showCompanionTransition(text, onComplete, onShown) {
        // 清理之前的过渡和它的所有 timer
        _transitionTimers.forEach(t => clearTimeout(t));
        _transitionTimers = [];
        document.querySelectorAll('.companion-transition').forEach(el => el.remove());

        const avSrc = getPartnerAvatarSrc();
        const avatarHtml = avSrc
            ? `<img src="${avSrc}">`
            : `<i class="fas fa-user"></i>`;

        const el = document.createElement('div');
        el.className = 'companion-transition';
        el.innerHTML = `
            <div class="stars"></div>
            <div class="glow"></div>
            <div class="companion-transition-message">
                <div class="companion-transition-avatar">${avatarHtml}</div>
                <div class="companion-transition-bubble">${escapeHtml(text)}</div>
            </div>
        `;
        document.documentElement.appendChild(el);

        // 触发渐入（下一帧加 active）
        requestAnimationFrame(() => {
            requestAnimationFrame(() => el.classList.add('active'));
        });

        // 过渡画面完全盖住屏幕后（渐入约 1s 完成）触发 onShown
        if (typeof onShown === 'function') {
            const tShown = setTimeout(onShown, 1000);
            _transitionTimers.push(tShown);
        }

        // 3.5 秒后渐出 + 移除 + 回调
        const t1 = setTimeout(() => {
            el.classList.remove('active');
            const t2 = setTimeout(() => {
                if (el.isConnected) el.remove();
                if (typeof onComplete === 'function') onComplete();
            }, 1000); // 等渐出动画完成
            _transitionTimers.push(t2);
        }, 3500);
        _transitionTimers.push(t1);
    }

    // ─── 陪伴时长统计 ───────────────────────────────────────────────────────
    let _sessionStartTime = null;   // 进陪伴页时记录
    let _originalSessionStartTime = null; // 最初的开始时间（不受延长影响）
    let _accumulatedExtendTime = 0; // 之前几段陪伴累计时长（继续陪伴时累加）

    function startSessionClock() {
        _sessionStartTime = Date.now();
        _originalSessionStartTime = Date.now();
        _accumulatedExtendTime = 0;
    }
    function getElapsedSeconds() {
        if (!_sessionStartTime) return 0;
        const cur = (Date.now() - _sessionStartTime) / 1000;
        return Math.floor(cur + _accumulatedExtendTime);
    }
    function accumulateExtendTime() {
        if (_sessionStartTime) {
            _accumulatedExtendTime += (Date.now() - _sessionStartTime) / 1000;
            _sessionStartTime = Date.now();
        }
    }
    function formatElapsed(seconds) {
        seconds = Math.max(0, Math.floor(seconds));
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        const pad = n => String(n).padStart(2, '0');
        if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
        return `${pad(m)}:${pad(s)}`;
    }
    // 获取场景名（"一起学习" → "学习"）
    function getSceneName() {
        const label = MODES[currentMode]?.label || '';
        return label.replace(/^一起/, '');
    }

    function pickRandom(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // ─── 选择场景后：加入"邀请中"等待 + 概率拒绝 ──────────────────────────────

    // 强制结果（用于测试）：null=正常随机，'accept'=强制同意，'reject'=强制拒绝
    let _forceResult = null;

    // 用户点场景卡 → 先让用户选时间 → 选完后再发起邀请
    async function selectMode(mode) {
        currentMode = mode;
        window._companionSessionInitiator = 'user'; // 用户主动发起
        closeCompanionModal();
        // 打开时间选择，用户选完后再走邀请等待流程
        openTimeModal(mode, (selectedTime) => {
            // 时间已经在 openTimeModal 内部设置好（isCountdown/timerSeconds/totalSeconds）
            // 这里只需要发起邀请
            showCompanionInviting(mode);
        });
    }

    // 用户发起接受 → 直接进陪伴页（时间已经在选场景前就选好了）
    function enterAfterUserAccepted() {
        // 时间状态已经在 selectMode → openTimeModal 阶段就 ready 了
        openCompanionPage();
    }

    // 梦角发起接受 → 直接进入陪伴页（用梦角说的那个时间）
    function enterWithInviteTime(mode, time) {
        currentMode = mode;
        window._companionSessionInitiator = 'partner'; // 梦角主动发起
        // 设置时间状态（和 openTimeModal 里点按钮后的逻辑一致）
        if (time === 'rest') {
            isCountdown = false;
            timerSeconds = 0;
            totalSeconds = 0;
        } else {
            isCountdown = true;
            timerSeconds = parseInt(time) * 60;
            totalSeconds = parseInt(time) * 60;
        }
        openCompanionPage();
    }

    // ─── 邀请等待 UI（用户发起后显示）─────────────────────────────────────

    function showCompanionInviting(mode) {
        const cfg = MODES[mode];
        const partnerName = getPartnerName();
        const avSrc = getPartnerAvatarSrc();

        // 计算用户已选的时间文本（用于显示在副标题里，让用户知道梦角看到的邀请内容）
        let userTimeText;
        if (!isCountdown) {
            userTimeText = '好好休息';
        } else {
            const minutes = Math.round(totalSeconds / 60);
            userTimeText = `${minutes} 分钟`;
        }

        // 移除残留
        document.querySelectorAll('#companion-inviting-overlay').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.id = 'companion-inviting-overlay';
        overlay.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99998',
            'background:rgba(15,15,20,0.92)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'animation:companionFadeIn 0.3s ease',
        ].join(';'));

        const avatarHtml = avSrc
            ? `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;">`
            : `<i class="fas fa-user" style="font-size:34px;color:rgba(255,255,255,.85);"></i>`;

        overlay.innerHTML = `
            <div style="
                display:flex;flex-direction:column;align-items:center;gap:18px;
                color:#fff;animation:companionPopIn 0.4s ease;
            ">
                <div style="position:relative;width:96px;height:96px;">
                    <div style="
                        position:absolute;inset:-6px;border-radius:50%;
                        border:2px solid rgba(var(--accent-color-rgb,197,164,126),0.5);
                        animation:companionPulseRing 1.6s ease-out infinite;
                    "></div>
                    <div style="
                        position:absolute;inset:-14px;border-radius:50%;
                        border:2px solid rgba(var(--accent-color-rgb,197,164,126),0.3);
                        animation:companionPulseRing 1.6s ease-out infinite 0.5s;
                    "></div>
                    <div style="
                        width:96px;height:96px;border-radius:50%;overflow:hidden;
                        background:rgba(255,255,255,0.1);
                        display:flex;align-items:center;justify-content:center;
                        border:2px solid rgba(255,255,255,0.15);
                        position:relative;z-index:1;
                    ">${avatarHtml}</div>
                </div>
                <div style="font-size:20px;font-weight:600;letter-spacing:1px;">${partnerName}</div>
                <div style="font-size:13px;color:rgba(255,255,255,0.6);display:flex;align-items:center;gap:8px;">
                    <i class="fas ${cfg.icon}" style="color:var(--accent-color, #c5a47e);"></i>
                    <span>邀请${cfg.label} · ${userTimeText}</span>
                    <span class="inviting-dots" style="display:inline-flex;gap:3px;">
                        <span style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,0.6);animation:companionDot 1.2s infinite;"></span>
                        <span style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,0.6);animation:companionDot 1.2s infinite 0.2s;"></span>
                        <span style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,0.6);animation:companionDot 1.2s infinite 0.4s;"></span>
                    </span>
                </div>
                <button id="companion-inviting-cancel" style="
                    margin-top:30px;width:64px;height:64px;border-radius:50%;border:none;
                    background:linear-gradient(135deg,#ff5252,#c62828);
                    color:#fff;font-size:22px;cursor:pointer;
                    box-shadow:0 6px 20px rgba(255,82,82,.45);
                    display:flex;align-items:center;justify-content:center;
                ">
                    <i class="fas fa-xmark"></i>
                </button>
                <div style="font-size:11px;color:rgba(255,255,255,0.35);">取消</div>
            </div>
        `;

        // 注入动画 keyframes
        injectKeyframes();

        // 给这次 invite 一个唯一 id，防止旧 timer 误操作新 overlay
        const sessionId = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        overlay.dataset.sessionId = sessionId;

        document.documentElement.appendChild(overlay);

        // 取消按钮
        overlay.querySelector('#companion-inviting-cancel').addEventListener('click', () => {
            clearTimeout(window._invitingTimer);
            closeInviting();
            const sceneName = MODES[mode]?.label?.replace(/^一起/, '') || '';
            sendChatEvent('fa-circle-xmark', `取消了对${partnerName}的${sceneName}邀请`, null);
        });

        // 决定结果
        const rejectChance = 0.35;
        const willReject = _forceResult === 'reject'
            ? true
            : _forceResult === 'accept'
                ? false
                : Math.random() < rejectChance;

        // 检查 overlay 还是不是本次 session 的（防止用户取消又立刻再发起，旧 timer 误触新 overlay）
        const isStillThisSession = () => {
            const el = document.getElementById('companion-inviting-overlay');
            return el && el.dataset.sessionId === sessionId;
        };

        if (willReject) {
            // 4~12 秒后拒绝
            const delay = 4000 + Math.random() * 8000;
            window._invitingTimer = setTimeout(() => {
                if (!isStillThisSession()) return;
                closeInviting();
                const line = pickRandom(REJECT_LINES);
                const sceneName = MODES[mode]?.label?.replace(/^一起/, '') || '';
                // 新留痕：梦角拒绝了这次xx邀请
                sendChatEvent('fa-heart-crack', `${partnerName}拒绝了这次${sceneName}邀请`, null);
                if (typeof showNotification === 'function') {
                    showNotification(`${partnerName} 拒绝了陪伴邀请`, 'info');
                }
                // 过渡画面：梦角原话
                showCompanionTransition(`${line}……`);
            }, delay);
        } else {
            // 1~3 秒后接受
            const delay = 1000 + Math.random() * 2000;
            window._invitingTimer = setTimeout(() => {
                if (!isStillThisSession()) return;
                closeInviting();
                // 过渡画面后再进入陪伴
                showCompanionTransition(pickRandom(TRANSITION_LINES.userInviteAccept), () => {
                    enterAfterUserAccepted();
                });
            }, delay);
        }
    }

    function closeInviting() {
        document.querySelectorAll('#companion-inviting-overlay').forEach(el => el.remove());
        clearTimeout(window._invitingTimer);
    }

    // ─── 梦角主动邀请 UI ────────────────────────────────────────────────────

    async function showIncomingCompanion(mode) {
        // 确保数据已加载（梦角主动邀请触发时数据可能还没加载）
        const ok = await ensureDataLoaded();
        if (!ok) return;

        // 如果当前已经在陪伴中或有其他陪伴弹窗/过渡画面在，跳过
        if (document.getElementById('companion-page')?.classList.contains('active')) return;
        if (document.querySelector('#companion-inviting-overlay, #companion-incoming-overlay, #companion-modal-dynamic, #setup-modal-dynamic, #time-modal-dynamic, .companion-transition')) return;
        // 通话中不弹陪伴邀请
        const isCallActive = document.getElementById('call-window')?.classList.contains('visible')
            || document.getElementById('call-incoming-overlay')?.classList.contains('visible')
            || document.getElementById('call-mini-pill')?.classList.contains('visible');
        if (isCallActive) return;

        // 如果没指定 mode，随机选一个
        if (!mode) {
            const modes = Object.keys(MODES);
            mode = modes[Math.floor(Math.random() * modes.length)];
        }
        currentMode = mode;
        const cfg = MODES[mode];
        const partnerName = getPartnerName();
        const avSrc = getPartnerAvatarSrc();
        const baseLine = pickRandom(INVITE_LINES[mode] || INVITE_LINES.study);

        // 梦角自选时间（从 inviteTimes 池里随机选一个）
        const inviteTime = pickRandom(cfg.inviteTimes || [25]);

        // 拼接邀请文案：智能处理"陪你"是否已经在台词里 + rest 特殊处理
        let line;
        if (inviteTime === 'rest') {
            // 睡觉的"好好休息"模式：单独一句更自然
            line = '陪你一起睡到自然醒吧';
        } else {
            const timeText = `${inviteTime} 分钟`;
            // 台词里已经有"陪你"/"陪着你" → 直接加时间
            // 没有 → 末尾是问号/感叹号则直接加" 陪你 XX"，否则加"，陪你 XX"
            if (/陪你|陪着你/.test(baseLine)) {
                line = `${baseLine} ${timeText}`;
            } else if (/[？！?!]$/.test(baseLine)) {
                line = `${baseLine} 陪你 ${timeText}`;
            } else {
                line = `${baseLine}，陪你 ${timeText}`;
            }
        }

        // 移除残留
        document.querySelectorAll('#companion-incoming-overlay').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.id = 'companion-incoming-overlay';
        // 把时间存到 dataset 上，接受按钮可以拿到
        overlay.dataset.inviteTime = inviteTime;
        overlay.dataset.inviteMode = mode;
        overlay.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99998',
            'background:rgba(15,15,20,0.95)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'animation:companionFadeIn 0.35s ease',
        ].join(';'));

        const avatarHtml = avSrc
            ? `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;">`
            : `<i class="fas fa-user" style="font-size:34px;color:rgba(255,255,255,.85);"></i>`;

        overlay.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;gap:18px;color:#fff;">
                <div style="position:relative;width:96px;height:96px;">
                    <div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid rgba(var(--accent-color-rgb,197,164,126),0.5);animation:companionPulseRing 1.6s ease-out infinite;"></div>
                    <div style="position:absolute;inset:-14px;border-radius:50%;border:2px solid rgba(var(--accent-color-rgb,197,164,126),0.3);animation:companionPulseRing 1.6s ease-out infinite 0.5s;"></div>
                    <div style="
                        width:96px;height:96px;border-radius:50%;overflow:hidden;
                        background:rgba(255,255,255,0.1);
                        display:flex;align-items:center;justify-content:center;
                        border:2px solid rgba(255,255,255,0.15);
                        position:relative;z-index:1;
                    ">${avatarHtml}</div>
                </div>
                <div style="font-size:20px;font-weight:600;letter-spacing:1px;">${partnerName}</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.5);display:flex;align-items:center;gap:6px;">
                    <span style="width:6px;height:6px;border-radius:50%;background:var(--accent-color, #c5a47e);animation:companionDot 1.1s step-end infinite;"></span>
                    <span>想和你一起...</span>
                </div>
                <div style="
                    background:rgba(255,255,255,0.08);border-radius:14px;padding:12px 20px;
                    display:flex;align-items:center;gap:10px;max-width:280px;margin-top:4px;
                ">
                    <i class="fas ${cfg.icon}" style="color:var(--accent-color, #c5a47e);font-size:18px;"></i>
                    <span style="font-size:14px;">"${line}"</span>
                </div>
                <div style="display:flex;gap:44px;margin-top:26px;">
                    <button id="companion-incoming-reject" style="
                        display:flex;flex-direction:column;align-items:center;gap:7px;
                        background:none;border:none;cursor:pointer;color:#fff;
                    ">
                        <div style="
                            width:60px;height:60px;border-radius:50%;
                            background:linear-gradient(135deg,#ff5252,#c62828);
                            box-shadow:0 6px 20px rgba(255,82,82,.45);
                            display:flex;align-items:center;justify-content:center;
                            transition:transform 0.15s ease;font-size:22px;
                        "><i class="fas fa-xmark"></i></div>
                        <span style="font-size:12px;color:rgba(255,255,255,.48);font-weight:500;">拒绝</span>
                    </button>
                    <button id="companion-incoming-accept" style="
                        display:flex;flex-direction:column;align-items:center;gap:7px;
                        background:none;border:none;cursor:pointer;color:#fff;
                    ">
                        <div style="
                            width:60px;height:60px;border-radius:50%;
                            background:linear-gradient(135deg,#4caf50,#2e7d32);
                            box-shadow:0 6px 20px rgba(76,175,80,.45);
                            display:flex;align-items:center;justify-content:center;
                            transition:transform 0.15s ease;font-size:22px;padding:0;
                        "><i class="fas fa-heart"></i></div>
                        <span style="font-size:12px;color:rgba(255,255,255,.48);font-weight:500;">接受</span>
                    </button>
                </div>
            </div>
        `;

        injectKeyframes();
        document.documentElement.appendChild(overlay);

        // 播放邀请音效（按 mode 选择）
        try {
            const soundMap = {
                study: 'invite_study',
                work: 'invite_work',
                exercise: 'invite_exercise',
                sleep: 'invite_sleep'
            };
            const soundType = soundMap[mode];
            if (soundType && typeof playSound === 'function') {
                playSound(soundType);
            }
        } catch (e) { console.warn('[companion] invite sound error:', e); }

        // 后台推送通知（仅当页面在后台 + 用户开启了通知）
        try {
            if (typeof window._sendPartnerNotification === 'function') {
                const sceneName = MODES[mode]?.label?.replace(/^一起/, '') || '';
                window._sendPartnerNotification(
                    partnerName + ' 邀请你陪伴',
                    `想和你一起${sceneName}，快来看看吧 ✨`
                );
            }
        } catch (e) { console.warn('[companion] invite notification error:', e); }

        // 60 秒未接听自动消失 → 错过（不走过渡画面）
        const autoTimer = setTimeout(() => {
            if (!overlay.isConnected) return; // 已被其他操作移除了
            try { if (typeof window.stopCurrentSound === 'function') window.stopCurrentSound(); } catch(e) {}
            overlay.remove();
            const sceneName = MODES[mode]?.label?.replace(/^一起/, '') || '';
            sendChatEvent('fa-heart-crack', `错过了${partnerName}的${sceneName}邀请`, null);
            // 写入陪伴日记（错过记录）
            try {
                if (typeof window.addCompanionDiaryEntry === 'function') {
                    // 90% 概率有梦角备注
                    const partnerNote = Math.random() < 0.9
                        ? (typeof window.pickCompanionDiaryCards === 'function' ? window.pickCompanionDiaryCards() : '')
                        : '';
                    window.addCompanionDiaryEntry({
                        id: Date.now(),
                        ts: Date.now(),
                        mode: mode,
                        duration: 0,
                        initiator: 'partner',
                        missed: true,
                        partnerNote: partnerNote,
                        userNote: ''
                    });
                }
            } catch(e) { console.warn('[companion] missed diary entry error:', e); }
        }, 60000);

        // 拒绝
        overlay.querySelector('#companion-incoming-reject').addEventListener('click', () => {
            clearTimeout(autoTimer);
            try { if (typeof window.stopCurrentSound === 'function') window.stopCurrentSound(); } catch(e) {}
            if (overlay.isConnected) overlay.remove();
            const sceneName = MODES[mode]?.label?.replace(/^一起/, '') || '';
            sendChatEvent('fa-heart-crack', `我拒绝了这次${sceneName}邀请`, null);
            // 过渡画面：旁白·梦角第一人称
            showCompanionTransition(pickRandom(TRANSITION_LINES.partnerInviteReject));
        });

        // 接受 → 过渡画面 → 进入陪伴页
        overlay.querySelector('#companion-incoming-accept').addEventListener('click', () => {
            clearTimeout(autoTimer);
            try { if (typeof window.stopCurrentSound === 'function') window.stopCurrentSound(); } catch(e) {}
            if (overlay.isConnected) overlay.remove();
            // 过渡画面：「我在等你……」
            showCompanionTransition(pickRandom(TRANSITION_LINES.partnerInviteAccept), () => {
                enterWithInviteTime(mode, inviteTime);
            });
        });
    }

    // ─── 随机定时邀请（梦角主动） ────────────────────────────────────────

    let _randomInviteTimer = null;

    function scheduleRandomInvite() {
        clearTimeout(_randomInviteTimer);
        // 15~60 分钟随机
        const ms = (15 + Math.random() * 45) * 60 * 1000;
        _randomInviteTimer = setTimeout(() => {
            // 25% 概率真正发起
            if (Math.random() < 0.25) {
                triggerRandomInteraction();
            }
            scheduleRandomInvite(); // 递归继续下一轮
        }, ms);
        console.log(`[companion] 下次互动检查在 ${Math.round(ms/60000)} 分钟后`);
    }

    // 统一来电调度：50% 触发陪伴邀请 / 50% 触发视频通话
    function triggerRandomInteraction() {
        const isCompanionActive = document.getElementById('companion-page')?.classList.contains('active');
        const isCallActive = document.getElementById('call-window')?.classList.contains('visible')
            || document.getElementById('call-incoming-overlay')?.classList.contains('visible')
            || document.getElementById('call-mini-pill')?.classList.contains('visible');
        // 陪伴中或通话中，什么都不触发
        if (isCompanionActive || isCallActive) return;

        // 如果视频通话模块未启用，强制走陪伴邀请
        const callAvailable = window._callModule && window._callModule.isEnabled();
        if (!callAvailable || Math.random() < 0.5) {
            // 50% (或视频不可用时 100%) → 陪伴邀请
            showIncomingCompanion();
        } else {
            // 50% → 视频通话
            window._callModule.showIncomingCall();
        }
    }

    function stopRandomInvite() {
        clearTimeout(_randomInviteTimer);
        _randomInviteTimer = null;
    }

    // ─── 梦角提前离开 ────────────────────────────────────────────────────
    // 在陪伴中每 5 分钟检查一次，5% 概率梦角提前离开（睡觉场景排除）

    const FAREWELL_LINES = [
        '有点事，我先走了',
        '我得忙一下，一会回来',
        '突然有点事，下次再跟你一起',
        '我先走一步，你别太累了',
        '我先离开了，你继续',
        '抱歉，得走了',
    ];

    let _earlyLeaveTimer = null;
    // 强制结果（用于测试）：null=正常随机，true=强制下次检查时离开
    let _forceEarlyLeave = false;

    function scheduleEarlyLeaveCheck() {
        clearTimeout(_earlyLeaveTimer);
        _earlyLeaveTimer = setTimeout(() => {
            // 必须仍然在陪伴中
            if (!document.getElementById('companion-page')?.classList.contains('active')) {
                return;
            }
            // 睡觉场景不会提前离开
            if (currentMode === 'sleep') {
                scheduleEarlyLeaveCheck();
                return;
            }
            // 5% 概率（或者测试模式强制触发）
            if (_forceEarlyLeave || Math.random() < 0.05) {
                _forceEarlyLeave = false;
                triggerEarlyLeave();
            } else {
                scheduleEarlyLeaveCheck();
            }
        }, 5 * 60 * 1000); // 5 分钟
    }

    function stopEarlyLeaveCheck() {
        clearTimeout(_earlyLeaveTimer);
        _earlyLeaveTimer = null;
    }

    // ─── 梦角主动告别（仅正计时·睡觉好好休息）────────────────────────────
    // 计时开始后 4~7 小时随机一个时间点，50% 概率触发
    // 触发：弹梦角头像 + 道别文案 + "再见"按钮，用户必须点才能关

    const PARTNER_GOODNIGHT_LINES = [
        '天亮了，起床啦～',
        '我先起床了，你再睡会儿？',
        '要去处理工作了，一会见',
        '新的一天开始了，一起加油吧！'
    ];

    let _partnerGoodnightTimer = null;
    // 强制结果（用于测试）：null=正常随机，true=强制下次检查时告别
    let _forcePartnerGoodnight = false;

    function schedulePartnerGoodnight() {
        clearTimeout(_partnerGoodnightTimer);
        // 4~7 小时随机一个时间点
        const minMs = 4 * 60 * 60 * 1000;
        const maxMs = 7 * 60 * 60 * 1000;
        const delayMs = minMs + Math.random() * (maxMs - minMs);
        _partnerGoodnightTimer = setTimeout(() => {
            // 必须仍在陪伴中且仍在正计时模式
            if (!document.getElementById('companion-page')?.classList.contains('active')) return;
            if (currentMode !== 'sleep' || isCountdown) return;
            // 50% 概率（或测试模式强制触发）
            if (_forcePartnerGoodnight || Math.random() < 0.5) {
                _forcePartnerGoodnight = false;
                triggerPartnerGoodnight();
            }
            // 注意：只检查这一次，不像 earlyLeave 那样递归（因为是 4~7 小时已经够长，
            //       而且如果没触发，用户睡到自然醒就行，不需要再来一次）
        }, delayMs);
    }

    function stopPartnerGoodnightCheck() {
        clearTimeout(_partnerGoodnightTimer);
        _partnerGoodnightTimer = null;
    }

    function triggerPartnerGoodnight() {
        const partnerName = getPartnerName();
        const line = pickRandom(PARTNER_GOODNIGHT_LINES);
        const avSrc = getPartnerAvatarSrc();

        // 弹出告别提示（等待用户点"再见"才关闭）
        const overlay = document.createElement('div');
        overlay.id = 'companion-goodnight-overlay';
        overlay.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99999',
            'background:rgba(15,15,20,0.92)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'animation:companionFadeIn 1.8s ease',
        ].join(';'));

        const avatarHtml = avSrc
            ? `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;">`
            : `<i class="fas fa-user" style="font-size:30px;color:rgba(255,255,255,.85);"></i>`;

        overlay.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;gap:20px;color:#fff;max-width:300px;padding:0 20px;animation:companionPopIn 2s ease;">
                <div style="
                    width:80px;height:80px;border-radius:50%;overflow:hidden;
                    background:rgba(255,255,255,0.1);
                    display:flex;align-items:center;justify-content:center;
                    border:2px solid rgba(255,255,255,0.15);
                ">${avatarHtml}</div>
                <div style="font-size:18px;font-weight:600;letter-spacing:1px;">${partnerName}</div>
                <div style="
                    background:rgba(255,255,255,0.08);border-radius:14px;padding:14px 22px;
                    display:flex;align-items:center;gap:10px;text-align:center;
                ">
                    <i class="fas fa-sun" style="color:var(--accent-color,#c5a47e);font-size:16px;"></i>
                    <span style="font-size:14px;">${line}</span>
                </div>
                <button id="companion-goodnight-ack" style="
                    margin-top:14px;
                    padding:10px 32px;
                    border-radius:22px;
                    border:1px solid rgba(255,255,255,0.25);
                    background:rgba(255,255,255,0.1);
                    color:#fff;font-size:14px;letter-spacing:1.5px;
                    cursor:pointer;
                    transition:all 0.2s ease;
                ">再见</button>
            </div>
        `;

        injectKeyframes();
        document.documentElement.appendChild(overlay);

        // 写入聊天记录（带时长，用场景图标，睡觉场景就是月亮）
        const elapsed = formatElapsed(getElapsedSeconds());
        const sceneIcon = MODES[currentMode]?.icon || 'fa-moon';
        sendChatEvent(sceneIcon, `${partnerName}说了再见`, elapsed);

        // "再见" 按钮 → 显示过渡画面（覆盖后悄悄关闭陪伴页）
        const ackBtn = overlay.querySelector('#companion-goodnight-ack');
        if (ackBtn) {
            ackBtn.addEventListener('click', () => {
                if (overlay.isConnected) overlay.remove();
                showCompanionTransition(
                    pickRandom(TRANSITION_LINES.partnerGoodbye),
                    null,
                    () => closeCompanionPage({ skipLogEvent: true })
                );
            });
            ackBtn.addEventListener('mouseenter', () => {
                ackBtn.style.background = 'rgba(255,255,255,0.18)';
            });
            ackBtn.addEventListener('mouseleave', () => {
                ackBtn.style.background = 'rgba(255,255,255,0.1)';
            });
        }
    }

    function triggerEarlyLeave() {
        const partnerName = getPartnerName();
        const line = pickRandom(FAREWELL_LINES);
        const avSrc = getPartnerAvatarSrc();

        // 弹出告别提示（等待用户点"知道了"按钮才关闭）
        const overlay = document.createElement('div');
        overlay.id = 'companion-farewell-overlay';
        overlay.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99999',
            'background:rgba(15,15,20,0.92)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'animation:companionFadeIn 1.8s ease',
        ].join(';'));

        const avatarHtml = avSrc
            ? `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;">`
            : `<i class="fas fa-user" style="font-size:30px;color:rgba(255,255,255,.85);"></i>`;

        overlay.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;gap:20px;color:#fff;max-width:300px;padding:0 20px;animation:companionPopIn 2s ease;">
                <div style="
                    width:80px;height:80px;border-radius:50%;overflow:hidden;
                    background:rgba(255,255,255,0.1);
                    display:flex;align-items:center;justify-content:center;
                    border:2px solid rgba(255,255,255,0.15);
                ">${avatarHtml}</div>
                <div style="font-size:18px;font-weight:600;letter-spacing:1px;">${partnerName}</div>
                <div style="
                    background:rgba(255,255,255,0.08);border-radius:14px;padding:14px 22px;
                    display:flex;align-items:center;gap:10px;text-align:center;
                ">
                    <i class="fas fa-hand" style="color:var(--accent-color, #c5a47e);font-size:16px;"></i>
                    <span style="font-size:14px;">${line}</span>
                </div>
                <button id="companion-farewell-ack" style="
                    margin-top:14px;
                    padding:10px 32px;
                    border-radius:22px;
                    border:1px solid rgba(255,255,255,0.25);
                    background:rgba(255,255,255,0.1);
                    color:#fff;font-size:14px;letter-spacing:1.5px;
                    cursor:pointer;
                    transition:all 0.2s ease;
                ">知道了</button>
            </div>
        `;

        injectKeyframes();
        document.documentElement.appendChild(overlay);

        // 写入聊天记录（带时长，用场景图标）
        const elapsed = formatElapsed(getElapsedSeconds());
        const sceneIcon = MODES[currentMode]?.icon || 'fa-hand';
        sendChatEvent(sceneIcon, `${partnerName}提前离开了陪伴`, elapsed);

        // "知道了" 按钮点击 → 显示过渡画面（覆盖后悄悄关闭陪伴页）
        const ackBtn = overlay.querySelector('#companion-farewell-ack');
        if (ackBtn) {
            ackBtn.addEventListener('click', () => {
                if (overlay.isConnected) overlay.remove();
                showCompanionTransition(
                    pickRandom(TRANSITION_LINES.partnerEarlyLeave),
                    null,
                    () => closeCompanionPage({ skipLogEvent: true })
                );
            });
            ackBtn.addEventListener('mouseenter', () => {
                ackBtn.style.background = 'rgba(255,255,255,0.18)';
            });
            ackBtn.addEventListener('mouseleave', () => {
                ackBtn.style.background = 'rgba(255,255,255,0.1)';
            });
        }
    }

    // ─── 动画 keyframes 注入（一次性）────────────────────────────────────

    function injectKeyframes() {
        if (document.getElementById('companion-keyframes')) return;
        const style = document.createElement('style');
        style.id = 'companion-keyframes';
        style.textContent = `
            @keyframes companionFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes companionPopIn { from { opacity: 0; transform: scale(0.94) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            @keyframes companionPulseRing {
                0% { transform: scale(0.95); opacity: 0.6; }
                70% { transform: scale(1.15); opacity: 0; }
                100% { transform: scale(1.15); opacity: 0; }
            }
            @keyframes companionDot {
                0%, 60%, 100% { opacity: 0.3; transform: scale(1); }
                30% { opacity: 1; transform: scale(1.4); }
            }
        `;
        document.head.appendChild(style);
    }

    // ─── 初始化流程（首次）──────────────────────────────────────────────────

    // 动态创建设置弹窗的通用容器
    function _createDynamicModal(id, contentHtml) {
        // 移除残留
        const existing = document.getElementById(id);
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = id;
        modal.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99998',
            'background:rgba(0,0,0,0.5)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'opacity:1', 'pointer-events:all',
            'animation:companionFadeIn 0.25s ease'
        ].join(';'));

        modal.innerHTML = `
            <div style="
                background:#fff;border-radius:20px;padding:28px 24px 20px;
                width:min(92vw, 460px);max-height:85vh;overflow-y:auto;
                box-shadow:0 20px 60px rgba(0,0,0,0.18);
                animation:companionPopIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
            ">${contentHtml}</div>
        `;
        document.documentElement.appendChild(modal);
        return modal;
    }

    function openSetupModal(mode) {
        const cfg = MODES[mode];
        window._setupPendingBg = null;
        window._setupPendingVoices = [];

        const html = `
            <div style="display:flex;align-items:center;gap:8px;font-size:18px;font-weight:600;color:#1a1a1a;margin-bottom:14px;justify-content:center;">
                <i class="fas ${cfg.icon}" style="color:var(--accent-color, #c5a47e);"></i>
                <span>${cfg.label}</span>
            </div>
            <div id="setup-dyn-step-bg">
                <p style="font-size:13px;color:#888;text-align:center;margin:6px 0 16px;line-height:1.6;">请上传一张梦角的图片或视频，作为陪伴背景 ✦</p>
                <div id="setup-dyn-bg-preview" style="display:none;width:100%;height:160px;border-radius:12px;overflow:hidden;margin-bottom:12px;background:#000;"></div>
                <div id="setup-dyn-bg-trigger" style="
                    border:2px dashed rgba(var(--accent-color-rgb,197,164,126),0.5);border-radius:14px;padding:24px 16px;
                    display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;
                    background:rgba(var(--accent-color-rgb,197,164,126),0.04);transition:all 0.2s ease;
                ">
                    <i class="fas fa-cloud-arrow-up" style="font-size:28px;color:var(--accent-color, #c5a47e);"></i>
                    <span style="font-size:14px;font-weight:600;color:#1a1a1a;">点击上传图片 / 视频</span>
                    <small style="font-size:11px;color:#888;">支持 jpg · png · gif · mp4 · mov，建议 ≤ 100MB</small>
                </div>
                <input type="file" id="setup-dyn-bg-input" accept="image/*,video/*" style="display:none">
                <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">
                    <button id="setup-dyn-btn-cancel" style="padding:8px 20px;border-radius:10px;border:1px solid rgba(0,0,0,0.1);background:#f5f5f5;color:#666;font-size:13px;cursor:pointer;">取消</button>
                    <button id="setup-dyn-btn-next" style="display:none;padding:8px 20px;border-radius:10px;border:none;background:var(--accent-color, #c5a47e);color:#fff;font-size:13px;cursor:pointer;">下一步 →</button>
                </div>
            </div>
            <div id="setup-dyn-step-voice" style="display:none;">
                <p style="font-size:13px;color:#888;text-align:center;margin:6px 0 16px;line-height:1.6;">上传梦角的语音，点击屏幕时会随机播放 ✦</p>
                <div id="setup-dyn-voice-trigger" style="
                    border:2px dashed rgba(var(--accent-color-rgb,197,164,126),0.5);border-radius:14px;padding:14px 16px;
                    display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;
                    background:rgba(var(--accent-color-rgb,197,164,126),0.04);transition:all 0.2s ease;
                ">
                    <i class="fas fa-microphone" style="font-size:20px;color:var(--accent-color, #c5a47e);"></i>
                    <span style="font-size:13px;font-weight:600;color:#1a1a1a;">点击上传语音</span>
                    <small style="font-size:11px;color:#888;">支持 mp3 · m4a · wav，可多选</small>
                </div>
                <input type="file" id="setup-dyn-voice-input" accept="*/*" multiple style="display:none">
                <div id="setup-dyn-voice-list" style="margin-top:10px;display:flex;flex-direction:column;gap:8px;max-height:200px;overflow-y:auto;"></div>
                <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">
                    <button id="setup-dyn-btn-skip" style="padding:8px 20px;border-radius:10px;border:1px solid rgba(0,0,0,0.1);background:#f5f5f5;color:#666;font-size:13px;cursor:pointer;">跳过</button>
                    <button id="setup-dyn-btn-finish" style="padding:8px 20px;border-radius:10px;border:none;background:var(--accent-color, #c5a47e);color:#fff;font-size:13px;cursor:pointer;">✓ 完成</button>
                </div>
            </div>
        `;

        const modal = _createDynamicModal('setup-modal-dynamic', html);

        // 点遮罩关闭
        modal.addEventListener('click', e => {
            if (e.target === modal) closeSetupModalDyn();
        });

        // 背景上传触发
        modal.querySelector('#setup-dyn-bg-trigger').addEventListener('click', () => {
            modal.querySelector('#setup-dyn-bg-input').click();
        });

        // 背景文件选择
        modal.querySelector('#setup-dyn-bg-input').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const isVideo = file.type.startsWith('video/');
            const isImage = file.type.startsWith('image/');
            if (!isVideo && !isImage) { notify('请上传图片或视频文件', 'error'); return; }
            if (file.size > 100 * 1024 * 1024) notify('文件超过 100MB，加载可能较慢', 'warning');

            notify('正在处理文件...', 'info');
            const base64 = await readFileAsBase64(file);
            // 阶段三B：连了云端就上传，本地 pending 只存引用
            let mediaData = base64;
            let cloudKey = null;
            try {
                notify('正在上传到云端...', 'info', 2000);
                const r = await _uploadCompanionMedia(base64, 'companion-backgrounds');
                mediaData = r.data;
                cloudKey = r.cloudKey;
            } catch (e) {
                console.warn('[companion] setup 背景云端上传失败，降级本地', e);
            }
            window._setupPendingBg = { type: isVideo ? 'video' : 'image', data: mediaData, cloudKey, name: file.name };

            const preview = modal.querySelector('#setup-dyn-bg-preview');
            preview.innerHTML = '';
            if (isVideo) {
                const v = document.createElement('video');
                v.src = base64; v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true;
                v.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                preview.appendChild(v);
            } else {
                const img = document.createElement('img');
                img.src = base64;
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                preview.appendChild(img);
            }
            preview.style.display = 'block';
            modal.querySelector('#setup-dyn-btn-next').style.display = 'inline-flex';
            e.target.value = '';
        });

        // 取消按钮
        modal.querySelector('#setup-dyn-btn-cancel').addEventListener('click', closeSetupModalDyn);

        // 下一步：跳到语音步骤
        modal.querySelector('#setup-dyn-btn-next').addEventListener('click', () => {
            if (!window._setupPendingBg) { notify('请先上传背景', 'warning'); return; }
            modal.querySelector('#setup-dyn-step-bg').style.display = 'none';
            modal.querySelector('#setup-dyn-step-voice').style.display = 'block';
        });

        // 语音上传触发
        modal.querySelector('#setup-dyn-voice-trigger').addEventListener('click', () => {
            modal.querySelector('#setup-dyn-voice-input').click();
        });

        // 语音文件选择
        modal.querySelector('#setup-dyn-voice-input').addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            let addedCount = 0;
            let skippedCount = 0;
            for (const file of files) {
                // 兼容 iOS：用 type 或文件后缀判断
                const isAudio = file.type.startsWith('audio/') ||
                    /\.(mp3|m4a|aac|wav|ogg|flac|amr|opus)$/i.test(file.name);
                if (!isAudio) {
                    skippedCount++;
                    continue;
                }
                try {
                    const base64 = await readFileAsBase64(file);
                    let mediaData = base64;
                    let cloudKey = null;
                    try {
                        const r = await _uploadCompanionMedia(base64, 'companion-voices');
                        mediaData = r.data;
                        cloudKey = r.cloudKey;
                    } catch (e) {
                        console.warn('[companion] setup 语音云端上传失败，降级本地', e);
                    }
                    window._setupPendingVoices.push({
                        id: generateId(), data: mediaData, cloudKey,
                        name: file.name.replace(/\.[^/.]+$/, ''),
                        addedAt: Date.now()
                    });
                    addedCount++;
                } catch (err) {
                    console.error('[companion] 语音读取失败', err);
                    skippedCount++;
                }
            }
            renderSetupVoiceListDyn(modal);
            if (skippedCount > 0 && addedCount === 0) {
                notify('请选择音频文件（mp3/m4a/wav 等），不能上传图片或视频', 'warning');
            } else if (skippedCount > 0) {
                notify(`已添加 ${addedCount} 段，${skippedCount} 个非音频文件已跳过`, 'info');
            }
            e.target.value = '';
        });

        // 跳过：保存背景直接进入时间选择
        modal.querySelector('#setup-dyn-btn-skip').addEventListener('click', async () => {
            if (!window._setupPendingBg) { notify('请先上传背景', 'warning'); return; }
            const bg = { id: generateId(), ...window._setupPendingBg, addedAt: Date.now() };
            companionData.backgrounds[currentMode].push(bg);
            await saveCompanionData();
            closeSetupModalDyn();
            openTimeModal(currentMode);
        });

        // 完成：保存全部
        modal.querySelector('#setup-dyn-btn-finish').addEventListener('click', async () => {
            if (!window._setupPendingBg) { notify('请先上传背景图片或视频', 'warning'); return; }
            const bg = { id: generateId(), ...window._setupPendingBg, addedAt: Date.now() };
            companionData.backgrounds[currentMode].push(bg);
            if (window._setupPendingVoices && window._setupPendingVoices.length) {
                if (!companionData.voices[currentMode]) companionData.voices[currentMode] = [];
                companionData.voices[currentMode].push(...window._setupPendingVoices);
            }
            await saveCompanionData();
            closeSetupModalDyn();
            notify('设置完成！', 'success');
            openTimeModal(currentMode);
        });

        console.log('[companion] 设置弹窗已打开');
    }

    function closeSetupModalDyn() {
        document.querySelectorAll('#setup-modal-dynamic').forEach(el => el.remove());
        window._setupPendingBg = null;
        window._setupPendingVoices = [];
    }

    function renderSetupVoiceListDyn(modal) {
        const list = modal.querySelector('#setup-dyn-voice-list');
        const voices = window._setupPendingVoices || [];
        if (!voices.length) {
            list.innerHTML = '<p style="font-size:12px;color:#888;text-align:center;padding:8px 0;">暂无语音，可跳过</p>';
            return;
        }
        list.innerHTML = voices.map((v, i) => `
            <div style="display:flex;align-items:center;gap:8px;background:rgba(var(--accent-color-rgb,197,164,126),0.07);border-radius:10px;padding:8px 10px;">
                <i class="fas fa-music" style="color:var(--accent-color, #c5a47e);font-size:14px;"></i>
                <input type="text" value="${v.name}" data-idx="${i}" class="setup-dyn-voice-name"
                    style="flex:1;border:none;background:transparent;font-size:13px;outline:none;min-width:0;">
                <button data-id="${v.id}" class="setup-dyn-voice-del"
                    style="background:none;border:none;cursor:pointer;padding:4px 6px;border-radius:6px;color:#888;">
                    <i class="fas fa-trash-can"></i>
                </button>
            </div>
        `).join('');

        list.querySelectorAll('.setup-dyn-voice-name').forEach(inp => {
            inp.addEventListener('change', e => {
                const idx = parseInt(e.target.dataset.idx);
                if (window._setupPendingVoices[idx]) window._setupPendingVoices[idx].name = e.target.value;
            });
        });
        list.querySelectorAll('.setup-dyn-voice-del').forEach(btn => {
            btn.addEventListener('click', e => {
                const id = e.currentTarget.dataset.id;
                window._setupPendingVoices = window._setupPendingVoices.filter(v => v.id !== id);
                renderSetupVoiceListDyn(modal);
            });
        });
    }

    function closeSetupModal() {
        closeSetupModalDyn();
        const oldSetup = document.getElementById('setup-modal');
        if (oldSetup) oldSetup.classList.remove('active');
    }


    // ─── 时间选择弹窗 ────────────────────────────────────────────────────────

    function openTimeModal(mode, onSelected) {
        const cfg = MODES[mode];

        const timesHtml = cfg.times.map(t => {
            if (t === 'rest') {
                return `<button class="time-btn-dyn" data-time="rest" style="
                    background:var(--secondary-bg, #fff);border:1.5px solid var(--border-color, #eee);border-radius:14px;padding:16px 8px;cursor:pointer;
                    display:flex;flex-direction:column;align-items:center;gap:4px;transition:all 0.2s ease;
                ">
                    <i class="fas fa-cloud-moon" style="font-size:20px;color:var(--accent-color, #c5a47e);"></i>
                    <span style="font-size:13px;font-weight:600;color:var(--text-primary, #1a1a1a);">好好休息</span>
                </button>`;
            }
            return `<button class="time-btn-dyn" data-time="${t}" style="
                background:var(--secondary-bg, #fff);border:1.5px solid var(--border-color, #eee);border-radius:14px;padding:16px 8px;cursor:pointer;
                display:flex;flex-direction:column;align-items:center;gap:4px;transition:all 0.2s ease;
            ">
                <span style="font-size:22px;font-weight:700;color:var(--accent-color, #c5a47e);line-height:1;">${t}</span>
                <span style="font-size:11px;color:var(--text-secondary, #888);">分钟</span>
            </button>`;
        }).join('');

        const html = `
            <div style="display:flex;align-items:center;gap:8px;font-size:18px;font-weight:600;color:var(--text-primary, #1a1a1a);margin-bottom:10px;justify-content:center;">
                <i class="fas ${cfg.icon}" style="color:var(--accent-color, #c5a47e);"></i>
                <span>${cfg.label}</span>
            </div>
            <p style="font-size:13px;color:var(--text-secondary, #888);text-align:center;margin:6px 0 16px;">这次陪你多久？</p>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0 18px;">${timesHtml}</div>
            <div style="margin-top:18px;text-align:right;">
                <button id="time-dyn-close" style="
                    padding:8px 20px;border-radius:10px;border:1px solid var(--border-color, rgba(0,0,0,0.1));
                    background:var(--primary-bg, #f5f5f5);color:var(--text-secondary, #666);font-size:13px;cursor:pointer;
                ">取消</button>
            </div>
        `;

        const modal = _createDynamicModal('time-modal-dynamic', html);

        modal.addEventListener('click', e => {
            if (e.target === modal) closeTimeModalDyn();
        });

        modal.querySelector('#time-dyn-close').addEventListener('click', closeTimeModalDyn);

        modal.querySelectorAll('.time-btn-dyn').forEach(btn => {
            btn.addEventListener('click', () => {
                const t = btn.dataset.time;
                closeTimeModalDyn();
                if (t === 'rest') {
                    isCountdown = false;
                    timerSeconds = 0;
                    totalSeconds = 0;
                } else {
                    isCountdown = true;
                    timerSeconds = parseInt(t) * 60;
                    totalSeconds = parseInt(t) * 60;
                }
                // 如果调用方提供了回调，走回调；否则按老逻辑直接进陪伴页
                if (typeof onSelected === 'function') {
                    onSelected(t);
                } else {
                    openCompanionPage();
                }
            });
            btn.addEventListener('mouseenter', () => {
                btn.style.borderColor = 'var(--accent-color, #c5a47e)';
                btn.style.background = 'rgba(var(--accent-color-rgb,197,164,126),0.08)';
                btn.style.transform = 'translateY(-2px)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.borderColor = 'var(--border-color, #eee)';
                btn.style.background = 'var(--secondary-bg, #fff)';
                btn.style.transform = '';
            });
        });

        console.log('[companion] 时间选择弹窗已打开');
    }

    function closeTimeModalDyn() {
        document.querySelectorAll('#time-modal-dynamic').forEach(el => el.remove());
    }

    function closeTimeModal() {
        closeTimeModalDyn();
    }

    window._selectTime = function (t) {
        closeTimeModal();
        if (t === 'rest') {
            isCountdown = false;
            timerSeconds = 0;
            totalSeconds = 0;
        } else {
            isCountdown = true;
            timerSeconds = t * 60;
            totalSeconds = t * 60;
        }
        openCompanionPage();
    };

    // ─── 陪伴页面 ────────────────────────────────────────────────────────────

    function openCompanionPage(opts) {
        opts = opts || {};
        const cfg = MODES[currentMode];
        const page = $('companion-page');

        if (!page) {
            notify('陪伴页面加载失败，请刷新页面重试', 'error');
            console.error('[companion] companion-page 元素不存在！');
            return;
        }

        // 防御：清理可能残留的白噪音（避免上次未完全关闭时新陪伴叠加播放）
        stopNoise();

        // 设置背景：优先用用户选定的背景，没有选定时用第一个
        const bgs = companionData.backgrounds[currentMode];
        let bg = null;
        if (bgs && bgs.length > 0) {
            const selectedId = companionData.selectedBg && companionData.selectedBg[currentMode];
            bg = (selectedId && bgs.find(b => b.id === selectedId)) || bgs[0];
        }
        renderCompanionBackground(bg);

        // 设置提示文字
        const hint = $('companion-hint-text');
        if (hint) hint.textContent = cfg.hint;

        // 设置玻璃球计时器副标题（场景名英文缩写）
        const timerLabel = $('companion-timer-label');
        if (timerLabel) {
            const labels = { study: 'STUDY', work: 'WORK', exercise: 'EXERCISE', sleep: 'SLEEP' };
            timerLabel.textContent = labels[currentMode] || '';
        }

        // 初始化计时器显示
        updateTimerDisplay();

        // 显示页面
        page.classList.add('active');
        document.body.style.overflow = 'hidden';

        // 启动会话时钟（统计陪伴时长用）
        // 注意：恢复闪退会话时不要重置时钟（保留 resumeFromSession 里设置的 _sessionStartTime）
        if (!opts.isResume) {
            startSessionClock();
        }

        // 清空本次陪伴的对话记录
        _sessionDialogue = [];

        // 启动计时器
        startTimer();

        // 续播上次的白噪音（如果有）
        resumeLastNoise();

        console.log('[companion] 陪伴页面已打开' + (opts.isResume ? '（闪退恢复）' : ''));
    }

    async function renderCompanionBackground(bg) {
        const container = $('companion-bg-container');
        const page = $('companion-page');
        if (!container) return;
        container.innerHTML = '';

        if (!bg) {
            const fallback = document.createElement('div');
            fallback.style.cssText = `
                position:absolute;inset:0;
                background:
                    radial-gradient(ellipse at 30% 20%, rgba(var(--accent-color-rgb, 197,164,126), 0.32) 0%, transparent 60%),
                    radial-gradient(ellipse at 75% 75%, rgba(var(--accent-color-rgb, 197,164,126), 0.22) 0%, transparent 60%),
                    linear-gradient(135deg, #FFF2E2 0%, #FCE8D0 50%, #FFF2E2 100%);
            `;
            container.appendChild(fallback);
            if (page) page.classList.add('companion-light-bg');
            return;
        }

        if (page) page.classList.remove('companion-light-bg');

        // 阶段三B：oss:// 引用先 fetch blob URL
        let mediaSrc = bg.data;
        if (typeof mediaSrc === 'string' && mediaSrc.indexOf('oss://') === 0) {
            try {
                mediaSrc = await _resolveMediaUrl(mediaSrc);
            } catch (e) {
                console.warn('[companion] 背景加载失败', e);
                notify('背景加载失败，请检查网络', 'error');
                return;
            }
        }

        if (bg.type === 'video') {
            const v = document.createElement('video');
            v.src = mediaSrc;
            v.autoplay = true;
            v.loop = true;
            v.playsInline = true;
            v.className = 'companion-bg-media';
            container.appendChild(v);
        } else {
            const img = document.createElement('img');
            img.src = mediaSrc;
            img.className = 'companion-bg-media';
            container.appendChild(img);
        }
    }

    function closeCompanionPage(opts) {
        opts = opts || {};
        stopTimer();
        stopEarlyLeaveCheck();
        stopPartnerGoodnightCheck();
        recordHistory();

        // 阶段三B：停止并清理背景视频（防止退出后声音继续播放）
        try {
            const container = document.getElementById('companion-bg-container');
            if (container) {
                container.querySelectorAll('video').forEach(function (v) {
                    v.pause();
                    v.src = '';
                    v.load();
                });
                container.innerHTML = '';
            }
        } catch (e) {}

        // 阶段三B：清理媒体 blob URL 缓存
        try { _clearMediaCache(); } catch (e) {}

        // 清除闪退恢复用的 live session（陪伴正常结束）
        try { localforage.removeItem(getLiveSessionKey()).catch(() => {}); } catch (e) {}

        // 计算本次时长 + 写入陪伴日记（在状态被清空之前）
        const _diaryDurSec = getElapsedSeconds();
        const _diaryMode = currentMode;
        const _diaryInitiator = window._companionSessionInitiator === 'partner' ? 'partner' : 'user';

        // 默认留痕，除非显式 skipLogEvent
        if (!opts.skipLogEvent) {
            const sceneName = getSceneName();
            const elapsed = formatElapsed(getElapsedSeconds());
            const label = sceneName
                ? `${sceneName}陪伴已结束`
                : `陪伴已结束`;
            // 用场景对应的图标
            const sceneIcon = MODES[currentMode]?.icon || 'fa-moon';
            sendChatEvent(sceneIcon, label, elapsed);
        }

        // 写入陪伴日记（只有真正陪伴过、且时长 ≥ 30 秒才记录，避免误触）
        try {
            if (_diaryMode && _diaryDurSec >= 30 && typeof window.addCompanionDiaryEntry === 'function') {
                const partnerNote = (typeof window.pickCompanionDiaryCards === 'function')
                    ? window.pickCompanionDiaryCards()
                    : '';
                window.addCompanionDiaryEntry({
                    ts: Date.now() - _diaryDurSec * 1000, // 用开始时间作为时间戳
                    mode: _diaryMode,
                    duration: _diaryDurSec,
                    initiator: _diaryInitiator,
                    partnerNote: partnerNote,
                    userNote: ''
                });
            }
        } catch (e) {
            console.warn('[companion] write diary error:', e);
        }

        // 停止语音
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        // 停止白噪音
        stopNoise();

        $('companion-page').classList.remove('active');
        document.body.style.overflow = '';
        closeSettingsPanel();
        $('companion-exit-confirm').classList.remove('active');

        // 清空会话时钟
        _sessionStartTime = null;
        _accumulatedExtendTime = 0;
        window._companionSessionInitiator = null;

        // 清空本次对话 + 气泡 + typing
        _sessionDialogue = [];
        const bubbleArea = document.getElementById('companion-bubble-area');
        if (bubbleArea) bubbleArea.innerHTML = '';
        hideCompanionTyping();

        // 重置输入区状态（防止下次进来还是展开的）
        const inputBar = document.getElementById('companion-input-bar');
        const kbBtn = document.getElementById('companion-keyboard-btn');
        const inputField = document.getElementById('companion-input-field');
        if (inputBar) inputBar.classList.remove('visible');
        if (kbBtn) kbBtn.classList.remove('active');
        $('companion-page').classList.remove('companion-input-active');
        if (inputField) inputField.value = '';

        // 把表情面板放回原位置（如果被陪伴页占用了）
        try {
            const picker = document.getElementById('user-sticker-picker');
            if (picker && picker.dataset.companionMoved === '1') {
                picker.classList.remove('active');
                picker.style.cssText = ''; // 清除内联样式
                if (window.__stickerPickerOriginalParent) {
                    if (window.__stickerPickerOriginalNextSibling) {
                        window.__stickerPickerOriginalParent.insertBefore(picker, window.__stickerPickerOriginalNextSibling);
                    } else {
                        window.__stickerPickerOriginalParent.appendChild(picker);
                    }
                }
                picker.dataset.companionMoved = '0';
            }
        } catch (e) { console.warn('[companion] restore picker failed', e); }
    }

    // ─── 白噪音 ──────────────────────────────────────────────────────────────

    // 内置白噪音预设（音频文件待添加到 assets/audio/）
    const BUILTIN_NOISES = {
        rain: {
            label: '雨天',
            icon: 'fas fa-cloud-rain',
            src: 'assets/audio/rain.mp3'  // ← 待添加
        },
        fire: {
            label: '篝火',
            icon: 'fas fa-fire',
            src: 'assets/audio/campfire.mp3'  // ← 待添加
        }
    };

    // 启动白噪音播放
    // type: 'rain' | 'fire' | 'custom' | 'silent'
    // id: 当 type='custom' 时是用户上传项的 id
    async function startNoise(type, id) {
        // 先停掉现有的
        stopNoise();

        if (type === 'silent' || !type) {
            // 静音模式，已经停了，更新记忆并退出
            companionData.lastNoiseChoice[currentMode] = null;
            saveCompanionData();
            updateNoiseButtonState(null);
            return;
        }

        let src;
        if (type === 'rain' || type === 'fire') {
            src = BUILTIN_NOISES[type].src;
        } else if (type === 'custom' && id) {
            const list = (companionData.noises && companionData.noises[currentMode]) || [];
            const item = list.find(n => n.id === id);
            if (!item) {
                notify('音乐不存在', 'warning');
                return;
            }
            src = item.data || item.src;
            // 阶段三B：oss:// 引用先 fetch blob URL
            if (typeof src === 'string' && src.indexOf('oss://') === 0) {
                try {
                    src = await _resolveMediaUrl(src);
                } catch (e) {
                    console.warn('[companion] 白噪音加载失败', e);
                    notify('音乐加载失败，请检查网络', 'error');
                    return;
                }
            }
        } else {
            return;
        }

        if (!src) {
            notify('音频文件待添加', 'info');
            return;
        }

        try {
            const audio = new Audio(src);

            // 决定 loop 行为：内置永远单曲循环；用户上传看 playMode
            const isCustom = (type === 'custom');
            const playMode = (companionData.lastPlayMode && companionData.lastPlayMode[currentMode]) || 'single';

            if (!isCustom || playMode === 'single') {
                audio.loop = true;
            } else {
                // 列表循环 / 随机播放 → 不 loop，用 ended 事件接管
                audio.loop = false;
                audio.addEventListener('ended', () => {
                    if (audio !== currentNoiseAudio) return; // 已被替换，不处理
                    playNextInQueue();
                });
            }

            audio.volume = 0.6;
            audio.play().catch(err => {
                console.warn('[companion] 白噪音播放失败', err);
                notify('音频文件待添加', 'info');
            });
            currentNoiseAudio = audio;

            // 记忆用户选择
            companionData.lastNoiseChoice[currentMode] = isCustom ? { type: 'custom', id } : type;
            saveCompanionData();
            updateNoiseButtonState(type);
        } catch (e) {
            console.warn('[companion] 白噪音初始化失败', e);
            notify('音频播放失败', 'warning');
        }
    }

    // 列表/随机模式下，播放队列里的下一首
    function playNextInQueue() {
        const list = (companionData.noises && companionData.noises[currentMode]) || [];
        if (list.length === 0) return;

        const choice = companionData.lastNoiseChoice && companionData.lastNoiseChoice[currentMode];
        const playMode = (companionData.lastPlayMode && companionData.lastPlayMode[currentMode]) || 'single';

        // 拿到当前播放的 id
        const currentId = (choice && choice.type === 'custom') ? choice.id : null;

        let nextItem;
        if (playMode === 'random') {
            // 随机：如果只有 1 首就只能继续放它；多首避开当前
            if (list.length === 1) {
                nextItem = list[0];
            } else {
                const candidates = list.filter(item => item.id !== currentId);
                nextItem = candidates[Math.floor(Math.random() * candidates.length)];
            }
        } else if (playMode === 'list') {
            // 列表循环：找当前位置 + 1，超过末尾回到 0
            const currentIdx = list.findIndex(item => item.id === currentId);
            const nextIdx = (currentIdx + 1) % list.length;
            nextItem = list[nextIdx];
        } else {
            // single 模式不该走到这里，但兜底
            return;
        }

        if (nextItem) {
            startNoise('custom', nextItem.id);
        }
    }

    function stopNoise() {
        if (currentNoiseAudio) {
            try { currentNoiseAudio.pause(); } catch (_) {}
            currentNoiseAudio = null;
        }
    }

    // 更新右下角按钮的视觉状态（有声=主题色，无声=半透明）
    function updateNoiseButtonState(activeType) {
        const btn = $('companion-noise-btn');
        if (!btn) return;
        if (activeType && activeType !== 'silent') {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    }

    // 进入陪伴时尝试续播上次的白噪音
    function resumeLastNoise() {
        const choice = companionData.lastNoiseChoice && companionData.lastNoiseChoice[currentMode];
        if (!choice) {
            updateNoiseButtonState(null);
            return;
        }
        if (typeof choice === 'string') {
            // 内置预设
            startNoise(choice);
        } else if (choice && choice.type === 'custom' && choice.id) {
            startNoise('custom', choice.id);
        }
    }

    // 打开白噪音选择卡片
    function openNoiseCard() {
        // 移除残留
        document.querySelectorAll('#companion-noise-card').forEach(el => el.remove());

        // 当前激活的类型（高亮用）
        const choice = companionData.lastNoiseChoice && companionData.lastNoiseChoice[currentMode];
        const activeType = typeof choice === 'string' ? choice : (choice && choice.type === 'custom' ? 'custom' : 'silent');

        // 如果"我的列表"激活，找到正在播的那首的名字
        let currentSongName = '';
        if (activeType === 'custom' && choice && choice.id) {
            const list = (companionData.noises && companionData.noises[currentMode]) || [];
            const item = list.find(n => n.id === choice.id);
            if (item) currentSongName = item.name || '未命名';
        }

        const card = document.createElement('div');
        card.id = 'companion-noise-card';
        card.className = 'companion-noise-card';
        card.innerHTML = `
            <div class="companion-noise-card-inner">
                <div class="companion-noise-card-title">
                    <i class="fas fa-headphones"></i>
                    <span>选择背景音</span>
                </div>
                <div class="companion-noise-options">
                    <div class="companion-noise-option ${activeType === 'rain' ? 'active' : ''}" data-type="rain">
                        <i class="fas fa-cloud-rain"></i><span>雨天</span>
                    </div>
                    <div class="companion-noise-option ${activeType === 'fire' ? 'active' : ''}" data-type="fire">
                        <i class="fas fa-fire"></i><span>篝火</span>
                    </div>
                    <div class="companion-noise-option ${activeType === 'custom' ? 'active' : ''}" data-type="custom">
                        <i class="fas fa-music"></i><span>我的音乐</span>
                    </div>
                    <div class="companion-noise-option ${activeType === 'silent' ? 'active' : ''}" data-type="silent">
                        <i class="fas fa-volume-mute"></i><span>无声</span>
                    </div>
                </div>
                ${currentSongName ? `
                    <div class="companion-noise-now-playing">
                        <i class="fas fa-music"></i>
                        <div class="companion-noise-now-playing-track">
                            <span class="companion-noise-now-playing-name">${escapeHtml(currentSongName)}</span>
                        </div>
                    </div>
                ` : ''}
                <button class="companion-noise-card-close">关闭</button>
            </div>
        `;
        document.documentElement.appendChild(card);

        // 检测歌名是否溢出，溢出就启动跑马灯
        if (currentSongName) {
            requestAnimationFrame(() => {
                const trackEl = card.querySelector('.companion-noise-now-playing-track');
                const nameEl = card.querySelector('.companion-noise-now-playing-name');
                if (trackEl && nameEl && nameEl.scrollWidth > trackEl.clientWidth) {
                    // 溢出 → 启动滚动
                    nameEl.classList.add('scrolling');
                    // 设置动画时长（按字数长度，让滚动速度恒定）
                    const duration = Math.max(8, currentSongName.length * 0.6);
                    nameEl.style.animationDuration = `${duration}s`;
                }
            });
        }

        // 点遮罩关闭
        card.addEventListener('click', e => {
            if (e.target === card) card.remove();
        });
        card.querySelector('.companion-noise-card-close').addEventListener('click', () => card.remove());

        // 选项点击
        card.querySelectorAll('.companion-noise-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const type = opt.dataset.type;
                if (type === 'custom') {
                    card.remove();
                    openNoiseListCard();
                } else if (type === 'silent') {
                    startNoise('silent');
                    card.remove();
                } else {
                    startNoise(type);
                    card.remove();
                }
            });
        });
    }

    // 打开"我的列表"二级卡片
    function openNoiseListCard() {
        document.querySelectorAll('#companion-noise-card').forEach(el => el.remove());

        const list = (companionData.noises && companionData.noises[currentMode]) || [];
        const choice = companionData.lastNoiseChoice && companionData.lastNoiseChoice[currentMode];
        const activeId = (choice && choice.type === 'custom') ? choice.id : null;
        const playMode = (companionData.lastPlayMode && companionData.lastPlayMode[currentMode]) || 'single';

        const card = document.createElement('div');
        card.id = 'companion-noise-card';
        card.className = 'companion-noise-card';

        // 模式按钮的图标 + tooltip
        const modeIcons = {
            single: { icon: 'fa-repeat', title: '单曲循环', extraClass: 'mode-icon-single' },
            list:   { icon: 'fa-repeat', title: '列表循环', extraClass: '' },
            random: { icon: 'fa-shuffle', title: '随机播放', extraClass: '' }
        };
        const modeInfo = modeIcons[playMode] || modeIcons.single;

        let bodyHtml;
        if (list.length === 0) {
            bodyHtml = `
                <div class="companion-noise-list-empty">
                    <i class="fas fa-music"></i>
                    还没有添加音乐
                    <div style="margin-top:8px;display:flex;justify-content:center;align-items:center;">
                        <button class="companion-noise-list-card-add" style="margin:0;width:auto;">
                            添加音乐
                        </button>
                    </div>
                </div>
            `;
        } else {
            // 顶部：模式切换按钮 + 占位
            const modeBtnHtml = `
                <div class="companion-noise-list-toolbar">
                    <button class="companion-noise-mode-btn ${modeInfo.extraClass}" title="${modeInfo.title}">
                        <i class="fas ${modeInfo.icon}"></i>
                    </button>
                </div>
            `;
            const itemsHtml = list.map(item => `
                <div class="companion-noise-list-item ${activeId === item.id ? 'active' : ''}" data-id="${item.id}">
                    <div class="companion-noise-list-item-main" data-action="play" data-id="${item.id}">
                        <i class="fas fa-music"></i>
                        <span class="companion-noise-list-item-name">${escapeHtml(item.name || '未命名')}</span>
                    </div>
                    <button class="companion-noise-list-item-edit" data-action="rename" data-id="${item.id}" title="重命名">
                        <i class="fas fa-pencil"></i>
                    </button>
                </div>
            `).join('');
            const addMoreHtml = `
                <button class="companion-noise-list-card-add-more">
                    <i class="fas fa-plus"></i> 添加更多
                </button>
            `;
            bodyHtml = modeBtnHtml +
                `<div class="companion-noise-options">${itemsHtml}</div>` +
                addMoreHtml;
        }

        card.innerHTML = `
            <div class="companion-noise-card-inner companion-noise-list-card">
                <div class="companion-noise-card-title">
                    <i class="fas fa-music"></i>
                    <span>我的音乐</span>
                </div>
                ${bodyHtml}
                <button class="companion-noise-card-close">返回</button>
            </div>
        `;
        document.documentElement.appendChild(card);

        // 隐藏的 file input（用于卡片内直接上传）
        let hiddenInput = document.getElementById('companion-noise-card-upload');
        if (!hiddenInput) {
            hiddenInput = document.createElement('input');
            hiddenInput.type = 'file';
            hiddenInput.id = 'companion-noise-card-upload';
            hiddenInput.accept = '*/*';
            hiddenInput.multiple = true;
            hiddenInput.style.display = 'none';
            document.body.appendChild(hiddenInput);
        }
        // 移除可能残留的旧 listener（重新创建后再加，确保每次都是新 handler）
        const newHandler = async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;
            let addedCount = 0;
            let firstAddedId = null;
            await ensureDataLoaded();
            for (const file of files) {
                const isAudio = file.type.startsWith('audio/') ||
                    /\.(mp3|m4a|aac|wav|ogg|flac|amr|opus)$/i.test(file.name);
                if (!isAudio) continue;
                try {
                    const base64 = await readFileAsBase64(file);
                    const id = generateId();
                    if (!firstAddedId) firstAddedId = id;
                    let mediaData = base64;
                    let cloudKey = null;
                    try {
                        const r = await _uploadCompanionMedia(base64, 'companion-noises');
                        mediaData = r.data;
                        cloudKey = r.cloudKey;
                    } catch (e) {
                        console.warn('[companion] 白噪音云端上传失败，降级本地', e);
                    }
                    companionData.noises[currentMode].push({
                        id,
                        data: mediaData,
                        cloudKey,
                        name: file.name.replace(/\.[^/.]+$/, ''),
                        addedAt: Date.now()
                    });
                    addedCount++;
                } catch (err) {
                    console.error('[companion] 白噪音读取失败', err);
                }
            }
            if (addedCount > 0) {
                await saveCompanionData();
                notify(`已添加 ${addedCount} 段音乐`, 'success');
                // 刷新卡片显示
                openNoiseListCard();
            }
            e.target.value = '';
        };
        hiddenInput.onchange = newHandler;

        // 点遮罩关闭
        card.addEventListener('click', e => {
            if (e.target === card) card.remove();
        });
        // 返回主卡片
        card.querySelector('.companion-noise-card-close').addEventListener('click', () => {
            card.remove();
            openNoiseCard();
        });

        // 空列表 → 添加按钮
        const emptyAddBtn = card.querySelector('.companion-noise-list-card-add');
        if (emptyAddBtn) {
            emptyAddBtn.addEventListener('click', () => hiddenInput.click());
        }

        // 非空 → 添加更多按钮
        const addMoreBtn = card.querySelector('.companion-noise-list-card-add-more');
        if (addMoreBtn) {
            addMoreBtn.addEventListener('click', () => hiddenInput.click());
        }

        // 模式切换按钮
        const modeBtn = card.querySelector('.companion-noise-mode-btn');
        if (modeBtn) {
            modeBtn.addEventListener('click', () => {
                const cycle = ['single', 'list', 'random'];
                const cur = (companionData.lastPlayMode && companionData.lastPlayMode[currentMode]) || 'single';
                const idx = cycle.indexOf(cur);
                const next = cycle[(idx + 1) % cycle.length];
                companionData.lastPlayMode[currentMode] = next;
                saveCompanionData();
                // 刷新按钮显示
                const info = modeIcons[next];
                modeBtn.querySelector('i').className = `fas ${info.icon}`;
                modeBtn.title = info.title;
                // 更新按钮的 mode-icon-single 标记（用于显示 "1" 上标）
                modeBtn.classList.remove('mode-icon-single');
                if (info.extraClass) modeBtn.classList.add(info.extraClass);
                notify(info.title, 'info', 1200);

                // 如果当前正在播用户上传的，立刻切换播放模式（重新启动当前曲目让 loop 设置生效）
                const curChoice = companionData.lastNoiseChoice && companionData.lastNoiseChoice[currentMode];
                if (curChoice && curChoice.type === 'custom' && curChoice.id) {
                    startNoise('custom', curChoice.id);
                }
            });
        }

        // 列表项 — 点击主体区域播放 / 点 ✎ 改名
        card.querySelectorAll('[data-action="play"]').forEach(main => {
            main.addEventListener('click', () => {
                startNoise('custom', main.dataset.id);
                card.remove();
            });
        });
        card.querySelectorAll('[data-action="rename"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                renameNoiseInline(btn.dataset.id, btn.closest('.companion-noise-list-item'));
            });
        });
    }

    // 在卡片里就地改名（点 ✎ 后名字变输入框）
    function renameNoiseInline(id, itemEl) {
        if (!itemEl) return;
        const list = (companionData.noises && companionData.noises[currentMode]) || [];
        const item = list.find(n => n.id === id);
        if (!item) return;
        const nameSpan = itemEl.querySelector('.companion-noise-list-item-name');
        if (!nameSpan) return;
        const oldName = item.name || '';
        // 把 span 替换为 input
        const input = document.createElement('input');
        input.type = 'text';
        input.value = oldName;
        input.className = 'companion-noise-list-item-name-input';
        nameSpan.replaceWith(input);
        input.focus();
        input.select();

        let finished = false;
        const commit = async () => {
            if (finished) return;
            finished = true;
            const newName = input.value.trim() || oldName;
            item.name = newName;
            await saveCompanionData();
            // 还原 span
            const newSpan = document.createElement('span');
            newSpan.className = 'companion-noise-list-item-name';
            newSpan.textContent = newName;
            input.replaceWith(newSpan);
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { input.value = oldName; input.blur(); }
        });
        // 拦截输入框被点击时不要冒泡到 play 区
        input.addEventListener('click', e => e.stopPropagation());
    }

    // ─── 计时器 ──────────────────────────────────────────────────────────────
    // 用时间戳基准计时，避免后台/锁屏定时器被浏览器降频时倒计时停止
    let _timerAnchorAt = 0;        // 启动/续接时刻
    let _timerAnchorSeconds = 0;   // 启动时的 timerSeconds 值
    let _visibilityHandler = null;

    function recomputeTimerFromAnchor() {
        if (!_timerAnchorAt) return;
        const elapsed = Math.floor((Date.now() - _timerAnchorAt) / 1000);
        if (isCountdown) {
            const left = _timerAnchorSeconds - elapsed;
            if (left <= 0) {
                timerSeconds = 0;
                updateTimerDisplay();
                stopTimer();
                onTimerEnd();
                return true; // 时间到
            }
            timerSeconds = left;
        } else {
            timerSeconds = _timerAnchorSeconds + elapsed;
        }
        updateTimerDisplay();
        return false;
    }

    function startTimer() {
        clearInterval(timerInterval);
        // 启动场景对应的事件检查
        if (currentMode === 'sleep' && !isCountdown) {
            // 正计时（好好休息）→ 启动梦角主动告别检查
            schedulePartnerGoodnight();
        } else {
            // 倒计时 → 启动梦角提前离开检查
            scheduleEarlyLeaveCheck();
        }
        // 记录基准点（基于真实时间戳，不依赖定时器累加）
        _timerAnchorAt = Date.now();
        _timerAnchorSeconds = timerSeconds;

        timerInterval = setInterval(() => {
            recomputeTimerFromAnchor();
            // 每秒触发心跳（节流到 10 秒一次写盘）
            tryHeartbeatLiveSession();
        }, 1000);

        // 切回前台时立即重算一次（修复锁屏/后台时倒计时停止的问题）
        if (!_visibilityHandler) {
            _visibilityHandler = () => {
                if (!document.hidden && timerInterval) recomputeTimerFromAnchor();
            };
            document.addEventListener('visibilitychange', _visibilityHandler);
        }

        // 启动时立刻写入一次完整的 live session（用于闪退恢复）
        writeLiveSession();
    }

    function stopTimer() {
        clearInterval(timerInterval);
        timerInterval = null;
        _timerAnchorAt = 0;
        _timerAnchorSeconds = 0;
        if (_visibilityHandler) {
            document.removeEventListener('visibilitychange', _visibilityHandler);
            _visibilityHandler = null;
        }
    }

    // ─── 闪退恢复：live session 持久化 ─────────────────
    function getLiveSessionKey() {
        return (typeof getStorageKey === 'function')
            ? getStorageKey('companionLiveSession')
            : (window.APP_PREFIX || 'CHAT_APP_V3_') + 'companionLiveSession';
    }
    let _lastHeartbeatTs = 0;
    function writeLiveSession() {
        try {
            // 把累计时间合并到 startTs 里：虚拟起点 = 当前段起点 - 累计延长时间
            // 这样恢复时直接 (Date.now() - startTs) 就是完整陪伴时长
            const virtualStartTs = _sessionStartTime
                ? _sessionStartTime - Math.floor((_accumulatedExtendTime || 0) * 1000)
                : Date.now();
            const payload = {
                startTs: virtualStartTs,
                heartbeatTs: Date.now(),
                mode: currentMode,
                initiator: window._companionSessionInitiator === 'partner' ? 'partner' : 'user',
                isCountdown: !!isCountdown,
                // 总时长：当前段 + 累计延长（这样剩余时间也对得上）
                totalSeconds: (totalSeconds || 0) + Math.floor(_accumulatedExtendTime || 0),
                accumulatedExtendTime: 0  // 已经合并到 startTs 里
            };
            localforage.setItem(getLiveSessionKey(), payload).catch(() => {});
            _lastHeartbeatTs = Date.now();
        } catch (e) {}
    }
    function tryHeartbeatLiveSession() {
        // 节流：距离上次心跳 < 10 秒就跳过
        if (Date.now() - _lastHeartbeatTs < 10000) return;
        writeLiveSession();
    }
    function clearLiveSession() {
        try {
            // 用扫描方式删除所有 companionLiveSession 相关 key
            // 不依赖 getLiveSessionKey()，避免 SESSION_ID 异步问题或伪造测试数据残留
            localforage.keys().then(function(keys) {
                const targets = keys.filter(function(k) {
                    return k.indexOf('companionLiveSession') !== -1;
                });
                Promise.all(targets.map(function(k) {
                    return localforage.removeItem(k).catch(function() {});
                }));
            }).catch(function() {});
        } catch (e) {}
        _lastHeartbeatTs = 0;
    }
    // 暴露给外部（启动时检测用）
    window._companionRecoverModule = {
        getLiveSessionKey: getLiveSessionKey,
        clearLiveSession: clearLiveSession,
        // 用恢复出来的状态继续陪伴
        resumeFromSession: function(session) {
            if (!session || !session.mode) return false;
            try {
                currentMode = session.mode;
                window._companionSessionInitiator = session.initiator || 'user';
                _accumulatedExtendTime = session.accumulatedExtendTime || 0;
                // 用真实墙上时间算（不暂停）
                const elapsedSinceStart = Math.floor((Date.now() - session.startTs) / 1000) + _accumulatedExtendTime;
                if (session.isCountdown) {
                    isCountdown = true;
                    totalSeconds = session.totalSeconds;
                    const remaining = session.totalSeconds - elapsedSinceStart;
                    if (remaining <= 0) {
                        // 时间已经过完了 → 让外层去写日记
                        return false;
                    }
                    timerSeconds = remaining;
                } else {
                    // 正计时（睡觉）→ 从真实累计时间继续
                    isCountdown = false;
                    timerSeconds = elapsedSinceStart;
                    totalSeconds = 0;
                }
                // 把 session 起点追回到原本的起点
                _sessionStartTime = session.startTs;
                _accumulatedExtendTime = 0;
                openCompanionPage({ isResume: true });
                return true;
            } catch (e) {
                console.warn('[companion] resume failed', e);
                return false;
            }
        },
        // 把会话作为已完成日记保存
        saveSessionAsDiary: async function(session) {
            if (!session || !session.mode) return;
            // 按真实墙上时间算
            let duration = Math.max(0, Math.floor((Date.now() - session.startTs) / 1000) + (session.accumulatedExtendTime || 0));
            // 倒计时模式：时长不能超过总时长（时间到了就是到了）
            if (session.isCountdown && session.totalSeconds && duration > session.totalSeconds) {
                duration = session.totalSeconds;
            }
            if (duration < 30) return; // 太短，不记
            // 走正常字卡逻辑（30% 不写、70% 抽 1-2 句）
            const partnerNote = (typeof window.pickCompanionDiaryCards === 'function')
                ? window.pickCompanionDiaryCards()
                : '';
            if (typeof window.addCompanionDiaryEntry === 'function') {
                await window.addCompanionDiaryEntry({
                    ts: session.startTs,
                    mode: session.mode,
                    duration: duration,
                    initiator: session.initiator || 'user',
                    partnerNote: partnerNote,
                    userNote: ''
                });
            }
        }
    };

    function updateTimerDisplay() {
        const el = $('companion-timer-display');
        if (!el) return;
        const s = isCountdown ? timerSeconds : timerSeconds;
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) {
            el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
        } else {
            el.textContent = `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
        }
    }

    function onTimerEnd() {
        // 时间已到，停止"梦角提前离开"检查（不然会在用户看结束页时还可能触发）
        stopEarlyLeaveCheck();
        // 停止计时器（避免重复触发）
        stopTimer();

        // 震动提示
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

        // 播放随机语音
        playRandomVoice();

        // 显示"时间到啦"文字
        const hint = $('companion-hint-text');
        if (hint) hint.textContent = '时间到啦 ✦';

        // 正计时（睡觉好好休息）不会到这里，因为不归零。但兜底防御一下。
        if (!isCountdown) return;

        // 倒计时归零 → 过渡画面 → 抛骰子决定谁先发起延长邀请
        showCompanionTransition(pickRandom(TRANSITION_LINES.timeUp), () => {
            // 用户可能已经退出了（比如点 ✕ 取消）
            if (!document.getElementById('companion-page')?.classList.contains('active')) return;

            // 60% 用户先发起，40% 梦角先发起
            if (Math.random() < 0.6) {
                showExtendPromptByUser();
            } else {
                showExtendPromptByPartner();
            }
        });
    }

    // ─── 倒计时归零后：用户先发起延长 ──────────────────────────────────────
    // 显示一个简单的二选一弹窗：再陪一会儿 / 下次见
    function showExtendPromptByUser() {
        // 移除残留
        document.querySelectorAll('#companion-extend-prompt').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.id = 'companion-extend-prompt';
        overlay.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99998',
            'background:rgba(15,15,20,0.92)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'animation:companionFadeIn 0.5s ease'
        ].join(';'));
        overlay.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;gap:20px;color:#fff;max-width:300px;padding:0 20px;animation:companionPopIn 0.5s ease;">
                <div style="font-size:22px;font-weight:600;letter-spacing:2px;">时间到啦 ✦</div>
                <div style="font-size:14px;color:rgba(255,255,255,0.7);text-align:center;">这次陪伴结束了。</div>
                <div style="display:flex;gap:12px;margin-top:10px;">
                    <button id="extend-prompt-yes" style="
                        padding:11px 26px;border-radius:22px;border:none;
                        background:var(--accent-color,#c5a47e);color:#fff;
                        font-size:14px;letter-spacing:1px;cursor:pointer;
                        font-weight:500;
                    ">再陪一会儿</button>
                    <button id="extend-prompt-no" style="
                        padding:11px 26px;border-radius:22px;
                        border:1px solid rgba(255,255,255,0.25);
                        background:rgba(255,255,255,0.08);color:#fff;
                        font-size:14px;letter-spacing:1px;cursor:pointer;
                    ">下次见</button>
                </div>
            </div>
        `;
        injectKeyframes();
        document.documentElement.appendChild(overlay);

        overlay.querySelector('#extend-prompt-yes').addEventListener('click', () => {
            overlay.remove();
            // 选时间 → 邀请等待 → 同意/拒绝
            openTimeModal(currentMode, (selectedTime) => {
                // 时间已经在 openTimeModal 内部 set 好（isCountdown/timerSeconds/totalSeconds）
                // 现在向梦角发起邀请，等待结果
                showExtendInvitingByUser();
            });
        });
        overlay.querySelector('#extend-prompt-no').addEventListener('click', () => {
            overlay.remove();
            // 显示过渡画面（覆盖后悄悄关闭陪伴页，留痕 xx陪伴已结束）
            showCompanionTransition(
                pickRandom(TRANSITION_LINES.userExit),
                null,
                () => closeCompanionPage()
            );
        });
    }

    // 用户邀请继续 → 等待画面（复刻 showCompanionInviting，但成功后不开新陪伴页而是续上）
    function showExtendInvitingByUser() {
        const cfg = MODES[currentMode];
        const partnerName = getPartnerName();
        const avSrc = getPartnerAvatarSrc();

        // 时间文字（用于"邀请等待中"副标题）
        let timeText;
        if (!isCountdown) {
            timeText = '好好休息';
        } else {
            timeText = `${Math.round(totalSeconds / 60)} 分钟`;
        }

        document.querySelectorAll('#companion-inviting-overlay').forEach(el => el.remove());

        const sessionId = Symbol('extend-invite-session');
        window._extendInvitingSession = sessionId;
        const isStillThisSession = () => window._extendInvitingSession === sessionId;

        const overlay = document.createElement('div');
        overlay.id = 'companion-inviting-overlay';
        overlay.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99998',
            'background:rgba(15,15,20,0.92)',
            'display:flex', 'align-items:center', 'justify-content:center'
        ].join(';'));

        const avatarHtml = avSrc
            ? `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;">`
            : `<i class="fas fa-user" style="font-size:36px;color:rgba(255,255,255,.85);"></i>`;

        overlay.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;gap:18px;color:#fff;">
                <div style="position:relative;width:96px;height:96px;">
                    <div style="
                        position:absolute;inset:-12px;border-radius:50%;
                        border:2px solid rgba(var(--accent-color-rgb,197,164,126),.55);
                        animation:companionPulseRing 1.6s ease-out infinite;
                    "></div>
                    <div style="
                        position:absolute;inset:-24px;border-radius:50%;
                        border:1px solid rgba(var(--accent-color-rgb,197,164,126),.32);
                        animation:companionPulseRing 1.6s ease-out infinite 0.4s;
                    "></div>
                    <div style="
                        width:96px;height:96px;border-radius:50%;overflow:hidden;
                        background:rgba(255,255,255,0.08);
                        display:flex;align-items:center;justify-content:center;
                        border:2px solid rgba(255,255,255,0.15);
                        position:relative;z-index:1;
                    ">${avatarHtml}</div>
                </div>
                <div style="font-size:20px;font-weight:600;letter-spacing:1px;">${partnerName}</div>
                <div style="font-size:13px;color:rgba(255,255,255,0.6);display:flex;align-items:center;gap:8px;">
                    <i class="fas ${cfg.icon}" style="color:var(--accent-color, #c5a47e);"></i>
                    <span>继续陪伴 · ${timeText}</span>
                    <span style="display:inline-flex;gap:3px;">
                        <span style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,0.6);animation:companionDot 1.2s infinite;"></span>
                        <span style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,0.6);animation:companionDot 1.2s infinite 0.2s;"></span>
                        <span style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,0.6);animation:companionDot 1.2s infinite 0.4s;"></span>
                    </span>
                </div>
                <button id="companion-extend-cancel" style="
                    margin-top:30px;width:64px;height:64px;border-radius:50%;border:none;
                    background:linear-gradient(135deg,#ff5252,#c62828);
                    color:#fff;font-size:22px;cursor:pointer;
                    box-shadow:0 6px 20px rgba(255,82,82,.45);
                    display:flex;align-items:center;justify-content:center;
                "><i class="fas fa-xmark"></i></button>
                <div style="font-size:11px;color:rgba(255,255,255,0.35);">取消</div>
            </div>
        `;
        injectKeyframes();
        document.documentElement.appendChild(overlay);

        // 取消邀请
        overlay.querySelector('#companion-extend-cancel').addEventListener('click', () => {
            if (!isStillThisSession()) return;
            window._extendInvitingSession = null;
            clearTimeout(window._extendInvitingTimer);
            overlay.remove();
            // 直接关闭陪伴页（留痕"xx陪伴已结束 · MM:SS"）
            closeCompanionPage();
        });

        // 1~3 秒后梦角回应 — 35% 拒绝 / 65% 同意
        const delay = 1000 + Math.random() * 2000;
        const willReject = (_forceResult === 'reject') || (_forceResult !== 'accept' && Math.random() < 0.35);

        window._extendInvitingTimer = setTimeout(() => {
            if (!isStillThisSession()) return;
            window._extendInvitingSession = null;
            overlay.remove();

            if (willReject) {
                // 显示过渡画面（用梦角原话，覆盖后悄悄关闭陪伴页）
                const line = pickRandom(REJECT_LINES);
                showCompanionTransition(
                    `${line}……`,
                    null,
                    () => closeCompanionPage()
                );
            } else {
                sendChatEvent('fa-heart', `${partnerName}同意了继续陪伴`, null);
                // 过渡画面：旁白 → 累计时长 → 继续陪伴
                showCompanionTransition(pickRandom(TRANSITION_LINES.extendUserAccept), () => {
                    accumulateExtendTime();
                    continueCompanionAfterExtend();
                });
            }
        }, delay);
    }

    // ─── 倒计时归零后：梦角先发起延长 ──────────────────────────────────────
    const EXTEND_INVITE_LINES = [
        '时间过得好看，再陪我一会儿？',
        '舍不得你走，再来一会儿？',
        '刚刚状态正好，可以继续？',
        '我还想你陪着我，再一会儿可以吗？'
    ];

    function showExtendPromptByPartner() {
        const cfg = MODES[currentMode];
        const partnerName = getPartnerName();
        const avSrc = getPartnerAvatarSrc();
        const baseLine = pickRandom(EXTEND_INVITE_LINES);

        // 梦角自选时间（从 inviteTimes 池里随机选一个，sleep 排除 rest）
        let candidateTimes = (cfg.inviteTimes || [25]).filter(t => t !== 'rest');
        if (candidateTimes.length === 0) candidateTimes = [25];
        const inviteTime = pickRandom(candidateTimes);
        const timeText = `${inviteTime} 分钟`;

        // 拼接文案：跟 showIncomingCompanion 一样的智能拼接
        let line;
        if (/陪你|陪着你/.test(baseLine)) {
            line = `${baseLine.replace(/[？！?!]$/, '')} ${timeText}`;
        } else if (/[？！?!]$/.test(baseLine)) {
            line = `${baseLine} 陪你 ${timeText}`;
        } else {
            line = `${baseLine}，陪你 ${timeText}`;
        }

        // 移除残留
        document.querySelectorAll('#companion-extend-prompt-partner').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.id = 'companion-extend-prompt-partner';
        overlay.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99998',
            'background:rgba(15,15,20,0.92)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'animation:companionFadeIn 0.5s ease'
        ].join(';'));

        const avatarHtml = avSrc
            ? `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;">`
            : `<i class="fas fa-user" style="font-size:30px;color:rgba(255,255,255,.85);"></i>`;

        overlay.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;gap:18px;color:#fff;max-width:320px;padding:0 20px;animation:companionPopIn 0.6s ease;">
                <div style="
                    width:80px;height:80px;border-radius:50%;overflow:hidden;
                    background:rgba(255,255,255,0.1);
                    display:flex;align-items:center;justify-content:center;
                    border:2px solid rgba(255,255,255,0.15);
                ">${avatarHtml}</div>
                <div style="font-size:18px;font-weight:600;letter-spacing:1px;">${partnerName}</div>
                <div style="
                    background:rgba(255,255,255,0.08);border-radius:14px;padding:14px 22px;
                    display:flex;align-items:center;gap:10px;text-align:center;
                ">
                    <i class="fas ${cfg.icon}" style="color:var(--accent-color,#c5a47e);font-size:16px;"></i>
                    <span style="font-size:14px;">${line}</span>
                </div>
                <div style="display:flex;gap:14px;margin-top:8px;">
                    <button id="extend-partner-yes" style="
                        padding:11px 26px;border-radius:22px;border:none;
                        background:var(--accent-color,#c5a47e);color:#fff;
                        font-size:14px;letter-spacing:1px;cursor:pointer;
                        font-weight:500;
                    ">好啊</button>
                    <button id="extend-partner-no" style="
                        padding:11px 26px;border-radius:22px;
                        border:1px solid rgba(255,255,255,0.25);
                        background:rgba(255,255,255,0.08);color:#fff;
                        font-size:14px;letter-spacing:1px;cursor:pointer;
                    ">不了</button>
                </div>
            </div>
        `;
        injectKeyframes();
        document.documentElement.appendChild(overlay);

        overlay.querySelector('#extend-partner-yes').addEventListener('click', () => {
            overlay.remove();
            sendChatEvent('fa-heart', `接受了${partnerName}继续陪伴的邀请`, null);
            // 应用梦角说的时长
            if (inviteTime === 'rest') {
                isCountdown = false;
                timerSeconds = 0;
                totalSeconds = 0;
            } else {
                isCountdown = true;
                timerSeconds = parseInt(inviteTime) * 60;
                totalSeconds = parseInt(inviteTime) * 60;
            }
            // 过渡画面：旁白 → 累计时长 → 继续陪伴
            showCompanionTransition(pickRandom(TRANSITION_LINES.userAcceptExtend), () => {
                accumulateExtendTime();
                continueCompanionAfterExtend();
            });
        });

        overlay.querySelector('#extend-partner-no').addEventListener('click', () => {
            overlay.remove();
            // 显示过渡画面（覆盖后悄悄关闭陪伴页）
            showCompanionTransition(
                pickRandom(TRANSITION_LINES.userRejectExtend),
                null,
                () => closeCompanionPage()
            );
        });
    }

    // 继续陪伴：重置计时器显示，重新启动 startTimer（不重新进 openCompanionPage）
    function continueCompanionAfterExtend() {
        // 把 hint 还原
        const hint = $('companion-hint-text');
        if (hint) hint.textContent = MODES[currentMode]?.hint || '';
        // 更新计时器显示
        updateTimerDisplay();
        // 重新启动计时
        startTimer();
    }

    // ─── 语音播放 ────────────────────────────────────────────────────────────

    function playRandomVoice() {
        // 按当前场景取语音
        const voices = (companionData.voices && companionData.voices[currentMode]) || [];
        if (!voices.length) return;
        const v = voices[Math.floor(Math.random() * voices.length)];
        playVoice(v);
    }

    let _isVoicePlaying = false;
    async function playVoice(v) {
        if (!v || !v.data) return;
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        // 阶段三B：oss:// 引用先 fetch blob URL
        let src = v.data;
        if (typeof src === 'string' && src.indexOf('oss://') === 0) {
            try {
                src = await _resolveMediaUrl(src);
            } catch (e) {
                console.warn('[companion] 语音加载失败', e);
                return;
            }
        }
        const audio = new Audio(src);
        _isVoicePlaying = true;
        audio.addEventListener('ended', () => { _isVoicePlaying = false; });
        audio.addEventListener('error', () => { _isVoicePlaying = false; });
        audio.play().catch(e => {
            console.warn('[companion] 播放失败', e);
            _isVoicePlaying = false;
        });
        currentAudio = audio;
    }

    // 点击空白区域 → 触发梦角字卡回复（模拟用户碰了一下梦角，但不写入用户消息）
    function handlePageClick(e) {
        // 排除按钮、计时器区域、退出确认弹窗、语音气泡的点击
        if (e.target.closest('button, input, #companion-timer-area, #companion-exit-confirm, .companion-bubble-voice')) return;
        // 涟漪特效（始终响应）
        createRippleEffect(e.clientX, e.clientY);
        // 检查字卡是否为空（变量在 window._customReplies 或全局 customReplies）
        const cReplies = (typeof customReplies !== 'undefined') ? customReplies : (window._customReplies || []);
        if (!cReplies || cReplies.length === 0) {
            if (typeof window.showNotification === 'function') {
                window.showNotification('回复库为空，请先到「自定义回复」中添加内容', 'info', 3500);
            }
            return;
        }
        // 触发延迟回复（不引用用户消息）
        if (typeof window._triggerDelayedReply === 'function') {
            window._companionSilentTrigger = true;
            window._triggerDelayedReply(false);  // isUserMessage = false
            // 标志保留到 simulateReply 执行完(因为延迟回复 setTimeout 几秒后才触发)
            // 在 simulateReply 执行完后会自动清除（看下面）
        }
    }

    // ─── 涟漪点击特效 ───────────────────────────────────────────────────────
    // 在指定坐标创建双层涟漪扩散（每层 0.9s）
    function createRippleEffect(x, y) {
        for (let i = 0; i < 2; i++) {
            setTimeout(() => {
                const r = document.createElement('div');
                r.className = 'companion-ripple';
                r.style.left = x + 'px';
                r.style.top = y + 'px';
                document.documentElement.appendChild(r);
                setTimeout(() => { if (r.isConnected) r.remove(); }, 950);
            }, i * 150);
        }
    }

    // ─── 陪伴对话气泡 ──────────────────────────────────────────────────────
    // 本次陪伴中梦角说过的所有话（退出时清空）
    let _sessionDialogue = [];

    // 钩子：每次 addMessage 写入梦角消息时被调用（在 core.js 里设置）
    function onPartnerMessage(message) {
        // 只在陪伴页激活时响应
        const page = document.getElementById('companion-page');
        if (!page || !page.classList.contains('active')) return;

        // 延迟150ms，等 MutationObserver 里的 maybeFakeVoiceForPartner 跑完
        // 这样 message.voice 才有可能被设置上
        setTimeout(() => {
            // 再次检查页面是否还在
            const p = document.getElementById('companion-page');
            if (!p || !p.classList.contains('active')) return;

            // 过滤：既无文本、无图片、无语音的空消息（延迟后判断，此时voice已被设置）
            if (!message.text && !message.image && !message.voice) return;

            // 记录到本次陪伴对话
            _sessionDialogue.push({
                text: message.voice ? (message.voice.fakeText || '') : (message.text || ''),
                image: message.image || null,
                sender: message.sender,
                voice: message.voice ? {
                    duration: message.voice.duration,
                    fakeText: message.voice.fakeText,
                    msgId: message.id
                } : null,
            });
            hideCompanionTyping();
            showCompanionBubble(message);
        }, 150);
    }

    // 钩子：用户在陪伴页发送消息时，气泡同步显示
    function onUserMessage(message) {
        const page = document.getElementById('companion-page');
        if (!page || !page.classList.contains('active')) return;
        if (!message.text && !message.image) return;
        // 记录到本次陪伴对话
        _sessionDialogue.push({
            text: message.text || '',
            image: message.image || null,
            sender: 'user',
            voice: null,
        });
        showCompanionBubble(message);
    }

    let _bubbleAreaClickSetup = false;

    function _setupBubbleAreaClick() {
        if (_bubbleAreaClickSetup) return;
        const area = document.getElementById('companion-bubble-area');
        if (!area) return;
        _bubbleAreaClickSetup = true;

        // 用捕获阶段，在所有其他监听器之前处理语音点击
        area.addEventListener('click', async function(e) {
            const voiceBtn = e.target.closest('.companion-voice-bubble');
            if (!voiceBtn) return;

            // 阻止事件冒泡到companion-page，防止触发handlePageClick
            e.stopPropagation();

            if (voiceBtn.dataset.playing === '1') return;
            if (!window.voiceTTS || !window.voiceTTS.isTtsReady()) {
                if (typeof showNotification === 'function') showNotification('请先在聊天设置里配置真实语音', 'info');
                return;
            }

            const msgId = voiceBtn.dataset.msgId;
            const liveMsg = (typeof messages !== 'undefined')
                ? messages.find(m => String(m.id) === String(msgId))
                : null;
            const liveText = (liveMsg && liveMsg.voice && liveMsg.voice.fakeText)
                ? liveMsg.voice.fakeText
                : voiceBtn.dataset.fakeText || '';
            if (!liveText) return;

            const bubble = voiceBtn.closest('.companion-bubble');
            voiceBtn.dataset.playing = '1';
            voiceBtn.style.opacity = '0.6';
            try {
                const audioUrl = await window.voiceTTS.getAudioForMessage(msgId, liveText);
                const audio = new Audio(audioUrl);
                if (window.voiceTTS.applyPlaybackSettings) window.voiceTTS.applyPlaybackSettings(audio);
                if (bubble) bubble._isPlaying = true;
                audio.play();
                audio.onended = () => {
                    if (bubble) bubble._isPlaying = false;
                    voiceBtn.dataset.playing = '0';
                    voiceBtn.style.opacity = '1';
                    if (bubble) _startBubbleFade(bubble);
                };
                audio.onerror = () => {
                    if (bubble) bubble._isPlaying = false;
                    voiceBtn.dataset.playing = '0';
                    voiceBtn.style.opacity = '1';
                };
            } catch (err) {
                if (bubble) bubble._isPlaying = false;
                voiceBtn.dataset.playing = '0';
                voiceBtn.style.opacity = '1';
                console.error('[companion voice]', err);
            }
        }, true); // true = 捕获阶段
    }

    function showCompanionBubble(message) {
        const area = document.getElementById('companion-bubble-area');
        if (!area) return;

        // 确保全局点击委托已设置
        _setupBubbleAreaClick();

        // 太多气泡时让最老的提前渐隐（最多保留 4 条）
        const activeBubbles = Array.from(area.querySelectorAll('.companion-bubble:not(.fading)'));
        if (activeBubbles.length >= 4) {
            const oldest = activeBubbles[0];
            oldest.classList.add('fading');
            setTimeout(() => { if (oldest.isConnected) oldest.remove(); }, 1000);
        }

        const isUser = message.sender === 'user';
        const isImage = !!message.image;
        const isVoice = !isUser && !!message.voice;
        const bubble = document.createElement('div');
        bubble.className = 'companion-bubble' + (isUser ? ' companion-bubble-user' : '') + (isVoice ? ' companion-bubble-voice' : '');

        // 头像
        const avSrc = isUser ? getMyAvatarSrc() : getPartnerAvatarSrc();
        const avatarHtml = avSrc
            ? `<img src="${avSrc}">`
            : `<i class="fas fa-user"></i>`;

        if (isVoice) {
            // ── 语音条气泡 ──
            const duration = message.voice.duration || 3;
            const fakeText = message.voice.fakeText || '';
            const msgId = message.id;
            const widthPx = Math.round(80 + Math.min(duration, 60) / 60 * 100);
            bubble.innerHTML = `
                <div class="companion-bubble-avatar">${avatarHtml}</div>
                <div class="companion-bubble-content companion-voice-bubble" style="cursor:pointer;padding:8px 12px;display:flex;flex-direction:column;gap:6px;" data-msg-id="${msgId}">
                    <div style="min-width:${widthPx}px;display:flex;align-items:center;gap:8px;">
                        <svg viewBox="0 0 22 22" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="6" cy="11" r="1.3" fill="currentColor" stroke="none"/>
                            <path d="M10 8 A 3.5 3.5 0 0 1 10 14"/>
                            <path d="M13 5 A 7 7 0 0 1 13 17"/>
                        </svg>
                        <span style="font-size:13px;">${duration}"</span>
                    </div>
                    ${fakeText ? `<div style="font-size:12px;opacity:0.85;border-top:1px solid rgba(0,0,0,0.08);padding-top:5px;">${escapeHtml(fakeText)}</div>` : ''}
                </div>
            `;
            area.appendChild(bubble);

            // 点击由 _setupBubbleAreaClick 的事件委托统一处理
            const voiceBtn = bubble.querySelector('.companion-voice-bubble');
            if (voiceBtn && fakeText) voiceBtn.dataset.fakeText = fakeText;

            // 语音气泡：12秒后消失（给用户时间点击）
            _startBubbleFadeDelayed(bubble, 12000);

        } else if (isImage) {
            bubble.classList.add('companion-bubble-image');
            bubble.innerHTML = `
                <div class="companion-bubble-avatar">${avatarHtml}</div>
                <img class="companion-bubble-image-raw">
            `;
            area.appendChild(bubble);
            // 支持 oss:// 云端图片懒加载
            var imgEl = bubble.querySelector('img.companion-bubble-image-raw');
            if (imgEl) {
                var imgSrc = message.image || '';
                if (imgSrc.indexOf('oss://') === 0 && window.CloudMedia) {
                    window.CloudMedia.bindLazyImage(imgEl, imgSrc);
                } else {
                    imgEl.src = imgSrc;
                }
            }
            _startBubbleFadeDelayed(bubble, 8000);
        } else {
            bubble.innerHTML = `
                <div class="companion-bubble-avatar">${avatarHtml}</div>
                <div class="companion-bubble-content">${escapeHtml(message.text || '')}</div>
            `;
            area.appendChild(bubble);
            _startBubbleFadeDelayed(bubble, 8000);
        }
    }

    function _startBubbleFadeDelayed(bubble, delay) {
        setTimeout(() => _startBubbleFade(bubble), delay);
    }

    function _startBubbleFade(bubble) {
        // 如果正在播放，等播放完再消失（由audio.onended触发）
        if (bubble._isPlaying) return;
        if (bubble.classList.contains('fading')) return;
        bubble.classList.add('fading');
        setTimeout(() => { if (bubble.isConnected) bubble.remove(); }, 1000);
    }

    function showCompanionTyping() {
        const el = document.getElementById('companion-typing-indicator');
        if (!el) return;
        const partnerName = getPartnerName();
        const nameEl = el.querySelector('.companion-typing-name');
        if (nameEl) nameEl.textContent = `${partnerName} 正在输入`;
        const avEl = el.querySelector('.companion-typing-avatar');
        const avSrc = getPartnerAvatarSrc();
        if (avEl) {
            avEl.innerHTML = avSrc ? `<img src="${avSrc}">` : `<i class="fas fa-user"></i>`;
        }
        el.classList.add('active');
    }

    function hideCompanionTyping() {
        const el = document.getElementById('companion-typing-indicator');
        if (el) el.classList.remove('active');
    }

    // 监听首页 typing-indicator 显示/隐藏，同步到陪伴页
    function watchTypingIndicator() {
        const ti = document.getElementById('typing-indicator-wrapper');
        if (!ti) {
            // 元素还没出现，500ms 后重试（最多 10 次）
            if ((watchTypingIndicator._retries = (watchTypingIndicator._retries || 0) + 1) < 10) {
                setTimeout(watchTypingIndicator, 500);
            }
            return;
        }
        const observer = new MutationObserver(() => {
            const page = document.getElementById('companion-page');
            if (!page || !page.classList.contains('active')) return;
            const isShown = ti.style.display !== 'none' && ti.style.display !== '';
            if (isShown) {
                showCompanionTyping();
            } else {
                hideCompanionTyping();
            }
        });
        observer.observe(ti, { attributes: true, attributeFilter: ['style'] });
    }

    // ─── 陪伴对话历史弹窗 ──────────────────────────────────────────────────
    function openCompanionHistory() {
        // 移除残留
        document.querySelectorAll('#companion-history-modal').forEach(el => el.remove());

        const modal = document.createElement('div');
        modal.id = 'companion-history-modal';
        modal.className = 'companion-history-modal active';

        const partnerAvSrc = getPartnerAvatarSrc();
        const partnerAvatarHtml = partnerAvSrc ? `<img src="${partnerAvSrc}">` : `<i class="fas fa-user"></i>`;
        const userAvSrc = getMyAvatarSrc();
        const userAvatarHtml = userAvSrc ? `<img src="${userAvSrc}">` : `<i class="fas fa-user"></i>`;

        let listHtml = '';
        if (_sessionDialogue.length === 0) {
            listHtml = `<div class="companion-history-empty">暂无对话</div>`;
        } else {
            listHtml = _sessionDialogue.map((m, idx) => {
                const isUser = m.sender === 'user';
                const avatarHtml = isUser ? userAvatarHtml : partnerAvatarHtml;
                const itemClass = isUser
                    ? 'companion-history-item companion-history-item-user'
                    : 'companion-history-item';
                if (m.image) {
                    return `
                        <div class="${itemClass} companion-history-item-image">
                            <div class="companion-bubble-avatar">${avatarHtml}</div>
                            <img class="companion-bubble-image-raw" src="${m.image}">
                        </div>
                    `;
                }
                if (m.voice) {
                    const duration = m.voice.duration || 3;
                    const fakeText = m.voice.fakeText || '';
                    const msgId = m.voice.msgId;
                    const widthPx = Math.round(80 + Math.min(duration, 60) / 60 * 100);
                    return `
                        <div class="${itemClass}">
                            <div class="companion-bubble-avatar">${avatarHtml}</div>
                            <div class="companion-bubble-content companion-history-voice-btn" style="cursor:pointer;padding:8px 12px;display:flex;flex-direction:column;gap:6px;" data-msg-id="${msgId}" data-fake-text="${escapeHtml(fakeText)}" data-idx="${idx}">
                                <div style="min-width:${widthPx}px;display:flex;align-items:center;gap:8px;">
                                    <svg viewBox="0 0 22 22" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <circle cx="6" cy="11" r="1.3" fill="currentColor" stroke="none"/>
                                        <path d="M10 8 A 3.5 3.5 0 0 1 10 14"/>
                                        <path d="M13 5 A 7 7 0 0 1 13 17"/>
                                    </svg>
                                    <span style="font-size:13px;">${duration}"</span>
                                </div>
                                ${fakeText ? `<div style="font-size:12px;opacity:0.85;border-top:1px solid rgba(0,0,0,0.08);padding-top:5px;">${escapeHtml(fakeText)}</div>` : ''}
                            </div>
                        </div>
                    `;
                }
                return `
                    <div class="${itemClass}">
                        <div class="companion-bubble-avatar">${avatarHtml}</div>
                        <div class="companion-bubble-content">${escapeHtml(m.text || '')}</div>
                    </div>
                `;
            }).join('');
        }

        modal.innerHTML = `
            <div class="companion-history-box">
                <div class="companion-history-header">
                    <button class="companion-history-close" title="关闭">
                        <i class="fas fa-xmark"></i>
                    </button>
                </div>
                <div class="companion-history-list">${listHtml}</div>
            </div>
        `;

        document.documentElement.appendChild(modal);

        // 历史记录图片懒加载（oss:// 引用）
        if (window.CloudMedia) {
            modal.querySelectorAll('img.companion-bubble-image-raw').forEach(function(imgEl) {
                var src = imgEl.getAttribute('src') || '';
                if (src.indexOf('oss://') === 0) {
                    imgEl.removeAttribute('src');
                    window.CloudMedia.bindLazyImage(imgEl, src);
                }
            });
        }

        // 关闭按钮
        modal.querySelector('.companion-history-close').addEventListener('click', () => {
            modal.classList.remove('active');
            setTimeout(() => { if (modal.isConnected) modal.remove(); }, 300);
            const historyBtn = document.getElementById('companion-history-btn');
            if (historyBtn) historyBtn.classList.remove('active');
        });
        // 点背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
                setTimeout(() => { if (modal.isConnected) modal.remove(); }, 300);
                const historyBtn = document.getElementById('companion-history-btn');
                if (historyBtn) historyBtn.classList.remove('active');
            }
        });

        // 历史记录里语音条点击播放
        modal.querySelectorAll('.companion-history-voice-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!window.voiceTTS || !window.voiceTTS.isTtsReady()) return;
                if (btn.dataset.playing === '1') return;
                const msgId = btn.dataset.msgId;
                const fakeText = btn.dataset.fakeText;
                if (!fakeText) return;
                btn.dataset.playing = '1';
                btn.style.opacity = '0.6';
                try {
                    const audioUrl = await window.voiceTTS.getAudioForMessage(msgId, fakeText);
                    const audio = new Audio(audioUrl);
                    if (window.voiceTTS.applyPlaybackSettings) window.voiceTTS.applyPlaybackSettings(audio);
                    audio.play();
                    audio.onended = () => {
                        btn.dataset.playing = '0';
                        btn.style.opacity = '1';
                    };
                    audio.onerror = () => {
                        btn.dataset.playing = '0';
                        btn.style.opacity = '1';
                    };
                } catch (e) {
                    btn.dataset.playing = '0';
                    btn.style.opacity = '1';
                    console.error('[history voice]', e);
                }
            });
        });

        // 滚到底（最新对话）
        const list = modal.querySelector('.companion-history-list');
        if (list) list.scrollTop = list.scrollHeight;
    }


    // ─── 设置面板（右侧滑出）────────────────────────────────────────────────

    // 旧"陪伴页右上角设置面板"已移除，这里保留空函数防御性兜底
    function openSettingsPanel() {
        // 设置面板已迁移到外观设置 → 背景&字体
    }
    function closeSettingsPanel() { /* no-op */ }
    function renderSettingsPanel() { /* no-op */ }

    function renderVoiceManagerInPanel() {
        // ⚠️ 此函数对应的"陪伴页内右上角设置面板"将在后续移除，
        // 这里只做最低限度的兼容，避免数据结构变化引起报错
        const list = $('panel-voice-list');
        if (!list) return;
        list.innerHTML = '<p class="companion-empty-hint">请到外观设置 → 背景&字体 里管理语音</p>';
    }

    // 兼容旧调用（不再使用，仅防报错）
    window._updateVoiceName = async () => {};
    window._playVoiceById   = () => {};
    window._deleteVoice     = async () => {};

    // 面板内上传新语音
    async function handlePanelVoiceUpload(e) {
        const files = Array.from(e.target.files);
        let addedCount = 0;
        let skippedCount = 0;
        for (const file of files) {
            // 兼容 iOS：用 type 或文件后缀判断
            const isAudio = file.type.startsWith('audio/') ||
                /\.(mp3|m4a|aac|wav|ogg|flac|amr|opus)$/i.test(file.name);
            if (!isAudio) {
                skippedCount++;
                continue;
            }
            try {
                const base64 = await readFileAsBase64(file);
                // 改用当前场景的语音列表
                const targetMode = currentMode || 'study';
                if (!companionData.voices[targetMode]) companionData.voices[targetMode] = [];
                let mediaData = base64;
                let cloudKey = null;
                try {
                    const r = await _uploadCompanionMedia(base64, 'companion-voices');
                    mediaData = r.data;
                    cloudKey = r.cloudKey;
                } catch (e) {
                    console.warn('[companion] 语音云端上传失败，降级本地', e);
                }
                companionData.voices[targetMode].push({
                    id: generateId(),
                    data: mediaData,
                    cloudKey,
                    name: file.name.replace(/\.[^/.]+$/, ''),
                    addedAt: Date.now()
                });
                addedCount++;
            } catch (err) {
                console.error('[companion] 语音读取失败', err);
                skippedCount++;
            }
        }
        if (addedCount > 0) {
            await saveCompanionData();
            renderVoiceManagerInPanel();
            notify(`已添加 ${addedCount} 段语音${skippedCount > 0 ? `（${skippedCount} 个非音频文件已跳过）` : ''}`, 'success');
        } else if (skippedCount > 0) {
            notify('请选择音频文件（mp3/m4a/wav 等），不能上传图片或视频', 'warning');
        }
        e.target.value = '';
    }

    // 面板内换背景
    async function handlePanelBgUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');
        if (!isVideo && !isImage) { notify('请上传图片或视频', 'error'); return; }
        if (file.size > 100 * 1024 * 1024) notify('文件超过 100MB，加载可能较慢', 'warning');

        notify('正在处理...', 'info');
        const base64 = await readFileAsBase64(file);
        let mediaData = base64;
        let cloudKey = null;
        try {
            notify('正在上传到云端...', 'info', 2000);
            const r = await _uploadCompanionMedia(base64, 'companion-backgrounds');
            mediaData = r.data;
            cloudKey = r.cloudKey;
        } catch (e) {
            console.warn('[companion] 背景云端上传失败，降级本地', e);
        }
        const bg = { id: generateId(), type: isVideo ? 'video' : 'image', data: mediaData, cloudKey, name: file.name, addedAt: Date.now() };
        companionData.backgrounds[currentMode].push(bg);
        await saveCompanionData();

        // 立即切换背景（renderCompanionBackground 会处理 oss:// 引用）
        renderCompanionBackground(bg);
        closeSettingsPanel();
        notify('背景已更换', 'success');
        e.target.value = '';
    }

    // ─── 退出确认 ────────────────────────────────────────────────────────────

    function showExitConfirm() {
        $('companion-exit-confirm').classList.add('active');
    }
    function hideExitConfirm() {
        $('companion-exit-confirm').classList.remove('active');
    }

    // ─── 历史记录 ────────────────────────────────────────────────────────────

    async function recordHistory() {
        const elapsed = isCountdown ? (totalSeconds - timerSeconds) : timerSeconds;
        if (elapsed < 5) return; // 不足5秒不记录
        companionData.history = companionData.history || [];
        companionData.history.unshift({
            mode: currentMode,
            duration: elapsed,
            date: new Date().toISOString().slice(0, 10)
        });
        // 只保留最近 100 条
        if (companionData.history.length > 100) companionData.history = companionData.history.slice(0, 100);
        await saveCompanionData();
    }

    // ────────────────────────────────────────────────────────────────────
    //  外观设置里的"陪伴背景/语音"管理 UI
    // ────────────────────────────────────────────────────────────────────

    // 当前选中的 tab（背景管理 + 语音管理 各自记录）
    const _mgrState = { bg: 'study', voice: 'study', noise: 'study' };

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    // ── 渲染：陪伴背景列表 ──
    function renderCompanionBgManager() {
        const list = document.getElementById('companion-bg-list');
        if (!list) return;
        const mode = _mgrState.bg;
        const items = (companionData.backgrounds[mode] || []);
        const selectedId = companionData.selectedBg && companionData.selectedBg[mode];
        // 没有 selectedId 时默认第一个为选中
        const activeId = selectedId || (items.length > 0 ? items[0].id : null);

        let html = '';
        if (items.length === 0) {
            html += `<div class="companion-mgr-empty">
                还没有添加${escapeHtml(MODES[mode].label.slice(2))}场景的背景<br>
                点击下方按钮上传图片或视频
            </div>`;
        } else {
            html += items.map(bg => {
                const isCloud = typeof bg.data === 'string' && bg.data.indexOf('oss://') === 0;
                const isUploading = bg._uploading === true;
                const isActive = bg.id === activeId;
                const thumbHtml = bg.type === 'video'
                    ? (isCloud
                        ? `<div class="companion-bg-thumb-placeholder"><i class="fas fa-video"></i></div><span class="type-badge">视频</span>`
                        : `<video src="${bg.data}" muted></video><span class="type-badge">视频</span>`)
                    : (isCloud
                        ? `<img data-lazy-cloud-ref="${bg.data}" alt="">`
                        : `<img src="${bg.data}" alt="">`);
                return `
                <div class="companion-bg-card${isActive ? ' companion-bg-card--active' : ''}" data-id="${bg.id}" data-action="select-bg">
                    <div class="companion-bg-card-thumb">
                        ${thumbHtml}
                        ${isActive ? `<div class="companion-bg-card-check"><i class="fas fa-check"></i></div>` : ''}
                        ${isUploading ? `<div class="companion-bg-upload-progress"><div class="companion-bg-upload-bar" style="width:${bg._progress || 0}%"></div><span class="companion-bg-upload-label">上传中…</span></div>` : ''}
                    </div>
                    <div class="companion-bg-card-info">
                        <div class="companion-bg-card-name">${escapeHtml(bg.name || '未命名')}</div>
                        <div class="companion-bg-card-meta">${bg.type === 'video' ? '视频' : '图片'}${isActive ? ' · 使用中' : ''}</div>
                    </div>
                    <div class="companion-bg-card-actions">
                        ${!isUploading ? `<button class="companion-mgr-iconbtn danger" data-action="delete-bg" data-id="${bg.id}" title="删除"><i class="fas fa-trash-can"></i></button>` : ''}
                    </div>
                </div>
            `; }).join('');
        }
        html += `<button class="companion-mgr-add" id="companion-bg-add-btn">
            <i class="fas fa-plus"></i> 添加${escapeHtml(MODES[mode].label.slice(2))}背景
        </button>`;
        list.innerHTML = html;
        // 绑定云端图懒加载
        if (window.CloudMedia) {
            list.querySelectorAll('img[data-lazy-cloud-ref]').forEach(function (imgEl) {
                window.CloudMedia.bindLazyImage(imgEl, imgEl.getAttribute('data-lazy-cloud-ref'));
            });
        }
        // 绑定点击选中
        list.querySelectorAll('.companion-bg-card[data-action="select-bg"]').forEach(function (card) {
            card.addEventListener('click', function (e) {
                if (e.target.closest('[data-action="delete-bg"]')) return; // 点删除不触发选中
                const id = card.dataset.id;
                const bg = (companionData.backgrounds[mode] || []).find(b => b.id === id);
                if (!bg || bg._uploading) return; // 上传中不可选
                if (!companionData.selectedBg) companionData.selectedBg = {};
                companionData.selectedBg[mode] = id;
                saveCompanionData();
                renderCompanionBgManager();
                notify('已选定为当前背景', 'success');
            });
        });
    }

    // ── 渲染：陪伴语音列表 ──
    function renderCompanionVoiceManager() {
        const list = document.getElementById('companion-voice-list');
        if (!list) return;
        const mode = _mgrState.voice;
        const items = (companionData.voices[mode] || []);

        let html = '';
        if (items.length === 0) {
            html += `<div class="companion-mgr-empty">
                还没有添加${escapeHtml(MODES[mode].label.slice(2))}场景的语音<br>
                点击下方按钮上传音频文件
            </div>`;
        } else {
            html += items.map(v => `
                <div class="companion-voice-card" data-id="${v.id}">
                    <i class="fas fa-music"></i>
                    <input type="text" class="companion-voice-card-name"
                        value="${escapeHtml(v.name || '')}"
                        data-action="rename-voice" data-id="${v.id}"
                        placeholder="语音名称">
                    <div class="companion-voice-card-actions">
                        <button class="companion-mgr-iconbtn" data-action="play-voice" data-id="${v.id}" title="试听">
                            <i class="fas fa-play"></i>
                        </button>
                        <button class="companion-mgr-iconbtn danger" data-action="delete-voice" data-id="${v.id}" title="删除">
                            <i class="fas fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            `).join('');
        }
        html += `<button class="companion-mgr-add" id="companion-voice-add-btn">
            <i class="fas fa-plus"></i> 添加${escapeHtml(MODES[mode].label.slice(2))}语音
        </button>`;
        list.innerHTML = html;
    }

    // ── 渲染：陪伴白噪音列表 ──
    function renderCompanionNoiseManager() {
        const list = document.getElementById('companion-noise-list');
        if (!list) return;
        const mode = _mgrState.noise;
        const items = (companionData.noises[mode] || []);

        let html = '';
        if (items.length === 0) {
            html += `<div class="companion-mgr-empty">
                还没有添加${escapeHtml(MODES[mode].label.slice(2))}场景的音乐<br>
                点击下方按钮上传音频文件
            </div>`;
        } else {
            html += items.map(v => `
                <div class="companion-voice-card" data-id="${v.id}">
                    <i class="fas fa-music"></i>
                    <input type="text" class="companion-voice-card-name"
                        value="${escapeHtml(v.name || '')}"
                        data-action="rename-noise" data-id="${v.id}"
                        placeholder="音乐名称">
                    <div class="companion-voice-card-actions">
                        <button class="companion-mgr-iconbtn" data-action="play-noise" data-id="${v.id}" title="试听">
                            <i class="fas fa-play"></i>
                        </button>
                        <button class="companion-mgr-iconbtn danger" data-action="delete-noise" data-id="${v.id}" title="删除">
                            <i class="fas fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            `).join('');
        }
        html += `<button class="companion-mgr-add" id="companion-noise-add-btn">
            <i class="fas fa-plus"></i> 添加${escapeHtml(MODES[mode].label.slice(2))}音乐
        </button>`;
        list.innerHTML = html;
    }

    // ── 切换 tab ──
    function switchMgrTab(type, mode) {
        _mgrState[type] = mode;
        let tabsId;
        if (type === 'bg') tabsId = 'companion-bg-tabs';
        else if (type === 'voice') tabsId = 'companion-voice-tabs';
        else if (type === 'noise') tabsId = 'companion-noise-tabs';
        const tabs = document.getElementById(tabsId);
        if (tabs) {
            tabs.querySelectorAll('.companion-mgr-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.mode === mode);
            });
        }
        if (type === 'bg') renderCompanionBgManager();
        else if (type === 'voice') renderCompanionVoiceManager();
        else if (type === 'noise') renderCompanionNoiseManager();
    }

    // ── 上传：背景 ──
    async function handleMgrBgUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');
        if (!isVideo && !isImage) {
            notify('请选择图片或视频文件', 'error');
            return;
        }
        if (file.size > 500 * 1024 * 1024) {
            notify('文件超过 500MB，无法上传', 'error');
            return;
        }
        if (file.size > 100 * 1024 * 1024) notify('文件较大，上传可能需要一些时间', 'info', 3000);

        await ensureDataLoaded();
        const mode = _mgrState.bg;
        const id = generateId();

        // 1. 立刻用 ObjectURL 生成本地预览
        const localUrl = URL.createObjectURL(file);

        // 2. 创建占位条目，立刻插入列表
        const placeholder = {
            id,
            type: isVideo ? 'video' : 'image',
            data: localUrl,
            name: file.name,
            addedAt: Date.now(),
            _uploading: true,
            _progress: 0
        };
        if (!companionData.backgrounds[mode]) companionData.backgrounds[mode] = [];
        companionData.backgrounds[mode].push(placeholder);
        renderCompanionBgManager(); // 只在插入时全量渲染一次

        // 只操作单个卡片进度条，不重建整个列表
        function _updateCardProgress(pct) {
            const list = document.getElementById('companion-bg-list');
            if (!list) return;
            const card = list.querySelector(`.companion-bg-card[data-id="${id}"]`);
            if (!card) return;
            const bar = card.querySelector('.companion-bg-upload-bar');
            if (bar) bar.style.width = pct + '%';
        }

        // 3. 后台上传
        try {
            const cloudReady = !!(window.CloudMedia && window.CloudSync && window.CloudSync.isConnected());
            let mediaData = localUrl;
            let cloudKey = null;

            if (cloudReady) {
                let fakeProgress = 0;
                const fakeTimer = setInterval(() => {
                    fakeProgress = Math.min(fakeProgress + Math.random() * 12, 85);
                    placeholder._progress = Math.round(fakeProgress);
                    _updateCardProgress(placeholder._progress); // 只更新进度条，不重建列表
                }, 800);

                try {
                    const r = await _uploadCompanionMedia(file, 'companion-backgrounds');
                    mediaData = r.data;
                    cloudKey = r.cloudKey;
                } finally {
                    clearInterval(fakeTimer);
                }
            }

            // 4. 上传完成
            placeholder.data = mediaData;
            placeholder.cloudKey = cloudKey;
            placeholder._uploading = false;
            delete placeholder._progress;
            if (mediaData !== localUrl) URL.revokeObjectURL(localUrl);
            await saveCompanionData();
            renderCompanionBgManager(); // 上传完成后全量刷一次（去掉进度条，显示勾选）
            notify('背景已添加', 'success');
        } catch (err) {
            console.error('[companion] 背景上传失败', err);
            // 上传失败：不能把 blob URL 存进 localforage（刷新后会失效报错）
            // 直接从数组里移除这条记录，告知用户重试
            const idx = companionData.backgrounds[mode].indexOf(placeholder);
            if (idx !== -1) companionData.backgrounds[mode].splice(idx, 1);
            URL.revokeObjectURL(localUrl);
            notify('上传失败，请检查网络后重试', 'error', 3000);
            await saveCompanionData();
            renderCompanionBgManager();
        }
        e.target.value = '';
    }

    // ── 上传：语音 ──
    async function handleMgrVoiceUpload(e) {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        await ensureDataLoaded();

        let addedCount = 0;
        let skippedCount = 0;
        for (const file of files) {
            const isAudio = file.type.startsWith('audio/') ||
                /\.(mp3|m4a|aac|wav|ogg|flac|amr|opus)$/i.test(file.name);
            if (!isAudio) { skippedCount++; continue; }
            try {
                let mediaData = null;
                let cloudKey = null;
                const cloudReady = !!(window.CloudMedia && window.CloudSync && window.CloudSync.isConnected());
                if (cloudReady) {
                    const r = await _uploadCompanionMedia(file, 'companion-voices');
                    mediaData = r.data;
                    cloudKey = r.cloudKey;
                } else {
                    // 没连云端降级为 base64（兼容老逻辑）
                    const base64 = await readFileAsBase64(file);
                    mediaData = base64;
                }
                companionData.voices[_mgrState.voice].push({
                    id: generateId(),
                    data: mediaData,
                    cloudKey,
                    name: file.name.replace(/\.[^/.]+$/, ''),
                    addedAt: Date.now()
                });
                addedCount++;
            } catch (err) {
                console.error('[companion] 语音读取失败', err);
                skippedCount++;
            }
        }
        if (addedCount > 0) {
            await saveCompanionData();
            renderCompanionVoiceManager();
            notify(`已添加 ${addedCount} 段语音${skippedCount ? `（${skippedCount} 个跳过）` : ''}`, 'success');
        } else if (skippedCount > 0) {
            notify('请选择音频文件（mp3/m4a/wav 等）', 'warning');
        }
        e.target.value = '';
    }

    // ── 删除/重命名/试听 ──
    function handleMgrAction(action, id) {
        let mode;
        if (action.includes('noise')) mode = _mgrState.noise;
        else if (action.includes('voice')) mode = _mgrState.voice;
        else mode = _mgrState.bg;

        if (action === 'delete-bg') {
            if (!confirm('确定删除这个背景吗？')) return;
            const item = companionData.backgrounds[mode].find(x => x.id === id);
            companionData.backgrounds[mode] = companionData.backgrounds[mode].filter(x => x.id !== id);
            saveCompanionData();
            renderCompanionBgManager();
            notify('已删除', 'success');
            // 异步清云端（不阻塞 UI）
            if (item && item.cloudKey && window.CloudMedia) {
                window.CloudMedia.delete(item.cloudKey).catch(e => console.warn('[companion] 云端删除失败', e));
            }
        } else if (action === 'delete-voice') {
            if (!confirm('确定删除这段语音吗？')) return;
            const item = companionData.voices[mode].find(x => x.id === id);
            companionData.voices[mode] = companionData.voices[mode].filter(x => x.id !== id);
            saveCompanionData();
            renderCompanionVoiceManager();
            notify('已删除', 'success');
            if (item && item.cloudKey && window.CloudMedia) {
                window.CloudMedia.delete(item.cloudKey).catch(e => console.warn('[companion] 云端删除失败', e));
            }
        } else if (action === 'play-voice') {
            const v = companionData.voices[mode].find(x => x.id === id);
            if (v) playVoice(v);
        } else if (action === 'delete-noise') {
            if (!confirm('确定删除这段音乐吗？')) return;
            const item = companionData.noises[mode].find(x => x.id === id);
            companionData.noises[mode] = companionData.noises[mode].filter(x => x.id !== id);
            // 如果当前播放的就是这个，停掉
            const choice = companionData.lastNoiseChoice && companionData.lastNoiseChoice[mode];
            if (choice && choice.type === 'custom' && choice.id === id) {
                companionData.lastNoiseChoice[mode] = null;
                stopNoise();
            }
            saveCompanionData();
            renderCompanionNoiseManager();
            notify('已删除', 'success');
            if (item && item.cloudKey && window.CloudMedia) {
                window.CloudMedia.delete(item.cloudKey).catch(e => console.warn('[companion] 云端删除失败', e));
            }
        } else if (action === 'play-noise') {
            const v = companionData.noises[mode].find(x => x.id === id);
            if (v) playVoice(v);
        }
    }

    function handleMgrVoiceRename(id, newName) {
        const mode = _mgrState.voice;
        const v = companionData.voices[mode].find(x => x.id === id);
        if (v) {
            v.name = newName;
            saveCompanionData();
        }
    }

    function handleMgrNoiseRename(id, newName) {
        const mode = _mgrState.noise;
        const v = companionData.noises[mode].find(x => x.id === id);
        if (v) {
            v.name = newName;
            saveCompanionData();
        }
    }

    // ── 上传：白噪音 ──
    async function handleMgrNoiseUpload(e) {
        const files = Array.from(e.target.files);
        let addedCount = 0;
        let skippedCount = 0;
        await ensureDataLoaded();
        for (const file of files) {
            const isAudio = file.type.startsWith('audio/') ||
                /\.(mp3|m4a|aac|wav|ogg|flac|amr|opus)$/i.test(file.name);
            if (!isAudio) { skippedCount++; continue; }
            try {
                let mediaData = null;
                let cloudKey = null;
                const cloudReady = !!(window.CloudMedia && window.CloudSync && window.CloudSync.isConnected());
                if (cloudReady) {
                    const r = await _uploadCompanionMedia(file, 'companion-noises');
                    mediaData = r.data;
                    cloudKey = r.cloudKey;
                } else {
                    const base64 = await readFileAsBase64(file);
                    mediaData = base64;
                }
                companionData.noises[_mgrState.noise].push({
                    id: generateId(),
                    data: mediaData,
                    cloudKey,
                    name: file.name.replace(/\.[^/.]+$/, ''),
                    addedAt: Date.now()
                });
                addedCount++;
            } catch (err) {
                console.error('[companion] 白噪音读取失败', err);
                skippedCount++;
            }
        }
        if (addedCount > 0) {
            await saveCompanionData();
            renderCompanionNoiseManager();
            notify(`已添加 ${addedCount} 段音乐${skippedCount ? `（${skippedCount} 个跳过）` : ''}`, 'success');
        } else if (skippedCount > 0) {
            notify('请选择音频文件（mp3/m4a/wav 等）', 'warning');
        }
        e.target.value = '';
    }

    // ── 绑定外观设置面板的事件（用事件委托，因为 DOM 可能在打开外观设置时才显示）──
    function bindMgrEvents() {
        // tab 切换 + 操作按钮 + 加号按钮 —— 全用事件委托
        document.addEventListener('click', function (e) {
            // tab 切换
            const tab = e.target.closest('.companion-mgr-tab');
            if (tab) {
                const tabsEl = tab.closest('.companion-mgr-tabs');
                const type = tabsEl?.dataset.mgr;
                if (type && tab.dataset.mode) {
                    switchMgrTab(type, tab.dataset.mode);
                    return;
                }
            }

            // 删除/试听
            const actionBtn = e.target.closest('[data-action]');
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                const id = actionBtn.dataset.id;
                if (action && id && action !== 'rename-voice' && action !== 'rename-noise') {
                    handleMgrAction(action, id);
                    return;
                }
            }

            // 加号按钮
            if (e.target.closest('#companion-bg-add-btn')) {
                document.getElementById('companion-bg-upload-input')?.click();
                return;
            }
            if (e.target.closest('#companion-voice-add-btn')) {
                document.getElementById('companion-voice-upload-input')?.click();
                return;
            }
            if (e.target.closest('#companion-noise-add-btn')) {
                document.getElementById('companion-noise-upload-input')?.click();
                return;
            }
        });

        // 语音 / 白噪音重命名
        document.addEventListener('change', function (e) {
            if (e.target.matches('[data-action="rename-voice"]')) {
                handleMgrVoiceRename(e.target.dataset.id, e.target.value);
            } else if (e.target.matches('[data-action="rename-noise"]')) {
                handleMgrNoiseRename(e.target.dataset.id, e.target.value);
            }
        });

        // 文件 input 的 change 事件
        const bgInput = document.getElementById('companion-bg-upload-input');
        if (bgInput) bgInput.addEventListener('change', handleMgrBgUpload);
        const voiceInput = document.getElementById('companion-voice-upload-input');
        if (voiceInput) voiceInput.addEventListener('change', handleMgrVoiceUpload);
        const noiseInput = document.getElementById('companion-noise-upload-input');
        if (noiseInput) noiseInput.addEventListener('change', handleMgrNoiseUpload);

        // 触发渲染：用户切到"背景&字体"面板时
        document.addEventListener('click', async (e) => {
            const card = e.target.closest('[onclick*="font-bg"], [onclick*="background"]');
            if (card) {
                setTimeout(async () => {
                    await ensureDataLoaded();
                    renderCompanionBgManager();
                    renderCompanionVoiceManager();
                    renderCompanionNoiseManager();
                }, 100);
            }
        });

        // 策略 2：直接立即渲染一次
        setTimeout(async () => {
            await ensureDataLoaded();
            renderCompanionBgManager();
            renderCompanionVoiceManager();
            renderCompanionNoiseManager();
        }, 500);

        // 策略 3：MutationObserver 兜底
        const bgPanel = document.getElementById('appearance-panel-background');
        if (bgPanel) {
            const observer = new MutationObserver(async () => {
                if (bgPanel.style.display !== 'none') {
                    await ensureDataLoaded();
                    renderCompanionBgManager();
                    renderCompanionVoiceManager();
                    renderCompanionNoiseManager();
                }
            });
            observer.observe(bgPanel, { attributes: true, attributeFilter: ['style'] });
        }
    }

    // ─── 初始化：绑定所有事件 ────────────────────────────────────────────────

    function bindEvents() {
        // 顶部按钮 —— 用事件委托，无论按钮何时出现都能响应
        document.addEventListener('click', function (e) {
            const btn = e.target.closest && e.target.closest('#companion-btn');
            if (btn) {
                e.stopPropagation();
                e.preventDefault();
                console.log('[companion] 陪伴按钮被点击');
                handleEntryClick();
            }
        }, true); // 用捕获阶段，确保抢在其他监听器之前

        // 陪伴模式卡片 —— 用 data-mode 属性识别（class 可能被原项目清理）
        document.addEventListener('click', function (e) {
            const card = e.target.closest && e.target.closest('[data-mode]');
            if (card && card.closest && card.closest('#companion-modal')) {
                e.stopPropagation();
                e.preventDefault();
                selectMode(card.dataset.mode);
            }
        }, true);

        // 陪伴选择弹窗（点击遮罩关闭）
        const modal = $('companion-modal');
        if (modal) {
            modal.addEventListener('click', e => {
                if (e.target === modal) closeCompanionModal();
            });
        }
        const closeModalBtn = $('companion-modal-close');
        if (closeModalBtn) closeModalBtn.addEventListener('click', closeCompanionModal);

        // 陪伴页
        const page = $('companion-page');
        if (page) page.addEventListener('click', handlePageClick);

        const exitBtn = $('companion-exit-btn');
        if (exitBtn) exitBtn.addEventListener('click', showExitConfirm);

        const exitConfirmYes = $('exit-confirm-yes');
        if (exitConfirmYes) exitConfirmYes.addEventListener('click', () => {
            // 先收起退出确认弹窗
            $('companion-exit-confirm')?.classList.remove('active');
            // 显示过渡画面（覆盖后悄悄关闭陪伴页，留痕 xx陪伴已结束）
            showCompanionTransition(
                pickRandom(TRANSITION_LINES.userExit),
                null,
                () => closeCompanionPage()
            );
        });

        const exitConfirmNo = $('exit-confirm-no');
        if (exitConfirmNo) exitConfirmNo.addEventListener('click', hideExitConfirm);

        // 白噪音按钮（右下角悬浮）
        const noiseBtn = $('companion-noise-btn');
        if (noiseBtn) {
            noiseBtn.addEventListener('click', (e) => {
                e.stopPropagation();  // 阻止冒泡到 handlePageClick 触发语音
                openNoiseCard();
            });
        }

        // 对话历史按钮（右下角悬浮，音符按钮上方）
        const historyBtn = $('companion-history-btn');
        if (historyBtn) {
            historyBtn.addEventListener('click', (e) => {
                e.stopPropagation();  // 阻止冒泡
                historyBtn.classList.add('active');
                openCompanionHistory();
            });
        }

        // 注册"梦角说话"钩子 — core.js addMessage 末尾会调用
        window._onPartnerMessage = onPartnerMessage;
        // 注册"用户说话"钩子（陪伴页气泡同步显示用户消息）
        window._onUserMessage = onUserMessage;

        // 监听首页 typing-indicator 的显示/隐藏，同步到陪伴页
        watchTypingIndicator();

        // ── 键盘按钮 + 输入区绑定 ───────────────────────────────
        bindCompanionInputBar();

        // 设置面板入口和相关元素已移除（统一去外观设置 → 背景&字体 管理）
    }

    // ─── 陪伴输入区逻辑 ─────────────────────────────────────
    function bindCompanionInputBar() {
        const kbBtn = document.getElementById('companion-keyboard-btn');
        const bar = document.getElementById('companion-input-bar');
        const field = document.getElementById('companion-input-field');
        const emojiBtn = document.getElementById('companion-emoji-btn');
        const imageBtn = document.getElementById('companion-image-btn');
        const page = document.getElementById('companion-page');
        if (!kbBtn || !bar || !field || !page) return;

        // 切换显示/隐藏
        kbBtn.addEventListener('click', () => {
            const isVisible = bar.classList.contains('visible');
            if (isVisible) {
                bar.classList.remove('visible');
                kbBtn.classList.remove('active');
                page.classList.remove('companion-input-active');
                field.blur();
                // 收起时也关闭表情面板
                const picker = document.getElementById('user-sticker-picker');
                if (picker) picker.classList.remove('active');
            } else {
                bar.classList.add('visible');
                kbBtn.classList.add('active');
                page.classList.add('companion-input-active');
                setTimeout(() => field.focus(), 50);
            }
        });

        // 回车发送
        field.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                doCompanionSend();
            }
        });

        // 表情包按钮 → 触发主聊天的表情面板，并把面板移到陪伴页里浮起来显示
        emojiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                const mainComboBtn = document.getElementById('combo-btn');
                const picker = document.getElementById('user-sticker-picker');
                if (!mainComboBtn || !picker) {
                    if (typeof showNotification === 'function') showNotification('表情功能加载失败', 'error');
                    return;
                }

                // 已经在陪伴页里显示 → 收起
                if (picker.dataset.companionMoved === '1' && picker.classList.contains('active')) {
                    picker.classList.remove('active');
                    picker.style.display = 'none';
                    return;
                }

                // 先记录原位置（第一次移动时）
                if (picker.dataset.companionMoved !== '1') {
                    window.__stickerPickerOriginalParent = picker.parentNode;
                    window.__stickerPickerOriginalNextSibling = picker.nextSibling;
                }

                // 触发主聊天的初始化逻辑（让面板内容渲染好）
                mainComboBtn.click();

                // 物理移到陪伴页里
                const companionPage = document.getElementById('companion-page');
                if (companionPage) {
                    companionPage.appendChild(picker);
                    picker.dataset.companionMoved = '1';
                    picker.classList.add('active');
                    // 浮在陪伴输入区上方 + 圆角
                    picker.style.cssText = 'position: absolute !important; left: 16px !important; right: 16px !important; bottom: 80px !important; top: auto !important; width: auto !important; max-width: none !important; max-height: 320px !important; z-index: 200 !important; display: flex !important; border-radius: 16px !important; overflow: hidden !important; box-shadow: 0 8px 32px rgba(0,0,0,0.25) !important;';

                    // 关闭逻辑已统一到 document-level（在外面注册），这里不重复绑定
                }
            } catch (e) { console.warn('[companion] emoji click failed', e); }
        });

        // ── 表情面板统一关闭逻辑 ───────────────────────────────
        if (!window.__companionStickerCloseInstalled) {
            document.addEventListener('click', (e) => {
                const picker = document.getElementById('user-sticker-picker');
                if (!picker || picker.dataset.companionMoved !== '1') return;
                if (!picker.classList.contains('active')) return;
                const target = e.target;
                if (!target) return;

                // 点在面板内：判断是否要关闭
                if (target.closest('#user-sticker-picker')) {
                    // 排除：tab 切换、添加按钮、头部、上传 input 等
                    if (target.closest('.combo-tab-btn') ||
                        target.closest('.sticker-grid-add') ||
                        target.closest('.combo-tabs-header') ||
                        target.closest('.sticker-delete-btn') ||
                        target.tagName === 'INPUT') {
                        return;
                    }
                    // 点表情图片本身（IMG）或者表情 item 容器 → 立即隐藏面板（发送照常进行）
                    if (target.tagName === 'IMG' ||
                        target.closest('.sticker-grid-item') ||
                        target.closest('.picker-item') ||
                        target.closest('.poke-item')) {
                        // 立即隐藏（让用户感觉点了就发了）
                        picker.classList.remove('active');
                        picker.style.display = 'none';
                    }
                    return;
                }

                // 点表情按钮本身 → 让它自己 toggle
                if (target.closest('#companion-emoji-btn')) return;

                // 点了其他地方 → 立即关闭
                picker.classList.remove('active');
                picker.style.display = 'none';
            }, true);
            window.__companionStickerCloseInstalled = true;
        }

        // 输入框获得焦点 → 关闭表情面板
        field.addEventListener('focus', () => {
            const picker = document.getElementById('user-sticker-picker');
            if (picker && picker.dataset.companionMoved === '1' && picker.classList.contains('active')) {
                picker.classList.remove('active');
                picker.style.display = 'none';
            }
        });

        // 图片按钮 → 触发主聊天的图片输入
        imageBtn.addEventListener('click', () => {
            try {
                const mainImageInput = document.getElementById('image-input');
                if (mainImageInput) mainImageInput.click();
                else if (typeof showNotification === 'function') {
                    showNotification('图片功能加载失败', 'error');
                }
            } catch (e) { console.warn('[companion] image click failed', e); }
        });
    }

    function doCompanionSend() {
        const field = document.getElementById('companion-input-field');
        if (!field) return;
        const text = (field.value || '').trim();
        if (!text) return;

        try {
            // 把文字塞进主输入框
            const mainInput = document.getElementById('message-input')
                || document.querySelector('.message-input');
            if (!mainInput) {
                console.warn('[companion] 找不到主输入框');
                return;
            }
            mainInput.value = text;

            // 触发主聊天的发送按钮
            const mainSendBtn = document.getElementById('send-btn')
                || document.querySelector('[data-action="send"]');
            if (mainSendBtn) {
                mainSendBtn.click();
            } else {
                // 兜底：触发 input 的回车
                const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
                mainInput.dispatchEvent(ev);
            }
        } catch (e) {
            console.warn('[companion] send failed', e);
        }

        // 清空陪伴输入框
        field.value = '';
        field.focus();
    }

    // ─── 入口 ────────────────────────────────────────────────────────────────

    let dataLoaded = false;

    // 等待 SESSION_ID 就绪（最多等 10 秒）
    function isSessionReady() {
        try {
            // 直接尝试访问全局 SESSION_ID（原项目用 const 声明，不在 window 上）
            // 用 Function 构造器避免 strict mode 的影响
            const sid = (new Function('try { return typeof SESSION_ID !== "undefined" ? SESSION_ID : null; } catch(e) { return null; }'))();
            return !!sid;
        } catch (e) {
            return false;
        }
    }

    async function waitForSession(maxWait = 10000) {
        const start = Date.now();
        while (Date.now() - start < maxWait) {
            if (isSessionReady()) return true;
            await new Promise(r => setTimeout(r, 200));
        }
        return false;
    }

    // 懒加载数据：在用户首次打开陪伴功能时才加载
    async function ensureDataLoaded() {
        if (dataLoaded) return true;
        const ready = await waitForSession();
        if (!ready) {
            notify('系统还在初始化，请稍后再试', 'warning');
            return false;
        }
        await loadCompanionData();
        dataLoaded = true;
        return true;
    }

    // 用户点击顶部"陪伴"按钮的真正入口
    async function handleEntryClick() {
        // 检查是否已经在某个陪伴流程中
        if (document.querySelector('#companion-inviting-overlay, #companion-incoming-overlay, #companion-modal-dynamic, #setup-modal-dynamic, #time-modal-dynamic')) {
            console.log('[companion] 已经在陪伴流程中，跳过');
            return;
        }
        if (document.getElementById('companion-page')?.classList.contains('active')) {
            console.log('[companion] 已经在陪伴页面，跳过');
            return;
        }
        const ok = await ensureDataLoaded();
        if (!ok) return;
        openCompanionModal();
    }

    async function init() {
        try {
            // 先绑定事件，这样按钮立刻可用
            bindEvents();
            // 绑定外观设置面板里的"陪伴背景/语音"管理 UI 的事件
            bindMgrEvents();
            console.log('[companion] 模块加载完成（数据将在首次使用时加载）');

            // 启动梦角主动邀请的随机定时器（15~60 分钟随机检查，25% 概率触发）
            scheduleRandomInvite();
        } catch (e) {
            console.error('[companion] 初始化失败，已跳过陪伴模块以保护主功能', e);
        }
    }

    // 等 DOM 就绪
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 0);
    }

    // ─── 测试接口（控制台用） ────────────────────────────────────────────
    // 用法：
    //   companionModule.testIncoming()           — 立即触发"梦角邀请你"
    //   companionModule.testIncoming('sleep')    — 指定场景的邀请
    //   companionModule.testReject('study')      — 强制拒绝（用户发起后梦角拒绝）
    //   companionModule.testAccept('work')       — 强制同意
    //   companionModule.stopRandomInvite()       — 停止随机邀请
    //   companionModule.scheduleRandomInvite()   — 重启随机邀请
    window.companionModule = {
        openCompanionModal,
        closeCompanionPage,

        // 测试：梦角主动邀请
        testIncoming: (mode) => showIncomingCompanion(mode),

        // 测试：强制拒绝（模拟用户走完"选场景 → 选时间 → 发起邀请"流程，梦角 100% 拒绝）
        testReject: async (mode = 'study') => {
            await ensureDataLoaded();
            _forceResult = 'reject';
            currentMode = mode;
            // 给一个默认 10 分钟，避免邀请等待画面里时间显示异常
            isCountdown = true;
            timerSeconds = 10 * 60;
            totalSeconds = 10 * 60;
            showCompanionInviting(mode);
            // 测试完后恢复随机
            setTimeout(() => { _forceResult = null; }, 15000);
        },

        // 测试：强制同意（模拟用户走完"选场景 → 选时间 → 发起邀请"流程，梦角 100% 同意）
        testAccept: async (mode = 'study') => {
            await ensureDataLoaded();
            _forceResult = 'accept';
            currentMode = mode;
            // 给一个默认 10 分钟，模拟用户选了时间
            isCountdown = true;
            timerSeconds = 10 * 60;
            totalSeconds = 10 * 60;
            showCompanionInviting(mode);
            setTimeout(() => { _forceResult = null; }, 15000);
        },

        // 测试：梦角立即提前离开（必须在陪伴中调用）
        testEarlyLeave: () => {
            if (!document.getElementById('companion-page')?.classList.contains('active')) {
                console.warn('[companion] 不在陪伴中，无法测试提前离开');
                return;
            }
            if (currentMode === 'sleep') {
                console.warn('[companion] 睡觉场景不会触发提前离开（按设计）');
                return;
            }
            triggerEarlyLeave();
        },

        // 测试：让下一次 5 分钟检查时强制离开（不用等概率）
        forceNextEarlyLeave: () => {
            _forceEarlyLeave = true;
            console.log('[companion] 下次 5 分钟检查时将强制离开');
        },

        // 测试：快速切换主题色（验证陪伴 UI 跟随主题色）
        // 用法：companionModule.testTheme('blue')
        // 可选：gold/blue/purple/green/pink/black-white/pastel/sunset/forest/ocean
        testTheme: (theme) => {
            const valid = ['gold','blue','purple','green','pink','black-white','pastel','sunset','forest','ocean'];
            if (!valid.includes(theme)) {
                console.log('可用主题:', valid.join(', '));
                return;
            }
            document.documentElement.setAttribute('data-color-theme', theme);
            console.log(`[companion] 已切换到 ${theme} 主题`);
        },

        // 测试：直接进陪伴页（跳过场景选择和邀请等待，秒进）
        // 用法：companionModule.testEnter('study', 25)   — 学习模式 25 分钟
        //      companionModule.testEnter('sleep', 'rest') — 睡觉模式好好休息
        testEnter: async (mode = 'study', time = 10) => {
            await ensureDataLoaded();
            currentMode = mode;
            if (time === 'rest') {
                isCountdown = false;
                timerSeconds = 0;
                totalSeconds = 0;
            } else {
                isCountdown = true;
                timerSeconds = parseInt(time) * 60;
                totalSeconds = parseInt(time) * 60;
            }
            openCompanionPage();
            console.log(`[companion] 已直接进入${mode}陪伴，${time === 'rest' ? '好好休息' : time + '分钟'}`);
        },

        // 测试：直接打开白噪音卡片（不需要在陪伴中）
        testNoiseCard: () => {
            if (!document.getElementById('companion-page')?.classList.contains('active')) {
                console.warn('[companion] 请先 testEnter() 进入陪伴页');
                return;
            }
            openNoiseCard();
        },

        // 测试：查看当前 noises 数据（看上传了什么）
        testNoiseData: () => {
            console.log('当前 noises:', JSON.parse(JSON.stringify(companionData.noises)));
            console.log('lastNoiseChoice:', JSON.parse(JSON.stringify(companionData.lastNoiseChoice)));
        },

        // 测试：手动播放白噪音（绕过 UI，直接调用 startNoise）
        // 用法：companionModule.testPlayNoise('rain')   — 雨天（音频文件待添加）
        //      companionModule.testPlayNoise('fire')   — 篝火
        //      companionModule.testPlayNoise('silent') — 停止
        testPlayNoise: (type) => {
            if (!document.getElementById('companion-page')?.classList.contains('active')) {
                console.warn('[companion] 请先 testEnter() 进入陪伴页');
                return;
            }
            startNoise(type);
        },

        // 测试：立刻触发"时间到"逻辑（不用等倒计时归零）
        // 注意：必须在陪伴中调用
        testTimeUp: () => {
            if (!document.getElementById('companion-page')?.classList.contains('active')) {
                console.warn('[companion] 请先进入陪伴中（用 testAccept 或自然流程）');
                return;
            }
            console.log('[companion] 触发时间到逻辑');
            onTimerEnd();
        },

        // 测试：强制用户先发起延长（不抛骰子）
        testExtendByUser: () => {
            if (!document.getElementById('companion-page')?.classList.contains('active')) {
                console.warn('[companion] 请先进入陪伴中');
                return;
            }
            stopTimer();
            showExtendPromptByUser();
        },

        // 测试：强制梦角先发起延长（不抛骰子）
        testExtendByPartner: () => {
            if (!document.getElementById('companion-page')?.classList.contains('active')) {
                console.warn('[companion] 请先进入陪伴中');
                return;
            }
            stopTimer();
            showExtendPromptByPartner();
        },

        // 测试：快进倒计时（让倒计时只剩 N 秒，N 秒后自然触发"时间到"）
        // 用法：companionModule.skipTo(5)  — 5 秒后倒计时归零
        skipTo: (secondsLeft = 3) => {
            if (!document.getElementById('companion-page')?.classList.contains('active')) {
                console.warn('[companion] 请先进入陪伴中');
                return;
            }
            if (!isCountdown) {
                console.warn('[companion] 正计时模式无法快进');
                return;
            }
            timerSeconds = secondsLeft;
            updateTimerDisplay();
            console.log(`[companion] 已快进，剩余 ${secondsLeft} 秒后归零`);
        },

        // 测试：让时间瞬间归零并触发 onTimerEnd（最快测试方式）
        skipToEnd: () => {
            if (!document.getElementById('companion-page')?.classList.contains('active')) {
                console.warn('[companion] 请先进入陪伴中');
                return;
            }
            if (!isCountdown) {
                console.warn('[companion] 正计时模式无法快进');
                return;
            }
            timerSeconds = 0;
            updateTimerDisplay();
            stopTimer();
            onTimerEnd();
            console.log('[companion] 已强制触发"时间到"');
        },

        // 测试：立刻触发梦角主动告别（正计时·睡觉好好休息专用）
        // 用法：先 testEnter('sleep', 'rest') 进入好好休息模式，再 testPartnerGoodnight()
        testPartnerGoodnight: () => {
            if (!document.getElementById('companion-page')?.classList.contains('active')) {
                console.warn('[companion] 请先进入陪伴中');
                return;
            }
            if (currentMode !== 'sleep' || isCountdown) {
                console.warn('[companion] 此功能只在睡觉的"好好休息"模式（正计时）下生效');
                return;
            }
            triggerPartnerGoodnight();
        },

        // 测试：让下一次 4~7 小时检查时强制告别（不用等概率）
        forceNextPartnerGoodnight: () => {
            _forcePartnerGoodnight = true;
            console.log('[companion] 下次 4~7 小时检查时将强制告别');
        },

        // 测试：直接显示一段过渡画面（任意文字）
        // 用法：companionModule.testTransition('我来了……')
        //      companionModule.testTransition() — 用默认占位文字
        testTransition: (text) => {
            showCompanionTransition(text || '过渡画面测试……');
        },

        // 测试：依次展示所有 14 个过渡场景
        // 用法：companionModule.demoAllTransitions()
        demoAllTransitions: () => {
            const list = [];
            Object.entries(TRANSITION_LINES).forEach(([key, arr]) => {
                list.push({ key, text: arr[0] });
            });
            // 也加上一句梦角原话
            list.push({ key: '拒绝原话', text: `${REJECT_LINES[0]}……` });
            console.log('[companion] 依次展示', list.length, '个过渡');
            let idx = 0;
            const next = () => {
                if (idx >= list.length) {
                    console.log('[companion] 全部过渡演示完毕');
                    return;
                }
                console.log(`  [${idx + 1}/${list.length}] 【${list[idx].key}】 ${list[idx].text}`);
                showCompanionTransition(list[idx].text, () => {
                    idx++;
                    setTimeout(next, 300);
                });
            };
            next();
        },

        // 控制随机邀请定时器
        stopRandomInvite,
        scheduleRandomInvite,
    };

})();
