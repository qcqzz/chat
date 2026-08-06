if (typeof customReplyGroups === 'undefined') window.customReplyGroups = [];
if (typeof replyGroupsEnabled === 'undefined') window.replyGroupsEnabled = false;
if (typeof customPokeGroups === 'undefined') window.customPokeGroups = [];
if (typeof customStatusGroups === 'undefined') window.customStatusGroups = [];

// 根据当前 tab 返回对应的分组上下文 {groups, items, itemLabel}
function _getGroupCtx(tab) {
    tab = tab || currentSubTab;
    if (tab === 'pokes') {
        if (!window.customPokeGroups) window.customPokeGroups = [];
        return { groups: window.customPokeGroups, items: customPokes, itemLabel: '拍一拍' };
    }
    if (tab === 'statuses') {
        if (!window.customStatusGroups) window.customStatusGroups = [];
        return { groups: window.customStatusGroups, items: customStatuses, itemLabel: '状态' };
    }
    // default: custom replies
    if (!window.customReplyGroups) window.customReplyGroups = [];
    return { groups: window.customReplyGroups, items: customReplies, itemLabel: '字卡' };
}

// 判断当前 tab 是否支持分组
function _tabHasGroups(tab) {
    tab = tab || currentSubTab;
    return tab === 'custom' || tab === 'pokes' || tab === 'statuses';
}

let _batchSelectedIndices = new Set();
let _batchModeActive = false;
let _batchModeTarget = 'custom'; // 'custom' or 'stickers' (depends on currentSubTab when batch mode enabled)
let _searchVisible = false;
let _searchQuery = '';
let _searchDebounceTimer = null;
let _activeGroupFilter = null; 

const GROUP_COLORS = [
    '#FF6B6B','#FF8E53','#FFC542','#51CF66',
    '#20C997','#4DABF7','#748FFC','#DA77F2',
    '#F783AC','#FF922B','#A9E34B','#38D9A9',
    '#339AF0','#5C7CFA','#CC5DE8','#F06595',
    '#868E96','#212529'
];

const ICONS = {
    reply:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H9l-3 2.5V11H3a1 1 0 01-1-1V3z" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>`,
    magic:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2l.9 2.7L11.6 4l-1.8 2.2L12 8l-2.9-.1L8 10.8l-.9-2.9L4.4 8l1.8-2.2L4.4 4l2.7.7L8 2z" stroke="currentColor" stroke-width="1.2" fill="none"/><line x1="2" y1="14" x2="5" y2="11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    news:     `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.3"/><line x1="5" y1="6" x2="11" y2="6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5" y1="9" x2="9" y2="9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
    folder:   `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 5a1 1 0 011-1h3.5l1.2 1.2H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V5z" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>`,
    search:   `<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.3"/><line x1="9.5" y1="9.5" x2="13" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
    batch:    `<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="8.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2" opacity=".6"/><rect x="1.5" y="8.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2" opacity=".6"/><rect x="8.5" y="8.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2" opacity=".4"/></svg>`,
    plus:     `<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><line x1="7.5" y1="2" x2="7.5" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="2" y1="7.5" x2="13" y2="7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    close:    `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    check:    `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    trash:    `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><line x1="2" y1="3" x2="11" y2="3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M4.5 3V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V3"/><path d="M3.5 3.5l.5 7h5l.5-7" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>`,
    edit:     `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M8.5 2l2.5 2.5L4 11.5H1.5V9L8.5 2z" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>`,
    eye:      `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1.5 6.5s2-4 5-4 5 4 5 4-2 4-5 4-5-4-5-4z" stroke="currentColor" stroke-width="1.2"/><circle cx="6.5" cy="6.5" r="1.5" fill="currentColor"/></svg>`,
    eyeOff:   `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><line x1="2" y1="2" x2="11" y2="11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M4.5 3.5C5.1 3.2 5.7 3 6.5 3c3 0 5 3.5 5 3.5s-.5 1-1.5 2M2 5s-.5.8-.5 1.5c0 .6.2 1.1.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
    tag:      `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1.5 1.5h5l5 5-5 5-5-5v-5z" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="4" cy="4" r="1" fill="currentColor"/></svg>`,
    filter:   `<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><line x1="2" y1="4" x2="13" y2="4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="4" y1="7.5" x2="11" y2="7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="6" y1="11" x2="9" y2="11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    dedup:    `<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 4h11M4.5 7h6M7 10h1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    import:   `<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 9.5V2M4 6.5l3.5 3L11 6.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><line x1="2" y1="12.5" x2="13" y2="12.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    export:   `<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 5V12M4 7.5l3.5-3L11 7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><line x1="2" y1="2.5" x2="13" y2="2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    chevronD: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
    chevronR: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
    comment:  `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 3.5A1.5 1.5 0 013.5 2h11A1.5 1.5 0 0116 3.5v8A1.5 1.5 0 0114.5 13H10l-3 3v-3H3.5A1.5 1.5 0 012 11.5v-8z" stroke="currentColor" stroke-width="1.3"/></svg>`,
    hand:     `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2v8M6 5v5M3 8v3a6 6 0 0012 0V6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    dot:      `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="3" fill="currentColor"/><circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.3"/></svg>`,
    quote:    `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 6.5C3 5.4 3.9 4.5 5 4.5h2v5H5A2 2 0 013 7.5V6.5zM10 6.5c0-1.1.9-2 2-2h2v5h-2a2 2 0 01-2-2V6.5z" fill="currentColor" opacity=".7"/></svg>`,
    play:     `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.3"/><path d="M7 6.5l5 2.5-5 2.5V6.5z" fill="currentColor"/></svg>`,
    smile:    `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.3"/><circle cx="6.5" cy="7.5" r="1" fill="currentColor"/><circle cx="11.5" cy="7.5" r="1" fill="currentColor"/><path d="M6 11.5s1 2 3 2 3-2 3-2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
    sticker:  `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="14" height="14" rx="4" stroke="currentColor" stroke-width="1.3"/><circle cx="6.5" cy="7" r="1.2" fill="currentColor"/><circle cx="11.5" cy="7" r="1.2" fill="currentColor"/><path d="M6 11s1 2.5 3 2.5S12 11 12 11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
    folderBig:`<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 5a1 1 0 011-1h4l1.5 1.5H15a1 1 0 011 1V14a1 1 0 01-1 1H3a1 1 0 01-1-1V5z" stroke="currentColor" stroke-width="1.3"/></svg>`,
    palette:  `<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 1.5a6 6 0 100 12 2.5 2.5 0 010-5 2.5 2.5 0 000-7z" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="7.5" cy="3.5" r="1" fill="currentColor"/><circle cx="11" cy="6" r="1" fill="currentColor"/></svg>`,
};


// ─── 共享样式：只注入一次，避免每张卡片各塞一个 <style> ───────────────────
(function _injectReplyLibStyles() {
    if (document.getElementById('rl-shared-styles')) return;
    const s = document.createElement('style');
    s.id = 'rl-shared-styles';
    s.textContent = `
        .rl-card {
            display:flex;align-items:flex-start;gap:0;padding:11px 13px;
            border-radius:12px;border:1.5px solid var(--border-color);
            background:var(--secondary-bg);margin-bottom:7px;
            transition:all 0.18s;position:relative;overflow:hidden;
        }
        .rl-card:hover { border-color:var(--accent-color);transform:translateY(-1px);box-shadow:0 3px 12px rgba(0,0,0,0.08); }
        .rl-card.rl-selected { border-color:var(--accent-color);background:rgba(var(--accent-color-rgb,180,140,100),0.08); }
        .rl-card-actions {
            display:flex;gap:3px;margin-left:auto;flex-shrink:0;padding-left:8px;
            opacity:0;transition:opacity 0.18s;align-items:center;
        }
        .rl-card:hover .rl-card-actions { opacity:1; }
        @media (hover:none) { .rl-card-actions { opacity:1; } }
        .rl-act-btn {
            width:28px;height:28px;border-radius:8px;border:none;
            background:transparent;color:var(--text-secondary);cursor:pointer;
            display:flex;align-items:center;justify-content:center;transition:all 0.15s;
            flex-shrink:0;
        }
        .rl-act-btn:hover { border-color:var(--accent-color);color:var(--accent-color); }
        .rl-act-btn.danger:hover { border-color:#ef4444;color:#ef4444; }
        .rl-act-btn.active { background:var(--accent-color);border-color:var(--accent-color);color:#fff; }
        .rl-group-block { margin-bottom:12px; }
        .rl-group-header {
            display:flex;align-items:center;gap:9px;padding:9px 14px;
            border-radius:12px 12px 0 0;
            background:var(--secondary-bg);cursor:pointer;user-select:none;
            transition:background 0.2s;
        }
        .rl-group-header.collapsed { border-radius:12px; }
        .rl-group-header:hover { background:rgba(var(--accent-color-rgb,180,140,100),0.06); }
        .rl-group-body { border:1px solid var(--border-color);border-top:none;border-radius:0 0 12px 12px;padding:6px 8px 8px;background:var(--primary-bg); }
        .rl-group-tag {
            display:inline-flex;align-items:center;gap:5px;
            padding:2px 9px 2px 6px;border-radius:20px;
            cursor:pointer;transition:all 0.15s;
        }
        .rl-batch-check {
            width:18px;height:18px;border-radius:5px;flex-shrink:0;margin-top:1px;
            display:flex;align-items:center;justify-content:center;transition:all 0.15s;
        }
    `;
    (document.head || document.documentElement).appendChild(s);
})();

function _renderListContentOnly() {
    const list = document.getElementById('custom-replies-list');
    if (!list) return;

    const toolbar = document.getElementById('batch-ops-toolbar');
    Array.from(list.children).forEach(child => {
        if (child !== toolbar) child.remove();
    });

    let itemsToRender = [];
    let renderType = 'text';

    if (currentMajorTab === 'reply') {
        if (currentSubTab === 'custom') {
            itemsToRender = customReplies;
        } else if (currentSubTab === 'emojis') {
            itemsToRender = CONSTANTS.REPLY_EMOJIS;
            renderType = 'emoji';
        } else if (currentSubTab === 'stickers') {
            itemsToRender = stickerLibrary;
            renderType = 'image';
        }
    } else if (currentMajorTab === 'atmosphere') {
        if (currentSubTab === 'pokes') itemsToRender = customPokes;
        else if (currentSubTab === 'statuses') itemsToRender = customStatuses;
        else if (currentSubTab === 'mottos') itemsToRender = customMottos;
        else if (currentSubTab === 'intros') itemsToRender = customIntros;
    }

    if (renderType === 'emoji') { _renderEmojiTab(list, itemsToRender); return; }
    if (renderType === 'image') { _renderStickerTab(list, itemsToRender); return; }

    const q = _searchQuery.toLowerCase().trim();
    const filtered = q ? itemsToRender.filter(item => item.toLowerCase().includes(q)) : itemsToRender;

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.innerHTML = renderEmptyState(q ? `未找到 "${q}"` : '列表空空如也');
        list.appendChild(empty.firstElementChild || empty);
        return;
    }

    if (currentMajorTab === 'reply' && currentSubTab === 'custom') {
        _renderCardViewWithGroups(list, filtered);
    } else {
        _renderAtmosphereList(list, filtered);
    }
}

let _rlRafId = null;
/** 防抖版 renderReplyLibrary：同一帧内多次调用只渲染一次 */
function renderReplyLibraryRaf() {
    if (_rlRafId) return;
    _rlRafId = requestAnimationFrame(() => {
        _rlRafId = null;
        renderReplyLibrary();
    });
}

function renderReplyLibrary() {
    if (currentMajorTab === 'announcement') return;
    const list = document.getElementById('custom-replies-list');
    const titleEl = document.getElementById('cr-modal-title');
    if (!list) return;

    const currentConfig = LIBRARY_CONFIG[currentMajorTab];
    if (titleEl) titleEl.textContent = currentConfig.title;

    const subTabsContainer = document.getElementById('cr-sub-tabs');
    if (subTabsContainer) {
        subTabsContainer.innerHTML = currentConfig.tabs.map(tab => `
            <button class="reply-tab-btn ${currentSubTab === tab.id ? 'active' : ''}"
                    data-id="${tab.id}" data-mode="${tab.mode}">
                ${tab.name}
            </button>
        `).join('');
        subTabsContainer.querySelectorAll('.reply-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                currentSubTab = btn.dataset.id;
                _batchModeActive = false;
                _batchSelectedIndices.clear();
                _activeGroupFilter = null;
                _searchVisible = false;
                _searchQuery = '';
                renderReplyLibrary();
            });
        });
    }

    list.innerHTML = '';
    list.className = 'content-list-area';

    const activeTabConfig = currentConfig.tabs.find(t => t.id === currentSubTab);
    if (activeTabConfig) list.classList.add(activeTabConfig.mode + '-mode');

    _renderModernToolbar();

    let itemsToRender = [];
    let renderType = 'text';

    if (currentMajorTab === 'reply') {
        if (currentSubTab === 'custom') {
            itemsToRender = customReplies;
        } else if (currentSubTab === 'emojis') {
            itemsToRender = CONSTANTS.REPLY_EMOJIS;
            renderType = 'emoji';
        } else if (currentSubTab === 'stickers') {
            itemsToRender = stickerLibrary;
            renderType = 'image';
        }
    } else if (currentMajorTab === 'atmosphere') {
        if (currentSubTab === 'pokes') itemsToRender = customPokes;
        else if (currentSubTab === 'statuses') itemsToRender = customStatuses;
        else if (currentSubTab === 'mottos') itemsToRender = customMottos;
        else if (currentSubTab === 'intros') itemsToRender = customIntros;
    }

    if (renderType === 'emoji') { _renderEmojiTab(list, itemsToRender); return; }
    if (renderType === 'image') { _renderStickerTab(list, itemsToRender); return; }

    const q = _searchQuery.toLowerCase().trim();
    let filtered = q ? itemsToRender.filter(item => item.toLowerCase().includes(q)) : itemsToRender;

    if (filtered.length === 0) {
        list.innerHTML = renderEmptyState(q ? `未找到"${q}"` : '列表空空如也');
        return;
    }

    if (_tabHasGroups()) {
        _renderCardViewWithGroups(list, filtered);
    } else {
        _renderAtmosphereList(list, filtered);
    }
}

function _renderModernToolbar() {
    let toolbar = document.getElementById('batch-ops-toolbar');
    const isMainCustom = currentMajorTab === 'reply' && currentSubTab === 'custom';
    const isStickersTab = currentMajorTab === 'reply' && currentSubTab === 'stickers';
    const hasGroupSupport = _tabHasGroups();
    const canBatch = isMainCustom || isStickersTab;

    if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.id = 'batch-ops-toolbar';
        const listEl = document.getElementById('custom-replies-list');
        listEl.parentNode.insertBefore(toolbar, listEl);
    }
    toolbar.style.display = '';

    const disabledSet = _getDisabledItemsSet();
    const ctx = _getGroupCtx();
    const totalItems = isMainCustom ? customReplies.length : (isStickersTab ? stickerLibrary.length : 0);
    const selectedCount = _batchSelectedIndices.size;

    const addBtnLabel = (() => {
        if (!isMainCustom) return '新增';
        return '新增字卡';
    })();

    let groupFilterHtml = '';
    if (hasGroupSupport && ctx.groups && ctx.groups.length > 0) {
        const allCount = ctx.items.length;
        const ungroupedCount = ctx.items.filter(item =>
            !ctx.groups.some(g => g.items && g.items.includes(item))
        ).length;
        groupFilterHtml = `
            <div id="group-filter-pills" style="
                display:flex;gap:6px;overflow-x:auto;padding:8px 15px 0;
                scrollbar-width:none;-webkit-overflow-scrolling:touch;flex-shrink:0;
            ">
                <button class="gfp-btn ${_activeGroupFilter === null ? 'gfp-active' : ''}" data-filter="all">
                    全部 <span class="gfp-count">${allCount}</span>
                </button>
                <button class="gfp-btn ${_activeGroupFilter === 'ungrouped' ? 'gfp-active' : ''}" data-filter="ungrouped">
                    未分组 <span class="gfp-count">${ungroupedCount}</span>
                </button>
                ${ctx.groups.map(g => {
                    const cnt = (g.items || []).filter(item => ctx.items.includes(item)).length;
                    return `<button class="gfp-btn ${_activeGroupFilter === g.id ? 'gfp-active' : ''} ${g.disabled ? 'gfp-disabled' : ''}"
                        data-filter="${g.id}"
                        style="${_activeGroupFilter === g.id ? `background:${g.color}22;border-color:${g.color};color:${g.color};` : ''}">
                        <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${g.color || '#aaa'};margin-right:4px;flex-shrink:0;vertical-align:middle;"></span>
                        ${g.name} <span class="gfp-count">${cnt}</span>
                        ${g.disabled ? `<span style="font-size:9px;opacity:0.7;margin-left:2px;">${ICONS.eyeOff}</span>` : ''}
                    </button>`;
                }).join('')}
            </div>
        `;
    }

    let batchActionsHtml = '';
    if (_batchModeActive) {
        const showGroupBtn = hasGroupSupport;
        batchActionsHtml = `
            <div id="batch-action-bar" style="
                display:flex;align-items:center;gap:6px;padding:8px 15px;
                background:rgba(var(--accent-color-rgb,180,140,100),0.06);
                border-bottom:1px solid rgba(var(--accent-color-rgb,180,140,100),0.15);
                flex-wrap:wrap;
            ">
                <button id="batch-select-all-btn" style="
                    padding:5px 12px;border-radius:20px;border:1.5px solid var(--accent-color);
                    background:transparent;color:var(--accent-color);font-size:12px;
                    cursor:pointer;font-family:var(--font-family);font-weight:600;
                    display:flex;align-items:center;gap:5px;
                ">
                    ${ICONS.check}
                    ${selectedCount === totalItems ? '取消全选' : `全选 (${totalItems})`}
                </button>
                <span style="font-size:12px;color:var(--text-secondary);flex:1;min-width:60px;">
                    ${selectedCount > 0 ? `已选 <strong style="color:var(--text-primary);">${selectedCount}</strong> 条` : '点击字卡以选择'}
                </span>
                ${showGroupBtn ? `
                    <button id="batch-group-btn" class="batch-act-pill ${selectedCount === 0 ? 'batch-act-disabled' : ''}" data-tip="分配分组">
                        ${ICONS.tag} 分组
                    </button>
                ` : ''}
                <button id="batch-disable-btn" class="batch-act-pill ${selectedCount === 0 ? 'batch-act-disabled' : ''}" data-tip="屏蔽/启用">
                    ${ICONS.eyeOff} 屏蔽
                </button>
                <button id="batch-delete-btn" class="batch-act-pill batch-act-danger ${selectedCount === 0 ? 'batch-act-disabled' : ''}" data-tip="删除">
                    ${ICONS.trash} 删除
                </button>
            </div>
        `;
    }

    toolbar.innerHTML = `
        <style>
            .gfp-btn {
                display:inline-flex;align-items:center;white-space:nowrap;
                padding:5px 12px;border-radius:20px;border:1.5px solid var(--border-color);
                background:var(--primary-bg);color:var(--text-secondary);
                font-size:12px;cursor:pointer;font-family:var(--font-family);
                transition:all 0.18s;flex-shrink:0;gap:2px;
            }
            .gfp-btn:hover { border-color:var(--accent-color);color:var(--accent-color); }
            .gfp-btn.gfp-active { background:var(--accent-color);border-color:var(--accent-color);color:#fff; }
            .gfp-btn.gfp-disabled { opacity:0.55; }
            .gfp-count { font-size:10px;opacity:0.7;margin-left:2px; }
            .toolbar-icon-btn {
                width:34px;height:34px;border-radius:10px;border:1.5px solid var(--border-color);
                background:var(--primary-bg);color:var(--text-secondary);cursor:pointer;
                display:flex;align-items:center;justify-content:center;transition:all 0.18s;
                flex-shrink:0;
            }
            .toolbar-icon-btn:hover { border-color:var(--accent-color);color:var(--accent-color); }
            .toolbar-icon-btn.active { background:var(--accent-color);border-color:var(--accent-color);color:#fff; }
            .batch-act-pill {
                display:inline-flex;align-items:center;gap:4px;
                padding:5px 11px;border-radius:20px;border:1.5px solid var(--border-color);
                background:var(--primary-bg);color:var(--text-primary);
                font-size:12px;cursor:pointer;font-family:var(--font-family);transition:all 0.18s;
            }
            .batch-act-pill:hover { border-color:var(--accent-color);color:var(--accent-color); }
            .batch-act-danger { border-color:rgba(239,68,68,.3);color:#ef4444; }
            .batch-act-danger:hover { background:rgba(239,68,68,.08); }
            .batch-act-disabled { opacity:0.4;pointer-events:none; }
            .search-input-line {
                display:flex;align-items:center;gap:8px;padding:8px 15px;
                border-bottom:1px solid var(--border-color);animation:slideDown 0.18s ease;
            }
            @keyframes slideDown { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:none} }
            .search-input-line input {
                flex:1;padding:7px 12px;border:1.5px solid var(--border-color);
                border-radius:10px;background:var(--secondary-bg);color:var(--text-primary);
                font-size:13px;font-family:var(--font-family);outline:none;transition:border 0.18s;
            }
            .search-input-line input:focus { border-color:var(--accent-color); }
            .group-filter-pills::-webkit-scrollbar { display:none; }
        </style>

        <div style="display:flex;align-items:center;gap:8px;padding:10px 15px;border-bottom:1px solid var(--border-color);">
            <button class="toolbar-icon-btn ${_searchVisible ? 'active' : ''}" id="tb-search-btn" title="搜索">
                ${ICONS.search}
            </button>
            ${hasGroupSupport ? `
            <button class="toolbar-icon-btn" id="tb-groups-btn" title="分组管理">
                ${ICONS.folder}
            </button>` : ''}
            <button class="toolbar-icon-btn" id="tb-dedup-btn" title="一键去重">
                ${ICONS.dedup}
            </button>
            <div style="flex:1;"></div>
            ${canBatch ? `
            <button class="toolbar-icon-btn ${_batchModeActive ? 'active' : ''}" id="tb-batch-btn" title="${_batchModeActive ? '退出批量' : '批量管理'}">
                ${ICONS.batch}
            </button>` : ''}
            <button class="toolbar-icon-btn" id="tb-import-btn" title="导入">
                ${ICONS.import}
            </button>
            <button class="toolbar-icon-btn" id="tb-export-btn" title="导出">
                ${ICONS.export}
            </button>
        </div>

        ${_searchVisible ? `
        <div class="search-input-line">
            <div style="color:var(--text-secondary);">${ICONS.search}</div>
            <input type="text" id="rl-search-input" value="${_searchQuery}" placeholder="搜索内容…" autocomplete="off">
            <button class="toolbar-icon-btn" id="tb-search-clear" title="清除" style="width:28px;height:28px;">
                ${ICONS.close}
            </button>
        </div>` : ''}

        ${groupFilterHtml}

        ${batchActionsHtml}
    `;

    toolbar.querySelector('#tb-search-btn').onclick = () => {
        _searchVisible = !_searchVisible;
        if (!_searchVisible) _searchQuery = '';
        renderReplyLibrary();
        if (_searchVisible) setTimeout(() => document.getElementById('rl-search-input')?.focus(), 50);
    };
    if (_searchVisible) {
        const si = toolbar.querySelector('#rl-search-input');
        if (si) {
            si.oninput = (e) => {
                const val = e.target.value;
                clearTimeout(_searchDebounceTimer);
                _searchDebounceTimer = setTimeout(() => {
                    _searchQuery = val;
                    _renderListContentOnly();
                }, 300);
            };
            si.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(_searchDebounceTimer);
                    _searchQuery = e.target.value;
                    _renderListContentOnly();
                } else if (e.key === 'Escape') {
                    clearTimeout(_searchDebounceTimer);
                    _searchVisible = false;
                    _searchQuery = '';
                    renderReplyLibrary();
                }
            };
        }
        toolbar.querySelector('#tb-search-clear').onclick = () => { _searchVisible = false; _searchQuery = ''; renderReplyLibrary(); };
    }

    if (hasGroupSupport) toolbar.querySelector('#tb-groups-btn')?.addEventListener('click', _showGroupManager);
    const tbBatch = toolbar.querySelector('#tb-batch-btn');
    if (tbBatch) {
        tbBatch.onclick = () => {
            if (!canBatch) return;
            _batchModeActive = !_batchModeActive;
            _batchModeTarget = isStickersTab ? 'stickers' : 'custom';
            _batchSelectedIndices.clear();
            renderReplyLibrary();
        };
    }

    toolbar.querySelector('#tb-dedup-btn')?.addEventListener('click', _runDedup);
    toolbar.querySelector('#tb-import-btn')?.addEventListener('click', () => document.getElementById('import-replies-input')?.click());
    toolbar.querySelector('#tb-export-btn')?.addEventListener('click', _showExportUI);

    toolbar.querySelectorAll('.gfp-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const f = btn.dataset.filter;
            _activeGroupFilter = f === 'all' ? null : (f === 'ungrouped' ? 'ungrouped' : parseInt(f));
            renderReplyLibrary();
        });
    });

    if (_batchModeActive) {
        toolbar.querySelector('#batch-select-all-btn')?.addEventListener('click', () => {
            if (_batchSelectedIndices.size === totalItems) _batchSelectedIndices.clear();
            else {
                const pool = isMainCustom ? customReplies : stickerLibrary;
                pool.forEach((_, i) => _batchSelectedIndices.add(i));
            }
            renderReplyLibrary();
        });
        toolbar.querySelector('#batch-group-btn')?.addEventListener('click', () => {
            if (!isMainCustom) return;
            if (_batchSelectedIndices.size === 0) return;
            _showBatchGroupPicker();
        });
        toolbar.querySelector('#batch-disable-btn')?.addEventListener('click', () => {
            if (_batchSelectedIndices.size === 0) return;
            if (isStickersTab) _batchToggleDisableStickers();
            else _batchToggleDisable();
        });
        toolbar.querySelector('#batch-delete-btn')?.addEventListener('click', async () => {
            if (_batchSelectedIndices.size === 0) return;
            if (!confirm(`确定删除选中的 ${_batchSelectedIndices.size} 条？`)) return;
            const indices = [..._batchSelectedIndices].sort((a, b) => b - a);
            if (isStickersTab) {
                const deleted = indices.map(i => stickerLibrary[i]).filter(Boolean);
                // 阶段三B：云端引用先删云端（并行删除，失败不阻塞）
                if (window.CloudMedia) {
                    const cloudRefs = deleted.filter(d => typeof d === 'string' && d.indexOf('oss://') === 0);
                    if (cloudRefs.length > 0) {
                        await Promise.all(cloudRefs.map(ref =>
                            window.CloudMedia.delete(ref).catch(err => {
                                console.warn('[cloud-media] 批量云端删除失败', ref, err);
                            })
                        ));
                    }
                }
                indices.forEach(i => stickerLibrary.splice(i, 1));
                // 同步清理已删除条目的“屏蔽集合”
                const dis = _getDisabledStickerItemsSet();
                deleted.forEach(d => dis.delete(d));
                _saveDisabledStickerItemsSet(dis);
                _batchSelectedIndices.clear();
                throttledSaveData();
                renderReplyLibrary();
                showNotification(`已删除 ${indices.length} 个贴纸`, 'success');
            } else {
                const deletedTexts = indices.map(i => customReplies[i]);
                indices.forEach(i => customReplies.splice(i, 1));
                if (customReplyGroups) {
                    customReplyGroups.forEach(g => {
                        if (g.items) g.items = g.items.filter(t => !deletedTexts.includes(t));
                    });
                }
                _batchSelectedIndices.clear();
                throttledSaveData();
                renderReplyLibrary();
                showNotification(`已删除 ${indices.length} 条`, 'success');
            }
        });
    }
}

function _renderCardViewWithGroups(list, items) {
    const ctx = _getGroupCtx();
    const groups = ctx.groups;
    const sourceItems = ctx.items;
    const disabledSet = _getDisabledItemsSet();
    // 预建索引 Map，避免 indexOf 的 O(n²) 查找
    const replyIndexMap = new Map();
    sourceItems.forEach((r, i) => { if (!replyIndexMap.has(r)) replyIndexMap.set(r, i); });
    const itemsWithIdx = items.map(text => ({
        text,
        idx: replyIndexMap.has(text) ? replyIndexMap.get(text) : -1
    }));

    if (_activeGroupFilter === null) {
        if (!groups || groups.length === 0) {
            _renderCardList(list, itemsWithIdx, disabledSet);
            return;
        }

        const inGroup = new Set();
        groups.forEach(g => {
            const groupItems = (g.items || [])
                .map(t => ({ text: t, idx: sourceItems.indexOf(t) }))
                .filter(x => x.idx >= 0 && items.includes(x.text));
            groupItems.forEach(x => inGroup.add(x.idx));
            _renderGroupBlock(list, g, groupItems, disabledSet);
        });

        const ungrouped = itemsWithIdx.filter(x => !inGroup.has(x.idx));
        if (ungrouped.length > 0) {
            _renderGroupBlock(list, { id: '__ungrouped', name: '未分组', color: '#868E96', disabled: false }, ungrouped, disabledSet, true);
        }
    } else if (_activeGroupFilter === 'ungrouped') {
        const inGroup = new Set();
        if (groups) groups.forEach(g => (g.items || []).forEach(t => {
            const i = sourceItems.indexOf(t);
            if (i >= 0) inGroup.add(i);
        }));
        const ungrouped = itemsWithIdx.filter(x => !inGroup.has(x.idx));
        if (ungrouped.length === 0) {
            list.innerHTML = renderEmptyState('所有内容均已分组');
        } else {
            _renderCardList(list, ungrouped, disabledSet);
        }
    } else {
        const g = groups.find(g => g.id === _activeGroupFilter);
        if (!g) { list.innerHTML = renderEmptyState('分组不存在'); return; }
        const filtered = itemsWithIdx.filter(x => (g.items || []).includes(x.text));
        if (filtered.length === 0) {
            list.innerHTML = renderEmptyState('此分组暂无内容');
        } else {
            _renderCardList(list, filtered, disabledSet);
        }
    }
}

function _renderGroupBlock(list, group, groupItems, disabledSet, isUngrouped = false) {
    const section = document.createElement('div');
    section.className = 'rl-group-block';
    const isCollapsed = group._collapsed || false;
    const isDisabled = group.disabled;
    const colorDot = group.color || '#868E96';

    section.innerHTML = `
        <div class="rl-group-header${isCollapsed ? ' collapsed' : ''}" id="grp-hdr-${group.id}" style="${isDisabled ? 'opacity:0.5;' : ''}">
            <div class="rl-group-tag" id="grp-tag-${group.id}" title="${isDisabled ? '点击启用此分组' : '点击屏蔽此分组'}">
                <span style="width:8px;height:8px;border-radius:50%;background:${colorDot};flex-shrink:0;"></span>
                <span style="font-size:12px;font-weight:700;color:${colorDot};">${group.name}</span>
                ${isDisabled ? `<span title="已屏蔽" style="color:${colorDot};">${ICONS.eyeOff}</span>` : ''}
            </div>
            <span style="font-size:11px;color:var(--text-secondary);">${groupItems.length} 条</span>
            ${_batchModeActive && groupItems.length > 0 ? (() => {
                const allSel = groupItems.every(x => _batchSelectedIndices.has(x.idx));
                const someSel = !allSel && groupItems.some(x => _batchSelectedIndices.has(x.idx));
                return `<button class="grp-select-all-btn" data-gid="${group.id}" title="${allSel ? '取消本组全选' : '全选本组'}" style="
                    margin-left:auto;flex-shrink:0;padding:3px 9px;border-radius:20px;cursor:pointer;
                    font-size:11px;font-weight:700;font-family:var(--font-family);
                    transition:all 0.15s;
                    border:1.5px solid ${allSel ? 'var(--accent-color)' : someSel ? colorDot : 'var(--border-color)'};
                    background:${allSel ? 'var(--accent-color)' : someSel ? colorDot + '22' : 'var(--primary-bg)'};
                    color:${allSel ? '#fff' : someSel ? colorDot : 'var(--text-secondary)'};
                ">${allSel ? '✓ 全选' : someSel ? `已选${groupItems.filter(x=>_batchSelectedIndices.has(x.idx)).length}` : '全选'}</button>`;
            })() : `<div style="flex:1;"></div>`}
            ${!isUngrouped ? `
            <button class="grp-edit-btn" title="编辑分组" style="
                ${_batchModeActive ? '' : 'margin-left:auto;'}width:26px;height:26px;border-radius:8px;border:1px solid var(--border-color);
                background:var(--primary-bg);color:var(--text-secondary);cursor:pointer;
                display:flex;align-items:center;justify-content:center;flex-shrink:0;
            ">${ICONS.edit}</button>` : ''}
            <div class="grp-chevron" style="color:var(--text-secondary);transition:transform 0.2s;transform:${isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};">
                ${ICONS.chevronD}
            </div>
        </div>
        <div class="rl-group-body" id="grp-body-${group.id}" style="display:${isCollapsed ? 'none' : 'block'};">
        </div>
    `;
    list.appendChild(section);

    const body = section.querySelector(`#grp-body-${group.id}`);
    if (groupItems.length === 0) {
        body.innerHTML = `<div style="padding:18px;text-align:center;font-size:12px;color:var(--text-secondary);opacity:0.6;">此分组暂无内容</div>`;
    } else {
        _renderCardList(body, groupItems, disabledSet);
    }

    section.querySelector('.grp-select-all-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        const allSel = groupItems.every(x => _batchSelectedIndices.has(x.idx));
        if (allSel) {
            groupItems.forEach(x => _batchSelectedIndices.delete(x.idx));
        } else {
            groupItems.forEach(x => _batchSelectedIndices.add(x.idx));
        }
        renderReplyLibrary();
    });

    section.querySelector(`#grp-hdr-${group.id}`).addEventListener('click', e => {
        if (e.target.closest('.grp-edit-btn') || e.target.closest(`#grp-tag-${group.id}`) || e.target.closest('.grp-select-all-btn')) return;
        group._collapsed = !group._collapsed;
        body.style.display = group._collapsed ? 'none' : 'block';
        section.querySelector('.grp-chevron').style.transform = group._collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
        section.querySelector('.rl-group-header').classList.toggle('collapsed', !!group._collapsed);
    });

    const tag = section.querySelector(`#grp-tag-${group.id}`);
    if (tag && !isUngrouped) {
        tag.addEventListener('click', e => {
            e.stopPropagation();
            group.disabled = !group.disabled;
            throttledSaveData();
            renderReplyLibrary();
            showNotification(group.disabled ? `已屏蔽「${group.name}」` : `已启用「${group.name}」`, 'success');
        });
    }

    section.querySelector('.grp-edit-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        _showGroupEditor(group, _getGroupCtx());
    });
}

const _CARD_PAGE_SIZE = 80; // 每次最多渲染 80 张，超过时追加"显示更多"

function _renderCardList(container, itemsWithIdx, disabledSet) {
    const total = itemsWithIdx.length;
    const toRender = itemsWithIdx.slice(0, _CARD_PAGE_SIZE);
    const remaining = total - toRender.length;

    const frag = document.createDocumentFragment();
    toRender.forEach(({ text, idx }) => {
        frag.appendChild(_createCard(text, idx, disabledSet));
    });

    if (remaining > 0) {
        const btn = document.createElement('button');
        btn.style.cssText = 'width:100%;padding:10px;margin-top:4px;border:1.5px dashed var(--border-color);border-radius:12px;background:transparent;color:var(--text-secondary);font-size:12px;cursor:pointer;font-family:var(--font-family);';
        btn.textContent = `显示剩余 ${remaining} 条`;
        btn.onclick = () => {
            btn.remove();
            const moreFrag = document.createDocumentFragment();
            itemsWithIdx.slice(_CARD_PAGE_SIZE).forEach(({ text, idx }) => {
                moreFrag.appendChild(_createCard(text, idx, disabledSet));
            });
            container.appendChild(moreFrag);
        };
        frag.appendChild(btn);
    }

    container.appendChild(frag);
}

function _createCard(item, index, disabledSet) {
    const div = document.createElement('div');
    div.className = 'rl-card';
    const isDisabled = disabledSet && disabledSet.has(item);
    const isSelected = _batchSelectedIndices.has(index);

    const groupBadge = (() => {
        const groups = _getGroupCtx().groups;
        if (!groups) return '';
        const g = groups.find(grp => grp.items && grp.items.includes(item));
        if (!g) return '';
        return `<span style="
            display:inline-flex;align-items:center;gap:3px;
            padding:1px 7px 1px 4px;border-radius:10px;font-size:10px;
            background:${g.color}18;color:${g.color};border:1px solid ${g.color}30;
            margin-top:5px;flex-shrink:0;
        ">
            <span style="width:5px;height:5px;border-radius:50%;background:${g.color};flex-shrink:0;"></span>
            ${g.name}
        </span>`;
    })();

    const itemParts = item.split('|');
    const displayText = itemParts.length > 1
        ? `<span style="font-size:13px;">${itemParts[0]}</span><span style="font-size:11px;opacity:0.6;display:block;margin-top:1px;">${itemParts[1]}</span>`
        : `<span style="font-size:13px;">${item}</span>`;

    if (_batchModeActive) {
        div.style.cssText = 'cursor:pointer;';
        div.className = 'rl-card' + (isSelected ? ' rl-selected' : '');
        div.innerHTML = `
            <div class="rl-batch-check" style="
                border:1.5px solid ${isSelected ? 'var(--accent-color)' : 'var(--border-color)'};
                background:${isSelected ? 'var(--accent-color)' : 'transparent'};
            ">
                ${isSelected ? `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>` : ''}
            </div>
            <div style="flex:1;min-width:0;${isDisabled ? 'opacity:0.4;' : ''}">
                ${displayText}
                ${groupBadge}
            </div>
        `;
        div.addEventListener('click', () => {
            if (_batchSelectedIndices.has(index)) _batchSelectedIndices.delete(index);
            else _batchSelectedIndices.add(index);
            renderReplyLibrary();
        });
        return div;
    }

    div.innerHTML = `
        <div style="flex:1;min-width:0;${isDisabled ? 'opacity:0.4;text-decoration:line-through;' : ''}">
            ${displayText}
            ${groupBadge}
        </div>
        <div class="rl-card-actions">
            <button class="rl-act-btn ${isDisabled ? 'active' : ''}" data-action="disable" title="${isDisabled ? '启用' : '屏蔽'}">
                ${isDisabled ? ICONS.eye : ICONS.eyeOff}
            </button>
            <button class="rl-act-btn" data-action="tag" title="分组">
                ${ICONS.tag}
            </button>
            <button class="rl-act-btn" data-action="edit" title="编辑">
                ${ICONS.edit}
            </button>
            <button class="rl-act-btn danger" data-action="delete" title="删除">
                ${ICONS.trash}
            </button>
        </div>
    `;

    div.querySelector('[data-action="delete"]').onclick = (e) => { e.stopPropagation(); deleteItem(index); };
    div.querySelector('[data-action="edit"]').onclick = (e) => { e.stopPropagation(); editItem(index, item); };
    div.querySelector('[data-action="disable"]').onclick = (e) => { e.stopPropagation(); _toggleItemDisable(item); };
    div.querySelector('[data-action="tag"]').onclick = (e) => { e.stopPropagation(); _showSingleItemGroupPicker(item, _getGroupCtx()); };

    return div;
}

function _renderAtmosphereList(list, items) {
    const disabledSet = _getDisabledItemsSet();
    // 预建各数组的索引 Map，避免 O(n²)
    const indexMaps = {
        pokes:    new Map(customPokes.map((r,i)   => [r, i])),
        statuses: new Map(customStatuses.map((r,i) => [r, i])),
        mottos:   new Map(customMottos.map((r,i)   => [r, i])),
        intros:   new Map(customIntros.map((r,i)   => [r, i])),
    };
    const frag = document.createDocumentFragment();
    items.forEach((item, idx) => {
        const realIdx = (indexMaps[currentSubTab] || { get: () => idx }).get(item) ?? idx;
        const div = document.createElement('div');
        div.className = 'custom-reply-item';
        div.innerHTML = `
            <span class="custom-reply-text">${item.replace('|','<br><small style="opacity:.65">')}</span>
            <div class="custom-reply-actions">
                <button class="reply-action-mini edit-btn" title="编辑">${ICONS.edit}</button>
                <button class="reply-action-mini delete-btn" title="删除">${ICONS.trash}</button>
            </div>
        `;
        div.querySelector('.delete-btn').onclick = () => deleteItem(realIdx);
        div.querySelector('.edit-btn').onclick = () => editItem(realIdx, item);
        frag.appendChild(div);
    });
    list.appendChild(frag);
}

function _renderEmojiTab(list, itemsToRender) {
    if (itemsToRender.length === 0 && customEmojis.length === 0) {
        list.innerHTML = renderEmptyState('暂无 Emoji'); return;
    }
    itemsToRender.forEach(item => {
        const div = document.createElement('div');
        div.className = 'emoji-item';
        div.textContent = item;
        list.appendChild(div);
    });
    if (customEmojis.length > 0) {
        const sep = document.createElement('div');
        sep.style.cssText = 'grid-column:1/-1;font-size:11px;color:var(--text-secondary);padding:4px 2px 2px;border-top:1px dashed var(--border-color);margin-top:4px;';
        sep.textContent = '— 自定义 —';
        list.appendChild(sep);
        customEmojis.forEach((item, idx) => {
            const div = document.createElement('div');
            div.className = 'emoji-item';
            div.style.position = 'relative';
            div.innerHTML = `<span style="pointer-events:none;">${item}</span><span class="emoji-custom-del" style="position:absolute;top:-4px;right:-4px;font-size:10px;background:var(--text-secondary);color:#fff;border-radius:50%;width:14px;height:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity 0.2s;">×</span>`;
            div.addEventListener('mouseenter', () => div.querySelector('.emoji-custom-del').style.opacity = '1');
            div.addEventListener('mouseleave', () => div.querySelector('.emoji-custom-del').style.opacity = '0');
            div.querySelector('.emoji-custom-del').addEventListener('click', e => {
                e.stopPropagation();
                customEmojis.splice(idx, 1);
                throttledSaveData();
                renderReplyLibrary();
            });
            list.appendChild(div);
        });
    }
}

function _renderStickerTab(list, itemsToRender) {
    const disabledSet = _getDisabledStickerItemsSet();
    itemsToRender.forEach((item, index) => {
        const div = document.createElement('div');
        const isDisabled = disabledSet.has(item);
        const isSelected = _batchModeActive && _batchSelectedIndices.has(index);
        div.className = `sticker-item${isDisabled ? ' sticker-disabled' : ''}${isSelected ? ' sticker-batch-selected' : ''}`;
        // 阶段三B：识别 oss:// 走懒加载
        const isCloud = typeof item === 'string' && item.indexOf('oss://') === 0;
        div.innerHTML = `
            <img loading="lazy">
            <div class="sticker-batch-check">✓</div>
            <div class="sticker-delete-btn"><i class="fas fa-times"></i></div>
        `;
        const imgEl = div.querySelector('img');
        if (isCloud) {
            if (window.CloudMedia) window.CloudMedia.bindLazyImage(imgEl, item);
        } else {
            imgEl.src = item;
        }
        div.addEventListener('click', () => {
            if (!_batchModeActive) return;
            if (currentMajorTab !== 'reply' || currentSubTab !== 'stickers') return;
            if (isSelected) _batchSelectedIndices.delete(index);
            else _batchSelectedIndices.add(index);
            renderReplyLibrary();
        });
        div.querySelector('.sticker-delete-btn').addEventListener('click', async e => {
            e.stopPropagation();
            if (confirm('删除此表情？')) {
                // 阶段三B：如果是云端引用，先删云端（失败不阻塞本地删除）
                if (window.CloudMedia && typeof item === 'string' && item.indexOf('oss://') === 0) {
                    try {
                        await window.CloudMedia.delete(item);
                    } catch (err) {
                        console.warn('[cloud-media] 云端删除失败', err);
                    }
                }
                // 如果该贴纸处于“已屏蔽”，删除后同步移出屏蔽集合
                if (isDisabled) {
                    disabledSet.delete(item);
                    _saveDisabledStickerItemsSet(disabledSet);
                }
                stickerLibrary.splice(index, 1);
                _batchSelectedIndices.clear();
                throttledSaveData();
                renderReplyLibrary();
            }
        });
        list.appendChild(div);
    });
}
function _getDisabledItemsSet() {
    try {
        const raw = localStorage.getItem('disabledReplyItems');
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
}

function _getDisabledStickerItemsSet() {
    try {
        const raw = localStorage.getItem('disabledStickerItems');
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
}

function _saveDisabledStickerItemsSet(set) {
    localStorage.setItem('disabledStickerItems', JSON.stringify([...set]));
}

function _saveDisabledItemsSet(set) {
    localStorage.setItem('disabledReplyItems', JSON.stringify([...set]));
}

function _toggleItemDisable(itemText) {
    const set = _getDisabledItemsSet();
    if (set.has(itemText)) { set.delete(itemText); showNotification('已启用', 'success'); }
    else { set.add(itemText); showNotification('已屏蔽（不会出现在随机回复中）', 'info'); }
    _saveDisabledItemsSet(set);
    renderReplyLibrary();
}

function _batchToggleDisable() {
    const set = _getDisabledItemsSet();
    const selectedItems = [..._batchSelectedIndices].map(i => customReplies[i]);
    const allDisabled = selectedItems.every(item => set.has(item));
    if (allDisabled) {
        selectedItems.forEach(item => set.delete(item));
        showNotification(`已启用 ${selectedItems.length} 条`, 'success');
    } else {
        selectedItems.forEach(item => set.add(item));
        showNotification(`已屏蔽 ${selectedItems.length} 条`, 'info');
    }
    _saveDisabledItemsSet(set);
    _batchSelectedIndices.clear();
    renderReplyLibrary();
}

function _batchToggleDisableStickers() {
    const set = _getDisabledStickerItemsSet();
    const selectedItems = [..._batchSelectedIndices].map(i => stickerLibrary[i]).filter(Boolean);
    if (selectedItems.length === 0) return;
    const allDisabled = selectedItems.every(item => set.has(item));
    if (allDisabled) {
        selectedItems.forEach(item => set.delete(item));
        showNotification(`已启用 ${selectedItems.length} 个贴纸`, 'success');
    } else {
        selectedItems.forEach(item => set.add(item));
        showNotification(`已屏蔽 ${selectedItems.length} 个贴纸`, 'info');
    }
    _saveDisabledStickerItemsSet(set);
    _batchSelectedIndices.clear();
    renderReplyLibrary();
}

function _runDedup() {
    let totalRemoved = 0;
    const crDedup = deduplicateContentArray(customReplies, CONSTANTS.REPLY_MESSAGES);
    customReplies = crDedup.result; totalRemoved += crDedup.removedCount;
    const cpDedup = deduplicateContentArray(customPokes);
    customPokes = cpDedup.result; totalRemoved += cpDedup.removedCount;
    const csDedup = deduplicateContentArray(customStatuses);
    customStatuses = csDedup.result; totalRemoved += csDedup.removedCount;
    const cmDedup = deduplicateContentArray(customMottos);
    customMottos = cmDedup.result; totalRemoved += cmDedup.removedCount;
    const ciDedup = deduplicateContentArray(customIntros);
    customIntros = ciDedup.result; totalRemoved += ciDedup.removedCount;
    const preEmoji = customEmojis.length;
    customEmojis = [...new Set(customEmojis)];
    totalRemoved += (preEmoji - customEmojis.length);
    if (totalRemoved > 0) {
        throttledSaveData(); renderReplyLibrary();
        showNotification(`🧹 共清理了 ${totalRemoved} 条重复内容`, 'success');
    } else {
        showNotification('✨ 没有重复内容', 'info');
    }
}

function _showGroupManager() {
    const ctx = _getGroupCtx();
    const groups = ctx.groups;
    const sourceItems = ctx.items;
    const overlay = _makeOverlay();

    const render = () => {
        const noGroups = !groups || groups.length === 0;
        panel.querySelector('#gm-list').innerHTML = noGroups
            ? `<div style="text-align:center;padding:32px 0;color:var(--text-secondary);font-size:13px;opacity:0.7;">
                    还没有分组<br><span style="font-size:11px;">点击下方按钮创建第一个分组</span>
               </div>`
            : groups.map((g, i) => `
                <div style="
                    display:flex;align-items:center;gap:10px;padding:12px 14px;
                    border-radius:13px;border:1.5px solid var(--border-color);
                    background:var(--primary-bg);${g.disabled ? 'opacity:0.55;' : ''}
                    transition:all 0.15s;
                ">
                    <span style="width:12px;height:12px;border-radius:50%;background:${g.color||'#868E96'};flex-shrink:0;box-shadow:0 0 0 2px ${g.color||'#868E96'}30;"></span>
                    <span style="flex:1;font-size:13px;color:var(--text-primary);font-weight:600;">${g.name}</span>
                    <span style="font-size:11px;color:var(--text-secondary);">${(g.items||[]).filter(t=>sourceItems.includes(t)).length} 条</span>
                    <button data-action="toggle" data-i="${i}" style="
                        width:28px;height:28px;border-radius:8px;border:1px solid var(--border-color);
                        background:${g.disabled ? 'var(--accent-color)' : 'transparent'};
                        color:${g.disabled ? '#fff' : 'var(--text-secondary)'};
                        cursor:pointer;display:flex;align-items:center;justify-content:center;
                    " title="${g.disabled ? '启用' : '屏蔽'}">${g.disabled ? ICONS.eye : ICONS.eyeOff}</button>
                    <button data-action="edit" data-i="${i}" style="
                        width:28px;height:28px;border-radius:8px;border:1px solid var(--border-color);
                        background:transparent;color:var(--text-secondary);cursor:pointer;
                        display:flex;align-items:center;justify-content:center;
                    " title="编辑">${ICONS.edit}</button>
                    <button data-action="del" data-i="${i}" style="
                        width:28px;height:28px;border-radius:8px;border:1px solid rgba(239,68,68,.25);
                        background:transparent;color:#ef4444;cursor:pointer;
                        display:flex;align-items:center;justify-content:center;
                    " title="删除">${ICONS.trash}</button>
                </div>
            `).join('');

        panel.querySelectorAll('[data-action]').forEach(btn => {
            btn.onclick = () => {
                const i = parseInt(btn.dataset.i);
                const action = btn.dataset.action;
                if (action === 'toggle') {
                    groups[i].disabled = !groups[i].disabled;
                    throttledSaveData(); render(); renderReplyLibrary();
                } else if (action === 'edit') {
                    overlay.remove();
                    _showGroupEditor(groups[i], ctx);
                } else if (action === 'del') {
                    if (confirm(`删除分组「${groups[i].name}」？（内容不会被删除）`)) {
                        groups.splice(i, 1);
                        throttledSaveData(); render(); renderReplyLibrary();
                    }
                }
            };
        });
    };

    const panel = document.createElement('div');
    panel.style.cssText = `
        background:var(--secondary-bg);border-radius:22px;padding:24px;
        width:92%;max-width:400px;max-height:85vh;
        display:flex;flex-direction:column;gap:14px;
        box-shadow:0 24px 80px rgba(0,0,0,.45);
        animation:popIn 0.22s cubic-bezier(.34,1.56,.64,1);
    `;
    panel.innerHTML = `
        <style>
            @keyframes popIn { from{opacity:0;transform:scale(.93)} to{opacity:1;transform:scale(1)} }
        </style>
        <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:16px;font-weight:700;color:var(--text-primary);display:flex;align-items:center;gap:8px;">
                ${ICONS.folder} 分组管理
            </div>
            <button id="gm-close" style="width:30px;height:30px;border-radius:50%;border:none;background:var(--primary-bg);color:var(--text-secondary);cursor:pointer;display:flex;align-items:center;justify-content:center;">${ICONS.close}</button>
        </div>
        <div id="gm-list" style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:55vh;"></div>
        <button id="gm-add" style="
            width:100%;padding:12px;border:1.5px dashed var(--accent-color);border-radius:13px;
            background:transparent;color:var(--accent-color);font-size:13px;cursor:pointer;
            font-family:var(--font-family);display:flex;align-items:center;justify-content:center;gap:7px;
            transition:background 0.15s;
        " onmouseover="this.style.background='rgba(var(--accent-color-rgb),0.06)'" onmouseout="this.style.background='transparent'">
            ${ICONS.plus} 新建分组
        </button>
    `;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    render();

    panel.querySelector('#gm-close').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    panel.querySelector('#gm-add').onclick = () => { overlay.remove(); _showGroupEditor(null, ctx); };
}

function _showGroupEditor(group, ctx) {
    ctx = ctx || _getGroupCtx();
    const groups = ctx.groups;
    const isNew = !group;
    const overlay = _makeOverlay();
    const initColor = group?.color || GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
    let selectedColor = initColor;

    const panel = document.createElement('div');
    panel.style.cssText = `
        background:var(--secondary-bg);border-radius:22px;padding:24px;
        width:92%;max-width:380px;
        box-shadow:0 24px 80px rgba(0,0,0,.45);
        animation:popIn 0.22s cubic-bezier(.34,1.56,.64,1);
    `;
    panel.innerHTML = `
        <style>@keyframes popIn { from{opacity:0;transform:scale(.93)} to{opacity:1;transform:scale(1)} }</style>
        <div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:18px;">
            ${isNew ? '新建分组' : '编辑分组'}
        </div>

        <div style="margin-bottom:16px;">
            <label style="font-size:12px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:7px;letter-spacing:.5px;">LABEL</label>
            <input id="ge-name" value="${group?.name || ''}" placeholder="分组名称…" style="
                width:100%;box-sizing:border-box;padding:11px 14px;
                border:1.5px solid var(--border-color);border-radius:12px;
                background:var(--primary-bg);color:var(--text-primary);
                font-size:14px;font-family:var(--font-family);outline:none;transition:border 0.18s;
            ">
        </div>

        <div style="margin-bottom:12px;">
            <label style="font-size:12px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:8px;letter-spacing:.5px;">COLOR PRESET</label>
            <div id="ge-presets" style="display:flex;gap:7px;flex-wrap:wrap;">
                ${GROUP_COLORS.map(c => `
                    <div data-preset="${c}" style="
                        width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;
                        border:2.5px solid ${c === selectedColor ? '#fff' : 'transparent'};
                        box-shadow:${c === selectedColor ? `0 0 0 2.5px ${c}` : 'none'};
                        transition:all 0.15s;flex-shrink:0;
                    "></div>
                `).join('')}
            </div>
        </div>

        <div style="margin-bottom:20px;">
            <label style="font-size:12px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:8px;letter-spacing:.5px;">CUSTOM COLOR</label>
            <div style="display:flex;gap:10px;align-items:center;">
                <input type="color" id="ge-colorpicker" value="${selectedColor}" style="
                    width:40px;height:40px;border:none;border-radius:10px;cursor:pointer;
                    padding:2px;background:var(--primary-bg);flex-shrink:0;
                ">
                <input type="text" id="ge-hexinput" value="${selectedColor}" maxlength="7" placeholder="#RRGGBB" style="
                    flex:1;padding:10px 12px;border:1.5px solid var(--border-color);
                    border-radius:10px;background:var(--primary-bg);color:var(--text-primary);
                    font-size:13px;font-family:monospace;outline:none;transition:border 0.18s;
                ">
                <div id="ge-color-preview" style="
                    display:flex;align-items:center;gap:6px;padding:7px 12px;
                    border-radius:20px;border:1.5px solid ${selectedColor}40;
                    background:${selectedColor}18;
                ">
                    <span style="width:8px;height:8px;border-radius:50%;background:${selectedColor};"></span>
                    <span id="ge-preview-name" style="font-size:12px;font-weight:700;color:${selectedColor};">${group?.name || '预览'}</span>
                </div>
            </div>
        </div>

        <div style="display:flex;gap:10px;">
            <button id="ge-cancel" style="
                flex:1;padding:12px;border:1.5px solid var(--border-color);border-radius:13px;
                background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;font-family:var(--font-family);
            ">取消</button>
            <button id="ge-save" style="
                flex:2;padding:12px;border:none;border-radius:13px;
                background:var(--accent-color);color:#fff;font-size:14px;font-weight:700;
                cursor:pointer;font-family:var(--font-family);transition:opacity 0.15s;
            ">保存</button>
        </div>
    `;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const updateColor = (color) => {
        selectedColor = color;
        panel.querySelector('#ge-colorpicker').value = color;
        panel.querySelector('#ge-hexinput').value = color;
        const preview = panel.querySelector('#ge-color-preview');
        const previewName = panel.querySelector('#ge-preview-name');
        preview.style.borderColor = color + '40';
        preview.style.background = color + '18';
        previewName.style.color = color;
        const nameInput = panel.querySelector('#ge-name');
        previewName.textContent = nameInput.value || '预览';
        panel.querySelectorAll('[data-preset]').forEach(dot => {
            const isSelected = dot.dataset.preset === color;
            dot.style.border = `2.5px solid ${isSelected ? '#fff' : 'transparent'}`;
            dot.style.boxShadow = isSelected ? `0 0 0 2.5px ${dot.dataset.preset}` : 'none';
        });
    };

    panel.querySelector('#ge-name').addEventListener('input', e => {
        panel.querySelector('#ge-preview-name').textContent = e.target.value || '预览';
    });
    panel.querySelector('#ge-name').addEventListener('focus', e => { e.target.style.borderColor = 'var(--accent-color)'; });
    panel.querySelector('#ge-name').addEventListener('blur', e => { e.target.style.borderColor = 'var(--border-color)'; });

    panel.querySelectorAll('[data-preset]').forEach(dot => {
        dot.onclick = () => updateColor(dot.dataset.preset);
    });

    panel.querySelector('#ge-colorpicker').addEventListener('input', e => updateColor(e.target.value));
    panel.querySelector('#ge-hexinput').addEventListener('input', e => {
        const v = e.target.value.trim();
        if (/^#[0-9A-Fa-f]{6}$/.test(v)) updateColor(v);
    });
    panel.querySelector('#ge-hexinput').addEventListener('focus', e => { e.target.style.borderColor = 'var(--accent-color)'; });
    panel.querySelector('#ge-hexinput').addEventListener('blur', e => { e.target.style.borderColor = 'var(--border-color)'; });

    panel.querySelector('#ge-cancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    panel.querySelector('#ge-save').onclick = () => {
        const name = panel.querySelector('#ge-name').value.trim();
        if (!name) { showNotification('请输入分组名称', 'warning'); return; }
        if (isNew) {
            groups.push({ id: Date.now(), name, color: selectedColor, disabled: false, items: [] });
        } else {
            group.name = name;
            group.color = selectedColor;
        }
        throttledSaveData();
        overlay.remove();
        renderReplyLibrary();
        showNotification(isNew ? '✓ 分组已创建' : '✓ 分组已更新', 'success');
    };
}

function _showSingleItemGroupPicker(itemText, ctx) {
    ctx = ctx || _getGroupCtx();
    const groups = ctx.groups;
    if (!groups || groups.length === 0) {
        if (confirm('还没有分组，是否立即创建？')) _showGroupEditor(null, ctx);
        return;
    }
    const overlay = _makeOverlay();
    const currentGroup = groups.find(g => g.items && g.items.includes(itemText));

    const panel = document.createElement('div');
    panel.style.cssText = `
        background:var(--secondary-bg);border-radius:22px;padding:22px;
        width:92%;max-width:340px;
        box-shadow:0 24px 80px rgba(0,0,0,.45);
        animation:popIn 0.22s cubic-bezier(.34,1.56,.64,1);
    `;
    panel.innerHTML = `
        <style>@keyframes popIn { from{opacity:0;transform:scale(.93)} to{opacity:1;transform:scale(1)} }</style>
        <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:14px;">选择分组</div>
        <div style="display:flex;flex-direction:column;gap:7px;max-height:55vh;overflow-y:auto;margin-bottom:14px;">
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border-radius:11px;border:1.5px solid ${!currentGroup ? 'var(--accent-color)' : 'var(--border-color)'};background:${!currentGroup ? 'rgba(var(--accent-color-rgb),0.06)' : 'var(--primary-bg)'};">
                <input type="radio" name="sgp" value="" ${!currentGroup ? 'checked' : ''} style="accent-color:var(--accent-color);">
                <span style="font-size:13px;color:var(--text-secondary);">不分组</span>
            </label>
            ${groups.map((g, i) => `
                <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border-radius:11px;border:1.5px solid ${currentGroup?.id === g.id ? g.color : 'var(--border-color)'};background:${currentGroup?.id === g.id ? g.color + '10' : 'var(--primary-bg)'};">
                    <input type="radio" name="sgp" value="${i}" ${currentGroup?.id === g.id ? 'checked' : ''} style="accent-color:${g.color};">
                    <span style="width:9px;height:9px;border-radius:50%;background:${g.color||'#aaa'};flex-shrink:0;"></span>
                    <span style="flex:1;font-size:13px;color:var(--text-primary);font-weight:600;">${g.name}</span>
                    <span style="font-size:11px;color:var(--text-secondary);">${(g.items||[]).length} 条</span>
                </label>
            `).join('')}
        </div>
        <div style="display:flex;gap:10px;">
            <button id="sgp-cancel" style="flex:1;padding:11px;border:1.5px solid var(--border-color);border-radius:12px;background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;font-family:var(--font-family);">取消</button>
            <button id="sgp-save" style="flex:2;padding:11px;border:none;border-radius:12px;background:var(--accent-color);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font-family);">确认</button>
        </div>
    `;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    panel.querySelector('#sgp-cancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    panel.querySelector('#sgp-save').onclick = () => {
        const checked = panel.querySelector('input[name="sgp"]:checked');
        if (!checked) return;
        groups.forEach(g => { if (g.items) g.items = g.items.filter(t => t !== itemText); });
        if (checked.value !== '') {
            const idx = parseInt(checked.value);
            if (!groups[idx].items) groups[idx].items = [];
            groups[idx].items.push(itemText);
        }
        throttledSaveData();
        overlay.remove();
        renderReplyLibrary();
        showNotification('✓ 分组已更新', 'success');
    };
}

function _showBatchGroupPicker() {
    const ctx = _getGroupCtx();
    const groups = ctx.groups;
    const sourceItems = ctx.items;
    if (!groups || groups.length === 0) {
        if (confirm('还没有分组，是否立即创建？')) { _showGroupEditor(null, ctx); return; }
        return;
    }
    const selectedItems = [..._batchSelectedIndices].map(i => sourceItems[i]);
    const overlay = _makeOverlay();

    const panel = document.createElement('div');
    panel.style.cssText = `
        background:var(--secondary-bg);border-radius:22px;padding:22px;
        width:92%;max-width:340px;
        box-shadow:0 24px 80px rgba(0,0,0,.45);
        animation:popIn 0.22s cubic-bezier(.34,1.56,.64,1);
    `;
    panel.innerHTML = `
        <style>@keyframes popIn { from{opacity:0;transform:scale(.93)} to{opacity:1;transform:scale(1)} }</style>
        <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">批量分组</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">将 <strong style="color:var(--text-primary);">${selectedItems.length}</strong> 条内容移入分组</div>
        <div style="display:flex;flex-direction:column;gap:7px;max-height:50vh;overflow-y:auto;margin-bottom:14px;">
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border-radius:11px;border:1.5px solid var(--border-color);background:var(--primary-bg);">
                <input type="radio" name="bgp" value="" checked style="accent-color:var(--accent-color);">
                <span style="font-size:13px;color:var(--text-secondary);">移出所有分组</span>
            </label>
            ${groups.map((g, i) => `
                <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border-radius:11px;border:1.5px solid var(--border-color);background:var(--primary-bg);">
                    <input type="radio" name="bgp" value="${i}" style="accent-color:${g.color};">
                    <span style="width:9px;height:9px;border-radius:50%;background:${g.color||'#aaa'};flex-shrink:0;"></span>
                    <span style="flex:1;font-size:13px;color:var(--text-primary);font-weight:600;">${g.name}</span>
                    <span style="font-size:11px;color:var(--text-secondary);">${(g.items||[]).length} 条</span>
                </label>
            `).join('')}
        </div>
        <div style="display:flex;gap:10px;">
            <button id="bgp-cancel" style="flex:1;padding:11px;border:1.5px solid var(--border-color);border-radius:12px;background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;font-family:var(--font-family);">取消</button>
            <button id="bgp-save" style="flex:2;padding:11px;border:none;border-radius:12px;background:var(--accent-color);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font-family);">确认</button>
        </div>
    `;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    panel.querySelector('#bgp-cancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    panel.querySelector('#bgp-save').onclick = () => {
        const checked = panel.querySelector('input[name="bgp"]:checked');
        if (!checked) return;
        groups.forEach(g => { if (g.items) g.items = g.items.filter(t => !selectedItems.includes(t)); });
        if (checked.value !== '') {
            const idx = parseInt(checked.value);
            if (!groups[idx].items) groups[idx].items = [];
            selectedItems.forEach(item => {
                if (!groups[idx].items.includes(item)) groups[idx].items.push(item);
            });
        }
        throttledSaveData();
        _batchSelectedIndices.clear();
        overlay.remove();
        renderReplyLibrary();
        showNotification(`✓ 已为 ${selectedItems.length} 条内容分组`, 'success');
    };
}

function deleteItem(index) {
    if (!confirm('确定删除吗？')) return;
    const ctx = _getGroupCtx();
    const item = _tabHasGroups() ? ctx.items[index] : null;
    if (currentMajorTab === 'reply' && currentSubTab === 'custom') customReplies.splice(index, 1);
    else if (currentSubTab === 'pokes') customPokes.splice(index, 1);
    else if (currentSubTab === 'statuses') customStatuses.splice(index, 1);
    else if (currentSubTab === 'mottos') customMottos.splice(index, 1);
    else if (currentSubTab === 'intros') customIntros.splice(index, 1);
    if (item && ctx.groups) {
        ctx.groups.forEach(g => { if (g.items) g.items = g.items.filter(t => t !== item); });
    }
    throttledSaveData();
    renderReplyLibrary();
}

function editItem(index, oldText) {
    let newText;
    if (currentSubTab === 'intros') {
        const parts = oldText.split('|');
        const l1 = prompt('修改主标题:', parts[0]);
        if (l1 === null) return;
        const l2 = prompt('修改副标题:', parts[1] || '');
        if (l2 === null) return;
        newText = `${l1}|${l2}`;
    } else {
        newText = prompt('修改内容:', oldText);
    }
    if (newText === null || newText.trim() === '') return;
    if (_tabHasGroups()) {
        const ctx = _getGroupCtx();
        if (ctx.groups) {
            ctx.groups.forEach(g => {
                if (g.items) { const i = g.items.indexOf(oldText); if (i >= 0) g.items[i] = newText.trim(); }
            });
        }
    }
    if (currentMajorTab === 'reply' && currentSubTab === 'custom') customReplies[index] = newText.trim();
    else if (currentSubTab === 'pokes') customPokes[index] = newText.trim();
    else if (currentSubTab === 'statuses') customStatuses[index] = newText.trim();
    else if (currentSubTab === 'mottos') customMottos[index] = newText.trim();
    else if (currentSubTab === 'intros') customIntros[index] = newText.trim();
    throttledSaveData();
    renderReplyLibrary();
}

function renderEmptyState(text) {
    return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 0;color:var(--text-secondary);opacity:0.6;grid-column:1/-1;">
        <div style="width:56px;height:56px;background:var(--secondary-bg);border-radius:16px;display:flex;align-items:center;justify-content:center;margin-bottom:14px;box-shadow:var(--shadow);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M16.5 16.5L20 20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </div>
        <p style="font-size:14px;font-weight:500;text-align:center;line-height:1.6;">${text}</p>
    </div>`;
}

function _showExportUI() {
    // 读取公告数据（localStorage）
    let _annCustomData = {};
    let _annStatusPool = [];
    try { _annCustomData = JSON.parse(localStorage.getItem('dg_custom_data') || '{}'); } catch(e) {}
    try { _annStatusPool = JSON.parse(localStorage.getItem('dg_status_pool') || '[]'); } catch(e) {}
    const _annTextCount = (_annCustomData.titles || []).length + (_annCustomData.notes || []).length;
    const _annPoolCount = _annStatusPool.length;
    const _annTotalCount = _annTextCount + _annPoolCount;

    const modules = [
        { id: '_re_replies',  icon: ICONS.comment,   label: '主字卡',        count: customReplies.length,                     key: 'customReplies' },
        { id: '_re_pokes',    icon: ICONS.hand,      label: '拍一拍',        count: customPokes.length,                       key: 'customPokes' },
        { id: '_re_statuses', icon: ICONS.dot,       label: '对方状态',      count: customStatuses.length,                    key: 'customStatuses' },
        { id: '_re_mottos',   icon: ICONS.quote,     label: '顶部格言',      count: customMottos.length,                      key: 'customMottos' },
        { id: '_re_intros',   icon: ICONS.play,      label: '开场动画',      count: customIntros.length,                      key: 'customIntros' },
        { id: '_re_emojis',   icon: ICONS.smile,     label: 'Emoji 库',      count: customEmojis.length,                      key: 'customEmojis' },
        { id: '_re_ann',      icon: ICONS.folderBig, label: '今日公告配置',  count: _annTotalCount,                           key: 'announcementConfig' },
        { id: '_re_groups',   icon: ICONS.folderBig, label: '字卡分组',      count: (customReplyGroups||[]).length,            key: 'customReplyGroups',  extra: true },
        { id: '_re_pokg',     icon: ICONS.folderBig, label: '拍一拍分组',    count: (window.customPokeGroups||[]).length,     key: 'customPokeGroups',   extra: true },
        { id: '_re_statg',    icon: ICONS.folderBig, label: '对方状态分组',  count: (window.customStatusGroups||[]).length,   key: 'customStatusGroups', extra: true },
    ];

    // 检测当前 tab 决定哪个分组有「按分组导出」选项
    const replyGroupsExist  = customReplyGroups        && customReplyGroups.length > 0;
    const pokeGroupsExist   = window.customPokeGroups  && window.customPokeGroups.length > 0;
    const statusGroupsExist = window.customStatusGroups && window.customStatusGroups.length > 0;
    const onAnnTab          = currentMajorTab === 'announcement';
    const anyGroupExists    = replyGroupsExist || pokeGroupsExist || statusGroupsExist || onAnnTab;

    // 根据当前 tab 决定「按分组导出」对应哪个类型
    const onPokeTab   = currentMajorTab === 'atmosphere' && currentSubTab === 'pokes';
    const onStatusTab = currentMajorTab === 'atmosphere' && currentSubTab === 'statuses';
    let groupExportType = null;
    if (onAnnTab)                          groupExportType = 'announcement';
    if (onPokeTab   && pokeGroupsExist)    groupExportType = 'pokes';
    if (onStatusTab && statusGroupsExist)  groupExportType = 'statuses';
    // 只有在字卡 tab（非拍一拍/状态/公告 tab）时才 fallback 到字卡分组
    if (!groupExportType && !onPokeTab && !onStatusTab && !onAnnTab && replyGroupsExist) groupExportType = 'replies';

    const groupDescMap = {
        replies:      '仅导出指定分组的字卡内容',
        pokes:        '仅导出指定分组的拍一拍内容',
        statuses:     '仅导出指定分组的对方状态内容',
        announcement: '选择要导出的公告内容模块',
    };

    if (anyGroupExists) {
        const overlay = _makeOverlay();
        const panel = document.createElement('div');
        panel.style.cssText = `
            background:var(--secondary-bg);border-radius:22px;padding:24px;
            width:92%;max-width:380px;
            box-shadow:0 24px 80px rgba(0,0,0,.45);
            animation:popIn 0.22s cubic-bezier(.34,1.56,.64,1);
        `;
        panel.innerHTML = `
            <style>@keyframes popIn{from{opacity:0;transform:scale(.93)}to{opacity:1;transform:scale(1)}}</style>
            <div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:6px;display:flex;align-items:center;gap:8px;">
                ${ICONS.export} 导出方式
            </div>
            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:18px;">请选择导出模式</div>
            <div style="display:flex;flex-direction:column;gap:10px;">
                <button id="_exp_all_btn" style="
                    display:flex;align-items:center;gap:12px;padding:14px 16px;
                    border:1.5px solid var(--border-color);border-radius:14px;
                    background:var(--primary-bg);cursor:pointer;text-align:left;transition:border-color 0.15s;
                ">
                    <div style="width:38px;height:38px;border-radius:10px;background:rgba(var(--accent-color-rgb),0.12);display:flex;align-items:center;justify-content:center;color:var(--accent-color);flex-shrink:0;">${ICONS.export}</div>
                    <div>
                        <div style="font-size:13px;font-weight:600;color:var(--text-primary);">全量导出</div>
                        <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">自由选择要导出的模块</div>
                    </div>
                </button>
                ${groupExportType ? `
                <button id="_exp_group_btn" style="
                    display:flex;align-items:center;gap:12px;padding:14px 16px;
                    border:1.5px solid var(--border-color);border-radius:14px;
                    background:var(--primary-bg);cursor:pointer;text-align:left;transition:border-color 0.15s;
                ">
                    <div style="width:38px;height:38px;border-radius:10px;background:rgba(var(--accent-color-rgb),0.12);display:flex;align-items:center;justify-content:center;color:var(--accent-color);flex-shrink:0;">${ICONS.folderBig}</div>
                    <div>
                        <div style="font-size:13px;font-weight:600;color:var(--text-primary);">按分组导出</div>
                        <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${groupDescMap[groupExportType] || '仅导出指定分组内容'}</div>
                    </div>
                </button>` : ''}
            </div>
            <button id="_exp_cancel_btn" style="
                width:100%;margin-top:14px;padding:12px;border:1.5px solid var(--border-color);
                border-radius:13px;background:none;color:var(--text-secondary);
                font-size:13px;cursor:pointer;font-family:var(--font-family);
            ">取消</button>
        `;
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        panel.querySelector('#_exp_cancel_btn').onclick = () => overlay.remove();
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

        panel.querySelector('#_exp_all_btn').onclick = () => {
            overlay.remove();
            _showIOSheet('导出字卡', '选择要导出的模块', modules, ICONS.export, (selected) => {
                if (!selected.length) { showNotification('请至少选择一项', 'error'); return; }
                _doExport(selected);
            });
        };

        const groupBtn = panel.querySelector('#_exp_group_btn');
        if (groupBtn) {
            groupBtn.onclick = () => {
                overlay.remove();
                if (groupExportType === 'announcement') {
                    _showAnnouncementExportPicker();
                } else {
                    _showGroupExportPicker(groupExportType);
                }
            };
        }
        return;
    }

    _showIOSheet('导出字卡', '选择要导出的模块', modules, ICONS.export, (selected) => {
        if (!selected.length) { showNotification('请至少选择一项', 'error'); return; }
        _doExport(selected);
    });
}

function _doExport(selectedModules) {
    const libraryData = { exportDate: new Date().toISOString(), modules: [] };
    selectedModules.forEach(m => {
        if (m.key === 'customReplies')         { libraryData.customReplies      = customReplies;                  libraryData.modules.push('replies'); }
        else if (m.key === 'customPokes')      { libraryData.customPokes        = customPokes;                    libraryData.modules.push('pokes'); }
        else if (m.key === 'customStatuses')   { libraryData.customStatuses     = customStatuses;                 libraryData.modules.push('statuses'); }
        else if (m.key === 'customMottos')     { libraryData.customMottos       = customMottos;                   libraryData.modules.push('mottos'); }
        else if (m.key === 'customIntros')     { libraryData.customIntros       = customIntros;                   libraryData.modules.push('intros'); }
        else if (m.key === 'customEmojis')     { libraryData.customEmojis       = customEmojis;                   libraryData.modules.push('emojis'); }
        else if (m.key === 'customReplyGroups')  { libraryData.customReplyGroups  = window.customReplyGroups  || []; libraryData.modules.push('groups'); }
        else if (m.key === 'customPokeGroups')   { libraryData.customPokeGroups   = window.customPokeGroups   || []; libraryData.modules.push('pokeGroups'); }
        else if (m.key === 'customStatusGroups') { libraryData.customStatusGroups = window.customStatusGroups || []; libraryData.modules.push('statusGroups'); }
        else if (m.key === 'announcementConfig') {
            let _acd = {}; let _asp = [];
            try { _acd = JSON.parse(localStorage.getItem('dg_custom_data') || '{}'); } catch(e) {}
            try { _asp = JSON.parse(localStorage.getItem('dg_status_pool') || '[]'); } catch(e) {}
            libraryData.announcementConfig = { customData: _acd, statusPool: _asp };
            libraryData.modules.push('announcementConfig');
        }
    });
    const fileName = `reply-library-${libraryData.modules.join('+')}-${new Date().toISOString().slice(0,10)}.json`;
    exportDataToMobileOrPC(JSON.stringify(libraryData, null, 2), fileName);
    showNotification('✓ 字卡导出成功', 'success');
}

function _showGroupExportPicker(type) {
    // type: 'replies' | 'pokes' | 'statuses'
    type = type || 'replies';

    const cfgMap = {
        replies:  { groups: window.customReplyGroups  || [], items: customReplies,   groupKey: 'customReplyGroups',  itemKey: 'customReplies',  moduleTag: ['replies','groups'],       filePrefix: 'reply-groups',  label: '字卡',    successUnit: '条字卡' },
        pokes:    { groups: window.customPokeGroups   || [], items: customPokes,      groupKey: 'customPokeGroups',   itemKey: 'customPokes',    moduleTag: ['pokes','pokeGroups'],     filePrefix: 'poke-groups',   label: '拍一拍',  successUnit: '条拍一拍' },
        statuses: { groups: window.customStatusGroups || [], items: customStatuses,   groupKey: 'customStatusGroups', itemKey: 'customStatuses', moduleTag: ['statuses','statusGroups'],filePrefix: 'status-groups', label: '对方状态',successUnit: '条状态' },
    };
    const cfg = cfgMap[type] || cfgMap.replies;

    const overlay = _makeOverlay();
    const panel = document.createElement('div');
    panel.style.cssText = `
        background:var(--secondary-bg);border-radius:22px;padding:24px;
        width:92%;max-width:380px;max-height:85vh;
        display:flex;flex-direction:column;gap:14px;
        box-shadow:0 24px 80px rgba(0,0,0,.45);
        animation:popIn 0.22s cubic-bezier(.34,1.56,.64,1);
    `;
    panel.innerHTML = `
        <style>@keyframes popIn{from{opacity:0;transform:scale(.93)}to{opacity:1;transform:scale(1)}}</style>
        <div style="font-size:16px;font-weight:700;color:var(--text-primary);display:flex;align-items:center;gap:8px;">
            ${ICONS.folderBig} 选择分组导出
        </div>
        <div style="font-size:12px;color:var(--text-secondary);">勾选要导出的分组，仅导出这些分组的${cfg.label}</div>
        <div id="_gep_list" style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:50vh;"></div>
        <div style="display:flex;gap:10px;">
            <button id="_gep_cancel" style="flex:1;padding:12px;border:1.5px solid var(--border-color);border-radius:13px;background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;font-family:var(--font-family);">取消</button>
            <button id="_gep_confirm" style="flex:2;padding:12px;border:none;border-radius:13px;background:var(--accent-color);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font-family);display:flex;align-items:center;justify-content:center;gap:8px;">
                ${ICONS.export} 导出
            </button>
        </div>
    `;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const listEl = panel.querySelector('#_gep_list');
    cfg.groups.forEach((g, i) => {
        const cnt = (g.items || []).filter(t => cfg.items.includes(t)).length;
        const row = document.createElement('label');
        row.style.cssText = `display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:13px;border:1.5px solid var(--border-color);background:var(--primary-bg);cursor:pointer;transition:border-color 0.15s;`;
        row.innerHTML = `
            <input type="checkbox" value="${i}" style="width:16px;height:16px;accent-color:${g.color};flex-shrink:0;" checked>
            <span style="width:10px;height:10px;border-radius:50%;background:${g.color||'#aaa'};flex-shrink:0;"></span>
            <span style="flex:1;font-size:13px;font-weight:600;color:var(--text-primary);">${g.name}</span>
            <span style="font-size:11px;color:var(--text-secondary);">${cnt} 条</span>
        `;
        listEl.appendChild(row);
    });

    panel.querySelector('#_gep_cancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    panel.querySelector('#_gep_confirm').onclick = () => {
        const checked = [...panel.querySelectorAll('input[type=checkbox]:checked')].map(cb => parseInt(cb.value));
        if (!checked.length) { showNotification('请至少选择一个分组', 'warning'); return; }

        const selectedGroups = checked.map(i => cfg.groups[i]);
        const allItems = new Set();
        const exportGroups = [];
        selectedGroups.forEach(g => {
            const items = (g.items || []).filter(t => cfg.items.includes(t));
            items.forEach(t => allItems.add(t));
            exportGroups.push({ ...g, items });
        });

        const libraryData = {
            exportDate: new Date().toISOString(),
            modules: cfg.moduleTag,
            [cfg.itemKey]:  [...allItems],
            [cfg.groupKey]: exportGroups,
            _groupExport: true,
            _groupExportType: type
        };
        const groupNames = selectedGroups.map(g => g.name).join('+');
        const fileName = `${cfg.filePrefix}-${groupNames}-${new Date().toISOString().slice(0,10)}.json`;
        exportDataToMobileOrPC(JSON.stringify(libraryData, null, 2), fileName);
        overlay.remove();
        showNotification(`✓ 已导出 ${checked.length} 个分组，共 ${allItems.size} ${cfg.successUnit}`, 'success');
    };
}

function _showAnnouncementExportPicker() {
    let annCustomData = {};
    let annStatusPool = [];
    try { annCustomData = JSON.parse(localStorage.getItem('dg_custom_data') || '{}'); } catch(e) {}
    try { annStatusPool = JSON.parse(localStorage.getItem('dg_status_pool') || '[]'); } catch(e) {}
    const textCount = (annCustomData.titles || []).length + (annCustomData.notes || []).length;
    const poolCount = annStatusPool.length;

    const options = [
        { id: '_aep_text', label: '公告文案', desc: `${textCount} 条内容`, key: 'announcementText', hasData: textCount > 0 },
        { id: '_aep_pool', label: '状态随机库', desc: `${poolCount} 条条目`, key: 'announcementStatusPool', hasData: poolCount > 0 },
    ];

    const overlay = _makeOverlay();
    const panel = document.createElement('div');
    panel.style.cssText = `
        background:var(--secondary-bg);border-radius:22px;padding:24px;
        width:92%;max-width:380px;
        box-shadow:0 24px 80px rgba(0,0,0,.45);
        animation:popIn 0.22s cubic-bezier(.34,1.56,.64,1);
        display:flex;flex-direction:column;gap:14px;
    `;
    panel.innerHTML = `
        <style>@keyframes popIn{from{opacity:0;transform:scale(.93)}to{opacity:1;transform:scale(1)}}</style>
        <div style="font-size:16px;font-weight:700;color:var(--text-primary);display:flex;align-items:center;gap:8px;">
            ${ICONS.folderBig} 选择导出内容
        </div>
        <div style="font-size:12px;color:var(--text-secondary);">勾选要导出的公告模块</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
            ${options.map(opt => `
                <label style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:13px;border:1.5px solid var(--border-color);background:var(--primary-bg);cursor:pointer;">
                    <input type="checkbox" id="${opt.id}" ${opt.hasData ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent-color);flex-shrink:0;">
                    <div style="flex:1;">
                        <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${opt.label}</div>
                        <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${opt.desc}</div>
                    </div>
                </label>
            `).join('')}
        </div>
        <div style="display:flex;gap:10px;">
            <button id="_aep_cancel" style="flex:1;padding:12px;border:1.5px solid var(--border-color);border-radius:13px;background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;font-family:var(--font-family);">取消</button>
            <button id="_aep_confirm" style="flex:2;padding:12px;border:none;border-radius:13px;background:var(--accent-color);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font-family);display:flex;align-items:center;justify-content:center;gap:8px;">
                ${ICONS.export} 导出
            </button>
        </div>
    `;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    panel.querySelector('#_aep_cancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    panel.querySelector('#_aep_confirm').onclick = () => {
        const selected = options.filter(opt => panel.querySelector('#' + opt.id)?.checked);
        if (!selected.length) { showNotification('请至少选择一项', 'warning'); return; }

        const libraryData = { exportDate: new Date().toISOString(), modules: [] };
        selected.forEach(opt => {
            if (opt.key === 'announcementText') {
                libraryData.announcementText = { titles: annCustomData.titles || [], notes: annCustomData.notes || [] };
                libraryData.modules.push('announcementText');
            } else if (opt.key === 'announcementStatusPool') {
                libraryData.announcementStatusPool = annStatusPool;
                libraryData.modules.push('announcementStatusPool');
            }
        });
        const fileName = `announcement-${libraryData.modules.join('+')}-${new Date().toISOString().slice(0,10)}.json`;
        exportDataToMobileOrPC(JSON.stringify(libraryData, null, 2), fileName);
        overlay.remove();
        showNotification(`✓ 已导出 ${selected.map(o => o.label).join('、')}`, 'success');
    };
}

function _parseFlexibleJSON(text) {
    try { return JSON.parse(text); } catch (_) {}
    let repaired = text
        .replace(/,\s*([}\]])/g, '$1')  
        .replace(/(["\d\w}])\s*\n\s*"/g, (m, p1) => { 
            if (p1 === '}' || p1 === ']') return m;
            return p1 + ',\n"';
        });
    try { return JSON.parse(repaired); } catch (_) {}
    repaired = text.replace(/("(?:[^"\\]|\\.)*")\s*\n(\s*")/g, '$1,\n$2')
                   .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(repaired);
}

function _normalizeImportData(data) {
    if (!data || typeof data !== 'object') return data;
    const knownKeys = ['customReplies','customPokes','customStatuses','customMottos','customIntros','customEmojis',
                       'customReplyGroups','customPokeGroups','customStatusGroups','disabledDefaultReplies',
                       'announcementConfig','announcementText','announcementStatusPool'];
    const hasNewFormat = knownKeys.some(k => data[k] !== undefined && data[k] !== null);
    if (hasNewFormat) return data;
    if (Array.isArray(data)) {
        return { customReplies: data };
    }
    return data;
}

function _showImportUI(data) {
    const knownFields = ['customReplies','customPokes','customStatuses','customMottos','customIntros','customEmojis',
                         'customReplyGroups','customPokeGroups','customStatusGroups',
                         'announcementConfig','announcementText','announcementStatusPool'];
    const hasValid = knownFields.some(f => data[f] !== undefined && data[f] !== null);
    if (!hasValid) { showNotification('无效的字卡备份文件', 'error'); return; }

    // 计算公告模块的 displayCount
    const _annCfg = data.announcementConfig;
    const _annText = data.announcementText;
    const _annPool = data.announcementStatusPool;
    const _annCfgCount = _annCfg
        ? ((_annCfg.customData?.titles||[]).length + (_annCfg.customData?.notes||[]).length + (_annCfg.statusPool||[]).length)
        : undefined;
    const _annTextCount = _annText ? ((_annText.titles||[]).length + (_annText.notes||[]).length) : undefined;
    const _annPoolCount = Array.isArray(_annPool) ? _annPool.length : undefined;

    const modules = [
        { id: '_ri_replies',  icon: ICONS.comment,   label: '主字卡',        data: data.customReplies,       key: 'customReplies' },
        { id: '_ri_pokes',    icon: ICONS.hand,      label: '拍一拍',        data: data.customPokes,         key: 'customPokes' },
        { id: '_ri_statuses', icon: ICONS.dot,       label: '对方状态',      data: data.customStatuses,      key: 'customStatuses' },
        { id: '_ri_mottos',   icon: ICONS.quote,     label: '顶部格言',      data: data.customMottos,        key: 'customMottos' },
        { id: '_ri_intros',   icon: ICONS.play,      label: '开场动画',      data: data.customIntros,        key: 'customIntros' },
        { id: '_ri_emojis',   icon: ICONS.smile,     label: 'Emoji 库',      data: data.customEmojis,        key: 'customEmojis' },
        { id: '_ri_ann',      icon: ICONS.folderBig, label: '今日公告配置',  data: [_annCfg],                key: 'announcementConfig',    displayCount: _annCfgCount },
        { id: '_ri_anntext',  icon: ICONS.comment,   label: '公告文案',      data: [_annText],               key: 'announcementText',      displayCount: _annTextCount },
        { id: '_ri_annpool',  icon: ICONS.dot,       label: '状态随机库',    data: _annPool,                 key: 'announcementStatusPool', displayCount: _annPoolCount },
        { id: '_ri_groups',   icon: ICONS.folderBig, label: '字卡分组',      data: data.customReplyGroups,   key: 'customReplyGroups',  extra: true },
        { id: '_ri_pokg',     icon: ICONS.folderBig, label: '拍一拍分组',    data: data.customPokeGroups,    key: 'customPokeGroups',   extra: true },
        { id: '_ri_statg',    icon: ICONS.folderBig, label: '对方状态分组',  data: data.customStatusGroups,  key: 'customStatusGroups', extra: true },
    ].filter(m => m.data !== undefined && m.data !== null && (Array.isArray(m.data) ? m.data.length > 0 && m.data[0] !== undefined : true));

    _showIOSheet(`导入字卡`, `文件中包含 ${modules.length} 个模块`, modules, ICONS.import, (selected, mode) => {
        if (!selected.length) { showNotification('请至少选择一项', 'error'); return; }
        try {
            const overwrite = mode === 'overwrite';
            let totalAdded = 0;
            if (overwrite) {
                selected.forEach(m => {
                    if (m.key === 'customReplies')         { customReplies               = data.customReplies;       totalAdded += data.customReplies.length; }
                    else if (m.key === 'customPokes')      { customPokes                 = data.customPokes;         totalAdded += data.customPokes.length; }
                    else if (m.key === 'customStatuses')   { customStatuses              = data.customStatuses;      totalAdded += data.customStatuses.length; }
                    else if (m.key === 'customMottos')     { customMottos                = data.customMottos;        totalAdded += data.customMottos.length; }
                    else if (m.key === 'customIntros')     { customIntros                = data.customIntros;        totalAdded += data.customIntros.length; }
                    else if (m.key === 'customEmojis')     { customEmojis                = data.customEmojis; }
                    else if (m.key === 'customReplyGroups')  { window.customReplyGroups  = data.customReplyGroups; }
                    else if (m.key === 'customPokeGroups')   { window.customPokeGroups   = data.customPokeGroups; }
                    else if (m.key === 'customStatusGroups') { window.customStatusGroups = data.customStatusGroups; }
                    else if (m.key === 'announcementConfig') {
                        if (_annCfg.customData) localStorage.setItem('dg_custom_data', JSON.stringify(_annCfg.customData));
                        if (_annCfg.statusPool) localStorage.setItem('dg_status_pool', JSON.stringify(_annCfg.statusPool));
                    }
                    else if (m.key === 'announcementText') {
                        let cur = {}; try { cur = JSON.parse(localStorage.getItem('dg_custom_data') || '{}'); } catch(e) {}
                        cur.titles = _annText.titles || []; cur.notes = _annText.notes || [];
                        localStorage.setItem('dg_custom_data', JSON.stringify(cur));
                    }
                    else if (m.key === 'announcementStatusPool') {
                        localStorage.setItem('dg_status_pool', JSON.stringify(_annPool));
                    }
                });
            } else {
                selected.forEach(m => {
                    if (m.key === 'customReplies') {
                        const before = customReplies.length;
                        customReplies = deduplicateContentArray([...customReplies, ...data.customReplies], CONSTANTS.REPLY_MESSAGES).result;
                        totalAdded += customReplies.length - before;
                    } else if (m.key === 'customPokes') {
                        const before = customPokes.length;
                        customPokes = deduplicateContentArray([...customPokes, ...data.customPokes]).result;
                        totalAdded += customPokes.length - before;
                    } else if (m.key === 'customStatuses') {
                        const before = customStatuses.length;
                        customStatuses = deduplicateContentArray([...customStatuses, ...data.customStatuses]).result;
                        totalAdded += customStatuses.length - before;
                    } else if (m.key === 'customMottos') {
                        const before = customMottos.length;
                        customMottos = deduplicateContentArray([...customMottos, ...data.customMottos]).result;
                        totalAdded += customMottos.length - before;
                    } else if (m.key === 'customIntros') {
                        const before = customIntros.length;
                        customIntros = deduplicateContentArray([...customIntros, ...data.customIntros]).result;
                        totalAdded += customIntros.length - before;
                    } else if (m.key === 'customEmojis') {
                        customEmojis = [...new Set([...customEmojis, ...data.customEmojis])];
                    } else if (m.key === 'customReplyGroups') {
                        if (!window.customReplyGroups) window.customReplyGroups = [];
                        data.customReplyGroups.forEach(dg => {
                            if (!customReplyGroups.find(g => g.name === dg.name)) customReplyGroups.push(dg);
                        });
                    } else if (m.key === 'customPokeGroups') {
                        if (!window.customPokeGroups) window.customPokeGroups = [];
                        data.customPokeGroups.forEach(dg => {
                            if (!window.customPokeGroups.find(g => g.name === dg.name)) window.customPokeGroups.push(dg);
                        });
                    } else if (m.key === 'customStatusGroups') {
                        if (!window.customStatusGroups) window.customStatusGroups = [];
                        data.customStatusGroups.forEach(dg => {
                            if (!window.customStatusGroups.find(g => g.name === dg.name)) window.customStatusGroups.push(dg);
                        });
                    } else if (m.key === 'announcementConfig') {
                        // 追加：合并 titles/notes，pool 去重追加
                        let cur = {}; try { cur = JSON.parse(localStorage.getItem('dg_custom_data') || '{}'); } catch(e) {}
                        if (_annCfg.customData) {
                            cur.titles = [...new Set([...(cur.titles||[]), ...(_annCfg.customData.titles||[])])];
                            cur.notes  = [...new Set([...(cur.notes||[]),  ...(_annCfg.customData.notes||[])])];
                            localStorage.setItem('dg_custom_data', JSON.stringify(cur));
                        }
                        if (_annCfg.statusPool) {
                            let pool = []; try { pool = JSON.parse(localStorage.getItem('dg_status_pool') || '[]'); } catch(e) {}
                            const existStatuses = new Set(pool.map(p => p.status));
                            _annCfg.statusPool.forEach(p => { if (!existStatuses.has(p.status)) pool.push(p); });
                            localStorage.setItem('dg_status_pool', JSON.stringify(pool));
                        }
                    } else if (m.key === 'announcementText') {
                        let cur = {}; try { cur = JSON.parse(localStorage.getItem('dg_custom_data') || '{}'); } catch(e) {}
                        cur.titles = [...new Set([...(cur.titles||[]), ...(_annText.titles||[])])];
                        cur.notes  = [...new Set([...(cur.notes||[]),  ...(_annText.notes||[])])];
                        localStorage.setItem('dg_custom_data', JSON.stringify(cur));
                    } else if (m.key === 'announcementStatusPool') {
                        let pool = []; try { pool = JSON.parse(localStorage.getItem('dg_status_pool') || '[]'); } catch(e) {}
                        const existStatuses = new Set(pool.map(p => p.status));
                        _annPool.forEach(p => { if (!existStatuses.has(p.status)) pool.push(p); });
                        localStorage.setItem('dg_status_pool', JSON.stringify(pool));
                    }
                });
            }
            throttledSaveData();
            if (typeof renderReplyLibrary === 'function') renderReplyLibrary();
            if (typeof window.renderAnnStatusPool === 'function') window.renderAnnStatusPool();
            showNotification(`✓ 导入成功（${overwrite ? '覆盖' : '追加'}）${totalAdded > 0 ? `，共 ${totalAdded} 条` : ''}`, 'success', 3000);
        } catch (err) {
            console.error('字卡导入失败:', err);
            showNotification('导入过程中发生错误：' + err.message, 'error');
        }
    }, true);
}

function _showIOSheet(title, subtitle, modules, icon, onConfirm, showMode = false) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);backdrop-filter:blur(10px);display:flex;align-items:flex-end;justify-content:center;animation:fadeIn 0.2s ease;';

    let modeVal = 'merge';

    overlay.innerHTML = `
        <style>
            @keyframes fadeIn { from{opacity:0} to{opacity:1} }
            @keyframes slideUpSheet { from{transform:translateY(100%)} to{transform:translateY(0)} }
            .io-module-row {
                display:flex;align-items:center;gap:12px;cursor:pointer;
                padding:12px 14px;border-radius:14px;background:var(--primary-bg);
                border:1.5px solid var(--border-color);transition:border-color 0.15s;
            }
            .io-icon-box {
                width:36px;height:36px;border-radius:10px;
                background:rgba(var(--accent-color-rgb,180,140,100),0.12);
                display:flex;align-items:center;justify-content:center;
                color:var(--accent-color);flex-shrink:0;
            }
            .io-toggle {
                width:42px;height:24px;border-radius:12px;background:var(--accent-color);
                position:relative;cursor:pointer;transition:background 0.2s;flex-shrink:0;
            }
            .io-toggle .knob {
                position:absolute;top:3px;left:3px;width:18px;height:18px;
                border-radius:50%;background:#fff;transition:transform 0.2s;
                transform:translateX(18px);box-shadow:0 1px 3px rgba(0,0,0,.2);
            }
            .io-toggle.off { background:var(--border-color); }
            .io-toggle.off .knob { transform:translateX(0); }
        </style>
        <div style="
            background:var(--secondary-bg);border-radius:24px 24px 0 0;
            width:100%;max-width:500px;padding:0 0 env(safe-area-inset-bottom,0);
            box-shadow:0 -10px 60px rgba(0,0,0,.3);
            animation:slideUpSheet 0.3s cubic-bezier(0.34,1.56,0.64,1);
            max-height:92vh;display:flex;flex-direction:column;
        ">
            <div style="width:36px;height:4px;border-radius:2px;background:var(--border-color);margin:12px auto 0;flex-shrink:0;"></div>
            <div style="padding:18px 22px 8px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
                <div>
                    <div style="font-size:16px;font-weight:700;color:var(--text-primary);display:flex;align-items:center;gap:8px;">
                        <span style="color:var(--accent-color);">${icon}</span> ${title}
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${subtitle}</div>
                </div>
                <button id="_io_close" style="background:var(--primary-bg);border:none;width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);">
                    ${ICONS.close}
                </button>
            </div>
            <div style="overflow-y:auto;padding:8px 22px;display:flex;flex-direction:column;gap:7px;flex:1;">
                ${modules.map(m => `
                    <div class="io-module-row">
                        <div class="io-icon-box">${m.icon}</div>
                        <div style="flex:1;">
                            <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${m.label}</div>
                            <div style="font-size:11px;color:var(--text-secondary);">${m.displayCount !== undefined ? m.displayCount : (m.data ? m.data.length : m.count)} 条${m.extra ? ' · 含分组结构' : ''}</div>
                        </div>
                        <div class="io-toggle" data-id="${m.id}"><div class="knob"></div></div>
                        <input type="checkbox" id="${m.id}" checked style="display:none;">
                    </div>
                `).join('')}
            </div>
            ${showMode ? `
            <div style="padding:8px 22px;flex-shrink:0;">
                <div style="display:flex;align-items:center;gap:8px;padding:11px 14px;border-radius:13px;background:var(--primary-bg);border:1.5px solid var(--border-color);">
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style="color:var(--accent-color);flex-shrink:0;"><path d="M7.5 1v9M4 6l3.5 3L11 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="2" y1="13" x2="13" y2="13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                    <span style="font-size:13px;color:var(--text-primary);flex:1;">导入方式</span>
                    <div style="display:flex;background:var(--secondary-bg);border-radius:8px;overflow:hidden;border:1px solid var(--border-color);">
                        <label style="display:flex;align-items:center;gap:4px;padding:5px 12px;cursor:pointer;font-size:12px;color:var(--text-primary);">
                            <input type="radio" name="_io_mode" id="_io_merge" value="merge" checked style="accent-color:var(--accent-color);"> 追加
                        </label>
                        <label style="display:flex;align-items:center;gap:4px;padding:5px 12px;cursor:pointer;font-size:12px;color:var(--text-primary);border-left:1px solid var(--border-color);">
                            <input type="radio" name="_io_mode" id="_io_overwrite" value="overwrite" style="accent-color:var(--accent-color);"> 覆盖
                        </label>
                    </div>
                </div>
            </div>` : ''}
            <div style="padding:10px 22px 22px;display:flex;gap:10px;flex-shrink:0;">
                <button id="_io_cancel" style="flex:1;padding:13px;border:1.5px solid var(--border-color);border-radius:14px;background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;font-family:var(--font-family);">取消</button>
                <button id="_io_confirm" style="flex:2;padding:13px;border:none;border-radius:14px;background:var(--accent-color);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font-family);display:flex;align-items:center;justify-content:center;gap:8px;">
                    <span style="color:#fff;">${icon}</span> 确认
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('.io-toggle').forEach(sw => {
        sw.onclick = () => {
            const cb = document.getElementById(sw.dataset.id);
            cb.checked = !cb.checked;
            sw.classList.toggle('off', !cb.checked);
        };
    });

    const close = () => { overlay.style.animation = 'fadeOut 0.15s ease forwards'; setTimeout(() => overlay.remove(), 150); };
    overlay.querySelector('#_io_close').onclick = close;
    overlay.querySelector('#_io_cancel').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#_io_confirm').onclick = () => {
        const selected = modules.filter(m => document.getElementById(m.id)?.checked);
        const mode = showMode ? (document.getElementById('_io_overwrite')?.checked ? 'overwrite' : 'merge') : 'export';
        close();
        onConfirm(selected, mode);
    };
}

function _makeOverlay() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;';
    return overlay;
}

function _showBatchAddDialog() {
    const ctx = _getGroupCtx();
    const groups = ctx.groups;
    const overlay = _makeOverlay();
    const panel = document.createElement('div');
    panel.style.cssText = `
        background:var(--secondary-bg);border-radius:22px;padding:24px;
        width:92%;max-width:420px;
        max-height:88vh;
        display:flex;flex-direction:column;
        box-shadow:0 24px 80px rgba(0,0,0,.45);
        animation:popIn 0.22s cubic-bezier(.34,1.56,.64,1);
    `;

    const hasGroups = groups && groups.length > 0;
    const groupPillsHTML = hasGroups ? `
        <button class="ba-grp-pill" data-gidx="-1" style="
            padding:5px 13px;border-radius:20px;font-size:12px;font-family:var(--font-family);cursor:pointer;
            border:1.5px solid var(--accent-color);background:var(--accent-color);color:#fff;font-weight:700;
            flex-shrink:0;transition:all .15s;
        ">不分组</button>
        ${groups.map((g, i) => `
        <button class="ba-grp-pill" data-gidx="${i}" style="
            padding:5px 13px;border-radius:20px;font-size:12px;font-family:var(--font-family);cursor:pointer;
            border:1.5px solid ${g.color}44;background:${g.color}18;color:${g.color};font-weight:600;
            flex-shrink:0;transition:all .15s;
        ">
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${g.color};margin-right:4px;vertical-align:middle;"></span>${g.name}
        </button>`).join('')}
    ` : '';

    panel.innerHTML = `
        <style>
            @keyframes popIn { from{opacity:0;transform:scale(.93)} to{opacity:1;transform:scale(1)} }
            @keyframes baGroupSlide { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        </style>
        <div style="flex-shrink:0;font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">批量添加${getCategoryName(currentSubTab)}</div>
        <div style="flex-shrink:0;font-size:12px;color:var(--text-secondary);margin-bottom:14px;line-height:1.6;">每行一条，自动去重</div>

        <div style="flex:1;overflow-y:auto;overflow-x:hidden;min-height:0;">
            <textarea id="batch-add-input" rows="10" placeholder="在此粘贴内容，每行一条…" style="
                width:100%;box-sizing:border-box;padding:12px 14px;
                border:1.5px solid var(--border-color);border-radius:13px;
                background:var(--primary-bg);color:var(--text-primary);
                font-size:13px;font-family:var(--font-family);outline:none;resize:vertical;
                line-height:1.6;transition:border 0.18s;
            "></textarea>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:6px;margin-bottom:12px;">
                <span id="batch-add-count">0 条</span>
            </div>

            ${hasGroups ? `
            <div id="ba-group-section" style="margin-bottom:4px;">
                <button id="ba-group-toggle" style="
                    display:flex;align-items:center;gap:7px;width:100%;
                    padding:9px 12px;border-radius:11px;cursor:pointer;
                    border:1.5px solid var(--border-color);background:var(--primary-bg);
                    color:var(--text-secondary);font-size:12px;font-family:var(--font-family);
                    font-weight:600;transition:all .15s;text-align:left;
                ">
                    <i class="fas fa-folder" style="font-size:12px;color:var(--accent-color);"></i>
                    <span id="ba-toggle-label">添加到分组</span>
                    <span id="ba-toggle-arrow" style="margin-left:auto;font-size:10px;transition:transform .2s;">▼</span>
                </button>
                <div id="ba-group-drawer" style="display:none;overflow-x:auto;overflow-y:hidden;padding:10px 2px 4px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">
                    <div id="ba-group-list" style="display:flex;gap:7px;width:max-content;">
                        ${groupPillsHTML}
                    </div>
                </div>
            </div>` : ''}
        </div>

        <div style="flex-shrink:0;padding-top:14px;display:flex;gap:10px;">
            <button id="ba-cancel" style="flex:1;padding:12px;border:1.5px solid var(--border-color);border-radius:13px;background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;font-family:var(--font-family);">取消</button>
            <button id="ba-confirm" style="flex:2;padding:12px;border:none;border-radius:13px;background:var(--accent-color);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font-family);">添加</button>
        </div>
    `;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const ta = panel.querySelector('#batch-add-input');
    const countEl = panel.querySelector('#batch-add-count');
    ta.addEventListener('input', () => {
        const lines = ta.value.split('\n').filter(l => l.trim());
        countEl.textContent = `${lines.length} 条`;
    });
    ta.addEventListener('focus', e => { e.target.style.borderColor = 'var(--accent-color)'; });
    ta.addEventListener('blur', e => { e.target.style.borderColor = 'var(--border-color)'; });

    const groupToggle = panel.querySelector('#ba-group-toggle');
    const groupDrawer = panel.querySelector('#ba-group-drawer');
    const toggleArrow = panel.querySelector('#ba-toggle-arrow');
    const toggleLabel = panel.querySelector('#ba-toggle-label');
    let _drawerOpen = false;
    if (groupToggle && groupDrawer) {
        groupToggle.addEventListener('click', () => {
            _drawerOpen = !_drawerOpen;
            if (_drawerOpen) {
                groupDrawer.style.display = 'block';
                groupDrawer.style.animation = 'baGroupSlide 0.18s ease forwards';
                toggleArrow.style.transform = 'rotate(180deg)';
                groupToggle.style.borderColor = 'var(--accent-color)';
                groupToggle.style.color = 'var(--text-primary)';
            } else {
                groupDrawer.style.display = 'none';
                toggleArrow.style.transform = '';
                groupToggle.style.borderColor = 'var(--border-color)';
                groupToggle.style.color = 'var(--text-secondary)';
            }
        });
    }

    let _selectedGroupIdx = -1; 
    const pillContainer = panel.querySelector('#ba-group-list');
    if (pillContainer) {
        pillContainer.addEventListener('click', e => {
            const pill = e.target.closest('.ba-grp-pill');
            if (!pill) return;
            _selectedGroupIdx = parseInt(pill.dataset.gidx);
            if (toggleLabel) {
                if (_selectedGroupIdx === -1) {
                    toggleLabel.textContent = '添加到分组';
                } else {
                    const g = groups[_selectedGroupIdx];
                    toggleLabel.textContent = g ? `分组：${g.name}` : '添加到分组';
                }
            }
            pillContainer.querySelectorAll('.ba-grp-pill').forEach((p, i) => {
                const gidx = parseInt(p.dataset.gidx);
                if (gidx === -1) {
                    const isActive = _selectedGroupIdx === -1;
                    p.style.background = isActive ? 'var(--accent-color)' : 'transparent';
                    p.style.color = isActive ? '#fff' : 'var(--text-secondary)';
                    p.style.borderColor = isActive ? 'var(--accent-color)' : 'var(--border-color)';
                } else {
                    const g = groups[gidx];
                    if (!g) return;
                    const isActive = _selectedGroupIdx === gidx;
                    p.style.background = isActive ? g.color : g.color + '18';
                    p.style.color = isActive ? '#fff' : g.color;
                    p.style.borderColor = isActive ? g.color : g.color + '44';
                }
            });
        });
    }

    panel.querySelector('#ba-cancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    panel.querySelector('#ba-confirm').onclick = () => {
        const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) { showNotification('请输入内容', 'warning'); return; }
        let added = 0, skipped = 0;
        const newItems = [];
        lines.forEach(val => {
            const norm = normalizeStringStrict(val);
            const isDup = currentSubTab === 'custom'
                ? (customReplies.some(r => normalizeStringStrict(r) === norm) || CONSTANTS.REPLY_MESSAGES.some(r => normalizeStringStrict(r) === norm))
                : currentSubTab === 'pokes'
                ? customPokes.some(r => normalizeStringStrict(r) === norm)
                : currentSubTab === 'statuses'
                ? customStatuses.some(r => normalizeStringStrict(r) === norm)
                : false;
            if (isDup) { skipped++; return; }
            if (currentSubTab === 'custom') { customReplies.push(val); newItems.push(val); }
            else if (currentSubTab === 'pokes') { customPokes.push(val); newItems.push(val); }
            else if (currentSubTab === 'statuses') { customStatuses.push(val); newItems.push(val); }
            else if (currentSubTab === 'mottos') customMottos.push(val);
            added++;
        });
        if (_selectedGroupIdx >= 0 && newItems.length > 0 && groups) {
            const targetGroup = groups[_selectedGroupIdx];
            if (targetGroup) {
                if (!targetGroup.items) targetGroup.items = [];
                newItems.forEach(item => {
                    if (!targetGroup.items.includes(item)) targetGroup.items.push(item);
                });
            }
        }
        throttledSaveData();
        overlay.remove();
        renderReplyLibrary();
        const groupHint = _selectedGroupIdx >= 0 && groups?.[_selectedGroupIdx]
            ? `，已加入「${groups[_selectedGroupIdx].name}」` : '';
        showNotification(`✓ 添加 ${added} 条${skipped ? `，跳过 ${skipped} 条重复` : ''}${groupHint}`, 'success');
    };
}

function initReplyLibraryListeners() {
    const entryBtn = document.getElementById('custom-replies-function');
    if (entryBtn) {
        entryBtn.addEventListener('click', () => {
            hideModal(DOMElements.advancedModal.modal);
            currentMajorTab = 'reply';
            currentSubTab = 'custom';
            _batchModeActive = false;
            _batchSelectedIndices.clear();
            _searchVisible = false;
            _searchQuery = '';
            _activeGroupFilter = null;
            // 确保公告面板隐藏、列表区域显示
            const annPanel = document.getElementById('announcement-panel');
            const listArea = document.getElementById('custom-replies-list');
            const subTabs  = document.getElementById('cr-sub-tabs');
            const addBtn2  = document.getElementById('add-custom-reply');
            const batchTb  = document.getElementById('batch-ops-toolbar');
            if (annPanel)  annPanel.style.display = 'none';
            if (listArea)  listArea.style.display = '';
            if (subTabs)   subTabs.style.display = '';
            if (addBtn2)   addBtn2.style.display = '';
            if (batchTb)   batchTb.style.display = '';
            document.querySelectorAll('.sidebar-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.major === 'reply');
            });
            renderReplyLibrary();
            showModal(DOMElements.customRepliesModal.modal);
        });
    }

    document.querySelectorAll('.sidebar-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMajorTab = btn.dataset.major;

            if (currentMajorTab === 'announcement') {
                // switchToAnnouncementPanel 内部已处理所有清理，这里不重复操作
                if (typeof window.switchToAnnouncementPanel === 'function') window.switchToAnnouncementPanel();
                return;
            }

            const listArea = document.getElementById('custom-replies-list');
            const annPanel = document.getElementById('announcement-panel');
            const crToolbar = document.getElementById('cr-toolbar');
            const subTabs = document.getElementById('cr-sub-tabs');
            const addBtn = document.getElementById('add-custom-reply');
            const titleEl = document.getElementById('cr-modal-title');
            if (listArea) listArea.style.display = '';
            if (annPanel) annPanel.style.display = 'none';
            if (crToolbar) crToolbar.style.display = '';
            if (subTabs) subTabs.style.display = '';
            if (addBtn) addBtn.style.display = '';
            if (titleEl) titleEl.textContent = '内容管理';

            _batchModeActive = false;
            _batchSelectedIndices.clear();
            _searchVisible = false;
            _searchQuery = '';
            _activeGroupFilter = null;
            currentSubTab = LIBRARY_CONFIG[currentMajorTab].tabs[0].id;
            renderReplyLibrary();
        });
    });

    document.addEventListener('click', e => {
        if (e.target.closest('#manage-groups-btn')) _showGroupManager();
    });

    const searchInput = document.getElementById('reply-search-input');
    if (searchInput) searchInput.addEventListener('input', (e) => {
        const val = e.target.value;
        clearTimeout(_searchDebounceTimer);
        _searchDebounceTimer = setTimeout(() => {
            _searchQuery = val;
            renderReplyLibrary();
        }, 400);
    });

    const dedupBtn = document.getElementById('dedup-replies-btn');
    if (dedupBtn) dedupBtn.addEventListener('click', _runDedup);

    const exportBtn = document.getElementById('export-replies-btn');
    if (exportBtn) exportBtn.addEventListener('click', _showExportUI);

    const importInput = document.getElementById('import-replies-input');
    if (importInput && !importInput._bound) {
        importInput._bound = true;
        importInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            e.target.value = '';
            if (file.size > 50 * 1024 * 1024) { showNotification('文件过大', 'error'); return; }
            const reader = new FileReader();
            reader.onload = ev => {
                let data;
                try {
                    data = _parseFlexibleJSON(ev.target.result);
                } catch {
                    showNotification('文件解析失败，请检查文件格式', 'error');
                    return;
                }
                data = _normalizeImportData(data);
                _showImportUI(data);
            };
            reader.onerror = () => showNotification('文件读取失败', 'error');
            reader.readAsText(file, 'UTF-8');
        });
    }

    const addBtn = document.getElementById('add-custom-reply');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            if (currentSubTab === 'stickers') {
                document.getElementById('sticker-file-input')?.click(); return;
            }
            if (currentSubTab === 'emojis') {
                const input = prompt('请输入要添加的 Emoji（支持组合表情）:');
                if (input?.trim()) {
                    customEmojis.push(input.trim());
                    throttledSaveData(); renderReplyLibrary();
                    showNotification('✓ Emoji 已添加', 'success');
                }
                return;
            }
            if (currentSubTab === 'custom' || currentSubTab === 'pokes' || currentSubTab === 'statuses') {
                _showBatchAddDialog(); return;
            }
            let input;
            if (currentSubTab === 'intros') {
                const l1 = prompt('请输入主标题 (如: 𝑳𝒐𝒗𝒆):');
                if (!l1) return;
                const l2 = prompt('请输入副标题 (如: 若要由我来谈论爱的话):');
                input = `${l1}|${l2}`;
            } else {
                input = prompt(`请输入新的${getCategoryName(currentSubTab)}:`);
            }
            if (input?.trim()) {
                const val = input.trim();
                const valNorm = normalizeStringStrict(val);
                let isDup = false;
                if (currentSubTab === 'pokes' && customPokes.some(r => normalizeStringStrict(r) === valNorm)) isDup = true;
                else if (currentSubTab === 'statuses' && customStatuses.some(r => normalizeStringStrict(r) === valNorm)) isDup = true;
                else if (currentSubTab === 'mottos' && customMottos.some(r => normalizeStringStrict(r) === valNorm)) isDup = true;
                else if (currentSubTab === 'intros' && customIntros.some(r => normalizeStringStrict(r) === valNorm)) isDup = true;
                if (isDup) { showNotification('该内容已存在', 'warning'); return; }
                if (currentSubTab === 'pokes') customPokes.unshift(val);
                else if (currentSubTab === 'statuses') customStatuses.unshift(val);
                else if (currentSubTab === 'mottos') customMottos.unshift(val);
                else if (currentSubTab === 'intros') customIntros.unshift(val);
                throttledSaveData(); renderReplyLibrary();
                showNotification('✓ 添加成功', 'success');
            }
        });
    }
}

function getCategoryName(tabId) {
    return { custom: '回复', pokes: '拍一拍', statuses: '状态', mottos: '格言', intros: '开场语' }[tabId] || '内容';
}

function updateTabUI() {
    document.querySelectorAll('.reply-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === currentReplyTab);
    });
    const si = document.getElementById('reply-search-input');
    if (si) si.value = '';
}

function initRippleFeedback() {
    const targets = ['.input-btn','.action-btn','.modal-btn','.settings-item','.batch-action-btn','.coin-btn-action','.import-export-btn','.reply-tab-btn','.anniversary-type-btn','.reply-tool-btn','.session-action-btn','.fav-action-btn'];
    document.addEventListener('mousedown', e => {
        const target = e.target.closest(targets.join(','));
        if (target) createRipple(e, target);
    });
    function createRipple(event, button) {
        if (!button.classList.contains('ripple-effect')) button.classList.add('ripple-effect');
        const circle = document.createElement('span');
        const diameter = Math.max(button.clientWidth, button.clientHeight);
        const radius = diameter / 2;
        const rect = button.getBoundingClientRect();
        const cx = event.clientX || (event.touches ? event.touches[0].clientX : 0);
        const cy = event.clientY || (event.touches ? event.touches[0].clientY : 0);
        circle.style.cssText = `width:${diameter}px;height:${diameter}px;left:${cx-rect.left-radius}px;top:${cy-rect.top-radius}px;`;
        circle.classList.add('ripple-wave');
        button.getElementsByClassName('ripple-wave')[0]?.remove();
        button.appendChild(circle);
        setTimeout(() => circle.remove(), 600);
    }
}

function applyAvatarFrame(avatarContainer, frameSettings) {
    let frameElement = avatarContainer.querySelector('.avatar-frame');
    if (frameSettings?.src) {
        if (!frameElement) {
            frameElement = document.createElement('img');
            frameElement.className = 'avatar-frame';
            avatarContainer.appendChild(frameElement);
        }
        frameElement.src = frameSettings.src;
        frameElement.style.width = `${frameSettings.size || 100}%`;
        frameElement.style.height = `${frameSettings.size || 100}%`;
        frameElement.style.transform = `translate(calc(-50% + ${frameSettings.offsetX || 0}px), calc(-50% + ${frameSettings.offsetY || 0}px))`;
        avatarContainer.style.setProperty('overflow', 'visible', 'important');
    } else {
        frameElement?.remove();
        avatarContainer.style.removeProperty('overflow');
    }
}

function setupAvatarFrameSettings() {
    const setupControlsFor = (type) => {
        const preview = document.getElementById(`${type}-frame-preview-2`);
        const uploadBtn = document.getElementById(`${type}-frame-upload-btn-2`);
        const removeBtn = document.getElementById(`${type}-frame-remove-btn-2`);
        const fileInput = document.getElementById(`${type}-frame-file-input-2`);
        const sizeSlider = document.getElementById(`${type}-frame-size-2`);
        const sizeValue = document.getElementById(`${type}-frame-size-value-2`);
        const xSlider = document.getElementById(`${type}-frame-offset-x-2`);
        const xValue = document.getElementById(`${type}-frame-offset-x-value-2`);
        const ySlider = document.getElementById(`${type}-frame-offset-y-2`);
        const yValue = document.getElementById(`${type}-frame-offset-y-value-2`);
        if (!preview || !uploadBtn || !sizeSlider) return;
        const settingsKey = type === 'my' ? 'myAvatarFrame' : 'partnerAvatarFrame';
        const avatarContainer = type === 'my' ? DOMElements.me.avatarContainer : DOMElements.partner.avatarContainer;
        const avatarElement = type === 'my' ? DOMElements.me.avatar : DOMElements.partner.avatar;
        const updatePreview = () => {
            const bgLayer = preview.querySelector('.preview-bg-layer');
            const avatarImg = avatarElement ? avatarElement.querySelector('img') : null;
            if (bgLayer) {
                if (avatarImg && avatarImg.src && !avatarImg.src.endsWith('#') && avatarImg.src !== window.location.href) {
                    bgLayer.innerHTML = `<img src="${avatarImg.src}" alt="avatar">`;
                } else {
                    bgLayer.innerHTML = `<i class="fas fa-user"></i>`;
                }
            }
            let oldFrame = preview.querySelector('.preview-frame');
            if (oldFrame) oldFrame.remove();
            const frameSettings = settings[settingsKey];
            if (frameSettings?.src) {
                const { size = 100, offsetX = 0, offsetY = 0 } = frameSettings;
                const frameImg = document.createElement('img');
                frameImg.src = frameSettings.src;
                frameImg.className = 'preview-frame';
                frameImg.style.cssText = `width:${size}%;height:${size}%;transform:translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px));`;
                preview.appendChild(frameImg);
            }
        };
        const updateControls = () => {
            const frame = settings[settingsKey];
            sizeSlider.value = frame?.size || 100;
            sizeValue.textContent = `${sizeSlider.value}%`;
            xSlider.value = frame?.offsetX || 0;
            xValue.textContent = `${xSlider.value}px`;
            ySlider.value = frame?.offsetY || 0;
            yValue.textContent = `${ySlider.value}px`;
            updatePreview();
        };
        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 1024 * 1024) { showNotification('头像框图片大小不能超过1MB', 'error'); return; }
            const reader = new FileReader();
            reader.onload = ev => {
                if (!settings[settingsKey]) settings[settingsKey] = { size: 100, offsetX: 0, offsetY: 0 };
                settings[settingsKey].src = ev.target.result;
                applyAvatarFrame(avatarContainer, settings[settingsKey]);
                updateControls(); throttledSaveData();
            };
            reader.readAsDataURL(file);
        });

        const urlBtn = document.getElementById(`${type}-frame-url-btn-2`);
        if (urlBtn) {
            urlBtn.addEventListener('click', () => {
                const url = prompt('请输入头像框图片的URL地址（支持 png/webp/gif）:');
                if (!url?.trim()) return;
                const trimmed = url.trim();
                const img = new Image();
                img.onload = () => {
                    if (!settings[settingsKey]) settings[settingsKey] = { size: 100, offsetX: 0, offsetY: 0 };
                    settings[settingsKey].src = trimmed;
                    applyAvatarFrame(avatarContainer, settings[settingsKey]);
                    updateControls(); throttledSaveData();
                    showNotification('✓ 头像框已通过URL加载', 'success');
                };
                img.onerror = () => showNotification('URL无法加载图片，请检查链接', 'error');
                img.src = trimmed;
            });
        }
        removeBtn.addEventListener('click', () => {
            settings[settingsKey] = null;
            applyAvatarFrame(avatarContainer, null);
            updateControls(); throttledSaveData();
        });
        [sizeSlider, xSlider, ySlider].forEach(slider => {
            slider.addEventListener('input', () => {
                if (!settings[settingsKey]) return;
                settings[settingsKey].size = parseInt(sizeSlider.value);
                settings[settingsKey].offsetX = parseInt(xSlider.value);
                settings[settingsKey].offsetY = parseInt(ySlider.value);
                applyAvatarFrame(avatarContainer, settings[settingsKey]);
                updateControls();
                if (typeof renderMessages === 'function') renderMessages(true);
            });
            slider.addEventListener('change', throttledSaveData);
        });
        updateControls();
    };
    setupControlsFor('my');
    setupControlsFor('partner');
}

function applyAllAvatarFrames() {
    applyAvatarFrame(DOMElements.me.avatarContainer, settings.myAvatarFrame);
    applyAvatarFrame(DOMElements.partner.avatarContainer, settings.partnerAvatarFrame);
    if (typeof applyAvatarShapeToDOM === 'function') {
        applyAvatarShapeToDOM('my', settings.myAvatarShape || 'circle');
        applyAvatarShapeToDOM('partner', settings.partnerAvatarShape || 'circle');
    }
    if (settings.avatarCornerRadius) {
        document.documentElement.style.setProperty('--avatar-corner-radius', settings.avatarCornerRadius + 'px');
    }
}
