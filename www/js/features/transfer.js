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
        if (typeof push !== 'function') return;
        push({
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

    // 红包封面解析（与 core.js 的 _redpacketCover 保持一致的取值规则）
    function _coverFor(sender) {
        try {
            var c = sender === 'user' ? settings.redpacketMyCover : settings.redpacketPartnerCover;
            return (typeof c === 'string' && c) ? c : '';
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

    // 让"发红包"弹窗的封面预览跟随用户设置的用户封面
    function _refreshSendCoverPreview() {
        var el = document.getElementById('rp-send-cover');
        if (!el) return;
        var cover = _coverFor('user');
        if (cover) {
            el.style.backgroundImage = 'url("' + cover + '")';
            el.classList.add('has-custom');
        } else {
            el.style.backgroundImage = '';
            el.classList.remove('has-custom');
        }
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
        _pushRedpacket('user', greeting, amt);
        setTimeout(function () { _pushClaimedNotice(); }, 1600);
    }

    // 聊天页中间的系统提示：{partner}领取了{my}的红包（昵称跟随设置）
    function _pushClaimedNotice() {
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
        var cover = _coverFor(msg.sender);
        var name = msg.sender === 'user'
            ? (settings.myName || '我')
            : (settings.partnerName || msg.sender || '对方');
        var greeting = msg.text || '恭喜发财，大吉大利';

        var inner = document.getElementById('redpacket-open-inner');
        if (inner) {
            if (cover) { inner.style.backgroundImage = 'url("' + cover + '")'; }
            else { inner.style.backgroundImage = ''; }
        }
        var nameEl = document.getElementById('rp-open-name');
        if (nameEl) nameEl.textContent = (msg.sender === 'user' ? '' : '@') + name;
        var greetingEl = document.getElementById('rp-open-greeting');
        if (greetingEl) greetingEl.textContent = greeting;
        var amtEl = document.getElementById('rp-open-amount');
        if (amtEl) amtEl.textContent = _fmtMoney(msg.amount);
        var hasOpened = !!msg.opened;
        var btn = document.getElementById('rp-open-btn');
        if (btn) btn.style.display = hasOpened ? 'none' : 'block';
        var amountWrap = document.getElementById('rp-open-amount-wrap');
        if (amountWrap) amountWrap.style.display = hasOpened ? 'flex' : 'none';
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
                if (_busyWithCompanionOrCall()) return;         // 陪伴/通话中不打扰
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

    function init() {
        _modal = document.getElementById('transfer-modal');
        _amountInput = document.getElementById('transfer-amount-input');
        _amountLabel = document.getElementById('transfer-amount-label');
        _hint = document.getElementById('transfer-amount-hint');
        _presets = Array.prototype.slice.call(document.querySelectorAll('.transfer-preset'));
        var btn = document.getElementById('transfer-btn');
        var confirmBtn = document.getElementById('transfer-confirm-btn');
        var cancelBtn = document.getElementById('transfer-cancel-btn');

        if (btn) btn.addEventListener('click', openTransfer);
        if (btn) btn.addEventListener('click', _refreshSendCoverPreview);
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
        openRedpacket: openRedpacket,
        openIt: openIt,
        closeOpen: closeOpen,
        manualUserTransfer: doUserTransfer,
        getData: getData
    };
})();