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
        el.textContent = sig && sig.trim() ? sig : '爱能克服远距离';
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
    function syncTopbarUsers() {
        var srcP = $('partner-avatar'), dstP = $('dt-avatar-partner');
        var srcM = $('my-avatar'), dstM = $('dt-avatar-me');
        function fill(src, dst) {
            if (!src || !dst) return;
            var img = src.querySelector('img');
            if (img && img.src && img.src.indexOf('data:') === 0) {
                dst.innerHTML = '<img src="' + img.src + '">';
            } else if (img && img.src) {
                dst.innerHTML = '<img src="' + img.src + '">';
            } else {
                dst.innerHTML = '<i class="fas fa-user"></i>';
            }
        }
        fill(srcP, dstP); fill(srcM, dstM);
        setName('partner-name', 'dt-name-partner', '梦角');
        setName('my-name', 'dt-name-me', '我');
        _synced = true;
    }
    function setName(srcId, dstId, fallback) {
        var src = $(srcId), dst = $(dstId);
        if (!src || !dst) return;
        var v = src.textContent.trim();
        dst.textContent = v || fallback;
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
    var _plOrder = ['p1.jpg', 'p2.jpg', 'p3.jpg'];   // 下标 0 = 最前（pl-1）
    var _plFronts = ['pl-1', 'pl-2', 'pl-3'];
    function renderPolaroid() {
        var cards = document.querySelectorAll('#dt-polaroid .dt-polaroid-card');
        if (!cards.length) return;
        for (var i = 0; i < cards.length; i++) {
            var img = cards[i].querySelector('img');
            if (img) img.src = 'desktop-pl/' + _plOrder[i];
            cards[i].className = 'dt-polaroid-card ' + _plFronts[i];
        }
    }
    function cyclePolaroid() {
        var c = $('dt-polaroid');
        if (!c) return;
        _plOrder.unshift(_plOrder.pop());        // 最底层翻到最前，其余依次后移
        renderPolaroid();
        c.classList.add('flip');
        setTimeout(function () { c.classList.remove('flip'); }, 420);
    }

    // ── 纪念日方块：收集所有重要日（相遇 + 各纪念日），点击循环切换 ──
    var _annEntries = [];
    var _annIndex = 0;

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

    function renderAnniversary() {
        var dm = $('dt-ann-days'), meta = $('dt-ann-meta'), badge = $('dt-ann-badge');
        if (!dm) return;
        _annEntries = collectAnniversaries();
        if (_annIndex >= _annEntries.length) _annIndex = 0;
        if (!_annEntries.length) {
            dm.textContent = '—';
            if (meta) meta.textContent = '纪念日';
            if (badge) badge.textContent = '';
            return;
        }
        var e = _annEntries[_annIndex];
        dm.textContent = e.days;
        if (meta) meta.textContent = e.verb + e.days + ' 天 · ' + e.name;
        if (badge) badge.textContent = _annEntries.length > 1 ? (_annIndex + 1) + '/' + _annEntries.length : '';
    }

    function cycleAnniversary() {
        if (_annEntries.length > 1) {
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
            renderPolaroid(); renderAnniversary();
        }
    };

    // ── 桌面 / 聊天视图切换 ──
    // 启动默认进入桌面页，点击「聊天」才打开聊天页；聊天页头部「返回桌面」按钮回到桌面。
    window.DesktopTopbar.showDesktop = function () {
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

        var pl = $('dt-polaroid');
        if (pl) pl.addEventListener('click', cyclePolaroid);
        var ann = $('dt-anniversary');
        if (ann) ann.addEventListener('click', cycleAnniversary);

        renderSignature();
        syncTopbarUsers();
        renderTopbarBgGallery();
        applyTopbarBg(getActive());
        renderPolaroid();
        renderAnniversary();

        // 启动默认进入桌面页。不在 init 时提前强制切换（避免与开场动画时序竞争），
        // 而是由 app.js 在开场动画结束时切到桌面视图（见 app.js 隐藏开场动画处）。
        // 兜底：若启动流程卡在加载动画（如外网资源失败导致引导未结束），
        // 超时后强制隐藏加载动画并进入桌面视图，避免卡在白屏。
        setTimeout(function () {
            var w = $('welcome-animation');
            if (w && !w.classList.contains('hidden')) {
                w.classList.add('hidden');
                setTimeout(function () { w.style.display = 'none'; }, 350);
            }
            document.body.classList.add('dt-view');
        }, 6000);

        // 头像/昵称等可能异步加载，周期性同步一次
        setInterval(function () { syncTopbarUsers(); renderAnniversary(); }, 1500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();