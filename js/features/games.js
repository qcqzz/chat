/**
 * 游戏室 · 五子棋 / 围棋
 * 参考电影院版面：左边棋局，右边历史记录。
 * 棋局：上方【撒娇｜开始｜耍赖】三按钮，中间棋盘，下方双方头像+三颗浅粉爱心。
 * 一局（一盘棋）输家碎一颗爱心，三颗先碎完者为输，整局结束并记账。
 * 撒娇：50% 概率恢复自己一颗碎心，一局(本次对战)最多成功 2 次。
 * 耍赖：50% 概率同意悔棋一步，一局最多成功 5 次。
 */
(function (global) {
    'use strict';

    var REC_KEY = 'chat_gameRecords';
    var BOARD_PX = 320;        // 画布内部像素
    var MARGIN = 18;           // 画布边距
    var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
    var GAME_META = {
        gomoku: { name: '五子棋', n: 15, go: false },
        go:     { name: '围棋',   n: 13, go: true  },
        '2048': { name: '2048',   n: 4,  go: false, g2: true },
        guessnum: { name: '猜数字对决', n: 100, go: false, gn: true }
    };
    // 每个游戏的配色（极简底 + 参考色点缀）：
    // 参考色：绿#E7EEC7 / 粉#F8D7DC / 蓝#DFEEFC
    // 五子棋 → 蓝粉，围棋 → 粉绿；两者共享粉色点缀（爱心/撒娇）
    var PALETTES = {
        gomoku: {
            ac: '#9fc9e6', acRgb: '159,201,230',
            softbg: 'linear-gradient(145deg,#fde9ed,#f8d3db)', softc: '#dd94a8',
            dropbg: 'linear-gradient(145deg,#f0f2f6,#e6e8ef)', dropc: '#6a6e80',
            grid: 'rgba(159,201,230,.38)', dot: 'rgba(159,201,230,.5)',
            boardbg: 'linear-gradient(160deg,#ffffff 0%,#f8fbff 55%,#eaf5fd 100%)',
            boardsh: 'inset 0 0 0 1px rgba(159,201,230,.24),0 10px 24px rgba(159,201,230,.16),0 4px 10px rgba(159,201,230,.08)',
            stroke: 'rgba(160,196,225,.28)'
        },
        go: {
            ac: '#b8d477', acRgb: '184,212,119',
            softbg: 'linear-gradient(145deg,#fde9ed,#f8d3db)', softc: '#dd94a8',
            dropbg: 'linear-gradient(145deg,#f3f7ec,#e9efde)', dropc: '#6a7d52',
            grid: 'rgba(188,212,135,.36)', dot: 'rgba(186,210,130,.48)',
            boardbg: 'linear-gradient(160deg,#ffffff 0%,#fbfdf6 55%,#f3f9e9 100%)',
            boardsh: 'inset 0 0 0 1px rgba(188,212,135,.22),0 10px 24px rgba(184,212,119,.16),0 4px 10px rgba(184,212,119,.08)',
            stroke: 'rgba(185,205,135,.26)'
        },
        '2048': {
            ac: '#dfbf7e', acRgb: '223,191,126',
            softbg: 'linear-gradient(145deg,#faf3e6,#f3e4c8)', softc: '#a8833f',
            dropbg: 'linear-gradient(145deg,#f2efe8,#e8e2d6)', dropc: '#6a6e5c',
            grid: 'rgba(223,191,126,.35)', dot: 'rgba(223,191,126,.5)',
            boardbg: 'linear-gradient(160deg,#ffffff 0%,#fbf7ee 55%,#f6ecd8 100%)',
            boardsh: 'inset 0 0 0 1px rgba(223,191,126,.25),0 12px 28px rgba(201,164,92,.16),0 4px 12px rgba(0,0,0,.05)',
            stroke: 'rgba(210,185,130,.28)'
        },
        guessnum: {
            ac: '#9fd4c0', acRgb: '159,212,192',
            softbg: 'linear-gradient(145deg,#fdeee5,#fad9ca)', softc: '#c0754f',
            dropbg: 'linear-gradient(145deg,#f2f6f4,#e4efe9)', dropc: '#5b7a6d',
            grid: 'rgba(159,212,192,.35)', dot: 'rgba(159,212,192,.5)',
            boardbg: 'linear-gradient(160deg,#ffffff 0%,#fbfcf8 55%,#effaf4 100%)',
            boardsh: 'inset 0 0 0 1px rgba(159,212,192,.22),0 12px 28px rgba(120,190,165,.16),0 4px 12px rgba(0,0,0,.05)',
            stroke: 'rgba(120,185,165,.26)'
        }
    };
    function applyPalette(el, game) {
        var p = PALETTES[game] || PALETTES.gomoku;
        if (state) state.pal = p;
        var s = el.style;
        s.setProperty('--ac', p.ac);
        s.setProperty('--ac-rgb', p.acRgb);
        s.setProperty('--softbg', p.softbg);
        s.setProperty('--softc', p.softc);
        s.setProperty('--dropbg', p.dropbg);
        s.setProperty('--dropc', p.dropc);
        s.setProperty('--boardbg', p.boardbg);
        s.setProperty('--boardsh', p.boardsh);
    }
    var USER = 1, DREAM = 2;

    var state = null;   // 当前对局会话状态
    var aiTimer = null;
    var styleInjected = false;

    // 调试/测试取数钩子（浏览器控制台与自动化验证用）
    global._goDebug = function () { return state; };

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function partnerName() {
        return (typeof settings !== 'undefined' && settings.partnerName) || '梦角';
    }
    function myName() {
        return (typeof settings !== 'undefined' && settings.myName) || '你';
    }
    function avHTML(isPartner, size) {
        var s = size || 34;
        if (typeof global._avEl === 'function') return global._avEl(isPartner, s);
        return '<span style="width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:#eee;display:inline-flex;align-items:center;justify-content:center;font-size:' + Math.round(s * 0.6) + 'px;">' + (isPartner ? '🌸' : '🙂') + '</span>';
    }
    function heartIcons(bools, size) {
        var sz = size || 20;
        var s = '';
        for (var i = 0; i < 3; i++) {
            var on = bools && bools[i];
            s += '<i class="' + (on ? 'fas fa-heart' : 'fas fa-heart-broken') + '" style="'
                + 'font-size:' + sz + 'px;color:' + (on ? '#f5a4b8' : '#ddd0d6') + ';'
                + (on ? '' : 'opacity:.7') + ';transition:transform .2s;"></i>';
        }
        return s;
    }
    function brokenCount(b) { return (b[0] ? 0 : 1) + (b[1] ? 0 : 1) + (b[2] ? 0 : 1); }

    function getRecords() {
        try {
            var raw = (typeof safeGetItem === 'function') ? safeGetItem(REC_KEY) : null;
            var data = raw ? JSON.parse(raw) : {};
            if (!data.gomoku) data.gomoku = [];
            if (!data.go) data.go = [];
            if (!data['2048']) data['2048'] = [];
            if (!data.guessnum) data.guessnum = [];
            return data;
        } catch (e) { return { gomoku: [], go: [], '2048': [], guessnum: [] }; }
    }
    function saveRecords(data) {
        try { if (typeof safeSetItem === 'function') safeSetItem(REC_KEY, JSON.stringify(data)); }
        catch (e) { console.warn('[games] 保存记录失败', e); }
    }
    function notify(msg, type) {
        if (typeof global.showNotification === 'function') global.showNotification(msg, type || 'info');
    }

    function injectStyle() {
        if (styleInjected) return;
        styleInjected = true;
        var el = document.createElement('style');
        el.id = 'gs-style';
        el.textContent = [
            '.gs-screen{height:100%;min-height:0;display:flex;flex-direction:column;box-sizing:border-box;padding:4px 12px 12px;background:linear-gradient(180deg,var(--gs-bg1,#ffffff) 0%,var(--gs-bg2,#f5f5f2) 100%);overflow-y:auto;overflow-x:hidden;}',
            '.gs-topbar{display:flex;align-items:center;gap:8px;padding:6px 0 8px;flex-shrink:0;}',
            '.gs-topbar>.gs-title{flex:1;text-align:center;font-weight:700;color:var(--gs-txt,#33343b);font-size:15px;}',
            '.gs-ibtn{border:none;background:rgba(var(--ac-rgb,111,126,196),.10);color:var(--ac,#6f7ec4);width:30px;height:30px;border-radius:50%;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;}',
            '.gs-seg{display:flex;border-radius:9px;overflow:hidden;border:1px solid #e3e3e0;}',
            '.gs-seg button{border:none;background:transparent;padding:4px 11px;font-size:12px;color:#9b9b93;cursor:pointer;}',
            '.gs-seg button.on{background:var(--ac,#6f7ec4);color:#fff;}',
            '.gs-body{display:flex;flex-wrap:wrap;align-items:flex-start;gap:14px;flex:1;min-height:0;}',
            '.gs-board-col{flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:10px;}',
            '.gs-ctl{display:flex;gap:8px;justify-content:center;align-items:center;}',
            '.gs-btn{flex:1;border:none;border-radius:12px;padding:9px 8px;font-weight:700;font-size:13px;cursor:pointer;transition:transform .12s;}',
            '.gs-btn:active{transform:scale(.95);}',
            '.gs-btn-soft{background:var(--softbg,#e9ecf7);color:var(--softc,#4a5694);}',
            '.gs-btn-start{background:linear-gradient(145deg,var(--ac,#6f7ec4),rgba(var(--ac-rgb,111,126,196),.72));color:#fff;}',
            '.gs-btn-drop{background:var(--dropbg,#eef0f3);color:var(--dropc,#565a68);}',
            '.gs-board-wrap{position:relative;width:100%;max-width:340px;margin:0 auto;aspect-ratio:1/1;border-radius:22px;overflow:hidden;background:var(--boardbg,#eceff7);box-shadow:var(--boardsh,0 0 0 transparent);}',
            '.gs-board-wrap>canvas{width:100%;height:100%;display:block;}',
            '.gs-hint{position:absolute;left:50%;top:12%;transform:translateX(-50%);background:rgba(30,30,34,.6);color:#fff;font-size:11px;padding:5px 12px;border-radius:20px;white-space:nowrap;pointer-events:none;}',
            '.gs-hr{display:flex;align-items:center;justify-content:space-between;padding:4px 6px;}',
            '.gs-player{display:flex;align-items:center;gap:7px;}',
            '.gs-player.right{flex-direction:row-reverse;}',
            '.gs-player .gs-pn{font-size:12px;color:#33343b;font-weight:600;white-space:nowrap;}',
            '.gs-hearts{display:flex;gap:3px;align-items:center;}',
            '.gs-status{text-align:center;font-size:12px;color:#9b9b93;min-height:16px;}',
            '.gs-result{text-align:center;font-size:13px;font-weight:700;color:var(--ac,#6f7ec4);min-height:16px;}',
            '.gs-resbtn{display:inline-flex;border:none;border-radius:12px;padding:7px 16px;background:var(--ac,#6f7ec4);color:#fff;font-weight:700;font-size:13px;cursor:pointer;}',
            '.gs-history-col{flex:1 1 220px;min-width:200px;display:flex;flex-direction:column;border-left:1px solid #e9e9e6;padding-left:14px;min-height:0;box-sizing:border-box;}',
            '.gs-his-title{font-size:12px;font-weight:700;color:#9b9b93;margin-bottom:8px;letter-spacing:.5px;}',
            '.gs-his-list{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:8px;}',
            '.gs-rec{position:relative;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:10px 10px 9px;background:#ffffff;border:1px solid #eceaea;border-radius:12px;flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,.03);}',
            '.gs-rec .gs-recd{position:absolute;top:5px;left:10px;font-size:9px;color:#b0afaa;letter-spacing:.3px;}',
            '.gs-rec-side{display:flex;align-items:center;gap:6px;margin-top:12px;}',
            '.gs-rec-side .gs-rec-hearts{display:flex;gap:2px;}',
            '.gs-rec-who{position:absolute;top:5px;right:10px;font-size:9px;color:var(--ac,#6f7ec4);font-weight:700;}',
            '.gs-empty{color:#b0afaa;text-align:center;font-size:12px;padding:26px 0;}',
            // ── 2048 ──
            '.g2-score{display:inline-flex;align-items:center;gap:7px;margin:0 auto;padding:7px 18px;border-radius:999px;background:linear-gradient(135deg,#fffbe6,#ffeebb);color:var(--g2warm,#9a7a2a);font-size:12px;font-weight:800;letter-spacing:.6px;box-shadow:inset 0 0 0 1px rgba(201,164,92,.25),0 6px 14px rgba(226,178,92,.16);}',
            '.g2-score b{font-size:20px;color:var(--g2warmd,#8a6428);font-variant-numeric:tabular-nums;margin-left:2px;}',
            '.g2-start{min-width:150px;border-radius:999px!important;}',
            '.g2-screen .gs-seg button.on{background:linear-gradient(145deg,#fff4d6,#f9e3a8);color:#8a6d2f;}',
            '.g2-screen .gs-btn-start{background:linear-gradient(145deg,#fff4d6,#f9e3a8);color:#8a6d2f;}',
            '.g2-wrap{position:relative;width:100%;max-width:340px;margin:0 auto;aspect-ratio:1/1;border-radius:28px;padding:14px;box-sizing:border-box;background:linear-gradient(165deg,#fffbe8 0%,#fff3c4 55%,#ffe9ad 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.9),0 14px 34px rgba(240,196,110,.22),0 4px 12px rgba(0,0,0,.04);overflow:hidden;}',
            '.g2-wrap::before{content:"";position:absolute;inset:0;border-radius:28px;pointer-events:none;background:radial-gradient(circle at 18% 12%,rgba(255,255,255,.9),transparent 42%),radial-gradient(circle at 85% 88%,rgba(255,214,140,.6),transparent 46%);}',
            '.g2-grid{position:relative;width:100%;height:100%;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(4,1fr);gap:9px;}',
            '.g2-cell{border-radius:14px;background:#fdf1c4;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:24px;line-height:1;box-shadow:inset 0 0 0 1px rgba(255,255,255,.6);transition:transform .1s,background .12s;}',
            '.g2-cell b{color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.10);}',
            '.g2-cell.g2-2{background:#fffbe5;}.g2-cell.g2-4 b{color:#8a6a35;text-shadow:none;}.g2-cell.g2-2 b{color:#8a6a35;text-shadow:none;}',
            '.g2-cell.g2-4{background:#fff8d4;}',
            '.g2-cell.g2-8{background:#ffeab6;}',
            '.g2-cell.g2-16{background:#ffdd96;}',
            '.g2-cell.g2-32{background:#ffd078;}',
            '.g2-cell.g2-64{background:#f7c066;}',
            '.g2-cell.g2-128{background:#eeab58;}',
            '.g2-cell.g2-256{background:#e89b4d;}',
            '.g2-cell.g2-512{background:#e08a44;}',
            '.g2-cell.g2-1024{background:#d77b3d;}',
            '.g2-cell.g2-2048{background:#cd6d36;}',
            '.g2-cell.g2-big{font-size:18px;}',
            '.g2-hint{position:absolute;left:50%;bottom:7%;transform:translateX(-50%);background:rgba(60,50,60,.55);color:#fff;font-size:11px;padding:5px 14px;border-radius:20px;white-space:nowrap;pointer-events:none;}',
            '.g2-turn{text-align:center;font-size:12px;color:var(--gs-muted,#9b9b93);min-height:16px;font-weight:600;letter-spacing:.3px;}',
            '.g2-av{display:flex;align-items:center;justify-content:space-between;padding:2px 8px;}',
            '.g2-pl,.g2-pr{display:flex;align-items:center;gap:6px;}',
            '.g2-av .gs-pn{font-size:11px;color:var(--gs-muted2,#6a6e80);font-weight:700;white-space:nowrap;}',
            '.g2-hb{width:118px;height:30px;flex:none;overflow:visible;margin:0 4px;}',
            '.g2-hb path{fill:none;stroke:#f6a9c0;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:500;stroke-dashoffset:0;filter:drop-shadow(0 0 4px rgba(246,169,192,.5));animation:g2-beat 1.5s ease-in-out infinite;}',
            '@keyframes g2-beat{0%,100%{opacity:.72;stroke-width:2.0;}50%{opacity:1;stroke-width:2.8;}}',
            '.g2-result{text-align:center;font-size:13px;color:var(--g2warmd,#8a6428);font-weight:700;min-height:16px;}',
            '.g2-result b{font-size:17px;}',
            '.g2-rec{position:relative;flex-direction:row;align-items:center;}',
            '.g2-rec-av{display:flex;align-items:center;}',
            '.g2-rec-av>*{margin-left:-12px;}',
            '.g2-rec-av>*:first-child{margin-left:0;border:2px solid var(--gs-bg2,#f5f5f2);border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.10);}',
            '.g2-rec-score{font-size:15px;font-weight:800;color:var(--g2warmd,#8a6428);font-variant-numeric:tabular-nums;}',
            // ── 2048 花边装饰 ──
            '.g2-wrap{outline:1.5px dotted rgba(226,178,120,.55);outline-offset:-9px;}',
            // ── 樱花花瓣散落 ──
            // gs-screen 建立层叠上下文，花瓣以负 z-index 置于所有内容之下，避免覆盖按钮/文字导致排版混乱
            '.gs-screen{position:relative;z-index:0;}',
            '.sakura{position:absolute;pointer-events:none;z-index:-1;}',
            '.sakura-leaf{display:block;animation:sakuraFall ease-in-out infinite;}',
            '@keyframes sakuraFall{0%,100%{transform:translateY(-5px) rotate(-10deg);}50%{transform:translateY(9px) rotate(12deg);}}',
            // 顶层内容行浮于花瓣之上，避免花瓣遮挡按钮/文字导致排版混乱
            '.gs-board-col>*:not(.sakura){position:relative;z-index:1;}',
            // ── 猜数字对决 ──
            '.gn-range{display:flex;align-items:center;justify-content:center;gap:4px;margin:0 auto;padding:6px 16px;border-radius:999px;background:linear-gradient(135deg,#f2fbf6,#e4f4ec);color:var(--gs-muted,#5f7a6f);font-size:12px;font-weight:700;letter-spacing:.5px;box-shadow:inset 0 0 0 1px rgba(159,212,192,.30),0 6px 14px rgba(120,190,165,.10);}',
            '.gn-range b{color:var(--ac-strong,#4f9e83);font-size:14px;margin:0 2px;font-variant-numeric:tabular-nums;}',
            '.gn-diff{display:flex;gap:8px;justify-content:center;margin:0 auto 6px;}',
            '.gn-diff-btn{flex:0 1 auto;padding:7px 16px;border-radius:999px;border:1.5px solid rgba(159,212,192,.42);background:rgba(255,255,255,.72);color:var(--gs-muted,#5f7a6f);font-size:12px;font-weight:700;letter-spacing:.5px;cursor:pointer;transition:all .15s;}',
            '.gn-diff-btn.sel{border-color:transparent;background:linear-gradient(135deg,#8fd0b2,#5fb393);color:#fff;box-shadow:0 4px 10px rgba(95,179,147,.35);}',
            'html[data-theme="dark"] .gn-diff-btn{background:rgba(31,44,38,.8);border-color:rgba(159,212,192,.2);color:#9fb7ad;}',
            // ── 猜数字：难易选择(毛玻璃胶囊) ──
            '.gn-stage{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;min-height:0;gap:16px;margin:auto;width:100%;max-width:400px;text-align:center;}',
            '.gn-stage-title{font-size:22px;font-weight:800;color:var(--gn-title,#3f7a63);letter-spacing:.5px;}',
            '.gn-stage-sub{font-size:12px;color:var(--gs-muted,#7c9a8f);letter-spacing:1.5px;}',
            '.gn-caps{display:flex;gap:20px;width:100%;justify-content:center;margin-top:6px;}',
            '.gn-cap{flex:1;max-width:158px;display:flex;flex-direction:column;align-items:center;gap:7px;padding:22px 14px;border-radius:999px;border:none;cursor:pointer;color:var(--gs-txt,#33343b);background:rgba(255,255,255,.38);-webkit-backdrop-filter:blur(16px) saturate(150%);backdrop-filter:blur(16px) saturate(150%);border:1px solid rgba(255,255,255,.6);box-shadow:0 10px 26px rgba(120,190,165,.22),inset 0 1px 0 rgba(255,255,255,.65);transition:transform .15s,box-shadow .15s;}',
            '.gn-cap:active{transform:scale(.94);}',
            '.gn-cap-name{font-size:17px;font-weight:800;color:var(--ac-strong,#3f9a7a);}',
            '.gn-cap-sub{font-size:11px;color:var(--gs-muted,#7c9a8f);letter-spacing:.5px;font-variant-numeric:tabular-nums;}',
            '.gn-stage-tip{margin-top:2px;font-size:11px;color:var(--gs-muted,#9aafa6);letter-spacing:.5px;opacity:.8;}',
            '.gn-diffstage-col{align-self:stretch;justify-content:center;}',
            'html[data-theme="dark"] .gn-stage-title{color:#9ad7bc;}',
            'html[data-theme="dark"] .gn-cap{background:rgba(42,54,48,.42);border-color:rgba(159,212,192,.22);}',
            'html[data-theme="dark"] .gn-cap-name{color:#8fd4b8;}',
            'html[data-theme="dark"] .gn-cap-sub,html[data-theme="dark"] .gn-stage-sub,html[data-theme="dark"] .gn-stage-tip{color:#9aa9a5;}',
            '.gn-pad{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:16px;border-radius:28px;background:linear-gradient(165deg,#ffffff 0%,#f3faf6 60%,#eaf5ef 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.7),0 14px 34px rgba(120,190,165,.13),0 4px 12px rgba(0,0,0,.04);min-height:300px;overflow:hidden;position:relative;flex-shrink:0;box-sizing:border-box;width:100%;}',
            '.gn-pad::before{content:"";position:absolute;top:-46px;right:-34px;width:160px;height:160px;border-radius:50%;background:radial-gradient(circle,rgba(159,212,192,.38),transparent 70%);pointer-events:none;}',
            '.gn-pad::after{content:"";position:absolute;bottom:-54px;left:-36px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(248,214,220,.42),transparent 70%);pointer-events:none;}',
            '.gn-pad{outline:1.5px dotted rgba(159,212,192,.5);outline-offset:-9px;}',
            '.gn-big{position:relative;z-index:1;font-size:54px;line-height:1;filter:drop-shadow(0 8px 12px rgba(120,190,165,.20));animation:gn-float 2.6s ease-in-out infinite;}',
            '@keyframes gn-float{0%,100%{transform:translateY(0);}50%{transform:translateY(-6px);}}',
            '.gn-fb{position:relative;z-index:1;font-size:15px;color:var(--gs-txt,#33343b);text-align:center;line-height:1.7;padding:0 8px;font-weight:500;}',
            '.gn-fb b{color:var(--ac-strong,#4f9e83);font-variant-numeric:tabular-nums;font-weight:800;}',
            '.gn-input-row{position:relative;z-index:1;display:flex;gap:10px;align-items:stretch;}',
            '.gn-input{width:160px;padding:12px 16px;border:none;border-radius:999px;font-size:17px;text-align:center;background:rgba(255,255,255,.92);color:var(--gs-txt,#33343b);outline:none;box-shadow:inset 0 2px 6px rgba(120,190,165,.14),inset 0 0 0 1px rgba(120,190,165,.25);}',
            '.gn-input:focus{box-shadow:inset 0 2px 6px rgba(120,190,165,.14),0 0 0 3px rgba(159,212,192,.35);}',
            '.gn-submit{border:none;border-radius:999px;padding:12px 26px;font-size:15px;font-weight:800;background:linear-gradient(135deg,#7fc9ae,#4fae90);color:#fff;cursor:pointer;box-shadow:0 6px 14px rgba(79,174,144,.30);transition:transform .12s;}',
            '.gn-submit:active{transform:scale(.95);box-shadow:0 3px 8px rgba(79,174,144,.20);}',
            // ── 深色跟随系统 ──
            'html[data-theme="dark"] .gs-screen{--gs-bg1:#17181c;--gs-bg2:#1e1f24;--gs-txt:#e7e6ee;--gs-muted:#9a9aa5;--gs-muted2:#a9a9b5;}',
            'html[data-theme="dark"] .g2-score{color:#d8c39a;}',
            'html[data-theme="dark"] .g2-score b,html[data-theme="dark"] .g2-result,html[data-theme="dark"] .g2-rec-score{color:#e8d09d;}',
            'html[data-theme="dark"] .g2-wrap{background:#23251f;}',
            'html[data-theme="dark"] .g2-cell{background:rgba(215,182,120,.14);}',
            'html[data-theme="dark"] .g2-rec-av>*:first-child{border-color:#1e1f24;}',
            'html[data-theme="dark"] .gs-seg{border-color:#33343b;}',
            'html[data-theme="dark"] .gs-seg button{color:#9a9aa5;}',
            'html[data-theme="dark"] .gs-history-col{border-color:#2c2d33;}',
            'html[data-theme="dark"] .gs-rec,html[data-theme="dark"] .gs-empty{background:#232329;}',
            'html[data-theme="dark"] .gs-rec{border-color:#2f2f36;}',
            'html[data-theme="dark"] .gs-empty{color:#8a8a94;}',
            'html[data-theme="dark"] .gs-rec .gs-recd{color:#7f7f88;}',
            'html[data-theme="dark"] .gn-fb,html[data-theme="dark"] .gn-range b{color:#e7e6ee;}',
            'html[data-theme="dark"] .gn-range{background:linear-gradient(135deg,#22312b,#1f2c26);box-shadow:inset 0 0 0 1px rgba(159,212,192,.16);}',
            'html[data-theme="dark"] .gn-range b{color:#8fd4b8;}',
            'html[data-theme="dark"] .gn-fb b{color:#8fd4b8;}',
            'html[data-theme="dark"] .gn-pad{background:linear-gradient(165deg,#1c221e 0%,#232b26 60%,#26302a 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.05);}',
            'html[data-theme="dark"] .gn-pad::after{background:radial-gradient(circle,rgba(79,174,144,.22),transparent 70%);}',
            'html[data-theme="dark"] .gn-input{background:rgba(255,255,255,.06);color:#e7e6ee;box-shadow:inset 0 2px 6px rgba(0,0,0,.35),inset 0 0 0 1px rgba(159,212,192,.20);}',
            // 系统深色兜底：仅当 data-theme 未被手动锁定为浅色时生效
            '@media (prefers-color-scheme: dark){ html:not([data-theme="light"]) .gs-screen{--gs-bg1:#17181c;--gs-bg2:#1e1f24;--gs-txt:#e7e6ee;--gs-muted:#9a9aa5;--gs-muted2:#a9a9b5;} }',
            '@media (prefers-color-scheme: dark){ html:not([data-theme="light"]) .g2-score{color:#d8c39a;} html:not([data-theme="light"]) .g2-score b,html:not([data-theme="light"]) .g2-result,html:not([data-theme="light"]) .g2-rec-score{color:#e8d09d;} }',
            '@media (prefers-color-scheme: dark){ html:not([data-theme="light"]) .g2-wrap{background:#23251f;} html:not([data-theme="light"]) .g2-cell{background:rgba(215,182,120,.14);} html:not([data-theme="light"]) .g2-rec-av>*:first-child{border-color:#1e1f24;} }',
            '@media (prefers-color-scheme: dark){ html:not([data-theme="light"]) .gs-seg{border-color:#33343b;} html:not([data-theme="light"]) .gs-seg button{color:#9a9aa5;} html:not([data-theme="light"]) .gs-history-col{border-color:#2c2d33;} }',
            '@media (prefers-color-scheme: dark){ html:not([data-theme="light"]) .gs-rec,html:not([data-theme="light"]) .gs-empty{background:#232329;} html:not([data-theme="light"]) .gs-rec{border-color:#2f2f36;} html:not([data-theme="light"]) .gs-empty{color:#8a8a94;} html:not([data-theme="light"]) .gs-rec .gs-recd{color:#7f7f88;} }',
            '@media (prefers-color-scheme: dark){ html:not([data-theme="light"]) .gn-range{background:linear-gradient(135deg,#22312b,#1f2c26);} html:not([data-theme="light"]) .gn-range b,html:not([data-theme="light"]) .gn-fb b{color:#8fd4b8;} html:not([data-theme="light"]) .gn-fb{color:#e7e6ee;} html:not([data-theme="light"]) .gn-pad{background:linear-gradient(165deg,#1c221e 0%,#232b26 60%,#26302a 100%);} html:not([data-theme="light"]) .gn-input{background:rgba(255,255,255,.06);color:#e7e6ee;} }',
            // ── 窄屏 / 布局兜底：避免两栏挤压成细列、内容溢出或被截断 ──
            '.gs-hr{flex-wrap:wrap;row-gap:6px;}',
            '.gs-player .gs-hearts{flex-shrink:0;}',
            '.gs-pn{overflow:hidden;text-overflow:ellipsis;max-width:46vw;}',
            '.gn-fb{white-space:normal;word-break:break-word;}',
            '@media(max-width:900px){.gs-history-col{display:none;}',
            '.gs-body.gs-show-hist .gs-board-col{display:none;}',
            '.gs-body.gs-show-hist .gs-history-col{display:flex;}}'
        ].join('\n');
        document.head.appendChild(el);
    }

    // ── 会话 ────────────────────────────────
    function newSession (game) {
        var n = GAME_META[game].n;
        var board = [];
        for (var i = 0; i < n; i++) { board.push(new Array(n).fill(0)); }
        state = {
            game: game,
            n: n,
            board: board,
            turn: 'user',
            started: false,
            over: false,
            sessionOver: false,
            score: 0,            // 2048：累计得分
            guessCount: 0,       // 猜数字：本轮已猜次数
            gnDiff: 'easy',      // 猜数字：难度 easy(0~100) / hard(0~1000)
            gnDiffPicked: false, // 猜数字：是否已选择难度(进入开局界面)
            gnLo: 0,             // 猜数字：当前已知下限
            gnHi: n,             // 猜数字：当前已知上限
            gnAnswer: 0,         // 猜数字：本轮秘密数字
            dreamHearts: [true, true, true],
            userHearts: [true, true, true],
            coqUsed: 0, cheUsed: 0,
            prisoners: [0, 0],   // [捕黑, 捕白]
            moves: [],           // 棋盘快照栈（保留）
            userUndo: [],        // 玩家每手落子前快照（悔棋用）
            lastMove: null,      // {r,c,color}
            koHist: [],          // go：每手后的局面字符串（简单劫）
            passes: 0,
            userPassed: false,   // 围棋：玩家是否让手
            dreamPassed: false,  // 围棋：梦角是否让手
            result: null         // 整局结果 {winner, dBroken, uBroken}
        };
    }

    // ── 主界面渲染 ─────────────────────────
    function openGame(game) {
        injectStyle();
        newSession (game);
        renderScreen();
    }
    global._goOpen = openGame;
    global._goBack = function () {
        clearAi();
        state = null;
        if (typeof global._gameRoomRender === 'function') global._gameRoomRender();
    };
    global._goSwitchView = function (v, el) {
        if (!state) return;
        var body = document.querySelector('.gs-body');
        if (!body) return;
        if (v === 'hist') body.classList.add('gs-show-hist');
        else body.classList.remove('gs-show-hist');
        var seg = body.closest('.gs-screen').querySelectorAll('.gs-seg button');
        for (var i = 0; i < seg.length; i++) seg[i].classList.toggle('on', seg[i].getAttribute('data-v') === v);
    };

    function renderScreen() {
        if (!state) return;
        var panel = document.getElementById('cs-panel-game');
        if (!panel) return;
        if (state.game === '2048') { renderScreen2048(panel); return; }
        if (state.game === 'guessnum') { renderScreenGuessNum(panel); return; }
        var m = GAME_META[state.game];
        var dream = partnerName(), you = myName();
        panel.innerHTML =
            '<div class="gs-screen">'
            + '<div class="gs-topbar">'
            +   '<button class="gs-ibtn" onclick="window._goBack()"><i class="fas fa-chevron-left"></i></button>'
            +   '<span class="gs-title">' + esc(m.name) + '</span>'
            +   '<div class="gs-seg">'
            +     '<button data-v="board" class="on" onclick="window._goSwitchView(\'board\',this)">棋局</button>'
            +     '<button data-v="hist" onclick="window._goSwitchView(\'hist\',this)">历史</button>'
            +   '</div>'
            + '</div>'
            + '<div class="gs-body">'
            +   '<div class="gs-board-col">'
            +     ctlHTML()
            +     '<div class="gs-board-wrap" id="gs-board-wrap">'
            +       '<canvas id="gs-board"></canvas>'
            +      (state.started && !state.sessionOver ? '<div class="gs-hint">' + (state.turn === 'user' ? '轮到' + esc(myName()) + '落子' : dream + '思考中…') + '</div>' : '')
            +     '</div>'
            +     statusHTML()
            +     heartsHTML(dream, you)
            +     resultHTML()
            +   '</div>'
            +   histPanelHTML()
            + '</div>'
            + '</div>';
        var scr = panel.querySelector('.gs-screen');
        if (scr) applyPalette(scr, state.game);
        var cv = document.getElementById('gs-board');
        cv.width = BOARD_PX; cv.height = BOARD_PX;
        cv.addEventListener('click', onBoardClick);
        var wrap = document.getElementById('gs-board-wrap');
        wrap.addEventListener('click', function () {
            // 当前为窄屏历史视图时点击返回棋局
            if (wrap.closest('.gs-body').classList.contains('gs-show-hist')) global._goSwitchView('board');
        });
        renderBoard();
        // 若游戏未开始，给出提示
        if (!state.started && !state.sessionOver) setTimeout(function () { hint('点击「开始」开局'); }, 60);
    }

    function ctlHTML() {
        var d = (state.coqUsed >= 2) ? ' title="本局撒娇次数已用完"' : '';
        var c = (state.cheUsed >= 5) ? ' title="本局耍赖次数已用完"' : '';
        var passBtn = state.game === 'go'
            ? '<button class="gs-btn gs-btn-soft" onclick="window._goPass(this)"><i class="fas fa-hand-paper"></i> 让手</button>'
            : '';
        return '<div class="gs-ctl">'
            + '<button class="gs-btn gs-btn-soft" onclick="window._goCoquettish(this)"' + d + '><i class="fas fa-heart-broken"></i> 撒娇</button>'
            + '<button class="gs-btn gs-btn-start" onclick="window._goStart(this)">开始</button>'
            + '<button class="gs-btn gs-btn-drop" onclick="window._goCheat(this)"' + c + '><i class="fas fa-undo"></i> 耍赖</button>'
            + passBtn
            + '</div>';
    }
    function statusHTML() {
        if (state.sessionOver) return '';
        return '<div class="gs-status" id="gs-status">' + (state.started ? (state.turn === 'user' ? '🙂 轮到' + esc(myName()) + '落子' : '🤖 ' + esc(partnerName()) + '回合') : '点击「开始」开始游戏') + '</div>';
    }
    function heartsHTML(dream, you) {
        return '<div class="gs-hr">'
            + '<div class="gs-player"><span class="gs-hearts">' + heartIcons(state.dreamHearts) + '</span>' + avHTML(true, 36) + ' <span class="gs-pn">' + esc(dream) + '</span></div>'
            + '<div class="gs-player right"><span class="gs-pn">' + you + '</span>' + avHTML(false, 36) + ' <span class="gs-hearts">' + heartIcons(state.userHearts) + '</span></div>'
            + '</div>';
    }
    function resultHTML() {
        if (!state.sessionOver || !state.result) return '';
        if (state.game === '2048') {
            return '<div class="g2-result">本局得分 <b>' + (state.result.score || 0) + '</b>'
                + ' <button class="gs-resbtn" onclick="window._goRestart(this)">再来一局</button></div>';
        }
        var w = state.result.winner === 'user' ? esc(myName()) : esc(partnerName());
        return '<div class="gs-result">' + w + ' 获胜！'
            + ' <button class="gs-resbtn" onclick="window._goRestart(this)">再来一局</button></div>';
    }
    global._goRestart = function () { if (!state) return; newSession(state.game); renderScreen(); };

    function histPanelHTML() {
        var m = GAME_META[state.game];
        var recs = getRecords()[state.game];
        var items = recs && recs.length
            ? recs.slice().reverse().map(function (r) { return recordHTML(r); }).join('')
            : '<div class="gs-empty">暂无对战记录</div>';
        return '<div class="gs-history-col">'
            + '<div class="gs-his-title">对战记录 · ' + esc(m.name) + '</div>'
            + '<div class="gs-his-list">' + items + '</div>'
            + '</div>';
    }
    function recordHTML(r) {
        if (state.game === '2048') return recordHTML2048(r);
        var dW = partnerName();
        var uW = r.winner === 'user' ? '你' : '';
        var who = r.winner === 'user' ? esc(myName()) + ' 获胜' : dW + ' 获胜';
        return '<div class="gs-rec">'
            + '<span class="gs-recd">' + esc(r.d) + '</span>'
            + '<span class="gs-rec-who">' + esc(who) + '</span>'
            + '<div class="gs-rec-side">' + avHTML(true, 30) + '<span class="gs-rec-hearts">' + heartIcons(brokenToBools(r.dBroken), 13) + '</span></div>'
            + '<div class="gs-rec-side">' + avHTML(false, 30) + '<span class="gs-rec-hearts">' + heartIcons(brokenToBools(r.uBroken), 13) + '</span></div>'
            + '</div>';
    }
    function brokenToBools(k) {
        return [(k < 1), (k < 2), (k < 3)];
    }
    function dateStr() {
        var d = new Date();
        return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }

    // ── 顶栏按钮 ───────────────────────────
    // 开启一轮：清空棋盘，指定先手方；梦角先手则自动下第一手。
    function beginRound(firstTurn) {
        // 2048：清空网格，初始两个血块，随机先手
        if (state.game === '2048') {
            state.over = false;
            state.sessionOver = false;
            state.started = true;
            state.score = 0;
            var b = state.board;
            for (var rr = 0; rr < b.length; rr++) for (var cc = 0; cc < b[0].length; cc++) b[rr][cc] = 0;
            g2AddTile(b); g2AddTile(b);
            state.turn = firstTurn;
            renderScreen();
            if (firstTurn === 'dream') schedule2048();
            return;
        }
        if (state.game === 'guessnum') {
            state.over = false;
            state.sessionOver = false;
            state.started = true;
            state.guessCount = 0;
            state.n = state.gnDiff === 'hard' ? 1000 : 100;
            state.gnLo = 0;
            state.gnHi = state.n;
            state.gnAnswer = Math.floor(Math.random() * (state.n + 1));
            state.turn = firstTurn;
            renderScreen();
            if (firstTurn === 'dream') scheduleGnAI();
            return;
        }
        state.over = false;
        state.started = true;
        state.board = emptyBoard(state.n);
        state.lastMove = null;
        state.koHist.length = 0;
        state.userUndo.length = 0;
        state.prisoners = [0, 0];
        state.userPassed = false;
        state.dreamPassed = false;
        state.turn = firstTurn;
        renderScreen();
        if (firstTurn === 'dream') scheduleAi();
    }
    global._goStart = function (btn) {
        if (!state || state.sessionOver || state.started) return;
        // 整局首轮：随机决定谁先落子
        beginRound(Math.random() < 0.5 ? 'user' : 'dream');
    };
    global._goCoquettish = function (btn) {
        if (!state) return;
        if (state.coqUsed >= 2) { notify('本局撒娇次数已用完（最多2次）', 'info'); return; }
        if (brokenCount(state.userHearts) === 0) { notify('你的爱心都完好无损哦', 'info'); return; }
        var ok = Math.random() < 0.5;
        if (ok) {
            state.coqUsed++;
            for (var i = 0; i < 3; i++) if (!state.userHearts[i]) { state.userHearts[i] = true; break; }
            notify('梦角同意了你的撒娇，一颗爱心恢复完整 💗', 'success');
        } else {
            notify('梦角笑着摇摇头，拒绝了这次撒娇', 'info');
        }
        renderScreen();
    };
    global._goCheat = function (btn) {
        if (!state) return;
        if (state.sessionOver || !state.started) { notify('游戏进行中才能悔棋', 'info'); return; }
        if (state.cheUsed >= 5) { notify('本局耍赖次数已用完（最多5次）', 'info'); return; }
        if (state.userUndo.length === 0) { notify('还没有可悔的棋', 'info'); return; }
        var ok = Math.random() < 0.5;
        if (ok) {
            state.cheUsed++;
            undoMove();
            notify('梦角噘噘嘴，同意了你的悔棋 ⏪', 'success');
        } else {
            notify('被梦角识破了，耍赖失败！', 'info');
        }
        // 不管成功与否都刷新（成功时棋盘已变）
        renderScreen();
    };

    // ── 棋盘交互 ───────────────────────────
    function onBoardClick(e) {
        if (!state || !state.started || state.sessionOver || state.over || state.turn !== 'user') return;
        var cv = e.currentTarget;
        var rect = cv.getBoundingClientRect();
        var scale = rect.width / cv.width;
        var x = (e.clientX - rect.left) / scale;
        var y = (e.clientY - rect.top) / scale;
        var n = state.n, cell = (BOARD_PX - 2 * MARGIN) / (n - 1);
        var col = Math.round((x - MARGIN) / cell), row = Math.round((y - MARGIN) / cell);
        if (row < 0 || row >= n || col < 0 || col >= n) return;
        if (state.board[row][col]) return;
        doUserMove(row, col);
    }

    function doUserMove(r, c) {
        var res = state.game === 'go' ? simulateMove(r, c, USER) : null;
        if (state.game === 'go' && !res) { notify('该位置不能落子（禁入/自提）', 'info'); return; }
        // 记录本手落子前快照（悔棋时恢复，可连悔多手）
        state.userUndo.push({ board: cloneBoard(state.board), prisoners: state.prisoners.slice(), koLen: state.koHist.length });
        if (state.game === 'gomoku') state.board[r][c] = USER;
        else { state.board = res.board; state.prisoners = res.prisoners; }
        state.lastMove = { r: r, c: c, color: USER };
        if (state.game === 'go') {
            state.koHist.push(boardKey(state.board));
            // 真实落子后打断连续让手
            state.userPassed = false;
            state.dreamPassed = false;
        }
        var win = state.game === 'gomoku' && checkWin(r, c, USER);
        if (win) { afterRound('', true); }
        else if (boardFull() && state.game === 'go') { scoreGo(); }
        else { state.turn = 'dream'; refresh(); scheduleAi(); }
    }

    function scheduleAi() {
        clearAi();
        // 梦角响应时间：五子棋随机 2s ~ 15s，围棋随机 2s ~ 30s，营造思考延迟
        var delay = (state.game === 'gomoku')
            ? 2000 + Math.floor(Math.random() * 13000)
            : 2000 + Math.floor(Math.random() * 28000);
        aiTimer = setTimeout(function () {
            aiTimer = null;
            if (!state || state.sessionOver || state.over || state.turn !== 'dream') return;
            var mv = state.game === 'gomoku' ? aiGomoku() : aiGo();
            if (mv === 'pass') { passRound('dream'); return; }
            else {
                state.board = mv.board;
                if (mv.prisoners) state.prisoners = mv.prisoners;
                state.lastMove = { r: mv.r, c: mv.c, color: DREAM };
                if (state.game === 'go') {
                    state.koHist.push(boardKey(state.board));
                    // 真实落子后打断连续让手
                    state.userPassed = false;
                    state.dreamPassed = false;
                }
                // 完成一个回合 → 轮到用户
                var win = state.game === 'gomoku' && checkWin(mv.r, mv.c, DREAM);
                if (win) afterRound('', false);
                else if (boardFull() && state.game === 'go') scoreGo();
                else { state.turn = 'user'; refresh(); }
            }
        }, delay);
    }
    function clearAi() { if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; } }

    // 围棋让手：一方无棋可下（或主动放弃）时跳过。双方连续让手则按数子法结算本轮。
    function passRound(player) {
        if (player === 'user') state.userPassed = true; else state.dreamPassed = true;
        var consecutive = player === 'user' ? state.dreamPassed : state.userPassed;
        if (consecutive) { scoreGo(); return; }
        notify(player === 'user' ? '你让一手' : (partnerName() + '让一手'), 'info');
        state.turn = player === 'user' ? 'dream' : 'user';
        if (state.turn === 'dream') scheduleAi();
        refresh();
    }
    // 玩家主动让手（仅围棋）
    global._goPass = function () {
        if (!state || state.sessionOver || !state.started || state.game !== 'go' || state.turn !== 'user') return;
        passRound('user');
    };

    function undoMove() {
        if (state.userUndo.length === 0) return;
        var snap = state.userUndo.pop();
        state.board = snap.board;
        state.prisoners = snap.prisoners;
        state.koHist.length = snap.koLen;
        state.turn = 'user';
        state.lastMove = null;
        state.userPassed = false;
        state.dreamPassed = false;
        clearAi();
    }

    // ══ 2048 ═════════════════════════════════
    // 单行滑动合并：返回 [新行, 得分增加]
    function g2Line(line) {
        var arr = [], gain = 0;
        for (var i = 0; i < line.length; i++) if (line[i]) arr.push(line[i]);
        var out = [];
        for (var j = 0; j < arr.length; j++) {
            if (j + 1 < arr.length && arr[j] === arr[j + 1]) { out.push(arr[j] * 2); gain += arr[j] * 2; j++; }
            else out.push(arr[j]);
        }
        while (out.length < line.length) out.push(0);
        return [out, gain];
    }
    function g2Move(b, d) {
        var n = b.length, b2 = [], gain = 0, changed = false;
        for (var i = 0; i < n; i++) b2.push(b[i].slice());
        if (d === 0 || d === 1) { // 0上 / 1下（按列）
            for (var c = 0; c < n; c++) {
                var line = [];
                for (var r = 0; r < n; r++) line.push(b2[r][c]);
                if (d === 1) line.reverse();
                var res = g2Line(line);
                if (d === 1) res[0].reverse();
                for (var r2 = 0; r2 < n; r2++) { if (b2[r2][c] !== res[0][r2]) changed = true; b2[r2][c] = res[0][r2]; }
                gain += res[1];
            }
        } else { // 2左 / 3右（按行）
            for (var r = 0; r < n; r++) {
                var line = (d === 3) ? b2[r].slice().reverse() : b2[r].slice();
                var res = g2Line(line);
                var out = (d === 3) ? res[0].reverse() : res[0];
                for (var c = 0; c < n; c++) { if (b2[r][c] !== out[c]) changed = true; b2[r][c] = out[c]; }
                gain += res[1];
            }
        }
        return { b2: b2, gain: gain, changed: changed };
    }
    function g2AddTile(b) {
        var empty = [];
        for (var r = 0; r < b.length; r++) for (var c = 0; c < b[0].length; c++) if (!b[r][c]) empty.push([r, c]);
        if (!empty.length) return;
        var p = empty[Math.floor(Math.random() * empty.length)];
        b[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;
    }
    function g2AnyMove(b) {
        for (var d = 0; d < 4; d++) if (g2Move(b, d).changed) return true;
        return false;
    }
    function userSwipe(d) {
        if (!state || state.game !== '2048' || !state.started || state.sessionOver || state.over || state.turn !== 'user') return;
        var res = g2Move(state.board, d);
        if (!res.changed) { notify('这个方向滑不动哦', 'info'); return; }
        state.board = res.b2;
        state.score += res.gain;
        g2AddTile(state.board);
        if (!g2AnyMove(state.board)) { end2048(); return; }
        state.turn = 'dream';
        refresh2048();
        schedule2048();
    }
    global._g2dir = function (d) { userSwipe(d); };
    // 梦角：随机 2s~30s 后，以 25% 均等概率选上/下/左/右
    function schedule2048() {
        clearAi();
        var delay = 2000 + Math.floor(Math.random() * 28000);
        aiTimer = setTimeout(function () {
            aiTimer = null;
            if (!state || state.game !== '2048' || state.sessionOver || state.over || state.turn !== 'dream') return;
            var d = Math.floor(Math.random() * 4);
            var res = g2Move(state.board, d);
            if (res.changed) {
                state.board = res.b2;
                state.score += res.gain;
                g2AddTile(state.board);
            }
            if (!g2AnyMove(state.board)) { end2048(); return; }
            state.turn = 'user';
            refresh2048();
        }, delay);
    }
    function end2048() {
        state.over = true;
        state.sessionOver = true;
        state.result = { score: state.score };
        record2048(state.score);
        notify('本局结束，最终得分 ' + state.score, 'info');
        renderScreen();
    }
    function record2048(score) {
        var data = getRecords();
        if (!data['2048']) data['2048'] = [];
        data['2048'].push({ d: dateStr(), score: score });
        if (data['2048'].length > 60) data['2048'].shift();
        saveRecords(data);
    }
    function renderBoard2048() {
        var grid = document.getElementById('g2-grid');
        if (!grid || !state) return;
        var b = state.board || [], n = state.n, h = '';
        for (var r = 0; r < n; r++) {
            for (var c = 0; c < n; c++) {
                var v = (b[r] && b[r][c]) || 0;
                var big = v >= 1024 ? ' g2-big' : '';
                h += '<div class="g2-cell g2-' + v + big + '">' + (v ? '<b>' + v + '</b>' : '') + '</div>';
            }
        }
        grid.innerHTML = h;
    }
    function refresh2048() {
        var sc = document.getElementById('g2-score');
        if (sc) sc.textContent = state.score || 0;
        renderBoard2048();
        g2Hint(state.turn === 'user' ? '轮到' + esc(myName()) + '滑动' : esc(partnerName()) + '操作中…');
    }
    function g2Hint(t) {
        var h = document.getElementById('gs-hint2048');
        if (h) h.textContent = t;
    }
    // 樱花花瓣随机散落层（cherry-blossom sakura）
    function sakuraLayer(petalColor, count) {
        count = count || 16;
        var html = '';
        for (var i = 0; i < count; i++) {
            var size = 12 + Math.random() * 11;          // 12~23px
            var left = 1 + Math.random() * 94;            // 1%~95%
            var top = 2 + Math.random() * 88;             // 2%~90%
            var rot = Math.random() * 360;
            var op = (0.4 + Math.random() * 0.55).toFixed(2);
            var dur = (6 + Math.random() * 6).toFixed(1); // 6~12s
            var del = (Math.random() * 9).toFixed(1);
            html += '<i class="sakura" style="left:' + left.toFixed(1) + '%;top:' + top.toFixed(1)
                + '%;transform:rotate(' + rot.toFixed(0) + 'deg);opacity:' + op + '">'
                + '<svg class="sakura-leaf" width="' + size.toFixed(1) + '" height="' + size.toFixed(1)
                + '" viewBox="0 0 22 22" style="animation-duration:' + dur + 's;animation-delay:-' + del + 's">'
                + '<path d="M11 0 C17 3 20 10 17 15 C14 19 12 22 11 22 C10 22 8 19 5 15 C2 10 5 3 11 0 Z" fill="' + petalColor + '"/>'
                + '<path d="M11 4 C7 6 5 10 7 13 C8 10 9 7 11 4Z" fill="rgba(255,255,255,.35)"/>'
                + '</svg></i>';
        }
        return html;
    }
    function renderScreen2048(panel) {
        var m = GAME_META[state.game], dream = partnerName();
        var beat = 'M6,20 L66,20 L74,18 L82,20 L116,20 L130,8 L142,32 L150,20 L212,20';
        panel.innerHTML =
            '<div class="gs-screen g2-screen">'
            + '<div class="gs-topbar">'
            +   '<button class="gs-ibtn" onclick="window._goBack()"><i class="fas fa-chevron-left"></i></button>'
            +   '<span class="gs-title">' + esc(m.name) + '</span>'
            +   '<div class="gs-seg">'
            +     '<button data-v="board" class="on" onclick="window._goSwitchView(\'board\',this)">游戏</button>'
            +     '<button data-v="hist" onclick="window._goSwitchView(\'hist\',this)">历史</button>'
            +   '</div>'
            + '</div>'
            + '<div class="gs-body">'
            +   '<div class="gs-board-col">'
            +     '<div class="g2-score">得分 <b id="g2-score">' + (state.score || 0) + '</b></div>'
            +     (state.sessionOver
                ? '<div class="g2-turn">本局已结束</div>'
                : (state.started
                    ? '<div class="g2-turn" id="gs-hint2048">' + (state.turn === 'user' ? '轮到' + esc(myName()) + '滑动' : esc(dream) + '操作中…') + '</div>'
                    : '<div class="gs-ctl"><button class="gs-btn gs-btn-start g2-start" onclick="window._goStart(this)">开始</button></div>'))
            +     sakuraLayer('#e9e2f6', 30)
            +     '<div class="g2-wrap" id="gs-board-wrap">'
            +       '<div class="g2-grid" id="g2-grid"></div>'
            +     '</div>'
            +     '<div class="g2-av">'
            +       '<div class="g2-pl">' + avHTML(true, 40) + ' <span class="gs-pn">' + esc(dream) + '</span></div>'
            +       '<svg class="g2-hb" viewBox="0 0 220 40" preserveAspectRatio="none"><path d="' + beat + '"></path></svg>'
            +       '<div class="g2-pr">' + avHTML(false, 40) + ' <span class="gs-pn">你</span></div>'
            +     '</div>'
            +     resultHTML()
            +   '</div>'
            +   histPanelHTML()
            + '</div>'
            + '</div>';
        var scr = panel.querySelector('.gs-screen');
        if (scr) applyPalette(scr, state.game);
        var wrap = document.getElementById('gs-board-wrap');
        attachSwipe(wrap);
        renderBoard2048();
        if (!state.started && !state.sessionOver) setTimeout(function () { g2Hint('点击「开始」开局'); }, 60);
    }
    function attachSwipe(el) {
        if (!el) return;
        el.style.touchAction = 'none';
        var x0 = 0, y0 = 0, dragging = false;
        el.addEventListener('pointerdown', function (e) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            dragging = true; x0 = e.clientX; y0 = e.clientY;
        });
        el.addEventListener('pointerup', function (e) {
            if (!dragging) return; dragging = false;
            if (!state || state.game !== '2048' || !state.started || state.sessionOver || state.over || state.turn !== 'user') return;
            var dx = e.clientX - x0, dy = e.clientY - y0;
            var ax = Math.abs(dx), ay = Math.abs(dy);
            if (Math.max(ax, ay) < 26) return;
            var d = ay > ax ? (dy > 0 ? 1 : 0) : (dx > 0 ? 3 : 2);
            userSwipe(d);
        });
    }
    function g2OnKey(e) {
        if (!state || state.game !== '2048' || !state.started || state.sessionOver || state.turn !== 'user') return;
        var map = { ArrowUp: 0, ArrowDown: 1, ArrowLeft: 2, ArrowRight: 3 };
        if (e.key in map) { e.preventDefault(); userSwipe(map[e.key]); }
    }
    window.addEventListener('keydown', g2OnKey);
    function recordHTML2048(r) {
        return '<div class="gs-rec g2-rec">'
            + '<span class="gs-recd">' + esc(r.d) + '</span>'
            + '<div class="g2-rec-av">' + avHTML(true, 30) + avHTML(false, 30) + '</div>'
            + '<span class="g2-rec-score">' + esc(r.score) + ' 分</span>'
            + '</div>';
    }

    // ══ 猜数字对决 ═════════════════════════════
    // 每轮在 1~n 中暗定一个数字，双方交替猜测；反馈太小/太大，猜中者赢下本轮，输方碎一颗心。
    function renderScreenGuessNum(panel) {
        var m = GAME_META[state.game], dream = partnerName();
        var you = myName();
        var fb, inputRow;
        // 阶段一：未选择难度 -> 显示难易选择；其余阶段正常进入猜数字界面
        var diffStage = !state.started && !state.sessionOver && !state.gnDiffPicked;
        if (state.sessionOver) {
            fb = (state.result && state.result.winner === 'user' ? esc(you) : esc(dream)) + ' 获胜，本局结束！';
            inputRow = false;
        } else if (!state.started) {
            fb = '点击「开始」开局';
            inputRow = false;
        } else if (state.turn === 'user') {
            fb = '范围 ' + state.gnLo + ' ~ ' + state.gnHi + '，轮到' + esc(myName()) + '猜';
            inputRow = true;
        } else {
            fb = esc(dream) + ' 正在猜…';
            inputRow = false;
        }
        // 板面内容：难易选择阶段 / 猜数字阶段
        var boardInner;
        if (diffStage) {
            boardInner =
                '<div class="gn-stage">'
                +   '<div class="gn-stage-title">选择难度</div>'
                +   '<div class="gn-stage-sub">决定本局的数字范围</div>'
                +   '<div class="gn-caps">'
                +     '<button class="gn-cap" data-d="easy">'
                +       '<span class="gn-cap-name">简单</span>'
                +       '<span class="gn-cap-sub">0 ~ 100</span>'
                +     '</button>'
                +     '<button class="gn-cap" data-d="hard">'
                +       '<span class="gn-cap-name">困难</span>'
                +       '<span class="gn-cap-sub">0 ~ 1000</span>'
                +     '</button>'
                +   '</div>'
                +   '<div class="gn-stage-tip">点击胶囊即可开局</div>'
                + '</div>'
                + sakuraLayer('#fbf0c4', 24);
        } else {
            boardInner =
                '<div class="gs-ctl">'
                +   '<button class="gs-btn gs-btn-soft" onclick="window._goCoquettish(this)"><i class="fas fa-heart-broken"></i> 撒娇</button>'
                +   '<button class="gs-btn gs-btn-start" onclick="window._goStart(this)">开始</button>'
                + '</div>'
                + '<div class="gn-range">范围 <b id="gn-range">' + state.gnLo + ' ~ ' + state.gnHi + '</b>　·　已猜 <b id="gn-count">' + (state.guessCount || 0) + '</b> 次</div>'
                + sakuraLayer('#fbf0c4', 30)
                + '<div class="gn-pad">'
                +   '<div class="gn-big" id="gn-big">' + (state.sessionOver ? '🎉' : '🎯') + '</div>'
                +   '<div class="gn-fb" id="gn-fb">' + esc(fb) + '</div>'
                +   '<div class="gn-input-row" id="gn-input-row" style="display:' + (inputRow ? 'flex' : 'none') + '">'
                +     '<input class="gn-input" id="gn-input" type="number" min="0" max="' + state.n + '" placeholder="输入你的猜测" autocomplete="off" />'
                +     '<button class="gn-submit" onclick="window._gnGuess()">猜</button>'
                +   '</div>'
                + '</div>'
                + heartsHTML(dream, esc(you))
                + resultHTML();
        }
        panel.innerHTML =
            '<div class="gs-screen">'
            + '<div class="gs-topbar">'
            +   '<button class="gs-ibtn" onclick="window._goBack()"><i class="fas fa-chevron-left"></i></button>'
            +   '<span class="gs-title">' + esc(m.name) + '</span>'
            +   '<div class="gs-seg">'
            +     '<button data-v="board" class="on" onclick="window._goSwitchView(\'board\',this)">游戏</button>'
            +     '<button data-v="hist" onclick="window._goSwitchView(\'hist\',this)">历史</button>'
            +   '</div>'
            + '</div>'
            + '<div class="gs-body">'
            +   '<div class="gs-board-col' + (diffStage ? ' gn-diffstage-col' : '') + '">' + boardInner + '</div>'
            +   histPanelHTML()
            + '</div>'
            + '</div>';
        var scr = panel.querySelector('.gs-screen');
        if (scr) applyPalette(scr, state.game);
        // 难易选择(毛玻璃胶囊)：点击后进入猜数字界面
        var caps = panel.querySelectorAll('.gn-cap');
        for (var i = 0; i < caps.length; i++) {
            (function (b) {
                b.addEventListener('click', function () {
                    if (!state || state.game !== 'guessnum' || state.started || state.sessionOver) return;
                    state.gnDiff = b.getAttribute('data-d');
                    state.n = state.gnDiff === 'hard' ? 1000 : 100;
                    state.gnLo = 0; state.gnHi = state.n;
                    state.gnDiffPicked = true;
                    renderScreen();
                });
            })(caps[i]);
        }
        var inp = document.getElementById('gn-input');
        if (inp) inp.focus();
        if (!state.started && !state.sessionOver && !diffStage) setTimeout(function () { hint('点击「开始」开局'); }, 60);
    }
    function gnRefresh() {
        var fb = document.getElementById('gn-fb'), dream = partnerName();
        var rg = document.getElementById('gn-range'), ct = document.getElementById('gn-count');
        var row = document.getElementById('gn-input-row');
        if (rg) rg.textContent = state.gnLo + ' ~ ' + state.gnHi;
        if (ct) ct.textContent = state.guessCount || 0;
        if (row) row.style.display = (state.started && !state.sessionOver && state.turn === 'user') ? 'flex' : 'none';
        if (fb) {
            if (state.sessionOver) fb.textContent = (state.result && state.result.winner === 'user' ? myName() : dream) + ' 获胜，本局结束！';
            else if (state.turn === 'user') fb.textContent = '范围 ' + state.gnLo + ' ~ ' + state.gnHi + '，轮到' + esc(myName()) + '猜';
            else fb.textContent = dream + ' 正在猜…';
        }
        var inp = document.getElementById('gn-input');
        if (inp) { inp.value = ''; if (state.started && !state.sessionOver && state.turn === 'user') inp.focus(); }
    }
    function gnCheck(val) {
        if (typeof val !== 'number' || isNaN(val) || val < 0 || val > state.n) { notify('请输入 0~' + state.n + ' 之间的数字', 'info'); return false; }
        if (val < state.gnLo || val > state.gnHi) { notify('这个范围已经排除了哦，缩小一下试试', 'info'); return false; }
        return true;
    }
    global._gnGuess = function () {
        var inp = document.getElementById('gn-input');
        if (!inp) return;
        var val = parseInt(inp.value, 10);
        if (!state || state.game !== 'guessnum' || !state.started || state.sessionOver || state.over || state.turn !== 'user') return;
        if (!gnCheck(val)) return;
        gnUserGuess(val);
    };
    window.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || !state || state.game !== 'guessnum' || !state.started || state.sessionOver || state.over || state.turn !== 'user') return;
        e.preventDefault();
        var inp = document.getElementById('gn-input');
        if (inp) global._gnGuess();
    });
    function gnUserGuess(val) {
        state.guessCount++;
        var a = state.gnAnswer;
        if (val === a) { gnResult('user', val); return; }
        if (val < a) { state.gnLo = val + 1; notify(esc(myName()) + ' 猜了 ' + val + ' —— 太小啦', 'info'); }
        else { state.gnHi = val - 1; notify(esc(myName()) + ' 猜了 ' + val + ' —— 太大啦', 'info'); }
        if (state.gnLo > state.gnHi) state.gnLo = state.gnHi = val;
        state.turn = 'dream';
        gnRefresh();
        scheduleGnAI();
    }
    function scheduleGnAI() {
        clearAi();
        // 梦角响应时间随机 2s ~ 30s
        var delay = 2000 + Math.floor(Math.random() * 28000);
        aiTimer = setTimeout(function () {
            aiTimer = null;
            if (!state || state.game !== 'guessnum' || state.sessionOver || state.over || state.turn !== 'dream') return;
            var lo = state.gnLo, hi = state.gnHi;
            var g = lo + Math.floor(Math.random() * (hi - lo + 1)); // 已知范围内随机猜一数
            state.guessCount++;
            var a = state.gnAnswer;
            if (g === a) { gnResult('dream', g); return; }
            if (g < a) { state.gnLo = g + 1; notify(esc(partnerName()) + ' 猜了 ' + g + ' —— 太小啦', 'info'); }
            else { state.gnHi = g - 1; notify(esc(partnerName()) + ' 猜了 ' + g + ' —— 太大啦', 'info'); }
            if (state.gnLo > state.gnHi) state.gnLo = state.gnHi = g;
            state.turn = 'user';
            gnRefresh();
        }, delay);
    }
    function gnResult(winner, val) {
        state.over = true;
        var who = winner === 'user' ? myName() : partnerName();
        notify('🎯 ' + who + ' 猜中了 ' + val + '！', 'success');
        resolveHearts(winner === 'user');
        renderScreen();
    }

    // 一局(棋盘局)分出胜负：winnerWinner 为 'user'/'dream'（或 '' 表示和棋不生变）
    function afterRound(msg, userWon) {
        state.over = true;
        resolveHearts(userWon);
        renderScreen();
    }

    function resolveHearts(userWon) {
        if (userWon === undefined) { /* 保留占位 */ }
        var loser = userWon ? 'dream' : 'user';
        var arr = loser === 'dream' ? state.dreamHearts : state.userHearts;
        for (var i = 0; i < 3; i++) if (arr[i]) { arr[i] = false; break; }
        var whoLostAll = brokenCount(state.dreamHearts) === 3 ? 'dream' : (brokenCount(state.userHearts) === 3 ? 'user' : null);
        if (whoLostAll) {
            state.sessionOver = true;
            state.over = true;
            state.result = { winner: whoLostAll === 'dream' ? 'user' : 'dream', dBroken: brokenCount(state.dreamHearts), uBroken: brokenCount(state.userHearts) };
            recordGame(state.game, state.result);
            notify((state.result.winner === 'user' ? esc(myName()) : partnerName()) + ' 获胜，本局结束！', 'success');
        } else {
            if (userWon !== undefined) notify((userWon ? esc(myName()) : partnerName()) + ' 赢了这一局', 'info');
            // 非终局：自动开启下一轮，且上一轮输家先手（本局已碎一颗心）
            beginRound(userWon ? 'dream' : 'user');
        }
    }

    function recordGame(game, result) {
        var data = getRecords();
        data[game].push({ d: dateStr(), dBroken: result.dBroken, uBroken: result.uBroken, winner: result.winner });
        if (data[game].length > 60) data[game].shift();
        saveRecords(data);
    }

    // ── 图形渲染 ───────────────────────────
    function refresh() {
        renderBoard();
        var st = document.getElementById('gs-status');
        var hint = document.querySelector('#gs-board-wrap .gs-hint');
        if (st) {
            if (state.sessionOver) st.innerHTML = '';
            else if (!state.started) st.innerHTML = '点击「开始」开始游戏';
            else st.innerHTML = state.turn === 'user' ? '🙂 轮到' + esc(myName()) + '落子' : '🤖 ' + esc(partnerName()) + '回合';
        }
        if (hint) {
            if (state.started && !state.sessionOver) hint.textContent = state.turn === 'user' ? '轮到' + esc(myName()) + '落子' : esc(partnerName()) + '思考中…';
            else hint.style.display = 'none';
        }
    }
    function hint(t) {
        var h = document.querySelector('#gs-board-wrap .gs-hint');
        if (h) h.textContent = t;
    }
    function renderBoard() {
        var cv = document.getElementById('gs-board');
        if (!cv || !state) return;
        var ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, BOARD_PX, BOARD_PX);
        var n = state.n, cell = (BOARD_PX - 2 * MARGIN) / (n - 1);
        var pal = (state.pal) || PALETTES.gomoku;
        ctx.strokeStyle = pal.grid;
        ctx.lineWidth = 1;
        // 外框细线
        ctx.lineWidth = 1; ctx.strokeRect(MARGIN, MARGIN, (BOARD_PX - 2 * MARGIN), (BOARD_PX - 2 * MARGIN)); ctx.lineWidth = 1;
        for (var i = 0; i < n; i++) {
            var p = MARGIN + i * cell;
            ctx.beginPath(); ctx.moveTo(MARGIN, p); ctx.lineTo(BOARD_PX - MARGIN, p); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(p, MARGIN); ctx.lineTo(p, BOARD_PX - MARGIN); ctx.stroke();
        }
        // 星位
        if (state.game === 'go') {
            var stars = [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]];
            for (var s = 0; s < stars.length; s++) { drawDot(ctx, MARGIN + stars[s][0] * cell, MARGIN + stars[s][1] * cell, 3); }
        }
        // 棋子
        for (var r = 0; r < n; r++) {
            for (var c = 0; c < n; c++) {
                if (state.board[r][c]) drawStone(ctx, MARGIN + c * cell, MARGIN + r * cell, state.board[r][c], cell);
            }
        }
        // 最后一手（主题色圆点标记）
        if (state.lastMove) {
            var lr = MARGIN + state.lastMove.c * cell, lc = MARGIN + state.lastMove.r * cell;
            ctx.fillStyle = state.board[state.lastMove.r][state.lastMove.c] === USER ? '#ffffff' : pal.ac;
            ctx.beginPath(); ctx.arc(lr, lc, cell * 0.11, 0, 2 * Math.PI); ctx.fill();
        }
    }
    function drawDot(ctx, x, y, r) {
        ctx.fillStyle = (state && state.pal) ? state.pal.dot : 'rgba(122,134,182,.45)';
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
    }
    function drawStone(ctx, x, y, color, cell) {
        var r = cell * 0.42;
        var grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
        if (color === USER) { grad.addColorStop(0, '#7a7a80'); grad.addColorStop(1, '#2f2f35'); }
        else { grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#e6e6e4'); }
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = (state && state.pal) ? state.pal.stroke : 'rgba(120,130,170,.28)';
        ctx.lineWidth = 0.7; ctx.stroke();
    }

    // ── 棋局判定（通用）────────────────────
    function inb(r, c, n) { return r >= 0 && r < n && c >= 0 && c < n; }
    function checkWin(r, c, color) {
        var n = state.n, b = state.board;
        for (var d = 0; d < DIRS.length; d++) {
            var dr = DIRS[d][0], dc = DIRS[d][1], cnt = 1;
            for (var k = 1; k < 5; k++) { var rr = r + dr * k, cc = c + dc * k; if (inb(rr, cc, n) && b[rr][cc] === color) cnt++; else break; }
            for (var k2 = 1; k2 < 5; k2++) { var r2 = r - dr * k2, c2 = c - dc * k2; if (inb(r2, c2, n) && b[r2][c2] === color) cnt++; else break; }
            if (cnt >= 5) return true;
        }
        return false;
    }
    function boardFull() {
        var n = state.n;
        for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (!state.board[r][c]) return false;
        return true;
    }
    function emptyBoard(n) { var b = []; for (var i = 0; i < n; i++) b.push(new Array(n).fill(0)); return b; }
    function cloneBoard(b) { return b.map(function (row) { return row.slice(); }); }

    // ── 五子棋 AI（梦角=白 2）────────────
    function threatAt(r, c, color) {
        var n = state.n, b = state.board, best = 1;
        for (var d = 0; d < DIRS.length; d++) {
            var dr = DIRS[d][0], dc = DIRS[d][1], cnt = 1;
            for (var k = 1; k < 5; k++) { var rr = r + dr * k, cc = c + dc * k; if (inb(rr, cc, n) && b[rr][cc] === color) cnt++; else break; }
            for (var k2 = 1; k2 < 5; k2++) { var r2 = r - dr * k2, c2 = c - dc * k2; if (inb(r2, c2, n) && b[r2][c2] === color) cnt++; else break; }
            if (cnt > best) best = cnt;
        }
        return best;
    }
    function aiGomoku() {
        var n = state.n, center = (n - 1) / 2;
        var best = -1, bestV = -1e9, cand = [];
        for (var r = 0; r < n; r++) {
            for (var c = 0; c < n; c++) {
                if (state.board[r][c]) continue;
                var dream = threatAt(r, c, DREAM);  // 我方(梦角)在此落子的连子数
                var user  = threatAt(r, c, USER);   // 对方(玩家)在此落子的连子数
                // 若我方可在本手成五，直接落子致胜
                if (dream >= 5) { bestV = 1e12; best = cand.length; }
                var v = dream * 100 + user * 74;   // 攻守并重，稍偏防守
                if (user >= 4) v += 420;           // 必须堵住对方的活四/冲四
                if (dream >= 4) v += 680;          // 我方冲四/活四，制造必胜
                if (user >= 3) v += 120;           // 对方活三/冲三也尽早防备
                if (dream >= 3) v += 150;          // 我方成三多占一点，便于后续发展
                var dist = Math.abs(r - center) + Math.abs(c - center);
                v += (n - dist) * 0.5;
                v += Math.random() * 0.8;
                if (v > bestV) { bestV = v; best = cand.length; }
                cand.push({ v: v, r: r, c: c });
            }
        }
        var mv = cand[best];
        var nb = cloneBoard(state.board); nb[mv.r][mv.c] = DREAM;
        return { board: nb, r: mv.r, c: mv.c };
    }

    // ── 围棋引擎 ──────────────────────────
    var ADJ = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    function groupInfo(board, n, r, c) {
        var color = board[r][c];
        var seen = {}, libs = [], stones = [];
        var stack = [[r, c]]; seen[r + ',' + c] = 1;
        while (stack.length) {
            var cur = stack.pop();
            stones.push(cur);
            for (var d = 0; d < ADJ.length; d++) {
                var nr = cur[0] + ADJ[d][0], nc = cur[1] + ADJ[d][1];
                if (!inb(nr, nc, n)) continue;
                var v = board[nr][nc];
                if (v === 0) { if (libs.indexOf(nr + ',' + nc) < 0) libs.push(nr + ',' + nc); }
                else if (v === color && !seen[nr + ',' + nc]) { seen[nr + ',' + nc] = 1; stack.push([nr, nc]); }
            }
        }
        return { stones: stones, libs: libs.length };
    }
    function simulateMove(r, c, color) {
        var n = state.n, board = cloneBoard(state.board), pris = state.prisoners.slice();
        board[r][c] = color;
        var captured = false;
        for (var d = 0; d < ADJ.length; d++) {
            var nr = r + ADJ[d][0], nc = c + ADJ[d][1];
            if (!inb(nr, nc, n) || board[nr][nc] === 0 || board[nr][nc] === color) continue;
            var opp = board[nr][nc];
            var gi = groupInfo(board, n, nr, nc);
            if (gi.libs === 0) {
                for (var i = 0; i < gi.stones.length; i++) { board[gi.stones[i][0]][gi.stones[i][1]] = 0; }
                pris[opp === USER ? 0 : 1]++;
                captured = true;
            }
        }
        var own = groupInfo(board, n, r, c);
        if (own.libs === 0 && !captured) return null; // 自杀，非法
        // 简单劫：禁止立即还原上一局面
        if (state.koHist.length >= 2) {
            var key = boardKey(board);
            if (key === state.koHist[state.koHist.length - 2]) return null;
        }
        return { board: board, prisoners: pris };
    }
    function boardKey(board) { return JSON.stringify(board); }
    function aiGo() {
        var n = state.n, center = (n - 1) / 2, legal = [];
        var prePris = state.prisoners[1];
        for (var r = 0; r < n; r++) {
            for (var c = 0; c < n; c++) {
                if (state.board[r][c]) continue;
                var sim = simulateMove(r, c, DREAM);
                if (!sim) continue;
                var score = 0;
                if (sim.prisoners[1] > prePris) score += 140; // 吃子（大优）
                // 接子/靠子：贴近己方利于扩张，逼近对方便于攻击
                var ownN = 0, oppN = 0;
                for (var d = 0; d < ADJ.length; d++) {
                    var dr = ADJ[d][0], dc = ADJ[d][1], nr = r + dr, nc = c + dc;
                    if (!inb(nr, nc, n)) continue;
                    var v = state.board[nr][nc];
                    if (v === DREAM) ownN++; else if (v === USER) oppN++;
                }
                score += ownN * 26 + oppN * 18;
                // 落点自身气数：气少易被吃的先手劣后，避开自杀式落子
                var own = groupInfo(sim.board, n, r, c);
                if (own.libs === 1 && !(sim.prisoners[1] > prePris)) score -= 40;
                else if (own.libs >= 3) score += 8;
                // 靠近中心，抢占开阔地
                score += (n - (Math.abs(r - center) + Math.abs(c - center))) * 1.2;
                score += Math.random() * 2;
                legal.push({ sim: sim, r: r, c: c, s: score });
            }
        }
        if (!legal.length) return 'pass';
        legal.sort(function (a, b) { return b.s - a.s; });
        return { board: legal[0].sim.board, prisoners: legal[0].sim.prisoners, r: legal[0].r, c: legal[0].c };
    }
    function scoreGo() {
        state.over = true;
        var n = state.n, b = state.board;
        var black = 0, white = 0;
        // 领地：对每个空格做 flood，得到连通区域，统计仅被单色包围
        var seen = {};
        for (var r = 0; r < n; r++) {
            for (var c = 0; c < n; c++) {
                if (b[r][c] || seen[r + ',' + c]) continue;
                var region = [], open = [[r, c]], borders = { 0: 0, 1: 0, 2: 0 };
                seen[r + ',' + c] = 1;
                while (open.length) {
                    var cur = open.pop(); region.push(cur);
                    for (var d = 0; d < ADJ.length; d++) {
                        var nr = cur[0] + ADJ[d][0], nc = cur[1] + ADJ[d][1];
                        if (!inb(nr, nc, n)) { borders[0] = 1; continue; }
                        var v = b[nr][nc];
                        if (v === 0 && !seen[nr + ',' + nc]) { seen[nr + ',' + nc] = 1; open.push([nr, nc]); }
                        else if (v !== 0) borders[v] = 1;
                    }
                }
                var owner = borders[1] && !borders[2] ? 1 : (borders[2] && !borders[1] ? 2 : 0);
                if (owner) { if (owner === 1) black += region.length; else white += region.length; }
            }
        }
        // 子数
        for (var rr = 0; rr < n; rr++) for (var cc = 0; cc < n; cc++) { if (b[rr][cc] === 1) black++; else if (b[rr][cc] === 2) white++; }
        // 提子算到对方地盘：黑被提(prisoners[0])计入白方，白被提(prisoners[1])计入黑方
        black += state.prisoners[1]; white += state.prisoners[0];
        // 中国规则数子法：黑贴 3.75 子。全盘 n*n 点，过半= n*n/2，黑骨需 > n*n/2 + 3.75 方胜。
        var komi = 3.75;
        var total = n * n;
        var blackWon = black > total / 2 + komi;
        var userWon = blackWon;
        notify('围棋结算：' + myName() + '(黑) ' + black + ' : ' + white + ' ' + partnerName() + '（黑贴 ' + komi + ' 子）', 'info');
        resolveHearts(userWon);
        renderScreen();
    }
})(window);