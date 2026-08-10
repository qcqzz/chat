/**
 * cinema.js — 电影院功能 Step 1 v5
 *
 * 本轮改动（在 v4 基础上）：
 * 12. "返回"改回：只退出沉浸模式，回到嵌入式观影视图（图2那种：外层头像条 +
 *     电影院header都还在，视频框大小位置跟 waiting/empty 一致），不再直接结束观影/离开情侣空间
 *     — 点嵌入视图里的视频框可以重新进沉浸模式
 * 13. 表情面板改用独立类名（不复用主聊天 .sticker-picker-popover 等一堆全局样式，
 *     之前因为规则冲突导致格子巨大），改成贴近"我的表情库"管理页那种小格子紧凑网格；
 *     数据源从 stickerLibrary 换成 myStickerLibrary（用户自己的表情库，不是梦角的）
 * 14. waiting 卡片徽标文案"约定待履行"→"待观影"
 * 15. 加载过渡改为全屏进度条样式（纯黑背景+图标+进度条+文案，无header）
 * 16. 聊天消息气泡加头像：自己的消息头像在右，梦角消息头像在左，
 *     复用 moments.js 里现成的 _avEl() 头像解析逻辑（跟主聊天头像来源一致）
 *
 * 历史（v4）：
 * 8. 选完片 → 先过一个假的"电影加载中"过渡，再进播放页
 * 9. 观影模式新增沉浸式头部：返回 / 观影中 / 设置(占位)
 * 10. 观影模式强制暗色主题（CSS 变量局部覆盖）
 *
 * 历史（v3）：
 * 1. 未在播放时（empty / waiting）隐藏底部输入栏，只在 watching 状态显示
 * 2. header 文字/icon 对齐纪念日/心情手账
 * 3. waiting 状态：黑框在上、信息卡在下；未到时间前禁用+倒计时；
 *    选完文件才跳转，且不自动播放
 * 4. empty 状态：邀请按钮移到黑框下面
 * 5. watching 状态：黑框样式与 empty/waiting 保持一致
 * 6. 结束观影 → 二次确认
 * 7. 输入栏表情/图片：不侵入主聊天的 #user-sticker-picker / #image-input
 */
(function () {
    'use strict';

    var _uiState = 'empty'; // 'empty' | 'waiting' | 'watching'

    // watching 状态下：true=沉浸全屏剧场模式，false=嵌入普通电影院tab视图
    var _immersive = true;

    var _fakeAppt = {
        movieTitle: '',
        dateStr: '',
        timeStr: ''
    };

    // 观影中：当前视频信息（从 waiting 跳转过来时写入）
    var _currentVideo = { src: '', title: '', type: 'video' }; // type: 'video' | 'bilibili'

    // 观影开始时间（纯内存，不用持久化——'watching' 状态本身刷新就会退回 waiting，
    // 见下面 _apptLoad 里的说明，所以这个计时器只在同一次会话里有意义）
    var _watchStartedAt = null;
    var _watchAutoEndTimer = null;

    // 开场前 2 分钟提醒（弹黑色蒙层），只在 waiting 状态下有意义
    var _showtimeReminderTimer = null;

    // ── 约定状态持久化：_uiState + _fakeAppt ──────────────
    // 之前这两个是纯内存变量，刷新/重进页面就丢，导致约好了时间也会
    // 打回"待邀请"。现在跟待看清单/观看历史一样存到 localforage。
    // 注意：'watching' 不落盘 —— 播放的视频是本地文件对象(createObjectURL)，
    // 刷新后浏览器拿不到这个文件了没法自动续播，所以观影中被刷新/重进时
    // 退回到 'waiting'（约定还在，只是要重新选一次片），而不是清空到 'empty'。
    var _apptLoaded = false;
    var _apptStorageKey = null;
    // ── App 数据加载完成标志（防止开机时 _negoResolveReply 与 loadData 产生竞态）──
    // 场景：iOS Safari 将后台 tab 杀掉 → 用户返回时页面重载
    // → _negoBootCheck(setTimeout 0) 可能在 loadData 完成前触发
    // → addMessage 把卡片写入空的 messages[] → loadData 覆盖 messages → 卡片消失
    // 解决方案：钩住 window.renderMessages（loadData 完成后必然调用），
    //          以它的首次触发作为「数据已就绪」信号，再延迟触发 _negoResolveReply。
    var _appDataLoaded = false;
    var _pendingBootResolve = false;
    async function _apptGetKey() {
        if (_apptStorageKey) return _apptStorageKey;
        try {
            var allKeys = await localforage.keys();
            var found = allKeys.find(function (k) { return k.indexOf('_cinemaAppt') !== -1; });
            if (found) { _apptStorageKey = found; return found; }
            var msgKey = allKeys.find(function (k) { return k.indexOf('chatMessages') !== -1; });
            var prefix = msgKey ? msgKey.replace('chatMessages', '') : 'CHAT_APP_V3_';
            _apptStorageKey = prefix + '_cinemaAppt';
        } catch (e) {
            _apptStorageKey = 'CHAT_APP_V3__cinemaAppt';
        }
        return _apptStorageKey;
    }
    async function _apptLoad() {
        if (_apptLoaded) return;
        _apptLoaded = true;
        try {
            var key = await _apptGetKey();
            var saved = await localforage.getItem(key);
            if (saved && typeof saved === 'object') {
                if (saved.fakeAppt) _fakeAppt = saved.fakeAppt;
                if (saved.uiState === 'waiting' || saved.uiState === 'watching') {
                    _uiState = 'waiting'; // watching 也统一落回 waiting，见上面注释
                }
            }
        } catch (e) { console.warn('[cinema] 约定状态加载失败:', e); }
    }
    async function _apptSave() {
        try {
            var key = await _apptGetKey();
            var stateToSave = (_uiState === 'watching') ? 'waiting' : _uiState;
            await localforage.setItem(key, { uiState: stateToSave, fakeAppt: _fakeAppt });
        } catch (e) { console.warn('[cinema] 约定状态保存失败:', e); }
    }

    // ── 邀请弹层：让用户填片名 + 日期 + 时间来发起邀请 ──────
    // 目前还没做梦角同意/拒绝的系统，所以点"确定邀请"就直接当作梦角同意了，
    // 直接进入 waiting（约定生效）
    function _openInviteSheet() {
        var old = document.getElementById('cinema-invite-sheet');
        if (old) old.remove();
        var now = new Date();
        var defaultDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        var later = new Date(now.getTime() + 3600000);
        var defaultTime = String(later.getHours()).padStart(2, '0') + ':' + String(later.getMinutes()).padStart(2, '0');
        var minDate = defaultDate; // 日期选择器不能选比今天更早的日期

        var partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '梦角';
        var sheet = document.createElement('div');
        sheet.id = 'cinema-invite-sheet';
        sheet.className = 'cinema-invite-sheet';
        sheet.innerHTML =
            '<div class="cinema-invite-mask" id="cinema-invite-mask"></div>' +
            '<div class="cinema-invite-body">' +
                '<div class="cinema-invite-title">邀请' + _escapeHtml(partnerName) + '一起观影</div>' +
                '<div class="cinema-invite-label">片名</div>' +
                '<input type="text" class="cinema-invite-input" id="cinema-invite-movie" maxlength="40" placeholder="想看什么电影？">' +
                '<div class="cinema-invite-label">日期</div>' +
                '<input type="date" class="cinema-invite-input" id="cinema-invite-date" min="' + minDate + '" value="' + defaultDate + '">' +
                '<div class="cinema-invite-label">时间</div>' +
                '<input type="time" class="cinema-invite-input" id="cinema-invite-time" value="' + defaultTime + '">' +
                '<div class="cinema-invite-error" id="cinema-invite-error"></div>' +
                '<div class="cinema-invite-hint">发出后' + _escapeHtml(partnerName) + '会在主聊天回复你，可能会提议换个时间～</div>' +
                '<button type="button" class="cinema-test-source-link" id="cinema-invite-test-source">先测试一下片源？</button>' +
                '<div class="cinema-invite-actions">' +
                    '<button class="cinema-invite-cancel" id="cinema-invite-cancel">取消</button>' +
                    '<button class="cinema-invite-confirm" id="cinema-invite-confirm">确定邀请</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(sheet);

        function close() { sheet.remove(); }
        document.getElementById('cinema-invite-mask').addEventListener('click', close);
        document.getElementById('cinema-invite-cancel').addEventListener('click', close);
        document.getElementById('cinema-invite-test-source').addEventListener('click', _testVideoSource);
        document.getElementById('cinema-invite-confirm').addEventListener('click', function () {
            var movieInput = document.getElementById('cinema-invite-movie');
            var movieVal = movieInput.value.trim();
            var dateVal = document.getElementById('cinema-invite-date').value; // "YYYY-MM-DD"
            var timeVal = document.getElementById('cinema-invite-time').value; // "HH:MM"
            var errorEl = document.getElementById('cinema-invite-error');
            errorEl.textContent = '';
            if (!movieVal) { movieInput.focus(); return; }
            var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateVal || '');
            var tm = /^(\d{2}):(\d{2})$/.exec(timeVal || '');
            if (!dm || !tm) return;
            var picked = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], 0, 0);
            if (picked.getTime() <= Date.now()) {
                errorEl.textContent = '约的时间不能早于现在，改一下吧';
                return;
            }
            close();
            _negoStartRound(movieVal, (+dm[1]) + '年' + (+dm[2]) + '月' + (+dm[3]) + '日', timeVal, 1);
        });
    }

    // ── 居中卡片式确认弹窗（跟 album.js 的 _alShowConfirm 底部弹出不一样，
    //    这个是居中卡片，配对之前打分/邀请弹层的圆角卡片风格）──────
    // singleBtn=true 时只显示一个按钮（用于错误提示这种不需要"取消"的场景）
    function _cinemaCenterConfirm(title, desc, confirmText, onConfirm, singleBtn) {
        var old = document.getElementById('cinema-confirm-modal');
        if (old) old.remove();
        var modal = document.createElement('div');
        modal.id = 'cinema-confirm-modal';
        modal.className = 'cinema-confirm-modal';
        modal.innerHTML =
            '<div class="cinema-confirm-mask" id="cinema-confirm-mask"></div>' +
            '<div class="cinema-confirm-card">' +
                '<div class="cinema-confirm-title">' + _escapeHtml(title) + '</div>' +
                '<div class="cinema-confirm-desc">' + _escapeHtml(desc) + '</div>' +
                '<div class="cinema-confirm-actions">' +
                    (singleBtn ? '' : '<button class="cinema-confirm-cancel" id="cinema-confirm-cancel">取消</button>') +
                    '<button class="cinema-confirm-ok" id="cinema-confirm-ok">' + _escapeHtml(confirmText) + '</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);
        function close() { modal.remove(); }
        document.getElementById('cinema-confirm-mask').addEventListener('click', close);
        var cancelBtn = document.getElementById('cinema-confirm-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', close);
        document.getElementById('cinema-confirm-ok').addEventListener('click', function () {
            close();
            if (onConfirm) onConfirm();
        });
    }
    // 视频加载失败的提示，复用居中弹窗，单按钮
    function _showVideoLoadErrorModal() {
        _cinemaCenterConfirm('视频加载失败', '检查一下链接是否正确，或者换一个视频源试试', '知道了', null, true);
    }

    // 监听视频是否真的加载成功——不能只靠 error 事件，有些"假直链"服务器返回的
    // 其实是登录页/提示页而不是真视频数据，浏览器不一定会触发标准 error，只会卡在
    // 空白播放器上。所以加一层 8 秒超时兜底：到点了既没成功也没报错，就当失败。
    // myToken 机制：如果这期间又换了一次片，旧的这次检测会失效，不会误报。
    var _videoLoadToken = 0;
    function _watchVideoLoad(videoEl) {
        if (!videoEl) return;
        if (videoEl.tagName === 'IFRAME') return; // B站iframe是黑盒，跨域拿不到加载状态，没法检测
        var myToken = ++_videoLoadToken;
        var resolved = false;
        function isCurrent() { return myToken === _videoLoadToken; }
        var timer = setTimeout(function () {
            if (resolved || !isCurrent()) return;
            resolved = true;
            _showVideoLoadErrorModal();
        }, 8000);
        function onSuccess() {
            if (resolved || !isCurrent()) return;
            resolved = true;
            clearTimeout(timer);
        }
        function onFail() {
            if (resolved || !isCurrent()) return;
            resolved = true;
            clearTimeout(timer);
            _showVideoLoadErrorModal();
        }
        videoEl.addEventListener('loadedmetadata', onSuccess, { once: true });
        videoEl.addEventListener('canplay', onSuccess, { once: true });
        videoEl.addEventListener('error', onFail, { once: true });
    }

    // ── 测试片源：极简播放页，只有播放器居中 + 关闭按钮，
    //    没有换片/结束观影/聊天这些东西，纯粹让你在正式邀请/正式观影之前
    //    先确认一下这个片源能不能用。不会碰 _uiState，跟真实观影流程完全独立。
    function _openTestPlayerOverlay(src, type) {
        var old = document.getElementById('cinema-test-player-overlay');
        if (old) old.remove();
        var isBili = type === 'bilibili';
        var playerHTML = isBili
            ? '<iframe class="cinema-test-player-el" src="' + src + '" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>'
            : '<video class="cinema-test-player-el" id="cinema-test-video" controls autoplay playsinline webkit-playsinline>' +
                  '<source src="' + src + '" type="video/mp4">' +
              '</video>';
        var overlay = document.createElement('div');
        overlay.id = 'cinema-test-player-overlay';
        overlay.className = 'cinema-test-player-overlay';
        overlay.innerHTML =
            '<button class="cinema-test-player-close" id="cinema-test-player-close"><i class="fas fa-times"></i></button>' +
            (isBili ? '<div class="cinema-test-player-hint">B站视频没法自动检测，自己看看能不能正常播放～</div>' : '') +
            '<div class="cinema-test-player-wrap">' + playerHTML + '</div>';
        document.body.appendChild(overlay);
        document.getElementById('cinema-test-player-close').addEventListener('click', function () {
            var v = document.getElementById('cinema-test-video');
            if (v && v.src && v.src.indexOf('blob:') === 0) URL.revokeObjectURL(v.src);
            overlay.remove();
        });
        if (!isBili) {
            _watchVideoLoad(document.getElementById('cinema-test-video'));
        }
    }
    // 打开来源选择弹窗，选完不进入真实观影，而是丢进上面这个测试播放页
    function _testVideoSource() {
        _openVideoSourceModal(function (src, title, type) {
            _openTestPlayerOverlay(src, type);
        });
    }

    // ── 选择影片来源：本地文件 / 输入直连网址，选完统一走 onPicked(src, title) 回调 ──
    // onPicked(src, title, type) —— type: 'video'(默认，走<video>播放) | 'bilibili'(走iframe嵌入)
    // ── B站链接怎么获取的说明弹层 ──────────────────────────
    function _showBiliHelpModal() {
        var old = document.getElementById('cinema-bili-help-modal');
        if (old) old.remove();
        var modal = document.createElement('div');
        modal.id = 'cinema-bili-help-modal';
        modal.className = 'cinema-invite-sheet';
        modal.innerHTML =
            '<div class="cinema-invite-mask" id="cinema-bili-help-mask"></div>' +
            '<div class="cinema-invite-body cinema-bili-help-body">' +
                '<div class="cinema-invite-title">怎么获取B站链接</div>' +
                '<div class="cinema-bili-help-section">' +
                    '<div class="cinema-bili-help-heading">方法一：电脑网页版</div>' +
                    '<div class="cinema-bili-help-text">打开电脑浏览器上的哔哩哔哩，找到想看的视频 → 点"分享" → 点"复制链接" → 直接粘贴到上面的输入框就行。</div>' +
                '</div>' +
                '<div class="cinema-bili-help-section">' +
                    '<div class="cinema-bili-help-heading">方法二：手机App</div>' +
                    '<div class="cinema-bili-help-text">在B站App里找到视频 → 点"分享" → 点"复制链接"，这时候复制到的是一个短链接，还不能直接用。打开手机浏览器（比如Safari、Chrome、Edge），把这个短链接粘贴进地址栏打开，等它跳转完，把地址栏里变成的新链接复制出来，再粘贴到这里。</div>' +
                '</div>' +
                '<div class="cinema-bili-help-warn">' +
                    '<div class="cinema-bili-help-warn-title">⚠️ 有一个限制要提前知道：</div>' +
                    '<div class="cinema-bili-help-warn-item">· 无法选择清晰度，只能看默认画质；大会员专享的内容看不了</div>' +
                '</div>' +
                '<div class="cinema-bili-help-why">' +
                    '❓为什么：这个视频窗口是"借用"哔哩哔哩自己的播放器嵌进来的，不是完整的网站播放器，所以清晰度选择和会员内容这些功能会受到限制。' +
                '</div>' +
                '<div class="cinema-invite-actions">' +
                    '<button class="cinema-invite-confirm" id="cinema-bili-help-ok" style="width:100%;">知道了</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);
        function close() { modal.remove(); }
        document.getElementById('cinema-bili-help-mask').addEventListener('click', close);
        document.getElementById('cinema-bili-help-ok').addEventListener('click', close);
    }

    function _openVideoSourceModal(onPicked) {
        var old = document.getElementById('cinema-source-modal');
        if (old) old.remove();
        var modal = document.createElement('div');
        modal.id = 'cinema-source-modal';
        modal.className = 'cinema-invite-sheet';
        modal.innerHTML =
            '<div class="cinema-invite-mask" id="cinema-source-mask"></div>' +
            '<div class="cinema-invite-body">' +
                '<div class="cinema-invite-title">选择影片来源</div>' +
                '<div class="cinema-source-choice-actions">' +
                    '<button class="cinema-source-choice-btn" id="cinema-source-local">' +
                        '<i class="fas fa-folder-open"></i><span>本地文件</span>' +
                    '</button>' +
                    '<button class="cinema-source-choice-btn" id="cinema-source-url">' +
                        '<i class="fas fa-link"></i><span>输入网址</span>' +
                    '</button>' +
                '</div>' +
                '<div id="cinema-source-url-section" style="display:none;">' +
                    '<div class="cinema-invite-label">视频直链</div>' +
                    '<input type="text" class="cinema-invite-input" id="cinema-source-url-input" placeholder="https://…">' +
                    '<div class="cinema-invite-label cinema-invite-label-row">' +
                        '<span>B站链接</span>' +
                        '<button type="button" class="cinema-help-btn" id="cinema-bili-help-btn" title="怎么获取B站链接">?</button>' +
                    '</div>' +
                    '<input type="text" class="cinema-invite-input" id="cinema-source-bili-input" placeholder="粘贴B站视频链接或BV号">' +
                    '<div class="cinema-invite-error" id="cinema-source-url-error"></div>' +
                    '<div class="cinema-invite-actions">' +
                        '<button class="cinema-invite-cancel" id="cinema-source-url-cancel">取消</button>' +
                        '<button class="cinema-invite-confirm" id="cinema-source-url-confirm">确定</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);

        var localInput = document.createElement('input');
        localInput.type = 'file';
        localInput.accept = 'video/*';
        localInput.style.display = 'none';
        document.body.appendChild(localInput);

        function close() {
            modal.remove();
            if (localInput.parentNode) localInput.remove();
        }
        document.getElementById('cinema-source-mask').addEventListener('click', close);

        localInput.addEventListener('change', function (e) {
            var file = e.target.files && e.target.files[0];
            if (!file) { close(); return; } // 用户在系统选择框里点了取消
            var src = URL.createObjectURL(file);
            var title = file.name.replace(/\.[^.]+$/, '');
            close();
            onPicked(src, title, 'video');
        });

        document.getElementById('cinema-source-local').addEventListener('click', function () {
            localInput.click();
        });
        document.getElementById('cinema-source-url').addEventListener('click', function () {
            document.getElementById('cinema-source-url-section').style.display = 'block';
        });
        document.getElementById('cinema-bili-help-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            _showBiliHelpModal();
        });
        document.getElementById('cinema-source-url-cancel').addEventListener('click', close);
        document.getElementById('cinema-source-url-confirm').addEventListener('click', function () {
            var errorEl = document.getElementById('cinema-source-url-error');
            errorEl.textContent = '';

            // 优先看B站链接这一栏有没有填——两栏都填了就以B站为准
            var biliInput = document.getElementById('cinema-source-bili-input');
            var biliVal = biliInput.value.trim();
            if (biliVal) {
                var bvMatch = /BV[0-9A-Za-z]{10}/.exec(biliVal);
                if (!bvMatch) { errorEl.textContent = '没找到有效的BV号，检查一下链接格式'; return; }
                var bvid = bvMatch[0];
                var embedSrc = 'https://player.bilibili.com/player.html?bvid=' + bvid + '&page=1&high_quality=1&danmaku=0';
                close();
                onPicked(embedSrc, 'B站视频', 'bilibili');
                return;
            }

            var urlInput = document.getElementById('cinema-source-url-input');
            var url = urlInput.value.trim();
            if (!url) { errorEl.textContent = '填一下视频链接吧'; return; }
            if (!/^https?:\/\//i.test(url)) { errorEl.textContent = '链接格式不对，得是 http:// 或 https:// 开头'; return; }
            var titleGuess = '网络视频';
            try {
                var path = new URL(url).pathname;
                var last = path.split('/').filter(Boolean).pop();
                if (last) titleGuess = decodeURIComponent(last.replace(/\.[^.]+$/, ''));
            } catch (e) { /* 解析失败就用默认标题，不影响功能 */ }
            close();
            onPicked(url, titleGuess, 'video');
        });
    }


    // 本次观影会话的聊天记录（内存态，结束观影时清空）
    var _cinemaMessages = [];

    // waiting 状态下的解锁轮询定时器
    var _waitLockTimer = null;

    // 文档级"点击外部关闭表情面板"监听是否已绑定
    var _outsideClickBound = false;

    function _getPanel() {
        return document.getElementById('cs-panel-cinema');
    }

    function _clearWaitTimer() {
        if (_waitLockTimer) {
            clearInterval(_waitLockTimer);
            _waitLockTimer = null;
        }
    }

    // ── 时间解析：把 "2026年8月3日" + "20:30" 解析成 Date ──────
    function _parseApptDate() {
        var m = /(\d+)年(\d+)月(\d+)日/.exec(_fakeAppt.dateStr || '');
        var t = /(\d+):(\d+)/.exec(_fakeAppt.timeStr || '');
        if (!m || !t) return null;
        return new Date(+m[1], +m[2] - 1, +m[3], +t[1], +t[2], 0, 0);
    }
    function _isApptReached() {
        var d = _parseApptDate();
        if (!d) return true; // 解析失败时不卡住用户，默认放行
        return Date.now() >= d.getTime();
    }
    function _countdownText() {
        var d = _parseApptDate();
        if (!d) return '';
        var diff = d.getTime() - Date.now();
        if (diff <= 0) return '';
        var totalMin = Math.ceil(diff / 60000);
        var h = Math.floor(totalMin / 60);
        var m = totalMin % 60;
        if (h > 0) return '还有' + h + '小时' + (m > 0 ? m + '分钟' : '');
        return '还有' + m + '分钟';
    }

    // ── 开场前 2 分钟提醒：黑色蒙层，仿照"梦角邀请陪伴"那套视觉，
    //    但完全是 cinema.js 自己独立实现的，不调用 companion.js 的任何函数 ──
    // 等欢迎加载动画结束后再执行 callback（避免提醒弹窗压在 loading 画面上）
    // 欢迎画面：3500ms 后加 .hidden 类开始淡出，再过 800ms 才 display:none
    function _waitForWelcomeDone(callback) {
        var el = document.getElementById('welcome-animation');
        // 没有欢迎画面 / 已经 display:none → 直接执行
        if (!el || el.style.display === 'none') { callback(); return; }
        // 已经在淡出（.hidden 已挂），等淡出动画跑完再执行
        if (el.classList.contains('hidden')) { setTimeout(callback, 900); return; }
        // loading 还在转：轮询，最多等 12 秒（超时兜底，防止 loading 因某种原因卡住）
        var deadline = Date.now() + 12000;
        var tid = setInterval(function () {
            if (!el || el.style.display === 'none' || Date.now() >= deadline) {
                clearInterval(tid);
                callback();
            } else if (el.classList.contains('hidden')) {
                clearInterval(tid);
                setTimeout(callback, 900); // 等淡出完成
            }
        }, 200);
    }

    function _scheduleShowtimeReminder() {
        if (_showtimeReminderTimer) { clearTimeout(_showtimeReminderTimer); _showtimeReminderTimer = null; }
        if (_uiState !== 'waiting' || _fakeAppt.reminderShown) return;
        var d = _parseApptDate();
        if (!d) return;
        var now = Date.now();
        var reminderAt = d.getTime() - 2 * 60000;
        // 不管是"快到点了"还是"已经过点了"，只要还没提醒过、也还没开始看，
        // 一打开网站/切到电影院 tab 就该立刻提醒——不能因为时间已经过了就跳过。
        // 等欢迎动画结束后再弹出，避免压在 loading 画面上。
        if (now >= reminderAt) { _waitForWelcomeDone(_showShowtimeReminder); return; }
        _showtimeReminderTimer = setTimeout(_showShowtimeReminder, reminderAt - now);
    }
    function _showShowtimeReminder() {
        if (_uiState !== 'waiting' || _fakeAppt.reminderShown) return;
        // 如果正好撞上别的邀请/通话弹窗，稍等半分钟再重试，不硬挤上去
        if (document.querySelector('#companion-incoming-overlay, #companion-inviting-overlay') ||
            document.getElementById('call-incoming-overlay')?.classList.contains('visible') ||
            document.getElementById('call-window')?.classList.contains('visible')) {
            _showtimeReminderTimer = setTimeout(_showShowtimeReminder, 30000);
            return;
        }
        _fakeAppt.reminderShown = true;
        _apptSave();

        var old = document.getElementById('cinema-showtime-overlay');
        if (old) old.remove();
        var partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '梦角';
        var overlay = document.createElement('div');
        overlay.id = 'cinema-showtime-overlay';
        overlay.className = 'cinema-showtime-overlay';
        overlay.innerHTML =
            '<div class="cinema-showtime-content">' +
                '<div class="cinema-showtime-avatar-wrap">' +
                    '<div class="cinema-showtime-ring"></div>' +
                    '<div class="cinema-showtime-ring cinema-showtime-ring--delay"></div>' +
                    '<div class="cinema-showtime-avatar">' + _avatarHTML(true, 96) + '</div>' +
                '</div>' +
                '<div class="cinema-showtime-name">' + _escapeHtml(partnerName) + '</div>' +
                '<div class="cinema-showtime-hint"><span class="cinema-showtime-dot"></span><span>电影要开场啦</span></div>' +
                '<div class="cinema-showtime-line"><i class="fas fa-film"></i><span>《' + _escapeHtml(_fakeAppt.movieTitle) + '》马上就要开始了</span></div>' +
                '<div class="cinema-showtime-actions">' +
                    '<button id="cinema-showtime-later" class="cinema-showtime-btn">' +
                        '<div class="cinema-showtime-btn-circle cinema-showtime-btn-circle--later"><i class="fas fa-clock"></i></div>' +
                        '<span>等一会</span>' +
                    '</button>' +
                    '<button id="cinema-showtime-go" class="cinema-showtime-btn">' +
                        '<div class="cinema-showtime-btn-circle cinema-showtime-btn-circle--go"><i class="fas fa-play"></i></div>' +
                        '<span>现在过去</span>' +
                    '</button>' +
                '</div>' +
            '</div>';
        document.documentElement.appendChild(overlay);
        document.getElementById('cinema-showtime-later').addEventListener('click', function () { overlay.remove(); });
        document.getElementById('cinema-showtime-go').addEventListener('click', function () {
            overlay.remove();
            if (typeof openCoupleSpace === 'function') openCoupleSpace();
            if (typeof csSwitchTab === 'function') setTimeout(function () { csSwitchTab('cinema'); }, 50);
        });
    }

    // ── 公共 header HTML ────────────────────────────────
    function _hdHTML() {
        return '<div class="cinema-hd">' +
            '<span class="cinema-hd-title">电影院</span>' +
            '<button class="cs-icon-btn" id="cinema-archive-btn" title="影日志">' +
                '<span class="cinema-archive-icon"></span>' +
            '</button>' +
        '</div>';
    }

    // ── 观影沉浸模式：进入/退出（隐藏外层头像条+顶栏，强制暗色）──
    function _enterTheaterMode() {
        var page = document.getElementById('couple-space-page');
        if (page) page.classList.add('cinema-theater-mode');
    }
    function _exitTheaterMode() {
        var page = document.getElementById('couple-space-page');
        if (page) page.classList.remove('cinema-theater-mode');
    }

    // ── 观影模式专属头部：返回 / 观影中 / 设置(占位) ──────
    function _theaterHdHTML() {
        return '<div class="cinema-theater-hd">' +
            '<button class="cs-icon-btn" id="cinema-theater-back-btn" title="返回"><i class="fas fa-chevron-left"></i></button>' +
            '<span class="cinema-theater-hd-title">观影中</span>' +
            '<button class="cs-icon-btn" id="cinema-theater-settings-btn" title="设置"><i class="fas fa-cog"></i></button>' +
        '</div>';
    }
    function _bindTheaterHdListeners() {
        var backBtn = document.getElementById('cinema-theater-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', function () {
                _immersive = false;
                _renderWatching();
            });
        }
        var settingsBtn = document.getElementById('cinema-theater-settings-btn');
        if (settingsBtn) {
            // 占位：整个情侣空间的设置，功能后续再接
            settingsBtn.addEventListener('click', function () {});
        }
    }

    // ── 结束观影时的公共清理（释放 blob、清空本次会话消息）────
    function _endWatchingCleanup() {
        var video = document.getElementById('cinema-video');
        if (video && video.src && video.src.indexOf('blob:') === 0) URL.revokeObjectURL(video.src);
        _currentVideo = { src: '', title: '' };
        _cinemaMessages = [];
        _cinemaHideTyping();
        _clearWatchAutoEnd();
        window._cinemaWatching = false;
    }

    // 观影开始/结束，往主聊天发一条事件记录（复用 call-event 那套小药丸样式，
    // 跟"视频通话已结束""XX陪伴已结束"是同一个视觉语言）
    function _cinemaSendWatchEvent(started, durationMin) {
        if (typeof addMessage !== 'function') return;
        var text = started ? '观影已开始' : '观影已结束';
        var detail = (!started && typeof durationMin === 'number') ? (durationMin + ' 分钟') : null;
        addMessage({
            id: Date.now() + Math.random(),
            sender: 'system',
            text: text + (detail ? ' · ' + detail : ''),
            timestamp: new Date(),
            status: 'received',
            type: 'call-event',
            callIcon: 'fa-film',
            callDetail: detail,
            favorited: false,
            note: null
        });
    }

    // 观影超过 6~8 小时（随机）没手动结束——大概率是用户忘了，自动收尾
    function _scheduleWatchAutoEnd() {
        _clearWatchAutoEnd();
        var hours = 6 + Math.random() * 2;
        _watchAutoEndTimer = setTimeout(_autoEndWatching, hours * 3600000);
    }
    function _clearWatchAutoEnd() {
        if (_watchAutoEndTimer) { clearTimeout(_watchAutoEndTimer); _watchAutoEndTimer = null; }
    }
    function _autoEndWatching() {
        if (_uiState !== 'watching') return;
        var watchedTitle = _currentVideo.title || _fakeAppt.movieTitle || '这部电影';
        var startedAt = _watchStartedAt;
        _endWatchingCleanup();
        _exitTheaterMode();
        var durationMin = startedAt ? Math.round((Date.now() - startedAt) / 60000) : null;
        _cinemaSendWatchEvent(false, durationMin);
        // 自动结束时用户不在，不弹打分面板，直接按"跳过"的规则记一条历史
        // （梦角这边还是 100% 给评分+评语，跟正常"跳过"路径完全一致）
        var partner = _cinemaGeneratePartnerReview();
        _histLoad().then(function () {
            _history.unshift({
                id: Date.now() + Math.random(),
                title: watchedTitle,
                ts: Date.now(),
                userStars: 0,
                userReview: '',
                partnerStars: partner.stars,
                partnerReview: partner.review
            });
            _histSave();
        });
        _uiState = 'empty';
        _apptSave();
        if (_getPanel()) _cinemaRender();
    }

    // ── 结束观影后：弹出打分/写影评弹层 ──────────────────
    // 不管用户是保存还是跳过，都会记一条观看历史（跳过就是 0 星 + 空评价），
    // 保证"影评"里能看到真实看过的片子，而不是只有手动造的假数据。
    // 保存前先 _histLoad()，避免这次会话都没打开过"影评"tab 时 _history
    // 还是空数组，写回去把之前存的记录覆盖掉。
    // ── 梦角对本次观影的自动评价：100% 给星，评语从字卡池真实抽取 ──
    // 星级 1-5 随机；评语从 customReplies 字卡池（跟聊天自动回复同一个池子）
    // 随机不重复抽 2-4 条拼起来，绝不使用任何预设/编造的文案。
    // 如果字卡池是空的，星级照给，评语只能空着（没有素材可用）。
    function _cinemaGeneratePartnerReview() {
        var stars = 1 + Math.floor(Math.random() * 5);
        var pool = _cinemaBuildReplyPool();
        if (!pool.length) return { stars: stars, review: '' };
        var shuffled = pool.slice();
        for (var i = shuffled.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
        }
        var count = Math.min(2 + Math.floor(Math.random() * 3), shuffled.length); // 2~4 条
        return { stars: stars, review: shuffled.slice(0, count).join(' ') };
    }

    function _openRatingSheet(title) {
        var old = document.getElementById('cinema-rating-sheet');
        if (old) old.remove();
        var stars = 0;
        var sheet = document.createElement('div');
        sheet.id = 'cinema-rating-sheet';
        sheet.className = 'cinema-rating-sheet';
        sheet.innerHTML =
            '<div class="cinema-rating-mask" id="cinema-rating-mask"></div>' +
            '<div class="cinema-rating-body">' +
                '<div class="cinema-rating-title">《' + _escapeHtml(title) + '》看完啦</div>' +
                '<div class="cinema-rating-sub">给这次观影打个分吧</div>' +
                '<div id="cinema-rating-stars">' + _histStarsHTML(0, true) + '</div>' +
                '<textarea class="cinema-rating-textarea" id="cinema-rating-review" maxlength="200" placeholder="影评（可选）"></textarea>' +
                '<div class="cinema-rating-actions">' +
                    '<button class="cinema-rating-skip" id="cinema-rating-skip">跳过</button>' +
                    '<button class="cinema-rating-save" id="cinema-rating-save">保存</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(sheet);

        var starsWrap = document.getElementById('cinema-rating-stars');
        function bindStarClicks() {
            starsWrap.querySelectorAll('.cinema-hist-star').forEach(function (starEl) {
                starEl.addEventListener('click', function () {
                    stars = parseInt(starEl.dataset.star, 10);
                    starsWrap.innerHTML = _histStarsHTML(stars, true);
                    bindStarClicks();
                });
            });
        }
        bindStarClicks();

        function finish(withReview) {
            var reviewVal = withReview ? document.getElementById('cinema-rating-review').value.trim() : '';
            var finalStars = withReview ? stars : 0;
            var partner = _cinemaGeneratePartnerReview();
            _histLoad().then(function () {
                _history.unshift({
                    id: Date.now() + Math.random(),
                    title: title,
                    ts: Date.now(),
                    userStars: finalStars,
                    userReview: reviewVal,
                    partnerStars: partner.stars,
                    partnerReview: partner.review
                });
                _histSave();
                sheet.remove();
                _uiState = 'empty';
                _apptSave();
                _cinemaRender();
            });
        }
        document.getElementById('cinema-rating-mask').addEventListener('click', function () { finish(false); });
        document.getElementById('cinema-rating-skip').addEventListener('click', function () { finish(false); });
        document.getElementById('cinema-rating-save').addEventListener('click', function () { finish(true); });
    }

    // ── 渲染：选片后的假加载过渡（纯视觉，全屏进度条，真实读取几乎不耗时）──
    function _renderLoading() {
        _enterTheaterMode();
        var panel = _getPanel();
        if (!panel) return;
        panel.innerHTML =
            '<div class="cinema-loading-full">' +
                '<div class="cinema-loading-icon"><i class="fas fa-film"></i></div>' +
                '<div class="cinema-loading-bar-track">' +
                    '<div class="cinema-loading-bar-fill" id="cinema-loading-bar-fill"></div>' +
                '</div>' +
                '<div class="cinema-loading-full-text">电影加载中……</div>' +
            '</div>';
        // 双 rAF 确保初始 width:0% 已经上屏，再触发到 100% 的过渡动画
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                var fill = document.getElementById('cinema-loading-bar-fill');
                if (fill) fill.style.width = '100%';
            });
        });
    }

    // ── 聊天消息渲染（带头像，跟主聊天头像来源一致）───────
    function _escapeHtml(s) {
        var d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }
    function _avatarHTML(isPartner, size) {
        var s = size || 30;
        if (typeof _avEl === 'function') return _avEl(isPartner, s);
        return '<span style="font-size:' + Math.round(s * 0.65) + 'px;">' + (isPartner ? '🌸' : '🙂') + '</span>';
    }
    // 头像要不要显示、显示成什么样，跟主聊天"外观设置→聊天头像"里那两个开关保持一致：
    // ① settings.inChatAvatarEnabled（显示聊天头像总开关）关了 → 'none'，完全不留头像位置
    // ② settings.alwaysShowAvatar（每条消息都显示头像）关了、且这条跟上一条是同一个人发的
    //    → 'invisible'，头像位置还留着（保持对齐），只是这条不露出来，跟主聊天的处理方式一样
    // 否则 → 'visible'，正常显示
    function _cinemaAvatarMode(msg, lastSender) {
        if (typeof settings === 'undefined' || !settings.inChatAvatarEnabled) return 'none';
        if (!settings.alwaysShowAvatar && msg.sender === lastSender) return 'invisible';
        return 'visible';
    }
    function _msgHTML(msg, avatarMode) {
        var isPartner = msg.sender === 'partner';
        var bodyHTML;
        if (msg.type === 'image') {
            var isCloudRef = window.CloudMedia && typeof window.CloudMedia.isCloudRef === 'function' && window.CloudMedia.isCloudRef(msg.content);
            // 云端引用（oss://...）不是真实可加载的图片地址，不能直接塞进 src，
            // 否则浏览器会报 net::ERR_UNKNOWN_URL_SCHEME —— 要走 CloudMedia.bindLazyImage
            // 解析成真实签名 URL 后再显示（跟主聊天图片消息用的是同一套机制）
            bodyHTML = isCloudRef
                ? '<div class="cinema-msg-img"><img data-cinema-cloud-ref="' + _escapeHtml(msg.content) + '" alt=""></div>'
                : '<div class="cinema-msg-img"><img src="' + msg.content + '" alt=""></div>';
        } else {
            bodyHTML = '<div class="cinema-msg-bubble">' + _escapeHtml(msg.content) + '</div>';
        }
        var mode = avatarMode || 'visible';
        var avatarHTML = mode === 'none'
            ? ''
            : '<div class="cinema-msg-avatar' + (mode === 'invisible' ? ' cinema-msg-avatar-invisible' : '') + '">' + _avatarHTML(isPartner) + '</div>';
        return '<div class="cinema-msg-row ' + (isPartner ? 'cinema-msg-partner' : 'cinema-msg-mine') + '">' +
            (isPartner ? avatarHTML + bodyHTML : bodyHTML + avatarHTML) +
        '</div>';
    }
    // 扫描容器里带 data-cinema-cloud-ref 的图片，用 CloudMedia 解析成真实 URL
    function _bindCinemaCloudImages(container) {
        if (!container || !window.CloudMedia || typeof window.CloudMedia.bindLazyImage !== 'function') return;
        container.querySelectorAll('img[data-cinema-cloud-ref]').forEach(function (imgEl) {
            var ref = imgEl.getAttribute('data-cinema-cloud-ref');
            imgEl.removeAttribute('data-cinema-cloud-ref');
            window.CloudMedia.bindLazyImage(imgEl, ref);
        });
    }
    function _chatAreaHTML() {
        if (!_cinemaMessages.length) {
            return '<div class="cinema-chat-area" id="cinema-chat-area">' +
                    '<div class="cinema-chat-empty">' +
                        '<i class="far fa-comment-dots"></i>' +
                        '<p>暂无聊天记录</p>' +
                    '</div>' +
                '</div>';
        }
        var lastSender = null;
        var rowsHTML = _cinemaMessages.map(function (msg) {
            var mode = _cinemaAvatarMode(msg, lastSender);
            lastSender = msg.sender;
            return _msgHTML(msg, mode);
        }).join('');
        return '<div class="cinema-chat-area" id="cinema-chat-area">' +
            rowsHTML +
        '</div>';
    }
    function _appendMsgToDOM(msg) {
        var area = document.getElementById('cinema-chat-area');
        if (!area) return;
        var emptyEl = area.querySelector('.cinema-chat-empty');
        if (emptyEl) emptyEl.remove();
        var idx = _cinemaMessages.indexOf(msg);
        var prevMsg = idx > 0 ? _cinemaMessages[idx - 1] : null;
        var avatarMode = _cinemaAvatarMode(msg, prevMsg ? prevMsg.sender : null);
        var tmp = document.createElement('div');
        tmp.innerHTML = _msgHTML(msg, avatarMode);
        var newEl = tmp.firstChild;
        area.appendChild(newEl);
        _bindCinemaCloudImages(newEl);
        area.scrollTop = area.scrollHeight;
    }
    // 观影中的聊天消息，同步一份到主聊天（文字用 text，图片/表情复用主聊天的
    // msg.image 字段——跟主聊天原生图片消息同一套字段，oss://云端引用能正常解析）
    function _cinemaSyncToMainChat(msg) {
        if (typeof addMessage !== 'function') return;
        var sender = msg.sender === 'partner' ? 'partner' : 'user';
        var payload = {
            id: Date.now() + Math.random(),
            sender: sender,
            timestamp: new Date(),
            status: sender === 'user' ? 'sent' : 'received',
            type: 'normal',
            favorited: false,
            note: null
        };
        if (msg.type === 'image') {
            payload.text = '';
            payload.image = msg.content;
        } else {
            payload.text = msg.content;
        }
        addMessage(payload);
    }
    // skipMainChatSync：true 表示这条消息本来就是从主聊天镶过来的（比如梦角的回复），
    // 不需要再同步回主聊天一次，否则会导致"同步→触发钩子→再镶一份→再同步"的死循环
    function _pushMessage(msg, skipMainChatSync) {
        msg.id = Date.now() + Math.random();
        msg.ts = Date.now();
        msg.sender = msg.sender || 'user';
        _cinemaMessages.push(msg);
        _appendMsgToDOM(msg);
        if (!skipMainChatSync) _cinemaSyncToMainChat(msg);
        if (msg.sender === 'user' && typeof window._triggerDelayedReply === 'function') {
            window._triggerDelayedReply(true);
        }
    }

    // ── 梦角自动回复：复用主聊天"字卡"回复库(customReplies)的选取/过滤逻辑 ──

    function _cinemaShowTyping() {
        var slot = document.getElementById('cinema-typing-fixed');
        if (!slot) return;
        var name = (typeof settings !== 'undefined' && settings.partnerName) || '梦角';
        slot.innerHTML =
            '<div class="cinema-typing-pill">' +
                '<div class="cinema-typing-pill-avatar">' + _avatarHTML(true) + '</div>' +
                '<span class="cinema-typing-pill-label">' + _escapeHtml(name) + ' 正在输入</span>' +
                '<div class="typing-dots">' +
                    '<div class="typing-dot"></div>' +
                    '<div class="typing-dot"></div>' +
                    '<div class="typing-dot"></div>' +
                '</div>' +
            '</div>';
        slot.style.display = 'block';
    }
    function _cinemaHideTyping() {
        var slot = document.getElementById('cinema-typing-fixed');
        if (slot) { slot.innerHTML = ''; slot.style.display = 'none'; }
    }
    // 跟主聊天 simulateReply() 里一样：按 disabledReplyItems / 禁用分组 过滤 customReplies
    // 注意：这个函数现在只给"观影结束后梦角自动评价"（_cinemaGeneratePartnerReview）用，
    // 发消息触发回复已经改成直接调用主聊天的 window._triggerDelayedReply，不再自己排队/模拟回复
    function _cinemaBuildReplyPool() {
        var replies = (typeof customReplies !== 'undefined' && customReplies) ? customReplies : [];
        if (!replies.length) return [];
        var disabledItems = (function () {
            try {
                var raw = localStorage.getItem('disabledReplyItems');
                return raw ? new Set(JSON.parse(raw)) : new Set();
            } catch (e) { return new Set(); }
        })();
        var disabledGroupItems = new Set();
        (window.customReplyGroups || []).forEach(function (g) {
            if (g.disabled && Array.isArray(g.items)) {
                g.items.forEach(function (it) { disabledGroupItems.add(it); });
            }
        });
        return replies
            .filter(function (r) { return !disabledItems.has(r) && !disabledGroupItems.has(r); })
            .map(function (r) { return String(r || '').trim(); })
            .filter(Boolean);
    }

    // ── 复用主聊天的"正在输入"和自动回复逻辑（跟陪伴模式是同一个思路）──────
    // 1. 发消息触发回复：直接调用主聊天真实的 window._triggerDelayedReply(true)，
    //    已读不回/拍一拍/人设切换/多条回复 这些主聊天有的分支，电影院自动全部一致
    // 2. "正在输入"展示：不自己判断，而是监视主聊天的提示条(#typing-indicator-wrapper)
    //    的显示/隐藏，同步镜像到电影院自己的提示位，跟陪伴模式的 watchTypingIndicator 一样
    // 3. 回复到达：主聊天 simulateReply() 最终还是把消息插进主聊天的 messages/DOM，
    //    电影院这边通过 window._registerPartnerMessageListener 注册一个监听，
    //    把这条消息也镶一份进电影院自己的聊天区（跟电影院发消息"同步一份到主聊天"是反方向的镜像）
    var _cinemaTypingObserverBound = false;
    function _cinemaWatchTypingIndicator() {
        if (_cinemaTypingObserverBound) return;
        var ti = document.getElementById('typing-indicator-wrapper');
        if (!ti) {
            if ((_cinemaWatchTypingIndicator._retries = (_cinemaWatchTypingIndicator._retries || 0) + 1) < 10) {
                setTimeout(_cinemaWatchTypingIndicator, 500);
            }
            return;
        }
        _cinemaTypingObserverBound = true;
        var observer = new MutationObserver(function () {
            // 只在电影院面板真的开着、且处于观影中才镜像，避免面板不存在时报错/无意义操作
            if (_uiState !== 'watching' || !_getPanel()) return;
            var isShown = ti.style.display !== 'none' && ti.style.display !== '';
            var slot = document.getElementById('cinema-typing-fixed');
            if (!slot) return;
            // 已经是同一个状态就不重复操作——主聊天提示条位置会跟着输入框大小实时调整，
            // 每次调整都会触发这个回调，如果不做这层判断，会一直重建"正在输入"这段 DOM，
            // 动画被反复打断重启，看起来就像一直在闪。直接查电影院自己 DOM 当前状态判断，
            // 不用额外的 JS 变量记状态，避免离开/回到观影中之后状态不同步的问题
            var alreadyShown = slot.style.display === 'block';
            if (isShown === alreadyShown) return;
            if (isShown) { _cinemaShowTyping(); } else { _cinemaHideTyping(); }
        });
        observer.observe(ti, { attributes: true, attributeFilter: ['style'] });
    }
    _cinemaWatchTypingIndicator();

    if (typeof window._registerPartnerMessageListener === 'function') {
        window._registerPartnerMessageListener(function (message) {
            // 只看"电影院现在是不是正在观影中"——跟陪伴模式判断"陪伴页面开不开"是同一个思路。
            // 观影时梦角自己主动发起的邀请/来电已经在源头被 _cinemaShouldBlockInterruptions 拦住，
            // 所以这里不需要再额外判断"是不是这次发消息触发的回复"，观影中收到的梦角消息直接镶进来即可。
            if (_uiState !== 'watching' || !_getPanel()) return;
            var mirrored = {
                sender: 'partner',
                type: message && message.image ? 'image' : 'text',
                content: (message && (message.image || message.text)) || ''
            };
            if (!mirrored.content) return;
            _pushMessage(mirrored, true);
            if (typeof playSound === 'function') { try { playSound('message'); } catch (e) {} }
        });
    }

    // ── 输入栏（只在 watching 状态渲染）───────────────────
    function _stickerPickerHTML() {
        return '<div class="cinema-sticker-popover" id="cinema-sticker-picker">' +
            '<div class="cinema-sticker-popover-hd">我的表情</div>' +
            '<div class="cinema-sticker-grid" id="cinema-sticker-grid"></div>' +
        '</div>';
    }
    function _inputBarHTML() {
        return '<div class="cinema-input-bar-wrap">' +
            _stickerPickerHTML() +
            '<div class="cinema-input-bar">' +
                '<input type="text" class="cinema-input-field" id="cinema-input-field" placeholder="说点什么吧…">' +
                '<button class="cinema-chat-btn" id="cinema-emoji-btn" title="表情包"><i class="far fa-smile"></i></button>' +
                '<button class="cinema-chat-btn" id="cinema-img-btn" title="图片"><i class="far fa-image"></i></button>' +
            '</div>' +
            '<input type="file" id="cinema-image-input" accept="image/*" style="display:none;">' +
        '</div>';
    }
    function _renderCinemaStickerGrid() {
        var grid = document.getElementById('cinema-sticker-grid');
        if (!grid) return;
        grid.innerHTML = '';

        // 用户自己添加的表情库（不是梦角的）——"我的表情"这个面板只应该显示这个，
        // 之前误把 customEmojis（专门给梦角用的表情符号库）和预设表情也塞了进来，已经去掉
        var myStickers = (typeof myStickerLibrary !== 'undefined' && myStickerLibrary) ? myStickerLibrary : [];

        if (!myStickers.length) {
            grid.innerHTML = '<div class="cinema-sticker-empty">暂无表情，去主聊天页的"我的表情库"里添加吧</div>';
            return;
        }

        myStickers.forEach(function (src) {
            var item = document.createElement('div');
            item.className = 'cinema-sticker-item';
            item.innerHTML = '<img>';
            var imgEl = item.querySelector('img');
            var isCloud = typeof src === 'string' && src.indexOf('oss://') === 0;
            if (isCloud && window.CloudMedia && typeof window.CloudMedia.bindLazyImage === 'function') {
                window.CloudMedia.bindLazyImage(imgEl, src);
            } else {
                imgEl.src = src;
            }
            item.onclick = function () {
                // 用 src（表情库原始存的 oss:// 云端地址，或本地 dataURL），
                // 不能用 imgEl.src——云端表情解析后 imgEl.src 会变成临时的 blob: 地址，
                // 不是持久地址，存进消息里下次就打不开了
                _pushMessage({ type: 'image', content: src, sender: 'user' });
                var picker = document.getElementById('cinema-sticker-picker');
                if (picker) picker.classList.remove('active');
            };
            grid.appendChild(item);
        });

        // 用JS直接量出格子实际宽度，把高度钉成一样的数字，强制变成正方形——
        // 不再依赖任何CSS的自动计算技巧（试过两次都在这个面板的布局环境下失效），这样不会再有出错的空间
        requestAnimationFrame(function () {
            var items = grid.querySelectorAll('.cinema-sticker-item');
            items.forEach(function (el) {
                var w = el.offsetWidth;
                if (w > 0) el.style.height = w + 'px';
            });
        });
    }
    function _bindInputBarListeners() {
        var emojiBtn = document.getElementById('cinema-emoji-btn');
        var imgBtn = document.getElementById('cinema-img-btn');
        var imgInput = document.getElementById('cinema-image-input');
        var textInput = document.getElementById('cinema-input-field');

        if (emojiBtn) {
            emojiBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var picker = document.getElementById('cinema-sticker-picker');
                if (!picker) return;
                var willOpen = !picker.classList.contains('active');
                picker.classList.toggle('active', willOpen);
                if (willOpen) _renderCinemaStickerGrid();
            });
        }
    // 发图片消息前，如果云端已连接，先传一份上去，拿到 oss:// 地址再发消息——
    // 跟主聊天/相册/纪念日发图片是同一套做法，这样发出去的图片才是持久地址，
    // 能被整体云同步机制带上、换设备也能看到，不会只留在这一台设备本地。
    // 没连云端或上传失败就退回本地 dataURL 直接发，保证功能不中断。
    function _cinemaPushImageMsg(dataUrl) {
        if (window.CloudSync && window.CloudSync.isConnected() && window.CloudMedia) {
            window.CloudMedia.upload(dataUrl, 'cinema-chat-img').then(function (r) {
                _pushMessage({ type: 'image', content: (r && r.url) || dataUrl });
            }).catch(function () {
                _pushMessage({ type: 'image', content: dataUrl });
            });
        } else {
            _pushMessage({ type: 'image', content: dataUrl });
        }
    }
        if (imgBtn && imgInput) {
            imgBtn.addEventListener('click', function () { imgInput.click(); });
            imgInput.addEventListener('change', function (e) {
                var file = e.target.files && e.target.files[0];
                if (!file) return;
                if (typeof optimizeImage === 'function') {
                    optimizeImage(file).then(function (dataUrl) {
                        _cinemaPushImageMsg(dataUrl);
                    }).catch(function () {
                        var reader = new FileReader();
                        reader.onload = function (ev) { _cinemaPushImageMsg(ev.target.result); };
                        reader.readAsDataURL(file);
                    });
                } else {
                    var reader = new FileReader();
                    reader.onload = function (ev) { _cinemaPushImageMsg(ev.target.result); };
                    reader.readAsDataURL(file);
                }
                e.target.value = '';
            });
        }
        if (textInput) {
            textInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    var val = textInput.value.trim();
                    if (val) {
                        _pushMessage({ type: 'text', content: val });
                        textInput.value = '';
                    }
                }
            });
        }
    }
    function _bindOutsideClickOnce() {
        if (_outsideClickBound) return;
        _outsideClickBound = true;
        document.addEventListener('click', function (e) {
            var picker = document.getElementById('cinema-sticker-picker');
            if (!picker || !picker.classList.contains('active')) return;
            if (picker.contains(e.target)) return;
            if (e.target.closest && e.target.closest('#cinema-emoji-btn')) return;
            picker.classList.remove('active');
        });
    }

    // ── 渲染：空状态 ────────────────────────────────────
    function _renderEmpty() {
        _clearWaitTimer();
        _exitTheaterMode();
        var panel = _getPanel();
        if (!panel) return;

        var negoActive = !!(_negoState && _negoState.active);
        var partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '梦角';
        var isUserTurn = negoActive && _negoState.turn === 'user'; // 球在用户这边，该表态了

        var bodyHtml;
        if (isUserTurn) {
            // 不管这轮是梦角一开始就邀请的，还是你邀请梦角、梦角换了时间反弹回来的，
            // 只要是"梦角提议的时间在等你回应"，就用同一套三按钮面板，不用分场景
            bodyHtml =
                '<div class="cinema-screen-wrap">' +
                    '<div class="cinema-empty-icon"><i class="fas fa-film"></i></div>' +
                    '<div class="cinema-empty-text">' + _escapeHtml(partnerName) + '邀你一起看《' + _escapeHtml(_negoState.movieTitle) + '》</div>' +
                '</div>' +
                '<div class="cinema-invite-response-card">' +
                    '<div class="cinema-invite-response-time">' + _escapeHtml(_negoState.dateStr) + '  ' + _escapeHtml(_negoState.timeStr) + '</div>' +
                    '<div class="cinema-invite-response-actions">' +
                        '<button class="cinema-invite-resp-btn cinema-invite-resp-btn--decline" id="cinema-resp-decline">拒绝</button>' +
                        '<button class="cinema-invite-resp-btn cinema-invite-resp-btn--secondary" id="cinema-resp-reschedule">更换时间</button>' +
                        '<button class="cinema-invite-resp-btn cinema-invite-resp-btn--primary" id="cinema-resp-accept">同意</button>' +
                    '</div>' +
                '</div>';
        } else {
            var emptyText = negoActive ? ('邀请已发出，等' + _escapeHtml(partnerName) + '回主聊天里的消息～') : '还没有约定观影';
            var btnHtml = negoActive
                ? '<button class="cinema-invite-btn" id="cinema-invite-btn" disabled>等待' + _escapeHtml(partnerName) + '回复中…</button>' +
                  '<button class="cinema-cancel-invite-btn" id="cinema-cancel-invite-btn">取消邀请</button>'
                : '<button class="cinema-invite-btn" id="cinema-invite-btn">邀请' + _escapeHtml(partnerName) + '一起观影</button>';
            bodyHtml =
                '<div class="cinema-screen-wrap">' +
                    '<div class="cinema-empty-icon"><i class="fas fa-film"></i></div>' +
                    '<div class="cinema-empty-text">' + emptyText + '</div>' +
                '</div>' +
                btnHtml;
        }

        panel.innerHTML = _hdHTML() + '<div class="cinema-body">' + bodyHtml + '</div>';

        if (isUserTurn) {
            document.getElementById('cinema-resp-accept').addEventListener('click', _negoAcceptCountered);
            document.getElementById('cinema-resp-reschedule').addEventListener('click', _negoOpenRescheduleModal);
            document.getElementById('cinema-resp-decline').addEventListener('click', _negoDecline);
        } else if (!negoActive) {
            document.getElementById('cinema-invite-btn').addEventListener('click', _openInviteSheet);
        } else {
            document.getElementById('cinema-cancel-invite-btn').addEventListener('click', _negoCancelInvite);
        }
        document.getElementById('cinema-archive-btn').addEventListener('click', _openArchive);
    }

    // ── 渲染：有约定（等待中）────────────────────────────
    function _renderWaiting() {
        _exitTheaterMode();
        var panel = _getPanel();
        if (!panel) return;

        var locked = !_isApptReached();

        panel.innerHTML =
            _hdHTML() +
            '<div class="cinema-body">' +
                '<div class="cinema-screen-wrap">' +
                    '<div class="cinema-waiting-icon"><i class="fas fa-film"></i></div>' +
                    '<div class="cinema-waiting-movie">' + _escapeHtml(_fakeAppt.movieTitle) + '</div>' +
                    '<div class="cinema-waiting-sub">' + (locked ? '待到观影时间' : '时间已到，可以选片开始了') + '</div>' +
                '</div>' +
                '<div class="cinema-appt-card">' +
                    '<div class="cinema-appt-badge">待观影</div>' +
                    '<div class="cinema-appt-movie">' + _escapeHtml(_fakeAppt.movieTitle) + '</div>' +
                    '<div class="cinema-appt-time">' + _fakeAppt.dateStr + '&nbsp;&nbsp;' + _fakeAppt.timeStr + '</div>' +
                    '<div class="cinema-appt-actions">' +
                        '<button class="cinema-cancel-btn" id="cinema-cancel-btn">取消约定</button>' +
                        '<button class="cinema-start-btn" id="cinema-start-btn"' + (locked ? ' disabled' : '') + '>选择影片并开始</button>' +
                    '</div>' +
                    (locked ? '<div class="cinema-appt-countdown">' + _countdownText() + '后可选择影片</div>' : '') +
                    '<button type="button" class="cinema-test-source-link" id="cinema-waiting-test-source">先测试一下片源？</button>' +
                '</div>' +
            '</div>';

        document.getElementById('cinema-waiting-test-source').addEventListener('click', _testVideoSource);

        document.getElementById('cinema-cancel-btn').addEventListener('click', function () {
            _clearWaitTimer();
            if (_showtimeReminderTimer) { clearTimeout(_showtimeReminderTimer); _showtimeReminderTimer = null; }
            _uiState = 'empty';
            _apptSave();
            _cinemaRender();
        });

        var startBtn = document.getElementById('cinema-start-btn');
        if (startBtn && !locked) {
            startBtn.addEventListener('click', function () {
                _openVideoSourceModal(function (src, title, type) {
                    _clearWaitTimer();
                    _currentVideo.src = src;
                    _currentVideo.title = title;
                    _currentVideo.type = type || 'video';
                    _immersive = true;
                    _renderLoading();
                    setTimeout(function () {
                        _uiState = 'watching';
                        _watchStartedAt = Date.now();
                        window._cinemaWatching = true;
                        _apptSave();
                        _cinemaSendWatchEvent(true);
                        _scheduleWatchAutoEnd();
                        _cinemaRender();
                    }, 1650);
                });
            });
        }
        document.getElementById('cinema-archive-btn').addEventListener('click', _openArchive);

        // 未到时间：定时轮询，一旦解锁自动刷新按钮态
        _clearWaitTimer();
        if (locked) {
            _waitLockTimer = setInterval(function () {
                if (_isApptReached()) {
                    _clearWaitTimer();
                    if (_uiState === 'waiting') _renderWaiting();
                }
            }, 20000);
        }
    }

    // ── 渲染：观影中（沉浸/嵌入两种视图共用同一套播放器+工具栏+聊天）──
    function _renderWatching() {
        _clearWaitTimer();
        var panel = _getPanel();
        if (!panel) return;

        if (_immersive) {
            _enterTheaterMode();
        } else {
            _exitTheaterMode();
        }

        var title = _currentVideo.title || _fakeAppt.movieTitle;
        var headerHTML = _immersive ? _theaterHdHTML() : _hdHTML();
        var isBili = _currentVideo.type === 'bilibili';
        var playerHTML = isBili
            ? '<iframe id="cinema-video" class="cinema-video cinema-video-iframe" src="' + _currentVideo.src + '" ' +
                  'scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>'
            : '<video id="cinema-video" class="cinema-video" controls playsinline webkit-playsinline>' +
                  '<source src="' + _currentVideo.src + '" type="video/mp4">' +
              '</video>';

        panel.innerHTML =
            headerHTML +
            '<div class="cinema-watch-video-pad">' +
                '<div class="cinema-player-wrap" id="cinema-player-wrap">' +
                    playerHTML +
                    (_immersive ? '' :
                        '<button class="cinema-immersive-btn" id="cinema-immersive-btn" title="进入沉浸模式">' +
                            '<i class="fas fa-expand"></i>' +
                        '</button>'
                    ) +
                '</div>' +
            '</div>' +
            '<div class="cinema-watch-toolbar">' +
                '<button class="cinema-tool-btn" id="cinema-change-film-btn"><i class="fas fa-exchange-alt"></i> 换片</button>' +
                '<span class="cinema-watch-title" id="cinema-watch-title">' + _escapeHtml(title) + '</span>' +
                '<button class="cinema-tool-btn cinema-tool-end" id="cinema-end-btn"><i class="fas fa-stop-circle"></i> 结束观影</button>' +
            '</div>' +
            '<div class="cinema-body cinema-body-watch">' +
                _chatAreaHTML() +
                '<div class="cinema-typing-fixed" id="cinema-typing-fixed" style="display:none;"></div>' +
                _inputBarHTML() +
            '</div>';

        // 聊天区域刚重新画出来，里面可能有新的云端图片占位标签（比如切换沉浸/嵌入模式、
        // 换片时整个面板都会重画一次）——这里直接绑一次，不依赖调用方记得手动补这一步，
        // 避免"图片一直卡在空白占位、没有任何加载痕迹"这种问题。
        _bindCinemaCloudImages(panel);

        if (_immersive) {
            _bindTheaterHdListeners();
        } else {
            var archiveBtn = document.getElementById('cinema-archive-btn');
            if (archiveBtn) archiveBtn.addEventListener('click', _openArchive);
            // 嵌入视图下：只用右上角的独立按钮进入沉浸模式，不再监听整个视频区域的点击——
            // 之前"点视频框任意位置都能进沉浸模式"跟点原生播放按钮冲突了（iOS 上尤其明显，
            // 点播放这个 tap 会冒泡到外层容器，被误判成"要进沉浸模式"，导致点播放却跳转)
            var immersiveBtn = document.getElementById('cinema-immersive-btn');
            if (immersiveBtn) {
                immersiveBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    _immersive = true;
                    _renderWatching();
                });
            }
        }

        // 视频加载失败检测：不能只靠 error 事件——有些"假直链"(比如网盘分享链接，
        // 服务器返回的其实是登录页/提示页，不是真视频数据)浏览器不一定会触发标准的
        // error，只会卡在一个空白、时长 0:00 的播放器上。所以加一层超时兜底：
        // 8秒内既没有真正加载出内容、也没有报错，就直接当失败处理。
        // 用 token 机制防止连续换片时，上一次的检测干扰这一次的判断。
        var videoEl = document.getElementById('cinema-video');
        _watchVideoLoad(videoEl);

        document.getElementById('cinema-change-film-btn').addEventListener('click', function () {
            _openVideoSourceModal(function (src, title, type) {
                var video = document.getElementById('cinema-video');
                if (video && video.tagName === 'VIDEO' && video.src && video.src.indexOf('blob:') === 0) {
                    URL.revokeObjectURL(video.src);
                }
                _currentVideo.src = src;
                _currentVideo.title = title;
                _currentVideo.type = type || 'video';
                // 换片可能是"普通视频→B站"或反过来，标签本身不一样(<video>↔<iframe>)，
                // 没法直接改 src 了事，干脆整个面板重渲染一次，简单可靠
                _renderWatching();
            });
        });
        document.getElementById('cinema-end-btn').addEventListener('click', function () {
            var doEnd = function () {
                var watchedTitle = _currentVideo.title || _fakeAppt.movieTitle || '这部电影';
                var startedAt = _watchStartedAt;
                _endWatchingCleanup();
                _exitTheaterMode();
                var durationMin = startedAt ? Math.round((Date.now() - startedAt) / 60000) : null;
                _cinemaSendWatchEvent(false, durationMin);
                _openRatingSheet(watchedTitle);
            };
            _cinemaCenterConfirm('结束观影', '确定要结束观影吗？', '结束观影', doEnd);
        });

        _bindInputBarListeners();
    }

    // ── 统一渲染入口 ─────────────────────────────────────
    function _cinemaRender() {
        if (_uiState === 'empty')        _renderEmpty();
        else if (_uiState === 'waiting') _renderWaiting();
        else if (_uiState === 'watching')_renderWatching();
        _bindCinemaCloudImages(_getPanel());
    }

    // ── 档案页 ───────────────────────────────────────────
    var _archiveTab = 'history'; // 'history' | 'watchlist'
    var _archiveTabsBound = false;

    // 待看清单：独立持久化，跟 period.js 一样用 keys() 扫描避免 SESSION_ID 异步问题
    var _watchlist = [];
    var _wlLoaded = false;
    var _wlStorageKey = null;

    async function _wlGetKey() {
        if (_wlStorageKey) return _wlStorageKey;
        try {
            var allKeys = await localforage.keys();
            var found = allKeys.find(function (k) { return k.indexOf('_cinemaWatchlist') !== -1; });
            if (found) { _wlStorageKey = found; return found; }
            var msgKey = allKeys.find(function (k) { return k.indexOf('chatMessages') !== -1; });
            var prefix = msgKey ? msgKey.replace('chatMessages', '') : 'CHAT_APP_V3_';
            _wlStorageKey = prefix + '_cinemaWatchlist';
        } catch (e) {
            _wlStorageKey = 'CHAT_APP_V3__cinemaWatchlist';
        }
        return _wlStorageKey;
    }
    async function _wlLoad() {
        if (_wlLoaded) return;
        try {
            var key = await _wlGetKey();
            var saved = await localforage.getItem(key);
            if (Array.isArray(saved)) _watchlist = saved;
        } catch (e) { console.warn('[cinema] 待看清单加载失败:', e); }
        _wlLoaded = true;
    }
    async function _wlSave() {
        try {
            var key = await _wlGetKey();
            await localforage.setItem(key, _watchlist);
        } catch (e) { console.warn('[cinema] 待看清单保存失败:', e); }
    }

    function _wlAdd(title) {
        title = String(title || '').trim();
        if (!title) return;
        _watchlist.unshift({ id: Date.now() + Math.random(), title: title, watched: false, stars: 0, ts: Date.now() });
        _wlSave();
        _renderWatchlistContent();
    }
    function _wlToggleWatched(id) {
        var item = _watchlist.find(function (w) { return String(w.id) === String(id); });
        if (!item) return;
        item.watched = !item.watched;
        _wlSave();
        _renderWatchlistContent();
    }
    function _wlSetStars(id, stars) {
        var item = _watchlist.find(function (w) { return String(w.id) === String(id); });
        if (!item) return;
        item.stars = stars;
        _wlSave();
        _renderWatchlistContent();
    }
    function _wlDelete(id) {
        var doDelete = function () {
            _watchlist = _watchlist.filter(function (w) { return String(w.id) !== String(id); });
            _wlSave();
            _renderWatchlistContent();
        };
        if (typeof _alShowConfirm === 'function') {
            _alShowConfirm('删除待看', '删除后无法恢复，确定吗？', '删除', true, doDelete);
        } else if (confirm('确定要删除这条待看记录吗？')) {
            doDelete();
        }
    }

    function _wlItemHTML(item) {
        var stars = '';
        for (var i = 1; i <= 5; i++) {
            var filled = i <= (item.stars || 0);
            stars += '<i class="fas fa-star cinema-wl-star' + (filled ? ' filled' : '') + '" data-star="' + i + '"></i>';
        }
        return '<div class="cinema-wl-item' + (item.watched ? ' cinema-wl-watched' : '') + '" data-id="' + item.id + '">' +
            '<div class="cinema-wl-check" data-action="toggle"><i class="fas fa-check"></i></div>' +
            '<div class="cinema-wl-body">' +
                '<div class="cinema-wl-title">' + _escapeHtml(item.title) + '</div>' +
                '<div class="cinema-wl-stars" data-action="stars">' + stars + '</div>' +
            '</div>' +
            '<button class="cinema-wl-delete" data-action="delete"><i class="fas fa-trash-alt"></i></button>' +
        '</div>';
    }
    function _renderWatchlistContent() {
        var content = document.getElementById('cinema-archive-content');
        if (!content) return;
        var listHTML = _watchlist.length
            ? _watchlist.map(_wlItemHTML).join('')
            : '<div class="cinema-archive-empty">暂无待看片单</div>';
        content.innerHTML =
            '<div class="cinema-wl-addrow">' +
                '<input type="text" class="cinema-wl-add-input" id="cinema-wl-add-input" placeholder="想看的片名…" maxlength="60">' +
                '<button class="cinema-wl-add-btn" id="cinema-wl-add-btn"><i class="fas fa-plus"></i></button>' +
            '</div>' +
            '<div class="cinema-wl-list">' + listHTML + '</div>';

        var input = document.getElementById('cinema-wl-add-input');
        var addBtn = document.getElementById('cinema-wl-add-btn');
        function doAdd() {
            _wlAdd(input.value);
            input.value = '';
            input.focus();
        }
        if (addBtn) addBtn.addEventListener('click', doAdd);
        if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doAdd(); });

        content.querySelectorAll('.cinema-wl-item').forEach(function (el) {
            var id = el.dataset.id;
            var checkEl = el.querySelector('[data-action="toggle"]');
            if (checkEl) checkEl.addEventListener('click', function () { _wlToggleWatched(id); });
            var starsEl = el.querySelector('[data-action="stars"]');
            if (starsEl) {
                starsEl.querySelectorAll('.cinema-wl-star').forEach(function (starEl) {
                    starEl.addEventListener('click', function (e) {
                        e.stopPropagation();
                        _wlSetStars(id, parseInt(starEl.dataset.star, 10));
                    });
                });
            }
            var delEl = el.querySelector('[data-action="delete"]');
            if (delEl) delEl.addEventListener('click', function (e) { e.stopPropagation(); _wlDelete(id); });
        });
    }
    // ── 观看历史：独立持久化（跟待看清单一样的 keys() 扫描方式）──
    var _history = [];
    var _histLoaded = false;
    var _histStorageKey = null;
    var _histEditingId = null;

    async function _histGetKey() {
        if (_histStorageKey) return _histStorageKey;
        try {
            var allKeys = await localforage.keys();
            var found = allKeys.find(function (k) { return k.indexOf('_cinemaHistory') !== -1; });
            if (found) { _histStorageKey = found; return found; }
            var msgKey = allKeys.find(function (k) { return k.indexOf('chatMessages') !== -1; });
            var prefix = msgKey ? msgKey.replace('chatMessages', '') : 'CHAT_APP_V3_';
            _histStorageKey = prefix + '_cinemaHistory';
        } catch (e) {
            _histStorageKey = 'CHAT_APP_V3__cinemaHistory';
        }
        return _histStorageKey;
    }
    async function _histLoad() {
        if (_histLoaded) return;
        try {
            var key = await _histGetKey();
            var saved = await localforage.getItem(key);
            if (Array.isArray(saved)) _history = saved;
        } catch (e) { console.warn('[cinema] 观看历史加载失败:', e); }
        _histLoaded = true;
    }
    async function _histSave() {
        try {
            var key = await _histGetKey();
            await localforage.setItem(key, _history);
        } catch (e) { console.warn('[cinema] 观看历史保存失败:', e); }
    }

    function _histFormatDateTime(ts) {
        var d = new Date(ts);
        var h = d.getHours(), m = d.getMinutes();
        return (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' +
            (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
    }
    function _histStarsHTML(stars, clickable) {
        var wrapClass = clickable ? 'cinema-hist-stars cinema-hist-stars-clickable' : 'cinema-hist-stars';
        var wrapAttr = clickable ? ' data-action="user-stars"' : '';
        var html = '<span class="' + wrapClass + '"' + wrapAttr + '>';
        for (var i = 1; i <= 5; i++) {
            var filled = i <= (stars || 0);
            html += '<i class="fas fa-star cinema-hist-star' + (filled ? ' filled' : '') + '" data-star="' + i + '"></i>';
        }
        html += '</span>';
        return html;
    }
    // 头像 + 星星一行 + 影评一行（读卡展示用，梦角/用户共用同一个模板）
    function _histPersonBlockHTML(isPartner, name, stars, review, emptyPlaceholder) {
        var reviewHtml = review
            ? '<div class="cinema-hist-review-text">' + _escapeHtml(review) + '</div>'
            : '<div class="cinema-hist-review-empty">' + _escapeHtml(emptyPlaceholder) + '</div>';
        return '<div class="cinema-hist-person">' +
            '<div class="cinema-hist-person-row">' +
                '<div class="cinema-hist-person-avatar">' + _avatarHTML(isPartner, 44) + '</div>' +
                _histStarsHTML(stars, false) +
            '</div>' +
            reviewHtml +
        '</div>';
    }
    function _histEntryHTML(e) {
        var partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '梦角';
        var partnerBlock = _histPersonBlockHTML(true, partnerName, e.partnerStars, e.partnerReview, partnerName + '还没有写影评');
        var userBlock = _histPersonBlockHTML(false, '我', e.userStars, e.userReview, '点击此处添加影评…');
        return '<div class="cinema-hist-entry" data-id="' + e.id + '">' +
            '<div class="cinema-hist-title">' + _escapeHtml(e.title) + '</div>' +
            '<div class="cinema-hist-meta">' + _histFormatDateTime(e.ts) + '</div>' +
            '<div class="cinema-hist-reviews">' + partnerBlock + userBlock + '</div>' +
        '</div>';
    }
    function _renderHistoryContent() {
        var content = document.getElementById('cinema-archive-content');
        if (!content) return;
        if (!_history.length) {
            content.innerHTML = '<div class="cinema-archive-empty">暂无观影记录</div>';
            return;
        }
        var sorted = _history.slice().sort(function (a, b) { return b.ts - a.ts; });
        content.innerHTML = '<div class="cinema-hist-list">' + sorted.map(_histEntryHTML).join('') + '</div>';
        content.querySelectorAll('.cinema-hist-entry').forEach(function (el) {
            el.addEventListener('click', function () { _histOpenEditor(el.dataset.id); });
        });
    }

    // ── 观看历史：编辑弹层（片名 + 我的评价/评分可改，梦角评价只读）──
    function _histOpenEditor(id) {
        var entry = _history.find(function (e) { return String(e.id) === String(id); });
        if (!entry) return;
        _histEditingId = id;
        var partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '梦角';
        var old = document.getElementById('cinema-hist-edit-sheet');
        if (old) old.remove();
        var sheet = document.createElement('div');
        sheet.id = 'cinema-hist-edit-sheet';
        sheet.className = 'cinema-hist-edit-sheet';
        var editUserStars = entry.userStars || 0;
        sheet.innerHTML =
            '<div class="cinema-hist-edit-mask" id="cinema-hist-edit-mask"></div>' +
            '<div class="cinema-hist-edit-body">' +
                '<div class="cinema-hist-edit-label">片名</div>' +
                '<input type="text" class="cinema-hist-edit-input" id="cinema-hist-edit-title" maxlength="60" value="' + _escapeHtml(entry.title) + '">' +
                ((entry.partnerReview || entry.partnerStars > 0)
                    ? '<div class="cinema-hist-edit-label">' + _escapeHtml(partnerName) + '的评价</div>' +
                      '<div class="cinema-hist-edit-readonly">' +
                        _histStarsHTML(entry.partnerStars, false) +
                        (entry.partnerReview ? '<div style="margin-top:6px;">' + _escapeHtml(entry.partnerReview) + '</div>' : '') +
                      '</div>'
                    : '') +
                '<div class="cinema-hist-edit-label">我的评分</div>' +
                '<div id="cinema-hist-edit-stars">' + _histStarsHTML(editUserStars, true) + '</div>' +
                '<div class="cinema-hist-edit-label">我的评价</div>' +
                '<textarea class="cinema-hist-edit-textarea" id="cinema-hist-edit-review" maxlength="200" placeholder="写点什么吧…">' + _escapeHtml(entry.userReview || '') + '</textarea>' +
                '<div class="cinema-hist-edit-actions">' +
                    '<button class="cinema-hist-edit-cancel" id="cinema-hist-edit-cancel">取消</button>' +
                    '<button class="cinema-hist-edit-save" id="cinema-hist-edit-save">保存</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(sheet);

        var starsWrap = document.getElementById('cinema-hist-edit-stars');
        function refreshStars() {
            starsWrap.innerHTML = _histStarsHTML(editUserStars, true);
            bindStarClicks();
        }
        function bindStarClicks() {
            starsWrap.querySelectorAll('.cinema-hist-star').forEach(function (starEl) {
                starEl.addEventListener('click', function () {
                    editUserStars = parseInt(starEl.dataset.star, 10);
                    refreshStars();
                });
            });
        }
        bindStarClicks();

        function close() { sheet.remove(); _histEditingId = null; }
        document.getElementById('cinema-hist-edit-mask').addEventListener('click', close);
        document.getElementById('cinema-hist-edit-cancel').addEventListener('click', close);
        document.getElementById('cinema-hist-edit-save').addEventListener('click', function () {
            var titleVal = document.getElementById('cinema-hist-edit-title').value.trim();
            var reviewVal = document.getElementById('cinema-hist-edit-review').value.trim();
            if (titleVal) entry.title = titleVal;
            entry.userReview = reviewVal;
            entry.userStars = editUserStars;
            _histSave();
            close();
            _renderHistoryContent();
        });
    }

    // ── 调试专用：注入假观看历史数据，方便预览设计 ──────────
    window._cinemaDebugSeedHistory = function () {
        var now = Date.now();
        var day = 86400000;
        _history = _history.concat([
            { id: now + 1, title: '阿嫚的情书', ts: now - day * 1,  partnerReview: '这段太戳心了，我看哭了', partnerStars: 5, userReview: '结局猜到了但还是很感动', userStars: 4 },
            { id: now + 2, title: '深夜食堂 S01E03', ts: now - day * 3,  partnerReview: '', partnerStars: 3, userReview: '适合睡前看，很治愈', userStars: 4 },
            { id: now + 3, title: 'error.mp4',        ts: now - day * 5,  partnerReview: '这个我们下次再看一遍吧', partnerStars: 0, userReview: '', userStars: 0 },
            { id: now + 4, title: '风起',              ts: now - day * 9,  partnerReview: '摄影很好看', partnerStars: 4, userReview: '剧情有点拖', userStars: 2 }
        ]);
        _histSave();
        if (_archiveTab === 'history') _renderHistoryContent();
        console.log('[cinema] 已注入 4 条假观看历史，当前共', _history.length, '条');
    };
    window._cinemaDebugClearHistory = function () {
        _history = [];
        _histSave();
        if (_archiveTab === 'history') _renderHistoryContent();
        console.log('[cinema] 观看历史已清空');
    };

    function _renderArchiveContent() {
        if (_archiveTab === 'watchlist') _renderWatchlistContent();
        else _renderHistoryContent();
    }
    function _bindArchiveTabsOnce() {
        if (_archiveTabsBound) return;
        _archiveTabsBound = true;
        var historyTab = document.getElementById('cinema-tab-history');
        var watchlistTab = document.getElementById('cinema-tab-watchlist');
        if (historyTab) historyTab.addEventListener('click', function () {
            _archiveTab = 'history';
            historyTab.classList.add('active');
            if (watchlistTab) watchlistTab.classList.remove('active');
            _renderArchiveContent();
        });
        if (watchlistTab) watchlistTab.addEventListener('click', function () {
            _archiveTab = 'watchlist';
            watchlistTab.classList.add('active');
            if (historyTab) historyTab.classList.remove('active');
            _renderArchiveContent();
        });
    }
    function _openArchive() {
        var page = document.getElementById('cinema-archive-page');
        if (page) page.classList.add('cinema-archive-open');
        // 隐藏主面板，防止透明档案页时内容从后面漏出
        var panel = document.getElementById('cs-panel-cinema');
        if (panel) panel.style.visibility = 'hidden';
        _bindArchiveTabsOnce();
        Promise.all([_wlLoad(), _histLoad()]).then(function () {
            _renderArchiveContent();
        });
    }
    window._cinemaCloseArchive = function () {
        var page = document.getElementById('cinema-archive-page');
        if (page) page.classList.remove('cinema-archive-open');
        // 恢复主面板可见性
        var panel = document.getElementById('cs-panel-cinema');
        if (panel) panel.style.visibility = '';
    };

    // ── 调试专用：跳过邀请/倒计时，直接切状态（浏览器控制台里手动调用）──
    window._cinemaDebugGoto = function (state) {
        _uiState = state;
        _apptSave();
        _cinemaRender();
    };
    // 把约定时间改成"刚刚"，强制解锁选片按钮（waiting 状态下调用）
    window._cinemaDebugUnlock = function () {
        var now = new Date();
        _fakeAppt.dateStr = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日';
        _fakeAppt.timeStr = '00:00';
        _apptSave();
        if (_uiState === 'waiting') _renderWaiting();
    };
    // 把约定时间改成 1 小时后，强制锁定选片按钮，方便看倒计时文案
    window._cinemaDebugLock = function () {
        var future = new Date(Date.now() + 3600000);
        _fakeAppt.dateStr = future.getFullYear() + '年' + (future.getMonth() + 1) + '月' + future.getDate() + '日';
        _fakeAppt.timeStr = String(future.getHours()).padStart(2, '0') + ':' + String(future.getMinutes()).padStart(2, '0');
        _apptSave();
        if (_uiState === 'waiting') _renderWaiting();
    };

    // 清空约定状态持久化数据，方便测试（回到最初的"待邀请"）
    window._cinemaDebugResetAppt = function () {
        _uiState = 'empty';
        _fakeAppt = { movieTitle: '阿嫚的情书', dateStr: '2026年8月3日', timeStr: '20:30' };
        _apptSave();
        _cinemaRender();
        console.log('[cinema] 约定状态已重置为 empty');
    };
    // ── 调试专用：诊断梦角不回复 ──────────────────────────
    // 控制台运行 _cinemaDebugReply() 可看到字卡池状态，并强制触发一次回复
    window._cinemaDebugReply = function () {
        var pool = _cinemaBuildReplyPool();
        console.log('[cinema] 字卡池大小:', pool.length, '条');
        if (pool.length === 0) {
            var rawLen = (typeof customReplies !== 'undefined' && Array.isArray(customReplies))
                ? customReplies.length : '变量不可用';
            console.log('[cinema] customReplies 原始条数:', rawLen);
            console.log('[cinema] 原因可能：① 字卡库为空 ② 字卡全部被禁用 ③ customReplies 未加载');
        } else {
            console.log('[cinema] 样例字卡:', pool.slice(0, 3));
            console.log('[cinema] 正在强制触发一次回复（复用主聊天 _triggerDelayedReply）...');
            if (typeof window._triggerDelayedReply === 'function') window._triggerDelayedReply(true);
        }
        return pool;
    };

    // ── 对外暴露 ─────────────────────────────────────────
    // ── 供 companion.js / call.js 调用的统一判断：观影中，或者约定时间前2小时内，
    //    都不应该弹陪伴邀请/视频通话邀请（避免撞车，也避免用户正准备看电影时被打扰）──
    window._cinemaShouldBlockInterruptions = function () {
        if (window._cinemaWatching) return true;
        if (_uiState === 'waiting') {
            var d = _parseApptDate();
            if (d && (d.getTime() - Date.now()) <= 2 * 3600000) return true;
        }
        return false;
    };

    // ── 一次性搬家：修复"心愿单/观影历史等没有云同步"这个bug之前，
    //    这几类数据被误存到了不带 SESSION_ID 的旧通用key下（比如
    //    CHAT_APP_V3__cinemaWatchlist），云同步认不出这种key，导致换设备看不到。
    //    这里检测一次，把数据原样搬到正确的、带 SESSION_ID 的key下，搬完删掉旧key。
    //    只搬"新key还没有数据"的情况，避免覆盖掉新key下可能已经存在的数据。
    var _cinemaLegacyMigrated = false;
    async function _cinemaMigrateLegacyKeys() {
        if (_cinemaLegacyMigrated) return;
        _cinemaLegacyMigrated = true;
        var jobs = [
            { suffix: '_cinemaAppt', getKey: _apptGetKey },
            { suffix: '_cinemaWatchlist', getKey: _wlGetKey },
            { suffix: '_cinemaHistory', getKey: _histGetKey },
            { suffix: '_cinemaNego', getKey: _negoGetKey },
            { suffix: '_cinemaPartnerInvite', getKey: _partnerInviteGetKey }
        ];
        for (var i = 0; i < jobs.length; i++) {
            var job = jobs[i];
            try {
                var legacyKey = 'CHAT_APP_V3_' + job.suffix; // 旧bug产生的通用格式（没有 SESSION_ID）
                var legacyVal = await localforage.getItem(legacyKey);
                if (legacyVal === undefined || legacyVal === null) continue; // 这台设备没踩过这个坑，跳过
                var properKey = await job.getKey();
                if (properKey === legacyKey) continue; // 算出来的正规key跟旧key一样，不用搬
                var existing = await localforage.getItem(properKey);
                if (existing === undefined || existing === null) {
                    await localforage.setItem(properKey, legacyVal);
                    console.log('[cinema] 已把', job.suffix, '数据从旧key搬到正规key:', properKey);
                }
                await localforage.removeItem(legacyKey);
            } catch (e) {
                console.warn('[cinema] 迁移', job.suffix, '失败:', e);
            }
        }
    }

    window._cinemaInit = function () {
        _bindOutsideClickOnce();
        _cinemaMigrateLegacyKeys();
        Promise.all([_apptLoad(), _negoLoad()]).then(function () {
            _cinemaRender();
        });
    };

    // ── 接管 csSwitchTab：切到别的功能 tab 时，如果影日志档案页还开着
    //     （全屏 overlay，z-index:50），必须先关掉，否则会一直挡住其它面板，
    //     导致"点了别的 tab 但页面没有跳转"——跟 anniversary.js 用的是同一套
    //     "包一层 window.csSwitchTab，不改 moments.js 原文件"的写法 ──
    (function () {
        function hookCsSwitchTab() {
            if (typeof window.csSwitchTab !== 'function') {
                setTimeout(hookCsSwitchTab, 100);
                return;
            }
            var orig = window.csSwitchTab;
            window.csSwitchTab = function (tab) {
                if (tab !== 'cinema') {
                    var page = document.getElementById('cinema-archive-page');
                    if (page && page.classList.contains('cinema-archive-open')) {
                        window._cinemaCloseArchive();
                    }
                }
                orig.call(this, tab);
            };
        }
        hookCsSwitchTab();
    })();

    // ── 主聊天里的"电影邀请卡"消息类型 ────────────────────
    // 包一层 window.createMessageFragment（跟上面包 csSwitchTab 同一个原理），
    // 遇到 msg.type === 'cinema-invite' 就渲染邀请卡，其余类型原样交给原函数处理，
    // 完全不用改 core.js。
    //
    // 卡片纯 CSS 画，不依赖图片素材（GitHub Pages 部署那张背景图一直 404，
    // 排查了分支/Jekyll 都没解决，索性直接用代码画一张风格类似但更简洁的卡片）。

    // 卡片有四种状态：
    //   pending   —— 用户刚发出的邀请，靠右，用户头像，没有按钮
    //   countered —— 梦角提议了新时间，靠左，梦角头像，"拒绝"/"更换时间"/"同意"三个按钮
    //   accepted  —— 最终同意，靠左，梦角头像，没有按钮，显示"约定成功"
    //   declined  —— 用户拒绝了梦角的提议，靠右，用户头像，没有按钮，显示"下次吧"
    //                （只有用户能拒绝，梦角不能拒绝用户的邀请，梦角只会同意或换时间）
    function _cinemaInviteCardFragment(msg) {
        var data = msg.cinemaInviteData || {};
        var state = data.state || 'countered';
        var isUser = state === 'pending' || state === 'declined'; // 这两种是用户自己的表态
        var partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '梦角';
        var actionsHtml;
        if (state === 'pending') {
            actionsHtml = '<div class="cinema-invite-card-status">等待' + _escapeHtml(partnerName) + '回复中…</div>';
        } else if (state === 'accepted') {
            actionsHtml = '<div class="cinema-invite-card-status cinema-invite-card-status--ok">🎉 约定成功</div>';
        } else if (state === 'expired') {
            actionsHtml = '<div class="cinema-invite-card-status cinema-invite-card-status--expired">这次没约上呢…</div>';
        } else if (state === 'declined') {
            actionsHtml = '<div class="cinema-invite-card-status cinema-invite-card-status--declined">下次吧…</div>';
        } else {
            actionsHtml =
                '<div class="cinema-invite-card-actions cinema-invite-card-actions--three">' +
                    '<button class="cinema-invite-card-btn cinema-invite-card-btn--decline" data-invite-action="decline">拒绝</button>' +
                    '<button class="cinema-invite-card-btn cinema-invite-card-btn--secondary" data-invite-action="reschedule">更换时间</button>' +
                    '<button class="cinema-invite-card-btn cinema-invite-card-btn--primary" data-invite-action="accept">同意</button>' +
                '</div>';
        }
        var fragment = new DocumentFragment();
        // 用真正的 .message-wrapper 结构（跟主聊天普通消息完全一样），
        // 这样自动继承 flex-shrink:0、sent/received 左右镜像、头像位置这些既有布局逻辑，
        // 不用自己再重新发明一套。卡片本身不套 .message 气泡样式，只是内容换成卡片。
        var wrap = document.createElement('div');
        wrap.className = 'message-wrapper ' + (isUser ? 'sent' : 'received') + ' cinema-invite-msg-wrap';
        wrap.dataset.id = msg.id;
        wrap.innerHTML =
            '<div class="message-avatar">' + _avatarHTML(!isUser, 36) + '</div>' +
            '<div class="message-content-wrapper">' +
                '<div class="cinema-invite-card" data-invite-id="' + _escapeHtml(String(data.negoId || '')) + '">' +
                    '<div class="cinema-invite-card-decor">' +
                        '<span class="d1">🍿</span><span class="d2">⭐</span>' +
                        '<span class="d3">🥤</span><span class="d4">💕</span>' +
                    '</div>' +
                    '<div class="cinema-invite-card-banner">CINEMA</div>' +
                    '<div class="cinema-invite-card-movie">' + _escapeHtml(data.movieTitle || '') + '</div>' +
                    '<div class="cinema-invite-card-time">' + _escapeHtml((data.dateStr || '') + '  ' + (data.timeStr || '')) + '</div>' +
                    '<div class="cinema-invite-card-divider"></div>' +
                    actionsHtml +
                '</div>' +
            '</div>';
        fragment.appendChild(wrap);
        return fragment;
    }

    function _hookCreateMessageFragment() {
        function tryHook() {
            if (typeof window.createMessageFragment !== 'function') {
                setTimeout(tryHook, 100);
                return;
            }
            var origFn = window.createMessageFragment;
            window.createMessageFragment = function (msg, prevMsg, nextMsg, lastSenderRef) {
                if (msg && msg.type === 'cinema-invite') {
                    if (lastSenderRef) lastSenderRef.current = (msg.sender === 'user' ? 'user' : 'partner');
                    return _cinemaInviteCardFragment(msg);
                }
                return origFn.apply(this, arguments);
            };
        }
        tryHook();
    }
    _hookCreateMessageFragment();

    // ── 钩住 window.renderMessages：检测 app 数据初始化完成时机 ──────────────
    // loadData → updateUI → renderMessages 是 app 初始化的收尾信号。
    // 只检测第一次：一旦触发就把 _appDataLoaded 置 true，
    // 并驱动 _pendingBootResolve（如果之前已经检测到了到期回复）。
    (function _hookRenderMessagesForInit() {
        var origFn = window.renderMessages;
        if (typeof origFn !== 'function') return; // core.js 未加载时的兜底，实际不会发生
        window.renderMessages = function () {
            if (!_appDataLoaded) {
                _appDataLoaded = true;
                if (_pendingBootResolve) {
                    _pendingBootResolve = false;
                    // 用 setTimeout(0) 确保在本次 renderMessages 渲染完 messages 后再触发，
                    // 不要在 renderMessages 执行中途插入 addMessage（会导致 DOM 混乱）。
                    setTimeout(_negoResolveReply, 0);
                }
            }
            return origFn.apply(this, arguments);
        };
    })();

    // 真正把卡片发到主聊天（跟 envelope.js 一样直接裸调用 addMessage，不用改 core.js）
    // sender 由 state 自动决定：pending 是用户发的，countered/accepted 是梦角发的
    function _cinemaSendInviteCard(state, movieTitle, dateStr, timeStr, negoId) {
        if (typeof addMessage !== 'function') {
            console.warn('[cinema] addMessage 不可用，无法发送邀请卡');
            return;
        }
        var sender = (state === 'pending' || state === 'declined') ? 'user' : 'partner';
        addMessage({
            id: Date.now() + Math.random(),
            sender: sender,
            text: '',
            timestamp: new Date(),
            status: sender === 'user' ? 'sent' : 'received',
            type: 'cinema-invite',
            cinemaInviteData: { state: state, movieTitle: movieTitle, dateStr: dateStr, timeStr: timeStr, negoId: negoId },
            favorited: false,
            note: null
        });
    }

    // ── 邀请协商状态：持久化，跟 tab 开不开无关，app 一启动就会检查 ──
    var _negoState = null; // null=没有进行中的协商；否则见下面结构
    var _negoLoaded = false;
    var _negoStorageKey = null;
    var _negoReplyTimer = null;
    var _negoReminderTimer = null;

    async function _negoGetKey() {
        if (_negoStorageKey) return _negoStorageKey;
        try {
            var allKeys = await localforage.keys();
            var found = allKeys.find(function (k) { return k.indexOf('_cinemaNego') !== -1; });
            if (found) { _negoStorageKey = found; return found; }
            var msgKey = allKeys.find(function (k) { return k.indexOf('chatMessages') !== -1; });
            var prefix = msgKey ? msgKey.replace('chatMessages', '') : 'CHAT_APP_V3_';
            _negoStorageKey = prefix + '_cinemaNego';
        } catch (e) {
            _negoStorageKey = 'CHAT_APP_V3__cinemaNego';
        }
        return _negoStorageKey;
    }
    async function _negoLoad() {
        if (_negoLoaded) return;
        _negoLoaded = true;
        try {
            var key = await _negoGetKey();
            var saved = await localforage.getItem(key);
            if (saved && typeof saved === 'object') _negoState = saved;
        } catch (e) { console.warn('[cinema] 协商状态加载失败:', e); }
    }
    async function _negoSave() {
        try {
            var key = await _negoGetKey();
            await localforage.setItem(key, _negoState);
        } catch (e) { console.warn('[cinema] 协商状态保存失败:', e); }
    }
    async function _negoClear() {
        _negoState = null;
        if (_negoReplyTimer) { clearTimeout(_negoReplyTimer); _negoReplyTimer = null; }
        if (_negoReminderTimer) { clearTimeout(_negoReminderTimer); _negoReminderTimer = null; }
        try {
            var key = await _negoGetKey();
            await localforage.removeItem(key);
        } catch (e) { console.warn('[cinema] 协商状态清除失败:', e); }
        _negoUpdateBadges();
    }

    // 第几次回复对应的"梦角同意"概率：第1次70%，第2次90%，第3次及以后100%
    function _negoAcceptProbability(replyIndex) {
        if (replyIndex <= 1) return 0.7;
        if (replyIndex === 2) return 0.9;
        return 1;
    }

    // ── 提醒 + 过期：只在"轮到用户回应"（_negoState.turn === 'user'）时生效 ──
    // 解析当前协商里的电影时间，算出"过期时间点" = 电影时间 - 30分钟
    function _negoComputeDeadline() {
        if (!_negoState) return null;
        var m = /(\d+)年(\d+)月(\d+)日/.exec(_negoState.dateStr || '');
        var t = /(\d+):(\d+)/.exec(_negoState.timeStr || '');
        if (!m || !t) return null;
        var movieTime = new Date(+m[1], +m[2] - 1, +m[3], +t[1], +t[2], 0, 0);
        return movieTime.getTime() - 30 * 60000;
    }
    // 排下一次"提醒/过期"事件：常规每 3~8 小时重发同一张卡；
    // 保底在"过期前 2 小时"一定有一次；到了过期时间点就直接判定没约上
    function _negoScheduleReminderCycle() {
        if (_negoReminderTimer) { clearTimeout(_negoReminderTimer); _negoReminderTimer = null; }
        if (!_negoState || !_negoState.active || _negoState.turn !== 'user') return;
        var deadline = _negoComputeDeadline();
        if (deadline === null) return; // 时间解析失败就不设这套机制，避免出错
        var now = Date.now();
        if (now >= deadline) { _negoExpire(); return; }
        var finalReminderAt = deadline - 2 * 3600000;
        var nextAt = now + (3 + Math.random() * 5) * 3600000; // 常规：3~8 小时后
        if (finalReminderAt > now && nextAt >= finalReminderAt) nextAt = finalReminderAt; // 保底
        if (nextAt >= deadline) nextAt = deadline; // 别越过过期点
        _negoState.nextReminderAt = nextAt;
        _negoSave();
        _negoReminderTimer = setTimeout(_negoReminderFire, nextAt - now);
    }
    function _negoReminderFire() {
        if (!_negoState || !_negoState.active || _negoState.turn !== 'user') return;
        var deadline = _negoComputeDeadline();
        if (deadline !== null && Date.now() >= deadline) { _negoExpire(); return; }
        // 重发同一张卡，内容跟上次完全一样，不做任何变化
        _cinemaSendInviteCard('countered', _negoState.movieTitle, _negoState.dateStr, _negoState.timeStr, _negoState.negoId);
        _negoScheduleReminderCycle();
    }
    // 到了"电影时间前30分钟"这个点还没回应，发一张"没约上"的卡（不是文字），
    // 然后清掉协商——顺便解锁梦角以后的主动邀请（不会被卡死）
    function _negoExpire() {
        if (!_negoState) return;
        _cinemaSendInviteCard('expired', _negoState.movieTitle, _negoState.dateStr, _negoState.timeStr, _negoState.negoId);
        _negoClear();
    }

    // ── 小红点：电影院tab图标 + 主聊天头部"情侣空间"入口，只要轮到用户回应就一直显示 ──
    function _negoEnsureBadgeElements() {
        var cinemaTab = document.getElementById('csp-cinema');
        if (cinemaTab && !document.getElementById('cinema-tab-invite-badge')) {
            cinemaTab.style.position = 'relative';
            var dot1 = document.createElement('span');
            dot1.id = 'cinema-tab-invite-badge';
            dot1.className = 'cinema-invite-dot';
            dot1.style.display = 'none';
            cinemaTab.appendChild(dot1);
        }
        var momentsBtn = document.getElementById('moments-header-btn');
        if (momentsBtn && !document.getElementById('cinema-header-invite-badge')) {
            var dot2 = document.createElement('span');
            dot2.id = 'cinema-header-invite-badge';
            dot2.className = 'cinema-invite-dot';
            dot2.style.display = 'none';
            momentsBtn.appendChild(dot2);
        }
    }
    function _negoUpdateBadges() {
        _negoEnsureBadgeElements();
        var show = !!(_negoState && _negoState.active && _negoState.turn === 'user');
        ['cinema-tab-invite-badge', 'cinema-header-invite-badge'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.style.display = show ? 'block' : 'none';
        });
    }

    // 生成梦角的"换时间"提议：在基准时间前后 2~3 小时内随机取一个点，尽量取整（round 到最近的半小时）
    function _negoGenerateCounterTime(dateStr, timeStr) {
        var m = /(\d+)年(\d+)月(\d+)日/.exec(dateStr || '');
        var t = /(\d+):(\d+)/.exec(timeStr || '');
        var base = (m && t) ? new Date(+m[1], +m[2] - 1, +m[3], +t[1], +t[2], 0, 0) : new Date(Date.now() + 3600000);
        var offsetHours = 2 + Math.random(); // 2~3 小时
        var sign = Math.random() < 0.5 ? -1 : 1;
        var newTime = new Date(base.getTime() + sign * offsetHours * 3600000);
        // 取整到最近的半小时
        var minutes = newTime.getMinutes();
        var roundedMinutes = minutes < 15 ? 0 : (minutes < 45 ? 30 : 60);
        newTime.setMinutes(0, 0, 0);
        if (roundedMinutes === 60) newTime.setHours(newTime.getHours() + 1);
        else newTime.setMinutes(roundedMinutes);
        // 保底：不能早于现在，否则往后推。这里给足 3 小时缓冲——"过期"判定是
        // "电影时间前30分钟"，留足缓冲能保证卡片发出去之后用户至少有几个小时
        // 可以看到、可以回应，不会刚发就被判定过期。
        if (newTime.getTime() <= Date.now()) {
            newTime = new Date(Date.now() + 3 * 3600000);
            var mm = newTime.getMinutes();
            newTime.setMinutes(0, 0, 0);
            if (mm > 30) newTime.setHours(newTime.getHours() + 1);
            else newTime.setMinutes(30);
        }
        return {
            dateStr: newTime.getFullYear() + '年' + (newTime.getMonth() + 1) + '月' + newTime.getDate() + '日',
            timeStr: String(newTime.getHours()).padStart(2, '0') + ':' + String(newTime.getMinutes()).padStart(2, '0')
        };
    }

    // 开始新一轮协商（用户主动邀请，或者用户换时间后重新提议）—— 发"等待中"卡 + 排定梦角的定时回复
    function _negoStartRound(movieTitle, dateStr, timeStr, replyIndex) {
        var negoId = 'nego-' + Date.now();
        if (_negoReminderTimer) { clearTimeout(_negoReminderTimer); _negoReminderTimer = null; }
        _negoState = {
            active: true,
            turn: 'partner', // 球在梦角那边，等它回复
            replyIndex: replyIndex, // 这是梦角接下来要做的第几次回复
            movieTitle: movieTitle,
            dateStr: dateStr,
            timeStr: timeStr,
            replyDueAt: Date.now() + (2 + Math.random() * 3) * 60000, // 2~5 分钟后
            negoId: negoId
        };
        _negoSave();
        _cinemaSendInviteCard('pending', movieTitle, dateStr, timeStr, negoId);
        if (typeof showNotification === 'function') showNotification('邀请已发出', 'success');
        _negoScheduleReply();
        _negoUpdateBadges();
    }

    function _negoScheduleReply() {
        if (_negoReplyTimer) { clearTimeout(_negoReplyTimer); _negoReplyTimer = null; }
        if (!_negoState || !_negoState.active) return;
        var delay = _negoState.replyDueAt - Date.now();
        if (delay <= 0) {
            // 回复已到期。如果是开机重载场景（messages 尚未加载），
            // 先挂起到 renderMessages 首次调用后再触发，避免被 loadData 覆盖。
            if (_appDataLoaded) {
                _negoResolveReply();
            } else {
                _pendingBootResolve = true; // _hookRenderMessagesForInit 会接手
            }
            return;
        }
        _negoReplyTimer = setTimeout(_negoResolveReply, delay);
    }

    function _negoResolveReply(forceAccept) {
        if (!_negoState || !_negoState.active) return;
        var accept = (typeof forceAccept === 'boolean') ? forceAccept : (Math.random() < _negoAcceptProbability(_negoState.replyIndex));
        if (accept) {
            _fakeAppt = { movieTitle: _negoState.movieTitle, dateStr: _negoState.dateStr, timeStr: _negoState.timeStr };
            _uiState = 'waiting';
            _apptSave();
            _cinemaSendInviteCard('accepted', _negoState.movieTitle, _negoState.dateStr, _negoState.timeStr, _negoState.negoId);
            _negoClear();
            _scheduleShowtimeReminder();
            if (_getPanel()) _cinemaRender();
        } else {
            var newTime = _negoGenerateCounterTime(_negoState.dateStr, _negoState.timeStr);
            _negoState.dateStr = newTime.dateStr;
            _negoState.timeStr = newTime.timeStr;
            _negoState.active = true;
            _negoState.turn = 'user'; // 球换到用户这边，等用户回应
            // replyIndex 不变——它代表"梦角刚做的这次回复是第几次"，用户看到后如果换时间，
            // 下一次梦角回复时 replyIndex 才 +1（见 reschedule 按钮的处理）
            _negoSave();
            _cinemaSendInviteCard('countered', _negoState.movieTitle, _negoState.dateStr, _negoState.timeStr, _negoState.negoId);
            _negoScheduleReminderCycle();
            _negoUpdateBadges();
        }
    }

    // 卡片按钮：接受梦角提议的时间
    function _negoAcceptCountered() {
        if (!_negoState || !_negoState.active) return;
        _fakeAppt = { movieTitle: _negoState.movieTitle, dateStr: _negoState.dateStr, timeStr: _negoState.timeStr };
        _uiState = 'waiting';
        _apptSave();
        _cinemaSendInviteCard('accepted', _negoState.movieTitle, _negoState.dateStr, _negoState.timeStr, _negoState.negoId);
        _negoClear();
        _scheduleShowtimeReminder();
        if (_getPanel()) _cinemaRender();
    }

    // 拒绝梦角提议的时间——只有用户能拒绝，梦角不能拒绝用户的邀请（梦角只会同意或换时间）
    function _negoDecline() {
        if (!_negoState || !_negoState.active) return;
        _cinemaSendInviteCard('declined', _negoState.movieTitle, _negoState.dateStr, _negoState.timeStr, _negoState.negoId);
        _negoClear();
        if (_getPanel()) _cinemaRender();
    }

    // 电影院tab里"取消邀请"按钮：直接撤回，不等梦角回复了
    function _negoCancelInvite() {
        _negoClear();
        if (_getPanel()) _cinemaRender();
    }

    // 卡片按钮：用户不想要梦角提议的时间，自己重新选一个（打开居中弹窗）
    function _negoOpenRescheduleModal() {
        if (!_negoState || !_negoState.active) return;
        var old = document.getElementById('cinema-reschedule-modal');
        if (old) old.remove();
        var now = new Date();
        var defaultDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        var later = new Date(now.getTime() + 3600000);
        var defaultTime = String(later.getHours()).padStart(2, '0') + ':' + String(later.getMinutes()).padStart(2, '0');

        var modal = document.createElement('div');
        modal.id = 'cinema-reschedule-modal';
        modal.className = 'cinema-invite-sheet';
        modal.innerHTML =
            '<div class="cinema-invite-mask" id="cinema-reschedule-mask"></div>' +
            '<div class="cinema-invite-body">' +
                '<div class="cinema-invite-title">换个时间</div>' +
                '<div class="cinema-invite-label">日期</div>' +
                '<input type="date" class="cinema-invite-input" id="cinema-reschedule-date" min="' + defaultDate + '" value="' + defaultDate + '">' +
                '<div class="cinema-invite-label">时间</div>' +
                '<input type="time" class="cinema-invite-input" id="cinema-reschedule-time" value="' + defaultTime + '">' +
                '<div class="cinema-invite-error" id="cinema-reschedule-error"></div>' +
                '<div class="cinema-invite-actions">' +
                    '<button class="cinema-invite-cancel" id="cinema-reschedule-cancel">取消</button>' +
                    '<button class="cinema-invite-confirm" id="cinema-reschedule-confirm">发出新时间</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);

        function close() { modal.remove(); }
        document.getElementById('cinema-reschedule-mask').addEventListener('click', close);
        document.getElementById('cinema-reschedule-cancel').addEventListener('click', close);
        document.getElementById('cinema-reschedule-confirm').addEventListener('click', function () {
            var dateVal = document.getElementById('cinema-reschedule-date').value;
            var timeVal = document.getElementById('cinema-reschedule-time').value;
            var errorEl = document.getElementById('cinema-reschedule-error');
            var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateVal || '');
            var tm = /^(\d{2}):(\d{2})$/.exec(timeVal || '');
            if (!dm || !tm) return;
            var picked = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], 0, 0);
            if (picked.getTime() <= Date.now()) {
                errorEl.textContent = '约的时间不能早于现在，改一下吧';
                return;
            }
            var newDateStr = (+dm[1]) + '年' + (+dm[2]) + '月' + (+dm[3]) + '日';
            var newTimeStr = timeVal;
            close();
            // 用户重新提议时间 → 梦角下一次回复的"第几次"要 +1（比如梦角第1次换时间后，
            // 用户重选，梦角第2次回复概率是90%）
            var nextReplyIndex = (_negoState ? _negoState.replyIndex : 1) + 1;
            _negoStartRound(_negoState.movieTitle, newDateStr, newTimeStr, nextReplyIndex);
        });
    }

    // 主聊天里邀请卡按钮的事件委托（卡片是动态插入主聊天的，绑定在 document 上）
    function _bindInviteCardDelegation() {
        document.addEventListener('click', function (e) {
            var btn = e.target.closest && e.target.closest('[data-invite-action]');
            if (!btn) return;
            var card = btn.closest('.cinema-invite-card');
            if (!card) return;
            var negoId = card.getAttribute('data-invite-id');
            if (!_negoState || _negoState.negoId !== negoId) return; // 已经是过期的卡片，不响应
            var action = btn.getAttribute('data-invite-action');
            if (action === 'accept') _negoAcceptCountered();
            else if (action === 'reschedule') _negoOpenRescheduleModal();
            else if (action === 'decline') _negoDecline();
        });
    }
    _bindInviteCardDelegation();

    // ── 梦角主动邀请：复用上面整套协商引擎，只是起点不一样 ──
    // 用户邀请梦角：先发"等待中"卡 + 计时器等梦角回复。
    // 梦角邀请用户：梦角直接把提议发出来（没有"等待"这一步，球一开始就在用户这边），
    // 用户如果点"更换时间"，才会走进 _negoStartRound 这套跟用户邀请完全一样的
    // 计时+概率逻辑（replyIndex 从 1 开始，70%/90%/100%）。
    function _negoStartFromPartner(movieTitle, dateStr, timeStr) {
        var negoId = 'nego-' + Date.now();
        _negoState = {
            active: true,
            turn: 'user', // 球一开始就在用户这边，等用户回应
            replyIndex: 0, // 用户还没被梦角"回复"过；用户换时间后才变成第1轮(70%)
            movieTitle: movieTitle,
            dateStr: dateStr,
            timeStr: timeStr,
            negoId: negoId
        };
        _negoSave();
        _cinemaSendInviteCard('countered', movieTitle, dateStr, timeStr, negoId);
        _negoScheduleReminderCycle();
        _negoUpdateBadges();
    }

    // 挑电影：80% 从心愿单挑没看过的，10% 从"看过的池子"（心愿单勾了已看过的 +
    // 影评里正式记录的观看历史，这两个合并算一类）挑一个重温，10% 直接说"一起看电影吧"
    // 不提具体片名。如果骰到的那个方向刚好没数据，再骰一次 50/50：
    // 50% 换另一个池子接着挑，50% 直接说"一起看电影吧"——两个方向都是对称的规则。
    function _pickMoviePartnerInvite() {
        var notWatchedPool = (_watchlist || []).filter(function (w) { return !w.watched; });
        var watchedPool = (_history || []).concat((_watchlist || []).filter(function (w) { return w.watched; }));

        function pickFrom(pool) { return pool[Math.floor(Math.random() * pool.length)].title; }
        function fallbackPick(altPool) {
            if (altPool.length > 0 && Math.random() < 0.5) return pickFrom(altPool);
            return '一起看电影';
        }

        var roll = Math.random();
        if (roll < 0.8) { // 80%：心愿单没看过的
            if (notWatchedPool.length > 0) return pickFrom(notWatchedPool);
            return fallbackPick(watchedPool);
        } else if (roll < 0.9) { // 10%：看过的重温
            if (watchedPool.length > 0) return pickFrom(watchedPool);
            return fallbackPick(notWatchedPool);
        } else { // 10%：直接邀请，不用管有没有数据
            return '一起看电影';
        }
    }

    // 挑时间：12~72 小时后，取整到最近的半小时
    function _pickTimePartnerInvite() {
        var future = new Date(Date.now() + (12 + Math.random() * 60) * 3600000);
        var minutes = future.getMinutes();
        var rounded = minutes < 15 ? 0 : (minutes < 45 ? 30 : 60);
        future.setMinutes(0, 0, 0);
        if (rounded === 60) future.setHours(future.getHours() + 1);
        else future.setMinutes(rounded);
        return {
            dateStr: future.getFullYear() + '年' + (future.getMonth() + 1) + '月' + future.getDate() + '日',
            timeStr: String(future.getHours()).padStart(2, '0') + ':' + String(future.getMinutes()).padStart(2, '0')
        };
    }

    function _startPartnerInvite() {
        var movieTitle = _pickMoviePartnerInvite(); // 心愿单/历史都空时会兜底成固定文案，永远有得选
        var t = _pickTimePartnerInvite();
        _negoStartFromPartner(movieTitle, t.dateStr, t.timeStr);
        return true;
    }

    // ── 定时检查：每 5~7 天一次，70% 概率触发；连续 2 次没触发，第 3 次必定触发
    //    （保证最多 15~21 天内一定会等到一次邀请，不会无限沉默）。持久化，跟
    //    tab 开不开无关，app 一启动就会检查有没有错过。 ──
    var _partnerInviteState = null; // { nextCheckAt, missedCount }
    var _partnerInviteLoaded = false;
    var _partnerInviteStorageKey = null;
    var _partnerInviteTimer = null;

    async function _partnerInviteGetKey() {
        if (_partnerInviteStorageKey) return _partnerInviteStorageKey;
        try {
            var allKeys = await localforage.keys();
            var found = allKeys.find(function (k) { return k.indexOf('_cinemaPartnerInvite') !== -1; });
            if (found) { _partnerInviteStorageKey = found; return found; }
            var msgKey = allKeys.find(function (k) { return k.indexOf('chatMessages') !== -1; });
            var prefix = msgKey ? msgKey.replace('chatMessages', '') : 'CHAT_APP_V3_';
            _partnerInviteStorageKey = prefix + '_cinemaPartnerInvite';
        } catch (e) {
            _partnerInviteStorageKey = 'CHAT_APP_V3__cinemaPartnerInvite';
        }
        return _partnerInviteStorageKey;
    }
    async function _partnerInviteLoad() {
        if (_partnerInviteLoaded) return;
        _partnerInviteLoaded = true;
        try {
            var key = await _partnerInviteGetKey();
            var saved = await localforage.getItem(key);
            if (saved && typeof saved === 'object') _partnerInviteState = saved;
        } catch (e) { console.warn('[cinema] 梦角主动邀请状态加载失败:', e); }
    }
    async function _partnerInviteSave() {
        try {
            var key = await _partnerInviteGetKey();
            await localforage.setItem(key, _partnerInviteState);
        } catch (e) { console.warn('[cinema] 梦角主动邀请状态保存失败:', e); }
    }

    function _scheduleNextPartnerInviteCheck() {
        if (_partnerInviteTimer) { clearTimeout(_partnerInviteTimer); _partnerInviteTimer = null; }
        if (!_partnerInviteState) {
            // 第一次用，从现在起 5~7 天后才第一次检查，不是装上就立刻查
            _partnerInviteState = { nextCheckAt: Date.now() + (5 + Math.random() * 2) * 86400000, missedCount: 0 };
            _partnerInviteSave();
        }
        var delay = _partnerInviteState.nextCheckAt - Date.now();
        if (delay <= 0) { _runPartnerInviteCheck(); return; }
        _partnerInviteTimer = setTimeout(_runPartnerInviteCheck, delay);
    }

    async function _runPartnerInviteCheck() {
        await Promise.all([_wlLoad(), _histLoad(), _negoLoad(), _apptLoad()]);
        // 只有在"没有约定、没有协商中"的时候才可能触发，不然会跟用户自己发的邀请撞车
        var canInvite = _uiState === 'empty' && !(_negoState && _negoState.active);
        var missed = _partnerInviteState.missedCount || 0;
        var prob = missed >= 2 ? 1 : 0.7;
        if (canInvite && Math.random() < prob) {
            _startPartnerInvite(); // 永远会成功（心愿单/历史都空时用固定文案兜底）
            _partnerInviteState.missedCount = 0;
        } else {
            _partnerInviteState.missedCount = missed + 1;
        }
        var days = 5 + Math.random() * 2;
        _partnerInviteState.nextCheckAt = Date.now() + days * 86400000;
        _partnerInviteSave();
        _scheduleNextPartnerInviteCheck();
    }

    function _partnerInviteBootCheck() {
        _partnerInviteLoad().then(_scheduleNextPartnerInviteCheck);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _partnerInviteBootCheck);
    } else {
        setTimeout(_partnerInviteBootCheck, 0);
    }

    // ── app 启动时检查：如果有正在进行的协商，恢复定时器（哪怕中途关过 app）──
    function _negoBootCheck() {
        _negoLoad().then(function () {
            if (_negoState && _negoState.active) {
                if (_negoState.turn === 'user') _negoScheduleReminderCycle();
                else _negoScheduleReply();
            }
            _negoUpdateBadges();
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _negoBootCheck);
    } else {
        setTimeout(_negoBootCheck, 0);
    }

    // ── app 启动时检查：如果已经有约定在等待观影，恢复开场前提醒的调度 ──
    function _showtimeReminderBootCheck() {
        _apptLoad().then(function () {
            if (_uiState === 'waiting') _scheduleShowtimeReminder();
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _showtimeReminderBootCheck);
    } else {
        setTimeout(_showtimeReminderBootCheck, 0);
    }

    // ── 调试专用 ──────────────────────────────────────────
    window._cinemaDebugSendInviteCard = function (movieTitle, dateStr, timeStr) {
        _cinemaSendInviteCard('countered', movieTitle || '阿嫊的情书', dateStr || '2026年8月3日', timeStr || '20:30', 'debug-' + Date.now());
        console.log('[cinema] 测试邀请卡已发送到主聊天（countered 状态，两个按钮不会真正生效，仅看样式）');
    };
    window._cinemaDebugNegoStatus = function () {
        console.log('[cinema] 当前协商状态:', _negoState);
        return _negoState;
    };
    window._cinemaDebugForceReply = function () {
        if (!_negoState || !_negoState.active) { console.log('[cinema] 目前没有进行中的协商'); return; }
        if (_negoReplyTimer) { clearTimeout(_negoReplyTimer); _negoReplyTimer = null; }
        _negoResolveReply();
        console.log('[cinema] 已强制触发梦角回复（走真实概率，可能同意也可能换时间）');
    };
    // 强制这一次回复一定是"换时间"，方便测试改时间的弹窗，不用反复重试等运气
    window._cinemaDebugForceCounter = function () {
        if (!_negoState || !_negoState.active) { console.log('[cinema] 目前没有进行中的协商'); return; }
        if (_negoReplyTimer) { clearTimeout(_negoReplyTimer); _negoReplyTimer = null; }
        _negoResolveReply(false);
        console.log('[cinema] 已强制触发"换时间"，去主聊天看新的邀请卡');
    };
    // 强制这一次回复一定是"同意"，方便测试约定成功的流程
    window._cinemaDebugForceAccept = function () {
        if (!_negoState || !_negoState.active) { console.log('[cinema] 目前没有进行中的协商'); return; }
        if (_negoReplyTimer) { clearTimeout(_negoReplyTimer); _negoReplyTimer = null; }
        _negoResolveReply(true);
        console.log('[cinema] 已强制触发"同意"');
    };

    // ── 调试专用：梦角主动邀请 ────────────────────────────
    // 不用等 5~7 天，立刻触发一次梦角主动邀请（会真正走挑电影/挑时间/发卡片的完整逻辑，
    // 心愿单和历史都是空的时候会用固定文案兜底，也要求当前是 empty 状态且没有进行中的协商）
    window._cinemaDebugTriggerPartnerInvite = function () {
        Promise.all([_wlLoad(), _histLoad(), _negoLoad(), _apptLoad()]).then(function () {
            if (_uiState !== 'empty' || (_negoState && _negoState.active)) {
                console.log('[cinema] 现在有约定或协商中，不会触发梦角主动邀请（先取消/结束当前的再试）');
                return;
            }
            _startPartnerInvite();
            console.log('[cinema] 已触发梦角主动邀请，去主聊天看邀请卡');
        });
    };
    window._cinemaDebugPartnerInviteStatus = function () {
        console.log('[cinema] 梦角主动邀请状态:', _partnerInviteState);
        return _partnerInviteState;
    };

    // 强制立刻重发一次提醒卡（不用等 3~8 小时），前提是当前轮到用户回应
    window._cinemaDebugForceReminder = function () {
        if (!_negoState || !_negoState.active || _negoState.turn !== 'user') {
            console.log('[cinema] 现在没有"轮到用户回应"的协商，不会有提醒');
            return;
        }
        if (_negoReminderTimer) { clearTimeout(_negoReminderTimer); _negoReminderTimer = null; }
        _negoReminderFire();
        console.log('[cinema] 已强制重发一次提醒卡');
    };
    // 强制立刻判定"过期/没约上"（不用等到电影时间前30分钟）
    window._cinemaDebugForceExpire = function () {
        if (!_negoState || !_negoState.active) {
            console.log('[cinema] 现在没有进行中的协商');
            return;
        }
        if (_negoReminderTimer) { clearTimeout(_negoReminderTimer); _negoReminderTimer = null; }
        _negoExpire();
        console.log('[cinema] 已强制判定"没约上"');
    };
    // 不用等到开场前2分钟，立刻弹一次开场提醒蒙层（前提：当前是 waiting 状态）
    window._cinemaDebugShowShowtimeReminder = function () {
        if (_uiState !== 'waiting') {
            console.log('[cinema] 现在不是 waiting 状态，没有约定可以提醒');
            return;
        }
        _fakeAppt.reminderShown = false; // 强制忽略"已经提醒过"这个标记
        _showShowtimeReminder();
    };
    // 不用等 6~8 小时，立刻强制自动结束观影（前提：当前是 watching 状态）
    window._cinemaDebugForceAutoEndWatch = function () {
        if (_uiState !== 'watching') {
            console.log('[cinema] 现在不是 watching 状态');
            return;
        }
        _autoEndWatching();
        console.log('[cinema] 已强制触发"自动结束观影"');
    };
    // 不用真的填个坏链接，直接看一眼"视频加载失败"弹窗长什么样
    window._cinemaDebugShowVideoError = function () {
        _showVideoLoadErrorModal();
    };
    // 跳过弹窗，直接用B站iframe进入观影中状态，测试嵌入播放效果（bvid可选，默认用一个示例BV号）
    window._cinemaDebugStartBilibili = function (bvid) {
        bvid = bvid || 'BV1xx4l1c7mD';
        _clearWaitTimer();
        if (_showtimeReminderTimer) { clearTimeout(_showtimeReminderTimer); _showtimeReminderTimer = null; }
        _currentVideo.src = 'https://player.bilibili.com/player.html?bvid=' + bvid + '&page=1&high_quality=1&danmaku=0';
        _currentVideo.title = 'B站视频';
        _currentVideo.type = 'bilibili';
        _immersive = true;
        _uiState = 'watching';
        _watchStartedAt = Date.now();
        window._cinemaWatching = true;
        _apptSave();
        _cinemaSendWatchEvent(true);
        _scheduleWatchAutoEnd();
        if (_getPanel()) _cinemaRender();
        console.log('[cinema] 已用B站iframe进入观影中状态，bvid=' + bvid);
    };
    // 跳过邀请/等待/选片，直接进入观影中状态（走完整流程：记开始时间、
    // 发"观影已开始"事件、启动6~8小时自动结束定时器），方便测试
    window._cinemaDebugStartWatching = function (title) {
        _clearWaitTimer();
        if (_showtimeReminderTimer) { clearTimeout(_showtimeReminderTimer); _showtimeReminderTimer = null; }
        if (!_fakeAppt.movieTitle) _fakeAppt.movieTitle = title || '阿嫊的情书';
        _currentVideo.src = '';
        _currentVideo.title = title || _fakeAppt.movieTitle || '测试片名';
        _immersive = true;
        _uiState = 'watching';
        _watchStartedAt = Date.now();
        window._cinemaWatching = true;
        _apptSave();
        _cinemaSendWatchEvent(true);
        _scheduleWatchAutoEnd();
        if (_getPanel()) _cinemaRender();
        console.log('[cinema] 已直接进入观影中状态（没有真实视频文件，播放器会是空的，但周边逻辑都是真实跑的）');
    };
    // 专门用来测"嵌入模式点播放会不会误跳沉浸模式"这个bug——用网上的小样片当视频源，
    // 不用你自己传文件，直接落在嵌入(非沉浸)视图，手机上可以直接点播放测试
    window._cinemaDebugTestEmbeddedPlay = function () {
        _clearWaitTimer();
        if (_showtimeReminderTimer) { clearTimeout(_showtimeReminderTimer); _showtimeReminderTimer = null; }
        if (!_fakeAppt.movieTitle) _fakeAppt.movieTitle = '测试片名';
        _currentVideo.src = 'https://www.w3schools.com/html/mov_bbb.mp4';
        _currentVideo.title = '测试样片_mov_bbb';
        _immersive = false; // 直接落在嵌入模式，不是沉浸模式
        _uiState = 'watching';
        _watchStartedAt = Date.now();
        window._cinemaWatching = true;
        _apptSave();
        if (_getPanel()) _cinemaRender();
        console.log('[cinema] 已进入嵌入模式，播放器加载了一个网上的测试样片。现在点一下播放按钮，看会不会跳到沉浸模式——不跳就是修好了');
    };

})();
