/**
 * anniversary.js — 纪念日功能（情侣空间 #cs-panel-ann）
 * 加载在 onboarding.js 之后，覆盖 renderAnniversariesList / switchAnnType
 * 只操作纪念日专属 DOM，不修改任何其他元素样式
 */

// ── 模块状态 ──────────────────────────────────────────────
var _annEditingId    = null;
var _annPinnedId     = null;   // null/'meet'=相遇；Number=具体条目
var _annCoverDataUrl = null;
var _annCoverOriginalUrl = null; // 打开编辑面板时加载到的原始封面值，用来判断保存时要不要清理旧的云端文件
var _annCoverChanged = false;
var _annMeetOverride = null;   // 用户编辑相遇后的覆盖数据：{name, date} 或 null

// ── 相遇覆盖数据的读取（供各处使用） ──────────────────────
async function _annLoadMeetOverride() {
    try {
        var val = await localforage.getItem(getStorageKey('annMeetOverride'));
        _annMeetOverride = val || null;
    } catch(e) { _annMeetOverride = null; }
}
window._annLoadMeetOverride = _annLoadMeetOverride;

// 得到当前相遇的实际数据（有 override 用 override，否则用首条消息）
function _annGetMeetData() {
    if (_annMeetOverride && _annMeetOverride.date) {
        return { name: _annMeetOverride.name || '相遇', date: _annMeetOverride.date, target: new Date(_annMeetOverride.date) };
    }
    var msgs = (typeof messages !== 'undefined') ? messages : [];
    if (!msgs.length) return null;
    var start = new Date(msgs[0].timestamp);
    if (isNaN(start.getTime())) return null;
    // ISO date 字符串（yyyy-mm-dd）方便 date input 用
    var iso = start.getFullYear() + '-'
        + String(start.getMonth()+1).padStart(2, '0') + '-'
        + String(start.getDate()).padStart(2, '0');
    return { name: '相遇', date: iso, target: start };
}

// ── 置顶持久化 ────────────────────────────────────────────
async function _annLoadPinnedId() {
    try {
        var val = await localforage.getItem(getStorageKey('annPinnedId'));
        if (val !== null && val !== undefined) _annPinnedId = val;
    } catch(e) {}
}
function _annSavePinnedId(id) {
    _annPinnedId = id;
    try { localforage.setItem(getStorageKey('annPinnedId'), id); } catch(e) {}
}
window._annLoadPinned = _annLoadPinnedId;

window._annPinItem = function(annId) {
    _annSavePinnedId(annId);
    renderAnniversariesList();
    _annUpdateHeaderDays();
    if (typeof showNotification === 'function') showNotification('已置顶', 'success');
};

window._annGetPinned = function() {
    var isMeet = (_annPinnedId === null || _annPinnedId === 'meet');
    if (isMeet) {
        var m = _annGetMeetData();
        if (!m) return null;
        var days = Math.max(0, Math.floor((Date.now() - m.target.getTime()) / 86400000));
        return { type: 'meet', name: m.name, days: days, verb: '已经', start: m.target };
    }
    var ann = (typeof anniversaries !== 'undefined' ? anniversaries : []).find(function(a) { return a.id === _annPinnedId; });
    if (!ann) return null;
    var now = new Date(), target = new Date(ann.date), isCD = ann.type === 'countdown';
    var d = isCD ? Math.max(0, Math.ceil((target - now) / 86400000)) : Math.max(0, Math.floor((now - target) / 86400000));
    return { type: 'ann', name: ann.name, days: d, verb: isCD ? '还有' : '已经', ann: ann };
};

// ── 更新顶部计数器（只改 cs-days-num 的 textContent + 前面加名称）──
// 关键：完全不改 cs-days-text 的 DOM 结构，只覆盖它
function _annUpdateHeaderDays() {
    var textEl = document.querySelector('.cs-days-text');
    var numEl  = document.getElementById('cs-days-num');
    if (!textEl || !numEl) return;

    var p = window._annGetPinned && window._annGetPinned();
    if (!p) {
        textEl.innerHTML = '相识 <span class="cs-days-num" id="cs-days-num">---</span> 天';
        return;
    }
    textEl.innerHTML =
        '<div class="cs-days-title">' + p.name + ' ' + p.verb + '</div>'
        + '<div class="cs-days-line">'
        + '<span class="cs-days-num" id="cs-days-num">' + p.days.toLocaleString('zh-CN') + '</span>'
        + '<span class="cs-days-unit">天</span>'
        + '</div>';
}

// ── 左滑手势 ──────────────────────────────────────────────
function _annSetupSwipe(wrap) {
    var inner   = wrap.querySelector('.ann-swipe-inner');
    var actions = wrap.querySelector('.ann-swipe-actions');
    if (!inner || !actions) return;

    var startX = 0, startY = 0, dragBaseX = 0;
    var decided = false, isHoriz = false;
    var isOpen  = false;

    function actW() { return actions.offsetWidth || 144; }
    function snapTo(x, animate) {
        if (animate) {
            inner.style.transition = 'transform 0.22s cubic-bezier(0.4,0,0.2,1)';
            setTimeout(function() { inner.style.transition = ''; }, 230);
        }
        inner.style.transform = x === 0 ? '' : 'translateX(' + x + 'px)';
    }
    wrap._closeSwipe = function() {
        if (isOpen) { snapTo(0, true); isOpen = false; }
    };

    inner.addEventListener('touchstart', function(e) {
        _annCloseAllSwipesExcept(wrap);
        startX    = e.touches[0].clientX;
        startY    = e.touches[0].clientY;
        dragBaseX = isOpen ? -actW() : 0;
        decided   = false;
        isHoriz   = false;
    }, { passive: true });

    inner.addEventListener('touchmove', function(e) {
        var dx = e.touches[0].clientX - startX;
        var dy = e.touches[0].clientY - startY;
        if (!decided) {
            if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
            isHoriz = Math.abs(dx) > Math.abs(dy);
            decided = true;
        }
        if (!isHoriz) return;
        var newX = Math.min(0, Math.max(-actW(), dragBaseX + dx));
        inner.style.transform = newX === 0 ? '' : 'translateX(' + newX + 'px)';
    }, { passive: true });

    inner.addEventListener('touchend', function(e) {
        if (!decided || !isHoriz) return;
        var dx     = e.changedTouches[0].clientX - startX;
        var totalX = dragBaseX + dx;
        if (totalX < -(actW() * 0.35)) {
            snapTo(-actW(), true); isOpen = true;
        } else {
            snapTo(0, true); isOpen = false;
        }
    }, { passive: true });

    inner.addEventListener('click', function(e) {
        if (e.target.closest('.ann-swipe-actions')) return;
        if (isOpen) { snapTo(0, true); isOpen = false; return; }
        if (typeof wrap._onCardClick === 'function') wrap._onCardClick();
    });
}

function _annCloseAllSwipesExcept(exceptWrap) {
    document.querySelectorAll('.ann-swipe-wrap').forEach(function(w) {
        if (w !== exceptWrap && typeof w._closeSwipe === 'function') w._closeSwipe();
    });
}

// ── 封面图片 ──────────────────────────────────────────────
function _annShowCoverPreview(url) {
    var img   = document.getElementById('cs-ann-cover-img');
    var thumb = document.getElementById('cs-ann-cover-thumb');
    if (thumb) thumb.style.display = url ? '' : 'none';
    if (!img) return;
    if (url && url.indexOf('oss://') === 0 && window.CloudMedia) {
        window.CloudMedia.fetchUrl(url).then(function(blobUrl) { img.src = blobUrl; })
            .catch(function() { img.src = ''; });
    } else {
        img.src = url || '';
    }
}
window._annOnCoverSelected = function(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
        _annCoverDataUrl = ev.target.result;
        _annCoverChanged = true;
        _annShowCoverPreview(_annCoverDataUrl);
    };
    reader.readAsDataURL(file);
    input.value = '';
};
window._annRemoveCover = function() {
    _annCoverDataUrl = null;
    _annCoverChanged = true;
    _annShowCoverPreview(null);
};

// ── 富文本编辑器命令 ──────────────────────────────────────
window._annExec = function(command, value) {
    var editor = document.getElementById('cs-ann-remark-editor');
    if (editor) editor.focus();
    document.execCommand(command, false, value || null);
};

// ── Bottom sheet 开关 ────────────────────────────────────
window.openAnnSheet = function(mode, annId) {
    _annCloseAllSwipesExcept(null);
    _annEditingId = (mode === 'edit' && annId != null) ? annId : null;

    var isMeetEdit = (_annEditingId === 'meet');

    var titleEl   = document.getElementById('cs-ann-sheet-title');
    var deleteBtn = document.getElementById('cs-ann-sheet-delete');
    var nameInput = document.getElementById('cs-ann-input-name');
    var dateInput = document.getElementById('cs-ann-input-date');
    var typeSelector = document.querySelector('#cs-ann-sheet .ann-type-selector');
    var typeDesc = document.querySelector('#cs-ann-sheet .cs-ann-type-desc-wrap');
    var typeLabel = typeSelector ? typeSelector.parentElement.querySelector('.cs-ann-form-label') : null;

    if (titleEl)   titleEl.textContent     = _annEditingId ? '编辑纪念日' : '添加纪念日';
    // 相遇不能删除，普通编辑显示删除按钮，新建不显示
    if (deleteBtn) deleteBtn.style.display = (_annEditingId && !isMeetEdit) ? 'block' : 'none';

    // 相遇不需要选类型（相遇天然是"已经"类型）
    if (typeSelector) typeSelector.style.display = isMeetEdit ? 'none' : '';
    if (typeDesc)     typeDesc.style.display     = isMeetEdit ? 'none' : '';
    if (typeLabel)    typeLabel.style.display    = isMeetEdit ? 'none' : '';

    _annCoverDataUrl = null;
    _annCoverOriginalUrl = null;
    _annCoverChanged = false;
    _annShowCoverPreview(null);

    // 清空备注编辑器
    var remarkEditor = document.getElementById('cs-ann-remark-editor');
    if (remarkEditor) remarkEditor.innerHTML = '';

    if (isMeetEdit) {
        // 编辑相遇：读 override 或默认（首条消息）
        var m = _annGetMeetData();
        if (nameInput) nameInput.value = (m && m.name) || '';
        if (dateInput) dateInput.value = (m && m.date) || '';
        window.switchAnnType('anniversary');
        // 加载相遇的备注
        if (remarkEditor && _annMeetOverride && _annMeetOverride.remark) {
            remarkEditor.innerHTML = _annMeetOverride.remark;
        }
        // 加载相遇的封面
        try {
            localforage.getItem(getStorageKey('annCoverBg_meet')).then(function(url) {
                if (url) { _annCoverDataUrl = url; _annCoverOriginalUrl = url; _annShowCoverPreview(url); }
            });
        } catch(e) {}
    } else if (_annEditingId) {
        var ann = (typeof anniversaries !== 'undefined' ? anniversaries : []).find(function(a) { return a.id === _annEditingId; });
        if (ann) {
            if (nameInput) nameInput.value = ann.name || '';
            if (dateInput) dateInput.value = ann.date || '';
            window.switchAnnType(ann.type || 'anniversary');
            if (remarkEditor && ann.remark) remarkEditor.innerHTML = ann.remark;
        }
        try {
            localforage.getItem(getStorageKey('annCoverBg_' + _annEditingId)).then(function(url) {
                if (url) { _annCoverDataUrl = url; _annCoverOriginalUrl = url; _annShowCoverPreview(url); }
            });
        } catch(e) {}
    } else {
        if (nameInput) nameInput.value = '';
        if (dateInput) dateInput.value = '';
        window.switchAnnType('anniversary');
    }
    _annUpdateCharCount();

    var sheet   = document.getElementById('cs-ann-sheet');
    var overlay = document.getElementById('cs-overlay');
    if (sheet)   sheet.classList.add('cs-sheet-open');
    if (overlay) overlay.classList.add('cs-overlay-on');
};

window.closeAnnSheet = function() {
    var sheet = document.getElementById('cs-ann-sheet');
    if (sheet) sheet.classList.remove('cs-sheet-open');
    var anyOpen = document.querySelectorAll('.cs-sheet.cs-sheet-open').length;
    if (!anyOpen) {
        var overlay = document.getElementById('cs-overlay');
        if (overlay) overlay.classList.remove('cs-overlay-on');
    }
};

// ── 保存 ─────────────────────────────────────────────────
window.saveAnnFromSheet = async function() {
    var nameInput = document.getElementById('cs-ann-input-name');
    var dateInput = document.getElementById('cs-ann-input-date');
    var remarkEditor = document.getElementById('cs-ann-remark-editor');
    var name = nameInput ? nameInput.value.trim() : '';
    var date = dateInput ? dateInput.value : '';
    // 读取备注：如果只有空白（比如浏览器插入的 <br>），当作空
    var remark = remarkEditor ? remarkEditor.innerHTML.trim() : '';
    if (remark && !remarkEditor.textContent.trim() && !/<img|<video/i.test(remark)) {
        remark = '';
    }

    if (!name) { if (typeof showNotification === 'function') showNotification('请填写名称', 'error'); return; }
    if (!date) { if (typeof showNotification === 'function') showNotification('请选择日期', 'error'); return; }
    if (Array.from(name).length > 16) { if (typeof showNotification === 'function') showNotification('名称最多 8 个汉字', 'error'); return; }

    var type = (typeof currentAnnType !== 'undefined' && currentAnnType)
            || (typeof currentAnniversaryType !== 'undefined' && currentAnniversaryType)
            || 'anniversary';

    var isMeetSave = (_annEditingId === 'meet');
    var savedId;

    if (isMeetSave) {
        savedId = 'meet';
        _annMeetOverride = { name: name, date: date, remark: remark };
        try { localforage.setItem(getStorageKey('annMeetOverride'), _annMeetOverride); } catch(e) {}
    } else if (_annEditingId !== null) {
        savedId = _annEditingId;
        var idx = anniversaries.findIndex(function(a) { return a.id === _annEditingId; });
        if (idx !== -1) {
            anniversaries[idx].name = name;
            anniversaries[idx].date = date;
            anniversaries[idx].type = type;
            anniversaries[idx].remark = remark;
        }
    } else {
        savedId = Date.now();
        anniversaries.push({ id: savedId, name: name, date: date, type: type, remark: remark });
    }

    if (_annCoverChanged) {
        try {
            var coverKey = getStorageKey('annCoverBg_' + savedId);
            // 旧封面如果是云端引用，且这次有变化（换图或删除），先清理掉云端旧文件，避免堆积孤儿文件
            if (_annCoverOriginalUrl && _annCoverOriginalUrl.indexOf('oss://') === 0 && window.CloudMedia) {
                try { await window.CloudMedia.delete(_annCoverOriginalUrl); } catch(e) { /* 删除失败不影响保存，静默跳过 */ }
            }
            if (!_annCoverDataUrl) {
                localforage.removeItem(coverKey);
            } else if (_annCoverDataUrl.indexOf('oss://') === 0) {
                // 已经是云端引用（没换图，只是重新触发了保存），原样存
                localforage.setItem(coverKey, _annCoverDataUrl);
            } else if (window.CloudSync && window.CloudSync.isConnected() && window.CloudMedia) {
                // 配置了 OSS：传云端，本地只留地址，不留照片本身
                try {
                    var coverUpload = await window.CloudMedia.upload(_annCoverDataUrl, 'ann-covers');
                    localforage.setItem(coverKey, (coverUpload && coverUpload.url) || _annCoverDataUrl);
                } catch(e) {
                    // 上传失败：退回存本地，保证功能不中断，但打一条日志方便排查——
                    // 之前这里完全静默，出问题了连报错内容都看不到
                    console.warn('[anniversary] 封面上传云端失败，已退回本地保存:', e);
                    localforage.setItem(coverKey, _annCoverDataUrl);
                }
            } else {
                // 没配置 OSS：存本地
                localforage.setItem(coverKey, _annCoverDataUrl);
            }
        } catch(e) {}
    }

    if (typeof throttledSaveData === 'function') throttledSaveData();
    renderAnniversariesList();
    _annUpdateHeaderDays();
    window.closeAnnSheet();
    // 编辑保存后：若详情页正打开，延迟刷新（等 sheet 关闭动画完成）
    if (_annDetailCurrentId !== null && typeof window.openAnnDetail === 'function') {
        var refreshId = _annDetailCurrentId;
        setTimeout(function() { window.openAnnDetail(refreshId); }, 200);
    }
    if (typeof showNotification === 'function') showNotification(_annEditingId ? '已更新' : '纪念日已添加', 'success');
};

window.deleteCurrentAnn = function() {
    if (_annEditingId === null) return;
    if (!confirm('确定要删除这条纪念日吗？')) return;
    anniversaries = anniversaries.filter(function(a) { return a.id !== _annEditingId; });
    if (_annPinnedId === _annEditingId) _annSavePinnedId(null);
    (async function() {
        try {
            var delCoverKey = getStorageKey('annCoverBg_' + _annEditingId);
            var oldCover = await localforage.getItem(delCoverKey);
            if (oldCover && oldCover.indexOf('oss://') === 0 && window.CloudMedia) {
                try { await window.CloudMedia.delete(oldCover); } catch(e) { /* 静默跳过 */ }
            }
            await localforage.removeItem(delCoverKey);
        } catch(e) {}
    })();
    if (typeof throttledSaveData === 'function') throttledSaveData();
    renderAnniversariesList();
    _annUpdateHeaderDays();
    window.closeAnnSheet();
    // 删除时才关闭详情页（否则详情页里的条目已不存在）
    if (typeof window.closeAnnDetail === 'function') window.closeAnnDetail();
    if (typeof showNotification === 'function') showNotification('已删除', 'success');
};

function _annUpdateCharCount() {
    var inp = document.getElementById('cs-ann-input-name');
    var el  = document.getElementById('cs-ann-char-count');
    if (!inp || !el) return;
    var len = Array.from(inp.value).length;
    el.textContent = len + ' / 8';
    el.style.color = len > 16 ? '#ff5050' : 'var(--text-secondary)';
}

// ── 覆盖 switchAnnType ────────────────────────────────────
window.switchAnnType = function(type) {
    if (typeof currentAnnType !== 'undefined') currentAnnType = type;
    if (typeof currentAnniversaryType !== 'undefined') currentAnniversaryType = type;
    document.querySelectorAll('.ann-type-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.type === type);
    });
    var desc = document.getElementById('ann-type-desc');
    if (desc) {
        desc.textContent = type === 'anniversary'
            ? '记录从某一天到今天已经走过了多少天，适合相识日、恋爱纪念日等。'
            : '记录到未来某一天还剩下多少天，适合生日、旅行、重要考试等。';
    }
};

// ── 日期格式化 ────────────────────────────────────────────
function _annFormatDate(date) {
    var dow = ['日','一','二','三','四','五','六'][date.getDay()];
    return date.getFullYear() + '年'
         + (date.getMonth() + 1) + '月'
         + date.getDate() + '日 星期' + dow;
}

// ── 渲染列表 ─────────────────────────────────────────────
function renderAnniversariesList() {
    var container = document.getElementById('ann-list-container');
    if (!container) return;
    container.innerHTML = '';

    var now  = new Date();
    var list = (typeof anniversaries !== 'undefined') ? anniversaries : [];

    if (typeof _annPinnedId === 'number' && !list.some(function(a) { return a.id === _annPinnedId; })) {
        _annSavePinnedId(null);
    }
    var isMeetPinned = (_annPinnedId === null || _annPinnedId === 'meet');

    // 相遇条目（有 override 用 override，否则用首条消息时间）
    var meetData = _annGetMeetData();
    var meetWrap = null;
    if (meetData) {
        var meetDays = Math.max(0, Math.floor((Date.now() - meetData.target.getTime()) / 86400000));
        meetWrap = _annMakeWrap(
            _annMakeCard(meetData.name, meetData.target, meetDays, false, isMeetPinned, 'meet'),
            isMeetPinned,
            [{ label: '置顶', cls: 'ann-action-pin', fn: function() { window._annPinItem('meet'); } }],
            function() { window.openAnnDetail('meet'); }
        );
        meetWrap.classList.add('ann-swipe-wrap-meet');
    }

    if (isMeetPinned && meetWrap) container.appendChild(meetWrap);

    list.slice().sort(function(a, b) {
        if (_annPinnedId === a.id) return -1;
        if (_annPinnedId === b.id) return 1;
        return b.id - a.id;
    }).forEach(function(ann) {
        var isPinned    = (_annPinnedId === ann.id);
        var isCountdown = (ann.type === 'countdown');
        var target      = new Date(ann.date);
        var diffDays    = isCountdown
            ? Math.max(0, Math.ceil((target - now) / 86400000))
            : Math.max(0, Math.floor((now - target) / 86400000));

        var editFn = function() { window.openAnnDetail(ann.id); };
        var wrap = _annMakeWrap(
            _annMakeCard(ann.name, target, diffDays, isCountdown, isPinned, ann.id),
            isPinned,
            [
                { label: '置顶', cls: 'ann-action-pin',    fn: function() { window._annPinItem(ann.id); } },
                { label: '删除', cls: 'ann-action-delete', fn: function() {
                    if (typeof window.deleteAnniversaryItem === 'function') window.deleteAnniversaryItem(ann.id);
                }}
            ],
            editFn
        );
        container.appendChild(wrap);

        if (!isPinned) {
            _annSetupSwipe(wrap);
        } else {
            // 置顶：把点击绑到卡片本身（.ann-pinned-card），最内层元素
            wrap.style.cursor = 'pointer';
            var pinCard = wrap.querySelector('.ann-pinned-card');
            var clickHandler = function(e) {
                if (e.target.closest('.ann-swipe-actions')) return;
                console.log('[ann-pinned-click] entering detail for id=', ann.id);
                editFn();
            };
            if (pinCard) pinCard.addEventListener('click', clickHandler);
            wrap.addEventListener('click', clickHandler);
        }
    });

    if (!isMeetPinned && meetWrap) {
        container.appendChild(meetWrap);
        _annSetupSwipe(meetWrap);
    }
}

// ── 工厂：卡片 ────────────────────────────────────────────
function _annMakeCard(name, targetDate, diffDays, isCountdown, isPinned, annId) {
    var el    = document.createElement('div');
    var label = isCountdown ? '倒数' : '已过';

    var baseStyle = 'flex:0 0 100%;min-width:0;display:flex;align-items:center;'
        + 'justify-content:space-between;box-sizing:border-box;background:var(--secondary-bg);'
        + 'border-radius:0;border:none;margin:0;';
    var tagStyle = 'background:rgba(var(--accent-color-rgb),0.12);color:var(--accent-color);'
        + 'border-color:rgba(var(--accent-color-rgb),0.2);';

    if (isPinned) {
        el.className = 'ann-pinned-card';
        console.log('[ann-pinned] making card, annId=', annId, 'type=', typeof annId, 'name=', name);
        if (annId != null) {
            var idInJs = (typeof annId === 'number') ? annId : "'" + annId + "'";
            el.setAttribute('onclick', 'window.openAnnDetail(' + idInJs + ')');
            console.log('[ann-pinned] onclick set to: window.openAnnDetail(' + idInJs + ')');
        } else {
            console.log('[ann-pinned] annId was null/undefined, NO onclick set');
        }
        el.setAttribute('style', baseStyle + 'padding:18px 16px;min-height:88px;cursor:pointer;');
        el.innerHTML = [
            '<div style="flex:1;min-width:0;padding-left:4px;">',
            '  <div class="ann-item-name">' + name
                + '<span class="ann-tag" style="' + tagStyle + '">' + label + '</span></div>',
            '  <div style="font-size:12px;color:var(--text-secondary);margin-top:6px;opacity:0.8;">'
                + '起始于：' + _annFormatDate(targetDate) + '</div>',
            '</div>',
            '<div style="text-align:right;flex-shrink:0;margin-left:16px;">',
            '  <div style="font-size:52px;font-weight:800;color:var(--accent-color);line-height:1;letter-spacing:-1px;">'
                + diffDays.toLocaleString('zh-CN') + '</div>',
            '  <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">天</div>',
            '</div>'
        ].join('');
    } else {
        el.className = 'ann-list-row';
        el.setAttribute('style', baseStyle + 'padding:14px 16px;min-height:54px;');
        el.innerHTML = [
            '<div style="flex:1;min-width:0;">',
            '  <div class="ann-item-name">' + name
                + '<span class="ann-tag" style="' + tagStyle + '">' + label + '</span></div>',
            '</div>',
            '<div style="text-align:right;flex-shrink:0;margin-left:12px;">',
            '  <div style="font-size:26px;font-weight:800;color:var(--accent-color);line-height:1;">'
                + diffDays.toLocaleString('zh-CN') + '</div>',
            '  <div style="font-size:12px;color:var(--text-secondary);">天</div>',
            '</div>'
        ].join('');
    }
    return el;
}

function _annMakeWrap(card, isPinned, actionDefs, onCardClick) {
    var wrap = document.createElement('div');
    wrap.className = 'ann-swipe-wrap' + (isPinned ? ' ann-swipe-pinned' : '');
    wrap.style.cssText = 'overflow:hidden;border-radius:14px;margin-bottom:10px;touch-action:pan-y;'
        + (isPinned
            ? 'border:1px solid rgba(var(--accent-color-rgb),0.45);'
            : 'border:1px solid var(--border-color);');
    wrap._onCardClick = onCardClick;

    var inner = document.createElement('div');
    inner.className = 'ann-swipe-inner';
    inner.style.cssText = 'display:flex;width:100%;';
    inner.appendChild(card);

    var actions = document.createElement('div');
    actions.className = 'ann-swipe-actions';
    actions.style.cssText = 'display:flex;align-items:stretch;flex-shrink:0;';
    actionDefs.forEach(function(def) {
        var btn = document.createElement('button');
        btn.className = 'ann-action-btn ' + def.cls;
        var bg = def.cls === 'ann-action-delete' ? '#ff4757' : 'var(--accent-color)';
        btn.style.cssText = 'min-width:72px;border:none;font-size:14px;font-weight:600;'
            + 'cursor:pointer;font-family:inherit;display:flex;align-items:center;'
            + 'justify-content:center;background:' + bg + ';color:#fff;';
        btn.textContent = def.label;
        btn.addEventListener('click', function(e) { e.stopPropagation(); def.fn(); });
        actions.appendChild(btn);
    });
    inner.appendChild(actions);

    wrap.appendChild(inner);
    return wrap;
}

// ── 详情页 ────────────────────────────────────────────────
var _annDetailCurrentId = null;

window.openAnnDetail = function(annId) {
    _annCloseAllSwipesExcept(null);
    _annDetailCurrentId = annId;

    var name, target, isCD, remark = '', isMeet = (annId === 'meet');

    if (isMeet) {
        var m = _annGetMeetData();
        if (!m) return;
        name = m.name;
        target = m.target;
        isCD = false;
        remark = (_annMeetOverride && _annMeetOverride.remark) || '';
    } else {
        var ann = (typeof anniversaries !== 'undefined' ? anniversaries : []).find(function(a) { return a.id === annId; });
        if (!ann) return;
        target = new Date(ann.date);
        name = ann.name;
        isCD = ann.type === 'countdown';
        remark = ann.remark || '';
    }

    var now = new Date();
    var days = isCD
        ? Math.max(0, Math.ceil((target - now) / 86400000))
        : Math.max(0, Math.floor((now - target) / 86400000));
    var label = isCD ? '还有' : '已经';
    var dateStr = target.getFullYear() + '-' + (target.getMonth()+1) + '-' + target.getDate();

    var body = document.getElementById('ann-detail-body');
    if (!body) return;

    body.innerHTML = _annDetailHTML(name, label, days, dateStr, remark);

    var cardEl = body.querySelector('.ann-detail-card');
    if (cardEl) {
        cardEl.style.background = 'linear-gradient(135deg, var(--accent-color) 0%, rgba(var(--accent-color-rgb),0.7) 100%)';
    }

    // 加载封面（相遇和普通条目都可能有封面）
    try {
        var coverKey = isMeet ? 'annCoverBg_meet' : ('annCoverBg_' + annId);
        localforage.getItem(getStorageKey(coverKey)).then(function(url) {
            console.log('[ann-detail] cover loaded, id=', annId, 'has url:', !!url);
            if (!url || _annDetailCurrentId !== annId) return;
            var el = document.querySelector('#ann-detail-body .ann-detail-card');
            if (!el) return;
            function applyBg(finalUrl) {
                el.style.backgroundImage = 'url("' + finalUrl.replace(/"/g, '\\"') + '")';
                el.style.backgroundSize = 'cover';
                el.style.backgroundPosition = 'center';
            }
            if (url.indexOf('oss://') === 0 && window.CloudMedia) {
                window.CloudMedia.fetchUrl(url).then(applyBg).catch(function(e) {
                    console.warn('[ann-detail] cover fetchUrl failed:', e);
                });
            } else {
                applyBg(url);
            }
        }).catch(function(e) { console.warn('[ann-detail] cover load failed:', e); });
    } catch(e) { console.warn('[ann-detail] cover load exception:', e); }

    // 相遇也显示编辑按钮
    var editBtn = document.querySelector('.ann-detail-edit-btn');
    if (editBtn) editBtn.style.display = '';

    var page = document.getElementById('ann-detail-page');
    if (page) page.classList.add('active');
    // 隐藏列表和标题，防止透明详情页时列表从下方漏出
    var listEl = document.getElementById('ann-list-container');
    if (listEl) listEl.style.visibility = 'hidden';
    var hdEl = document.querySelector('#cs-panel-ann .cs-ann-hd');
    if (hdEl) hdEl.style.visibility = 'hidden';
};

function _annDetailHTML(name, label, days, dateStr, remark) {
    var remarkHtml = '';
    if (remark) {
        remarkHtml = '<div class="ann-detail-remark">' + remark + '</div>';
    }
    return [
        '<div class="ann-detail-card">',
        '  <div class="ann-detail-card-overlay"></div>',
        '  <div class="ann-detail-card-content">',
        '    <div class="ann-detail-name">&ldquo;' + name + '&rdquo;' + label + '</div>',
        '    <div class="ann-detail-num">' + days.toLocaleString('zh-CN') + '</div>',
        '    <div class="ann-detail-date">起始日：' + dateStr + '</div>',
        '  </div>',
        '</div>',
        remarkHtml
    ].join('');
}

window.closeAnnDetail = function() {
    var page = document.getElementById('ann-detail-page');
    if (page) page.classList.remove('active');
    _annDetailCurrentId = null;
    // 恢复列表和标题可见性
    var listEl = document.getElementById('ann-list-container');
    if (listEl) listEl.style.visibility = '';
    var hdEl = document.querySelector('#cs-panel-ann .cs-ann-hd');
    if (hdEl) hdEl.style.visibility = '';
};

window._annEditFromDetail = function() {
    if (_annDetailCurrentId === null) return;
    window.openAnnSheet('edit', _annDetailCurrentId);
};

// ── 初始化（供 csSwitchTab('ann') 调用）──────────────────
window._annInit = async function() {
    await _annLoadPinnedId();
    await _annLoadMeetOverride();
    renderAnniversariesList();
    _annUpdateHeaderDays();

    var addBtn = document.getElementById('cs-ann-add-btn');
    if (addBtn) addBtn.onclick = function() { window.openAnnSheet('add'); };

    var nameInput = document.getElementById('cs-ann-input-name');
    if (nameInput) nameInput.oninput = _annUpdateCharCount;
};

// ── 接管 _updateDaysCounter 和 csSwitchTab ──
(function() {
    // 关键：直接覆盖 window._updateDaysCounter
    // moments.js 里 function _updateDaysCounter() {...} 是顶层函数声明，会挂到 window
    function hookUpdateCounter() {
        if (typeof window._updateDaysCounter !== 'function') {
            setTimeout(hookUpdateCounter, 100);
            return;
        }
        window._updateDaysCounter = function() { _annUpdateHeaderDays(); };
    }
    hookUpdateCounter();

    function hookCsSwitchTab() {
        if (typeof window.csSwitchTab !== 'function') {
            setTimeout(hookCsSwitchTab, 100);
            return;
        }
        var orig = window.csSwitchTab;
        window.csSwitchTab = function(tab) {
            orig.call(this, tab);
            if (tab === 'ann') {
                // 切回 ann tab 时强制回到列表页
                if (typeof window.closeAnnDetail === 'function') window.closeAnnDetail();
                if (typeof window._annInit === 'function') window._annInit();
            }
            _annUpdateHeaderDays();
        };
    }
    hookCsSwitchTab();

    function hookOpen() {
        if (typeof window.openCoupleSpace !== 'function') {
            setTimeout(hookOpen, 100);
            return;
        }
        var orig = window.openCoupleSpace;
        window.openCoupleSpace = function() {
            orig.apply(this, arguments);
            var tries = 0;
            function tryUpdate() {
                var loads = [];
                if (typeof window._annLoadPinned === 'function') loads.push(window._annLoadPinned());
                if (typeof window._annLoadMeetOverride === 'function') loads.push(window._annLoadMeetOverride());
                Promise.all(loads).then(function() {
                    _annUpdateHeaderDays();
                    var p = window._annGetPinned && window._annGetPinned();
                    if (!p && tries++ < 15) setTimeout(tryUpdate, 200);
                });
            }
            // 多个时间点兜底
            setTimeout(tryUpdate, 50);
            setTimeout(tryUpdate, 300);
            setTimeout(tryUpdate, 800);
        };
    }
    hookOpen();
})();
