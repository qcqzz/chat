/* ── 桌面页（小手机桌面）：顶部栏 ──
   1. 个性签名：左上角，点击编辑，20 字内，持久化
   2. 两侧头像：桌面页独立设置，不再跟随聊天页头像
   3. 顶部栏背景：独立图库，上传按固定比例裁剪后应用到顶部栏 */
(function () {
    var SIG_KEY = 'tiDesktopSignature';
    var GALLERY_KEY = 'tiDesktopTopbarBgGallery';
    var ACTIVE_KEY = 'tiDesktopTopbarBgActive';
    var TopbarBgRatio = 3.0;   // 宽:高，对应图片中顶部栏的横条比例

    var $ = document.getElementById.bind(document);

    // ── 桌面个性化按梦角隔离（localStorage 分桶）──
    // 签名/两侧头像/顶部栏背景/桌面背景 原本存全局固定 key，切换对象后不跟随，现统一改走
    // SESSION_ID 分桶 key。旧版全局 key 数据在首次运行时一次性迁入当前对象并删除旧键（防串对象）。
    var DS_MIG_KEY = 'tiDesktopSettingsMigratedV1';
    function dsSid() { return (typeof SESSION_ID !== 'undefined' && SESSION_ID) ? String(SESSION_ID) : ''; }
    function dsScope(base) { return (window.APP_PREFIX || '') + dsSid() + '_' + base; }
    function dsGet(base) { try { return localStorage.getItem(dsScope(base)); } catch (e) { return null; } }
    function dsSet(base, val) { try { localStorage.setItem(dsScope(base), val); } catch (e) {} }
    function dsRemove(base) { try { localStorage.removeItem(dsScope(base)); } catch (e) {} }
    // 一次性迁移：旧版全局 key（base 即旧固定 key 名）迁入当前对象分桶，迁完删除旧键。
    function dsMigrateLegacy() {
        if (!dsSid()) return;                       // SESSION_ID 未就绪，由 init 重试
        try { if (localStorage.getItem(DS_MIG_KEY)) return; } catch (e) {}
        var legacyKeys = [
            'tiDesktopSignature',
            'tiDesktopAvatarPartner', 'tiDesktopAvatarMe',
            'tiDesktopTopbarBgGallery', 'tiDesktopTopbarBgActive',
            'tiDesktopBgGallery', 'tiDesktopBgActive'
        ];
        for (var i = 0; i < legacyKeys.length; i++) {
            var base = legacyKeys[i];
            var ov = null;
            try { ov = localStorage.getItem(base); } catch (e) {}
            if (ov == null) continue;
            var scoped = dsScope(base);
            var cv = null;
            try { cv = localStorage.getItem(scoped); } catch (e) {}
            if (cv == null) try { localStorage.setItem(scoped, ov); } catch (e) {}
            try { localStorage.removeItem(base); } catch (e) {}
        }
        try { localStorage.setItem(DS_MIG_KEY, '1'); } catch (e) {}
    }

    // ── 存储小工具 ──
    function getGallery() {
        try { return JSON.parse(dsGet(GALLERY_KEY)) || []; } catch (e) { return []; }
    }
    function saveGallery(arr) {
        dsSet(GALLERY_KEY, JSON.stringify(arr));
    }
    function getActive() { try { return dsGet(ACTIVE_KEY) || ''; } catch (e) { return ''; } }

    // ── 个性签名 ──
    function renderSignature() {
        var el = $('dt-signature');
        if (!el) return;
        var sig = '';
        try { sig = dsGet(SIG_KEY) || ''; } catch (e) {}
        el.textContent = sig && sig.trim() ? sig : '两颗缠绕的心，会走同一条路';
    }

    function openSignature() {
        var modal = $('signature-modal');
        var input = $('signature-input');
        if (!modal || !input) return;
        try { input.value = dsGet(SIG_KEY) || ''; } catch (e) { input.value = ''; }
        updateSigCounter();
        showModal(modal);
        setTimeout(function () { input.focus(); }, 120);
    }

    function updateSigCounter() {
        var input = $('signature-input');
        var counter = $('signature-counter');
        if (!input || !counter) return;
        counter.textContent = input.value.length + ' / 20';
    }

    function saveSignature() {
        var input = $('signature-input');
        if (!input) return;
        var val = input.value.trim().slice(0, 20);
        dsSet(SIG_KEY, val);
        renderSignature();
        hideModal($('signature-modal'));
        showNotification && showNotification('个性签名已更新', 'success');
    }

    // ── 两侧头像：桌面页独立设置，不跟随聊天页 ──
    // 头像单独存 localStorage（与聊天页头像完全解耦），昵称仍跟随聊天设置
    var DTAV_P_KEY = 'tiDesktopAvatarPartner';
    var DTAV_M_KEY = 'tiDesktopAvatarMe';
    // 头像的 localStorage 按梦角分桶仅作快速镜像；权威存储走 IndexedDB(localforage，容量大)，
    // 规避部分真机上 localStorage 已被病历库/壁纸等占满时，dsSet 静默写失败导致"保存了却仍是默认图标"。
    // 内存镜像 _dtAvLfP/_dtAvLfM 兼作"localStorage 写失败时当前页立即生效"的兜底。
    var _dtAvLfP = '', _dtAvLfM = '';
    function avLfKey(key) {
        if (typeof getStorageKey === 'function' && typeof SESSION_ID !== 'undefined' && SESSION_ID) {
            try { return getStorageKey('LF_DTAV_' + key); } catch (e) {}
        }
        return dsScope(key) + '_LF';
    }
    // 读取：优先 localStorage 镜像，其次 IndexedDB 内存镜像；两者都空则返回空。
    function getDtAvatar(key) {
        var v = null;
        try { v = dsGet(key); } catch (e) { v = null; }
        if (v) return v;
        return (key === DTAV_P_KEY) ? _dtAvLfP : _dtAvLfM;
    }
    // 写：本地镜像尽量写 localStorage（失败静默忽略）；权威写 IndexedDB，写失败用内存镜像保证当前页立即生效。
    function persistDtAvatar(key, val) {
        var lfOk = false;
        try { localStorage.setItem(dsScope(key), val); lfOk = localStorage.getItem(dsScope(key)) === val; } catch (e) { lfOk = false; }
        if (typeof localforage !== 'undefined') {
            try { localforage.setItem(avLfKey(key), val).catch(function () {}); } catch (e) {}
        }
        if (!lfOk) {
            if (key === DTAV_P_KEY) _dtAvLfP = val; else _dtAvLfM = val;
        }
    }
    function clearDtAvatar(key) {
        try { localStorage.removeItem(dsScope(key)); } catch (e) {}
        if (key === DTAV_P_KEY) _dtAvLfP = ''; else _dtAvLfM = '';
        if (typeof localforage !== 'undefined') {
            try { localforage.removeItem(avLfKey(key)).catch(function () {}); } catch (e) {}
        }
        renderDesktopAvatars();
    }
    // 启动时从 IndexedDB 读回权威头像，localStorage 里有就用那边的，没有则用 IndexedDB 值兜底刷新。
    function prefillDtAvatars() {
        if (typeof localforage === 'undefined') return;
        var keys = [[DTAV_P_KEY, '_dtAvLfP'], [DTAV_M_KEY, '_dtAvLfM']];
        for (var i = 0; i < keys.length; i++) {
            (function (key, mirrorName) {
                try {
                    localforage.getItem(avLfKey(key)).then(function (v) {
                        if (!v) return;
                        if (mirrorName === '_dtAvLfP') _dtAvLfP = v; else _dtAvLfM = v;
                        try { localStorage.setItem(dsScope(key), v); } catch (e) {}
                        renderDesktopAvatars();
                    }).catch(function () {});
                } catch (e) {}
            })(keys[i][0], keys[i][1]);
        }
    }
    var _dtAvHtmlP = null, _dtAvHtmlM = null;   // 缓存上次渲染的 HTML，3s 轮询里内容未变则跳过
    function renderDesktopAvatars() {
        function render(id, key, lastRef) {
            var el = $(id); if (!el) return lastRef;
            var v = getDtAvatar(key);
            var html = v ? '<img src="' + v + '">' : '<i class="fas fa-user"></i>';
            if (html === lastRef) return lastRef; // 未变化：跳过，避免每 3s 重建 <img> 反复解码大图造成闪烁
            el.innerHTML = html;
            return html;
        }
        _dtAvHtmlP = render('dt-avatar-partner', DTAV_P_KEY, _dtAvHtmlP);
        _dtAvHtmlM = render('dt-avatar-me', DTAV_M_KEY, _dtAvHtmlM);
    }
    // 昵称仍跟随聊天设置；缓存上次值，3s 轮询只在真正变化时更新 DOM
    var _lastNameP = '', _lastNameM = '';
    function syncTopbarUsers() {
        // 头像改由桌面页独立管理（读取桌面自己的存储）
        renderDesktopAvatars();
        _lastNameP = setName('partner-name', 'dt-name-partner', '梦角', _lastNameP);
        _lastNameM = setName('my-name', 'dt-name-me', '我', _lastNameM);
    }

    // ── 头像点击编辑（桌面页独立头像弹窗）──
    var _avatarListenersBound = false;
    function bindAvatarEdit() {
        if (_avatarListenersBound) return;
        var dstP = $('dt-avatar-partner'), dstM = $('dt-avatar-me');
        if (!dstP || !dstM) return;
        _avatarListenersBound = true;
        var enable = function (el, isPartner) {
            el.style.cursor = 'pointer';
            el.addEventListener('click', function () {
                openDesktopAvatarModal(isPartner);
            });
        };
        enable(dstP, true);
        enable(dstM, false);
    }

    // ── 桌面页独立头像编辑弹窗 ──
    var _dtAvTarget = null; // 'partner' | 'me'
    var _dtAvCurrent = null;
    var _dtAvModal = null;
    function getDtAvKey(target) { return target === 'me' ? DTAV_M_KEY : DTAV_P_KEY; }
    function _dtAvBuild() {
        if (_dtAvModal) return _dtAvModal;
        var m = document.createElement('div');
        m.className = 'modal';
        m.id = 'dt-avatar-modal';
        m.innerHTML =
            '<div class="modal-content">'
            + '<div class="modal-title"><i class="fas fa-portrait"></i><span>设置桌面页头像</span></div>'
            + '<div style="margin-bottom:16px;">'
            +   '<div style="display:flex;gap:10px;margin-bottom:10px;">'
            +     '<button class="modal-btn modal-btn-secondary" id="dt-av-up" style="flex:1;">选择文件</button>'
            +     '<button class="modal-btn modal-btn-secondary" id="dt-av-del" style="flex:1;">清除头像</button>'
            +   '</div>'
            +   '<input type="file" class="modal-input" id="dt-av-file" accept="image/*" style="display:none;">'
            +   '<div id="dt-av-preview" style="text-align:center;margin-top:10px;display:none;">'
            +     '<img id="dt-av-preview-img" style="max-width:100px;max-height:100px;border-radius:50%;border:2px solid var(--border-color);">'
            +   '</div>'
            + '</div>'
            + '<div class="modal-buttons">'
            +   '<button class="modal-btn modal-btn-secondary" id="dt-av-cancel">取消</button>'
            +   '<button class="modal-btn modal-btn-primary" id="dt-av-save" disabled>保存</button>'
            + '</div>'
            + '</div>';
        document.body.appendChild(m);

        var fileInput = m.querySelector('#dt-av-file');
        var upBtn = m.querySelector('#dt-av-up');
        var delBtn = m.querySelector('#dt-av-del');
        var previewDiv = m.querySelector('#dt-av-preview');
        var previewImg = m.querySelector('#dt-av-preview-img');
        var saveBtn = m.querySelector('#dt-av-save');
        var cancelBtn = m.querySelector('#dt-av-cancel');

        upBtn.addEventListener('click', function () { fileInput.click(); });
        cancelBtn.addEventListener('click', function () { hideModal(m); });
        delBtn.addEventListener('click', function () {
            clearDtAvatar(getDtAvKey(_dtAvTarget));
            if (typeof showNotification === 'function') showNotification('桌面头像已清除', 'success');
            hideModal(m);
        });
        fileInput.addEventListener('change', function (e) {
            var file = e.target.files && e.target.files[0];
            if (!file) return;
            if (file.size > MAX_AVATAR_SIZE) {
                showNotification && showNotification('头像图片不能超过2MB', 'error');
                return;
            }
            cropImageToSquare(file, 300).then(function (b64) {
                _dtAvCurrent = b64;
                previewImg.src = b64;
                previewDiv.style.display = 'block';
                saveBtn.disabled = false;
            }).catch(function (err) {
                console.error(err);
                showNotification && showNotification('图片处理失败', 'error');
            });
        });
        saveBtn.addEventListener('click', function () {
            if (!_dtAvCurrent) return;
            persistDtAvatar(getDtAvKey(_dtAvTarget), _dtAvCurrent);
            renderDesktopAvatars();
            if (typeof showNotification === 'function') showNotification('桌面头像已更新', 'success');
            hideModal(m);
        });
        _dtAvModal = m;
        return m;
    }
    function openDesktopAvatarModal(isPartner) {
        _dtAvTarget = isPartner ? 'partner' : 'me';
        _dtAvCurrent = null;
        var m = _dtAvBuild();
        var previewDiv = m.querySelector('#dt-av-preview');
        var previewImg = m.querySelector('#dt-av-preview-img');
        var saveBtn = m.querySelector('#dt-av-save');
        previewDiv.style.display = 'none';
        previewImg.src = '';
        saveBtn.disabled = true;
        showModal(m);
    }
    window.openDesktopAvatarModal = openDesktopAvatarModal;
    function setName(srcId, dstId, fallback, lastRef) {
        var src = $(srcId), dst = $(dstId);
        if (!src || !dst) return lastRef;
        var v = src.textContent.trim() || fallback;
        if (v === lastRef) return lastRef;            // 未变化：跳过 DOM 写入
        dst.textContent = v;
        return v;
    }

    // ── 顶部栏背景 ──
    function applyTopbarBg(value) {
        var bg = $('dt-bg');
        var card = $('dt-topbar-card');
        if (!bg) return;
        if (value && value.indexOf('data:') === 0) {
            bg.style.backgroundImage = 'url("' + value + '")';
            if (card) card.classList.add('dt-has-bg');
        } else {
            bg.style.backgroundImage = '';
            if (card) card.classList.remove('dt-has-bg');
        }
        dsSet(ACTIVE_KEY, value || '');
    }

    function renderTopbarBgGallery() {
        var list = $('topbar-bg-gallery-list');
        if (!list) return;
        list.innerHTML = '';

        var add = document.createElement('div');
        add.className = 'bg-item bg-add-btn';
        add.innerHTML = '<i class="fas fa-plus"></i><span></span>';
        add.title = '选择并裁剪';
        add.onclick = function () {
            if (window.RedpacketCrop && window.RedpacketCrop.start) {
                window.RedpacketCrop.start('topbarBackground', TopbarBgRatio);
            }
        };
        list.appendChild(add);

        var arr = getGallery();
        var active = getActive();
        arr.forEach(function (item, i) {
            var el = document.createElement('div');
            el.className = 'bg-item' + (active && active === item.value ? ' active' : '');
            el.innerHTML = '<img src="' + item.value + '" loading="lazy" alt="bg">';
            el.onclick = function () {
                applyTopbarBg(item.value);
                renderTopbarBgGallery();
                showNotification && showNotification('顶部栏背景已应用', 'success');
            };
            var del = document.createElement('div');
            del.className = 'bg-delete-btn';
            del.innerHTML = '<i class="fas fa-trash"></i>';
            del.title = '删除此背景';
            del.onclick = function (e) {
                e.stopPropagation();
                if (!confirm('确定删除这张背景图吗？')) return;
                arr.splice(i, 1);
                saveGallery(arr);
                if (active === item.value) { applyTopbarBg(''); }
                renderTopbarBgGallery();
            };
            el.appendChild(del);
            list.appendChild(el);
        });
    }

    function resetTopbarBg() {
        applyTopbarBg('');
        renderTopbarBgGallery();
        showNotification && showNotification('已恢复默认顶部栏背景', 'success');
    }

    // ── 拍立得：三层相纸，点击轮换展示顺序 ──
    // 三张照片分别有独立的上传位（下标 0/1/2 ↔ p1/p2/p3），
    // 未上传时显示默认灰底图；轮换只改变这三张的显示前后顺序。
    var _plOrder = [0, 1, 2];                    // 下标 0 = 最前（pl-1）
    var _plFronts = ['pl-1', 'pl-2', 'pl-3'];
    var POLAROID_DEFAULT = 'desktop-pl/default.jpg';   // 默认灰底图
    // 拍立得按梦角隔离：读写走 SESSION_ID 分桶 key（localforage 主存储 + localStorage 兼容镜像）。
    // 旧版固定 key（无分桶）的数据在首次运行时一次性迁入当前对象并删除旧键，避免升级后丢失、
    // 也避免切换对象时把别的梦角的照片带过来（对象切换后 reload，会按新对象分桶重新加载）。
    // 拍立得图片改走 IndexedDB（localforage），容量远大于 localStorage，
    // 避免设备 localStorage 配额被应急备份/背景图库占满后第 3 张静默存不上。
    // localStorage 镜像仅作兼容读取用，配额不足时自动忽略，不再静默阻断保存。
    var _plCache = ['', '', ''];
    // ── 每格多图库（体验同聊天背景图库）：每格可上传多张，勾选一张作为该格应用显示 ──
    var _plGal = [[], [], []];        // 每格：[{ id, value }] 全部已上传图
    var _plActive = ['', '', ''];     // 每格：当前勾选应用那张的 id（空=未设置该格）
    function plGalLfKey() {
        if (typeof getStorageKey === 'function' && typeof SESSION_ID !== 'undefined' && SESSION_ID) {
            try { return getStorageKey('POLAROID_GALLERY'); } catch (e) {}
        }
        return 'POLAROID_GALLERY';
    }
    function plGalLsKey() {
        if (typeof getStorageKey === 'function' && typeof SESSION_ID !== 'undefined' && SESSION_ID) {
            try { return getStorageKey('tiDesktopPlGallery'); } catch (e) {}
        }
        return 'tiDesktopPlGallery';
    }
    function persistPlGal() {
        var data = { g: _plGal, a: _plActive };
        if (typeof localforage !== 'undefined') {
            localforage.setItem(plGalLfKey(), data).catch(function (e) {
                console.warn('[Polaroid] 图库 IndexedDB 写入失败:', e);
            });
        }
        // 尽力镜像一份到 localStorage（兼容旧版本/外部读取；配额满时自动忽略）
        try { localStorage.setItem(plGalLsKey(), JSON.stringify(data)); } catch (e) {}
    }
    // 旧版每格单图值 → 迁入该格图库首张（并默认应用），保留用户旧数据
    function seedPlGalFromLegacy() {
        var changed = false;
        for (var i = 0; i < 3; i++) {
            if ((!_plGal[i] || !_plGal[i].length) && _plCache[i]) {
                _plGal[i] = [{ id: 'pl' + i + '_' + Date.now() + Math.floor(Math.random() * 1e6), value: _plCache[i] }];
                _plActive[i] = _plGal[i][0].id;
                changed = true;
            }
        }
        if (changed) persistPlGal();
    }
    // 未设置拍立得 / 图片缺失时，照片区显示的灰色占位图片
    var _plPlaceholder = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' +
        '<rect width="200" height="200" fill="#e6e2da"/>' +
        '</svg>'
    );
    // 分桶 key（localforage 主存储）
    function plLfKey(i) {
        if (typeof getStorageKey === 'function' && typeof SESSION_ID !== 'undefined' && SESSION_ID) {
            try { return getStorageKey('POLAROID_LF_' + (i + 1)); } catch (e) {}
        }
        return 'POLAROID_LF_' + (i + 1);
    }
    // 兼容镜像 key（localStorage）
    function plLsKey(i) {
        if (typeof getStorageKey === 'function' && typeof SESSION_ID !== 'undefined' && SESSION_ID) {
            try { return getStorageKey('tiDesktopPl' + (i + 1)); } catch (e) {}
        }
        return 'tiDesktopPl' + (i + 1);
    }
    // 旧版本全局 key（仅迁移用，读后删除防止串对象）
    function plLegacyLfKey(i) { return 'POLAROID_LF_' + (i + 1); }
    function plLegacyLsKey(i) { return 'tiDesktopPl' + (i + 1); }

    function getPl(i) {
        // 优先：该格图库中"勾选应用"的那一张（体验同聊天背景）
        var a = _plActive[i];
        var items = _plGal[i] || [];
        for (var k = 0; k < items.length; k++) {
            if (items[k].id === a) return items[k].value;
        }
        // 兜底：未设置 / 迁移期旧单图值
        return _plCache[i] || '';
    }
    function setPl(i, v) {
        v = v || '';
        _plCache[i] = v;                                     // 先同步更新内存缓存，界面立即生效
        if (typeof localforage !== 'undefined') {
            localforage.setItem(plLfKey(i), v).catch(function (e) {
                console.warn('[Polaroid] IndexedDB 写入失败:', e);
            });
        }
        // 尽力镜像一份到 localStorage（兼容旧版本/外部读取；配额满时自动忽略）
        try { localStorage.setItem(plLsKey(i), v || ''); } catch (e) {}
    }
    // 一次性迁移：当前对象某槽位为空时，把旧版全局 key 的数据迁入该对象分桶，迁完删除旧键。
    // 槽位已有值则跳过（当前对象已自定义，绝不拿旧对象覆盖）。
    function migrateLegacyPl(lfKeys, lsKeys) {
        var legacy = ['', '', ''];
        var legacyAny = false;
        for (var i = 0; i < 3; i++) {
            try { legacy[i] = localStorage.getItem(plLegacyLsKey(i)) || ''; } catch (e) {}
            if (legacy[i]) legacyAny = true;
        }
        if (!legacyAny) return Promise.resolve();
        var p = Promise.resolve();
        for (var j = 0; j < 3; j++) {
            (function (ii) {
                p = p.then(function () {
                    if (typeof localforage === 'undefined') return;
                    return localforage.getItem(plLegacyLfKey(ii)).then(function (lfv) {
                        if (lfv) { legacy[ii] = lfv; legacyAny = true; }
                    }).catch(function () {});
                });
            })(j);
        }
        return p.then(function () {
            if (!legacyAny) return;
            for (var k = 0; k < 3; k++) {
                if (!legacy[k] || _plCache[k]) continue;    // 槽位已有当前对象数据则不迁移
                _plCache[k] = legacy[k];
                if (typeof localforage !== 'undefined') {
                    localforage.setItem(lfKeys[k], legacy[k]).catch(function (e) {
                        console.warn('[Polaroid] 迁移写入失败:', e);
                    });
                }
                try { localStorage.setItem(lsKeys[k], legacy[k]); } catch (e) {}
                try { localStorage.removeItem(plLegacyLsKey(k)); } catch (e) {}
                if (typeof localforage !== 'undefined') {
                    localforage.removeItem(plLegacyLfKey(k)).catch(function () {});
                }
            }
        });
    }
    // 启动时把存量数据读入缓存：IndexedDB 为源，localStorage 兼容镜像兜底。
    // SESSION_ID 由 core.js 异步初始化，可能晚于 DOMContentLoaded；未就绪时稍后重试，
    // 避免用空 SESSION_ID 读/写旧共享 key 造成跨对象污染。
    function plLoadAll() {
        _plCache = ['', '', ''];
        _plGal = [[], [], []];
        _plActive = ['', '', ''];
        if (typeof SESSION_ID === 'undefined' || !SESSION_ID) {
            setTimeout(plLoadAll, 150);
            return;
        }
        var lfKeys = [plLfKey(0), plLfKey(1), plLfKey(2)];
        var lsKeys = [plLsKey(0), plLsKey(1), plLsKey(2)];
        // 读取每格多图库（IndexedDB 维护，localStorage 镜像兜底）
        var loadGallery = function (cb) {
            var apply = function (d) {
                if (d && Array.isArray(d.g)) {
                    for (var i = 0; i < 3; i++) {
                        if (Array.isArray(d.g[i])) _plGal[i] = d.g[i];
                        if (d.a && d.a[i]) _plActive[i] = d.a[i];
                    }
                }
                cb();
            };
            if (typeof localforage !== 'undefined') {
                localforage.getItem(plGalLfKey()).then(apply).catch(function () {
                    try { var raw = localStorage.getItem(plGalLsKey()); if (raw) apply(JSON.parse(raw)); else apply(null); } catch (e) { apply(null); }
                });
            } else {
                try { var raw = localStorage.getItem(plGalLsKey()); if (raw) apply(JSON.parse(raw)); else apply(null); } catch (e) { apply(null); }
            }
        };
        var done = function () {
            migrateLegacyPl(lfKeys, lsKeys).then(function () {
                seedPlGalFromLegacy();
                renderPolaroidGallery(); renderPolaroid();
            });
        };
        for (var i = 0; i < 3; i++) {
            try { var v = localStorage.getItem(lsKeys[i]); if (v) _plCache[i] = v; } catch (e) {}
        }
        if (typeof localforage !== 'undefined') {
            Promise.all(lfKeys.map(function (k) { return localforage.getItem(k); }))
                .then(function (vals) {
                    for (var j = 0; j < 3; j++) { if (vals[j] && _plCache[j] !== vals[j]) _plCache[j] = vals[j]; }
                    loadGallery(done);
                }).catch(function () { loadGallery(done); });
        } else {
            loadGallery(done);
        }
    }

    function renderPolaroid() {
        var cards = document.querySelectorAll('#dt-polaroid .dt-polaroid-card');
        if (!cards.length) return;
        for (var i = 0; i < cards.length; i++) {
            var img = cards[i].querySelector('img');
            if (img) {
                var idx = _plOrder[i];
                var custom = getPl(idx);
                var src = custom || POLAROID_DEFAULT;
                // 图片未变化时不再重设 src，避免每次点击都重新解码大图导致低端机卡顿
                if (img.getAttribute('src') !== src) {
                    img.onerror = function () {
                        // 图片缺失/未设置：展示灰底占位，且不再重复触发
                        this.onerror = null;
                        this.src = _plPlaceholder;
                    };
                    img.src = src;
                }
            }
            cards[i].className = 'dt-polaroid-card ' + _plFronts[i];
        }
    }
    var _plLockUntil = 0;   // 拍立得时间戳锁：锁窗口内完全丢弃重复点击，避免连点叠加动画/反复解码大图卡死
    function cyclePolaroid() {
        var c = $('dt-polaroid');
        var now = Date.now();
        if (!c || now < _plLockUntil) return;
        var lite = document.documentElement && document.documentElement.getAttribute('data-lite') === '1';
        // 锁窗口对齐/略宽于 flip 动画时长（transition .38s）；低配机动画期间也占合成器，锁窗略长
        _plLockUntil = now + (lite ? 650 : 500);
        _plOrder.unshift(_plOrder.pop());        // 最底层翻到最前，其余依次后移
        renderPolaroid();
        // 低配机(data-lite)跳过 flip 动画：只轮换内容，省去 transform 合成 + 轮换触发的图解码叠加，防连点卡死
        if (lite) return;
        c.classList.add('flip');
        setTimeout(function () { if (c) c.classList.remove('flip'); }, 450);
    }

    // ── 拍立得设置：三格，每格一个多图库（同类聊天背景，上传多张、勾选一张应用） ──
    var _plSlot = 0;   // 当前正在上传的拍立得位（0/1/2）
    var _plSlotTitles = ['最上层', '中间', '最底层'];
    var _plOrdinal = ['第一张', '第二张', '第三张'];
    function renderPolaroidGallery() {
        var list = $('polaroid-gallery-list');
        if (!list) return;
        list.className = 'pl-list';   // 外层：竖列，每格一个设置栏
        list.innerHTML = '';
        for (var i = 0; i < 3; i++) {
            var items = _plGal[i] || [];
            var activeId = _plActive[i];

            // 设置栏：标题 + 内嵌网格(排版完全同聊天背景图库 .bg-gallery/.bg-item)
            var slot = document.createElement('div');
            slot.className = 'pl-slot';

            var head = document.createElement('div');
            head.className = 'pl-slot-head';
            var name = document.createElement('span');
            name.className = 'pl-slot-name';
            name.textContent = _plOrdinal[i] + ' · ' + _plSlotTitles[i] + (activeId ? '' : '（未应用）');
            head.appendChild(name);
            if (items.length) {
                var reset = document.createElement('span');
                reset.className = 'pl-reset-btn';
                reset.innerHTML = '<i class="fas fa-undo-alt"></i><span>清空</span>';
                reset.title = '清空这一格的全部图片';
                reset.onclick = (function (slotIdx) {
                    return function () {
                        if (!confirm('确定清空这一格的全部拍立得图片吗？')) return;
                        _plGal[slotIdx] = [];
                        _plActive[slotIdx] = '';
                        setPl(slotIdx, '');
                        persistPlGal();
                        renderPolaroidGallery();
                        renderPolaroid();
                    };
                })(i);
                head.appendChild(reset);
            }
            slot.appendChild(head);

            // 内嵌网格：与聊天背景设置完全同款(.bg-gallery grid / .bg-item 圆格 / .bg-delete-btn)
            var gal = document.createElement('div');
            gal.className = 'bg-gallery';

            // 添加按钮：可继续往这一格里加上传的图（支持多张）
            var addBtn = document.createElement('div');
            addBtn.className = 'bg-item bg-add-btn';
            addBtn.innerHTML = '<i class="fas fa-plus"></i><span></span>';
            addBtn.title = '上传图片到' + _plOrdinal[i] + '（可多张）';
            addBtn.onclick = (function (slotIdx) { return function () { pickPolaroidFile(slotIdx); }; })(i);
            gal.appendChild(addBtn);

            // 已上传的多张：点击勾选应用，右上角可删除
            items.forEach(function (item, idx) {
                var cell = document.createElement('div');
                cell.className = 'bg-item' + (item.id === activeId ? ' active' : '');
                cell.innerHTML = '<img src="' + item.value + '" loading="lazy" alt="拍立得">';
                cell.title = '点击应用这一张';
                cell.onclick = (function (slotIdx, it) {
                    return function (e) {
                        if (e.target.closest('.bg-delete-btn')) return;
                        _plActive[slotIdx] = it.id;
                        setPl(slotIdx, it.value);
                        persistPlGal();
                        renderPolaroidGallery();
                        renderPolaroid();
                        showNotification && showNotification('已应用' + _plOrdinal[slotIdx], 'success');
                    };
                })(i, item);
                var del = document.createElement('div');
                del.className = 'bg-delete-btn';
                del.innerHTML = '<i class="fas fa-trash"></i>';
                del.style.cssText = 'opacity:1;transform:scale(1);'; // 手机无 hover，始终显示
                del.title = '删除这一张';
                del.onclick = (function (slotIdx, it, itemIdx) {
                    return function (e) {
                        e.stopPropagation();
                        if (!confirm('确定删除这一张拍立得吗？')) return;
                        _plGal[slotIdx].splice(itemIdx, 1);
                        if (_plActive[slotIdx] === it.id) {
                            // 删的是正在应用的那张：改用同格第一张（若无则清空）
                            _plActive[slotIdx] = _plGal[slotIdx].length ? _plGal[slotIdx][0].id : '';
                            setPl(slotIdx, _plActive[slotIdx] ? _plGal[slotIdx][0].value : '');
                        }
                        persistPlGal();
                        renderPolaroidGallery();
                        renderPolaroid();
                    };
                })(i, item, idx);
                cell.appendChild(del);
                gal.appendChild(cell);
            });

            slot.appendChild(gal);
            list.appendChild(slot);
        }
    }
    function pickPolaroidFile(slot) {
        if (!window.RedpacketCrop || typeof window.RedpacketCrop.start !== 'function') return;
        _plSlot = slot;
        // 依据拍立得相纸上照片显示区域的实际宽高比，规则与顶栏/桌面背景等自定义裁剪一致
        var ratio = 1;
        try {
            var img = document.querySelector('#dt-polaroid .dt-polaroid-card img');
            if (img && img.clientWidth && img.clientHeight) ratio = img.clientWidth / img.clientHeight;
        } catch (e) {}
        window.RedpacketCrop.start('polaroid', ratio);
    }
    function resetAllPolaroid() {
        setPl(0, ''); setPl(1, ''); setPl(2, '');
        _plGal = [[], [], []];
        _plActive = ['', '', ''];
        persistPlGal();
        renderPolaroidGallery();
        renderPolaroid();
        showNotification && showNotification('已恢复默认灰底图', 'success');
    }
    // 拍立得裁剪结果接收（与 DesktopBg/DesktopTopbar.accept 同规则）：作为新一图加入该格并应用
    window.Polaroid = {
        accept: function (dataURL) {
            if (!dataURL || dataURL.indexOf('data:') !== 0) return;
            var it = { id: 'pl' + _plSlot + '_' + Date.now() + Math.floor(Math.random() * 1e6), value: dataURL };
            if (!_plGal[_plSlot]) _plGal[_plSlot] = [];
            _plGal[_plSlot].push(it);
            _plActive[_plSlot] = it.id;
            setPl(_plSlot, dataURL);
            persistPlGal();
            renderPolaroidGallery();
            renderPolaroid();
            showNotification && showNotification('已添加并应用第 ' + (_plSlot + 1) + ' 张', 'success');
        },
        refresh: function () { renderPolaroidGallery(); renderPolaroid(); }
    };

    // ── 纪念日方块：收集所有重要日（相遇 + 各纪念日），点击循环切换 ──
    var _annEntries = [];
    var _annIndex = 0;
    // 渲染去抖：3s 轮询只在实际内容变化时才写 DOM，避免每 3s 无条件重建 innerHTML 造成持续卡顿。
    // 天数只在"跨天"时变化，同一会话内用 _annSig 记录已渲染内容，内容未变直接跳过全部 DOM 写入。
    var _annSig = '';

    function collectAnniversaries() {
        var arr = [];
        var meet = null;
        try { if (typeof window._annGetMeetData === 'function') meet = window._annGetMeetData(); } catch (e) {}
        if (meet) {
            var d = 0;
            if (meet.target) {
                var t = (meet.target instanceof Date) ? meet.target : new Date(meet.target);
                d = Math.max(0, Math.floor((Date.now() - t.getTime()) / 86400000));
            } else if (typeof meet.days === 'number') { d = meet.days; }
            arr.push({ name: meet.name || '相遇', days: d, verb: '已经 ' });
        }
        var list = (typeof anniversaries !== 'undefined' && Array.isArray(anniversaries))
            ? anniversaries : ((window.anniversaries && Array.isArray(window.anniversaries)) ? window.anniversaries : []);
        list.slice().sort(function (a, b) { return b.id - a.id; }).forEach(function (p) {
            var now = new Date(), t = new Date(p.date);
            var cd = p.type === 'countdown', valid = !isNaN(t.getTime());
            var d = valid ? (cd ? Math.max(0, Math.ceil((t - now) / 86400000))
                               : Math.max(0, Math.floor((now - t) / 86400000))) : 0;
            arr.push({
                name: (p.name && p.name.trim()) ? p.name : (cd ? '倒计时' : '纪念日'),
                days: d,
                verb: valid ? (cd ? '还有 ' : '已经 ') : ''
            });
        });
        return arr;
    }

    function renderAnniversary(force) {
        var dm = $('dt-ann-days'), meta = $('dt-ann-meta'), badge = $('dt-ann-badge');
        if (!dm) return;
        _annEntries = collectAnniversaries();
        if (_annIndex >= _annEntries.length) _annIndex = 0;
        if (!_annEntries.length) {
            var emptySig = '—|纪念日|';
            if (!force && _annSig === emptySig) return;   // 内容未变：跳过 DOM 写入
            _annSig = emptySig;
            dm.textContent = '—';
            if (meta) meta.textContent = '纪念日';
            if (badge) badge.textContent = '';
            return;
        }
        var e = _annEntries[_annIndex];
        var badgeTxt = _annEntries.length > 1 ? (_annIndex + 1) + '/' + _annEntries.length : '';
        var sig = e.days + '|' + e.verb + '|' + e.name + '|' + badgeTxt;
        if (!force && _annSig === sig) return;            // 内容未变：跳过全部 DOM 写入
        _annSig = sig;
        dm.textContent = e.days;
        // 「还有 X 天」与纪念日名字分成两排
        if (meta) {
            meta.innerHTML = '';
            var l1 = document.createElement('div');
            l1.className = 'dt-ann-days-text';
            l1.textContent = e.verb + e.days + ' 天';
            var l2 = document.createElement('div');
            l2.className = 'dt-ann-name';
            l2.textContent = e.name;
            meta.appendChild(l1);
            meta.appendChild(l2);
        }
        if (badge) badge.textContent = badgeTxt;
    }

    var _annLockUntil = 0; // 纪念日时间戳锁：锁窗口内丢弃重复点击，连点只切换一次，避免叠加重建/遍历卡死
    function cycleAnniversary() {
        if (_annEntries.length > 1 && Date.now() >= _annLockUntil) {
            _annLockUntil = Date.now() + 350;
            _annIndex = (_annIndex + 1) % _annEntries.length;
            renderAnniversary();
        }
    }

    // 裁剪确认回调（由 listeners.js 的裁剪弹窗 confirm 调用）
    window.DesktopTopbar = {
        accept: function (dataURL) {
            if (!dataURL || dataURL.indexOf('data:') !== 0) return;
            var arr = getGallery();
            arr.push({ id: 'user-' + Date.now(), value: dataURL, type: 'image', created: Date.now() });
            saveGallery(arr);
            applyTopbarBg(dataURL);
            renderTopbarBgGallery();
            showNotification && showNotification('顶部栏背景已更新', 'success');
        },
        refresh: function () {
            renderSignature(); syncTopbarUsers(); renderTopbarBgGallery();
            renderPolaroid(); renderAnniversary(); renderDesktopBgGallery();
        }
    };

    // ── 桌面背景：独立图库，样式跟随聊天背景，上传按固定框裁剪后应用到桌面页 ──
    var DKGALLERY_KEY = 'tiDesktopBgGallery';
    var DKACTIVE_KEY = 'tiDesktopBgActive';

    function getDkGallery() {
        try { return JSON.parse(dsGet(DKGALLERY_KEY)) || []; } catch (e) { return []; }
    }
    function saveDkGallery(arr) {
        dsSet(DKGALLERY_KEY, JSON.stringify(arr));
    }
    function getDkActive() { try { return dsGet(DKACTIVE_KEY) || ''; } catch (e) { return ''; } }

    function applyDesktopBg(value) {
        var pd = document.getElementById('phone-desktop');
        if (!pd) return;
        if (value && value.indexOf('data:') === 0) {
            document.documentElement.style.setProperty('--desktop-bg-image', 'url("' + value + '")');
        } else {
            document.documentElement.style.setProperty('--desktop-bg-image', '');
        }
        dsSet(DKACTIVE_KEY, value || '');
    }

    function renderDesktopBgGallery() {
        var list = document.getElementById('desktop-bg-gallery-list');
        if (!list) return;
        list.innerHTML = '';

        var add = document.createElement('div');
        add.className = 'bg-item bg-add-btn';
        add.innerHTML = '<i class="fas fa-plus"></i><span></span>';
        add.title = '选择并裁剪';
        add.onclick = function () {
            var ratio = window.innerWidth / Math.max(1, window.innerHeight);
            if (window.RedpacketCrop && window.RedpacketCrop.start) {
                window.RedpacketCrop.start('desktopBackground', ratio);
            }
        };
        list.appendChild(add);

        var arr = getDkGallery();
        var active = getDkActive();
        arr.forEach(function (item, i) {
            var el = document.createElement('div');
            el.className = 'bg-item' + (active && active === item.value ? ' active' : '');
            el.innerHTML = '<img src="' + item.value + '" loading="lazy" alt="bg">';
            el.onclick = function () {
                applyDesktopBg(item.value);
                renderDesktopBgGallery();
                showNotification && showNotification('桌面背景已应用', 'success');
            };
            var del = document.createElement('div');
            del.className = 'bg-delete-btn';
            del.innerHTML = '<i class="fas fa-trash"></i>';
            del.title = '删除此背景';
            del.onclick = function (e) {
                e.stopPropagation();
                if (!confirm('确定删除这张桌面背景吗？')) return;
                arr.splice(i, 1);
                saveDkGallery(arr);
                if (active === item.value) applyDesktopBg('');
                renderDesktopBgGallery();
            };
            el.appendChild(del);
            list.appendChild(el);
        });
    }

    function resetDesktopBg() {
        applyDesktopBg('');
        renderDesktopBgGallery();
        showNotification && showNotification('已恢复默认桌面背景', 'success');
    }

    window.DesktopBg = {
        accept: function (dataURL) {
            if (!dataURL || dataURL.indexOf('data:') !== 0) return;
            var arr = getDkGallery();
            arr.push({ id: 'user-' + Date.now(), value: dataURL, type: 'image', created: Date.now() });
            saveDkGallery(arr);
            applyDesktopBg(dataURL);
            renderDesktopBgGallery();
            showNotification && showNotification('桌面背景已更新', 'success');
        },
        refresh: function () { renderDesktopBgGallery(); }
    };

    // ── 桌面 / 聊天视图切换 ──
    // 启动默认进入桌面页，点击「聊天」才打开聊天页；聊天页头部「返回桌面」按钮回到桌面。
    window.DesktopTopbar.showDesktop = function () {
        if (typeof window._chatCancelOpen === 'function') window._chatCancelOpen(); // 取消未完成的聊天打开动画
        document.body.classList.add('dt-view');
    };
    window.DesktopTopbar.openChat = function () {
        document.body.classList.remove('dt-view');
        // 聊天页重新显示后渲染并滚动到最新消息
        setTimeout(function () {
            if (typeof window._backToLatestMessages === 'function') {
                try { window._backToLatestMessages(); } catch (e) {}
            }
        }, 150);
    };

    // ── 桌面第二页：链接状态 + 时间 ──
    // 内容与风格源（dunian）一致：链接状态 14 条文案随机切换（每 1~2 小时随机刷新，按梦角隔离），
    // TA 时间 = 本地时间 + 每日随机时差（-12~+12 小时，跨天重摇，按梦角隔离）。
    var LS_KEY = 'tiDesktopLinkStatus';
    var TO_KEY = 'tiDesktopTimeOffset';
    var LS_MIN = 60 * 60 * 1000;          // 链接状态最短间隔 1 小时
    var LS_MAX = 2 * 60 * 60 * 1000;      // 链接状态最长间隔 2 小时
    var linkStatusList = [
        { text: '灵魂共鸣', level: 5 },
        { text: '魂印相契', level: 5 },
        { text: '命定归栖', level: 5 },
        { text: '心律同频', level: 4 },
        { text: '命理相缠', level: 4 },
        { text: '星轨交叠', level: 4 },
        { text: '灵栖此处', level: 4 },
        { text: '命轨渐合', level: 3 },
        { text: '潮汐同流', level: 3 },
        { text: '风缕交织', level: 3 },
        { text: '心绪时隐', level: 2 },
        { text: '冥冥相引', level: 2 },
        { text: '昼夜错频', level: 1 },
        { text: '频段游离', level: 1 }
    ];
    var _lsTextEl = null, _lsHeartsEl = null;
    function renderLinkStatus(idx) {
        var item = linkStatusList[idx] || linkStatusList[0];
        if (!_lsTextEl) _lsTextEl = $('dt-ls-text');
        if (!_lsHeartsEl) _lsHeartsEl = document.getElementById('dt-ls-hearts');
        if (_lsTextEl) _lsTextEl.textContent = item.text;
        if (_lsHeartsEl) {
            var hs = _lsHeartsEl.querySelectorAll('i');
            for (var i = 0; i < hs.length; i++) {
                hs[i].classList.toggle('on', i < item.level);
                hs[i].classList.toggle('pulse', i < item.level && item.level <= 2);
            }
        }
    }
    function refreshLinkStatus(force) {
        var data = null;
        try { data = JSON.parse(dsGet(LS_KEY) || 'null'); } catch (e) {}
        var needRoll = !data || typeof data.idx !== 'number' || force ||
                       !data.next || Date.now() >= data.next;
        var idx;
        if (needRoll) {
            var prev = data ? data.idx : -1;
            do { idx = Math.floor(Math.random() * linkStatusList.length); }
            while (idx === prev && linkStatusList.length > 1);
            // 下次切换时间：1~2 小时之间随机
            data = { idx: idx, next: Date.now() + LS_MIN + Math.random() * (LS_MAX - LS_MIN) };
            if (dsSid()) dsSet(LS_KEY, JSON.stringify(data));
        } else {
            idx = data.idx;
        }
        renderLinkStatus(idx);
    }
    function getTimeOffset() {
        var today = new Date();
        var key = today.getFullYear() + '-' +
                  String(today.getMonth() + 1).padStart(2, '0') + '-' +
                  String(today.getDate()).padStart(2, '0');
        try {
            var saved = JSON.parse(dsGet(TO_KEY) || 'null');
            if (saved && saved.date === key && typeof saved.offset === 'number') return saved.offset;
        } catch (e) {}
        var off = Math.floor(Math.random() * 25) - 12;      // -12 ~ +12 小时
        off += Math.floor(Math.random() * 60) / 60;          // 加一点分钟偏移，更真实
        if (dsSid()) dsSet(TO_KEY, JSON.stringify({ date: key, offset: off }));
        return off;
    }
    function updateDesktopTimes() {
        var now = new Date();
        var myEl = $('dt-my-time'), roleEl = $('dt-role-time');
        var mm = String(now.getMinutes()).padStart(2, '0');
        if (myEl) myEl.textContent = String(now.getHours()).padStart(2, '0') + ':' + mm;
        var off = getTimeOffset();
        var rn = new Date(now.getTime() + off * 3600000);
        if (roleEl) roleEl.textContent = String(rn.getHours()).padStart(2, '0') +
                                         ':' + String(rn.getMinutes()).padStart(2, '0');
        // TA 标签跟随当前梦角昵称（未取到时兜底为"TA那边"）
        var who = $('dt-time-partner');
        if (who) {
            var pn = (typeof settings !== 'undefined' && settings && settings.partnerName) ? settings.partnerName : '';
            var label = pn ? pn + '那边' : 'TA那边';
            if (who.textContent !== label) who.textContent = label;
        }
        // 我这边标签跟随用户自己的昵称（未取到时兜底为"我这边"）
        var myWho = $('dt-time-me');
        if (myWho) {
            var myName = $('my-name');
            var mn = (myName && myName.textContent) ? myName.textContent.trim() : '';
            var myLabel = mn ? mn + '这边' : '我这边';
            if (myWho.textContent !== myLabel) myWho.textContent = myLabel;
        }
    }
    // 右侧状态栏：第一排 TA 的心情（跟随心情手账 moodData），第二排 TA 的状态（跟随每日公告）
    function renderP2Status() {
        var now = new Date();
        var todayStr = now.getFullYear() + '-' +
                       String(now.getMonth() + 1).padStart(2, '0') + '-' +
                       String(now.getDate()).padStart(2, '0');
        var pName = (typeof settings !== 'undefined' && settings && settings.partnerName) ? settings.partnerName : '梦角';
        // 标题「梦角 今日」跟随梦角昵称（保留图标，仅改文字）
        var stLabelEl = $('dt-st-label');
        if (stLabelEl) {
            var want = pName + ' 今日';
            var ln = stLabelEl.lastChild;
            if (!ln || ln.nodeType !== 3) {
                stLabelEl.appendChild(document.createTextNode(want));
            } else if (ln.textContent !== want) {
                ln.textContent = want;
            }
        }
        var moodEl = $('dt-st-mood');
        var statusEl = $('dt-st-status');

        // 心情：取心情手账中今天的 TA 记录（kaomoji + 标签），未记录则给兜底文案
        var moodText = pName + ' 今天还没有记录';
        try {
            var moodDataRaw = window.moodData || {};
            var todayMood = moodDataRaw[todayStr];
            var allMoods = (typeof getAllMoodOptions === 'function') ? getAllMoodOptions() : [];
            if (todayMood && todayMood.partner) {
                for (var mi = 0; mi < allMoods.length; mi++) {
                    if (allMoods[mi].key === todayMood.partner) {
                        moodText = allMoods[mi].kaomoji + '  ' + allMoods[mi].label;
                        break;
                    }
                }
            }
        } catch (e) {}
        if (moodEl && moodEl.textContent !== moodText) moodEl.textContent = moodText;

        // 状态：跟随每日公告（当天固定的随机状态，含用户自定义状态池）
        var statusText = '—';
        try {
            if (typeof _getDailyGreetingData === 'function') {
                var dg = _getDailyGreetingData();
                if (dg && dg.status) statusText = dg.status;
            }
        } catch (e) {}
        if (statusEl && statusEl.textContent !== statusText) statusEl.textContent = statusText;
    }

    // ── 初始化 ──
    var _dtInitDone = false;   // 一次性操作（事件绑定/兜底/轮询）只执行一次
    function init() {
        if (!_dtInitDone) {
            _dtInitDone = true;
            var sig = $('dt-signature');
            if (sig) sig.addEventListener('click', openSignature);

            var input = $('signature-input');
            if (input) input.addEventListener('input', function () {
                if (input.value.length > 20) input.value = input.value.slice(0, 20);
                updateSigCounter();
            });
            var save = $('signature-save');
            if (save) save.addEventListener('click', saveSignature);
            $('signature-input') && $('signature-input').addEventListener('keydown', function (e) {
                if (e.key === 'Enter') saveSignature();
            });

            var reset = $('reset-default-topbar-bg');
            if (reset) reset.addEventListener('click', resetTopbarBg);

            var dkReset = $('reset-desktop-bg');
            if (dkReset) dkReset.addEventListener('click', resetDesktopBg);

            var pl = $('dt-polaroid');
            if (pl) pl.addEventListener('click', cyclePolaroid);

            var plReset = $('reset-all-polaroid');
            if (plReset) plReset.addEventListener('click', resetAllPolaroid);

            var ann = $('dt-anniversary');
            if (ann) ann.addEventListener('click', cycleAnniversary);

            // 启动默认进入桌面页（隐藏聊天页主体），点击「聊天」图标后再打开聊天页
            document.body.classList.add('dt-view');

            // 兜底：若启动流程卡在加载动画（如外网资源失败导致引导未结束），
            // 超时后强制隐藏加载动画并进入桌面视图，避免白屏
            setTimeout(function () {
                var w = $('welcome-animation');
                if (w && !w.classList.contains('hidden')) {
                    w.classList.add('hidden');
                    setTimeout(function () { w.style.display = 'none'; }, 350);
                }
                document.body.classList.add('dt-view');
            }, 6000);

            // 头像/昵称等可能异步加载，周期性同步一次。
            // 所有设备统一降到 3s 一轮（1.5s 对异步加载同步来说过密，属明显可省的高频渲染）；
            // 低端机(data-lite)进一步降到 10s，减少持续渲染开销，避免与快速点击叠加后卡顿
            var dtLite = document.documentElement && document.documentElement.getAttribute('data-lite') === '1';
            setInterval(function () {
                syncTopbarUsers(); renderAnniversary();
                // 名称/昵称随存储异步加载，这里在每次同步时顺带刷新「TA那边/我这边/梦角今日」标签，
                // 避免首屏误显示静态默认值（此前仅 init 一次 + 30s 一次，加载晚于 settings 时就一直错直到重进页面）。
                updateDesktopTimes(); renderP2Status();
            }, dtLite ? 10000 : 3000);

            // 桌面第二页：时间每 30s 刷新（TA 时间基于每日时差），链接状态 1~2h 内自动切换，
            // 右侧状态栏跟随心情手账与每日公告（心情/公告变化后自动同步）
            setInterval(function () { updateDesktopTimes(); refreshLinkStatus(false); renderP2Status(); }, 30000);
        }

        // 桌面个性化渲染 + 旧数据迁移依赖 SESSION_ID 就绪（core.js 异步初始化，可能晚于
        // DOMContentLoaded）；未就绪时稍后重试，避免用空 SESSION_ID 读到共享旧 key 造成跨对象污染。
        if (!dsSid()) { setTimeout(init, 150); return; }
        dsMigrateLegacy();
        bindAvatarEdit();
        renderSignature();
        syncTopbarUsers();
        prefillDtAvatars();
        renderTopbarBgGallery();
        applyTopbarBg(getActive());
        renderDesktopBgGallery();
        applyDesktopBg(getDkActive());
        plLoadAll();
        renderPolaroid();
        renderPolaroidGallery();
        renderAnniversary();
        refreshLinkStatus(false);
        updateDesktopTimes();
        renderP2Status();
    }

    // ── 桌面双页滑动：横向滑动切换两张桌面页（底部图标栏固定，不随页面滑动）──
    function initDesktopPager() {
        var pager = document.getElementById('dt-pager');
        if (!pager) return;
        var track = pager.querySelector('.dt-pager-track');
        if (!track) return;
        var COUNT = 2;                 // 桌面页数量
        var TARGET = 100 / COUNT;      // 每滑一页，轨道位移 = TARGET%（=50%）
        var cur = 0;
        var width = 0, startX = 0, startY = 0, deltaX = 0;
        var moved = false, dragged = false;
        var lastSwipeAt = 0;

        // 底部小圆点指示器：放到图标栏(.app-grid)下面
        var dots = document.createElement('div');
        dots.className = 'dt-pager-dots';
        for (var i = 0; i < COUNT; i++) {
            var d = document.createElement('span');
            d.className = 'dt-pager-dot' + (i === 0 ? ' active' : '');
            dots.appendChild(d);
        }
        var appGrid = document.querySelector('.app-grid');
        if (appGrid && appGrid.parentNode) {
            appGrid.parentNode.insertBefore(dots, appGrid.nextSibling);
        } else {
            pager.appendChild(dots);
        }

        function baseOffset() { return -cur * TARGET; }
        function render(animate) {
            pager.classList.toggle('dragging', !animate);
            track.style.transform = 'translateX(' + baseOffset() + '%)';
            var ds = dots.children;
            for (var j = 0; j < ds.length; j++) ds[j].classList.toggle('active', j === cur);
        }
        function bound(v) {
            return Math.max(-(COUNT - 1) * TARGET, Math.min(0, v));
        }
        function start(x, y) {
            width = pager.getBoundingClientRect().width;
            if (width <= 0) width = pager.offsetWidth || window.innerWidth || 360;
            startX = x; startY = y; deltaX = 0;
            moved = false; dragged = false;
        }
        function move(x, y, prevent) {
            var dx = x - startX;
            var dy = y - startY;
            deltaX = dx;
            if (!moved) {
                // 越过水平阈值才判定为横向滑动，避免误抢页面内部纵向滚动
                if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) moved = true;
                else return false;
            }
            if (!dragged) { dragged = true; pager.classList.add('dragging'); }
            track.style.transform = 'translateX(' + bound(baseOffset() + (dx / width) * TARGET) + '%)';
            if (prevent) { try { prevent(); } catch (e) {} }
            return true;
        }
        function end() {
            pager.classList.remove('dragging');
            var w = width || 360;
            var threshold = w * 0.2;
            var next = cur;
            if (moved) {
                if (deltaX <= -threshold) next = Math.min(COUNT - 1, cur + 1);
                else if (deltaX >= threshold) next = Math.max(0, cur - 1);
            }
            if (next !== cur) { cur = next; lastSwipeAt = Date.now(); }
            render(true);
        }
        function suppressClick(e) {
            if (Date.now() - lastSwipeAt < 400) {
                e.preventDefault();
                e.stopPropagation();
                lastSwipeAt = 0;
            }
        }

        track.addEventListener('touchstart', function (e) {
            var t = e.touches[0]; start(t.clientX, t.clientY);
        }, { passive: true });
        track.addEventListener('touchmove', function (e) {
            var t = e.touches[0];
            move(t.clientX, t.clientY, function () { e.preventDefault(); });
        }, { passive: false });
        track.addEventListener('touchend', end, { passive: true });
        track.addEventListener('touchcancel', end, { passive: true });

        track.addEventListener('mousedown', function (e) { start(e.clientX, e.clientY); });
        document.addEventListener('mousemove', function (e) {
            move(e.clientX, e.clientY);
        });
        document.addEventListener('mouseup', end);

        pager.addEventListener('click', suppressClick, true);
        render(false);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDesktopPager);
    } else {
        initDesktopPager();
    }
})();