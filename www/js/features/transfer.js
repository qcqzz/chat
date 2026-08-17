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

    // 梦角收到用户转账后的回复语（{amt} 会被替换为金额）
    var USER_TRANSFER_REPLIES = [
        '哇！你居然给我转了 {amt}，早知道你这么大方，我就多撒撒娇啦～',
        '收到 {amt} 啦！心里暖暖的，今晚梦里都要笑出声',
        '{amt} 已到账，我的余额里你永远排第一',
        '你最好啦，{amt} 我收下了，回头请你吃小零食',
        '{amt} 稳稳接住！不许反悔哦，我可要好好存起来'
    ];

    // 梦角主动给你转账时的开场语
    var PARTNER_TRANSFER_LINES = [
        '{amt} 悄悄转给你，记得对自己好一点',
        '给你存了点零花钱 {amt}，拿去用',
        '{amt} 到账～专属于你的快乐基金',
        '心里惦记着你呢，{amt} 就当送你个小惊喜',
        '辛苦啦，{amt} 是安慰你的大红包'
    ];

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
    function _random(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function _fill(line, amt) { return line.replace('{amt}', amt); }

    function _pushMessage(sender, text, status) {
        var push = window.addMessage || addMessage;
        if (typeof push !== 'function') return;
        push({
            id: Date.now() + Math.random(),
            sender: sender,
            text: text,
            timestamp: new Date(),
            status: status || 'sent',
            favorited: false,
            note: null,
            replyTo: null,
            type: 'normal'
        });
    }

    // ── 用户主动转账 ──────────────────────────────────────────────
    function openTransfer() {
        var modal = document.getElementById('transfer-modal');
        if (!modal) return;
        if (_amountInput) {
            _amountInput.value = '';
            _amountInput.classList.remove('correct');
        }
        _syncAmountLabel();
        _setHint('');
        _markPreset(null);
        if (typeof showModal === 'function') showModal(modal);
        setTimeout(function () { if (_amountInput) _amountInput.focus(); }, 130);
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

        // 用户转出消息 → 梦角回复
        _pushMessage('user', '我给你转了 ' + _fmt(amt) + ' 💌');
        setTimeout(function () {
            _pushMessage(_partnerName(), _fill(_random(USER_TRANSFER_REPLIES), _fmt(amt)), 'received');
        }, 1600);
    }

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
                    _pushMessage(_partnerName(), _fill(_random(PARTNER_TRANSFER_LINES), _fmt(amt)), 'received');
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
        if (_amountInput) {
            _amountInput.addEventListener('input', function () { _syncAmountLabel(); _markPreset(null); });
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

    // 暴露测试/外部调用入口
    window.TransferFeature = {
        open: openTransfer,
        manualUserTransfer: doUserTransfer,
        getData: getData
    };
})();