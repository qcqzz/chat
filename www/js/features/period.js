/**
 * period.js — 经期记录功能 Step 2
 * 数据持久化 + 日历渲染 + 统计计算 + 标记逻辑
 */
(function () {
    'use strict';

    // ── 常量 ──────────────────────────────────────────
    var DEFAULT_SYMPTOMS = ['痛经', '腰酸', '头痛', '疲惫', '胸胀', '恶心'];
    var FLOW_LABELS      = ['', '极少', '少', '正常', '多', '极多'];
    var WEEKDAYS         = ['日', '一', '二', '三', '四', '五', '六'];

    // ── 内存状态 ──────────────────────────────────────
    // _data 结构：
    // {
    //   periods: [ { id, startDate, endDate|null } ],
    //   dailyRecords: { 'YYYY-MM-DD': { flow:0-5, symptoms:[] } },
    //   customSymptoms: [],
    //   partnerMsg: { periodId, lines:[] } | null,
    //   notifyAt: timestamp | null,
    //   notifyPeriodId: string | null
    // }
    var _data   = { periods: [], dailyRecords: {}, customSymptoms: [], partnerMsg: null, notifyAt: null, notifyPeriodId: null };
    var _loaded = false;
    var _viewYear, _viewMonth;   // 0-based month
    var _currentFlow     = 0;
    var _currentSymptoms = [];
    var _longPressTimer  = null;
    var _storageKey      = null;

    // ── Storage ───────────────────────────────────────
    async function _getKey() {
        if (_storageKey) return _storageKey;
        try {
            var allKeys = await localforage.keys();
            var found = allKeys.find(function (k) { return k.indexOf('_periodData') !== -1; });
            if (found) { _storageKey = found; return found; }
            // 推导 session prefix
            var msgKey = allKeys.find(function (k) { return k.indexOf('_messages') !== -1; });
            var prefix = msgKey ? msgKey.replace('_messages', '') : 'CHAT_APP_V3_';
            _storageKey = prefix + '_periodData';
        } catch (e) {
            _storageKey = 'CHAT_APP_V3__periodData';
        }
        return _storageKey;
    }

    async function _load() {
        try {
            var key = await _getKey();
            var saved = await localforage.getItem(key);
            if (saved && saved.periods) {
                _data = saved;
                if (!_data.dailyRecords)   _data.dailyRecords   = {};
                if (!_data.customSymptoms) _data.customSymptoms = [];
            }
        } catch (e) { console.warn('[period] load failed:', e); }
        _loaded = true;
    }

    async function _save() {
        try {
            var key = await _getKey();
            await localforage.setItem(key, _data);
        } catch (e) { console.warn('[period] save failed:', e); }
    }

    // ── 日期工具 ──────────────────────────────────────
    function _pad(n) { return String(n).padStart(2, '0'); }
    function _toStr(d) { return d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate()); }
    function _today()  { return _toStr(new Date()); }
    function _parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
    function _diff(a, b) { return Math.round((_parse(b) - _parse(a)) / 86400000); }
    function _addD(s, n) { var d = _parse(s); d.setDate(d.getDate() + n); return _toStr(d); }

    // ── Period 查询 ───────────────────────────────────
    function _getPeriodOf(dateStr) {
        return _data.periods.find(function (p) {
            if (dateStr < p.startDate) return false;
            if (p.endDate)  return dateStr <= p.endDate;
            return dateStr <= _today();
        }) || null;
    }
    function _isInPeriod(dateStr) { return !!_getPeriodOf(dateStr); }
    function _getDayNum(dateStr) {
        var p = _getPeriodOf(dateStr);
        return p ? _diff(p.startDate, dateStr) + 1 : 0;
    }
    function _activePeriod() {
        return _data.periods.find(function (p) { return !p.endDate; }) || null;
    }

    // ── 统计 ──────────────────────────────────────────
    function _calcStats() {
        var completed = _data.periods.filter(function (p) { return p.endDate; });

        // 平均经期天数
        var avgDays = '--';
        if (completed.length > 0) {
            var total = completed.reduce(function (s, p) { return s + _diff(p.startDate, p.endDate) + 1; }, 0);
            avgDays = Math.round(total / completed.length) + '天';
        }

        // 预测下次
        var nextDate = '暂无预测';
        var sorted = _data.periods.slice().sort(function (a, b) { return a.startDate < b.startDate ? -1 : 1; });
        if (sorted.length >= 2) {
            var gaps = [];
            for (var i = 1; i < sorted.length; i++) {
                gaps.push(_diff(sorted[i - 1].startDate, sorted[i].startDate));
            }
            var avgCycle = Math.round(gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length);
            var lastStart = sorted[sorted.length - 1].startDate;
            var predStart = _addD(lastStart, avgCycle);

            if (gaps.length >= 2 && (Math.max.apply(null, gaps) - Math.min.apply(null, gaps)) > 7) {
                var minD = _parse(_addD(lastStart, Math.min.apply(null, gaps)));
                var maxD = _parse(_addD(lastStart, Math.max.apply(null, gaps)));
                nextDate = (minD.getMonth()+1) + '月' + minD.getDate() + '日 ~ ' +
                           (maxD.getMonth()+1) + '月' + maxD.getDate() + '日';
            } else {
                var pd = _parse(predStart);
                nextDate = pd.getFullYear() + '年' + (pd.getMonth()+1) + '月' + pd.getDate() + '日';
            }
        }

        return { avgDays: avgDays, nextDate: nextDate };
    }

    function _predictedDates() {
        var sorted = _data.periods.slice().sort(function (a, b) { return a.startDate < b.startDate ? -1 : 1; });
        if (sorted.length < 2) return [];

        var gaps = [];
        for (var i = 1; i < sorted.length; i++) {
            gaps.push(_diff(sorted[i - 1].startDate, sorted[i].startDate));
        }
        var avgCycle = Math.round(gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length);

        var completed = sorted.filter(function (p) { return p.endDate; });
        var avgDur = completed.length > 0
            ? Math.round(completed.reduce(function (s, p) { return s + _diff(p.startDate, p.endDate) + 1; }, 0) / completed.length)
            : 5;

        var predStart = _addD(sorted[sorted.length - 1].startDate, avgCycle);
        var dates = [];
        for (var d = 0; d < avgDur; d++) dates.push(_addD(predStart, d));
        return dates;
    }

    // ── 经期操作 ──────────────────────────────────────
    function _startPeriod(dateStr, sendNotif) {
        if (_isInPeriod(dateStr)) return;
        var active = _activePeriod();
        if (active) active.endDate = _addD(dateStr, -1);  // 自动结束上次
        _data.periods.push({ id: 'pd_' + Date.now(), startDate: dateStr, endDate: null });
        _save();
        if (sendNotif) _scheduleNotif();
    }

    function _endPeriod(dateStr) {
        var active = _activePeriod();
        if (!active || dateStr < active.startDate) return;
        active.endDate = dateStr;
        _save();
    }

    function _toggleHistory(dateStr) {
        var p = _getPeriodOf(dateStr);
        if (p) {
            if (p.startDate === dateStr) {
                _data.periods = _data.periods.filter(function (x) { return x.id !== p.id; });
            } else {
                p.endDate = _addD(dateStr, -1);
            }
        } else {
            _data.periods.push({ id: 'pd_' + Date.now(), startDate: dateStr, endDate: dateStr });
        }
        _save();
    }

    // ── 通知（梦角留言） ──────────────────────────────
    function _scheduleNotif() {
        var active = _activePeriod();
        if (!active) return;
        if (_data.notifyPeriodId === active.id) return;  // 已安排
        _data.notifyAt       = Date.now() + (20 + Math.floor(Math.random() * 11)) * 60000;
        _data.notifyPeriodId = active.id;
        _save();
    }

    function _checkNotif() {
        if (!_data.notifyAt || !_data.notifyPeriodId) return;
        if (Date.now() < _data.notifyAt) return;
        if (_data.partnerMsg && _data.partnerMsg.periodId === _data.notifyPeriodId) return;

        var replies = (window._customReplies) ||
                      (typeof customReplies !== 'undefined' ? customReplies : []) || [];
        if (!replies.length) return;

        var shuffled = replies.slice().sort(function () { return Math.random() - 0.5; });
        var lines    = shuffled.slice(0, 2 + Math.floor(Math.random() * 2));

        _data.partnerMsg = { periodId: _data.notifyPeriodId, lines: lines };
        _data.notifyAt   = null;
        _save();

        _showPdNotif(lines);
        _renderLetterCard();
    }

    function _showPdNotif(lines) {
        var existing = document.getElementById('pd-notif-popup');
        if (existing) existing.remove();

        var pname = _partnerName();
        var popup = document.createElement('div');
        popup.id = 'pd-notif-popup';
        popup.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
            'background:var(--secondary-bg);border:1px solid var(--border-color);' +
            'border-radius:20px;padding:18px 20px;z-index:9000;max-width:320px;width:88%;' +
            'box-shadow:0 8px 32px rgba(0,0,0,0.18);display:flex;flex-direction:column;gap:12px;' +
            'animation:_mSlideUp 0.4s cubic-bezier(0.22,1,0.36,1);';
        popup.innerHTML =
            '<div style="display:flex;align-items:center;gap:10px;">' +
                '<span style="font-size:26px;">🌸</span>' +
                '<div>' +
                    '<div style="font-size:14px;font-weight:700;color:var(--text-primary);">' + pname + ' 有话想说</div>' +
                    '<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;opacity:0.8;">去经期记录里看看</div>' +
                '</div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;">' +
                '<button onclick="document.getElementById(\'pd-notif-popup\').remove();" ' +
                    'style="flex:1;padding:8px 0;border-radius:12px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);font-size:13px;cursor:pointer;font-family:inherit;">稍后</button>' +
                '<button onclick="window._pdGoToPeriodTab();document.getElementById(\'pd-notif-popup\').remove();" ' +
                    'style="flex:2;padding:8px 0;border-radius:12px;border:none;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">立即查看 ✦</button>' +
            '</div>';
        document.body.appendChild(popup);
        setTimeout(function () { if (popup.parentNode) popup.remove(); }, 8000);
    }

    window._pdGoToPeriodTab = function () {
        if (typeof window.csSwitchTab === 'function') {
            if (typeof window.openCoupleSpace === 'function') window.openCoupleSpace();
            window.csSwitchTab('period');
        }
    };

    // ── UI 渲染 ───────────────────────────────────────
    function _updateStats() {
        var s = _calcStats();
        var nEl = document.getElementById('pd-next-date');
        var aEl = document.getElementById('pd-avg-days');
        if (nEl) nEl.textContent = s.nextDate;
        if (aEl) aEl.textContent = s.avgDays;
    }

    function _updateToggleBtn() {
        var track = document.getElementById('pd-toggle-btn');   // pd-toggle-track
        var label = document.getElementById('pd-toggle-label');
        if (!track || !label) return;
        var inP = _isInPeriod(_today());
        track.classList.toggle('pd-toggle-on', inP);
        label.textContent = inP ? '经期中' : '标记经期';
    }

    function _updateStatusCard() {
        var today  = _today();
        var dayTag = document.getElementById('pd-status-day-tag');
        var dateEl = document.getElementById('pd-status-date');
        var now    = new Date();
        if (dateEl) dateEl.textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日';

        if (dayTag) {
            var dayNum = _getDayNum(today);
            if (dayNum > 0) {
                dayTag.textContent  = '经期第' + dayNum + '天';
                dayTag.style.display = '';
            } else {
                dayTag.style.display = 'none';
            }
        }

        // 载入今天已有的记录
        var rec      = _data.dailyRecords[today];
        _currentFlow     = rec ? (rec.flow || 0) : 0;
        _currentSymptoms = rec ? (rec.symptoms ? rec.symptoms.slice() : []) : [];

        document.querySelectorAll('.pd-flow-btn').forEach(function (btn) {
            btn.classList.toggle('pd-flow-active', Number(btn.dataset.val) === _currentFlow);
        });

        _updateSaveBtn(!!rec);
        _renderSymptoms();
    }

    function _updateSaveBtn(saved) {
        var btn  = document.getElementById('pd-save-btn');
        var hint = document.getElementById('pd-saved-hint');
        if (!btn) return;
        if (saved) {
            btn.textContent  = '已保存';
            btn.disabled     = true;
            btn.style.opacity = '0.5';
            if (hint) hint.textContent = '';
        } else {
            btn.textContent  = '保存记录';
            btn.disabled     = false;
            btn.style.opacity = '';
        }
    }

    // ── 日历 ──────────────────────────────────────────
    function _renderCalendar() {
        var label = document.getElementById('pd-month-label');
        if (label) label.textContent = _viewYear + '年' + (_viewMonth + 1) + '月';

        var grid = document.getElementById('pd-cal-grid');
        if (!grid) return;

        var firstDay    = new Date(_viewYear, _viewMonth, 1).getDay();
        var daysInMonth = new Date(_viewYear, _viewMonth + 1, 0).getDate();
        var today       = _today();
        var predicted   = _predictedDates();

        var html = '';
        var prevTotal = new Date(_viewYear, _viewMonth, 0).getDate();
        for (var i = firstDay - 1; i >= 0; i--) {
            var ds = _toStr(new Date(_viewYear, _viewMonth - 1, prevTotal - i));
            html += _cellHtml(prevTotal - i, ds, today, predicted, true);
        }
        for (var d = 1; d <= daysInMonth; d++) {
            var ds2 = _toStr(new Date(_viewYear, _viewMonth, d));
            html += _cellHtml(d, ds2, today, predicted, false);
        }
        var total = firstDay + daysInMonth;
        var nextDays = total % 7 === 0 ? 0 : 7 - (total % 7);
        for (var n = 1; n <= nextDays; n++) {
            var ds3 = _toStr(new Date(_viewYear, _viewMonth + 1, n));
            html += _cellHtml(n, ds3, today, predicted, true);
        }

        grid.innerHTML = html;
        _bindCalCells(grid);
    }

    function _cellHtml(day, dateStr, today, predicted, otherMonth) {
        var cls = 'pd-cal-cell';
        if (otherMonth) cls += ' pd-other-month';
        if (dateStr === today) cls += ' pd-today';
        if (_isInPeriod(dateStr)) cls += ' pd-period';
        else if (predicted.indexOf(dateStr) !== -1) cls += ' pd-predict';
        // 有日记录但没有颜色时加小圆点
        var dot = (!otherMonth && _data.dailyRecords[dateStr] && !_isInPeriod(dateStr) && predicted.indexOf(dateStr) === -1)
            ? '<span class="pd-cal-dot"></span>' : '';
        return '<div class="' + cls + '" data-date="' + dateStr + '">' + day + dot + '</div>';
    }

    function _bindCalCells(grid) {
        grid.querySelectorAll('.pd-cal-cell').forEach(function (cell) {
            var dateStr = cell.dataset.date;
            if (!dateStr) return;
            var otherMonth = cell.classList.contains('pd-other-month');

            // 长按：仅历史非当月格子以及当月历史格子
            if (!otherMonth) {
                cell.addEventListener('touchstart', function () {
                    _longPressTimer = setTimeout(function () {
                        _longPressTimer = null;
                        if (dateStr < _today()) {
                            _toggleHistory(dateStr);
                            _renderCalendar();
                            _updateStats();
                            _updateToggleBtn();
                        }
                    }, 600);
                }, { passive: true });
                cell.addEventListener('touchend', function () {
                    if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
                });
                cell.addEventListener('touchmove', function () {
                    if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
                });
            }

            // 单击
            cell.addEventListener('click', function () {
                if (_longPressTimer === null && cell._longPressed) { cell._longPressed = false; return; }
                var today = _today();
                if (dateStr === today) {
                    var card = document.getElementById('pd-status-card');
                    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else if (!otherMonth) {
                    _openDaySheet(dateStr);
                }
            });
        });
    }

    // ── 历史日弹窗（只读） ────────────────────────────
    function _openDaySheet(dateStr) {
        var d = _parse(dateStr);
        var titleEl = document.getElementById('pd-day-sheet-title');
        if (titleEl) titleEl.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAYS[d.getDay()];

        var tagEl    = document.getElementById('pd-day-period-tag');
        var infoRow  = document.querySelector('#pd-day-sheet .pd-day-info-row');
        var dayNum   = _getDayNum(dateStr);
        if (tagEl)   { tagEl.textContent = '经期第' + dayNum + '天'; tagEl.style.display = dayNum > 0 ? '' : 'none'; }
        if (infoRow) infoRow.style.display = dayNum > 0 ? '' : 'none';

        var rec     = _data.dailyRecords[dateStr];
        var flowEl  = document.getElementById('pd-day-flow-display');
        var sympEl  = document.getElementById('pd-day-symptom-tags');
        if (flowEl) flowEl.textContent = (rec && rec.flow) ? FLOW_LABELS[rec.flow] : '暂无记录';
        if (sympEl) {
            if (rec && rec.symptoms && rec.symptoms.length) {
                sympEl.innerHTML = rec.symptoms.map(function (s) {
                    return '<span class="pd-day-symptom-tag">' + s + '</span>';
                }).join('');
            } else {
                sympEl.innerHTML = '<span style="color:var(--text-secondary);font-size:12px;opacity:0.6;">暂无记录</span>';
            }
        }

        var sheet   = document.getElementById('pd-day-sheet');
        var overlay = document.getElementById('cs-overlay');
        if (sheet)   sheet.classList.add('cs-sheet-open');
        if (overlay) overlay.style.display = 'block';
    }

    // ── 症状渲染 ──────────────────────────────────────
    function _renderSymptoms() {
        var wrap = document.getElementById('pd-symptoms-wrap');
        if (!wrap) return;
        var all = DEFAULT_SYMPTOMS.concat(_data.customSymptoms || []);
        var html = all.map(function (s) {
            var on = _currentSymptoms.indexOf(s) !== -1;
            return '<button class="pd-symptom-chip' + (on ? ' pd-chip-on' : '') +
                   '" onclick="window._pdToggleSymptom(this)">' + s + '</button>';
        }).join('');
        html += '<button class="pd-symptom-add" onclick="window._pdAddSymptom()">+ 自定义</button>';
        wrap.innerHTML = html;
    }

    // ── 梦角留言 ──────────────────────────────────────
    function _partnerName() {
        return (typeof settings !== 'undefined' && settings.partnerName) ||
               (window._settings && window._settings.partnerName) || '梦角';
    }

    function _renderLetterCard() {
        var pname   = _partnerName();
        var nameEl  = document.getElementById('pd-letter-name');
        var pnEl    = document.getElementById('pd-letter-pname');
        if (nameEl) nameEl.textContent = pname;
        if (pnEl)   pnEl.textContent   = pname;

        // 头像
        var avEl  = document.getElementById('pd-partner-av');
        var imgEl = document.getElementById('partner-avatar');
        if (avEl && imgEl && imgEl.src && imgEl.src.indexOf('data:') === 0) {
            avEl.innerHTML = '<img src="' + imgEl.src + '">';
        }

        // 留言内容
        var emptyEl = document.getElementById('pd-letter-empty');
        var linesEl = document.getElementById('pd-letter-lines');

        // 判断当前经期是否有留言
        var active   = _activePeriod() || (_data.periods.length ? _data.periods[_data.periods.length - 1] : null);
        var hasMsg   = _data.partnerMsg && active && _data.partnerMsg.periodId === active.id;

        if (hasMsg && _data.partnerMsg.lines && _data.partnerMsg.lines.length) {
            if (emptyEl) emptyEl.style.display = 'none';
            if (linesEl) {
                linesEl.style.display = '';
                linesEl.innerHTML = _data.partnerMsg.lines.map(function (l) {
                    return '<div class="pd-letter-line">' + l + '</div>';
                }).join('');
            }
        } else {
            if (emptyEl) emptyEl.style.display = '';
            if (linesEl) linesEl.style.display = 'none';
        }
    }

    // ── 历史记录弹窗 ──────────────────────────────────
    function _renderHistory() {
        var body = document.getElementById('pd-history-body');
        if (!body) return;

        var sorted = _data.periods.slice().sort(function (a, b) { return a.startDate < b.startDate ? 1 : -1; });
        if (!sorted.length) {
            body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary);font-size:13px;opacity:0.6;">暂无经期历史记录</div>';
            return;
        }

        var byMonth = {}, monthOrder = [];
        sorted.forEach(function (p) {
            var d  = _parse(p.startDate);
            var mk = d.getFullYear() + '-' + (d.getMonth() + 1);
            if (!byMonth[mk]) { byMonth[mk] = []; monthOrder.push(mk); }
            byMonth[mk].push(p);
        });

        var html = '';
        monthOrder.forEach(function (mk) {
            var pts = mk.split('-');
            html += '<div class="pd-hist-month">· ' + pts[0] + '年' + pts[1] + '月 ·</div>';
            byMonth[mk].forEach(function (p) {
                var sd   = _parse(p.startDate);
                var ed   = p.endDate ? _parse(p.endDate) : null;
                var days = ed ? _diff(p.startDate, p.endDate) + 1 : null;
                var range = ed
                    ? (sd.getMonth() + 1) + '月' + sd.getDate() + '日 - ' + (ed.getMonth() + 1) + '月' + ed.getDate() + '日（' + days + '天）'
                    : (sd.getMonth() + 1) + '月' + sd.getDate() + '日起（进行中）';

                // 汇总日记录
                var allSymptoms = {}, maxFlow = 0;
                Object.keys(_data.dailyRecords).forEach(function (dateStr) {
                    if (!_getPeriodOf(dateStr) || _getPeriodOf(dateStr).id !== p.id) return;
                    var r = _data.dailyRecords[dateStr];
                    if (r.flow > maxFlow) maxFlow = r.flow;
                    (r.symptoms || []).forEach(function (s) { allSymptoms[s] = true; });
                });
                var sympList  = Object.keys(allSymptoms);
                var chipsHtml = '';
                if (maxFlow) chipsHtml += '<span class="pd-hist-chip">出血量：' + FLOW_LABELS[maxFlow] + '</span>';
                sympList.slice(0, 3).forEach(function (s) { chipsHtml += '<span class="pd-hist-chip">' + s + '</span>'; });
                if (sympList.length > 3) chipsHtml += '<span class="pd-hist-chip">+' + (sympList.length - 3) + '</span>';
                if (!chipsHtml) chipsHtml = '<span style="font-size:11px;color:var(--text-secondary);opacity:0.6;">暂无详细记录</span>';

                html += '<div class="pd-hist-entry">' +
                    '<div class="pd-hist-date-col">' +
                        '<div class="pd-hist-day">' + sd.getDate() + '</div>' +
                        '<div class="pd-hist-weekday">' + WEEKDAYS[sd.getDay()] + '</div>' +
                    '</div>' +
                    '<div class="pd-hist-content">' +
                        '<div class="pd-hist-range">' + range + '</div>' +
                        '<div class="pd-hist-meta">' + chipsHtml + '</div>' +
                    '</div>' +
                    '<div class="pd-hist-icon">🌸</div>' +
                '</div>';
            });
        });
        body.innerHTML = html;
    }

    // ── 公开 API ──────────────────────────────────────
    window._pdToggleToday = function () {
        var today = _today();
        if (_isInPeriod(today)) {
            _endPeriod(today);
        } else {
            _startPeriod(today, true);
        }
        _renderCalendar();
        _updateStats();
        _updateToggleBtn();
        _updateStatusCard();
    };

    window._pdSetFlow = function (val) {
        _currentFlow = val;
        document.querySelectorAll('.pd-flow-btn').forEach(function (btn) {
            btn.classList.toggle('pd-flow-active', Number(btn.dataset.val) === val);
        });
        _updateSaveBtn(false);
    };

    window._pdToggleSymptom = function (btn) {
        btn.classList.toggle('pd-chip-on');
        var s   = btn.textContent;
        var idx = _currentSymptoms.indexOf(s);
        if (idx === -1) _currentSymptoms.push(s); else _currentSymptoms.splice(idx, 1);
        _updateSaveBtn(false);
    };

    window._pdAddSymptom = function () {
        var val = prompt('输入自定义症状名称：');
        if (!val || !val.trim()) return;
        val = val.trim();
        if (!_data.customSymptoms) _data.customSymptoms = [];
        if (DEFAULT_SYMPTOMS.indexOf(val) === -1 && _data.customSymptoms.indexOf(val) === -1) {
            _data.customSymptoms.push(val);
            _save();
        }
        _renderSymptoms();
    };

    window._pdSaveRecord = function () {
        var today = _today();
        _data.dailyRecords[today] = { flow: _currentFlow, symptoms: _currentSymptoms.slice() };
        _save();
        _updateSaveBtn(true);
        _renderCalendar();  // 刷新日历上的小点
    };

    window._pdOpenHistory = function () {
        _renderHistory();
        var page = document.getElementById('pd-history-page');
        if (page) page.classList.add('pd-history-open');
    };

    window._pdCloseHistory = function () {
        var page = document.getElementById('pd-history-page');
        if (page) page.classList.remove('pd-history-open');
    };

    window._pdCloseDaySheet = function () {
        var sheet   = document.getElementById('pd-day-sheet');
        var overlay = document.getElementById('cs-overlay');
        if (sheet)   sheet.classList.remove('cs-sheet-open');
        if (overlay) overlay.style.display = 'none';
    };

    // ── 入口 ──────────────────────────────────────────
    window._pdInit = async function () {
        if (!_loaded) await _load();

        var now    = new Date();
        _viewYear  = now.getFullYear();
        _viewMonth = now.getMonth();

        _renderCalendar();
        _renderSymptoms();
        _updateStats();
        _updateToggleBtn();
        _updateStatusCard();
        _renderLetterCard();
        _checkNotif();

        // 月份切换
        var prev = document.getElementById('pd-prev-month');
        var next = document.getElementById('pd-next-month');
        if (prev) prev.onclick = function () {
            _viewMonth--;
            if (_viewMonth < 0) { _viewMonth = 11; _viewYear--; }
            _renderCalendar();
        };
        if (next) next.onclick = function () {
            _viewMonth++;
            if (_viewMonth > 11) { _viewMonth = 0; _viewYear++; }
            _renderCalendar();
        };
    };

    // 每分钟检查一次通知
    setInterval(function () { if (_loaded) _checkNotif(); }, 60000);

})();
