/* ── 桌面页（小手机桌面）：顶部栏 ──
   1. 个性签名：左上角，点击编辑，20 字内，持久化
   2. 两侧头像/昵称：跟随聊天中设置的头像和昵称
   3. 顶部栏背景：独立图库，上传按固定比例裁剪后应用到顶部栏 */
(function () {
    var SIG_KEY = 'tiDesktopSignature';
    var GALLERY_KEY = 'tiDesktopTopbarBgGallery';
    var ACTIVE_KEY = 'tiDesktopTopbarBgActive';
    var TopbarBgRatio = 3.0;   // 宽:高，对应图片中顶部栏的横条比例

    var $ = document.getElementById.bind(document);

    // ── 存储小工具 ──
    function getGallery() {
        try { return JSON.parse(localStorage.getItem(GALLERY_KEY)) || []; } catch (e) { return []; }
    }
    function saveGallery(arr) {
        try { localStorage.setItem(GALLERY_KEY, JSON.stringify(arr)); } catch (e) {}
    }
    function getActive() { try { return localStorage.getItem(ACTIVE_KEY) || ''; } catch (e) { return ''; } }

    // ── 个性签名 ──
    function renderSignature() {
        var el = $('dt-signature');
        if (!el) return;
        var sig = '';
        try { sig = localStorage.getItem(SIG_KEY) || ''; } catch (e) {}
        el.textContent = sig && sig.trim() ? sig : '两颗缠绕的心，会走同一条路';
    }

    function openSignature() {
        var modal = $('signature-modal');
        var input = $('signature-input');
        if (!modal || !input) return;
        try { input.value = localStorage.getItem(SIG_KEY) || ''; } catch (e) { input.value = ''; }
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
        try { localStorage.setItem(SIG_KEY, val); } catch (e) {}
        renderSignature();
        hideModal($('signature-modal'));
        showNotification && showNotification('个性签名已更新', 'success');
    }

    // ── 两侧头像 / 昵称跟随聊天设置 ──
    var _synced = false;
    // 缓存上一次写入的值，3s 轮询只在真正变化时才更新 DOM/重解码图片，
    // 避免 base64 头像每 3 秒被重新 innerHTML 注入造成持续卡顿
    var _lastAvP = '', _lastAvM = '', _lastNameP = '', _lastNameM = '';
    function syncTopbarUsers() {
        var srcP = $('partner-avatar'), dstP = $('dt-avatar-partner');
        var srcM = $('my-avatar'), dstM = $('dt-avatar-me');
        function fill(src, dst, lastRef) {
            if (!src || !dst) return lastRef;
            var img = src.querySelector('img');
            var srcVal = (img && img.src) ? img.src : '';
            if (srcVal === lastRef) return lastRef;   // 未变化：跳过，避免重复注入/解码
            if (img && img.src) {
                dst.innerHTML = '<img src="' + img.src + '">';
            } else {
                dst.innerHTML = '<i class="fas fa-user"></i>';
            }
            return srcVal;
        }
        _lastAvP = fill(srcP, dstP, _lastAvP);
        _lastAvM = fill(srcM, dstM, _lastAvM);
        _lastNameP = setName('partner-name', 'dt-name-partner', '梦角', _lastNameP);
        _lastNameM = setName('my-name', 'dt-name-me', '我', _lastNameM);
        _synced = true;
    }

    // ── 头像点击编辑（复用聊天页的头像编辑弹窗）──
    var _avatarListenersBound = false;
    function bindAvatarEdit() {
        if (_avatarListenersBound) return;
        var dstP = $('dt-avatar-partner'), dstM = $('dt-avatar-me');
        if (!dstP || !dstM) return;
        _avatarListenersBound = true;
        // 聊天页头像编辑弹窗尚未初始化时，等待可用
        var enable = function (el, isPartner) {
            el.style.cursor = 'pointer';
            el.addEventListener('click', function () {
                if (typeof window.openAvatarModal === 'function') {
                    window.openAvatarModal(isPartner);
                } else {
                    showNotification && showNotification('头像编辑暂不可用，请稍后重试', 'info');
                }
            });
        };
        enable(dstP, true);
        enable(dstM, false);
    }
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
        try { localStorage.setItem(ACTIVE_KEY, value || ''); } catch (e) {}
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
    var PL_KEYS = ['tiDesktopPl1', 'tiDesktopPl2', 'tiDesktopPl3'];
    // 拍立得图片改走 IndexedDB（localforage），容量远大于 localStorage，
    // 避免设备 localStorage 配额被应急备份/背景图库占满后第 3 张静默存不上。
    // localStorage(this PL_KEYS) 仅作兼容镜像，供旧版本读取，配额不足时自动忽略。
    var PL_LF_KEYS = ['POLAROID_LF_1', 'POLAROID_LF_2', 'POLAROID_LF_3'];
    var _plCache = ['', '', ''];
    // 未设置拍立得 / 图片缺失时，照片区显示的灰色占位图片
    var _plPlaceholder = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' +
        '<rect width="200" height="200" fill="#e6e2da"/>' +
        '</svg>'
    );
    function getPl(i) { return _plCache[i] || ''; }
    function setPl(i, v) {
        v = v || '';
        _plCache[i] = v;                                     // 先同步更新内存缓存，界面立即生效
        if (typeof localforage !== 'undefined') {
            localforage.setItem(PL_LF_KEYS[i], v).catch(function (e) {
                console.warn('[Polaroid] IndexedDB 写入失败:', e);
            });
        }
        // 尽力镜像一份到 localStorage（兼容旧版本/外部读取；配额满时自动忽略，不再静默阻断保存）
        try { localStorage.setItem(PL_KEYS[i], v || ''); } catch (e) {}
    }
    // 启动时把存量数据读入缓存：IndexedDB 为源，localStorage 兼容镜像兜底（老版本迁移）
    function plLoadAll() {
        _plCache = ['', '', ''];
        for (var i = 0; i < 3; i++) {
            try { var v = localStorage.getItem(PL_KEYS[i]); if (v) _plCache[i] = v; } catch (e) {}
        }
        if (typeof localforage !== 'undefined') {
            Promise.all([PL_LF_KEYS[0], PL_LF_KEYS[1], PL_LF_KEYS[2]].map(function (k) {
                return localforage.getItem(k);
            })).then(function (vals) {
                var changed = false;
                for (var j = 0; j < 3; j++) {
                    if (vals[j] && _plCache[j] !== vals[j]) { changed = true; _plCache[j] = vals[j]; }
                }
                if (changed) { renderPolaroidGallery(); renderPolaroid(); }
            }).catch(function () {});
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

    // ── 拍立得设置：三张照片分别上传（排版参考聊天背景） ──
    var _plSlot = 0;   // 当前正在上传的拍立得位（0/1/2）
    function renderPolaroidGallery() {
        for (var i = 0; i < 3; i++) {
            var list = $('polaroid-gallery-' + (i + 1));
            if (!list) continue;
            list.innerHTML = '';
            var v = getPl(i);
            var tile = document.createElement('div');
            tile.className = 'bg-item' + (v ? '' : '');
            var img = document.createElement('img');
            img.src = v || POLAROID_DEFAULT;
            img.loading = 'lazy';
            img.alt = '拍立得';
            tile.appendChild(img);
            tile.title = v ? '点击更换第 ' + (i + 1) + ' 张照片' : '点击设置第 ' + (i + 1) + ' 张照片（当前为默认灰底图）';
            tile.onclick = (function (slot) {
                return function () { pickPolaroidFile(slot); };
            })(i);
            if (v) {
                var del = document.createElement('div');
                del.className = 'bg-delete-btn';
                del.innerHTML = '<i class="fas fa-trash"></i>';
                del.title = '恢复默认灰底图';
                del.onclick = (function (slot) {
                    return function () {
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
        try { return JSON.parse(localStorage.getItem(DKGALLERY_KEY)) || []; } catch (e) { return []; }
    }
    function saveDkGallery(arr) {
        try { localStorage.setItem(DKGALLERY_KEY, JSON.stringify(arr)); } catch (e) {}
    }
    function getDkActive() { try { return localStorage.getItem(DKACTIVE_KEY) || ''; } catch (e) { return ''; } }

    function applyDesktopBg(value) {
        var pd = document.getElementById('phone-desktop');
        if (!pd) return;
        if (value && value.indexOf('data:') === 0) {
            document.documentElement.style.setProperty('--desktop-bg-image', 'url("' + value + '")');
        } else {
            document.documentElement.style.setProperty('--desktop-bg-image', '');
        }
        try { localStorage.setItem(DKACTIVE_KEY, value || ''); } catch (e) {}
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
    function init() {
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

        renderSignature();
        syncTopbarUsers();
        bindAvatarEdit();
        renderTopbarBgGallery();
        applyTopbarBg(getActive());
        renderDesktopBgGallery();
        applyDesktopBg(getDkActive());
        plLoadAll();
        renderPolaroid();
        renderPolaroidGallery();
        renderAnniversary();

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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();