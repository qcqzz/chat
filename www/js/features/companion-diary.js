/* ============================================
 * 陪伴日记 (Companion Diary)
 * 数据结构：
 * {
 *   id: 时间戳,
 *   ts: 开始时间戳（用于排序、日期计算）,
 *   mode: 'study' | 'work' | 'exercise' | 'sleep',
 *   duration: 秒数,
 *   initiator: 'partner' | 'user',
 *   missed: true | undefined,   // 错过的邀请记录（超时未接）
 *   partnerNote: 字卡内容（梦角自动生成）,
 *   userNote: 用户手动写的备注
 * }
 * ============================================ */
(function() {
    'use strict';

    // ─── 全局状态 ──────────────────────────────────
    let _diaryEntries = [];          // 内存中的所有记录（按 ts 倒序）
    let _curYear = new Date().getFullYear();
    let _curMonth = new Date().getMonth() + 1;
    let _calYear = _curYear;
    let _filterMode = 'all';
    let _filterInit = 'all';
    let _editingEntryId = null;
    let _diaryBgGallery = [];   // 用户上传的日记背景列表

    // ─── 模式配置（图标、中文名） ────────────────────
    const MODE_CONFIG = {
        study:    { name: '学习', shortName: '学习', icon: 'fa-book-open',  sticker: '🌿' },
        work:     { name: '工作', shortName: '工作', icon: 'fa-briefcase',  sticker: '☕' },
        exercise: { name: '运动', shortName: '运动', icon: 'fa-running',    sticker: '☀️' },
        sleep:    { name: '睡觉', shortName: '睡觉', icon: 'fa-moon',       sticker: '🌙' }
    };

    // ─── 存储 ───────────────────────────────────────
    function getKey() {
        // 带 SESSION_ID 前缀，与同步引擎一致
        if (typeof getStorageKey === 'function' && typeof SESSION_ID !== 'undefined' && SESSION_ID) {
            try { return getStorageKey('companionDiary'); } catch (e) {}
        }
        return (window.APP_PREFIX || '') + 'companionDiary';
    }
    // 旧键名（无 SESSION_ID），用于一次性迁移
    function _getOldKey() {
        return (window.APP_PREFIX || '') + 'companionDiary';
    }
    async function loadDiary() {
        // 保险方案：不依赖 SESSION_ID 是否就绪，直接扫描 localforage 所有 key。
        // 原因：SESSION_ID 由 core.js 异步初始化，在低端 Android 设备上可能比
        // DOMContentLoaded 慢几百毫秒，导致 getKey() 返回无 SESSION_ID 的旧 key，
        // 读到空数据后 _diaryEntries 被清空，日记消失。
        // 扫描 key 的方式和 cdRec 系统一样，不依赖任何变量，100% 可靠。
        try {
            const allKeys = await localforage.keys();

            // 找出所有日记相关 key（排除背景 key）
            const diaryKeys = allKeys.filter(function(k) {
                return k.indexOf('companionDiary') !== -1
                    && k.indexOf('DiaryBg') === -1
                    && k.indexOf('DiaryBgGallery') === -1;
            });

            // 把所有 key 里的数据全部读出来，按 id 去重合并
            // 这样能兼容新 key、旧 key、以及任何中间状态
            const merged = [];
            const seenIds = new Set();
            for (var i = 0; i < diaryKeys.length; i++) {
                const chunk = await localforage.getItem(diaryKeys[i]);
                if (!Array.isArray(chunk)) continue;
                for (var j = 0; j < chunk.length; j++) {
                    const entry = chunk[j];
                    if (entry && entry.id && !seenIds.has(String(entry.id))) {
                        seenIds.add(String(entry.id));
                        merged.push(entry);
                    }
                }
            }

            _diaryEntries = merged;

            // 如果 SESSION_ID 已就绪，把合并后的数据写到正规 key，并清理旧 key
            const newKey = getKey();
            const oldKey = _getOldKey();
            if (newKey !== oldKey && merged.length > 0) {
                // 检查是否有数据在旧 key 上需要清理
                const hadOldData = diaryKeys.some(function(k) { return k === oldKey; });
                if (hadOldData) {
                    await localforage.setItem(newKey, merged);
                    await localforage.removeItem(oldKey);
                    console.log('[companion-diary] 日记数据已合并迁移到新键名，共', merged.length, '条');
                    if (window.CloudSyncEngine && window.CloudSyncEngine.requestSyncNow) {
                        setTimeout(function() { window.CloudSyncEngine.requestSyncNow(); }, 500);
                    }
                }
            }
        } catch (e) {
            console.warn('[companion-diary] load failed:', e);
            _diaryEntries = [];
        }
        // 确保按时间倒序
        _diaryEntries.sort((a, b) => b.ts - a.ts);
        window._companionDiaryEntries = _diaryEntries;
    }
    async function saveDiary() {
        try {
            // 安全保护：如果内存里是空的，先确认 localforage 里也是空的再写。
            // 防止任何时序问题导致用空数组覆盖真实数据。
            if (_diaryEntries.length === 0) {
                const allKeys = await localforage.keys();
                const diaryKeys = allKeys.filter(function(k) {
                    return k.indexOf('companionDiary') !== -1
                        && k.indexOf('DiaryBg') === -1
                        && k.indexOf('DiaryBgGallery') === -1;
                });
                for (var i = 0; i < diaryKeys.length; i++) {
                    const existing = await localforage.getItem(diaryKeys[i]);
                    if (Array.isArray(existing) && existing.length > 0) {
                        console.warn('[companion-diary] 拒绝用空数组覆盖现有日记数据，跳过保存');
                        return;
                    }
                }
            }
            await localforage.setItem(getKey(), _diaryEntries);
        } catch (e) {
            console.warn('[companion-diary] save failed:', e);
        }
    }
    // 暴露给 companion.js 调用：添加一条新记录
    window.addCompanionDiaryEntry = async function(entry) {
        if (!entry || !entry.mode) return;
        const rec = {
            id: entry.id || Date.now(),
            ts: entry.ts || Date.now(),
            mode: entry.mode,
            duration: entry.duration || 0,
            initiator: entry.initiator || 'user',
            missed: entry.missed || false,
            partnerNote: entry.partnerNote || '',
            userNote: entry.userNote || ''
        };
        // 关键修复：写入前先从 localforage 重新加载最新数据。
        // 原因：init() 调用 loadDiary() 时 SESSION_ID 可能尚未就绪（异步初始化），
        // 导致 getKey() 返回无 SESSION_ID 的旧 key，读到 null，_diaryEntries 为空。
        // 陪伴结束时（SESSION_ID 已就绪），直接 unshift 空数组再 save 会用 [新记录]
        // 覆盖掉 localforage 正确 key 里的所有历史记录。
        // 重新 loadDiary() 此时 SESSION_ID 必然已就绪，可读到正确的历史数据。
        await loadDiary();
        // 防重复写入（理论上同一条记录不应被写两次）
        if (_diaryEntries.some(function(e) { return String(e.id) === String(rec.id); })) {
            console.warn('[companion-diary] 重复 entry，跳过：', rec.id);
            return;
        }
        _diaryEntries.unshift(rec);
        await saveDiary();
        window._companionDiaryEntries = _diaryEntries;
    };

    // 供导入逻辑调用：合并写入陪伴日记（以 id 去重，不覆盖已有条目）
    window._setCompanionDiaryEntries = async function(entries) {
        if (!Array.isArray(entries) || entries.length === 0) return;
        await loadDiary(); // 确保内存是最新状态
        const existingIds = new Set(_diaryEntries.map(function(e) { return String(e.id); }));
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (!existingIds.has(String(e.id))) {
                _diaryEntries.push(e);
                existingIds.add(String(e.id));
            }
        }
        _diaryEntries.sort(function(a, b) { return b.ts - a.ts; });
        await saveDiary();
        window._companionDiaryEntries = _diaryEntries;
    };

    // ─── 字卡随机抽取（梦角的备注） ──────────────────
    // 抽 1~2 句，从启用的字卡库里随机；30% 概率返回空（梦角不记录）
    window.pickCompanionDiaryCards = function() {
        // 20% 概率不记录
        if (Math.random() < 0.2) return '';

        try {
            // 字卡库变量是模块作用域的 customReplies，全局暴露在 window._customReplies
            const replies = (typeof customReplies !== 'undefined' && Array.isArray(customReplies))
                ? customReplies
                : (window._customReplies || []);
            if (!Array.isArray(replies) || replies.length === 0) return '';

            // 过滤掉被禁用的字卡（兼容 listeners.js 的 disabledReplyItems）
            let disabledItems = new Set();
            try {
                const raw = localStorage.getItem('disabledReplyItems');
                if (raw) disabledItems = new Set(JSON.parse(raw));
            } catch (e) {}

            // 过滤掉被禁用分组里的字卡
            const disabledGroupItems = new Set();
            (window.customReplyGroups || []).forEach(g => {
                if (g.disabled && Array.isArray(g.items)) {
                    g.items.forEach(item => disabledGroupItems.add(item));
                }
            });

            const pool = replies
                .filter(r => !disabledItems.has(r) && !disabledGroupItems.has(r))
                .map(r => String(r || '').trim())
                .filter(Boolean);

            if (pool.length === 0) return '';

            // 抽 1 ~ 2 句
            const count = pool.length === 1 ? 1 : (Math.random() < 0.5 ? 1 : 2);
            const picked = [];
            const used = new Set();
            for (let i = 0; i < count && picked.length < pool.length; i++) {
                let idx;
                let tries = 0;
                do {
                    idx = Math.floor(Math.random() * pool.length);
                    tries++;
                } while (used.has(idx) && tries < 20);
                used.add(idx);
                picked.push(pool[idx]);
            }
            return picked.join('；');
        } catch (e) {
            console.warn('[companion-diary] pickCards error:', e);
            return '';
        }
    };

    // ─── 日记背景：应用到 modal 的 .cd-pages 上 ────────
    window.applyCompanionDiaryBg = async function(bgValue) {
        const pages = document.getElementById('cd-pages');
        if (!pages) return;
        if (!bgValue) {
            pages.style.backgroundImage = '';
            pages.style.backgroundColor = '';
            pages.classList.remove('cd-has-bg');
            return;
        }
        // 阶段三B：云端引用先下载
        if (typeof bgValue === 'string' && bgValue.indexOf('oss://') === 0) {
            if (!window.CloudMedia) return;
            try {
                const blobUrl = await window.CloudMedia.fetchUrl(bgValue);
                pages.style.backgroundImage = 'url(' + JSON.stringify(blobUrl) + ')';
                pages.style.backgroundSize = 'cover';
                pages.style.backgroundPosition = 'center';
                pages.style.backgroundRepeat = 'no-repeat';
                pages.classList.add('cd-has-bg');
            } catch (e) {
                console.warn('[companion-diary] 云端背景加载失败', e);
            }
            return;
        }
        if (bgValue.startsWith('linear-gradient') || bgValue.startsWith('#') || bgValue.startsWith('rgb')) {
            pages.style.backgroundImage = '';
            pages.style.backgroundColor = bgValue;
        } else {
            pages.style.backgroundImage = 'url(' + JSON.stringify(bgValue) + ')';
            pages.style.backgroundSize = 'cover';
            pages.style.backgroundPosition = 'center';
            pages.style.backgroundRepeat = 'no-repeat';
        }
        pages.classList.add('cd-has-bg');
    };

    // ─── 工具函数 ───────────────────────────────────
    function getPartnerName() {
        try {
            const s = (typeof settings !== 'undefined') ? settings : window.settings;
            if (s && s.partnerName) return s.partnerName;
        } catch (e) {}
        return '梦角';
    }
    function getUserName() {
        try {
            const s = (typeof settings !== 'undefined') ? settings : window.settings;
            if (s && s.myName) return s.myName;
        } catch (e) {}
        return '我';
    }
    function formatDuration(seconds) {
        seconds = Math.max(0, Math.floor(seconds || 0));
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h > 0 && m > 0) return h + 'h ' + (m < 10 ? '0' + m : m) + 'min';
        if (h > 0) return h + 'h';
        if (m > 0) return m + 'min';
        return '< 1min';
    }
    function formatDurationTotal(totalSeconds) {
        totalSeconds = Math.max(0, Math.floor(totalSeconds || 0));
        const totalMinutes = Math.floor(totalSeconds / 60);
        if (totalMinutes >= 60) {
            // 大于等于 1 小时 → 用十进制小时显示（保留 1 位小数，去掉末尾 .0）
            const hours = totalMinutes / 60;
            let str = hours.toFixed(1);
            if (str.endsWith('.0')) str = str.slice(0, -2);
            return str + 'h';
        }
        return totalMinutes + 'min';
    }
    function pad2(n) { return n < 10 ? '0' + n : '' + n; }
    function formatTime(ts) {
        const d = new Date(ts);
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    function getWeekdayCN(ts) {
        const wd = ['周日','周一','周二','周三','周四','周五','周六'];
        return wd[new Date(ts).getDay()];
    }

    // ─── 渲染：列表（全部月份）──────────────────────
    // 一次性渲染从最早记录到当前月之间的所有月份
    // 滚动时同步顶部月份显示；切换月份时滚动到对应位置
    let _scrollSyncBusy = false;       // 防止"切月→滚动→滚动事件再次切月"循环
    let _scrollObserver = null;

    function renderList() {
        const container = document.getElementById('cd-pages');
        if (!container) return;

        const partnerName = getPartnerName();
        const userName = getUserName();

        // 计算需要展示的月份范围（最早记录月 ~ 当前月，二者取较远者）
        const now = new Date();
        const nowY = now.getFullYear();
        const nowM = now.getMonth() + 1;

        // 找最早的记录
        let earliestY = nowY, earliestM = nowM;
        if (_diaryEntries.length > 0) {
            const minTs = _diaryEntries.reduce((min, e) => Math.min(min, e.ts), Infinity);
            const minD = new Date(minTs);
            earliestY = minD.getFullYear();
            earliestM = minD.getMonth() + 1;
        }
        // 同时也要包含用户切到的 _curYear/_curMonth 范围
        const startKey = earliestY * 100 + earliestM;
        const endKey = nowY * 100 + nowM;
        const curKey = _curYear * 100 + _curMonth;
        const realStart = Math.min(startKey, curKey);
        const realEnd = Math.max(endKey, curKey);

        // 生成月份列表（从新到旧）
        const months = [];
        let y = Math.floor(realEnd / 100), m = realEnd % 100;
        const sy = Math.floor(realStart / 100), sm = realStart % 100;
        while (y > sy || (y === sy && m >= sm)) {
            months.push({ year: y, month: m });
            m--;
            if (m < 1) { m = 12; y--; }
        }

        // 应用筛选后的所有条目
        const filteredEntries = _diaryEntries.filter(e => {
            if (_filterMode !== 'all' && e.mode !== _filterMode) return false;
            if (_filterInit === 'missed') return !!e.missed;
            if (_filterInit === 'partner' && (e.initiator !== 'partner' || !!e.missed)) return false;
            if (_filterInit === 'user' && e.initiator !== 'user') return false;
            return true;
        });

        // 按月份分组
        const byMonth = {};
        filteredEntries.forEach(e => {
            const d = new Date(e.ts);
            const key = d.getFullYear() + '-' + (d.getMonth() + 1);
            if (!byMonth[key]) byMonth[key] = [];
            byMonth[key].push(e);
        });

        // 拼接 HTML
        let html = '';
        months.forEach(mo => {
            const key = mo.year + '-' + mo.month;
            const entries = byMonth[key] || [];
            html += '<div class="cd-month-section" data-year="' + mo.year + '" data-month="' + mo.month + '">';
            html += '<div class="cd-month-label" data-year="' + mo.year + '" data-month="' + mo.month + '">· ' + mo.year + '年' + mo.month + '月 ·</div>';
            if (entries.length === 0) {
                html += '<div class="cd-empty cd-empty-month"><i class="fas fa-book-open"></i><div>这个月还没有陪伴记录</div></div>';
            } else {
                entries.forEach(e => {
                    const cfg = MODE_CONFIG[e.mode] || MODE_CONFIG.study;
                    const d = new Date(e.ts);
                    const day = d.getDate();
                    const weekday = getWeekdayCN(e.ts);
                    const time = formatTime(e.ts);
                    const dur = formatDuration(e.duration);

                    const isMissed = !!e.missed;
                    const initiatorLabel = isMissed
                        ? (partnerName + '邀请')
                        : (e.initiator === 'partner' ? (partnerName + '邀请') : (userName + '邀请'));
                    const initiatorClass = (e.initiator === 'partner' || isMissed) ? '' : 'cd-init-user';

                    const hasPartnerNote = !!e.partnerNote;
                    const partnerRowHtml = hasPartnerNote
                        ? '<div class="cd-note-row">' +
                            '<span class="cd-note-who">' + escapeHtml(partnerName) + '：</span>' +
                            '<span class="cd-note-text">' + escapeHtml(e.partnerNote) + '</span>' +
                          '</div>'
                        : '<div class="cd-note-row">' +
                            '<span class="cd-note-empty">' + escapeHtml(partnerName) + '没有记录</span>' +
                          '</div>';
                    const userNoteHtml = e.userNote
                        ? '<span class="cd-note-text">' + escapeHtml(e.userNote) + '</span>'
                        : '<span class="cd-note-empty">点击此处添加备注…</span>';

                    const missedTagHtml = isMissed
                        ? '<span class="cd-missed-tag">错过了</span>'
                        : '';
                    const missedClass = isMissed ? ' cd-entry-missed' : '';

                    html += '<div class="cd-entry' + missedClass + '" data-id="' + e.id + '">' +
                        '<div class="cd-date-col">' +
                          '<div class="cd-day">' + day + '</div>' +
                          '<div class="cd-weekday">' + weekday + '</div>' +
                        '</div>' +
                        '<div class="cd-entry-content">' +
                          '<div class="cd-top-row">' +
                            '<span class="cd-initiator ' + initiatorClass + '">' + escapeHtml(initiatorLabel) + '</span>' +
                            missedTagHtml +
                            (isMissed
                              ? '<span class="cd-mode-tag"><i class="fas ' + cfg.icon + '"></i>' + cfg.shortName + '</span>' +
                                '<span class="cd-time-dur">' + time + '</span>'
                              : '<span class="cd-mode-tag"><i class="fas ' + cfg.icon + '"></i>' + cfg.shortName + '</span>' +
                                '<span class="cd-time-dur">' + time + ' · ' + dur + '</span>'
                            ) +
                          '</div>' +
                          '<div class="cd-notes">' +
                            partnerRowHtml +
                            '<div class="cd-note-row">' +
                              '<span class="cd-note-who" style="color:var(--text-secondary)">' + escapeHtml(userName) + '：</span>' +
                              userNoteHtml +
                            '</div>' +
                          '</div>' +
                        '</div>' +
                        '<div class="cd-sticker">' + cfg.sticker + '</div>' +
                      '</div>';
                });
            }
            html += '</div>';
        });

        container.innerHTML = html;

        // 绑定每条点击事件 → 弹出备注编辑
        container.querySelectorAll('.cd-entry').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.dataset.id;
                openNoteEditor(id);
            });
        });

        // 滚动到当前选中月份
        scrollToMonth(_curYear, _curMonth);

        // 设置滚动监听 → 同步顶部月份显示
        setupScrollSync();
    }

    function scrollToMonth(year, month) {
        const container = document.getElementById('cd-pages');
        if (!container) return;
        const target = container.querySelector('.cd-month-section[data-year="' + year + '"][data-month="' + month + '"]');
        if (!target) return;
        _scrollSyncBusy = true;
        // 用 instant 不闪屏；滚动位置 = target.offsetTop（相对 container）
        const top = target.offsetTop - container.offsetTop;
        container.scrollTop = top;
        // 防抖：滚动平稳后再开启监听
        setTimeout(() => { _scrollSyncBusy = false; }, 300);
    }

    function setupScrollSync() {
        const container = document.getElementById('cd-pages');
        if (!container) return;
        // 清理旧 observer
        if (_scrollObserver) {
            try { _scrollObserver.disconnect(); } catch (e) {}
            _scrollObserver = null;
        }

        // 用 IntersectionObserver 监听月份标签，第一个进入视口顶部的就是当前月
        const labels = container.querySelectorAll('.cd-month-label');
        if (!labels.length) return;

        _scrollObserver = new IntersectionObserver((entries) => {
            if (_scrollSyncBusy) return;
            // 找到最靠近顶部的可见月份
            let topMost = null;
            let topMostY = Infinity;
            entries.forEach(entry => {
                const rect = entry.target.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const relY = rect.top - containerRect.top;
                // 只关心进入视口、且位置在容器上半部分的标签
                if (entry.isIntersecting && relY < containerRect.height * 0.5 && relY < topMostY) {
                    topMost = entry.target;
                    topMostY = relY;
                }
            });
            if (topMost) {
                const year = parseInt(topMost.dataset.year, 10);
                const month = parseInt(topMost.dataset.month, 10);
                if (year && month && (year !== _curYear || month !== _curMonth)) {
                    _curYear = year;
                    _curMonth = month;
                    updateMonthDisplay();
                }
            }
        }, {
            root: container,
            rootMargin: '0px 0px -70% 0px',  // 只关注顶部 30% 区域
            threshold: [0, 0.5, 1]
        });

        labels.forEach(label => _scrollObserver.observe(label));
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ─── 月份选择 ───────────────────────────────────
    function updateMonthDisplay() {
        const el = document.getElementById('cd-month-text');
        if (el) el.textContent = _curYear + '年' + _curMonth + '月';
    }
    function toggleCalPopup() {
        const popup = document.getElementById('cd-cal-popup');
        if (!popup) return;
        _calYear = _curYear;
        popup.classList.toggle('open');
        if (popup.classList.contains('open')) renderCalPopup();
    }
    function closeCalPopup() {
        const popup = document.getElementById('cd-cal-popup');
        if (popup) popup.classList.remove('open');
    }
    function renderCalPopup() {
        const yearLabel = document.getElementById('cd-cal-year-label');
        const grid = document.getElementById('cd-cal-months');
        if (!yearLabel || !grid) return;
        yearLabel.textContent = _calYear;
        let html = '';
        for (let m = 1; m <= 12; m++) {
            const isActive = (_calYear === _curYear && m === _curMonth);
            html += '<div class="cd-cal-m ' + (isActive ? 'active' : '') + '" data-m="' + m + '">' + m + '月</div>';
        }
        grid.innerHTML = html;
        grid.querySelectorAll('.cd-cal-m').forEach(el => {
            el.addEventListener('click', () => {
                _curYear = _calYear;
                _curMonth = parseInt(el.dataset.m, 10);
                updateMonthDisplay();
                // 如果该月份已在已渲染的列表里，直接滚动；否则重新渲染（重新计算范围）
                const container = document.getElementById('cd-pages');
                const exists = container && container.querySelector('.cd-month-section[data-year="' + _curYear + '"][data-month="' + _curMonth + '"]');
                if (exists) {
                    scrollToMonth(_curYear, _curMonth);
                } else {
                    renderList();
                }
                closeCalPopup();
            });
        });
    }

    // ─── 筛选 chip ──────────────────────────────────
    function updateChipLabel(type, val) {
        const labelMap = {
            all: { mode: '种类', init: '邀请' },
            study:    '学习',
            work:     '工作',
            exercise: '运动',
            sleep:    '睡觉',
            partner:  getPartnerName() + '邀请',
            user:     getUserName() + '邀请',
            missed:   getUserName() + '错过了'
        };
        if (type === 'mode') {
            const label = document.getElementById('cd-chip-mode-label');
            const chip = document.getElementById('cd-chip-mode');
            if (val === 'all') {
                label.textContent = labelMap.all.mode;
                chip.classList.remove('active');
            } else {
                label.textContent = labelMap[val] || val;
                chip.classList.add('active');
            }
        } else {
            const label = document.getElementById('cd-chip-init-label');
            const chip = document.getElementById('cd-chip-init');
            if (val === 'all') {
                label.textContent = labelMap.all.init;
                chip.classList.remove('active');
            } else {
                label.textContent = labelMap[val] || val;
                chip.classList.add('active');
            }
        }
    }

    // ─── 备注编辑弹窗 ─────────────────────────────────
    function openNoteEditor(entryId) {
        const id = String(entryId);
        const entry = _diaryEntries.find(e => String(e.id) === id);
        if (!entry) return;
        _editingEntryId = id;

        const cfg = MODE_CONFIG[entry.mode] || MODE_CONFIG.study;
        const d = new Date(entry.ts);
        const dateStr = (d.getMonth() + 1) + '月' + d.getDate() + '日';
        const info = entry.missed
            ? dateStr + ' · 错过了 ' + cfg.shortName + ' 邀请'
            : dateStr + ' · ' + cfg.shortName + ' · ' + formatDuration(entry.duration);
        document.getElementById('cd-note-edit-info').textContent = info;
        document.getElementById('cd-note-edit-textarea').value = entry.userNote || '';

        const modal = document.getElementById('cd-note-edit-modal');
        if (typeof showModal === 'function') showModal(modal);
        else modal.style.display = 'flex';
    }
    async function saveNoteFromEditor() {
        if (!_editingEntryId) return;
        const entry = _diaryEntries.find(e => String(e.id) === _editingEntryId);
        if (!entry) return;
        entry.userNote = (document.getElementById('cd-note-edit-textarea').value || '').trim();
        await saveDiary();
        const modal = document.getElementById('cd-note-edit-modal');
        if (typeof hideModal === 'function') hideModal(modal);
        else modal.style.display = 'none';
        _editingEntryId = null;
        renderList();
    }

    // ─── 统计视图 ───────────────────────────────────
    function openStatsView() {
        const view = document.getElementById('cd-stats-view');
        if (view) view.classList.add('open');
        renderStats();
    }
    function closeStatsView() {
        const view = document.getElementById('cd-stats-view');
        if (view) view.classList.remove('open');
    }
    function renderStats() {
        // 仅统计正常陪伴记录（非错过）
        const normalEntries = _diaryEntries.filter(e => !e.missed);
        const totalCount = normalEntries.length;
        const totalDur = normalEntries.reduce((s, e) => s + (e.duration || 0), 0);
        document.getElementById('cd-total-count').textContent = totalCount;
        document.getElementById('cd-total-duration').textContent = totalDur > 0 ? formatDurationTotal(totalDur) : '0min';

        // 邀请来源（含错过）
        let partnerCnt = 0, userCnt = 0, missedCnt = 0;
        _diaryEntries.forEach(e => {
            if (e.missed) missedCnt++;
            else if (e.initiator === 'partner') partnerCnt++;
            else userCnt++;
        });

        // 种类（仅正常记录）
        const modeCnt = { study: 0, work: 0, exercise: 0, sleep: 0 };
        normalEntries.forEach(e => {
            if (modeCnt.hasOwnProperty(e.mode)) modeCnt[e.mode]++;
        });

        // 取主题色 RGB（用于邀请来源派生颜色）
        const accentRgb = getAccentRgb();
        const initColors = [
            'rgb(' + accentRgb + ')',                       // 梦角邀请 = 主题色
            'rgba(' + accentRgb + ', 0.45)',                // 用户邀请 = 主题色浅一些
            'rgba(180,180,180,0.6)'                         // 错过了 = 灰色
        ];
        // 种类用固定的柔和马卡龙色
        const modeColors = {
            study:    '#C3EB8E',   // 学习 - 嫩绿
            work:     '#FFF891',   // 工作 - 鹅黄
            exercise: '#FFBB9B',   // 运动 - 蜜桃橙
            sleep:    '#A4D6FF'    // 睡觉 - 浅蓝
        };

        // 邀请来源图（含错过）
        const initTotal = partnerCnt + userCnt + missedCnt;
        const initData = [
            { label: getPartnerName() + '邀请', value: partnerCnt, color: initColors[0] },
            { label: getUserName() + '邀请',    value: userCnt,    color: initColors[1] },
            { label: getUserName() + '错过了',  value: missedCnt,  color: initColors[2] }
        ];
        drawPie('cd-pie-init', initData, initTotal);
        renderLegend('cd-legend-init', initData, initTotal);

        // 种类分布图
        const modeData = [
            { label: '学习', value: modeCnt.study,    color: modeColors.study },
            { label: '工作', value: modeCnt.work,     color: modeColors.work },
            { label: '运动', value: modeCnt.exercise, color: modeColors.exercise },
            { label: '睡觉', value: modeCnt.sleep,    color: modeColors.sleep }
        ];
        drawPie('cd-pie-mode', modeData, totalCount);
        renderLegend('cd-legend-mode', modeData, totalCount);
    }

    function getAccentRgb() {
        try {
            const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-color-rgb').trim();
            if (v) return v;
        } catch (e) {}
        return '197, 164, 126';
    }

    function drawPie(canvasId, segments, total) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const cx = w / 2, cy = h / 2;
        const outerR = Math.min(w, h) / 2 - 2;
        const innerR = outerR * 0.6;

        // 空数据时画灰色圈
        const sum = segments.reduce((s, x) => s + x.value, 0);
        if (sum === 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
            ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
            ctx.fillStyle = 'rgba(' + getAccentRgb() + ', 0.1)';
            ctx.fill();
            return;
        }

        let startAngle = -Math.PI / 2;
        segments.forEach(seg => {
            if (seg.value === 0) return;
            const angle = (seg.value / sum) * Math.PI * 2;
            const endAngle = startAngle + angle;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(startAngle) * outerR, cy + Math.sin(startAngle) * outerR);
            ctx.arc(cx, cy, outerR, startAngle, endAngle);
            ctx.lineTo(cx + Math.cos(endAngle) * innerR, cy + Math.sin(endAngle) * innerR);
            ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
            ctx.closePath();
            ctx.fillStyle = seg.color;
            ctx.fill();
            startAngle = endAngle;
        });
    }

    function renderLegend(containerId, segments, total) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const sum = segments.reduce((s, x) => s + x.value, 0);
        if (sum === 0) {
            container.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;">暂无数据</div>';
            return;
        }
        let html = '';
        segments.forEach(seg => {
            const pct = sum > 0 ? Math.round(seg.value / sum * 100) : 0;
            html +=
                '<div class="cd-legend-item">' +
                '<div class="cd-legend-dot" style="background:' + seg.color + '"></div>' +
                '<span>' + escapeHtml(seg.label) + '</span>' +
                '<span class="cd-legend-pct">' + pct + '%</span>' +
                '</div>';
        });
        container.innerHTML = html;
    }

    // 刷新下拉项里的动态昵称（梦角邀请 / 我邀请）
    function refreshDropdownNames() {
        const partnerName = getPartnerName();
        const userName = getUserName();
        const partnerItem = document.querySelector('.cd-dropdown-item[data-name-partner]');
        const userItem = document.querySelector('.cd-dropdown-item[data-name-me]');
        const missedItem = document.querySelector('.cd-dropdown-item[data-name-missed]');
        if (partnerItem) partnerItem.textContent = partnerName + '邀请';
        if (userItem) userItem.textContent = userName + '邀请';
        if (missedItem) missedItem.textContent = userName + '错过了';
    }

    // ─── 主入口：打开日记 modal ──────────────────────
    async function openDiaryModal() {
        await loadDiary();

        // 默认显示当前月份
        const now = new Date();
        _curYear = now.getFullYear();
        _curMonth = now.getMonth() + 1;
        _filterMode = 'all';
        _filterInit = 'all';
        updateMonthDisplay();
        refreshDropdownNames();
        updateChipLabel('mode', 'all');
        updateChipLabel('init', 'all');

        // 重置下拉项高亮
        document.querySelectorAll('.cd-dropdown-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.cd-dropdown-item[data-val="all"]').forEach(i => i.classList.add('active'));

        // 关闭所有下拉
        document.querySelectorAll('.cd-dropdown.open').forEach(d => d.classList.remove('open'));

        closeStatsView();
        renderList();

        // 应用日记背景（如果用户在外观设置里选择了）
        try {
            const bg = await localforage.getItem(diaryBgKey());
            window.applyCompanionDiaryBg(bg || '');
        } catch (e) {
            window.applyCompanionDiaryBg('');
        }

        const modal = document.getElementById('companion-diary-modal');
        if (typeof showModal === 'function') showModal(modal);
        else modal.style.display = 'flex';
    }

    // ─── 绑定事件 ───────────────────────────────────
    function bindEvents() {
        // 入口按钮
        const entryBtn = document.getElementById('companion-diary-function');
        if (entryBtn && !entryBtn.dataset.cdBound) {
            entryBtn.dataset.cdBound = 'true';
            entryBtn.addEventListener('click', () => {
                const advModal = document.getElementById('advanced-modal');
                if (advModal && typeof hideModal === 'function') hideModal(advModal);
                setTimeout(() => openDiaryModal(), 150);
            });
        }

        // 关闭按钮
        const closeBtn = document.getElementById('close-companion-diary');
        if (closeBtn && !closeBtn.dataset.cdBound) {
            closeBtn.dataset.cdBound = 'true';
            closeBtn.addEventListener('click', () => {
                const modal = document.getElementById('companion-diary-modal');
                if (typeof hideModal === 'function') hideModal(modal);
                else modal.style.display = 'none';
            });
        }

        // 月份切换器点击
        const monthDisplay = document.getElementById('cd-month-display');
        if (monthDisplay && !monthDisplay.dataset.cdBound) {
            monthDisplay.dataset.cdBound = 'true';
            monthDisplay.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleCalPopup();
            });
        }

        // 月历年份切换
        const prevYearBtn = document.getElementById('cd-cal-prev-year');
        const nextYearBtn = document.getElementById('cd-cal-next-year');
        if (prevYearBtn && !prevYearBtn.dataset.cdBound) {
            prevYearBtn.dataset.cdBound = 'true';
            prevYearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                _calYear--;
                renderCalPopup();
            });
        }
        if (nextYearBtn && !nextYearBtn.dataset.cdBound) {
            nextYearBtn.dataset.cdBound = 'true';
            nextYearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                _calYear++;
                renderCalPopup();
            });
        }

        // 筛选下拉 - 自定义实现
        document.querySelectorAll('.cd-chip').forEach(chip => {
            if (chip.dataset.cdBound) return;
            chip.dataset.cdBound = 'true';
            const dropdown = chip.querySelector('.cd-dropdown');
            if (!dropdown) return;

            // 点击 chip 切换下拉
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                // 关闭其他下拉
                document.querySelectorAll('.cd-dropdown.open').forEach(d => {
                    if (d !== dropdown) d.classList.remove('open');
                });
                dropdown.classList.toggle('open');
            });

            // 点击下拉项
            dropdown.querySelectorAll('.cd-dropdown-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const val = item.dataset.val;
                    const type = chip.id === 'cd-chip-mode' ? 'mode' : 'init';
                    if (type === 'mode') _filterMode = val;
                    else _filterInit = val;

                    // 高亮选中项
                    dropdown.querySelectorAll('.cd-dropdown-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');

                    updateChipLabel(type, val);
                    dropdown.classList.remove('open');
                    renderList();
                });
            });
        });

        // 统计按钮
        const statsBtn = document.getElementById('cd-stats-btn');
        if (statsBtn && !statsBtn.dataset.cdBound) {
            statsBtn.dataset.cdBound = 'true';
            statsBtn.addEventListener('click', openStatsView);
        }
        const statsBack = document.getElementById('cd-stats-back');
        if (statsBack && !statsBack.dataset.cdBound) {
            statsBack.dataset.cdBound = 'true';
            statsBack.addEventListener('click', closeStatsView);
        }

        // 备注编辑保存/取消
        const noteSave = document.getElementById('cd-note-edit-save');
        const noteCancel = document.getElementById('cd-note-edit-cancel');
        if (noteSave && !noteSave.dataset.cdBound) {
            noteSave.dataset.cdBound = 'true';
            noteSave.addEventListener('click', saveNoteFromEditor);
        }
        if (noteCancel && !noteCancel.dataset.cdBound) {
            noteCancel.dataset.cdBound = 'true';
            noteCancel.addEventListener('click', () => {
                const modal = document.getElementById('cd-note-edit-modal');
                if (typeof hideModal === 'function') hideModal(modal);
                else modal.style.display = 'none';
                _editingEntryId = null;
            });
        }

        // 点击空白处关闭月历和下拉菜单
        document.addEventListener('click', (e) => {
            // 关闭月历
            const popup = document.getElementById('cd-cal-popup');
            const display = document.getElementById('cd-month-display');
            if (popup && display && popup.classList.contains('open') &&
                !popup.contains(e.target) && !display.contains(e.target)) {
                closeCalPopup();
            }
            // 关闭筛选下拉
            document.querySelectorAll('.cd-dropdown.open').forEach(d => {
                const chip = d.closest('.cd-chip');
                if (chip && !chip.contains(e.target)) d.classList.remove('open');
            });
        });
    }

    // ─── 日记背景管理 ────────────────────────────────
    function diaryBgKey() {
        if (typeof getStorageKey === 'function' && typeof SESSION_ID !== 'undefined' && SESSION_ID) {
            try { return getStorageKey('companionDiaryBg'); } catch (e) {}
        }
        return (window.APP_PREFIX || '') + 'companionDiaryBg';
    }
    function diaryBgGalKey() {
        if (typeof getStorageKey === 'function' && typeof SESSION_ID !== 'undefined' && SESSION_ID) {
            try { return getStorageKey('companionDiaryBgGallery'); } catch (e) {}
        }
        return (window.APP_PREFIX || '') + 'companionDiaryBgGallery';
    }

    async function loadDiaryBgGallery() {
        try {
            const newKey = diaryBgGalKey();
            const oldKey = (window.APP_PREFIX || '') + 'companionDiaryBgGallery';
            let data = await localforage.getItem(newKey);
            // 一次性迁移旧键
            if ((!data || !Array.isArray(data) || data.length === 0) && newKey !== oldKey) {
                const oldData = await localforage.getItem(oldKey);
                if (Array.isArray(oldData) && oldData.length > 0) {
                    data = oldData;
                    await localforage.setItem(newKey, data);
                    await localforage.removeItem(oldKey);
                    console.log('[companion-diary] 日记背景图库已迁移到新键名');
                }
            }
            _diaryBgGallery = Array.isArray(data) ? data : [];
        } catch (e) {
            _diaryBgGallery = [];
        }
    }
    async function saveDiaryBgGallery() {
        try { await localforage.setItem(diaryBgGalKey(), _diaryBgGallery); } catch (e) {}
    }
    async function applyDiaryBg(value) {
        try { await localforage.setItem(diaryBgKey(), value || ''); } catch (e) {}
        // 同时清旧键（如果存在）
        try {
            const oldKey = (window.APP_PREFIX || '') + 'companionDiaryBg';
            if (oldKey !== diaryBgKey()) await localforage.removeItem(oldKey);
        } catch (e) {}
        if (typeof window.applyCompanionDiaryBg === 'function') {
            await window.applyCompanionDiaryBg(value || '');
        }
    }
    async function clearDiaryBg() {
        try { await localforage.removeItem(diaryBgKey()); } catch (e) {}
        if (typeof window.applyCompanionDiaryBg === 'function') {
            await window.applyCompanionDiaryBg('');
        }
    }

    async function renderDiaryBgGallery() {
        const list = document.getElementById('diary-bg-list');
        if (!list) return;
        await loadDiaryBgGallery();
        const currentBg = await localforage.getItem(diaryBgKey()).catch(() => null);
        list.innerHTML = '';

        // 添加按钮
        const addBtn = document.createElement('div');
        addBtn.className = 'bg-item bg-add-btn';
        addBtn.innerHTML = '<i class="fas fa-plus"></i><span></span>';
        addBtn.onclick = () => {
            const input = document.getElementById('diary-bg-input');
            if (input) input.click();
        };
        list.appendChild(addBtn);

        // 已有的背景项
        _diaryBgGallery.forEach((bg, index) => {
            const item = document.createElement('div');
            const isActive = currentBg && currentBg === bg.value;
            item.className = 'bg-item ' + (isActive ? 'active' : '');

            // 阶段三B：云端引用走懒加载 + 缩略图兜底
            const isCloud = typeof bg.value === 'string' && bg.value.indexOf('oss://') === 0;
            if (isCloud) {
                const displaySrc = bg.thumbnail || '';
                if (displaySrc) {
                    item.innerHTML = '<img src="' + displaySrc + '" loading="lazy" alt="bg">';
                } else {
                    item.innerHTML = '<img loading="lazy" alt="bg">';
                    const imgEl = item.querySelector('img');
                    if (window.CloudMedia && imgEl) {
                        window.CloudMedia.bindLazyImage(imgEl, bg.value);
                    }
                }
            } else {
                item.innerHTML = '<img src="' + bg.value + '" loading="lazy" alt="bg">';
            }

            item.onclick = (e) => {
                if (e.target.closest('.bg-delete-btn')) return;
                applyDiaryBg(bg.value);
                renderDiaryBgGallery();
                if (typeof showNotification === 'function') showNotification('日记背景已切换', 'success');
            };

            const delBtn = document.createElement('div');
            delBtn.className = 'bg-delete-btn';
            delBtn.innerHTML = '<i class="fas fa-trash"></i>';
            delBtn.title = '删除此背景';
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm('确定删除这张日记背景吗？')) {
                    // 阶段三B：如果有云端引用，先删云端对象（失败不阻塞本地删除）
                    if (window.CloudMedia && bg && bg.cloudKey) {
                        try {
                            await window.CloudMedia.delete(bg.cloudKey);
                        } catch (err) {
                            console.warn('[cloud-media] 云端删除失败', err);
                        }
                    } else if (window.CloudMedia && bg && typeof bg.value === 'string' && bg.value.indexOf('oss://') === 0) {
                        try {
                            await window.CloudMedia.delete(bg.value);
                        } catch (err) {
                            console.warn('[cloud-media] 云端删除失败', err);
                        }
                    }
                    _diaryBgGallery.splice(index, 1);
                    await saveDiaryBgGallery();
                    if (isActive) await clearDiaryBg();
                    renderDiaryBgGallery();
                }
            };
            item.appendChild(delBtn);

            list.appendChild(item);
        });
    }

    function bindDiaryBgEvents() {
        const input = document.getElementById('diary-bg-input');
        if (input && !input.dataset.cdBound) {
            input.dataset.cdBound = 'true';
            input.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                if (file.size > 10 * 1024 * 1024) {
                    if (typeof showNotification === 'function') showNotification('日记背景不能超过10MB', 'error');
                    return;
                }
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    const base64 = ev.target.result;
                    const bgId = 'user-' + Date.now();

                    // 阶段三B：如果已连云端，上传全尺寸到云端，本地只存缩略图
                    let stored = { id: bgId, type: 'image', value: base64 };
                    let valueToApply = base64;
                    if (window.CloudMedia && window.CloudSync && window.CloudSync.isConnected()) {
                        if (typeof showNotification === 'function') showNotification('正在上传到云端...', 'info', 2000);
                        try {
                            const uploadResult = await window.CloudMedia.upload(base64, 'diary-backgrounds', bgId);
                            let thumb = null;
                            try {
                                thumb = await window.CloudMedia.makeThumbnail(base64, 200);
                            } catch (thumbErr) {
                                console.warn('[cloud-media] 日记背景缩略图生成失败', thumbErr);
                            }
                            stored = {
                                id: bgId,
                                type: 'image',
                                value: uploadResult.url,
                                thumbnail: thumb,
                                cloudKey: uploadResult.key
                            };
                            valueToApply = uploadResult.url;
                        } catch (err) {
                            console.warn('[cloud-media] 日记背景上传失败，降级为本地存储', err);
                            if (typeof showNotification === 'function') showNotification('云端上传失败，暂存本地', 'error', 2500);
                            // stored 保持默认（本地 base64）
                        }
                    }

                    _diaryBgGallery.push(stored);
                    await saveDiaryBgGallery();
                    await applyDiaryBg(valueToApply);
                    renderDiaryBgGallery();
                    if (typeof showNotification === 'function') showNotification('日记背景已添加并应用', 'success');
                };
                reader.readAsDataURL(file);
                e.target.value = '';
            });
        }
        const resetBtn = document.getElementById('diary-bg-reset');
        if (resetBtn && !resetBtn.dataset.cdBound) {
            resetBtn.dataset.cdBound = 'true';
            resetBtn.addEventListener('click', async () => {
                await clearDiaryBg();
                renderDiaryBgGallery();
                if (typeof showNotification === 'function') showNotification('已恢复默认日记背景', 'success');
            });
        }
    }
    // 暴露给外部：外观设置面板打开时刷新画廊
    window.renderDiaryBgGallery = renderDiaryBgGallery;

    // ─── 初始化 ────────────────────────────────────
    function init() {
        bindEvents();
        bindDiaryBgEvents();
        // 预先加载一次数据（供 companion.js 写入时使用）
        loadDiary();
        loadDiaryBgGallery();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 暴露给外部刷新（备份导入后调用）
    window.reloadCompanionDiary = async function() {
        await loadDiary();
        const modal = document.getElementById('companion-diary-modal');
        if (modal && modal.classList.contains('active')) renderList();
    };

})();
