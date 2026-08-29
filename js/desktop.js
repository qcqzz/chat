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
    function getDtAvatar(key) {
        try { return dsGet(key) || ''; } catch (e) { return ''; }
    }
    function renderDesktopAvatars() {
        function render(id, key) {
            var el = $(id); if (!el) return;
            var v = getDtAvatar(key);
            el.innerHTML = v ? '<img src="' + v + '">' : '<i class="fas fa-user"></i>';
        }
        render('dt-avatar-partner', DTAV_P_KEY);
        render('dt-avatar-me', DTAV_M_KEY);
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
            dsRemove(getDtAvKey(_dtAvTarget));
            renderDesktopAvatars();
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
            dsSet(getDtAvKey(_dtAvTarget), _dtAvCurrent);
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

    function getPl(i) { return _plCache[i] || ''; }
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
        if (typeof SESSION_ID === 'undefined' || !SESSION_ID) {
            setTimeout(plLoadAll, 150);
            return;
        }
        var lfKeys = [plLfKey(0), plLfKey(1), plLfKey(2)];
        var lsKeys = [plLsKey(0), plLsKey(1), plLsKey(2)];
        var done = function () {
            migrateLegacyPl(lfKeys, lsKeys).then(function () {
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
                    done();
                }).catch(done);
        } else {
            done();
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

    // ── 拍立得设置：三个固定位，网格图库排版（样式同聊天背景图库） ──
    var _plSlot = 0;   // 当前正在上传的拍立得位（0/1/2）
    var _plSlotTitles = ['最上层', '中间', '最底层'];
    function renderPolaroidGallery() {
        var list = $('polaroid-gallery-list');
        if (!list) return;
        list.innerHTML = '';
        for (var i = 0; i < 3; i++) {
            var v = getPl(i);
            var tile = document.createElement('div');
            tile.className = 'bg-item';
            var img = document.createElement('img');
            img.src = v || POLAROID_DEFAULT;
            img.loading = 'lazy';
            img.alt = '拍立得';
            tile.appendChild(img);

            // 槽位角标：标注第几张/层级
            var badge = document.createElement('div');
            badge.className = 'pl-slot-badge';
            badge.textContent = String(i + 1) + ' · ' + _plSlotTitles[i];
            tile.appendChild(badge);

            tile.title = v
                ? '点击更换第 ' + (i + 1) + ' 张（' + _plSlotTitles[i] + '）'
                : '点击设置第 ' + (i + 1) + ' 张（' + _plSlotTitles[i] + '，当前为默认灰底图）';
            tile.onclick = (function (slot) {
                return function () { pickPolaroidFile(slot); };
            })(i);
            if (v) {
                var del = document.createElement('div');
                del.className = 'bg-delete-btn';
                del.innerHTML = '<i class="fas fa-trash"></i>';
                del.title = '恢复默认灰底图';
                del.onclick = (function (slot) {
                    return function (e) {
                        e.stopPropagation();
                        if (!confirm('确定将这张拍立得恢复为默认灰底图吗？')) return;
                        setPl(slot, '');
                        renderPolaroidGallery();
                        renderPolaroid();
                    };
                })(i);
                tile.appendChild(del);
            }
            list.appendChild(tile);
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
        renderPolaroidGallery();
        renderPolaroid();
        showNotification && showNotification('已恢复默认灰底图', 'success');
    }
    // 拍立得裁剪结果接收（与 DesktopBg/DesktopTopbar.accept 同规则）
    window.Polaroid = {
        accept: function (dataURL) {
            if (!dataURL || dataURL.indexOf('data:') !== 0) return;
            setPl(_plSlot, dataURL);
            renderPolaroidGallery();
            renderPolaroid();
            showNotification && showNotification('拍立得第 ' + (_plSlot + 1) + ' 张已更新', 'success');
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
            setInterval(function () { syncTopbarUsers(); renderAnniversary(); }, dtLite ? 10000 : 3000);
        }

        // 桌面个性化渲染 + 旧数据迁移依赖 SESSION_ID 就绪（core.js 异步初始化，可能晚于
        // DOMContentLoaded）；未就绪时稍后重试，避免用空 SESSION_ID 读到共享旧 key 造成跨对象污染。
        if (!dsSid()) { setTimeout(init, 150); return; }
        dsMigrateLegacy();
        bindAvatarEdit();
        renderSignature();
        syncTopbarUsers();
        renderTopbarBgGallery();
        applyTopbarBg(getActive());
        renderDesktopBgGallery();
        applyDesktopBg(getDkActive());
        plLoadAll();
        renderPolaroid();
        renderPolaroidGallery();
        renderAnniversary();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();