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
        if (btn) btn.addEventListener('click', function () { openPlaylistPage(); });

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
                '<div class="mh-hb-line">' +
                    '<svg viewBox="0 0 140 44" class="mh-hb-svg">' +
                        '<polyline points="0,22 18,22 26,8 34,36 42,12 50,30 58,22 80,22 88,8 96,36 104,14 112,28 120,22 140,22" fill="none" stroke="var(--mh-hb-c)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="mh-progress"><div class="mh-progress-fill" id="mh-progress-fill" style="width:0%"></div></div>' +
                '<div class="mh-time">' +
                    '<span id="mh-cur-time">0:00</span>' +
                    '<span id="mh-dur-time">0:00</span>' +
                '</div>' +
                '<div class="mh-controls">' +
                    '<button class="mh-ctrl" id="mh-prev" title="上一首"><i class="fas fa-step-backward"></i></button>' +
                    '<button class="mh-ctrl mh-ctrl-star" id="mh-play" title="播放/暂停">' +
                        '<i class="fas fa-play" id="mh-ico-play"></i>' +
                        '<i class="fas fa-pause" id="mh-ico-pause" style="display:none"></i>' +
                    '</button>' +
                    '<button class="mh-ctrl" id="mh-next" title="下一首"><i class="fas fa-step-forward"></i></button>' +
                '</div>' +
                '<div class="mh-mode-switch">' + _modeHTML() + '</div>' +
            '</div>' +
        '</div>';
    }

    function _vinylHTML() {
        var style = conf.vinylLabel ? 'background-image:url(\'' + conf.vinylLabel + '\')' : '';
        return '<div class="mh-vinyl' + (playing ? ' mh-spinning' : '') + '">' +
            '<div class="mh-vinyl-grooves"></div>' +
            '<div class="mh-vinyl-label' + (conf.vinylLabel ? ' has-img' : '') + '" style="' + style + '"><i class="fas fa-music"></i></div>' +
        '</div>';
    }

    function _modeHTML() {
        var list = [{ k: 'shuffle', t: '随机' }, { k: 'single', t: '单曲循环' }, { k: 'list', t: '歌单循环' }];
        return list.map(function (m) {
            return '<button class="mh-mode-btn' + (mode === m.k ? ' active' : '') + '" data-mode="' + m.k + '">' + m.t + '</button>';
        }).join('');
    }

    function _chatHTML() {
        var empty = !messages.length;
        return '<div class="mh-chat-panel">' +
            '<div class="mh-chat-area" id="mh-chat-area">' +
                (empty
                    ? '<div class="mh-chat-empty"><i class="far fa-comment-dots"></i><p>边听歌边聊聊吧</p></div>'
                    : messages.map(_msgHTML).join('')) +
            '</div>' +
            '<div class="mh-chat-input-row">' +
                '<input class="mh-chat-input" id="mh-chat-input" placeholder="说点什么…" maxlength="500">' +
                '<button class="mh-chat-send" id="mh-chat-send"><i class="fas fa-paper-plane"></i></button>' +
            '</div>' +
        '</div>';
    }

    function _msgHTML(m) {
        var mine = m.sender === 'user';
        return '<div class="mh-msg ' + (mine ? 'mh-msg--me' : 'mh-msg--partner') + '">' +
            (mine ? '' : '<div class="mh-msg-av"><i class="fas fa-music"></i></div>') +
            '<div class="mh-msg-bubble">' + esc(m.content) + '</div>' +
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
        panel.querySelectorAll('.mh-mode-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                mode = b.getAttribute('data-mode');
                panel.querySelectorAll('.mh-mode-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
            });
        });
    }
    function syncPlayerUI() {
        var t = document.getElementById('mh-song-title');
        var song = songs.length ? songs[cur >= 0 ? cur : 0] : null;
        if (t) t.textContent = song ? song.title : '未选择歌曲';
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
        function doSend() {
            if (!input) return;
            var text = input.value.trim();
            if (!text) return;
            messages.push({ sender: 'user', content: text, ts: Date.now() });
            appendMsg(messages[messages.length - 1]);
            input.value = '';
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
        }
        if (send) send.addEventListener('click', doSend);
        if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });
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

    // ── 播放指定（供邀请卡"现在听"） ────────────────────
    window._menuPlaySong = function (title) {
        var i = title ? findSongByTitle(title) : -1;
        if (i >= 0) { loadSong(i); playCur(); } else { openPlaylistPage(); }
    };

    // ── 歌单页 ───────────────────────────────────────────
    window._mhOpenPlaylistPage = function () {
        var page = document.getElementById('music-playlist-page');
        if (!page) return;
        renderPlaylistList();
        renderSettings();
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
                    '<div class="mh-line-demo-hb"><svg viewBox="0 0 140 44"><polyline points="0,22 18,22 26,8 34,36 42,12 50,30 58,22 80,22 88,8 96,36 104,14 112,28 120,22 140,22" fill="none" stroke="var(--mh-hb-c)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
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
        var label = document.querySelector('#cs-panel-musichall .mh-vinyl-label');
        if (label) {
            if (conf.vinylLabel) { label.className = 'mh-vinyl-label has-img'; label.style.backgroundImage = 'url(\'' + conf.vinylLabel + '\')'; }
            else { label.className = 'mh-vinyl-label'; label.style.backgroundImage = ''; }
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
        var wrap = document.createElement('div');
        wrap.className = 'message-wrapper received music-invite-msg-wrap';
        wrap.dataset.id = msg.id;
        wrap.innerHTML =
            '<div class="message-avatar"><div class="mm-avatar mh-inv-av">' + esc(pn.charAt(0)) + '</div></div>' +
            '<div class="message-content-wrapper">' +
                '<div class="music-invite-card" data-mh-id="' + esc(String(data.id || '')) + '" data-mh-song="' + esc(song) + '">' +
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