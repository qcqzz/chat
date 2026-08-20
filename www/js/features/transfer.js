/* 转账 / 红包 功能模块
 * 依赖：getStorageKey / showModal / hideModal / window.addMessage / showNotification / settings
 * 包含两部分：
 *   1) 聊天框左侧红包按钮 → 打开转账弹窗，用户自定义金额转给梦角
 *   2) 梦角主动随机转账：金额随机，每自然日最多触发 LIMIT_PER_DAY 次
 */
(function () {
    'use strict';

    var LIMIT_PER_DAY = 10;                       // 梦角每自然日主动转账次数上限
    var STORE_BASE = 'transferData';              // 经 getStorageKey 按会话唯一化

    var _modal, _amountInput, _amountLabel, _hint, _presets;
    var _openMsg = null;   // 当前正在查看的红包消息

    function _storeKey() {
        try {
            if (typeof getStorageKey === 'function') return getStorageKey(STORE_BASE);
        } catch (e) { /* SESSION_ID 未就绪时回退 */ }
        return (window.APP_PREFIX || 'CHAT_APP_V3_') + '_transfer';
    }

    function _today() {
        var d = new Date();
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    function getData() {
        var d = null;
        try { d = JSON.parse(localStorage.getItem(_storeKey()) || 'null'); } catch (e) { d = null; }
        if (!d || d.day !== _today()) d = { day: _today(), partnerCount: 0 };
        return d;
    }
    function saveData(d) {
        try { localStorage.setItem(_storeKey(), JSON.stringify(d)); } catch (e) {}
    }

    function _fmt(amt) { return '¥' + Number(amt).toFixed(2); }
    function _partnerName() {
        try { return (settings && settings.partnerName) ? settings.partnerName : '对方'; }
        catch (e) { return '对方'; }
    }

    // 推送一条微信风格的红包消息（type:'redpacket'），金额等作为附加字段
    function _pushRedpacket(sender, greeting, amount) {
        var push = window.addMessage || addMessage;
        if (typeof push !== 'function') return null;
        return push({
            id: Date.now() + Math.random(),
            sender: sender,
            text: greeting || '恭喜发财，大吉大利',
            amount: amount,
            opened: false,
            openedAt: null,
            timestamp: new Date(),
            status: sender === 'user' ? 'sent' : 'received',
            favorited: false,
            note: null,
            replyTo: null,
            type: 'redpacket'
        });
    }

    // 红包封面解析：按「场景(card/open) × 发送方」取对应封面；兼容旧字段
    function _coverFor(sender, scope) {
        try {
            var isUser = sender === 'user';
            var key = (scope === 'open' ? 'redpacketOpen' : 'redpacketCard')
                + (isUser ? 'MyCover' : 'PartnerCover');
            if (typeof settings === 'object' && settings && settings[key]) return settings[key];
            var old = isUser ? settings.redpacketMyCover : settings.redpacketPartnerCover;
            return (typeof old === 'string' && old) ? old : '';
        } catch (e) { return ''; }
    }
    function _fmtMoney(n) { return '¥' + Number(n || 0).toFixed(2); }
    function _findMsgById(id) {
        try {
            var arr = messages || window.messages || [];
            for (var i = arr.length - 1; i >= 0; i--) {
                if (String(arr[i].id) === String(id)) return arr[i];
            }
        } catch (e) {}
        return null;
    }

    // ── 用户主动转账 ──────────────────────────────────────────────
    function openTransfer() {
        var modal = document.getElementById('transfer-modal');
        if (!modal) return;
        if (_amountInput) {
            _amountInput.value = '';
            _amountInput.classList.remove('correct');
        }
        if (typeof showModal === 'function') showModal(modal);
        setTimeout(function () {
            if (_amountInput) _amountInput.focus();
        }, 130);
    }

    function _parseAmount() {
        var v = parseFloat(_amountInput.value);
        if (!isFinite(v) || v <= 0) return null;
        return Math.round(v * 100) / 100;
    }

    function _syncAmountLabel() {
        if (!_amountLabel) return;
        var amt = _parseAmount();
        _amountLabel.textContent = amt != null ? _fmt(amt) : '¥0.00';
    }

    function _setHint(msg, isErr) {
        if (!_hint) return;
        _hint.textContent = msg || '';
        _hint.style.color = isErr ? '#ff5f6d' : 'var(--text-secondary)';
    }

    function _markPreset(el) {
        if (!_presets) return;
        _presets.forEach(function (b) { b.classList.remove('active'); });
        if (el) el.classList.add('active');
    }

    function doUserTransfer() {
        var amt = _parseAmount();
        if (amt == null) { _setHint('请输入大于 0 的金额', true); return; }

        var modal = document.getElementById('transfer-modal');
        if (modal && typeof hideModal === 'function') hideModal(modal);

        var greetingEl = document.getElementById('rp-send-greeting');
        var greeting = (greetingEl && greetingEl.value.trim()) || '恭喜发财，大吉大利';

        // 用户发出红包消息 → 对方领取：在聊天页中间显示系统提示（不回复消息）
        var rp = _pushRedpacket('user', greeting, amt);
        // 锁定刚发出的这条红包，让「已读→已领取」只作用在这条上，避免连发时互相错标
        var rpId = (rp && rp.id != null) ? rp.id : null;
        // 阶段1：红包消息先显示「已读」（对方读到了消息，卡片仍显示「待领取」）
        setTimeout(function () { _markRpRead(rpId); }, 1600);
        // 阶段2：80% 概率领取 / 20% 不领取；领取时间随机 2s~30s（对方拆开红包）+ 中间系统提示
        if (Math.random() < 0.8) {
            var claimDelay = 2000 + Math.random() * 28000; // 2~30 秒
            setTimeout(function () { _pushClaimedNotice(rpId); }, claimDelay);
        }
    }

    // 阶段1：把指定（或最近一条「我发出的、未读」）红包消息标记为已读
    function _markRpRead(id) {
        try {
            var arr = (typeof messages !== 'undefined' && messages) ? messages : (window.messages || []);
            // 优先精确锁定命中的 id；id 为空时回退为"最近一条未读的我发红包"
            for (var i = arr.length - 1; i >= 0; i--) {
                var m = arr[i];
                if (m && m.type === 'redpacket' && m.sender === 'user') {
                    if (id != null) {
                        if (String(m.id) === String(id)) { m.status = 'read'; break; }
                    } else if (m.status !== 'read') {
                        m.status = 'read'; break;
                    }
                }
            }
            try { if (typeof throttledSaveData === 'function') throttledSaveData(); } catch (e) {}
            try { if (typeof renderMessages === 'function') renderMessages(); } catch (e) {}
            try { if (typeof _updateReadReceiptsDOM === 'function') _updateReadReceiptsDOM(); } catch (e) {}
        } catch (e) {}
    }

    // 聊天页中间的系统提示：{partner}领取了{my}的红包（昵称跟随设置）
    function _pushClaimedNotice(id) {
        // 先把指定（或最近一条「我发出的、未领取」）红包标记为已领取，卡片状态随之切换
        try {
            var arr = (typeof messages !== 'undefined' && messages) ? messages : (window.messages || []);
            for (var i = arr.length - 1; i >= 0; i--) {
                var m = arr[i];
                if (m && m.type === 'redpacket' && m.sender === 'user') {
                    if (id != null) {
                        if (String(m.id) === String(id)) { m.opened = true; m.openedAt = Date.now(); break; }
                    } else if (!m.opened) {
                        m.opened = true; m.openedAt = Date.now(); break;
                    }
                }
            }
            try { if (typeof throttledSaveData === 'function') throttledSaveData(); } catch (e) {}
            try { if (typeof renderMessages === 'function') renderMessages(); } catch (e) {}
            // 红包记录弹窗若已打开（或之后打开），同步刷新当前视角列表，保证卡片与记录状态一致
            try { _renderRpRecordList(_rpRecordView); } catch (e) {}
        } catch (e) {}
        var push = window.addMessage || addMessage;
        if (typeof push !== 'function') return;
        var partner = _partnerName();
        var my = '我';
        try { if (settings && settings.myName) my = settings.myName; } catch (e) {}
        push({
            id: Date.now() + Math.random(),
            sender: 'system',
            text: partner + '领取了' + my + '的红包',
            timestamp: new Date(),
            type: 'system'
        });
    }

    // ── 红包小窗：点击聊天里的红包消息后打开 ─────────────────────
    function openRedpacket(id) {
        var msg = _findMsgById(id);
        if (!msg) { if (typeof showNotification === 'function') showNotification('红包消息不存在', 'warning'); return; }
        // 自己发出的红包不能拆开（与微信一致，仅作为对方领取提示）
        if (msg.sender === 'user') {
            if (typeof showNotification === 'function') showNotification('这是你发出的红包，不能拆开', 'info');
            return;
        }
        _openMsg = msg;
        var modal = document.getElementById('redpacket-open-modal');
        if (!modal) return;
        _populateOpenModal();
        if (typeof showModal === 'function') showModal(modal);
    }
    window.redpacketOpenRedpacket = openRedpacket;

    // 根据当前红包消息刷新小窗内容
    function _populateOpenModal() {
        var msg = _openMsg;
        if (!msg) return;
        var name = msg.sender === 'user'
            ? (settings.myName || '我')
            : (settings.partnerName || '对方');
        var greeting = msg.text || '恭喜发财，大吉大利';
        var hasOpened = !!msg.opened;

        var nameEl = document.getElementById('rp-open-name');
        if (nameEl) nameEl.textContent = name + '发来的红包';
        var greetingEl = document.getElementById('rp-open-greeting');
        if (greetingEl) greetingEl.textContent = greeting;
        var amtEl = document.getElementById('rp-open-amount');
        if (amtEl) amtEl.textContent = _fmtMoney(msg.amount);

        // 浅米灰主区支持自定义封面：按发送方取封面，叠加浅色遮罩保证文字可读；无封面用内置渐变
        var body = document.getElementById('redpacket-open-body');
        if (body) {
            var cover = _coverFor(msg.sender, 'open');
            if (cover) {
                body.style.backgroundImage = 'linear-gradient(rgba(255,249,245,0.86),rgba(255,249,245,0.86)),url("' + cover + '")';
                body.classList.add('redpacket-open-body-cover');
            } else {
                body.style.backgroundImage = '';
                body.classList.remove('redpacket-open-body-cover');
            }
        }

        // 已领取/未领取 圆形按钮：跟随系统强调色，白字
        var btn = document.getElementById('rp-open-btn');
        if (btn) btn.textContent = hasOpened ? '已领取' : '开';
    }

    // 点击"开"按钮 → 拆开红包，显示金额
    function openIt() {
        var msg = _openMsg;
        if (!msg) return;
        if (!msg.opened) {
            msg.opened = true;
            msg.openedAt = Date.now();
            try { if (typeof throttledSaveData === 'function') throttledSaveData(); } catch (e) {}
            try { if (typeof renderMessages === 'function') renderMessages(); } catch (e) {}
        }
        _populateOpenModal();
    }
    window.redpacketOpenIt = openIt;
    function closeOpen() {
        var modal = document.getElementById('redpacket-open-modal');
        if (modal && typeof hideModal === 'function') hideModal(modal);
        _openMsg = null;
    }
    window.redpacketCloseOpen = closeOpen;

    // ── 梦角主动随机转账（每自然日 ≤ LIMIT_PER_DAY）──────────────
    function _busyWithCompanionOrCall() {
        var comp = document.getElementById('companion-page');
        var overlay = document.getElementById('call-incoming-overlay');
        var win = document.getElementById('call-window');
        var pill = document.getElementById('call-mini-pill');
        return !!(
            (comp && comp.classList.contains('active')) ||
            (overlay && overlay.classList.contains('visible')) ||
            (win && win.classList.contains('visible')) ||
            (pill && pill.classList.contains('visible'))
        );
    }

    function _randomAmount() {
        var x = Math.random(), amt;
        if (x < 0.40) {
            amt = 0.5 + Math.random() * 9.5;                    // 0.50~9.99
        } else if (x < 0.75) {
            amt = 5 + Math.random() * 995;                      // 5~1000
        } else if (x < 0.91) {
            amt = 50 + Math.random() * 1950;                    // 50~2000
        } else {
            amt = 2000 + Math.random() * 18000;                 // 2000~20000
        }
        return Math.round(amt * 100) / 100;
    }

    function _schedulePartnerTransfer() {
        setTimeout(function check() {
            _schedulePartnerTransfer();
            try {
                if (settings && settings.partnerRedpacketEnabled === false) return; // 关闭了梦角主动发红包
                if (_busyWithCompanionOrCall()) return;         // 陪伴/通话中不打扰
                if (Math.random() > 0.08) return;               // 触发概率 8%
                var d = getData();
                if (d.partnerCount >= LIMIT_PER_DAY) return;    // 每日已满
                d.partnerCount++;
                saveData(d);

                var amt = _randomAmount();
                setTimeout(function () {
                    // 梦角发微信风格红包消息（金额规则沿用设定，封面用梦角封面）
                    _pushRedpacket(_partnerName(), '恭喜发财，大吉大利', amt);
                    if (typeof showNotification === 'function') {
                        try { showNotification('梦角给你转账了 ' + _fmt(amt), 'info', 4000); } catch (e) {}
                    }
                }, 900);
            } catch (e) {}
            // 每 20~60 分钟检查一次（频率低且每日封顶，避免打扰）
        }, (20 + Math.random() * 40) * 60 * 1000);
    }

    // ── 发红包入口选择 + 红包记录 ──────────────────────────────
    function _rpEl(id) { return document.getElementById(id); }

    // 点左下角发红包按钮：先弹出「发红包 / 红包记录」选择弹窗
    function openRpChoice() {
        var modal = _rpEl('rp-choice-modal');
        if (modal && typeof showModal === 'function') showModal(modal);
    }
    function closeChoice() {
        var modal = _rpEl('rp-choice-modal');
        if (modal && typeof hideModal === 'function') hideModal(modal);
    }
    // 选择「发红包」→ 关闭选择弹窗，打开金额输入弹窗
    function openSendModal() {
        var ch = _rpEl('rp-choice-modal');
        if (ch && typeof hideModal === 'function') hideModal(ch);
        openTransfer();
    }
    // 红包记录弹窗上方「梦角 / 我」按钮文字跟随用户设置的昵称
    function _syncRecordTabNames() {
        var partnerBtn = _rpEl('rp-record-tab-partner');
        var meBtn = _rpEl('rp-record-tab-me');
        if (!partnerBtn || !meBtn) return;
        var partnerName = _partnerName();
        var myName = '我';
        try { if (settings && settings.myName) myName = settings.myName; } catch (e) {}
        partnerBtn.innerHTML = '<i class="fas fa-heart"></i> ' + _escapeHtml(partnerName);
        meBtn.innerHTML = '<i class="fas fa-user"></i> ' + _escapeHtml(myName);
    }
    // 选择「红包记录」→ 关闭选择弹窗，打开红包记录弹窗
    function openRpRecord() {
        var ch = _rpEl('rp-choice-modal');
        if (ch && typeof hideModal === 'function') hideModal(ch);
        var modal = _rpEl('rp-record-modal');
        if (!modal) return;
        _syncRecordTabNames();
        switchRpRecordView('partner');
        if (typeof showModal === 'function') showModal(modal);
    }
    function closeRpRecord() {
        var modal = _rpEl('rp-record-modal');
        if (modal && typeof hideModal === 'function') hideModal(modal);
    }

    // 按视角收集红包消息：me=我发出的 / partner=梦角发来的（新在前）
    function _rpCollect(who) {
        var arr = (typeof messages !== 'undefined' && messages) ? messages : (window.messages || []);
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var m = arr[i];
            if (!m || m.type !== 'redpacket') continue;
            var isUser = m.sender === 'user';
            if (who === 'me' && !isUser) continue;
            if (who === 'partner' && isUser) continue;
            out.push(m);
        }
        return out;
    }
    function _rpDate(ts) {
        var d = new Date(ts);
        return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
               d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    function _renderRpRecordList(who) {
        var list = _rpEl('rp-record-list');
        if (!list) return;
        var partnerBtn = _rpEl('rp-record-tab-partner');
        var meBtn = _rpEl('rp-record-tab-me');
        if (partnerBtn && meBtn) {
            partnerBtn.classList.toggle('active', who === 'partner');
            meBtn.classList.toggle('active', who === 'me');
        }
        var recs = _rpCollect(who);
        if (!recs.length) {
            list.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:13px;padding:32px 10px;">暂无红包记录</div>';
            return;
        }
        recs = recs.slice().sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
        var partnerName = _partnerName();
        var myName = '我';
        try { if (settings && settings.myName) myName = settings.myName; } catch (e) {}
        list.innerHTML = recs.map(function (m) {
            var amt = _fmt(m.amount);
            var greeting = (m.text || '恭喜发财，大吉大利');
            var senderName = (m.sender === 'user') ? myName : partnerName;
            var icon = m.sender === 'user' ? 'fa-paper-plane' : 'fa-gift';
            var st = m.opened
                ? '<span class="rp-rec-status done">已领取</span>'
                : '<span class="rp-rec-status wait">待领取</span>';
            return '<div class="rp-rec-item">'
                + '<div class="rp-rec-ico"><i class="fas ' + icon + '"></i></div>'
                + '<div class="rp-rec-mid">'
                +   '<div class="rp-rec-title">' + _escapeHtml(senderName) + '的红包</div>'
                +   '<div class="rp-rec-sub">' + _escapeHtml(greeting) + ' · ' + _escapeHtml(_rpDate(m.timestamp)) + '</div>'
                + '</div>'
                + '<div class="rp-rec-side"><div class="rp-rec-amt">' + _escapeHtml(amt) + '</div>' + st + '</div>'
                + '</div>';
        }).join('');
    }
    // 切换「梦角 / 我」视角（HTML onclick 调用）
    var _rpRecordView = 'partner'; // 红包记录当前视角，供状态变化时同步刷新
    function switchRpRecordView(who) {
        _rpRecordView = who;
        _renderRpRecordList(who);
    }
    window.switchRpRecord = switchRpRecordView;

    function init() {
        _modal = document.getElementById('transfer-modal');
        _amountInput = document.getElementById('transfer-amount-input');
        _amountLabel = document.getElementById('transfer-amount-label');
        _hint = document.getElementById('transfer-amount-hint');
        _presets = Array.prototype.slice.call(document.querySelectorAll('.transfer-preset'));
        var btn = document.getElementById('transfer-btn');
        var confirmBtn = document.getElementById('transfer-confirm-btn');
        var cancelBtn = document.getElementById('transfer-cancel-btn');

        // 发红包按钮 → 先弹选择弹窗
        if (btn) btn.addEventListener('click', openRpChoice);
        var choiceSend = _rpEl('rp-choice-send');
        var choiceRecord = _rpEl('rp-choice-record');
        var closeChoiceBtn = _rpEl('close-rp-choice');
        var closeRecordBtn = _rpEl('close-rp-record');
        if (choiceSend) choiceSend.addEventListener('click', openSendModal);
        if (choiceRecord) choiceRecord.addEventListener('click', openRpRecord);
        if (closeChoiceBtn) closeChoiceBtn.addEventListener('click', closeChoice);
        if (closeRecordBtn) closeRecordBtn.addEventListener('click', closeRpRecord);
        if (_amountInput) {
            _amountInput.addEventListener('input', function () { _syncAmountLabel(); _markPreset(null); });
        }
        var greetingEl = document.getElementById('rp-send-greeting');
        if (greetingEl) {
            greetingEl.addEventListener('input', function () { _setHint(''); });
            greetingEl.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); if (typeof doUserTransfer === 'function') doUserTransfer(); }
            });
        }
        _presets.forEach(function (b) {
            b.addEventListener('click', function () {
                if (!_amountInput) return;
                _amountInput.value = b.getAttribute('data-amt');
                _markPreset(b);
                _syncAmountLabel();
            });
        });
        if (confirmBtn) confirmBtn.addEventListener('click', doUserTransfer);
        if (cancelBtn && _modal) cancelBtn.addEventListener('click', function () {
            if (typeof hideModal === 'function') hideModal(_modal);
        });

        // 启动后约 20~50 秒开始第一轮检查
        setTimeout(function () { _schedulePartnerTransfer(); }, (20 + Math.random() * 30) * 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 暴露测试/外部调用入口（含红包小窗）
    window.TransferFeature = {
        open: openTransfer,
        openRpChoice: openRpChoice,
        closeChoice: closeChoice,
        openRecord: openRpRecord,
        closeRecord: closeRpRecord,
        switchRecord: switchRpRecordView,
        openRedpacket: openRedpacket,
        openIt: openIt,
        closeOpen: closeOpen,
        manualUserTransfer: doUserTransfer,
        getData: getData
    };
})();