/* ═══════════════════════════════════════════════════════════════
   音乐厅（娱乐板块）：
   · 上半：旋转唱片播放器卡片（可自定义唱片图、心跳线/进度线颜色、播放模式）
   · 下半：聊天框，边听歌边聊天，记录同步主聊天
   · 歌单页：左歌单 / 右设置（音乐导入、自定义唱片、线条颜色）
   · 梦角音乐邀请：MUSIC 卡片（现在听 / 拒绝），1~2 天检查一次 70% 触发，
     连续 2 次没触发第 3 次必触发；触发后 75% 指定歌单曲目、25% 不指定
   ═══════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // 存储键：按梦角隔离，与 getStorageKey 同构(APP_PREFIX+SESSION_ID+'_'+base)。
    // 旧版用 CHAT_APP_V3__* 全局裸键跨对象共享，先一次性迁入当前对象命名空间。
    function mhKey(base) {
        return (typeof window.appSessionKey === 'function') ? window.appSessionKey(base) : ('CHAT_APP_V3_' + base);
    }
    (function () {
        if (typeof window.migrateGlobalKeysToSession === 'function') {
            window.migrateGlobalKeysToSession(
                ['CHAT_APP_V3__mhSongs', 'CHAT_APP_V3__mhSettings', 'CHAT_APP_V3__mhInvite', 'CHAT_APP_V3__mhMessages'],
                function (oldKey) { return mhKey(oldKey.replace(/^CHAT_APP_V3__/, '')); }
            );
        }
    }());
    // 歌单本体(可能含音频 base64)改走 IndexedDB(localforage)：容量远大于 localStorage，
    // 结构化克隆不产生超长单字符串，避免大歌单 stringify 造成的 OOM/闪退，也不受配额限制丢歌。

    function lsGet(k, fb) {
        try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : fb; } catch (e) { return fb; }
    }
    function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    function esc(s) {
        return (typeof _escapeHtml === 'function') ? _escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
    }
    function partnerName() { return (typeof settings !== 'undefined' && settings.partnerName) || '梦角'; }

    // ── 状态 ──────────────────────────────────────────────
    var songs = lsGet(mhKey('mhSongs'), []);
    var conf = Object.assign({ hbColor: '#ff9f9d', progColor: '#c5a47e', ctrlColor: '#7a9cc6', vinylLabel: null, playMode: 'list', bubbleStyle: 'standard', mhCss: '' }, lsGet(mhKey('mhSettings'), {}));
    var cur = -1, playing = false, mode = conf.playMode || 'list'; // list(歌单循环) | single(单曲循环) | shuffle(随机播放)
    var messages = lsGet(mhKey('mhMessages'), []); // 音乐厅聊天记录：落盘保留，重启不丢
    var invite = lsGet(mhKey('mhInvite'), { next: 0, missed: 0, active: null });
    var audio = null, _booted = false, _rendered = false;
    // 音乐厅本地引发、待梦角回复的计数：只把音乐厅里的对话镜像进来，聊天页引发的对话不混入
    var mhReplyPending = 0, _mhPendingTimer = null;
    function mhMarkReplyPending() {
        mhReplyPending++;
        if (_mhPendingTimer) clearTimeout(_mhPendingTimer);
        _mhPendingTimer = setTimeout(function () { mhReplyPending = 0; _mhPendingTimer = null; }, 15000);
    }

    function saveSongs() {
        // 含音频本体(data: 前缀)的歌单 → 只写 IndexedDB；纯链接小歌单同时镜像 localStorage
        var hasEmbedded = false;
        for (var i = 0; i < songs.length; i++) {
            if (songs[i].url && songs[i].url.indexOf('data:') === 0) { hasEmbedded = true; break; }
        }
        if (typeof localforage !== 'undefined') {
            localforage.setItem(mhKey('mhSongs_lf'), songs).catch(function (e) {
                console.warn('[musichall] IndexedDB 歌单写入失败:', e);
            });
        }
        // 纯链接小歌单镜像 localStorage 兼容老版本读取；含音频本体的歌单跳过（防 stringify OOM）
        if (!hasEmbedded && songs.length <= 50) {
            try { localStorage.setItem(mhKey('mhSongs'), JSON.stringify(songs)); } catch (e) {}
        }
    }
    function saveConf() { lsSet(mhKey('mhSettings'), conf); }
    function saveInvite() { lsSet(mhKey('mhInvite'), invite); }
    function saveMessages() {
        lsSet(mhKey('mhMessages'), messages);
    }

    // 找到播放中的歌曲（供邀请卡"现在听"按名字定位）
    function findSongByTitle(t) {
        for (var i = 0; i < songs.length; i++) if (songs[i].title === t) return i;
        return -1;
    }

    // ── 主面板渲染 ────────────────────────────────────────
    function renderPanel() {
        var panel = document.getElementById('cs-panel-musichall');
        if (!panel) return;
        _rendered = true;
        panel.innerHTML = _hdHTML() + _playerHTML() + _chatHTML() + '<audio id="mh-audio"></audio>';
        // 注入线条颜色
        panel.style.setProperty('--mh-hb-c', conf.hbColor);
        panel.style.setProperty('--mh-prog-c', conf.progColor);
        panel.style.setProperty('--mh-ctrl-c', conf.ctrlColor);

        var btn = panel.querySelector('#mh-playlist-btn');
        if (btn) btn.addEventListener('click', function () { window._mhOpenPlaylistPage(); });

        audio = panel.querySelector('#mh-audio');
        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('play', function () { setPlay(true); });
        audio.addEventListener('pause', function () { setPlay(false); });

        bindControls(panel);
        bindChat(panel);

        applyMhCustomCss(conf.mhCss);

        syncPlayerUI();
    }

    function _hdHTML() {
        return '<div class="mh-hd">' +
            '<span class="mh-hd-title">音乐厅</span>' +
            '<button class="cs-icon-btn mh-playlist-btn" id="mh-playlist-btn" title="歌单与设置"><i class="fas fa-music"></i></button>' +
        '</div>';
    }

    function _playerHTML() {
        var song = songs.length ? songs[cur >= 0 ? cur : 0] : null;
        return '<div class="mh-player">' +
            '<div class="mh-vinyl-wrap">' + _vinylHTML() + '</div>' +
            '<div class="mh-info">' +
                '<div class="mh-song-title" id="mh-song-title">' + (song ? esc(song.title) : '未选择歌曲') + '</div>' +
                '<div class="mh-song-sub" id="mh-song-sub">' + (song && song.sub ? esc(song.sub) : '') + '</div>' +
                '<div class="mh-hb-line">' +
                    '<svg viewBox="0 0 372 165" class="mh-hb-svg" preserveAspectRatio="none">' +
                        '<path id="mh-hb-path" class="mh-hb-path" d="M13,83 L14,83 L15,83 L16,83 L17,83 L18,83 L19,83 L20,83 L21,83 L22,83 L23,83 L24,83 L25,83 L26,83 L27,83 L28,83 L29,83 L30,83 L31,83 L32,83 L33,83 L34,82 L35,81 L36,79 L37,74 L38,69 L39,65 L40,62 L41,62 L42,62 L43,74 L44,88 L45,97 L46,97 L47,97 L48,93 L49,89 L50,85 L51,82 L52,78 L53,78 L54,78 L55,79 L56,81 L57,82 L58,83 L59,83 L60,83 L61,81 L62,79 L63,78 L64,76 L65,73 L66,72 L67,71 L68,71 L69,71 L70,74 L71,76 L72,79 L73,82 L74,85 L75,88 L76,88 L77,88 L78,84 L79,79 L80,79 L81,79 L82,81 L83,85 L84,87 L85,91 L86,94 L87,94 L88,94 L89,83 L90,83 L91,83 L92,88 L93,88 L94,88 L95,83 L96,80 L97,76 L98,74 L99,74 L100,74 L101,77 L102,80 L103,83 L104,86 L105,86 L106,86 L107,85 L108,83 L109,82 L110,80 L111,79 L112,78 L113,78 L114,78 L115,78 L116,78 L117,79 L118,80 L119,81 L120,82 L121,82 L122,82 L123,80 L124,77 L125,74 L126,73 L127,73 L128,73 L129,77 L130,80 L131,84 L132,87 L133,91 L134,91 L135,91 L136,87 L137,83 L138,79 L139,74 L140,70 L141,70 L142,70 L143,74 L144,80 L145,87 L146,94 L147,94 L148,94 L149,90 L150,79 L151,65 L152,58 L153,58 L154,58 L155,64 L156,72 L157,78 L158,84 L159,86 L160,86 L161,86 L162,84 L163,81 L164,79 L165,78 L166,77 L167,77 L168,77 L169,77 L170,78 L171,79 L172,79 L173,80 L174,82 L175,83 L176,83 L177,83 L178,83 L179,83 L180,82 L181,81 L182,81 L183,81 L184,82 L185,82 L186,82 L187,80 L188,78 L189,77 L190,75 L191,75 L192,75 L193,78 L194,81 L195,84 L196,87 L197,89 L198,89 L199,89 L200,86 L201,83 L202,79 L203,75 L204,70 L205,65 L206,59 L207,59 L208,59 L209,65 L210,70 L211,76 L212,82 L213,89 L214,93 L215,104 L216,104 L217,104 L218,111 L219,111 L220,105 L221,105 L222,105 L223,99 L224,94 L225,89 L226,84 L227,78 L228,75 L229,70 L230,68 L231,68 L232,68 L233,71 L234,75 L235,78 L236,82 L237,85 L238,86 L239,86 L240,86 L241,84 L242,81 L243,80 L244,78 L245,77 L246,77 L247,77 L248,77 L249,78 L250,79 L251,81 L252,83 L253,85 L254,88 L255,88 L256,88 L257,86 L258,81 L259,78 L260,75 L261,75 L262,75 L263,79 L264,83 L265,86 L266,86 L267,86 L268,77 L269,70 L270,70 L271,62 L272,58 L273,58 L274,64 L275,75 L276,75 L277,88 L278,97 L279,104 L280,104 L281,104 L282,99 L283,94 L284,89 L285,85 L286,80 L287,76 L288,72 L289,69 L290,67 L291,67 L292,67 L293,70 L294,72 L295,75 L296,78 L297,81 L298,83 L299,85 L300,85 L301,85 L302,84 L303,83 L304,82 L305,81 L306,79 L307,78 L308,77 L309,77 L310,77 L311,77 L312,77 L313,77 L314,78 L315,79 L316,79 L317,80 L318,81 L319,82 L320,84 L321,84 L322,84 L323,82 L324,81 L325,80 L326,79 L327,78 L328,78 L329,78 L330,78 L331,79 L332,81 L333,82 L334,83 L335,83 L336,83 L337,83 L338,83 L339,83 L340,83 L341,83 L342,83 L343,83 L344,83 L345,83 L346,83 L347,83 L348,83 L349,83 L350,83 L351,83 L352,83 L353,83 L354,83 L355,83 L356,83 L357,82" fill="none" stroke="var(--mh-hb-c)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
                        '<path id="mh-hb-flow" class="mh-hb-flow" d="M13,83 L14,83 L15,83 L16,83 L17,83 L18,83 L19,83 L20,83 L21,83 L22,83 L23,83 L24,83 L25,83 L26,83 L27,83 L28,83 L29,83 L30,83 L31,83 L32,83 L33,83 L34,82 L35,81 L36,79 L37,74 L38,69 L39,65 L40,62 L41,62 L42,62 L43,74 L44,88 L45,97 L46,97 L47,97 L48,93 L49,89 L50,85 L51,82 L52,78 L53,78 L54,78 L55,79 L56,81 L57,82 L58,83 L59,83 L60,83 L61,81 L62,79 L63,78 L64,76 L65,73 L66,72 L67,71 L68,71 L69,71 L70,74 L71,76 L72,79 L73,82 L74,85 L75,88 L76,88 L77,88 L78,84 L79,79 L80,79 L81,79 L82,81 L83,85 L84,87 L85,91 L86,94 L87,94 L88,94 L89,83 L90,83 L91,83 L92,88 L93,88 L94,88 L95,83 L96,80 L97,76 L98,74 L99,74 L100,74 L101,77 L102,80 L103,83 L104,86 L105,86 L106,86 L107,85 L108,83 L109,82 L110,80 L111,79 L112,78 L113,78 L114,78 L115,78 L116,78 L117,79 L118,80 L119,81 L120,82 L121,82 L122,82 L123,80 L124,77 L125,74 L126,73 L127,73 L128,73 L129,77 L130,80 L131,84 L132,87 L133,91 L134,91 L135,91 L136,87 L137,83 L138,79 L139,74 L140,70 L141,70 L142,70 L143,74 L144,80 L145,87 L146,94 L147,94 L148,94 L149,90 L150,79 L151,65 L152,58 L153,58 L154,58 L155,64 L156,72 L157,78 L158,84 L159,86 L160,86 L161,86 L162,84 L163,81 L164,79 L165,78 L166,77 L167,77 L168,77 L169,77 L170,78 L171,79 L172,79 L173,80 L174,82 L175,83 L176,83 L177,83 L178,83 L179,83 L180,82 L181,81 L182,81 L183,81 L184,82 L185,82 L186,82 L187,80 L188,78 L189,77 L190,75 L191,75 L192,75 L193,78 L194,81 L195,84 L196,87 L197,89 L198,89 L199,89 L200,86 L201,83 L202,79 L203,75 L204,70 L205,65 L206,59 L207,59 L208,59 L209,65 L210,70 L211,76 L212,82 L213,89 L214,93 L215,104 L216,104 L217,104 L218,111 L219,111 L220,105 L221,105 L222,105 L223,99 L224,94 L225,89 L226,84 L227,78 L228,75 L229,70 L230,68 L231,68 L232,68 L233,71 L234,75 L235,78 L236,82 L237,85 L238,86 L239,86 L240,86 L241,84 L242,81 L243,80 L244,78 L245,77 L246,77 L247,77 L248,77 L249,78 L250,79 L251,81 L252,83 L253,85 L254,88 L255,88 L256,88 L257,86 L258,81 L259,78 L260,75 L261,75 L262,75 L263,79 L264,83 L265,86 L266,86 L267,86 L268,77 L269,70 L270,70 L271,62 L272,58 L273,58 L274,64 L275,75 L276,75 L277,88 L278,97 L279,104 L280,104 L281,104 L282,99 L283,94 L284,89 L285,85 L286,80 L287,76 L288,72 L289,69 L290,67 L291,67 L292,67 L293,70 L294,72 L295,75 L296,78 L297,81 L298,83 L299,85 L300,85 L301,85 L302,84 L303,83 L304,82 L305,81 L306,79 L307,78 L308,77 L309,77 L310,77 L311,77 L312,77 L313,77 L314,78 L315,79 L316,79 L317,80 L318,81 L319,82 L320,84 L321,84 L322,84 L323,82 L324,81 L325,80 L326,79 L327,78 L328,78 L329,78 L330,78 L331,79 L332,81 L333,82 L334,83 L335,83 L336,83 L337,83 L338,83 L339,83 L340,83 L341,83 L342,83 L343,83 L344,83 L345,83 L346,83 L347,83 L348,83 L349,83 L350,83 L351,83 L352,83 L353,83 L354,83 L355,83 L356,83 L357,82" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="mh-controls">' +
                    '<button class="mh-ctrl" id="mh-prev" title="上一首"><i class="fas fa-step-backward"></i></button>' +
                    '<button class="mh-ctrl mh-ctrl-star" id="mh-play" title="播放/暂停">' +
                        '<i class="fas fa-play" id="mh-ico-play"></i>' +
                        '<i class="fas fa-pause" id="mh-ico-pause" style="display:none"></i>' +
                    '</button>' +
                    '<button class="mh-ctrl" id="mh-next" title="下一首"><i class="fas fa-step-forward"></i></button>' +
                '</div>' +
                '<div class="mh-progress-row">' +
                    '<span id="mh-cur-time">0:00</span>' +
                    '<div class="mh-progress"><div class="mh-progress-fill" id="mh-progress-fill" style="width:0%"></div><div class="mh-progress-thumb"></div></div>' +
                    '<span id="mh-dur-time">0:00</span>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    function _vinylHTML() {
        var style = conf.vinylLabel ? 'background-image:url(\'' + conf.vinylLabel + '\')' : '';
        return '<div class="mh-vinyl' + (playing ? ' mh-spinning' : '') + '">' +
            '<div class="mh-vinyl-art" style="' + style + '"></div>' +
            '<div class="mh-vinyl-center"></div>' +
            '<div class="mh-vinyl-spindle"></div>' +
        '</div>';
    }

    function _chatHTML() {
        var empty = !messages.length;
        // 只渲染最近 MH_MAX_MSGS 条：消息很多时音乐厅面板一次性塞全部 base64 图片会拖卡切换页面
        var MAX = 200;
        var shown = messages.slice(Math.max(0, messages.length - MAX));
        return '<div class="mh-chat-panel">' +
            '<div class="mh-chat-area" id="mh-chat-area">' +
                (empty
                    ? '<div class="mh-chat-empty"><i class="far fa-comment-dots"></i><p>边听歌边聊聊吧</p></div>'
                    : shown.map(_msgHTML).join('')) +
            '</div>' +
            '<div class="mh-emoji-panel" id="mh-emoji-panel"></div>' +
            '<div class="mh-chat-input-row">' +
                '<button class="mh-chat-emoji" id="mh-chat-emoji" title="表情"><i class="fas fa-smile"></i></button>' +
                '<input class="mh-chat-input" id="mh-chat-input" placeholder="说点什么…" maxlength="500">' +
                '<button class="mh-chat-send" id="mh-chat-send"><i class="fas fa-paper-plane"></i></button>' +
            '</div>' +
        '</div>';
    }

    function bubbleClass() {
        var bs = conf.bubbleStyle || 'standard';
        return 'mh-msg-bubble bubble-' + (bs === 'rounded' ? 'rounded' : bs === 'rounded-large' ? 'rounded-large' : bs === 'square' ? 'square' : 'standard');
    }

    function _msgHTML(m) {
        var mine = m.sender === 'user';
        var bubble;
        if (m.image) {
            var isCloud = String(m.image).indexOf('oss://') === 0;
            bubble = '<div class="' + bubbleClass() + ' mh-msg-img"><img data-mh-cloud="' + (isCloud ? '1' : '0') + '" ' + (isCloud ? '' : 'src="' + esc(m.image) + '"') + ' alt="表情"></div>';
        } else {
            bubble = '<div class="' + bubbleClass() + '">' + esc(m.content) + '</div>';
        }
        return '<div class="mh-msg ' + (mine ? 'mh-msg--me' : 'mh-msg--partner') + '">' +
            (mine ? '' : '<div class="mh-msg-av">' + mhAvatarHTML(true) + '</div>') +
            bubble +
            (mine ? '<div class="mh-msg-av">' + mhAvatarHTML(false) + '</div>' : '') +
        '</div>';
    }

    // 音乐厅消息头像：跟随系统设置的真实头像（无头像时兜底为图标）
    function mhAvatarHTML(isPartner) {
        if (typeof _avEl === 'function') return _avEl(isPartner, 28);
        return isPartner ? '<i class="fas fa-music"></i>' : '<i class="fas fa-user"></i>';
    }

    // ── 本地文件存储（加法式：仅当 Filesystem 可用且歌曲走文件引用时启用）────
    // 原 base64 直接塞 songs[].url 的逻辑完全保留；只有"新导入的本地文件"额外
    // 写入应用目录存为真实文件，songs[].url 留空、songs[].localFile 记文件名，
    // 播放时才 readFile 按需读入内存，避免大量 base64 常驻导致 OOM 闪退。
    function _mhMusicFs() {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) return window.Capacitor.Plugins.Filesystem;
        return null;
    }
    function _mhExtFromMime(m) {
        var low = String(m || '').toLowerCase();
        if (low.indexOf('mpeg') >= 0 || low.indexOf('mp3') >= 0) return '.mp3';
        if (low.indexOf('m4a') >= 0 || low.indexOf('aac') >= 0) return '.m4a';
        if (low.indexOf('wav') >= 0) return '.wav';
        if (low.indexOf('flac') >= 0) return '.flac';
        if (low.indexOf('ogg') >= 0) return '.ogg';
        return '.mp3';
    }
    function _mhLocalPath(name) { return 'music/' + name; }

    // ── 播放控制 ──────────────────────────────────────────
    // 兼容回调：本地文件歌曲的 base64 需异步 readFile 获得，读完才回调继续播放；
    // 普通 base64/云端/远程 url 歌曲则同步 resolve，回调立即执行，行为与原版一致。
    function loadSong(index, cb) {
        if (!songs.length) { if (typeof cb === 'function') cb(false); return; }
        if (index >= songs.length) index = 0;
        if (index < 0) index = songs.length - 1;
        cur = index;
        syncPlayerUI();
        if (!audio) { if (typeof cb === 'function') cb(false); return; }
        var s = songs[cur];
        var finish = function (src) { audio.src = src; audio.load(); if (typeof cb === 'function') cb(true); };
        if (s && s.localFile && _mhMusicFs()) {
            _mhMusicFs().readFile({ path: _mhLocalPath(s.localFile), directory: 'DATA' }).then(function (r) {
                if (r && r.data) { finish('data:' + (s.mime || 'audio/mpeg') + ';base64,' + r.data); }
                else { finish(''); if (typeof showNotification === 'function') showNotification('本地音频缺失：' + s.title, 'error'); }
            }).catch(function (e) {
                console.warn('[musichall] 读取本地文件失败(回退空源):', e);
                finish(''); if (typeof showNotification === 'function') showNotification('本地音频读取失败：' + s.title, 'error');
            });
            return;
        }
        var rawUrl = (s && s.url) ? s.url : '';
        if (rawUrl && typeof window.resolveAudioUrl === 'function') {
            // 外链歌曲(http://)先做 https 兜底解析再播放，规避混合内容拦截
            window.resolveAudioUrl(rawUrl).then(function (finalUrl) { finish(finalUrl); });
        } else {
            finish(rawUrl);
        }
    }
    function playCur() {
        if (!songs.length) { showNotification('歌单为空，请先导入歌曲', 'warning'); return; }
        if (cur < 0 || cur >= songs.length) { loadSong(0, _playAfterLoad); return; }
        if (!audio.src) { loadSong(cur, _playAfterLoad); return; }
        _playAfterLoad(true);
    }
    function _playAfterLoad(ok) {
        if (!audio) return;
        if (ok === false) { /* 加载失败已在上层提示 */ return; }
        var p = audio.play();
        if (p && p.catch) p.catch(function (e) { console.error('[musichall] 播放失败', e); showNotification('播放失败，请检查音频链接', 'error'); });
    }
    function togglePlay() {
        if (!songs.length) { showNotification('歌单为空，请先导入歌曲', 'warning'); return; }
        if (playing) audio.pause();
        else playCur();
    }
    function nextIdx() {
        if (mode === 'shuffle') return songs.length ? Math.floor(Math.random() * songs.length) : -1;
        return songs.length ? (cur + 1) % songs.length : -1;
    }
    function setPlay(on) {
        playing = on;
        var playEl = document.getElementById('mh-ico-play');
        var pauseEl = document.getElementById('mh-ico-pause');
        if (playEl) playEl.style.display = on ? 'none' : 'block';
        if (pauseEl) pauseEl.style.display = on ? 'block' : 'none';
        syncVinylSpin();
    }
    function syncVinylSpin() {
        var v = document.querySelector('#cs-panel-musichall .mh-vinyl');
        if (v) v.classList.toggle('mh-spinning', playing);
    }
    function onTimeUpdate() {
        if (!audio) return;
        var fill = document.getElementById('mh-progress-fill');
        var ct = document.getElementById('mh-cur-time');
        var dt = document.getElementById('mh-dur-time');
        if (fill && audio.duration) fill.style.width = (audio.currentTime / audio.duration * 100) + '%';
        if (ct) ct.textContent = fmt(audio.currentTime);
        if (dt && audio.duration) dt.textContent = fmt(audio.duration);
    }
    function onEnded() {
        if (mode === 'single') { audio.currentTime = 0; playCur(); return; }
        var n = nextIdx();
        if (n >= 0) loadSong(n, _playAfterLoad);
        else if (!songs.length) { /* 无曲目不动作 */ }
    }
    function fmt(sec) {
        if (isNaN(sec)) return '0:00';
        var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }
    function bindControls(panel) {
        var play = panel.querySelector('#mh-play');
        var prev = panel.querySelector('#mh-prev');
        var next = panel.querySelector('#mh-next');
        if (play) play.addEventListener('click', togglePlay);
        if (prev) prev.addEventListener('click', function () { if (!songs.length) return; loadSong(cur - 1, _playAfterLoad); });
        if (next) next.addEventListener('click', function () { if (!songs.length) return; var n = nextIdx(); loadSong(n, _playAfterLoad); });
    }
    function syncPlayerUI() {
        var t = document.getElementById('mh-song-title');
        var sub = document.getElementById('mh-song-sub');
        var song = songs.length ? songs[cur >= 0 ? cur : 0] : null;
        if (t) t.textContent = song ? song.title : '未选择歌曲';
        if (sub) sub.textContent = song && song.sub ? song.sub : '';
        // 歌单页里刷新选中态
        var list = document.getElementById('mh-list-wrap');
        if (list && list.querySelectorAll) {
            list.querySelectorAll('.mh-song-row').forEach(function (r) {
                r.classList.toggle('is-cur', String(r.getAttribute('data-idx')) === String(cur));
            });
        }
    }

    // ── 音乐厅聊天：同步主聊天 ──────────────────────────
    function bindChat(panel) {
        var input = panel.querySelector('#mh-chat-input');
        var send = panel.querySelector('#mh-chat-send');
        var emojiBtn = panel.querySelector('#mh-chat-emoji');
        var emojiPanel = panel.querySelector('#mh-emoji-panel');
        if (emojiBtn && emojiPanel) { buildEmojiPanel(emojiPanel); }
        function doSend() {
            if (!input) return;
            var text = input.value.trim();
            if (!text) return;
            messages.push({ sender: 'user', content: text, ts: Date.now() });
            appendMsg(messages[messages.length - 1]);
            saveMessages();
            input.value = '';
            if (emojiPanel) emojiPanel.classList.remove('open');
            if (typeof addMessage === 'function') {
                    addMessage({
                        id: Date.now() + Math.random(),
                        sender: 'user',
                        text: text,
                        timestamp: new Date(),
                        status: 'sent',
                        type: 'normal',
                        favorited: false,
                        note: null
                    });
                }
                // 与陪伴页消息规则一致：真实用户消息后触发梦角回复
                mhTriggerReply();
                mhMarkReplyPending();
            }
        if (send) send.addEventListener('click', doSend);
        if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });
        if (emojiBtn && emojiPanel) {
            emojiBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (!emojiPanel.classList.contains('open') && typeof buildEmojiPanel === 'function') buildEmojiPanel(emojiPanel);
                emojiPanel.classList.toggle('open');
            });
        }
        if (!window._mhEmojiDocBound) {
            window._mhEmojiDocBound = true;
            document.addEventListener('click', function (e) {
                var p = document.getElementById('mh-emoji-panel');
                var b = document.getElementById('mh-chat-emoji');
                if (!p || !p.classList.contains('open')) return;
                if (p.contains(e.target) || (b && b.contains(e.target))) return;
                p.classList.remove('open');
            });
        }
    }
    function appendMsg(m) {
        var area = document.getElementById('mh-chat-area');
        if (!area) return;
        var empty = area.querySelector('.mh-chat-empty');
        if (empty) empty.remove();
        var tmp = document.createElement('div');
        tmp.innerHTML = _msgHTML(m);
        area.appendChild(tmp.firstChild);
        area.scrollTop = area.scrollHeight;
    }

    // ── 音乐厅聊天：表情包（与聊天页表情功能一致；样式仿微信：添加表情标题＋加号格子＋4列贴纸网格） ─────────
    // 表情包图片源：我的表情 + 对方表情（与聊天页一致）
    function mhStickerArray() {
        var out = [];
        if (typeof myStickerLibrary !== 'undefined' && Array.isArray(myStickerLibrary)) out = out.concat(myStickerLibrary);
        if (typeof stickerLibrary !== 'undefined' && Array.isArray(stickerLibrary)) out = out.concat(stickerLibrary);
        return out;
    }
    // 触发梦角回复：与陪伴页/主聊天同一回复引擎，保证消息规则一致（含 readNoReply、清陪伴静默标志）
    function mhTriggerReply() {
        if (typeof window._triggerDelayedReply === 'function') {
            window._triggerDelayedReply(true);
            return;
        }
        if (typeof simulateReply !== 'function') return;
        var dmin = (typeof settings !== 'undefined' && settings.replyDelayMin) ? settings.replyDelayMin : 700;
        var dmax = (typeof settings !== 'undefined' && settings.replyDelayMax) ? settings.replyDelayMax : 1500;
        setTimeout(simulateReply, dmin + Math.random() * (dmax - dmin));
    }
    // 发送表情包图片（同步主聊天并触发梦角回复）
    function mhSendImage(src) {
        var s = String(src || '');
        if (!s) return;
        messages.push({ sender: 'user', content: '', image: s, ts: Date.now() });
        appendMsg(messages[messages.length - 1]);
        saveMessages();
        if (typeof addMessage === 'function') {
            addMessage({ id: Date.now() + Math.random(), sender: 'user', text: '', image: s, timestamp: new Date(), status: 'sent', type: 'normal', favorited: false, note: null });
        }
        if (typeof playSound === 'function') playSound('send');
        var panel = document.getElementById('mh-emoji-panel');
        if (panel) panel.classList.remove('open');
        mhTriggerReply();
        mhMarkReplyPending();
    }
    function buildEmojiPanel(panel) {
        panel.innerHTML = '';
        var content = document.createElement('div');
        content.className = 'combo-content-area mh-combo-content';
        panel.appendChild(content);

        var header = document.createElement('div');
        header.className = 'mh-emoji-header';
        header.textContent = '添加表情';
        content.appendChild(header);

        function render() {
            var old = content.querySelector('.sticker-grid-view');
            if (old) old.remove();
            var grid = document.createElement('div');
            grid.className = 'sticker-grid-view';
            content.appendChild(grid);

            // 加号格子（点击 = 上传我的表情库，与聊天页一致）
            var add = document.createElement('div');
            add.className = 'sticker-grid-add';
            add.title = '添加表情';
            add.innerHTML = '<i class="fas fa-plus"></i>';
            add.addEventListener('click', function (e) {
                e.stopPropagation();
                var up = document.getElementById('my-sticker-quick-upload');
                if (up) up.click();
            });
            grid.appendChild(add);

            // 表情包图片（点击直接发送，我的表情 + 对方表情，与聊天页一致）
            mhStickerArray().forEach(function (src) {
                var item = document.createElement('div');
                item.className = 'sticker-grid-item';
                var isCloud = String(src).indexOf('oss://') === 0;
                var img = document.createElement('img');
                img.alt = '表情';
                if (isCloud && window.CloudMedia) window.CloudMedia.bindLazyImage(img, src);
                else img.src = src;
                item.appendChild(img);
                item.addEventListener('click', function (e) { e.stopPropagation(); mhSendImage(src); });
                grid.appendChild(item);
            });
        }
        render();
        window._mhRefreshStickerGrid = render;

        // 上传后自动刷新面板（只绑定一次，避免重复监听到处刷）
        if (!window._mhStickerUploadBound) {
            window._mhStickerUploadBound = true;
            var up = document.getElementById('my-sticker-quick-upload');
            if (up) up.addEventListener('change', function () {
                var len0 = (typeof myStickerLibrary !== 'undefined' && Array.isArray(myStickerLibrary)) ? myStickerLibrary.length : 0;
                var tries = 0;
                var chk = setInterval(function () {
                    tries++;
                    var now = (typeof myStickerLibrary !== 'undefined' && Array.isArray(myStickerLibrary)) ? myStickerLibrary.length : 0;
                    if (now > len0) { clearInterval(chk); if (window._mhRefreshStickerGrid) window._mhRefreshStickerGrid(); }
                    else if (tries > 25) clearInterval(chk);
                }, 200);
            });
        }
    }

    // 镜像梦角消息（文字/表情包图片）进音乐厅聊天区，规则与陪伴页一致（复用同一回复引擎）
    // 只镜像 live 消息，避免重复渲染用户自己的消息
    if (window._registerPartnerMessageListener && !window._mhPartnerMirrorBound) {
        window._mhPartnerMirrorBound = true;
        window._registerPartnerMessageListener(function (m) {
            try {
                if (!m || m.type !== 'normal') return;
                if (m.sender === 'user') return;
                if (!m.text && !m.image) return;
                // 只镜像音乐厅本地引发、等待中的梦角回复；聊天页引发的对话不混入音乐厅
                if (mhReplyPending <= 0) return;
                mhReplyPending--;
                messages.push({ sender: 'partner', content: m.text || '', image: m.image || null, ts: Date.now() });
                appendMsg(messages[messages.length - 1]);
                saveMessages();
            } catch (e) { console.warn('[musichall] mirror partner msg failed', e); }
        });
    }

    // ── 播放指定（供邀请卡"现在听"） ────────────────────
    window._menuPlaySong = function (title) {
        var i = title ? findSongByTitle(title) : -1;
        if (i >= 0) { loadSong(i); playCur(); } else { window._mhOpenPlaylistPage(); }
    };

    // ── 歌单页（与电影院档案页一致：顶部 tabs 切换 歌单/设置） ──
    var _mhTabsBound = false;
    function _mhBindTabsOnce() {
        if (_mhTabsBound) return;
        _mhTabsBound = true;
        var listTab = document.getElementById('mh-tab-list');
        var settingsTab = document.getElementById('mh-tab-settings');
        if (listTab) listTab.addEventListener('click', function () { _mhSwitchTab('list'); });
        if (settingsTab) settingsTab.addEventListener('click', function () { _mhSwitchTab('settings'); });
    }
    function _mhSwitchTab(which) {
        var listTab = document.getElementById('mh-tab-list');
        var settingsTab = document.getElementById('mh-tab-settings');
        var listPanel = document.getElementById('mh-panel-list');
        var settingsPanel = document.getElementById('mh-panel-settings');
        if (listTab) listTab.classList.toggle('active', which === 'list');
        if (settingsTab) settingsTab.classList.toggle('active', which === 'settings');
        if (listPanel) listPanel.classList.toggle('music-playlist-content--active', which === 'list');
        if (settingsPanel) settingsPanel.classList.toggle('music-playlist-content--active', which === 'settings');
        if (which === 'settings') renderSettings();
        else renderPlaylistList();
    }
    window._mhOpenPlaylistPage = function () {
        var page = document.getElementById('music-playlist-page');
        if (!page) return;
        _mhBindTabsOnce();
        _mhSwitchTab('list');
        page.classList.add('music-playlist-open');
        var back = page.querySelector('.music-playlist-back-btn');
        if (back) back.setAttribute('onclick', 'window._mhClosePlaylistPage()');
    };
    window._mhClosePlaylistPage = function () {
        var page = document.getElementById('music-playlist-page');
        if (page) page.classList.remove('music-playlist-open');
    };

    function renderPlaylistList() {
        var wrap = document.getElementById('mh-list-wrap');
        if (!wrap) return;
        if (!songs.length) {
            wrap.innerHTML = '<div class="mh-list-empty">歌单空空的<br>去右边"音乐导入"添加歌曲吧</div>';
            return;
        }
        wrap.innerHTML = songs.map(function (s, i) {
            return '<div class="mh-song-row' + (i === cur ? ' is-cur' : '') + '" data-idx="' + i + '">' +
                '<div class="mh-song-ico"><i class="fas ' + (i === cur && playing ? 'fa-pause' : 'fa-music') + '"></i></div>' +
                '<div class="mh-song-meta">' +
                    '<div class="mh-song-name">' + esc(s.title) + '</div>' +
                    (s.sub ? '<div class="mh-song-sub">' + esc(s.sub) + '</div>' : '') +
                '</div>' +
                '<button class="mh-song-del" data-idx="' + i + '" title="删除"><i class="fas fa-trash-alt"></i></button>' +
            '</div>';
        }).join('');
        wrap.querySelectorAll('.mh-song-del').forEach(function (d) {
            d.addEventListener('click', function (e) {
                e.stopPropagation();
                var i = Number(d.getAttribute('data-idx'));
                var s = songs[i];
                // 若删除的是本地文件歌曲，顺带清理磁盘文件（失败不阻塞，加法式删除）
                if (s && s.localFile && _mhMusicFs()) {
                    _mhMusicFs().deleteFile({ path: _mhLocalPath(s.localFile), directory: 'DATA' }).catch(function () {});
                }
                songs.splice(i, 1);
                if (cur >= songs.length) cur = songs.length - 1;
                if (cur === i && audio) { audio.pause(); audio.src = ''; }
                saveSongs();
                renderPlaylistList();
                syncPlayerUI();
            });
        });
        wrap.querySelectorAll('.mh-song-row').forEach(function (r) {
            r.addEventListener('click', function () {
                var i = Number(r.getAttribute('data-idx'));
                loadSong(i, _playAfterLoad);
                renderPlaylistList();
            });
        });
    }

    // ── 设置区：播放模式 / 音乐导入 / 自定义唱片 / 线条设置 ──
    function renderSettings() {
        renderModeSection();
        renderImportSection();
        renderVinylSection();
        renderLinesSection();
        renderCtrlSection();
        renderBubbleSection();
    }

    // 播放模式：随机播放 / 歌单循环 / 单曲循环（持久化到 conf.playMode）
    function renderModeSection() {
        var el = document.getElementById('mh-setting-mode');
        if (!el) return;
        var opts = [
            { v: 'list',    icon: 'fa-sync-alt',           name: '歌单循环', sub: '播完整个歌单' },
            { v: 'single',  icon: 'fa-redo-alt',           name: '单曲循环', sub: '单曲无限循环' },
            { v: 'shuffle', icon: 'fa-random',             name: '随机播放', sub: '随机切歌' }
        ];
        el.innerHTML =
            '<div class="mh-set-section">' +
                '<div class="mh-set-title"><i class="fas fa-play-circle"></i>播放模式</div>' +
                '<div class="mh-mode-row">' +
                    opts.map(function (o) {
                        return '<button class="mh-mode-btn' + (mode === o.v ? ' sel' : '') + '" data-mode="' + o.v + '">' +
                            '<i class="fas ' + o.icon + '"></i>' + o.name +
                            '<span class="mh-mode-sub">' + o.sub + '</span>' +
                        '</button>';
                    }).join('') +
                '</div>' +
            '</div>';
        el.querySelectorAll('.mh-mode-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                mode = b.getAttribute('data-mode');
                conf.playMode = mode;
                saveConf();
                renderModeSection();
                showNotification('播放模式已切换为「' + (mode === 'list' ? '歌单循环' : mode === 'single' ? '单曲循环' : '随机播放') + '」', 'info');
            });
        });
    }

    function renderImportSection() {
        var el = document.getElementById('mh-setting-import');
        if (!el) return;
        el.innerHTML =
            '<div class="mh-set-section">' +
                '<div class="mh-set-title"><i class="fas fa-upload"></i>音乐导入</div>' +
                '<input class="mh-import-field" id="mh-in-title" placeholder="歌曲名称 (例如: 这里的风景)">' +
                '<input class="mh-import-field" id="mh-in-sub" placeholder="歌手/备注">' +
                '<div class="mh-import-row">' +
                    '<input class="mh-import-field" id="mh-in-url" placeholder="音频链接 (mp3/m4a)">' +
                    '<button class="mh-import-file-btn" id="mh-in-file" title="导入本地文件"><i class="fas fa-folder-open"></i></button>' +
                '</div>' +
                '<button class="mh-import-go" id="mh-in-go">导入歌曲</button>' +
                '<input type="file" id="mh-in-file-input" accept=".mp3,audio/mp3,audio/mpeg,audio/*" style="display:none">' +
            '</div>';
        var fileBtn = el.querySelector('#mh-in-file');
        var fileInput = el.querySelector('#mh-in-file-input');
        var pendingDataUrl = null;
        var pendingMime = null;
        if (fileBtn && fileInput) fileBtn.addEventListener('click', function () { fileInput.click(); });
        if (fileInput) fileInput.addEventListener('change', function () {
            var f = fileInput.files[0];
            if (!f) return;
            pendingMime = (f.type && f.type.indexOf('audio/') === 0) ? f.type : ('audio/' + String(f.name.split('.').pop() || 'mpeg'));
            var reader = new FileReader();
            reader.onload = function () {
                pendingDataUrl = reader.result;
                var title = f.name.replace(/\.[^.]+$/, '');
                el.querySelector('#mh-in-title').value = title;
                el.querySelector('#mh-in-url').value = '';
                showNotification('已读取文件，点"导入歌曲"加入歌单', 'info');
            };
            reader.readAsDataURL(f);
        });
        var go = el.querySelector('#mh-in-go');
        if (go) go.addEventListener('click', function () {
            var title = el.querySelector('#mh-in-title').value.trim();
            var sub = el.querySelector('#mh-in-sub').value.trim();
            var url = el.querySelector('#mh-in-url').value.trim() || pendingDataUrl;
            if (!title || !url) { showNotification('请填写名称与音频链接/文件', 'warning'); return; }
            var ran = function () {
                songs.push({ title: title, sub: sub, url: url });
                saveSongs();
                showNotification('已添加到歌单', 'success');
                el.querySelector('#mh-in-title').value = '';
                el.querySelector('#mh-in-sub').value = '';
                el.querySelector('#mh-in-url').value = '';
                pendingDataUrl = null;
                pendingMime = null;
                renderPlaylistList();
                syncPlayerUI();
            };
            // 本地文件导入：Filesystem 可用时把 base64 写入应用目录存为真实文件，
            // songs 只记 localFile 引用（大幅降内存）；失败则回退原 base64 逻辑。
            var fs = _mhMusicFs();
            if (fs && url === pendingDataUrl && url.indexOf('data:') === 0) {
                var m = /^data:([^;]+);base64,/.exec(url);
                var mime = m ? m[1] : (pendingMime || 'audio/mpeg');
                var data = url.split(',')[1];
                var fname = 'mh_' + Date.now() + '_' + Math.floor(Math.random() * 100000) + _mhExtFromMime(mime);
                fs.writeFile({ path: _mhLocalPath(fname), data: data, directory: 'DATA', recursive: true }).then(function () {
                    songs.push({ title: title, sub: sub, url: '', localFile: fname, mime: mime });
                    saveSongs();
                    showNotification('已添加到歌单', 'success');
                    el.querySelector('#mh-in-title').value = '';
                    el.querySelector('#mh-in-sub').value = '';
                    el.querySelector('#mh-in-url').value = '';
                    pendingDataUrl = null;
                    pendingMime = null;
                    renderPlaylistList();
                    syncPlayerUI();
                }).catch(function (e) {
                    console.warn('[musichall] 写入本地文件失败，回退 base64 存储:', e);
                    ran();
                });
                return;
            }
            ran();
        });

        // ── 一键导入网易云歌单 ──────────────────────────
        el.insertAdjacentHTML('beforeend',
            '<div class="mh-netease-wrap">' +
                '<div class="mh-set-title"><i class="fas fa-cloud-arrow-down"></i>网易云歌单导入</div>' +
                '<input class="mh-import-field" id="mh-nm-link" placeholder="歌单链接或ID (例如: https://music.163.com/#/playlist?id=23234213 或 23234213)">' +
                '<div class="mh-import-row">' +
                    '<button class="mh-import-file-btn" id="mh-nm-btn" title="一键导入网易云歌单"><i class="fas fa-music"></i></button>' +
                    '<span class="mh-nm-hint">填写后自动抓取全部分组曲目</span>' +
                '</div>' +
                '<div id="mh-nm-status" class="mh-nm-status" style="display:none"></div>' +
            '</div>'
        );

        var nmBtn = el.querySelector('#mh-nm-btn');
        if (nmBtn) nmBtn.addEventListener('click', function () { neteaseImportPlaylist(); });
    }

    // 从网易云歌单链接/ID 中提取数字 ID
    function neteaseExtractId(input) {
        if (!input) return null;
        var s = String(input).trim();
        var m = s.match(/[?&#]id=(\d+)/);
        if (m) return m[1];
        m = s.match(/\/playlist\/(\d+)/);
        if (m) return m[1];
        if (/^\d+$/.test(s)) return s;
        return null;
    }

    // 一键导入网易云歌单
    function neteaseImportPlaylist() {
        var inputEl = document.getElementById('mh-nm-link');
        var statusEl = document.getElementById('mh-nm-status');
        var id = neteaseExtractId(inputEl ? inputEl.value : '');
        if (!id) { showNotification('请填写有效的网易云歌单链接或ID', 'warning'); return; }
        if (typeof showLoading === 'function') showLoading(true);
        if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = '正在获取歌单…'; statusEl.className = 'mh-nm-status'; }

        // 优先使用带播放地址的社区镜像接口，失败再回退官方开放接口（支持 JSONP，规避 CORS）
        var apis = [
            function () { return fetchJson('https://api.i-meto.com/meting/api?server=netease&type=playlist&id=' + id + '&r=' + Math.random()); },
            function () { return fetchJsonp('https://music.163.com/api/playlist/detail?id=' + id); },
            function () { return fetchJson('https://meting.qjqq.cn/api?server=netease&type=playlist&id=' + id); }
        ];

        runNetEaseApis(apis, function (songsData) {
            if (typeof showLoading === 'function') showLoading(false);
            var added = ingestNetEaseSongs(songsData);
            if (added <= 0) {
                if (statusEl) { statusEl.textContent = '未能解析歌单，请检查链接或稍后再试'; statusEl.className = 'mh-nm-status mh-nm-err'; }
                showNotification('网易云歌单导入失败', 'error');
                return;
            }
            saveSongs();
            renderPlaylistList();
            syncPlayerUI();
            if (statusEl) { statusEl.textContent = '成功导入 ' + added + ' 首歌曲'; statusEl.className = 'mh-nm-status mh-nm-ok'; }
            if (inputEl) inputEl.value = '';
            showNotification('网易云歌单导入成功，共 ' + added + ' 首', 'success');
        }, function () {
            if (typeof showLoading === 'function') showLoading(false);
            if (statusEl) { statusEl.textContent = '导入失败：无法连接网易云服务'; statusEl.className = 'mh-nm-status mh-nm-err'; }
            showNotification('网易云歌单导入失败', 'error');
        });
    }

    // 依次尝试各接口
    function runNetEaseApis(apis, done, fail) {
        if (!apis || !apis.length) { fail(); return; }
        // box 在本次导入的所有递归调用间共享，保证 done/fail 全局只触发一次。
        // 若不隔离：某接口在 15s 超时之后才返回成功数据时，其 promise resolve 仍会再走 done，
        // 与超时触发的递归链并存 → 完成回调被触发两次（重复弹通知/重复开关 loading）。
        var box = { settled: false };
        function finish(cb, arg) { if (!box.settled) { box.settled = true; cb(arg); } }
        (function next(list) {
            if (!list.length) { finish(fail); return; }
            var fn = list.shift();
            var local = false;
            var t = setTimeout(function () {
                if (local) return; local = true;
                next(list);
            }, 15000);
            fn().then(function (data) {
                if (local) return; local = true; clearTimeout(t);
                if (data && Array.isArray(data)) finish(done, data);
                else next(list);
            }).catch(function () {
                if (local) return; local = true; clearTimeout(t);
                next(list);
            });
        })(apis);
    }

    // 普通 CORS json 拉取
    function fetchJson(url) {
        return new Promise(function (resolve, reject) {
            var x = new XMLHttpRequest();
            x.open('GET', url, true);
            x.timeout = 12000;
            x.onload = function () { try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); } };
            x.onerror = x.ontimeout = function () { reject(new Error('fetch failed')); };
            x.send();
        });
    }

    // 官方接口 JSONP 拉取（规避 CORS）
    function fetchJsonp(url) {
        return new Promise(function (resolve, reject) {
            var cb = 'cb_mh_' + Date.now();
            var s = document.createElement('script');
            var timer = setTimeout(function () { cleanup(); reject(new Error('timeout')); }, 12000);
            function cleanup() {
                clearTimeout(timer);
                try { delete window[cb]; } catch (e) { window[cb] = undefined; }
                if (s.parentNode) s.parentNode.removeChild(s);
            }
            window[cb] = function (data) { cleanup(); resolve(data); };
            s.onerror = function () { cleanup(); reject(new Error('script error')); };
            s.src = url + (url.indexOf('?') > -1 ? '&' : '?') + 'callback=' + cb;
            document.head.appendChild(s);
        });
    }

    // 兼容不同接口返回结构，抽取歌曲并去重
    function ingestNetEaseSongs(data) {
        var items = [];
        if (Array.isArray(data)) {
            // meting 社区接口：直接为歌曲数组
            items = data;
        } else if (data && Array.isArray(data.tracks)) {
            // playlistDetail 结构：tracks 数组
            data.tracks.forEach(function (t) {
                items.push({ name: t.name, artist: (t.artists || []).map(function (a) { return a.name; }).join('/'), url: t.mp3Url, id: t.id });
            });
        } else if (data && data.result && Array.isArray(data.result.tracks)) {
            // 官方 playlist/detail 结构：result.tracks 数组
            data.result.tracks.forEach(function (t) {
                items.push({ name: t.name, artist: (t.artists || []).map(function (a) { return a.name; }).join('/'), url: t.mp3Url, id: t.id });
            });
        } else if (data && Array.isArray(data.playlist && data.playlist.tracks)) {
            data.playlist.tracks.forEach(function (t) {
                items.push({ name: t.name, artist: (t.artists || []).map(function (a) { return a.name; }).join('/'), url: t.mp3Url, id: t.id });
            });
        }
        var titleSet = {};
        var added = 0;
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var title = (it.title || it.name || '').trim();
            var sub = (it.author || it.artist || '').trim();
            var url = it.url || it.audio || '';
            // 网易云：meting 镜像(type=url)或其返回的播放端点常已失效(404)，而官方接口也不回 mp3Url。
            // 只要能拿到歌曲 id，就拼装网易云标准外链 music.163.com/song/media/outer/url?id=.. 更稳定可播。
            var idMatch = /[?&]id=(\d+)/.exec(url);
            var netId = idMatch ? idMatch[1] : (it.id != null ? String(it.id) : '');
            if (netId && (!url || /(type=url|song\/media\/outer)/.test(url) || /^https?:\/\/api\.i-meto\.com|qjqq\.cn/i.test(url))) {
                url = 'https://music.163.com/song/media/outer/url?id=' + netId + '.mp3';
            }
            if (!title || titleSet[title]) continue;
            titleSet[title] = true;
            songs.push({ title: title, sub: sub || '网易云音乐', url: url || '' });
            added++;
        }
        return added;
    }

    function renderVinylSection() {
        var el = document.getElementById('mh-setting-vinyl');
        if (!el) return;
        var thumbs = '';
        if (conf.vinylLabel) {
            thumbs += '<div class="mh-vinyl-thumb sel" style="background-image:url(\'' + conf.vinylLabel + '\')"></div>';
        } else {
            thumbs += '<div class="mh-vinyl-thumb sel"><i class="fas fa-music" style="color:#fff;display:flex;align-items:center;justify-content:center;height:100%;font-size:14px;"></i></div>';
        }
        el.innerHTML =
            '<div class="mh-set-section">' +
                '<div class="mh-set-title"><i class="fas fa-compact-disc"></i>自定义唱片</div>' +
                '<div class="mh-vinyl-gallery">' +
                    thumbs +
                    '<div class="mh-vinyl-thumb mh-vinyl-thumb--add" id="mh-vinyl-add" title="上传唱片图"><i class="fas fa-sync-blue"></i><i class="fas fa-camera"></i></div>' +
                '</div>' +
                '<button class="modal-btn modal-btn-secondary mh-set-reset" id="mh-vinyl-reset">恢复默认灰色唱片</button>' +
                '<input type="file" id="mh-vinyl-file-input" accept="image/*" style="display:none">' +
            '</div>';
        var fileInput = el.querySelector('#mh-vinyl-file-input');
        var add = el.querySelector('#mh-vinyl-add');
        if (add) add.addEventListener('click', function () { fileInput.click(); });
        if (fileInput) fileInput.addEventListener('change', function () {
            var f = fileInput.files[0];
            if (!f) return;
            var reader = new FileReader();
            reader.onload = function () {
                conf.vinylLabel = reader.result;
                saveConf();
                renderVinylSection();
                syncVinylImage();
                if (typeof window._mhRefreshPanel === 'function') window._mhRefreshPanel();
            };
            reader.readAsDataURL(f);
        });
        var reset = el.querySelector('#mh-vinyl-reset');
        if (reset) reset.addEventListener('click', function () {
            conf.vinylLabel = null;
            saveConf();
            renderVinylSection();
            if (typeof window._mhRefreshPanel === 'function') window._mhRefreshPanel();
        });
    }
    window._mhRefreshPanel = function () { renderPanel(); };

    // 心跳线 / 播放进度线 / 控制按钮 颜色设置：色轮字段 与 CSS 变量 的映射
    var lineConfMap = { 'hb': 'hbColor', 'prog': 'progColor', 'ctrl': 'ctrlColor' };
    var lineVarMap = { 'hb': '--mh-hb-c', 'prog': '--mh-prog-c', 'ctrl': '--mh-ctrl-c' };

    // 心跳线 / 播放进度线 颜色预设（九个初始颜色 + 第十个自定义）
    var presetColors = [
        '#ff9f9d', '#ffb36b', '#a8e6cf', '#7fc8f8', '#c5b8e6',
        '#f9c6d0', '#8ed1c0', '#f6c177', '#b39ddb'
    ];

    function renderLinesSection() {
        var el = document.getElementById('mh-setting-lines');
        if (!el) return;
        el.innerHTML =
            '<div class="mh-set-section">' +
                '<div class="mh-set-title"><i class="fas fa-sliders-h"></i>线条设置</div>' +
                _lineGroup('心跳线颜色', 'hb', conf.hbColor) +
                _lineGroup('播放进度线颜色', 'prog', conf.progColor) +
                '<div class="mh-line-demo">' +
                    '<div class="mh-line-demo-hb"><svg viewBox="0 0 372 165" preserveAspectRatio="none"><path d="M0,82 L16,82 L18,82 L26,40 L34,124 L42,48 L50,84 L58,82 L98,82 L104,40 L110,124 L116,44 L124,84 L132,82 L170,82 L176,38 L182,124 L190,40 L198,84 L206,82 L246,82 L252,38 L258,124 L264,48 L272,84 L280,82 L320,82 L326,40 L332,124 L338,50 L346,84 L354,82 L372,82" fill="none" stroke="var(--mh-hb-c)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
                    '<div class="mh-line-demo-prog"><div class="mh-line-demo-prog-fill"></div></div>' +
                '</div>' +
            '</div>';
        bindLinePicker(el, 'hb');
        bindLinePicker(el, 'prog');
    }

    function _lineGroup(label, key, current) {
        // 上五下五：前两排各 5 格，最后一个是自定义色轮
        var cells = '';
        for (var i = 0; i < 10; i++) {
            if (i === 9) { // 第 10 格 = 自定义色轮
                cells += '<div class="mh-line-swatch mh-line-swatch--custom' + (presetColors.indexOf(current) === -1 ? ' sel' : '') + '" data-line="' + key + '" data-custom="1"></div>';
            } else {
                var c = presetColors[i];
                cells += '<div class="mh-line-swatch' + (current === c ? ' sel' : '') + '" data-line="' + key + '" data-color="' + c + '" style="background:' + c + '"></div>';
            }
        }
        return '<div class="mh-line-group">' +
            '<div class="mh-line-group-label">' + label + '</div>' +
            '<div class="mh-line-swatches">' + cells + '</div>' +
            '<input type="color" id="mh-color-wheel-' + key + '" style="display:none" value="' + (current || '#ffffff') + '">' +
        '</div>';
    }

    function bindLinePicker(el, key) {
        var wheel = el.querySelector('#mh-color-wheel-' + key);
        el.querySelectorAll('.mh-line-swatch[data-line="' + key + '"]').forEach(function (sw) {
            sw.addEventListener('click', function () {
                var c = sw.getAttribute('data-color');
                if (sw.getAttribute('data-custom') === '1') {
                    if (wheel) { wheel.value = conf[lineConfMap[key] || 'hbColor'] || '#ffffff'; wheel.click(); }
                    return;
                }
                applyLineColor(key, c);
            });
        });
        if (wheel) wheel.addEventListener('input', function () { applyLineColor(key, wheel.value); });
    }

    function applyLineColor(key, color) {
        var cf = lineConfMap[key] || 'hbColor';
        var cssVar = lineVarMap[key] || '--mh-hb-c';
        conf[cf] = color;
        saveConf();
        var panel = document.getElementById('cs-panel-musichall');
        if (panel) panel.style.setProperty(cssVar, color);
        if (key === 'ctrl') renderCtrlSection();
        else renderLinesSection();
    }

    // 控制按钮颜色（上一首 / 下一首 / 暂停·播放），复用色轮选择器
    function renderCtrlSection() {
        var el = document.getElementById('mh-setting-ctrl');
        if (!el) return;
        el.innerHTML =
            '<div class="mh-set-section">' +
                '<div class="mh-set-title"><i class="fas fa-forward"></i>控制按钮颜色</div>' +
                _lineGroup('上一首 / 下一首 / 暂停·播放', 'ctrl', conf.ctrlColor) +
                '<div class="mh-ctrl-demo" style="color:' + (conf.ctrlColor || '#7a9cc6') + '">' +
                    '<span class="mh-ctrl-demo-item"><i class="fas fa-step-backward"></i></span>' +
                    '<span class="mh-ctrl-demo-item mh-ctrl-demo-star" style="background:' + (conf.ctrlColor || '#7a9cc6') + '"><i class="fas fa-pause"></i></span>' +
                    '<span class="mh-ctrl-demo-item"><i class="fas fa-step-forward"></i></span>' +
                '</div>' +
            '</div>';
        bindLinePicker(el, 'ctrl');
    }

    // 气泡样式：与主设置"气泡样式"一致，持久化到 conf.bubbleStyle
    function renderBubbleSection() {
        var el = document.getElementById('mh-setting-bubble');
        if (!el) return;
        var opts = [
            { v: 'standard',     icon: 'fa-comment',        name: '标准尖角' },
            { v: 'rounded',      icon: 'fa-comment-dots',   name: '圆角' },
            { v: 'rounded-large',icon: 'fa-circle',         name: '大圆角胶囊' },
            { v: 'square',       icon: 'fa-square',         name: '方形直角' }
        ];
        el.innerHTML =
            '<div class="mh-set-section">' +
                '<div class="mh-set-title"><i class="fas fa-comment"></i>气泡样式</div>' +
                '<div class="mh-bubble-row">' +
                    opts.map(function (o) {
                        return '<button class="mh-mode-btn' + (conf.bubbleStyle === o.v ? ' sel' : '') + '" data-bubble="' + o.v + '">' +
                            '<i class="fas ' + o.icon + '"></i>' + o.name +
                        '</button>';
                    }).join('') +
                '</div>' +
            '</div>' +
            '<div class="mh-set-section">' +
                '<div class="mh-set-title"><i class="fas fa-palette"></i>字体 & 气泡自定义CSS</div>' +
                '<div class="mh-css-hint">与『设置 → 字体 & 气泡 → 自定义CSS』一致，可粘贴 CSS 定制音乐厅聊天气泡与字体（如 .mh-msg-bubble、.mh-msg、.mh-chat-txt 等）。</div>' +
                '<textarea class="mh-css-area" id="mh-css-area" rows="4" placeholder="粘贴自定义 CSS…">' + esc(conf.mhCss || (typeof settings !== 'undefined' ? (settings.customBubbleCss || '') : '')) + '</textarea>' +
                '<div class="mh-css-btns">' +
                    '<button class="mh-mode-btn mh-css-act" id="mh-css-apply">应用</button>' +
                    '<button class="mh-mode-btn mh-css-act" id="mh-css-frommain" style="opacity:.85;">读取主设置</button>' +
                    '<button class="mh-mode-btn mh-css-act" id="mh-css-clear" style="opacity:.85;">清空</button>' +
                '</div>' +
            '</div>';
        el.querySelectorAll('[data-bubble]').forEach(function (b) {
            b.addEventListener('click', function () {
                conf.bubbleStyle = b.getAttribute('data-bubble') || 'standard';
                saveConf();
                renderBubbleSection();
                // 即时重绘聊天区，让气泡样式生效
                var area = document.getElementById('mh-chat-area');
                if (area) {
                    if (messages.length) {
                        // 与 _chatHTML 一致：只重绘最近 200 条，避免大消息量时整份重建拖卡
                        var MAX = 200;
                        area.innerHTML = messages.slice(Math.max(0, messages.length - MAX)).map(_msgHTML).join('');
                    }
                    area.scrollTop = area.scrollHeight;
                }
                var names = { 'standard': '标准', 'rounded': '圆角', 'rounded-large': '大圆角', 'square': '方形' };
                showNotification('气泡样式已切换为' + (names[conf.bubbleStyle] || '标准'), 'info');
            });
        });
        var applyBtn = el.querySelector('#mh-css-apply');
        if (applyBtn) applyBtn.addEventListener('click', function () {
            var v = (el.querySelector('#mh-css-area') || {}).value || '';
            conf.mhCss = v;
            saveConf();
            applyMhCustomCss(v);
            showNotification(v ? '自定义CSS已应用' : '已清除自定义CSS', 'info');
        });
        var frommainBtn = el.querySelector('#mh-css-frommain');
        if (frommainBtn) frommainBtn.addEventListener('click', function () {
            var mainCss = (typeof settings !== 'undefined' && settings.customBubbleCss) ? settings.customBubbleCss : '';
            var ta = el.querySelector('#mh-css-area');
            if (ta) ta.value = mainCss;
            if (typeof applyCustomBubbleCss === 'function') { try { applyCustomBubbleCss(mainCss); } catch (e) {} }
            showNotification('已填入主设置的自定义CSS', 'info');
        });
        var clearBtn = el.querySelector('#mh-css-clear');
        if (clearBtn) clearBtn.addEventListener('click', function () {
            var ta = el.querySelector('#mh-css-area');
            if (ta) ta.value = '';
            conf.mhCss = '';
            saveConf();
            applyMhCustomCss('');
            showNotification('已清空自定义CSS', 'info');
        });
    }

    // 音乐厅自定义CSS：独立注入（作用目标为音乐厅气泡/聊天，如 .mh-msg-bubble）
    function applyMhCustomCss(cssCode) {
        var styleId = 'mh-user-custom-style';
        var styleTag = document.getElementById(styleId);
        if (!cssCode || !cssCode.trim()) { if (styleTag) styleTag.remove(); return; }
        if (!styleTag) { styleTag = document.createElement('style'); styleTag.id = styleId; document.head.appendChild(styleTag); }
        styleTag.textContent = cssCode;
    }

    function syncVinylImage() {
        // 自定义唱片图显示在外圈蓝色圆环（.mh-vinyl-art），中间白色圆固定
        var art = document.querySelector('#cs-panel-musichall .mh-vinyl-art');
        if (art) {
            if (conf.vinylLabel) art.style.backgroundImage = 'url(\'' + conf.vinylLabel + '\')';
            else art.style.backgroundImage = '';
        }
    }

    // ── 音乐邀请：MUSIC 卡片 + 调度 ───────────────────────
    window._mhSendInviteCard = function (inv) {
        if (typeof addMessage !== 'function') { console.warn('[musichall] addMessage 不可用'); return; }
        addMessage({
            id: Date.now() + Math.random(),
            sender: 'partner',
            text: '',
            timestamp: new Date(),
            status: 'received',
            type: 'music-invite',
            musicInviteData: { id: inv.id, songTitle: inv.songTitle || '', state: 'pending' },
            favorited: false,
            note: null
        });
        // 梦角邀请一起听歌归属"普通消息"：弹普通通知（与电影院邀请一致）
        if (typeof window._sendPartnerNotification === 'function') {
            var pn = (typeof partnerName === 'function') ? partnerName() : '对方';
            window._sendPartnerNotification(pn, '想和你一起听歌' + (inv && inv.songTitle ? '《' + inv.songTitle + '》' : ''));
        }
    };

    // 主聊天里渲染 MUSIC 卡片
    function musicInviteFragment(msg) {
        var data = msg.musicInviteData || {};
        var song = data.songTitle || '';
        var pn = partnerName();
        var avatarHTML = (typeof _avEl === 'function')
            ? _avEl(true, 36)   // 与「看电影」邀请卡一致：显示真实的梦角头像
            : '<div class="mm-avatar mh-inv-av">' + esc(pn.charAt(0)) + '</div>'; // 兜底：首字母
        var wrap = document.createElement('div');
        wrap.className = 'message-wrapper received music-invite-msg-wrap';
        wrap.dataset.id = msg.id;
        wrap.innerHTML =
            '<div class="message-avatar">' + avatarHTML + '</div>' +
            '<div class="message-content-wrapper">' +
                '<div class="music-invite-card" data-mh-id="' + esc(String(data.id || '')) + '" data-mh-song="' + esc(song) + '">' +
                    '<div class="music-invite-decor">' +
                        '<span class="d1">💿</span><span class="d2">🎧</span>' +
                        '<span class="d3">💫</span><span class="d4">💖</span>' +
                    '</div>' +
                    '<div class="music-invite-banner">MUSIC</div>' +
                    '<div class="music-invite-line">想和你一起听歌</div>' +
                    (song ? '<div class="music-invite-song">' + esc(song) + '</div>' : '') +
                    '<div class="music-invite-divider"></div>' +
                    '<div class="music-invite-actions">' +
                        '<button class="music-invite-btn music-invite-btn--later" data-mh-action="later">拒绝</button>' +
                        '<button class="music-invite-btn music-invite-btn--go" data-mh-action="go">现在听</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        return wrap;
    }

    function hookFragment() {
        function tryhook() {
            if (typeof window.createMessageFragment !== 'function') { setTimeout(tryhook, 100); return; }
            var orig = window.createMessageFragment;
            window.createMessageFragment = function (msg, prevMsg, nextMsg, lastSenderRef) {
                if (msg && msg.type === 'music-invite') {
                    if (lastSenderRef) lastSenderRef.current = 'partner';
                    var sc = document.createElement('div');
                    sc.appendChild(musicInviteFragment(msg));
                    return sc;
                }
                return orig.apply(this, arguments);
            };
        }
        tryhook();
    }

    // 邀请卡片按钮点击（事件委托，兼容主聊天动态渲染）
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('.music-invite-btn');
        if (!btn) return;
        var card = btn.closest('.music-invite-card');
        if (!card) return;
        var song = card.getAttribute('data-mh-song') || '';
        var actions = card.querySelector('.music-invite-actions');
        if (btn.getAttribute('data-mh-action') === 'go') {
            if (actions) actions.style.display = 'none';
            var st = document.createElement('div');
            st.className = 'music-invite-status';
            st.textContent = '好的呀，马上就去~';
            card.appendChild(st);
            // 跳转音乐厅并播放
            if (typeof openEntertainment === 'function') openEntertainment();
            if (typeof window._entSwitchPill === 'function') window._entSwitchPill('music');
            setTimeout(function () { window._menuPlaySong(song || null); }, 520);
        } else {
            if (actions) actions.style.display = 'none';
            var st2 = document.createElement('div');
            st2.className = 'music-invite-status';
            st2.textContent = '下次再一起听吧';
            card.appendChild(st2);
        }
        e.preventDefault();
    });

    // 检查是否已回复（简单实现：卡片点击后清掉 active）
    // 下一次调度
    function scheduleNext(short) {
        var delay = (short ? 1 : (1 + Math.random())) * 24 * 3600000;
        invite.next = Date.now() + delay;
        saveInvite();
    }
    function checkInvite() {
        if (!_booted) return;
        var now = Date.now();
        if (invite.next && now < invite.next) return;
        if (invite.active && invite.active.ts && (now - invite.active.ts) < 4 * 3600000) {
            // 上一条邀请还在有效期且尚未被用户操作，先不重复发
            scheduleNext(true);
            return;
        }
        var prob = (invite.missed >= 2) ? 1 : 0.7;
        if (Math.random() < prob) {
            var specific = songs.length > 0 && Math.random() < 0.75;
            var songTitle = specific ? songs[Math.floor(Math.random() * songs.length)].title : null;
            var inv = { id: 'mh' + Date.now(), songTitle: songTitle, ts: now };
            invite.active = inv;
            invite.missed = 0;
            _mhSendInviteCard(inv);
        } else {
            invite.missed = (invite.missed || 0) + 1;
        }
        scheduleNext(false);
    }

    // ── pill 切换集成（包裹原有 _entSwitchPill，兼容 cinema/log） ──
    function setPills(which) {
        ['cinema', 'log', 'music'].forEach(function (p) {
            var el = document.getElementById('ent-pill-' + p);
            if (el) el.classList.toggle('cs-pill-on', p === which);
        });
        var cin = document.getElementById('cs-panel-cinema');
        if (cin) cin.classList.toggle('cs-panel-active', which === 'cinema');
        var mh = document.getElementById('cs-panel-musichall');
        if (mh) mh.classList.toggle('cs-panel-active', which === 'music');
        if (which === 'music' && mh) renderPanel();
    }
    var _origSwitch = window._entSwitchPill;
    window._entSwitchPill = function (which) {
        if (which === 'music') {
            if (typeof window._cinemaCloseArchive === 'function') window._cinemaCloseArchive();
            closePlaylistPageSafe();
            setPills('music');
        } else {
            if (_origSwitch) _origSwitch(which);
            setPills(which);
        }
    };
    var _origCloseArchive = window._cinemaCloseArchive;
    window._cinemaCloseArchive = function () {
        if (_origCloseArchive) _origCloseArchive();
        setPills('cinema');
    };
    function closePlaylistPageSafe() { window._mhClosePlaylistPage(); }

    // ── 启动 ─────────────────────────────────────────────
    function boot() {
        if (_booted) return;
        _booted = true;
        hookFragment();
        // 启动后异步以 IndexedDB 歌单为准覆盖同步种子（localStorage 种子兼容老版本/纯链接小歌单）。
        // 音乐文件上传量多时只存 IndexedDB，重进也能完整恢复，不再被配额清空。
        if (typeof localforage !== 'undefined') {
            // 先把旧版全局 IndexedDB 歌单(CHAT_APP_V3__mhSongs_lf)懒迁移到当前对象命名空间
            var oldLfKey = 'CHAT_APP_V3__mhSongs_lf', newLfKey = mhKey('mhSongs_lf');
            if (oldLfKey !== newLfKey) {
                localforage.getItem(oldLfKey).then(function (oldVal) {
                    if (oldVal != null) {
                        return localforage.getItem(newLfKey).then(function (cur) {
                            if (cur == null) return localforage.setItem(newLfKey, oldVal);
                        }).then(function(){ return localforage.removeItem(oldLfKey); });
                    }
                }).catch(function () {});
            }
            localforage.getItem(newLfKey).then(function (v) {
                if (!v || !Array.isArray(v)) return;
                if (JSON.stringify(v) !== JSON.stringify(songs)) {
                    songs = v;
                    try { renderPlaylistList(); syncPlayerUI(); } catch (e) {}
                }
            }).catch(function () {});
        }
        // 等 app 数据准备好后再检查邀请
        setTimeout(function () { checkInvite(); }, 2500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
    window._mhBoot = boot;
})();