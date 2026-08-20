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

    var LS_PLAYLIST = 'CHAT_APP_V3__mhSongs';
    var LS_SETTINGS = 'CHAT_APP_V3__mhSettings';
    var LS_INVITE   = 'CHAT_APP_V3__mhInvite';

    function lsGet(k, fb) {
        try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : fb; } catch (e) { return fb; }
    }
    function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    function esc(s) {
        return (typeof _escapeHtml === 'function') ? _escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);
    }
    function partnerName() { return (typeof settings !== 'undefined' && settings.partnerName) || '梦角'; }

    // ── 状态 ──────────────────────────────────────────────
    var songs = lsGet(LS_PLAYLIST, []);
    var conf = Object.assign({ hbColor: '#ff9f9d', progColor: '#c5a47e', vinylLabel: null }, lsGet(LS_SETTINGS, {}));
    var cur = -1, playing = false, mode = 'list'; // list | single | shuffle
    var messages = [];
    var invite = lsGet(LS_INVITE, { next: 0, missed: 0, active: null });
    var audio = null, _booted = false, _rendered = false;

    function saveSongs() { lsSet(LS_PLAYLIST, songs); }
    function saveConf() { lsSet(LS_SETTINGS, conf); }
    function saveInvite() { lsSet(LS_INVITE, invite); }

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

        var btn = panel.querySelector('#mh-playlist-btn');
        if (btn) btn.addEventListener('click', function () { window._mhOpenPlaylistPage(); });

        audio = panel.querySelector('#mh-audio');
        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('play', function () { setPlay(true); });
        audio.addEventListener('pause', function () { setPlay(false); });

        bindControls(panel);
        bindChat(panel);

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
        return '<div class="mh-chat-panel">' +
            '<div class="mh-chat-area" id="mh-chat-area">' +
                (empty
                    ? '<div class="mh-chat-empty"><i class="far fa-comment-dots"></i><p>边听歌边聊聊吧</p></div>'
                    : messages.map(_msgHTML).join('')) +
            '</div>' +
            '<div class="mh-emoji-panel" id="mh-emoji-panel"></div>' +
            '<div class="mh-chat-input-row">' +
                '<button class="mh-chat-emoji" id="mh-chat-emoji" title="表情"><i class="fas fa-smile"></i></button>' +
                '<input class="mh-chat-input" id="mh-chat-input" placeholder="说点什么…" maxlength="500">' +
                '<button class="mh-chat-send" id="mh-chat-send"><i class="fas fa-paper-plane"></i></button>' +
            '</div>' +
        '</div>';
    }

    function _msgHTML(m) {
        var mine = m.sender === 'user';
        var bubble;
        if (m.image) {
            var isCloud = String(m.image).indexOf('oss://') === 0;
            bubble = '<div class="mh-msg-bubble mh-msg-img"><img data-mh-cloud="' + (isCloud ? '1' : '0') + '" ' + (isCloud ? '' : 'src="' + esc(m.image) + '"') + ' alt="表情"></div>';
        } else {
            bubble = '<div class="mh-msg-bubble">' + esc(m.content) + '</div>';
        }
        return '<div class="mh-msg ' + (mine ? 'mh-msg--me' : 'mh-msg--partner') + '">' +
            (mine ? '' : '<div class="mh-msg-av"><i class="fas fa-music"></i></div>') +
            bubble +
            (mine ? '<div class="mh-msg-av"><i class="fas fa-user"></i></div>' : '') +
        '</div>';
    }

    // ── 播放控制 ──────────────────────────────────────────
    function loadSong(index) {
        if (!songs.length) return;
        if (index >= songs.length) index = 0;
        if (index < 0) index = songs.length - 1;
        cur = index;
        if (audio) {
            audio.src = songs[cur].url;
            audio.load();
        }
        syncPlayerUI();
    }
    function playCur() {
        if (!songs.length) { showNotification('歌单为空，请先导入歌曲', 'warning'); return; }
        if (cur < 0 || cur >= songs.length) loadSong(0);
        if (!audio.src) loadSong(cur);
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
        if (n >= 0) loadSong(n);
        playCur();
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
        if (prev) prev.addEventListener('click', function () { if (!songs.length) return; loadSong(cur - 1); playCur(); });
        if (next) next.addEventListener('click', function () { if (!songs.length) return; var n = nextIdx(); loadSong(n); playCur(); });
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
        if (typeof addMessage === 'function') {
            addMessage({ id: Date.now() + Math.random(), sender: 'user', text: '', image: s, timestamp: new Date(), status: 'sent', type: 'normal', favorited: false, note: null });
        }
        if (typeof playSound === 'function') playSound('send');
        var panel = document.getElementById('mh-emoji-panel');
        if (panel) panel.classList.remove('open');
        mhTriggerReply();
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
                messages.push({ sender: 'partner', content: m.text || '', image: m.image || null, ts: Date.now() });
                appendMsg(messages[messages.length - 1]);
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
                loadSong(i);
                playCur();
                renderPlaylistList();
            });
        });
    }

    // ── 设置区：音乐导入 / 自定义唱片 / 线条设置 ────────
    function renderSettings() {
        renderImportSection();
        renderVinylSection();
        renderLinesSection();
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
        if (fileBtn && fileInput) fileBtn.addEventListener('click', function () { fileInput.click(); });
        if (fileInput) fileInput.addEventListener('change', function () {
            var f = fileInput.files[0];
            if (!f) return;
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
            songs.push({ title: title, sub: sub, url: url });
            saveSongs();
            showNotification('已添加到歌单', 'success');
            el.querySelector('#mh-in-title').value = '';
            el.querySelector('#mh-in-sub').value = '';
            el.querySelector('#mh-in-url').value = '';
            pendingDataUrl = null;
            renderPlaylistList();
            syncPlayerUI();
        });
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
                    if (wheel) { wheel.value = conf[key === 'hb' ? 'hbColor' : 'progColor'] || '#ffffff'; wheel.click(); }
                    return;
                }
                applyLineColor(key, c);
            });
        });
        if (wheel) wheel.addEventListener('input', function () { applyLineColor(key, wheel.value); });
    }

    function applyLineColor(key, color) {
        if (key === 'hb') conf.hbColor = color; else conf.progColor = color;
        saveConf();
        var panel = document.getElementById('cs-panel-musichall');
        if (panel) {
            panel.style.setProperty('--mh-hb-c', conf.hbColor);
            panel.style.setProperty('--mh-prog-c', conf.progColor);
        }
        renderLinesSection();
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
        // 等 app 数据准备好后再检查邀请
        setTimeout(function () { checkInvite(); }, 2500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
    window._mhBoot = boot;
})();