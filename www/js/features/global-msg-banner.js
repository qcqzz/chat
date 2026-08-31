/**
 * global-msg-banner.js — 全局新消息推送横条（微信风格）
 *
 * 借鉴自 channel-ing/chat 仓库，移植到当前项目。
 *
 * 需求：梦角在主聊天发新消息时，只要用户不在下面这几种情况里，就在当前页面顶部弹一条横条：
 *   1）用户当前就在主聊天本身（消息本来就实时显示在眼前，不需要再弹）
 *   2）陪伴模式（陪伴页里本来就会同步显示气泡）
 *   3）电影院沉浸模式（全屏剧场，本来就在这个聊天场景里）
 * 反过来，下面这些"盖在主聊天上面的弹窗"要弹（弹窗盖住了聊天，用户看不到新消息）：
 *   设置弹窗、信箱弹窗、情侣空间设置弹窗、还没进陪伴页之前的陪伴邀请弹窗……等等，
 *   不一一列举，走的是"当前有没有弹窗盖在上面"这个通用判断。
 * 点一下横条：把当前挡着的弹窗/情侣空间都关掉，跳回主聊天并滚动到最新消息。
 *
 * 挂载方式：走 core.js 里已有的 window._registerPartnerMessageListener 钩子——
 * 这个钩子只对"梦角发的普通文字消息"触发（message.type === 'normal'），
 * 图片/语音等类型的梦角消息目前不会经过这个钩子，横条也就不会为那些类型弹出，
 * 这是钩子本身的既有范围，不在这个文件里改动。
 */
(function () {
    'use strict';

    var _banner = null;
    var _hideTimer = null;

    function _ensureBanner() {
        if (_banner) return _banner;
        _banner = document.createElement('div');
        _banner.className = 'gmb-banner';
        _banner.id = 'gmb-banner';
        _banner.innerHTML =
            '<div class="gmb-avatar" id="gmb-avatar"></div>' +
            '<div class="gmb-body">' +
                '<div class="gmb-name" id="gmb-name"></div>' +
                '<div class="gmb-text" id="gmb-text"></div>' +
            '</div>';
        document.body.appendChild(_banner);
        _banner.addEventListener('click', _onTap);
        return _banner;
    }

    // 弹窗大多用 .modal 这个通用类（设置、信箱、情侣空间设置……），显示时 display 不是 none。
    // 陪伴邀请弹窗是个例外——它是动态创建的 #companion-modal-dynamic，故意没用 .modal 类
    // （companion.js 里有注释写了是为了不被原来的 hideModal 干扰），这里单独认一下这个 id。
    function _isAnyModalOpen() {
        var dyn = document.getElementById('companion-modal-dynamic');
        if (dyn && getComputedStyle(dyn).display !== 'none') return true;
        var modals = document.querySelectorAll('.modal');
        for (var i = 0; i < modals.length; i++) {
            if (getComputedStyle(modals[i]).display !== 'none') return true;
        }
        return false;
    }

    // 判断要不要弹：陪伴模式/电影院沉浸模式不弹；有弹窗盖在上面（不管是不是在情侣空间里点出来的）要弹；
    // 情侣空间开着（非沉浸模式）要弹；剩下的（主聊天本身可见、什么弹窗都没开）不弹。
    function _shouldShow() {
        var companionPage = document.getElementById('companion-page');
        if (companionPage && companionPage.classList.contains('active')) return false;

        // 电影院沉浸模式：当前项目电影院容器是 #entertainment-page（channel-ing 里是 #couple-space-page）
        var entPage = document.getElementById('entertainment-page');
        if (entPage && entPage.classList.contains('cinema-theater-mode')) return false;

        if (_isAnyModalOpen()) return true;
        var csPage = document.getElementById('couple-space-page');
        if (csPage && csPage.classList.contains('cs-open')) return true;
        // 电影院页面开着（非沉浸模式）也要弹，跟情侣空间开着一个道理
        if (entPage && entPage.classList.contains('cs-open')) return true;
        return false;
    }

    function _previewText(msg) {
        var t = (msg && msg.text) ? String(msg.text).replace(/\n/g, ' ').trim() : '';
        if (!t) return (msg && msg.image) ? '[图片]' : '';
        return t.length > 24 ? t.slice(0, 24) + '…' : t;
    }

    function _hide() {
        if (_banner) _banner.classList.remove('gmb-show');
    }

    // 显示出来的那一刻才开始计 4 秒，到期自动收起（微信/系统弹窗式行为）。
    // 每次新消息都会重置计时，保证横条只在上一条消息后停留一小段时间。
    function _armHide() {
        clearTimeout(_hideTimer);
        _hideTimer = setTimeout(_hide, 4000);
    }

    // 点一下横条：不管当前是弹窗、还是情侣空间、还是两者都有（比如情侣空间设置弹窗），
    // 一律强制关掉，跳回主聊天。弹窗直接关，不走各自的取消/保存逻辑——用户点的是"跳转"，
    // 等于主动放弃当前正在填的东西，跟点了弹窗外面把它关掉是一个意思。
    function _closeAllOverlays() {
        var dyn = document.getElementById('companion-modal-dynamic');
        if (dyn) dyn.remove(); // 这个本来就是"用完就 remove"的动态节点，不是简单隐藏

        document.querySelectorAll('.modal').forEach(function (m) {
            if (getComputedStyle(m).display !== 'none') {
                if (typeof window.hideModal === 'function') window.hideModal(m);
                else m.style.display = 'none';
            }
        });

        if (typeof window.closeCoupleSpace === 'function') window.closeCoupleSpace();

        // 当前项目电影院是独立页面（#entertainment-page），开着（非沉浸模式）时也一并关掉
        var entPage = document.getElementById('entertainment-page');
        if (entPage && entPage.classList.contains('cs-open') && typeof window.closeEntertainment === 'function') {
            window.closeEntertainment();
        }
    }

    function _onTap() {
        clearTimeout(_hideTimer);
        _hide();
        _closeAllOverlays();
        // closeCoupleSpace 内部关闭动画是 380ms，等它跑完再回到底部，避免动画进行中跳转看起来很突兀
        setTimeout(function () {
            if (typeof window._backToLatestMessages === 'function') window._backToLatestMessages();
        }, 400);
    }

    function _show(msg) {
        var banner = _ensureBanner();
        var partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '对方';
        banner.querySelector('#gmb-name').textContent = partnerName;
        banner.querySelector('#gmb-text').textContent = _previewText(msg);

        var avatarEl = banner.querySelector('#gmb-avatar');
        var srcImg = document.querySelector('#partner-avatar img');
        avatarEl.innerHTML = (srcImg && srcImg.src)
            ? '<img src="' + srcImg.src + '">'
            : '<i class="fas fa-user"></i>';

        clearTimeout(_hideTimer);
        // 先摘掉再加回去，保证连续收到好几条消息时，每次都能重新触发一次入场动画，不会因为已经是
        // active 状态而"静默换内容"，用户很容易漏看
        banner.classList.remove('gmb-show');
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                banner.classList.add('gmb-show');
                // 动画完全显示后才开始计 4 秒。不能在动画请求发出前就启动定时器：
                // 页面处于背景时 requestAnimationFrame 回调会被挂起，横条真正显示出来时
                // 定时器早已触发，导致横条永远收不回去。
                _armHide();
            });
        });
    }

    if (typeof window._registerPartnerMessageListener === 'function') {
        window._registerPartnerMessageListener(function (msg) {
            if (!msg || msg.sender === 'user') return;
            if (!_shouldShow()) return;
            _show(msg);
        });
    } else {
        console.warn('[global-msg-banner] window._registerPartnerMessageListener 不存在，新消息横条功能不会生效（core.js 是否正常加载？）');
    }
})();
