/**
 * 游戏室（娱乐板块）主界面
 * 四宫格：五子棋 / 2048 / 围棋 / 猜数字对决
 * 目前仅构建主界面与 pill 切换接入；各游戏功能等待依次接入。
 */
(function (global) {
    'use strict';

    var PANEL_ID = 'cs-panel-game';
    var PILL_BASE = 'ent-pill-game';
    var RENDERED_KEY = '__gr_rendered';

    // 游戏定义：id / 名称 / 描述 / 图标
    var GAMES = [
        { id: 'gomoku', name: '五子棋', desc: '双人轮流 · 五子连珠', icon: '⚫️' },
        { id: '2048',    name: '2048',   desc: '双人轮流 · 合并数字', icon: '🔢' },
        { id: 'go',      name: '围棋',   desc: '双人轮流 · 围地争胜', icon: '⚪️' },
        { id: 'guessnum', name: '猜数字对决', desc: '双人回合 · 快猜制胜', icon: '🎯' }
    ];

    // 注入一次性样式
    function ensureStyle() {
        if (document.getElementById('gr-style')) return;
        var el = document.createElement('style');
        el.id = 'gr-style';
        el.textContent = [
            '.gr-wrap{height:100%;padding:14px 4px 24px;box-sizing:border-box;overflow-y:auto;-webkit-overflow-scrolling:touch;}',
            '.gr-sub{text-align:center;font-size:12px;color:var(--text-secondary);margin-bottom:16px;letter-spacing:.5px;}',
            '.gr-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}',
            '.gr-card{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:26px 10px;border-radius:20px;background:linear-gradient(165deg,var(--secondary-bg),rgba(var(--accent-color-rgb),.08));border:1px solid var(--border-color);box-shadow:0 4px 16px rgba(0,0,0,.05);transition:transform .15s,box-shadow .15s;cursor:pointer;}',
            '.gr-card:active{transform:scale(.96);box-shadow:0 2px 8px rgba(0,0,0,.08);}',
            '.gr-icon{width:54px;height:54px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:27px;line-height:1;background:linear-gradient(140deg,var(--accent-color),rgba(var(--accent-color-rgb),.68));color:#fff;box-shadow:0 5px 14px rgba(var(--accent-color-rgb),.3);}',
            '.gr-name{font-size:15px;font-weight:700;color:var(--text-primary);}',
            '.gr-desc{font-size:11px;color:var(--text-secondary);}'
        ].join('\n');
        document.head.appendChild(el);
    }

    function renderGrid() {
        ensureStyle();
        var panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        var cards = GAMES.map(function (g) {
            var label = g.name.replace(/"/g, '&quot;');
            return '<button class="gr-card" onclick="window._grLaunch(\'' + g.id + '\')">'
                + '<span class="gr-icon">' + g.icon + '</span>'
                + '<span class="gr-name">' + label + '</span>'
                + '<span class="gr-desc">' + g.desc + '</span>'
                + '</button>';
        }).join('');
        panel.innerHTML =
            '<div class="gr-wrap">'
            + '<div class="gr-sub">双人小游戏 · 选择一项开始</div>'
            + '<div class="gr-grid">' + cards + '</div>'
            + '</div>';
    }

    // 游戏入口：五子棋/围棋已接入，其余等待后续
    global._grLaunch = function (id) {
        if (id === 'gomoku' || id === 'go' || id === '2048' || id === 'guessnum') {
            if (typeof global._goOpen === 'function') { global._goOpen(id); return; }
        }
        var g = GAMES.filter(function (x) { return x.id === id; })[0];
        var name = g ? g.name : '该游戏';
        if (typeof global.showNotification === 'function') {
            global.showNotification('「' + name + '」即将上线，敬请期待', 'info');
        }
    };
    // 供游戏模块返回棋室时重新渲染四宫格
    global._gameRoomRender = renderGrid;

    // pill / 面板 状态统一
    function grSetPills(which) {
        ['cinema', 'log', 'music', 'game'].forEach(function (p) {
            var el = document.getElementById('ent-pill-' + p);
            if (el) el.classList.toggle('cs-pill-on', p === which);
        });
        var cin = document.getElementById('cs-panel-cinema');
        if (cin) cin.classList.toggle('cs-panel-active', which === 'cinema');
        var mh = document.getElementById('cs-panel-musichall');
        if (mh) mh.classList.toggle('cs-panel-active', which === 'music');
        var gm = document.getElementById(PANEL_ID);
        if (gm) gm.classList.toggle('cs-panel-active', which === 'game');
    }

    // 包裹原有 _entSwitchPill（cinema → musichall → 本模块），保持链式一致
    var _grOrigSwitch = global._entSwitchPill;
    global._entSwitchPill = function (which) {
        if (which === 'game') {
            if (typeof global._cinemaCloseArchive === 'function') global._cinemaCloseArchive();
            if (typeof global._mhClosePlaylistPage === 'function') global._mhClosePlaylistPage();
            grSetPills('game');
            renderGrid();
        } else {
            if (_grOrigSwitch) _grOrigSwitch(which);
            grSetPills(which);
        }
    };

    // 归档/歌单关闭时若当前是游戏室，保持高亮（默认无特殊处理即可）
    var _grOrigCloseArchive = global._cinemaCloseArchive;
    global._cinemaCloseArchive = function () {
        if (_grOrigCloseArchive) _grOrigCloseArchive();
        grSetPills('cinema');
    };

    // 预填充一次，保证从其它入口直接进娱乐时无需再等
    renderGrid();
})(window);