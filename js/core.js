/*核心应用逻辑：数据加载保存、消息渲染、会话管理等*/

var _escapeHtml = function(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

// 桌面挂件"自定义问候/状态池"键按对象命名空间取的公共助手（与 features.js 共用同一 window.dgKey）
window.dgKey = window.dgKey || function(base) {
    return (typeof window.appSessionKey === 'function') ? window.appSessionKey(base) : ((window.APP_PREFIX || 'CHAT_APP_V3_') + base);
};

// 梦角回复消息的多监听通道（跟 window._onPartnerMessage 单函数钩子并行，互不覆盖）
// 需要监听"梦角发了消息"这个事件的新模块，用 window._registerPartnerMessageListener(fn) 注册，
// 不要直接赋值 window._onPartnerMessage，那个是给旧模块（陪伴模块）用的，赋值会覆盖掉它。
window._partnerMessageListeners = window._partnerMessageListeners || [];
window._registerPartnerMessageListener = window._registerPartnerMessageListener || function (fn) {
    if (typeof fn === 'function') window._partnerMessageListeners.push(fn);
};

        function clearAllAppData() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';
    overlay.innerHTML = `
        <div style="background:var(--secondary-bg);border-radius:20px;padding:24px;width:88%;max-width:340px;box-shadow:0 20px 60px rgba(0,0,0,0.4);animation:modalContentSlideIn 0.3s ease forwards;">
            <div style="text-align:center;margin-bottom:20px;">
                <div style="width:52px;height:52px;border-radius:50%;background:rgba(255,80,80,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
                    <i class="fas fa-trash-alt" style="color:#ff5050;font-size:20px;"></i>
                </div>
                <div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">重置数据</div>
                <div style="font-size:12px;color:var(--text-secondary);">请选择要重置的范围</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;">
                <button id="_reset_current" style="width:100%;padding:12px 16px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);color:var(--text-primary);font-size:13px;font-weight:600;cursor:pointer;text-align:left;display:flex;align-items:center;gap:10px;transition:all 0.2s;">
                    <i class="fas fa-comment-slash" style="color:var(--accent-color);font-size:15px;width:18px;text-align:center;"></i>
                    <span>仅清除当前会话消息</span>
                </button>
                <button id="_reset_all" style="width:100%;padding:12px 16px;border:1px solid rgba(255,80,80,0.3);border-radius:12px;background:rgba(255,80,80,0.06);color:#ff5050;font-size:13px;font-weight:600;cursor:pointer;text-align:left;display:flex;align-items:center;gap:10px;transition:all 0.2s;">
                    <i class="fas fa-bomb" style="font-size:15px;width:18px;text-align:center;"></i>
                    <span>重置所有数据（完全清空）</span>
                </button>
                <button id="_reset_cancel" style="width:100%;padding:10px 16px;border:none;border-radius:12px;background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;transition:all 0.2s;">取消</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    function closeDialog() { overlay.remove(); }
    overlay.addEventListener('click', e => { if (e.target === overlay) closeDialog(); });
    const _resetCancelBtn = document.getElementById('_reset_cancel');
    const _resetCurrentBtn = document.getElementById('_reset_current');
    const _resetAllBtn = document.getElementById('_reset_all');

    if (_resetCancelBtn) _resetCancelBtn.onclick = closeDialog;

    if (_resetCurrentBtn) _resetCurrentBtn.onclick = () => {
        closeDialog();
        if (confirm('确定要清除当前会话的所有消息吗？此操作无法恢复！')) {
            messages = [];
            window.messages = messages; // 双保险：同步 window 属性
            displayedMessageCount = HISTORY_BATCH_SIZE;
            msgViewMode = 'latest'; // 清空消息了，历史浏览模式的窗口下标肯定全部失效，一并重置
            newMsgCountWhileBrowsing = 0;
            if (typeof window._updateBackToLatestBtn === 'function') window._updateBackToLatestBtn();

            // 立即清除 localStorage 备份，防止 _tryRecoverFromBackup 在 IndexedDB 写入前恢复旧消息
            try { localStorage.removeItem('BACKUP_V1_critical'); } catch(e) {}
            try { localStorage.removeItem('BACKUP_V1_timestamp'); } catch(e) {}

            // 直接写入 IndexedDB（跳过 500ms 防抖），确保刷新后不恢复
            localforage.setItem(getStorageKey('chatMessages'), []).catch(() => {});

            renderMessages();
            showNotification('当前会话消息已清除', 'success');
        }
    };

    if (_resetAllBtn) _resetAllBtn.onclick = () => {
        closeDialog();
        if (confirm('【高危操作】确定要重置所有数据吗？此操作将清除所有本地数据且无法恢复！')) {
            window._skipBackup = true;
            messages = [];
            settings = {};
            localforage.clear().then(() => {
                localStorage.clear();
                showNotification('所有数据已重置，页面即将刷新', 'info', 2000);
                setTimeout(() => { window.location.href = window.location.pathname + '?reset=' + Date.now(); }, 2000);
            }).catch(e => {
                window._skipBackup = false;
                showNotification('清除数据时发生错误', 'error');
                console.error("清除 localforage 失败:", e);
            });
        }
    };
}

// 把 messages[startIdx, endIdxExclusive) 这一批更早的消息，直接插到聊天区域最上面——
// 不清空、不重画已经显示着的内容，所以不会有"整个区域先藏起来再露出来"那种白屏闪烁
function _prependOlderMessages(startIdx, endIdxExclusive) {
    const container = DOMElements.chatContainer;
    const batch = messages.slice(startIdx, endIdxExclusive);
    if (!batch.length || !container) return;

    const fragment = new DocumentFragment();
    let lastSenderRef = { current: null };
    batch.forEach((msg, i) => {
        const globalIdx = startIdx + i;
        const prevMsg = globalIdx > 0 ? messages[globalIdx - 1] : null;
        const nextMsg = messages[globalIdx + 1] || null; // 批次内的下一条，或者已经渲染在下面的那一条，都能正确取到
        const msgFragment = createMessageFragment(msg, prevMsg, nextMsg, lastSenderRef);
        fragment.appendChild(msgFragment);
    });

    // 最上面固定有一个用来撑高度的占位div（spacer），新内容要插在它后面、原有消息前面
    const spacer = container.querySelector('div[style*="flex: 1"]');
    const insertBeforeNode = spacer ? spacer.nextSibling : container.firstChild;

    // 聊天框本身开着"平滑滚动"效果（CSS scroll-behavior: smooth），这跟"瞬间精确挪到某个位置"是冲突的——
    // 不临时关掉的话，下面这行补偿滚动条位置的操作会被浏览器理解成"慢慢滑过去"，
    // 读到的中间值就会不准，视觉上也会变成"先加载、又滑到别的地方"，这正是这次要修的问题
    const prevScrollBehavior = container.style.scrollBehavior;
    container.style.scrollBehavior = 'auto';

    const oldScrollHeight = container.scrollHeight;
    if (insertBeforeNode) {
        container.insertBefore(fragment, insertBeforeNode);
    } else {
        container.appendChild(fragment);
    }
    // 上面新插入了这么多高度，滚动条也跟着往下挪同样的距离，视觉上就像"没有动过"，用户能无缝接着往上看
    const newScrollHeight = container.scrollHeight;
    container.scrollTop += (newScrollHeight - oldScrollHeight);

    container.style.scrollBehavior = prevScrollBehavior || '';
}

// 把 messages[startIdx, endIdxExclusive) 这一批更晚的消息，直接接在聊天区域最下面——
// 同样不清空重画，往下追加不会影响当前已经看到的内容和滚动位置，不需要额外补偿滚动条
function _appendNewerMessages(startIdx, endIdxExclusive) {
    const container = DOMElements.chatContainer;
    const batch = messages.slice(startIdx, endIdxExclusive);
    if (!batch.length || !container) return;

    const fragment = new DocumentFragment();
    // lastSenderRef 要先接上"当前已经渲染的最后一条是谁发的"，不然本来该合并显示的头像/时间会重复冒出来
    let lastSenderRef = { current: null };
    if (startIdx > 0 && messages.length >= startIdx) {
        const lastRenderedMsg = messages[startIdx - 1];
        if (lastRenderedMsg) {
            lastSenderRef.current = lastRenderedMsg.sender;
        }
    }
    batch.forEach((msg, i) => {
        const globalIdx = startIdx + i;
        const prevMsg = globalIdx > 0 ? messages[globalIdx - 1] : null;
        const nextMsg = messages[globalIdx + 1] || null;
        const msgFragment = createMessageFragment(msg, prevMsg, nextMsg, lastSenderRef);
        fragment.appendChild(msgFragment);
    });

    container.appendChild(fragment);
}

// ═══════════════════════════════════════════════════════════════════
// 虚拟滚动：把"历史浏览窗口"里落在视野远端的消息从 DOM 里回收掉
// 之前窗口模式卡顿的根源，是翻页时只往一个方向加、从不往回收，DOM 里的消息越攒越多。
// 下面这组函数负责对称回收，让渲染量始终恒定，不管聊天记录有多长。
// ═══════════════════════════════════════════════════════════════════

// 虚拟滚动窗口大小：按当前视口高度估算"一屏大概几条消息"，上下再各留约一屏缓冲。
// 用这个值控制窗口渲染量，保证 DOM 里的消息条数近似恒定。
function _getVirtualWindowSize() {
    const container = DOMElements && DOMElements.chatContainer;
    if (!container || !container.clientHeight) return 80;
    const visiblePerScreen = Math.max(8, Math.ceil(container.clientHeight / 72));
    return Math.min(160, Math.max(56, visiblePerScreen * 3));
}

// 从当前 DOM 里实际渲染的第一条/最后一条消息，反推出窗口边界，
// 保证 msgWinStart/msgWinEnd 跟 DOM 状态一致（避免系统消息等特殊节点导致计数对不上）。
function _syncWindowFromDOM() {
    const container = DOMElements && DOMElements.chatContainer;
    if (!container) return;
    const els = container.querySelectorAll('.message-wrapper[data-msg-id]');
    if (!els.length) return;
    const firstId = String(els[0].getAttribute('data-msg-id'));
    const lastId = String(els[els.length - 1].getAttribute('data-msg-id'));
    for (let i = 0; i < messages.length; i++) {
        const id = String(messages[i].id);
        if (id === firstId) msgWinStart = i;
        if (id === lastId) msgWinEnd = i + 1;
    }
}

// 往更早的历史翻（窗口往上扩）时，把窗口最下面（较新的）一部分消息从 DOM 里摘掉。
// 摘的是视野下方的内容，对用户当前看到的画面没有影响，所以不用补偿滚动条。
function _trimWindowBottom() {
    const container = DOMElements && DOMElements.chatContainer;
    if (!container) return;
    const maxLen = _getVirtualWindowSize();
    const wrappers = container.querySelectorAll('.message-wrapper');
    const removeCount = wrappers.length - maxLen;
    if (removeCount <= 0) return;
    for (let i = 0; i < removeCount; i++) {
        const w = wrappers[wrappers.length - 1 - i];
        if (w && w.parentNode) w.parentNode.removeChild(w);
    }
    _syncWindowFromDOM();
}

// 对称地：往更晚的消息翻（窗口往下扩）时，把窗口最上面（较旧的）消息从 DOM 里摘掉。
// 删掉的是视野上方的内容，内容变矮会让滚动条往下塌，必须同步减 scrollTop 才能保持画面不动。
function _trimWindowTop() {
    const container = DOMElements && DOMElements.chatContainer;
    if (!container) return;
    const maxLen = _getVirtualWindowSize();
    const wrappers = container.querySelectorAll('.message-wrapper');
    const removeCount = wrappers.length - maxLen;
    if (removeCount <= 0) return;
    let removedHeight = 0;
    for (let i = 0; i < removeCount; i++) {
        const w = wrappers[i];
        if (!w || !w.parentNode) break;
        removedHeight += w.offsetHeight;
        w.parentNode.removeChild(w);
    }
    _syncWindowFromDOM();
    if (removedHeight > 0) {
        const prevBehavior = container.style.scrollBehavior;
        container.style.scrollBehavior = 'auto';
        container.scrollTop = Math.max(0, container.scrollTop - removedHeight);
        container.style.scrollBehavior = prevBehavior || '';
    }
}

// latest（正常）模式：不再回收顶部旧消息 DOM。
// 之前依赖"回收顶部 DOM + 数据窗口计数"来维持渲染量恒定，但回收时序会与向上翻页
// （loadMoreHistory 向顶部追加更早消息）发生交错，导致窗口错位——表现为历史
// "翻几次就翻不动 / 滚动乱跳 / 漏段只剩特殊消息"。
// 为保证完整聊天记录能连续、不乱、不漏地一直向上翻到底，最新模式改为纯数据驱动：
// 只向顶部追加，不做任何 DOM 回收。（window 历史浏览模式的 _trimWindowTop 等保持不变）
function _trimLatestModeTop() {
    return;
}

function loadMoreHistory() {
    const historyLoader = document.getElementById('history-loader');
    const container = DOMElements && DOMElements.chatContainer;
    const currentOldestMsgIndex = msgViewMode === 'window' ? msgWinStart : (messages.length - displayedMessageCount);

    if (!container) return;
    if (isLoadingHistory) return;

    if (currentOldestMsgIndex <= 0) {
        if (historyLoader) historyLoader.style.display = 'none';
        return;
    }

    isLoadingHistory = true;
    if (historyLoader) historyLoader.style.display = 'flex';

    // 消息本来就已经在内存里了，不是要发网络请求，这里保留一点延迟纯粹是为了让转圈动效能被看清楚、
    // 感觉更像"正在加载"，不会显得太突兀。真正的DOM操作只插入新增的这一批，不会有白屏闪烁。
    setTimeout(() => {
        const oldStart = msgViewMode === 'window' ? msgWinStart : Math.max(0, messages.length - displayedMessageCount);
        let newStart;
        if (msgViewMode === 'window') {
            msgWinStart = Math.max(0, msgWinStart - HISTORY_BATCH_SIZE);
            newStart = msgWinStart;
        } else {
            displayedMessageCount = Math.min(messages.length, displayedMessageCount + HISTORY_BATCH_SIZE);
            newStart = Math.max(0, messages.length - displayedMessageCount);
        }

        _prependOlderMessages(newStart, oldStart);

        // 虚拟滚动：窗口往上扩了一截，就把最下面（较新的）一部分从 DOM 里摘掉，
        // 保证窗口模式的渲染量恒定，不会因为一直翻历史就越攒越多、越来越卡
        // （latest 模式的回收放在滚动事件里做：用户刚加载完还贴在顶部，此时不能回收，
        //   等视口离开顶部后再由 _trimLatestModeTop 处理）
        if (msgViewMode === 'window') _trimWindowBottom();

        const stillHasMore = msgViewMode === 'window' ? msgWinStart > 0 : (messages.length > displayedMessageCount);
        if (historyLoader) {
            historyLoader.style.display = stillHasMore ? 'flex' : 'none';
        }
        isLoadingHistory = false;
    }, 120);
}

// 往下翻，加载更晚的消息——跟 loadMoreHistory 对称，只在 window（历史浏览）模式下会用到，
// 正常的 latest 模式本来就已经渲染到最新消息了，没有"更晚"可以加载
function loadMoreFuture() {
    const futureLoader = document.getElementById('future-loader');
    const container = DOMElements && DOMElements.chatContainer;
    if (!container) return;
    if (msgViewMode !== 'window') return;
    if (isLoadingFuture) return;

    if (msgWinEnd >= messages.length) {
        if (futureLoader) futureLoader.style.display = 'none';
        return;
    }

    isLoadingFuture = true;
    if (futureLoader) futureLoader.style.display = 'flex';

    setTimeout(() => {
        const oldEnd = msgWinEnd;
        msgWinEnd = Math.min(messages.length, msgWinEnd + HISTORY_BATCH_SIZE);

        // 如果这一下已经追到最新消息了，直接切回正常模式，体验上等同于"回到最新"——
        // 这是一次性的模式切换，不是重复的翻页动作，用一次完整渲染没问题
        if (msgWinEnd >= messages.length) {
            window._backToLatestMessages();
            isLoadingFuture = false;
            return;
        }

        _appendNewerMessages(oldEnd, msgWinEnd);

        // 虚拟滚动：窗口往下扩了一截，就把最上面（较旧的）一部分从 DOM 里摘掉，
        // 渲染量保持恒定，长记录历史也能顺滑地一直往下翻
        if (msgViewMode === 'window') _trimWindowTop();

        if (futureLoader) {
            futureLoader.style.display = (msgWinEnd < messages.length) ? 'flex' : 'none';
        }
        isLoadingFuture = false;
    }, 120);
}


        function getDefaultSettings() {
            return {
                partnerName: "梦角",
                myName: "我",
                myStatus: "在线",
                partnerStatus: "在线",
                isDarkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
                colorTheme: "gold",
                soundEnabled: true,
                typingIndicatorEnabled: true,
                readReceiptsEnabled: true,
                replyEnabled: true,
                lastStatusChange: Date.now(),
                nextStatusChange: 1 + Math.random() * 7,
                fontSize: 16,
                bubbleStyle: 'standard',
                messageFontFamily: "'Noto Serif SC', serif",
                messageFontWeight: 400,
                messageLineHeight: 1.5,
                musicPlayerEnabled: false,
                replyDelayMin: 3000,
                replyDelayMax: 7000,
                askDelayMin: 10000,
                askDelayMax: 60000,
                inChatAvatarEnabled: true,
                inChatAvatarSize: 36,
                inChatAvatarPosition: 'center',
                alwaysShowAvatar: false,
                showPartnerNameInChat: false,
                customFontUrl: "", 
        customBubbleCss: "",
        customGlobalCss: "",
                myAvatarFrame: null, 
                partnerAvatarFrame: null,
                myAvatarShape: 'circle',
                partnerAvatarShape: 'circle',
autoSendEnabled: false,
autoSendInterval: 5,
        allowReadNoReply: false, 
        readNoReplyChance: 0.2,
        combineReplyCards: false,
        combineReplyMaxCards: 3,
        timeFormat: 'HH:mm',
        customSoundUrl: '',
        // 音效：两方分别可选（若对应 URL 为空则使用内置预设）
        mySendSoundPreset: 'tone_low',
        mySendCustomSoundUrl: '',
        partnerMessageSoundPreset: 'tone_low',
        partnerMessageCustomSoundUrl: '',
        myPokeSoundPreset: 'tone_low',
        myPokeCustomSoundUrl: '',
        partnerPokeSoundPreset: 'tone_low',
        partnerPokeCustomSoundUrl: '',
        soundVolume: 0.15,
        bottomCollapseMode: false,
        emojiMixEnabled: true,
        partnerRecallEnabled: true,
        partnerHangupEnabled: true,
        partnerRedpacketEnabled: true,
        // 自定义红包封面（dataURL 或 null；null 用内置浅米灰渐变）
        // card=购物卡片主区 / open=打开红包弹窗主区 各自独立，再按 我的/梦角 拆开
        redpacketCardMyCover: null,
        redpacketCardPartnerCover: null,
        redpacketOpenMyCover: null,
        redpacketOpenPartnerCover: null
            };
        }


        function renderBackgroundGallery() {
            const list = document.getElementById('background-gallery-list');
            if (!list) return;

            list.innerHTML = '';

            
            const addBtn = document.createElement('div');
            addBtn.className = 'bg-item bg-add-btn';
            
            addBtn.innerHTML = '<i class="fas fa-plus"></i><span></span>';
            addBtn.onclick = () => document.getElementById('bg-gallery-input').click();
            list.appendChild(addBtn);

            const currentBg = safeGetItem(getStorageKey('chatBackground'));

            savedBackgrounds.forEach((bg, index) => {
                const item = document.createElement('div');
                let isActive = false;

                if (currentBg) {
                    if (currentBg === bg.value) {
                        // 本地 base64 完全匹配
                        isActive = true;
                    } else if (typeof currentBg === 'string' && currentBg.indexOf('oss://') === 0) {
                        // 换设备恢复后 currentBg 是 oss:// 引用，跟 cloudUrl 比较
                        isActive = bg.cloudUrl === currentBg;
                    }
                }

                item.className = `bg-item ${isActive ? 'active': ''}`;

                if (bg.type === 'image' || bg.type === 'gif') {
                    // 图库预览：优先用缩略图（省内存），没有缩略图才用本地 base64
                    // cloudUrl 存云端备份引用，但图库预览不走云端
                    const displaySrc = bg.thumbnail || bg.value;
                    item.innerHTML = `<img src="${displaySrc}" loading="lazy" alt="bg">`;
                } else {
                    item.innerHTML = `<div class="bg-color-block" style="background: ${bg.value}"></div>`;
                }

                item.onclick = async (e) => {
                    if (e.target.closest('.bg-delete-btn')) return;
                    await applyBackground(bg.value);
                    safeSetItem(getStorageKey('chatBackground'), bg.value);
                    localforage.setItem(getStorageKey('chatBackground'), bg.value);
                    renderBackgroundGallery();
                    showNotification('背景已切换', 'success');
                };

                if (bg.id.startsWith('user-')) {
                    const delBtn = document.createElement('div');
                    delBtn.className = 'bg-delete-btn';
                    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
                    delBtn.title = "删除此背景";
                    delBtn.onclick = async (e) => {
                        e.stopPropagation();
                        if (confirm('确定删除这张背景图吗？')) {
                            // 阶段三B：如果有云端引用，先删云端对象（失败不阻塞本地删除）
                            if (window.CloudMedia && bg) {
                                const refToDelete = bg.cloudKey || (typeof bg.value === 'string' && bg.value.indexOf('oss://') === 0 ? bg.value : null);
                                if (refToDelete) {
                                    try {
                                        await window.CloudMedia.delete(refToDelete);
                                    } catch (err) {
                                        console.warn('[cloud-media] 云端删除失败', err);
                                    }
                                }
                            }
                            savedBackgrounds.splice(index, 1);
                            saveBackgroundGallery();

                            if (isActive) {
                                removeBackground(); 
                                renderBackgroundGallery();
                            } else {
                                renderBackgroundGallery();
                            }
                        }
                    };
                    item.appendChild(delBtn);
                }

                list.appendChild(item);
            });
        }



        function saveBackgroundGallery() {
    localforage.setItem(getStorageKey('backgroundGallery'), savedBackgrounds);
}


        const applyBackground = async (value) => {
            if (!value || typeof value !== 'string') return;
            try {
                // 聊天页背景本地存全尺寸 base64，直接应用，零延迟
                // oss:// 引用只会在换设备恢复时临时出现（旧数据迁移过渡期），兜底处理
                if (value.indexOf('oss://') === 0) {
                    // 兜底：找本地 gallery 里有没有对应的 cloudUrl，有就用本地 base64
                    const localItem = Array.isArray(savedBackgrounds)
                        ? savedBackgrounds.find(function (bg) { return bg && (bg.cloudUrl === value || bg.value === value); })
                        : null;
                    if (localItem && localItem.value && localItem.value.indexOf('data:image') === 0) {
                        // 本地有，直接用
                        const cssValue = `url(${localItem.value})`;
                        document.documentElement.style.setProperty('--chat-bg-image', cssValue);
                        document.body.classList.add('with-background');
                        return;
                    }
                    // 本地没有（换设备恢复后的旧数据）：才走云端下载，缩略图先垫底
                    if (window.CloudMedia) {
                        if (localItem && localItem.thumbnail) {
                            document.documentElement.style.setProperty('--chat-bg-image', `url(${localItem.thumbnail})`);
                            document.body.classList.add('with-background');
                        }
                        window.CloudMedia.fetchUrl(value).then(function (blobUrl) {
                            document.documentElement.style.setProperty('--chat-bg-image', `url(${blobUrl})`);
                            document.body.classList.add('with-background');
                        }).catch(function (e) {
                            console.warn('[cloud-media] 加载云端背景失败', e);
                        });
                    }
                    return;
                }
                if (value.startsWith('linear-gradient') || value.startsWith('#') || value.startsWith('rgb')) {
                    document.documentElement.style.setProperty('--chat-bg-image', value);
                } else {
                    const cssValue = value.startsWith('url(') ? value : `url(${value})`;
                    document.documentElement.style.setProperty('--chat-bg-image', cssValue);
                }
                document.body.classList.add('with-background');
            } catch (e) {
                if (typeof removeBackground === 'function') removeBackground();
            }
        };


const loadData = async () => {
    try {
        settings = getDefaultSettings();

        _cardsReady = false;
        _restoredCards = false;

        
        const results = await Promise.allSettled([
            localforage.getItem(getStorageKey('chatSettings')),
            localforage.getItem(getStorageKey('chatMessages')),
            localforage.getItem(getStorageKey('backgroundGallery')),
            localforage.getItem(getStorageKey('customReplies')),
            localforage.getItem(getStorageKey('customPokes')),
            localforage.getItem(getStorageKey('customStatuses')),
            localforage.getItem(getStorageKey('customMottos')),
            localforage.getItem(getStorageKey('customIntros')),
            localforage.getItem(getStorageKey('anniversaries')),
            localforage.getItem(getStorageKey('stickerLibrary')),
            localforage.getItem(`${APP_PREFIX}customThemes`),
            localforage.getItem(getStorageKey('chatBackground')),
            localforage.getItem(getStorageKey('partnerAvatar')),
            localforage.getItem(getStorageKey('myAvatar')),
            localforage.getItem(getStorageKey('partnerPersonas')), 
            localforage.getItem(getStorageKey('showPartnerNameInChat')),
            localforage.getItem(`${APP_PREFIX}themeSchemes`),
            localforage.getItem(getStorageKey('myStickerLibrary')),
            localforage.getItem(getStorageKey('customReplyGroups')),
            localforage.getItem(getStorageKey('customPokeGroups')),
            localforage.getItem(getStorageKey('customStatusGroups')),
            localforage.getItem(getStorageKey('myStickerGroups'))
        ]);
        const getVal = (index) => results[index].status === 'fulfilled' ? results[index].value : null;

        const savedSettings = getVal(0);
        const savedMessages = getVal(1);
        const savedBgGallery = getVal(2);
        const savedCustomReplies = getVal(3);
        const savedPokes = getVal(4);
        const savedStatuses = getVal(5);
        const savedMottos = getVal(6);
        const savedIntros = getVal(7);
        const savedAnniversaries = getVal(8);
        const savedStickers = getVal(9);
        const savedCustomThemes = getVal(10);
        const savedChatBg = getVal(11);
        const partnerAvatarSrc = getVal(12);
        const myAvatarSrc = getVal(13);
        const savedPartnerPersonas = getVal(14);
        const savedShowNameConfig = getVal(15);
        const savedThemeSchemes = getVal(16);
        const savedMyStickers = getVal(17);
        const savedReplyGroups = getVal(18);
        const savedPokeGroups = getVal(19);
        const savedStatusGroups = getVal(20);
        const savedMyStickerGroups = getVal(21);

        // 语音字卡数据 + 发送开关（独立键，避免改动上面 Promise 下标）
        const savedVoiceCards = await localforage.getItem(getStorageKey('customVoiceCards'));
        const savedVoiceCardEnabled = await localforage.getItem(getStorageKey('voiceCardEnabled'));
        if (Array.isArray(savedVoiceCards)) voiceCards = savedVoiceCards;
        if (savedVoiceCardEnabled !== null) voiceCardEnabled = !!savedVoiceCardEnabled;
        window._voiceCards = voiceCards;
        // 数据加载完成后根据持久化的语音字卡开关，重刷设置面板开关样式
        if (typeof window._syncVoiceCardUI === 'function') {
            try { window._syncVoiceCardUI(); } catch (e) {}
        }

        // 语音字卡分组（自定义 key，独立于上方 Promise 下标）
        const savedVoiceGroups = await localforage.getItem(getStorageKey('customVoiceGroups'));
        if (Array.isArray(savedVoiceGroups)) window.customVoiceGroups = savedVoiceGroups;
        if (!window.customVoiceGroups) window.customVoiceGroups = [];

        if (savedPartnerPersonas) partnerPersonas = savedPartnerPersonas;

        if (savedSettings) Object.assign(settings, savedSettings);

        if (settings.showPartnerNameInChat !== undefined) {
            showPartnerNameInChat = settings.showPartnerNameInChat;
        } else if (savedShowNameConfig !== null) {
            showPartnerNameInChat = savedShowNameConfig;
        }
        document.body.classList.toggle('show-partner-name', showPartnerNameInChat);
        try {
            if (settings.customFontUrl) applyCustomFont(settings.customFontUrl);
            if (settings.customBubbleCss) applyCustomBubbleCss(settings.customBubbleCss);
            if (settings.customGlobalCss) applyGlobalThemeCss(settings.customGlobalCss);
        } catch(e) { console.warn("样式应用失败", e); }
        
        if (savedPokes) customPokes = savedPokes;
        else customPokes = [...CONSTANTS.POKE_ACTIONS];

        if (savedStatuses) customStatuses = savedStatuses;
        else customStatuses = [...CONSTANTS.PARTNER_STATUSES];

        if (savedMottos) customMottos = savedMottos;
        else customMottos = [...CONSTANTS.HEADER_MOTTOS];
        
        if (savedIntros) customIntros = savedIntros;
        else customIntros = CONSTANTS.WELCOME_ANIMATIONS.map(a => `${a.line1}|${a.line2}`);

        if (savedMessages && Array.isArray(savedMessages)) {
            messages = savedMessages.map(m => ({
                ...m, timestamp: new Date(m.timestamp)
            }));
        } else {
            const backup = _tryRecoverFromBackup();
            if (backup && Array.isArray(backup.messages) && backup.messages.length > 0) {
                const timeSince = Math.round((Date.now() - backup.ts) / 60000);
                console.warn(`[loadData] 主存储无消息，正在从备份恢复（备份时间：${timeSince} 分钟前）`);
                messages = backup.messages.map(m => ({
                    ...m, timestamp: new Date(m.timestamp)
                }));
                if (backup.settings) Object.assign(settings, backup.settings);
                if (backup.anniversaries && Array.isArray(backup.anniversaries)) {
                    anniversaries = backup.anniversaries;
                }
                setTimeout(() => saveData(), 1000);
                showNotification(
                    `已从备份恢复 ${messages.length} 条消息${backup._truncated ? '（备份为最近200条）' : ''}`,
                    'warning', 6000
                );
            } else {
                messages = [];
            }
        }

        if (savedBgGallery) {
            savedBackgrounds = savedBgGallery;
        } else {
            savedBackgrounds = [{ id: 'preset-1', type: 'color', value: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)' }];
        }

        if (savedCustomReplies) customReplies = savedCustomReplies;
        if (savedReplyGroups) window.customReplyGroups = savedReplyGroups;
        if (savedPokeGroups) window.customPokeGroups = savedPokeGroups;
        if (savedStatusGroups) window.customStatusGroups = savedStatusGroups;
        if (savedAnniversaries) anniversaries = savedAnniversaries;
        if (savedStickers) stickerLibrary = savedStickers;
        if (savedMyStickers) myStickerLibrary = savedMyStickers;
        if (savedMyStickerGroups) window.myStickerGroups = savedMyStickerGroups;
        else window.myStickerGroups = [];

        // 迁移："我的表情库"以前是纯字符串数组（元素直接是图片地址），
        // 现在要支持分组，每一项需要有自己的身份（id）和归属（groupId），
        // 改成对象数组。只有第一次加载到旧格式数据时才会触发，转完就直接存回去，
        // 以后不会再重复转。
        (function _migrateMyStickerLibrary() {
            if (!Array.isArray(myStickerLibrary) || !myStickerLibrary.length) return;
            var needsMigration = myStickerLibrary.some(function (s) { return typeof s === 'string'; });
            if (!needsMigration) return;
            var base = Date.now();
            var n = myStickerLibrary.length;
            myStickerLibrary = myStickerLibrary.map(function (s, i) {
                if (typeof s === 'string') {
                    // 这个数组从老格式（纯字符串数组）那会儿开始，加新表情就一直是 unshift 塞到最前面
                    // （见 app.js 的 myStickerLibrary.unshift），也就是说数组第0个本来就是"最新"那张，
                    // 不是"最老"那张——时间戳要按这个真实规律倒着算，第0个给最大的时间戳，
                    // 不然新的排序逻辑（按 addedAt 倒序）会把老数据的先后顺序整个搞反
                    return { id: 'stk_' + base + '_' + i, src: s, groupId: null, addedAt: base + (n - 1 - i), groupJoinedAt: base + (n - 1 - i) };
                }
                return s; // 已经是新格式的，原样保留
            });
            try { localforage.setItem(getStorageKey('myStickerLibrary'), myStickerLibrary); } catch (e) {}
        })();

        // 一次性补救：上面那段迁移代码上线后，已经有一批用户的老表情包被那个"方向搞反"的
        // bug 转换过一次了（转换本身已经完成，不会再走上面那条 needsMigration 分支）。
        // 这里专门找出"当年被那个bug处理过"的那一批，把顺序倒回来——判断依据是：
        // 一批条目的 id 共享同一个 'stk_<base>_' 前缀，且 addedAt 严格是 base, base+1, base+2...
        // 这种连续整数（真实世界不同时间上传的表情，时间戳几乎不可能刚好差1毫秒排成这样，
        // 这个特征几乎只有那个bug的产物才会有），符合的话就按当前数组位置重新倒序赋值一次。
        // 用一个开关记一下修过了，不会同一批数据被反复橄来倒去
        (function _fixMyStickerMigrationOrderBug() {
            try {
                if (localStorage.getItem('myStickerOrderFixApplied') === '1') return;
            } catch (e) { return; }
            if (!Array.isArray(myStickerLibrary) || !myStickerLibrary.length) {
                try { localStorage.setItem('myStickerOrderFixApplied', '1'); } catch (e) {}
                return;
            }
            // 按 id 里的 base 前缀分批，逐批检查是不是"连续整数"这个特征
            var groups = {};
            var order = [];
            myStickerLibrary.forEach(function (entry, idx) {
                if (!entry || typeof entry.id !== 'string') return;
                var m = entry.id.match(/^stk_(\d+)_\d+$/);
                if (!m) return;
                var base = m[1];
                if (!groups[base]) { groups[base] = []; order.push(base); }
                groups[base].push({ entry: entry, idx: idx });
            });
            var fixedCount = 0;
            order.forEach(function (base) {
                var members = groups[base];
                if (members.length < 2) return; // 单独一条不构成"批量迁移"的特征，跳过，避免误伤正常数据
                // members 已经是按数组原始顺序收集的（forEach 天然顺序），检查是不是连续整数
                var baseNum = Number(base);
                var isSequential = members.every(function (m, i) { return m.entry.addedAt === baseNum + i; });
                if (!isSequential) return; // 不符合特征，可能是正常数据凑巧共享了前缀，不动它
                var n = members.length;
                members.forEach(function (m, i) {
                    var newVal = baseNum + (n - 1 - i);
                    m.entry.addedAt = newVal;
                    m.entry.groupJoinedAt = newVal;
                });
                fixedCount += n;
            });
            if (fixedCount > 0) {
                try { localforage.setItem(getStorageKey('myStickerLibrary'), myStickerLibrary); } catch (e) {}
                console.log('[sticker-fix] 已修正 ' + fixedCount + ' 张老表情包的排序方向');
            }
            try { localStorage.setItem('myStickerOrderFixApplied', '1'); } catch (e) {}
        })();
        if (savedCustomThemes) customThemes = savedCustomThemes;
        if (savedThemeSchemes) themeSchemes = savedThemeSchemes;
        try { const ce = await localforage.getItem(getStorageKey('customEmojis')); if (ce && Array.isArray(ce)) customEmojis = ce; } catch(e) {}

        // 字卡数据兜底恢复：当 IndexedDB(localforage) 里对应的键缺失（null）或为空数组 [] 时，
        // 从本地紧急备份恢复（更新/重装后 WebView 存储被清理、或某次早退落盘误写了空数组，都会表现为 "空"）。
        // 只在"缺失或空"且本地备份确实有非空字卡时才恢复；用户主动清空会让备份同步变空，因此不会误覆盖。
        // _cardMissing：null 或空数组即视为缺失（[] 为 truthy，原判断只认 null，挡不住空覆盖）
        const _cardMissing = (v) => !v || (Array.isArray(v) && v.length === 0);
        if (_cardMissing(savedCustomReplies) || _cardMissing(savedReplyGroups) || _cardMissing(savedVoiceCards) || _cardMissing(savedVoiceGroups) || savedVoiceCardEnabled === null) {
            try {
                const _cardBackup = _tryRecoverFromBackup();
                // 语音字卡音频本体只完整保存在 IndexedDB 全量紧急备份里（localStorage 配额装不下），
                // 读取该完整备份作为恢复源；不可用（如从未保存过）时才退回 localStorage 纯文本备份。
                // 跨对象守卫：这两个紧急备份键是全局单个键（不按对象分桶），切换对象时会残留上一个对象的内容。
                // 新对象字卡为空正是触发本条恢复的常态，若不做校验会把上一个对象的人设/私藏字卡灌进新对象（跨对象污染）。
                // 与 _tryRecoverFromBackup 一致：备份 sessionId 必须匹配当前对象；无 sessionId 视为旧版单对象数据。
                const _emergencyBelongs = (b) => {
                    if (!b) return false;
                    if (typeof SESSION_ID !== 'undefined' && SESSION_ID) return (b.sessionId || 'default') === SESSION_ID;
                    return true;
                };
                let _lfCardBackup = null;
                try {
                    const _lb = await localforage.getItem(_EMERGENCY_LF_KEY);
                    if (_lb && typeof _lb === 'object' && _lb.ts && _emergencyBelongs(_lb)) _lfCardBackup = _lb;
                } catch (e) {}
                // 语音字卡独立键：为免主备份每次因消息变化而重拷大音频，voiceCards 单独存一个键，
                // 恢复时把它并入主备份源；兼容旧版"主备份内直接含 customVoiceCards"的格式。
                try {
                    const _lvc = await localforage.getItem(_EMERGENCY_VC_KEY);
                    if (_lvc && typeof _lvc === 'object' && _lvc.ts && Array.isArray(_lvc.customVoiceCards) && _emergencyBelongs(_lvc)) {
                        if (_lfCardBackup) _lfCardBackup.customVoiceCards = _lvc.customVoiceCards;
                        else _lfCardBackup = _lvc;
                    }
                } catch (e) {}
                const _src = (_lfCardBackup && _lfCardBackup.ts) ? _lfCardBackup : _cardBackup;
                if (_src) {
                    if (_cardMissing(savedCustomReplies) && Array.isArray(_src.customReplies) && _src.customReplies.length) {
                        customReplies = _src.customReplies; _restoredCards = true;
                    }
                    if (_cardMissing(savedReplyGroups) && Array.isArray(_src.customReplyGroups) && _src.customReplyGroups.length) {
                        window.customReplyGroups = _src.customReplyGroups; _restoredCards = true;
                    }
                    if (_cardMissing(savedVoiceCards)) {
                        const _vc = Array.isArray(_src.customVoiceCards) && _src.customVoiceCards.length ? _src.customVoiceCards : null;
                        if (_vc) { voiceCards = _vc; window._voiceCards = voiceCards; _restoredCards = true; }
                    }
                    if (_cardMissing(savedVoiceGroups) && Array.isArray(_src.customVoiceGroups) && _src.customVoiceGroups.length) {
                        window.customVoiceGroups = _src.customVoiceGroups; _restoredCards = true;
                    }
                    if (savedVoiceCardEnabled === null && _src.voiceCardEnabled !== undefined) {
                        voiceCardEnabled = !!_src.voiceCardEnabled;
                    }
                    // 恢复了语音字卡相关数据后，重刷设置面板里的语音字卡开关状态
                    try {
                        if (typeof window._syncVoiceCardUI === 'function') window._syncVoiceCardUI();
                    } catch (e) {}
                }
            } catch (e) {
                console.warn('[loadData] 从备份恢复字卡失败:', e);
            }
        }

        // 字卡加载完成，允许后续 saveData/备份落写字卡
        _cardsReady = true;
        // 数据加载完成，同步大键到 window，供数据管理面板"内存引用估算"使用（避免打开面板时 getItem 巨键）
        window.messages = messages;
        window.stickerLibrary = stickerLibrary;
        window.myStickerLibrary = myStickerLibrary;
        window.voiceCards = voiceCards;
        window.customThemes = customThemes;
        if (_restoredCards) {
            // 恢复出的字卡立即回写 IndexedDB，避免每次启动都依赖备份、或空数组继续残留在主库
            setTimeout(() => { try { saveData(); } catch (e) { console.warn('[loadData] 回写字卡失败:', e); } }, 800);
        }

        window._customReplies = customReplies;
        window._CONSTANTS = CONSTANTS;

        if (DOMElements && DOMElements.partner && DOMElements.me) {
            updateAvatar(DOMElements.partner.avatar, partnerAvatarSrc);
            updateAvatar(DOMElements.me.avatar, myAvatarSrc);
            // updateAvatar 已经把值写进 _avatarCache 了，这里不用再写一遍

            // 阶段四：本地没有头像时，从云端下载（换设备恢复场景）
            if (window.CloudMedia && window.CloudSync && window.CloudSync.isConnected()) {
                const _tryRestoreAvatar = async (isPartner) => {
                    const localSrc = isPartner ? partnerAvatarSrc : myAvatarSrc;
                    // 本地 localforage 有 或 内存缓存有，都不拉
                    const cacheVal = window._avatarCache && (isPartner ? window._avatarCache.partner : window._avatarCache.me);
                    if (localSrc || cacheVal) return;

                    const category = isPartner ? 'avatars' : 'my-avatars';
                    const avatarId = isPartner ? 'partner' : 'me';
                    const sid = SESSION_ID;
                    // 只试 jpg 和 png（上传时统一用 jpg，png 做兜底）
                    for (const ext of ['jpg', 'png']) {
                        const ossRef = `oss://media/${sid}/${category}/${avatarId}.${ext}`;
                        try {
                            const blobUrl = await window.CloudMedia.fetchUrl(ossRef);
                            const resp = await fetch(blobUrl);
                            const buf = await resp.arrayBuffer();
                            const b64arr = new Uint8Array(buf);
                            let binary = '';
                            b64arr.forEach(b => binary += String.fromCharCode(b));
                            const base64 = `data:image/${ext};base64,` + btoa(binary);
                            const storageKey = getStorageKey(isPartner ? 'partnerAvatar' : 'myAvatar');
                            await localforage.setItem(storageKey, base64);
                            const el = isPartner ? DOMElements.partner.avatar : DOMElements.me.avatar;
                            updateAvatar(el, base64);
                            break;
                        } catch (e) {
                            // 没有这个后缀，继续
                        }
                    }
                };
                _tryRestoreAvatar(true).catch(() => {});
                _tryRestoreAvatar(false).catch(() => {});
            }
        }

        if (savedChatBg) {
            applyBackground(savedChatBg);
        } else {
            const lsBg = safeGetItem(getStorageKey('chatBackground'));
            if (lsBg) {
                applyBackground(lsBg);
                localforage.setItem(getStorageKey('chatBackground'), lsBg);
            }
        }

        try { await initMoodData(); } catch(e) { console.warn("心情数据加载失败", e); }
        try { await loadEnvelopeData(); } catch(e) { console.warn("信封数据加载失败", e); }
        
        displayedMessageCount = HISTORY_BATCH_SIZE;
        msgViewMode = 'latest'; // 切换/加载会话时，重置掉"历史浏览模式"，避免带着上一个会话的浏览状态串过来
        newMsgCountWhileBrowsing = 0;
        if (typeof window._updateBackToLatestBtn === 'function') window._updateBackToLatestBtn();
        
        setTimeout(() => {
            applyAllAvatarFrames();
            manageAutoSendTimer(); 
            checkEnvelopeStatus(); 
            if (typeof checkMomentsStatus === 'function') checkMomentsStatus();
            updateUI();
            if (settings.customBubbleCss) {
                try { applyCustomBubbleCss(settings.customBubbleCss); } catch(e) {}
            }
        }, 100);

        // 数据已完整加载进内存后解锁，此前保存/备份一律跳过，防止空/默认数据覆盖磁盘
        _dataReady = true;

    } catch (e) {
        console.error("LoadData 内部致命错误:", e);
        // 加载失败时：只兜底重置 settings（若 settings 未初始化），
        // 不清空已成功加载到内存的 messages/anniversaries/customReplies 等全局数据，
        // 避免加载中间出错被空数据覆盖全量落盘，最终整条数据被清空。
        if (!settings || typeof settings !== 'object') settings = getDefaultSettings();
        if (typeof messages === 'undefined' || messages === null) messages = [];
        // 即便加载出错，也解除闩锁，保证后续 saveData/备份仍能正常落写字卡，避免永远无法保存
        _cardsReady = true;
        _dataReady = true;
        updateUI();
    }
};

const LIBRARY_CONFIG = {
    reply: {
        title: "回复库管理",
        tabs: [
            { id: 'custom', name: '主字卡', mode: 'list' },
            { id: 'voices', name: '语音字卡', mode: 'list' },
            { id: 'emojis', name: 'Emoji', mode: 'grid' },
            { id: 'stickers', name: '表情库', mode: 'grid' }
        ]
    },
    atmosphere: {
        title: "氛围感配置",
        tabs: [
            { id: 'pokes', name: '拍一拍', mode: 'list' },
            { id: 'statuses', name: '对方状态', mode: 'list' },
            { id: 'mottos', name: '顶部格言', mode: 'list' },
            { id: 'intros', name: '开场动画', mode: 'list' }
        ]
    }
};
let currentAnnType = 'anniversary'; 

window.openMyStickerSettings = function() {
    const picker = document.getElementById('user-sticker-picker');
    if (picker) picker.classList.remove('active');
    if (typeof currentMajorTab !== 'undefined') {
        currentMajorTab = 'reply';
        currentSubTab = 'stickers';
    }
    var sidebarBtns = document.querySelectorAll('.sidebar-btn');
    sidebarBtns.forEach(function(b) { b.classList.toggle('active', b.dataset.major === 'reply'); });
    if (typeof renderReplyLibrary === 'function') renderReplyLibrary();
    var modal = document.getElementById('custom-replies-modal');
    if (modal && typeof showModal === 'function') showModal(modal);
};

window.switchAnnType = function(type) {
    currentAnnType = type;
    currentAnniversaryType = type; 
    document.querySelectorAll('.ann-type-btn').forEach(btn => {
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    const desc = document.getElementById('ann-type-desc');
    if(desc) {
        desc.textContent = type === 'anniversary' 
            ? '计算从过去某一天到现在已经过了多少天 (例如: 相识、恋爱)' 
            : '计算从现在到未来某一天还剩下多少天 (例如: 生日、跨年)';
    }
};

window.deleteAnniversaryItem = function(id) {
    if(confirm("确定要删除这条记录吗？")) {
        anniversaries = anniversaries.filter(a => a.id !== id);
        throttledSaveData(); 
        renderAnniversariesList();
        showNotification('已删除', 'success');
        if (typeof playSound === 'function') playSound('anniversary');
    }
};

const _BACKUP_PREFIX = 'BACKUP_V1_';
// IndexedDB 全量紧急备份键：含语音字卡等本体内存，配合 localStorage 纯文本备份作为"更新/存储异常"时的完整恢复源。
const _EMERGENCY_LF_KEY = (typeof APP_PREFIX !== 'undefined' ? APP_PREFIX : 'CHAT_APP_V3_') + '_emergencyBackup';
// 语音字卡独立紧急备份键：voiceCards 可能含数 MB base64 音频，单独存放，
// 使"消息频繁变更"与"语音字卡(重数据)"解耦，避免每条新消息都重拷整份语音音频。
const _EMERGENCY_VC_KEY = (typeof APP_PREFIX !== 'undefined' ? APP_PREFIX : 'CHAT_APP_V3_') + '_emergencyVoiceCards';
// 文本备份用消息骨架：去掉大体积 base64 图片，避免每次 JSON.stringify 阻塞主线程；
// 保留图片存在性标记(true)和 oss:// 云端引用。返回新数组（未改动时返回原数组引用）。
function _stripMsgImagesForTextBackup(list) {
    if (!Array.isArray(list)) return list;
    let out = list;
    for (let i = 0; i < list.length; i++) {
        const m = list[i];
        const img = m && m.image;
        if (typeof img === 'string' && img.indexOf('data:') === 0 && img.length > 256) {
            if (out === list) out = list.slice(0, i);
            const copy = Object.assign({}, m);
            copy.image = true;
            out.push(copy);
        } else if (out !== list) {
            out.push(m);
        }
    }
    return out;
}
// 备份节流时间戳：避免拿全部消息在主线程做同步 JSON.stringify 写 localStorage，导致聊天时反复卡顿。
// 每次 saveData() 都会走到这里（每条消息 + 500ms 节流都会触发），这里把真正落盘限制为每 10 秒最多一次，
// 页面隐藏/关闭时会通过 flush() 强制落盘，保证退出前数据不丢。
let _lastBackupTs = 0;
const _BACKUP_THROTTLE_MS = 10000;
// 数据"版本"标记：任何消息内容发生变更(追加/撤回/已读/清空)时 +1，saveData 与备份据此跳过未改动的重复重写。
// 防止每条消息/每个已读回执都触发一次全量 `chatMessages`(可能含 base64 图片)的 structuredClone 与整库重写。
let _saveRev = 0;
let _lastSavedSaveRev = -1;
let _lastSavedMsgLen = -1;
let _lastBackupRev = -1;
// 消息主存储落库节流：见 saveData 内 chatMessages 分支的说明。JS 变量在下方定义，保证闭包可读。
let _MSG_PERSIST_INTERVAL = 3000;
let _msgPersistAt = 0;
window._markChatDataChanged = function () { _saveRev++; };
window._getChatDataRev = function () { return _saveRev; };
// 字卡"就绪"闩锁：loadData 把字卡读回内存之前为 false，期间 saveData 与紧急备份都不落写字卡，
// 防止更新/重载窗口内过早落盘把内存中仍是空数组的 [] 写进 IndexedDB、并污染本地备份镜像。
// 加载完成后置 true。_restoredCards 标记本次是否从备份恢复了字卡，用于加载后立即回写持久化。
let _cardsReady = false;
let _restoredCards = false;
// 数据整体"就绪"闩锁：loadData 完成前为 false。与 _cardsReady 同类，用于全局兜底——
// 防止任何在加载完成前触发的保存/备份用"尚未就绪(空数组/默认值)"的内存数据覆盖磁盘上已存在的数据。
let _dataReady = false;
// ── 重数据键（含 base64 音频/图片）的写入守卫 ──
// saveData 每次被节流触发都会把所有键重新写入 IndexedDB；导入大量数据后
// voiceCards(语音音频)/stickers(贴纸)/themes(主题图) 可能达到数 MB，
// 每次无条件 structuredClone 会拖死主线程，表现为"没数据不卡、导入数据后操作几次就卡死"。
// 这里只在数据真正变更时才重写对应键：脏标记(处理原地元素替换) + 引用/长度变化兜底(覆盖 push/splice/filter)。
const _heavyDirty = {};
const _heavySavedDirty = {};
const _heavySaved = {};
const _heavyRef = {};
const _heavyLen = {};
window._markDataDirty = function (key) { _heavyDirty[key] = (_heavyDirty[key] || 0) + 1; };
function _writeHeavyIfChanged(fullKey, getVal) {
    const cur = getVal();
    const dirtyCount = _heavyDirty[fullKey] || 0;
    if (_heavySaved[fullKey] && dirtyCount === _heavySavedDirty[fullKey]) {
        const sameRef = cur === _heavyRef[fullKey];
        const sameLen = !Array.isArray(cur) || !Array.isArray(_heavyRef[fullKey]) || cur.length === _heavyLen[fullKey];
        if (sameRef && sameLen) return Promise.resolve();
    }
    _heavySaved[fullKey] = true;
    _heavySavedDirty[fullKey] = dirtyCount;
    _heavyRef[fullKey] = cur;
    _heavyLen[fullKey] = Array.isArray(cur) ? cur.length : -1;
    return localforage.setItem(fullKey, cur);
}
// 紧急备份(IndexedDB 全量快照，含 voiceCards 音频)的上次写入状态，用于跳过未变更的重复重写
let _lastEmergencyRev = -1;
let _lastEmergencyVcRef = null;
let _lastEmergencyVcLen = -1;
let _lastEmergencyVcDirty = 0;
function _backupCriticalData(force) {
    if (window._skipBackup) return;
    // 导入/恢复完成、刷新前不让任何写入覆盖刚导入的数据：
    // 内存仍是旧数据（_saveRev 未变），此时若写入会用旧数据覆盖 IndexedDB/localStorage 的新数据
    if (window._importGuarded) return;
    // 落盘整体延后到当前事件(输入/渲染)处理完再执行：真正写 localStorage 是一次同步 JSON.stringify+setItem，
    // 直接在消息推送/已读回执的主流程里同步跑会拖住主线程导致可见卡顿。force(页面隐藏/退出)时仍即时执行。
    const doBackup = () => {
        const now = Date.now();
        if (!force && _lastBackupTs && (now - _lastBackupTs) < _BACKUP_THROTTLE_MS) return;
        // 消息未发生变更且非强制时跳过：避免在 10 秒节流窗口内反复对同一份数据做同步 stringify
        if (!force && _saveRev === _lastBackupRev && _lastBackupTs) return;
        _lastBackupTs = now;
        _lastBackupRev = _saveRev;
        try {
        // 低内存（旧版安卓）兜底：备份只保留最近若干条消息，且只含纯文本字卡，
        // 让 JSON.stringify 始终产出有界的小字符串——避免反复序列化全部消息（可能含 base64 图片）
        // 先构造超大临时字符串再截断，从而在低内存机型上触发原生 OOM 闪退。
        const BACKUP_MSGS = 150;
        const isTruncated = Array.isArray(messages) && messages.length > BACKUP_MSGS;
        const msgTail = isTruncated ? messages.slice(-BACKUP_MSGS) : messages;
        // localStorage 纯文本备份用"消息骨架"（去掉大体积 base64 图片）：
        // 图片 base64 单张几百 KB、且 localStorage 配额也装不下，每 10 秒对它做一次 JSON.stringify
        // 会阻塞主线程数秒——这正是"连续操作卡顿/卡住"的元凶之一。图片本体始终在 IndexedDB
        // （主存储 chatMessages + _EMERGENCY_LF_KEY 紧急备份），文本备份仅保留骨架保证可恢复出聊天文本。
        const textTail = _stripMsgImagesForTextBackup(msgTail);

        const backupPayload = {
            ts: now,
            messages: textTail,
            settings: settings,
            sessionId: SESSION_ID,
            anniversaries: anniversaries,
            _truncated: isTruncated
        };
        // 字卡数据仅在"已就绪"时纳入备份：就绪前不写入，避免把内存中尚未加载的空数组覆盖掉旧的备份字卡。
        // 注意：customVoiceCards（语音字卡）含超大 base64 音频，绝不能进 localStorage JSON——
        // 一次 stringify 会产生超大临时字符串导致原生 OOM 闪退，且 localStorage 配额也装不下。
        // 语音字卡音频本体始终保存在 IndexedDB 主存储，这里只备份纯文本字卡与分组等轻量数据。
        if (_cardsReady) {
            backupPayload.customReplies = customReplies || [];
            backupPayload.customReplyGroups = (window.customReplyGroups) || [];
            backupPayload.customVoiceGroups = (window.customVoiceGroups) || [];
            backupPayload.voiceCardEnabled = !!voiceCardEnabled;
        }

        let json;
        try {
            json = JSON.stringify(backupPayload);
        } catch (e) {
            // 个别字段无法序列化时降级为极简备份，保证 stringify 不拖垮启动
            json = JSON.stringify({
                ts: now,
                messages: Array.isArray(textTail) ? textTail.slice(-30) : [],
                settings: settings,
                sessionId: SESSION_ID,
                anniversaries: anniversaries,
                _truncated: true
            });
        }
        // 二次兜底：极少数情况下单条消息内包含超大数据仍会导致字符串过大，此时放弃本备份，绝不写坏
        if (json.length > 4.5 * 1024 * 1024) {
            json = JSON.stringify({
                ts: now,
                messages: [],
                settings: settings,
                sessionId: SESSION_ID,
                anniversaries: anniversaries,
                _truncated: true
            });
        }
        localStorage.setItem(_BACKUP_PREFIX + 'critical', json);
        localStorage.setItem(_BACKUP_PREFIX + 'timestamp', String(now));

        // 全量紧急备份（含语音字卡音频）写入 IndexedDB：localStorage 配额小、且 stringify 大体积会 OOM，
        // 而 IndexedDB 走结构化克隆、不产生超长单字符串，低内存机型也安全，因此把完整备份(含 voiceCards)存这里，
        // 使"更新/异常后可恢复出包含语音字卡在内的全部数据"。仅字卡就绪后才写，避免内存中尚未加载的空数组覆盖。
        // 变更守卫：把"轻量备份(消息/设置/纯文本字卡)"与"语音字卡(可能数 MB base64 音频)"拆成两个键分别写入。
        // 原先只要消息一变就重拷整份 voiceCards 进 IndexedDB，导入大量语音字卡后每条新消息都会触发一次
        // 超大 structuredClone 拖死主线程——这正是"没数据不卡、导入数据后操作卡顿"的主要来源。
        // 现在语音字卡只在它自己变更时才重写（独立键），消息变化只更新轻量键，主线程不再被反复阻塞。
        if (_cardsReady) {
            try {
                const vcRef = voiceCards || [];
                const vcLen = Array.isArray(vcRef) ? vcRef.length : -1;
                const vcDirty = _heavyDirty['customVoiceCards'] || 0;
                const vcChanged = (vcRef !== _lastEmergencyVcRef) || (vcLen !== _lastEmergencyVcLen) || (vcDirty !== _lastEmergencyVcDirty);
                const msgChanged = _saveRev !== _lastEmergencyRev;
                if (force || _lastEmergencyRev === -1 || msgChanged) {
                    _lastEmergencyRev = _saveRev;
                    // 这里用与文本备份一致的"消息骨架"（去掉大 base64 图片）：
                    // 本键恢复路径只读字卡（customReplies/groups/voiceCards），不消费 messages，
                    // 且完整图片始终在 IndexedDB 主存储 chatMessages 里，无需在这里反复重拷大图。
                    localforage.setItem(_EMERGENCY_LF_KEY, {
                        ts: now,
                        messages: textTail,
                        settings: settings,
                        sessionId: SESSION_ID,
                        anniversaries: anniversaries,
                        _truncated: isTruncated,
                        customReplies: customReplies || [],
                        customReplyGroups: (window.customReplyGroups) || [],
                        customVoiceGroups: (window.customVoiceGroups) || [],
                        voiceCardEnabled: !!voiceCardEnabled
                    }).catch(function (e) { console.warn('IndexedDB 全量紧急备份写入失败:', e); });
                }
                if (force || _lastEmergencyVcRef === null || vcChanged) {
                    _lastEmergencyVcRef = vcRef;
                    _lastEmergencyVcLen = vcLen;
                    _lastEmergencyVcDirty = vcDirty;
                    localforage.setItem(_EMERGENCY_VC_KEY, {
                        ts: now,
                        sessionId: SESSION_ID,
                        customVoiceCards: vcRef
                    }).catch(function (e) { console.warn('IndexedDB 语音字卡紧急备份写入失败:', e); });
                }
            } catch (e) { console.warn('IndexedDB 全量紧急备份写入异常:', e); }
        }
    } catch (e) {
        console.warn('localStorage 备份写入失败（可能存储已满）:', e);
    }
    };
    if (force) {
        try { doBackup(); } catch (e) { console.warn('强制备份失败:', e); }
    } else {
        try { setTimeout(doBackup, 0); } catch (e) { console.warn('调度备份失败:', e); }
    }
}
// 页面隐藏/关闭时强制落盘（绕过节流），保证退出前最新数据已备份。
function _flushCriticalBackup() {
    try { _backupCriticalData(true); } catch (e) { console.warn('强制备份失败:', e); }
}

function _tryRecoverFromBackup() {
    try {
        const raw = localStorage.getItem(_BACKUP_PREFIX + 'critical');
        if (!raw) return null;
        const b = JSON.parse(raw);
        // 紧急备份按对象各自生成并携带 sessionId。切换对象时会有一个「新对象主存储为空 +
        // 备份还停留在上一个对象」的窗口；此时绝不能拿上一个对象的备份填进新对象（跨对象污染）。
        // 只有备份所属对象与当前对象一致才恢复；无 sessionId 视为旧版单对象数据（归属 default）。
        if (b && typeof SESSION_ID !== 'undefined' && SESSION_ID && (b.sessionId || 'default') !== SESSION_ID) {
            return null;
        }
        return b;
    } catch (e) {
        return null;
    }
}

const saveData = async (force) => {
    if (window._importGuarded) return;   // 导入/恢复完成、刷新前禁止写入，防止内存旧数据覆盖已导入的新数据
    if (!_dataReady) return;             // 数据未加载就绪前不落盘，防止空/默认内存数据覆盖磁盘已有数据
    if (!SESSION_ID) {
        console.warn('[saveData] SESSION_ID 尚未初始化，跳过保存以防数据写入临时 key');
        return;
    }
    // 供数据管理面板做"内存引用估算"使用：避免打开面板时对含全部 base64 的巨键 getItem + stringify。
    // saveData 只在数据加载完成后才被调用，此刻下方变量已初始化，无 TDZ 风险。
    window.messages = messages;
    window.stickerLibrary = stickerLibrary;
    window.myStickerLibrary = myStickerLibrary;
    window.voiceCards = voiceCards;
    window.customThemes = customThemes;

    const promises = [
        { key: 'chatSettings',           val: () => localforage.setItem(getStorageKey('chatSettings'), settings) },
        { key: 'customReplies',          val: () => _cardsReady ? localforage.setItem(getStorageKey('customReplies'), customReplies) : Promise.resolve() },
        { key: 'customReplyGroups',      val: () => _cardsReady ? localforage.setItem(getStorageKey('customReplyGroups'), window.customReplyGroups || []) : Promise.resolve() },
        { key: 'customPokeGroups',        val: () => localforage.setItem(getStorageKey('customPokeGroups'), window.customPokeGroups || []) },
        { key: 'customStatusGroups',      val: () => localforage.setItem(getStorageKey('customStatusGroups'), window.customStatusGroups || []) },
        { key: 'customEmojis',           val: () => localforage.setItem(getStorageKey('customEmojis'), customEmojis) },
        { key: 'anniversaries',          val: () => localforage.setItem(getStorageKey('anniversaries'), anniversaries) },
        { key: 'customPokes',            val: () => localforage.setItem(getStorageKey('customPokes'), customPokes) },
        { key: 'customStatuses',         val: () => localforage.setItem(getStorageKey('customStatuses'), customStatuses) },
        { key: 'customMottos',           val: () => localforage.setItem(getStorageKey('customMottos'), customMottos) },
        { key: 'customIntros',           val: () => localforage.setItem(getStorageKey('customIntros'), customIntros) },
        { key: 'customVoiceCards',       val: () => _cardsReady ? _writeHeavyIfChanged(getStorageKey('customVoiceCards'), () => voiceCards) : Promise.resolve() },
        { key: 'customVoiceGroups',      val: () => _cardsReady ? localforage.setItem(getStorageKey('customVoiceGroups'), window.customVoiceGroups || []) : Promise.resolve() },
        { key: 'voiceCardEnabled',       val: () => _cardsReady ? localforage.setItem(getStorageKey('voiceCardEnabled'), voiceCardEnabled) : Promise.resolve() },
        { key: 'stickerLibrary',         val: () => _writeHeavyIfChanged(getStorageKey('stickerLibrary'), () => stickerLibrary) },
        { key: 'myStickerLibrary',       val: () => _writeHeavyIfChanged(getStorageKey('myStickerLibrary'), () => myStickerLibrary) },
        { key: 'myStickerGroups',        val: () => localforage.setItem(getStorageKey('myStickerGroups'), window.myStickerGroups || []) },
        { key: 'customThemes',           val: () => _writeHeavyIfChanged(`${APP_PREFIX}customThemes`, () => customThemes) },
        { key: 'themeSchemes',           val: () => _writeHeavyIfChanged(`${APP_PREFIX}themeSchemes`, () => themeSchemes) },
        { key: 'chatMessages',           val: () => {
            const msgLen = Array.isArray(messages) ? messages.length : 0;
            // 消息未发生变更(长度未变 且 无追加/撤回/已读等变更标记)时跳过重写，避免每条消息都重拷整份含 base64 的数组
            if (_saveRev !== _lastSavedSaveRev || msgLen !== _lastSavedMsgLen) {
                // 消息主存储落库再做一层独立节流：连续操作时 throttledSaveData(500ms) 会反复触发 saveData，
                // 而 localforage.setItem 会对整份含大量 base64 图片的 messages 做结构化克隆——导入大数据后
                // 每次 clone 都可能阻塞主线程数百毫秒到数秒，连点/连发时表现就是"整个应用都卡"。
                // 这里把消息实体落库限制为每 3 秒至多一次；退出/切后台时通过 saveData(true) 强制绕过本守卫，
                // 保证退出前最新消息都能落盘（不会丢数据）。
                const now = Date.now();
                if (!force && now - (_msgPersistAt || 0) < _MSG_PERSIST_INTERVAL) return Promise.resolve();
                _msgPersistAt = now;
                return localforage.setItem(getStorageKey('chatMessages'), messages).then(() => {
                    _lastSavedSaveRev = _saveRev;
                    _lastSavedMsgLen = msgLen;
                });
            }
            return Promise.resolve();
        } },
    ];

    // 头像从内存缓存读（不从 DOM 读，DOM 的 img.src 不可靠：可能是 blob URL、绝对路径或空字符串）
    const partnerAvatarSrc = window._avatarCache && window._avatarCache.partner || null;
    const myAvatarSrc = window._avatarCache && window._avatarCache.me || null;

    if (partnerAvatarSrc) {
        promises.push({ key: 'partnerAvatar', val: () => localforage.setItem(getStorageKey('partnerAvatar'), partnerAvatarSrc) });
    }
    // 注意：头像不做 removeItem —— 用户没改头像时 _avatarCache 可能是 null，不能误删

    if (myAvatarSrc) {
        promises.push({ key: 'myAvatar', val: () => localforage.setItem(getStorageKey('myAvatar'), myAvatarSrc) });
    }

    const results = await Promise.allSettled(promises.map(p => {
        try { return p.val(); }
        catch(e) { return Promise.reject(e); }
    }));

    const failed = [];
    results.forEach((r, i) => {
        if (r.status === 'rejected') {
            failed.push(promises[i].key);
            console.error(`[saveData] 保存失败: ${promises[i].key}`, r.reason);
        }
    });

    if (failed.length > 0) {
        console.warn(`[saveData] ${failed.length} 项写入失败，已触发 localStorage 降级备份`, failed);
    }

    _backupCriticalData();
};

        function initializeRandomUI() {


            document.querySelector('.header-motto').textContent = getRandomItem(CONSTANTS.HEADER_MOTTOS);
if (customMottos && customMottos.length > 0) {
    document.querySelector('.header-motto').textContent = getRandomItem(customMottos);
} else {
    document.querySelector('.header-motto').textContent = '';
}
            const placeholder = "";
            DOMElements.messageInput.placeholder = placeholder.length > 20 ? placeholder.substring(0, 20) + "...": placeholder;


            const starsContainer = document.getElementById('stars-container');
            starsContainer.innerHTML = '';
            const starCount = 80;
            for (let i = 0; i < starCount; i++) {
                const star = document.createElement('div');
                star.className = 'star';
                const x = Math.random() * 100;
                const y = Math.random() * 100;
                const size = Math.random() * 2.5 + 0.5;
                const duration = Math.random() * 4 + 2;
                const delay = Math.random() * 6;
                star.style.left = `${x}%`;
                star.style.top = `${y}%`;
                star.style.width = `${size}px`;
                star.style.height = `${size}px`;
                star.style.setProperty('--duration', `${duration}s`);
                star.style.animationDelay = `${delay}s`;
                starsContainer.appendChild(star);
            }
            const particlesContainer = document.getElementById('welcome-particles');
            if (particlesContainer) {
                particlesContainer.innerHTML = '';
                const types = ['petal', 'petal', 'petal', 'sparkle', 'sparkle'];
                for (let i = 0; i < 22; i++) {
                    const p = document.createElement('div');
                    const type = types[i % types.length];
                    p.className = `wp ${type}`;
                    const sz = type === 'petal' ? (Math.random() * 6 + 5) : (Math.random() * 4 + 2);
                    p.style.setProperty('--pSz', sz + 'px');
                    p.style.left = (Math.random() * 100) + '%';
                    p.style.setProperty('--pDur', (Math.random() * 10 + 9) + 's');
                    p.style.setProperty('--pDel', (Math.random() * 8) + 's');
                    p.style.setProperty('--pX1', (Math.random() * 50 - 25) + 'px');
                    p.style.setProperty('--pX2', (Math.random() * 80 - 40) + 'px');
                    p.style.setProperty('--pX3', (Math.random() * 50 - 25) + 'px');
                    particlesContainer.appendChild(p);
                }
            }

            const meteorsContainer = document.getElementById('welcome-meteors');
            if (meteorsContainer) {
                meteorsContainer.innerHTML = '';
                let meteorCount = 0;
                const MAX_METEORS = 12;
                const createMeteor = () => {
                    if (meteorCount >= MAX_METEORS) return;
                    meteorCount++;
                    const m = document.createElement('div');
                    m.className = 'meteor';
                    m.style.left = (Math.random() * 100) + '%';
                    m.style.top = (Math.random() * 35) + '%';
                    const dur = (Math.random() * 0.8 + 0.7);
                    m.style.setProperty('--mDur', dur + 's');
                    m.style.setProperty('--mDel', '0s');
                    m.style.setProperty('--mRot', (25 + Math.random() * 20) + 'deg');
                    meteorsContainer.appendChild(m);
                    setTimeout(() => { m.remove(); meteorCount = Math.max(0, meteorCount - 1); }, (dur + 0.1) * 1000);
                };
                for (let i = 0; i < 8; i++) setTimeout(createMeteor, i * 350);
                const meteorTimer = setInterval(createMeteor, 600);
                setTimeout(() => clearInterval(meteorTimer), 5000);
            }

            const loaderBarEl = document.getElementById('loader-tech-bar');
            if (loaderBarEl) {
                setTimeout(() => loaderBarEl.classList.add('pulsing'), 300);
            }


            const welcomeIcon = getRandomItem(CONSTANTS.WELCOME_ICONS);
document.querySelector('.logo-icon-main').innerHTML = `<i class="${welcomeIcon}"></i>`;

if (customIntros && customIntros.length > 0) {
    const rawIntro = getRandomItem(customIntros);
    const parts = rawIntro.split('|');
    const line1 = parts[0];
    const line2 = parts[1] || ""; 

    const titleEl = document.getElementById('welcome-title-glitch');
    const subEl = document.getElementById('welcome-subtitle-scramble');

    titleEl.classList.remove('playing');
    titleEl.textContent = line1;
    void titleEl.offsetWidth;
    titleEl.classList.add('playing');

    const scrambleText = (element, finalText, duration = 1500) => {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()';
                const length = finalText.length;
                let start = Date.now();

                const interval = setInterval(() => {
                    const now = Date.now();
                    const progress = (now - start) / duration;

                    if (progress >= 1) {
                        element.textContent = finalText;
                        clearInterval(interval);
                        return;
                    }

                    let result = '';

                    const revealIndex = Math.floor(progress * length);

                    for (let i = 0; i < length; i++) {
                        if (i <= revealIndex) {
                            result += finalText[i];
                        } else {

                            result += chars[Math.floor(Math.random() * chars.length)];
                        }
                    }
                    element.textContent = result;
                },
                    40);
            };


          setTimeout(() => {
        scrambleText(subEl, line2, 2000);
    }, 600);
} else {
    document.getElementById('welcome-title-glitch').textContent = "传讯";
    document.getElementById('welcome-subtitle-scramble').textContent = "请在设置中添加开场动画";
}


            const loaderBar = document.getElementById('loader-tech-bar');
            const statusText = document.getElementById('loader-status-text');
            loaderBar.style.width = '0%';
            const loadingPhases = [
                { width: '15%', text: 'INITIALIZING · 初始化中' },
                { width: '40%', text: 'LOADING MEMORIES · 读取记忆' },
                { width: '70%', text: 'BUILDING WORLD · 构建世界' },
                { width: '90%', text: 'ALMOST THERE · 即将完成' },
                { width: '100%', text: 'CONNECTED · 连接成功' }
            ];
            const delays = [100, 700, 1600, 2400, 2900];
            delays.forEach((delay, i) => {
                setTimeout(() => {
                    loaderBar.style.width = loadingPhases[i].width;
                    if (statusText) statusText.textContent = loadingPhases[i].text;
                }, delay);
            });
        }

function manageAutoSendTimer() {
    if (autoSendTimer) {
        clearInterval(autoSendTimer);
        autoSendTimer = null;
    }
    if (settings.autoSendEnabled) {
        const interval = settings.autoSendInterval || 5;
        const intervalMs = interval * 60 * 1000;
        autoSendTimer = setInterval(function() {
            if (document.body.classList.contains('batch-favorite-mode')) return;
            // 后台不阻断发送：由前台服务 + WakeLock 保活 WebView 持续运行，
            // 到点照常发出真实消息，并让每条真实消息各自触发真实系统通知（不使用原生"虚拟"通知）。
            // 防止切回前台时浏览器批量回调导致洪水：检查距离上次回复是否已过足够间隔
            var now = Date.now();
            if (window._lastReplyTs && (now - window._lastReplyTs) < (intervalMs - 2000)) {
                return;
            }
            simulateReply();
        }, intervalMs);
    }
}

        const updateUI = () => {
            const isCustomTheme = settings.colorTheme.startsWith('custom-');
            if (isCustomTheme) {
                const themeId = settings.colorTheme;
                const theme = customThemes.find(t => t.id === themeId);
                if (theme) {
                    applyTheme(theme.colors);
                } else {
                    DOMElements.html.setAttribute('data-color-theme', 'gold');
                }
            } else {
                DOMElements.html.setAttribute('data-color-theme', settings.colorTheme);
                applyTheme(null, true);
            }
            
            if (settings.customThemeColors && Object.keys(settings.customThemeColors).length > 0) {
                for (const [variable, value] of Object.entries(settings.customThemeColors)) {
                    document.documentElement.style.setProperty(variable, value);
                }
            }

            DOMElements.html.setAttribute('data-theme', applyPreferredTheme());
            DOMElements.partner.name.textContent = settings.partnerName;
            DOMElements.me.name.textContent = settings.myName;
            DOMElements.partner.status.textContent = settings.partnerStatus || '在线';
            DOMElements.me.statusText.textContent = settings.myStatus;
            if (typeof window.updateDynamicNames === 'function') window.updateDynamicNames();
            document.documentElement.style.setProperty('--font-size', `${settings.fontSize}px`);
            
            const fontToUse = settings.messageFontFamily || "'Noto Serif SC', serif";
            
            document.documentElement.style.setProperty('--message-font-family', fontToUse);
            document.documentElement.style.setProperty('--font-family', fontToUse);
            document.documentElement.style.setProperty('--message-font-weight', settings.messageFontWeight);
            document.documentElement.style.setProperty('--message-line-height', settings.messageLineHeight);

            document.documentElement.style.setProperty('--in-chat-avatar-size', `${settings.inChatAvatarSize}px`);
            const _alignMap = { 'top': 'flex-start', 'center': 'center', 'bottom': 'flex-end', 'custom': 'flex-start' };
            document.documentElement.style.setProperty('--avatar-align', _alignMap[settings.inChatAvatarPosition || 'center'] || 'center');
            if (settings.inChatAvatarPosition === 'custom' && settings.inChatAvatarCustomOffset !== undefined) {
                document.documentElement.style.setProperty('--avatar-custom-offset', settings.inChatAvatarCustomOffset + 'px');
            }
            document.body.classList.toggle('always-show-avatar', !!settings.alwaysShowAvatar);
            if (typeof _applyCollapseState === 'function') _applyCollapseState(!!settings.bottomCollapseMode);
            document.body.classList.toggle('show-partner-name', !!(settings.showPartnerNameInChat || showPartnerNameInChat));

            document.querySelectorAll('.theme-color-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.theme === settings.colorTheme);
            });


            document.querySelectorAll('[data-bubble-style]').forEach(item => {
                item.classList.toggle('active', item.dataset.bubbleStyle === settings.bubbleStyle);
            });

            const _pillSyncMap = {
                '#reply-toggle': 'replyEnabled',
                '#sound-toggle': 'soundEnabled',
                '#read-receipts-toggle': 'readReceiptsEnabled',
                '#typing-indicator-toggle': 'typingIndicatorEnabled',
                '#read-no-reply-toggle': 'allowReadNoReply',
                '#emoji-mix-toggle': 'emojiMixEnabled',
                '#auto-send-toggle': 'autoSendEnabled',
                '#partner-recall-toggle': 'partnerRecallEnabled',
                '#partner-hangup-toggle': 'partnerHangupEnabled',
                '#partner-redpacket-toggle': 'partnerRedpacketEnabled'
            };
            for (const [sel, prop] of Object.entries(_pillSyncMap)) {
                const el = document.querySelector(sel);
                if (el) {
                    const val = prop === 'emojiMixEnabled' ? (settings[prop] !== false) : !!settings[prop];
                    el.classList.toggle('active', val);
                }
            }
            const _immToggle = document.getElementById('immersive-toggle');
            if (_immToggle) _immToggle.classList.toggle('active', document.body.classList.contains('immersive-mode'));

            renderMessages();
        };

        const updateAvatar = (element, src) => {
            if (src) {
                element.innerHTML = `<img src="${src}" alt="avatar">`;
                // 同时写内存缓存，供 saveData 读取（不从 DOM img.src 读，不可靠）
                if (!window._avatarCache) window._avatarCache = {};
                if (element === DOMElements.partner.avatar) window._avatarCache.partner = src;
                else if (element === DOMElements.me.avatar) window._avatarCache.me = src;
            } else {
                element.innerHTML = `<i class="fas fa-user"></i>`;
                // src 为空时清缓存（用户主动删除头像）
                if (window._avatarCache) {
                    if (element === DOMElements.partner.avatar) window._avatarCache.partner = null;
                    else if (element === DOMElements.me.avatar) window._avatarCache.me = null;
                }
            }
        };

        const removeBackground = () => {
            document.documentElement.style.removeProperty('--chat-bg-image');
            document.body.classList.remove('with-background');
            localforage.removeItem(getStorageKey('chatBackground'));
            safeRemoveItem(getStorageKey('chatBackground'));
            showNotification('背景图片已移除', 'success');
        };

        window.scrollToQuotedMessage = function(el) {
            const id = el.getAttribute('data-reply-id');
            if (!id) return;
            const target = document.querySelector(`[data-msg-id="${id}"]`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.add('msg-highlight');
                setTimeout(() => target.classList.remove('msg-highlight'), 1500);
                return;
            }
            // 当前页面上没有这条消息（可能太老了，还没渲染到），统一走"定位到某条消息"这条路，
            // 不管这条消息有多老，只渲染它附近一小段，不会因为聊天记录长就变慢
            if (!window._jumpToMessage(id)) return;
            setTimeout(() => {
                const el2 = document.querySelector(`[data-msg-id="${id}"]`);
                if (el2) el2.classList.add('msg-highlight');
                setTimeout(() => { if (el2) el2.classList.remove('msg-highlight'); }, 1500);
            }, 60);
        };

// 红包封面解析：按「场景(card/open) × 发送方(我的/梦角)」取对应封面（dataURL），无则返回 ''（用内置浅米灰渐变）
function _redpacketCover(sender, scope) {
    try {
        const isUser = sender === 'user';
        const key = (scope === 'open' ? 'redpacketOpen' : 'redpacketCard')
            + (isUser ? 'MyCover' : 'PartnerCover');
        const c = (typeof settings === 'object' && settings) ? settings[key] : null;
        if (typeof c === 'string' && c) return c;
        // 兼容旧字段：card/open 均回退到旧封面
        const old = isUser ? settings.redpacketMyCover : settings.redpacketPartnerCover;
        return (typeof old === 'string' && old) ? old : '';
    } catch (e) { return ''; }
}
// 红包时间：跟随用户设置的时间戳样式（timeFormat），'off' 时不显示
function _rpTime(t) {
    try {
        const fmt = (typeof settings === 'object' && settings && settings.timeFormat) || 'HH:mm';
        if (fmt === 'off') return '';
        const ts = new Date(t);
        if (fmt === 'HH:mm:ss') return ts.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        if (fmt === 'h:mm AM/PM') return ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        if (fmt === 'h:mm:ss AM/PM') return ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
        return ts.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (e) { return ''; }
}
// 信封轮廓图标（参照参考图左下角的线条信封）
function _envelopeSVG() {
    return '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7.5l9 6 9-6"/></svg>';
}
// 红包消息在聊天气泡内的卡片 HTML：浅米灰主区支持自定义封面，底部状态栏/时间不变
function _redpacketCardHTML(msg) {
    const cover = _redpacketCover(msg.sender, 'card');
    const greeting = (msg && msg.text) ? String(msg.text) : '恭喜发财，大吉大利';
    const mid = String(msg.id).replace(/['"`\\]/g, '');
    const amount = '¥' + Number(msg && msg.amount || 0).toFixed(2);
    const time = _rpTime(msg && msg.timestamp);
    const opened = !!(msg && msg.opened);
    const status = opened
        ? '<span class="redpacket-card-check">✓</span>已领取'
        : '<span class="redpacket-card-check empty">◌</span>待领取';
    // 封面仅作用于主区背景；叠加浅色半透明遮罩保证文字可读，无封面时用 CSS 内置浅米灰渐变
    const mainStyle = cover
        ? 'background-image:linear-gradient(rgba(255,249,245,0.86),rgba(255,249,245,0.86)),url("' + _escapeHtml(cover) + '");'
        : '';
    const coverCls = cover ? ' redpacket-card-main-cover' : '';
    return '<div class="redpacket-card" data-id="' + _escapeHtml(mid) + '" data-mid="' + _escapeHtml(mid) + '" onclick="TransferFeature.openRedpacket(\'' + _escapeHtml(mid) + '\')">'
        + '<div class="redpacket-card-main' + coverCls + '" style="' + mainStyle + '">'
        +   '<span class="redpacket-card-env">' + _envelopeSVG() + '</span>'
        +   '<span class="redpacket-card-title">红包</span>'
        +   '<div class="redpacket-card-amount">' + _escapeHtml(amount) + '</div>'
        +   '<div class="redpacket-card-greeting">' + _escapeHtml(greeting) + '</div>'
        + '</div>'
        + '<div class="redpacket-card-foot">'
        +   '<span class="redpacket-card-status">' + status + '</span>'
        +   '<span class="redpacket-card-time">' + _escapeHtml(time) + '</span>'
        + '</div>'
        + '</div>';
}

// 「问问你」问题/回答卡片：韩系简约花边 + 虚线分隔，跟随系统主题
function _questionCardHTML(msg) {
    const q = _escapeHtml(msg.question || msg.text || '');
    const opts = Array.isArray(msg.options) ? msg.options : [];
    const answered = Array.isArray(msg.answer) && msg.answer.length > 0;
    const modeTag = (msg.choiceMode === 'multiple')
        ? '<span class="question-mode-tag">多选</span>'
        : '<span class="question-mode-tag">单选</span>';
    const icon = answered ? '💌' : '🌸';
    const marks = ['A','B','C','D','E','F','G','H','I','J'];
    let optsHtml = '';
    for (let i = 0; i < opts.length; i++) {
        const label = marks[i] || (i + 1);
        const v = _escapeHtml(opts[i]);
        let cls = 'question-option';
        let check = '';
        if (answered && msg.answer.indexOf(opts[i]) > -1) { cls += ' chosen'; check = '<span class="question-opt-check">✓</span>'; }
        optsHtml += '<div class="' + cls + '"><span class="question-opt-tag">' + label + '</span><span class="question-opt-text">' + v + '</span>' + check + '</div>';
    }
    let answerLine = '';
    if (answered) {
        const shown = msg.answer.map(function (a) { return _escapeHtml(String(a)); }).join('、');
        answerLine = '<div class="question-answer-line"><span class="question-answer-label">TA 的选择</span><span class="question-answer-val">' + shown + '</span></div>';
    }
    const mid = String(msg.id).replace(/['"`\\]/g, '');
    return '<div class="question-card' + (answered ? ' question-card-answer' : '') + '" data-mid="' + _escapeHtml(mid) + '">'
        + '<div class="question-card-q"><span class="question-card-icon">' + icon + '</span><span class="question-card-text">' + q + '</span>' + modeTag + '</div>'
        + '<div class="question-card-sep"></div>'
        + '<div class="question-card-options">' + optsHtml + '</div>'
        + answerLine
        + '</div>';
}

function createMessageFragment(msg, prevMsg, nextMsg, lastSenderRef) {
    const fragment = new DocumentFragment();
    const messageDate = new Date(msg.timestamp).toDateString();
    const prevDate = prevMsg ? new Date(prevMsg.timestamp).toDateString() : null;

    if (messageDate !== prevDate) {
        const dateDivider = document.createElement('div');
        dateDivider.className = 'date-divider';
        const today = new Date().toDateString();
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        const displayDate = (messageDate === today) ? '今天' : (messageDate === yesterday) ? '昨天' : new Date(msg.timestamp).toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        dateDivider.innerHTML = `<span>${displayDate}</span>`;
        fragment.appendChild(dateDivider);
        lastSenderRef.current = null;
    }

    if (msg.type === 'system') {
        const systemMsgDiv = document.createElement('div');
        systemMsgDiv.className = 'system-message';
        systemMsgDiv.textContent = msg.text;
        fragment.appendChild(systemMsgDiv);
        lastSenderRef.current = 'system';
        return fragment;
    }

    if (msg.type === 'call-event') {
        const callEvDiv = document.createElement('div');
        callEvDiv.className = 'call-event-message';
        callEvDiv.dataset.id = msg.id;
        const icon = msg.callIcon || 'fa-video';
        // 红色样式：通话拒绝/未接 + 陪伴拒绝/错过/取消
        const isRejected = icon === 'fa-phone-slash' ||
                           icon === 'fa-heart-crack' ||
                           icon === 'fa-circle-xmark';
        const colorClass = isRejected ? 'call-event-pill--rejected' : 'call-event-pill--ended';
        const detail = msg.callDetail ? '<span class="call-event-detail">' + _escapeHtml(msg.callDetail) + '</span>' : '';
        callEvDiv.innerHTML = '<div class="call-event-pill ' + colorClass + '"><i class="fas ' + icon + ' call-event-icon"></i><span class="call-event-label">' + _escapeHtml(msg.text.replace(/ · .*/, '')) + '</span>' + detail + '<button class="call-event-delete" title="删除" onclick="(function(btn){const id=btn.closest(\'[data-id]\').dataset.id;const idx=messages.findIndex(m=>String(m.id)===String(id));if(idx>-1){messages.splice(idx,1);renderMessages();throttledSaveData();}})(this)"><i class="fas fa-times"></i></button></div>';
        fragment.appendChild(callEvDiv);
        lastSenderRef.current = 'system';
        return fragment;
    }

    // 已撤回的消息：以居中的系统样式显示"X撤回了一条消息"
    if (msg.recalled) {
        const recallDiv = document.createElement('div');
        recallDiv.className = 'recall-message';
        const who = msg.sender === 'user'
            ? (settings.myName || '我')
            : (settings.partnerName || '对方');
        recallDiv.textContent = who + '撤回了一条消息';
        fragment.appendChild(recallDiv);
        lastSenderRef.current = 'system';
        return fragment;
    }

    let showTimestamp = true;
    if (settings.timeFormat === 'off') {
        showTimestamp = false;
    } else if (nextMsg) {
        const currentTs = new Date(msg.timestamp).getTime();
        const nextTs = new Date(nextMsg.timestamp).getTime();
        if (nextMsg.sender === msg.sender && nextMsg.type !== 'system' && (nextTs - currentTs < 60000)) {
            showTimestamp = false;
        }
    }

    let isLastInSenderGroup = true;
    if (nextMsg) {
        const currentTs = new Date(msg.timestamp).getTime();
        const nextTs = new Date(nextMsg.timestamp).getTime();
        if (nextMsg.sender === msg.sender && nextMsg.type !== 'system' && (nextTs - currentTs < 60000)) {
            isLastInSenderGroup = false;
        }
    }

    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${msg.sender === 'user' ? 'sent' : 'received'}`;
    wrapper.dataset.id = msg.id;
    wrapper.dataset.msgId = msg.id;

    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar';
    if (settings.inChatAvatarPosition === 'custom' && settings.inChatAvatarCustomOffset !== undefined) {
        avatarDiv.style.marginTop = settings.inChatAvatarCustomOffset + 'px';
    }

    if (settings.inChatAvatarEnabled) {
        const isSameSender = msg.sender === lastSenderRef.current;
        const shouldHide = !settings.alwaysShowAvatar && isSameSender;
        if (shouldHide) {
            avatarDiv.classList.add('hidden');
        } else {
            const isUser = msg.sender === 'user';
            const avatarElement = isUser ? DOMElements.me.avatar : DOMElements.partner.avatar;
            const frameSettings = isUser ? settings.myAvatarFrame : settings.partnerAvatarFrame;
            const avatarShape = isUser ? (settings.myAvatarShape || 'circle') : (settings.partnerAvatarShape || 'circle');
            avatarDiv.innerHTML = avatarElement.innerHTML;
            applyAvatarFrame(avatarDiv, frameSettings);
            ['circle', 'square', 'pentagon', 'heart'].forEach(s => avatarDiv.classList.remove('shape-' + s));
            if (avatarShape !== 'none') avatarDiv.classList.add('shape-' + avatarShape);
        }
    } else {
        avatarDiv.style.display = 'none';
    }
    wrapper.appendChild(avatarDiv);

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-content-wrapper';

    if (msg.sender !== 'user' && msg.sender !== null && (settings.showPartnerNameInChat || showPartnerNameInChat)) {
        const isSameSenderForName = lastSenderRef.current === msg.sender;
        if (!isSameSenderForName) {
            const nameLabel = document.createElement('div');
            nameLabel.className = 'group-sender-name';
            nameLabel.textContent = settings.partnerName || msg.sender || '对方';
            contentWrapper.appendChild(nameLabel);
        }
    }

    let messageHTML = '';
    if (msg.replyTo) {
        const quotedRecalled = msg.replyTo.id ? messages.some(m => m.id === msg.replyTo.id && m.recalled) : false;
        const repliedText = quotedRecalled
            ? '该消息已被撤回'
            : _escapeHtml(msg.replyTo.text || (msg.replyTo.voice ? '语音 ' + (msg.replyTo.voice.duration || 0) + '"' : (msg.replyTo.image ? '🖼 图片' : '[消息]')));
        const repliedSender = _escapeHtml(msg.replyTo.sender === 'user' ? (settings.myName || '我') : (settings.partnerName || '对方'));
        messageHTML += `<div class="reply-indicator" data-reply-id="${msg.replyTo.id || ''}" style="cursor:pointer;" onclick="scrollToQuotedMessage(this)"><span class="reply-indicator-sender">${repliedSender}</span><span class="reply-indicator-text">${repliedText}</span></div>`;
    }

    const isRedpacket = msg.type === 'redpacket';
    const isQuestion = msg.type === 'question';
    const isImageOnly = !msg.text && !!msg.image;
    let content = '';
    if (isRedpacket) {
        content = _redpacketCardHTML(msg);
    } else if (isQuestion) {
        content = _questionCardHTML(msg);
    } else {
        content = msg.text ? '<div>' + _escapeHtml(msg.text).replace(/\n/g, '<br>') + '</div>' : '';
    }
    if (msg.image && !isRedpacket) {
        // 阶段三B：识别 oss:// 走懒加载；识别 pending:// 走本地 base64 + 上传中角标
        const isCloudImg = typeof msg.image === 'string' && msg.image.indexOf('oss://') === 0;
        const isPendingImg = typeof msg.image === 'string' && msg.image.indexOf('pending://') === 0;
        // 优化：onclick 不再内嵌整段 base64 图片地址（原来 <img> 的 HTML 里 src 和 onclick 各带一份，
        // 消息里图片多时字符串翻倍、每次 renderMessages 都要重解析一遍超长 HTML），
        // 改成 onclick="window._viewMsgImage(this)"，点击时按消息 id 从内存取最新图片地址，行为完全一致。
        const imgAttrs = `class="message-image${isImageOnly ? ' message-image-only' : ''}" alt="图片" loading="lazy" decoding="async" style="max-width:${isImageOnly ? '100px' : '100px'}; border-radius: 12px;${!isImageOnly ? ' margin-top: 6px;' : ''} cursor: pointer;" onclick="window._viewMsgImage(this)"`;
        if (isCloudImg) {
            content += `<img data-lazy-cloud-ref="${_escapeHtml(msg.image)}" ${imgAttrs}>`;
        } else if (isPendingImg) {
            // 用一个包裹层放"上传中"角标
            content += `<div class="message-image-pending-wrap" style="position:relative;display:inline-block;">`
                + `<img data-pending-ref="${_escapeHtml(msg.image)}" ${imgAttrs}>`
                + `<div class="upload-indicator" style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,0.55);color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;"><i class="fas fa-cloud-upload-alt"></i></div>`
                + `</div>`;
        } else {
            content += `<img src="${_escapeHtml(msg.image)}" ${imgAttrs}>`;
        }
    }
    messageHTML += content;

    const messageDiv = document.createElement('div');
    if (isRedpacket) {
        messageDiv.className = `message message-${msg.sender === 'user' ? 'sent' : 'received'} message-redpacket-bubble`;
    } else if (isQuestion) {
        messageDiv.className = `message message-${msg.sender === 'user' ? 'sent' : 'received'} message-question-bubble`;
    } else if (isImageOnly) {
        messageDiv.className = `message message-${msg.sender === 'user' ? 'sent' : 'received'} message-image-bubble-none`;
    } else {
        messageDiv.className = `message message-${msg.sender === 'user' ? 'sent' : 'received'} ${settings.bubbleStyle}`;
    }
    messageDiv.innerHTML = messageHTML;
    // 阶段三B：innerHTML 塞完后，找带 data-lazy-cloud-ref 的图绑定懒加载
    if (window.CloudMedia) {
        messageDiv.querySelectorAll('img[data-lazy-cloud-ref]').forEach(function (imgEl) {
            const ref = imgEl.getAttribute('data-lazy-cloud-ref');
            window.CloudMedia.bindLazyImage(imgEl, ref);
        });
        // 阶段三B：pending 图从本地 base64 显示
        messageDiv.querySelectorAll('img[data-pending-ref]').forEach(function (imgEl) {
            const ref = imgEl.getAttribute('data-pending-ref');
            window.CloudMedia.bindPendingImage(imgEl, ref);
        });
    }

    let actionsHTML = '';
    if (settings.replyEnabled) actionsHTML += `<button class="meta-action-btn reply-btn" title="回复"><i class="fas fa-reply"></i></button>`;
    const starIcon = msg.favorited ? 'fas fa-star' : 'far fa-star';
    actionsHTML += `<button class="meta-action-btn favorite-action-btn ${msg.favorited ? 'favorited' : ''}" title="${msg.favorited ? '取消收藏' : '收藏'}"><i class="${starIcon}"></i></button>`;
    if (msg.sender === 'user' && !msg.recalled) actionsHTML += `<button class="meta-action-btn recall-btn" title="撤回"><i class="fas fa-undo"></i></button>`;
    actionsHTML += `<button class="meta-action-btn delete-btn" title="删除"><i class="fas fa-trash-alt"></i></button>`;
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-meta-actions';
    actionsDiv.innerHTML = actionsHTML;

    let metaHTML = '';
    if (showTimestamp) {
        const ts = new Date(msg.timestamp);
        let timeStr;
        const fmt = settings.timeFormat || 'HH:mm';
        if (fmt === 'HH:mm:ss') {
            timeStr = ts.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        } else if (fmt === 'h:mm AM/PM') {
            timeStr = ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        } else if (fmt === 'h:mm:ss AM/PM') {
            timeStr = ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
        } else {
            timeStr = ts.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
        }
        metaHTML += `<div class="timestamp">${timeStr}</div>`;
    }

    if (msg.sender === 'user' && settings.readReceiptsEnabled && isLastInSenderGroup) {
        const rrStyle = settings.readReceiptStyle || 'icon';
        if (rrStyle === 'text') {
            if (msg.status === 'read') {
                metaHTML += `<div class="read-receipt read" style="font-size:9px;letter-spacing:0.3px;font-weight:500;">已读</div>`;
            } else {
                metaHTML += `<div class="read-receipt" style="font-size:9px;letter-spacing:0.3px;opacity:0.5;">未读</div>`;
            }
        } else {
            const statusIcon = msg.status === 'read' ? 'fa-check-double' : 'fa-check';
            metaHTML += `<div class="read-receipt ${msg.status === 'read' ? 'read' : ''}"><i class="fas ${statusIcon}"></i></div>`;
        }
    }

    if (metaHTML !== '') {
        const metaDiv = document.createElement('div');
        metaDiv.className = 'message-meta';
        if (!showTimestamp && !metaHTML.includes('timestamp')) {
            metaDiv.style.height = 'auto';
            metaDiv.style.marginTop = '2px';
            if (settings.inChatAvatarPosition !== 'top') {
                avatarDiv.style.marginBottom = '18px';
            }
        } else {
            if (settings.inChatAvatarPosition !== 'top') {
                avatarDiv.style.marginBottom = '26px';
            }
        }
        metaDiv.innerHTML = metaHTML;
        contentWrapper.append(actionsDiv, messageDiv, metaDiv);
    } else {
        contentWrapper.append(actionsDiv, messageDiv);
    }
    wrapper.appendChild(contentWrapper);
    fragment.appendChild(wrapper);

    lastSenderRef.current = msg.sender;
    return fragment;
}

function _updateReadReceiptsDOM() {
    const container = DOMElements.chatContainer;
    const rrStyle = settings.readReceiptStyle || 'icon';
    container.querySelectorAll('.message-wrapper.sent').forEach(wrapper => {
        const receiptEl = wrapper.querySelector('.read-receipt');
        if (!receiptEl) return;
        const msgId = wrapper.dataset.msgId || wrapper.dataset.id;
        const msg = messages.find(m => String(m.id) === String(msgId));
        if (!msg || msg.status !== 'read') return;
        if (rrStyle === 'text') {
            receiptEl.classList.add('read');
            receiptEl.textContent = '已读';
            receiptEl.style.opacity = '1';
        } else {
            receiptEl.classList.add('read');
            const icon = receiptEl.querySelector('i');
            if (icon) icon.className = 'fas fa-check-double';
        }
    });
}

function renderMessages(preserveScroll = false) {
    const container = DOMElements.chatContainer;
    const totalMessages = messages.length;

    let startIndex, endIndex, msgsToRender;
    if (msgViewMode === 'window') {
        // 历史浏览模式：只渲染 [msgWinStart, msgWinEnd) 这一小段，不管这段离最新消息有多远，
        // 渲染量都是恒定的，不会因为聊天记录变长就跟着变慢
        startIndex = Math.max(0, Math.min(msgWinStart, totalMessages));
        endIndex = Math.max(startIndex, Math.min(msgWinEnd, totalMessages));
        msgsToRender = messages.slice(startIndex, endIndex);
    } else {
        startIndex = Math.max(0, totalMessages - displayedMessageCount);
        endIndex = totalMessages;
        msgsToRender = messages.slice(startIndex);
    }

    const historyLoader = document.getElementById('history-loader');
    if (historyLoader) {
        historyLoader.style.display = startIndex > 0 ? 'flex' : 'none';
    }
    const futureLoader = document.getElementById('future-loader');
    if (futureLoader) {
        futureLoader.style.display = (msgViewMode === 'window' && endIndex < totalMessages) ? 'flex' : 'none';
    }

    DOMElements.emptyState.style.display = totalMessages === 0 ? 'flex' : 'none';

    const oldScrollHeight = container.scrollHeight;
    const oldScrollTop = container.scrollTop;
    
    container.innerHTML = '';

    const fragment = new DocumentFragment();
    
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    fragment.appendChild(spacer);

    let lastSenderRef = { current: null };
    msgsToRender.forEach((msg, i) => {
        const prevMsg = i > 0 ? msgsToRender[i - 1] : (startIndex > 0 ? messages[startIndex - 1] : null);
        const nextMsg = i < msgsToRender.length - 1 ? msgsToRender[i + 1] : null;
        const msgFragment = createMessageFragment(msg, prevMsg, nextMsg, lastSenderRef);
        fragment.appendChild(msgFragment);
    });

    container.appendChild(fragment);

    if (preserveScroll) {
        const newScrollHeight = container.scrollHeight;
        container.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
    } else if (msgViewMode !== 'window') {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
        });
    }
    // window模式下不自动滚动到底部/顶部，滚动位置由调用方（比如跳转定位）自己处理
}

// 跳转到某一条消息（搜索结果点击、引用消息点击都可以用这个统一入口），
// 不管这条消息离最新消息有多远，只渲染它附近一小段，不会因为聊天记录很长就卡顿
window._jumpToMessage = function(id) {
    const idx = messages.findIndex(m => String(m.id) === String(id));
    if (idx === -1) {
        if (typeof showNotification === 'function') showNotification('这条消息可能已被删除', 'info');
        return false;
    }

    const container = DOMElements && DOMElements.chatContainer;
    if (!container) return false;

    const HALF = Math.max(10, Math.floor(_getVirtualWindowSize() / 2)); // 目标消息前后各带半屏上下文，渲染量恒定，不会因为消息在哪个位置而变化
    msgViewMode = 'window';
    msgWinStart = Math.max(0, idx - HALF);
    msgWinEnd = Math.min(messages.length, idx + HALF + 1);
    newMsgCountWhileBrowsing = 0;

    renderMessages(false);

    requestAnimationFrame(() => {
        const el = container.querySelector('[data-msg-id="' + id + '"]');
        if (el) {
            el.scrollIntoView({ behavior: 'auto', block: 'center' });
            el.style.transition = 'background .3s ease';
            el.style.background = 'rgba(var(--accent-color-rgb),.14)';
            setTimeout(() => { el.style.background = ''; }, 1800);
        }
        if (typeof window._updateBackToLatestBtn === 'function') window._updateBackToLatestBtn();
        if (typeof window._updateNewMsgIndicator === 'function') window._updateNewMsgIndicator();
    });
    return true;
};

// 从历史浏览模式回到最新消息——切回正常模式，重置成"只看最近一批"，然后自动滚到底部
window._backToLatestMessages = function() {
    msgViewMode = 'latest';
    displayedMessageCount = HISTORY_BATCH_SIZE;
    newMsgCountWhileBrowsing = 0;
    renderMessages(false);
    if (typeof window._updateBackToLatestBtn === 'function') window._updateBackToLatestBtn();
    if (typeof window._updateNewMsgIndicator === 'function') window._updateNewMsgIndicator();
};

// "回到最新消息"悬浮按钮的显示/隐藏——判断标准跟自动滚动是同一套：只要没追上底部就显示
window._updateBackToLatestBtn = function() {
    const btn = document.getElementById('back-to-latest-btn');
    if (!btn) return;
    btn.style.display = _isCaughtUpToLatest() ? 'none' : 'flex';
};

// "有N条新消息"提示——文案套在同一个按钮上，不额外加控件
window._updateNewMsgIndicator = function() {
    const btn = document.getElementById('back-to-latest-btn');
    const label = document.getElementById('back-to-latest-label');
    if (!btn || !label) return;
    if (msgViewMode === 'window' && newMsgCountWhileBrowsing > 0) {
        label.textContent = '有' + newMsgCountWhileBrowsing + '条新消息';
        btn.classList.add('has-new-msg');
    } else {
        label.textContent = '';
        btn.classList.remove('has-new-msg');
    }
};


// 判断"用户现在是不是正停在聊天最底部"——不看是通过什么方式到达当前位置的（正常聊天时手指往上划了一点、
// 还是从搜索/引用跳转过来的历史记录），只看两件事：① 当前渲染的这一段有没有已经连到最新消息；
// ② 滚动条实际位置离底部够不够近。两个都满足才算"追上了"，新消息来的时候才会自动帮你滚下去。
function _isCaughtUpToLatest() {
    if (msgViewMode === 'window' && msgWinEnd < messages.length) return false; // 当前渲染的窗口本来就没到最新，不管怎么滚都不算追上
    const c = DOMElements && DOMElements.chatContainer;
    if (!c) return true;
    return (c.scrollHeight - c.scrollTop - c.clientHeight) < 100;
}

const addMessage = (message) => {
    if (!(message.timestamp instanceof Date)) message.timestamp = new Date(message.timestamp);
    
    const container = DOMElements.chatContainer;
    const wasEmpty = messages.length === 0;

    const prevMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    // 追没追上底部，要在"往数组里塞新消息、改动滚动高度"之前就先判断好，不然滚动高度已经变了，判断就不准了
    const wasCaughtUp = _isCaughtUpToLatest();
    messages.push(message);
    window._markChatDataChanged();
    
    if (wasEmpty) {
        DOMElements.emptyState.style.display = 'none';
    }

    // 用户自己发的新消息：不能让它发出去后自己却看不到，不管之前在不在底部，都直接跳回/滚到最新（所有聊天软件的通用逻辑）
    if (message.sender === 'user') {
        if (msgViewMode === 'window') {
            throttledSaveData();
            if (message.type === 'normal' && typeof window._onUserMessage === 'function') {
                try { window._onUserMessage(message); } catch (e) { console.warn('[onUserMessage]', e); }
            }
            if (typeof window._backToLatestMessages === 'function') window._backToLatestMessages();
            return;
        }
        // 已经在 latest 模式，走下面正常的"追加+滚动到底"逻辑即可（wasCaughtUp 对用户自己发消息没意义，永远滚底）
    } else if (!wasCaughtUp) {
        // 对方发来新消息，但用户当前没有停在底部（不管是因为在翻很久以前的历史记录，
        // 还是就是正常聊天时手指往上划了一点点）——新消息不硬塞进当前视野、也不强行拽人，只悄悄计数提示
        if (msgViewMode === 'window' && msgWinEnd < messages.length) {
            // 窗口本来就没连到最新，DOM里没法接着往后加，直接跳过渲染这一步
        } else {
            // 处于 latest 模式但没在底部：消息本身仍然要能在"滚到底"之后看到，所以还是要把DOM追加上，只是不强制滚动
            const existingWrappers = container.querySelectorAll('.message-wrapper');
            const lastWrapper = existingWrappers.length > 0 ? existingWrappers[existingWrappers.length - 1] : null;
            if (lastWrapper && prevMsg) {
                const currentTs = new Date(message.timestamp).getTime();
                const prevTs = new Date(prevMsg.timestamp).getTime();
                if (message.sender === prevMsg.sender && message.type === 'normal' && prevMsg.type === 'normal' && (currentTs - prevTs < 60000)) {
                    const metaEl = lastWrapper.querySelector('.message-meta');
                    if (metaEl) metaEl.style.display = 'none';
                    const avatarEl = lastWrapper.querySelector('.message-avatar');
                    if (avatarEl) avatarEl.style.marginBottom = '';
                }
            }
            let lastSenderRef = { current: null };
            if (prevMsg) {
                lastSenderRef.current = prevMsg.sender;
            }
            const newMsgFragment = createMessageFragment(message, prevMsg, null, lastSenderRef);
            const spacer = container.querySelector('div[style*="flex: 1"]');
            if (spacer && spacer === container.lastElementChild) {
                spacer.before(newMsgFragment);
            } else {
                container.appendChild(newMsgFragment);
            }
            // 连续收发消息时回收 DOM 顶部的旧消息：停留在底部不会触发 scroll，原先消息节点会无限累积
            // （含 base64 图片的 wrapper 越来越多，每次追加/重排都变慢），这里每次追加后都限制 DOM 总量
            if (typeof _trimLatestModeTop === 'function') { try { _trimLatestModeTop(); } catch (e) {} }
        }
        newMsgCountWhileBrowsing++;
        if (typeof window._updateNewMsgIndicator === 'function') window._updateNewMsgIndicator();
        if (typeof window._updateBackToLatestBtn === 'function') window._updateBackToLatestBtn();
        throttledSaveData();
        if (message.type === 'normal' && typeof window._onPartnerMessage === 'function') {
            try { window._onPartnerMessage(message); } catch (e) { console.warn('[onPartnerMessage]', e); }
        }
        if (message.type === 'normal' && Array.isArray(window._partnerMessageListeners)) {
            window._partnerMessageListeners.forEach(function (fn) {
                try { fn(message); } catch (e) { console.warn('[onPartnerMessage:listener]', e); }
            });
        }
        return;
    }

    // --- 正常情况：用户自己发消息、或对方发消息时用户本来就在底部 —— 追加消息并滚动到底 ---
    // --- Update previous message if needed ---
    const existingWrappers = container.querySelectorAll('.message-wrapper');
    const lastWrapper = existingWrappers.length > 0 ? existingWrappers[existingWrappers.length - 1] : null;
    if (lastWrapper && prevMsg) {
        const currentTs = new Date(message.timestamp).getTime();
        const prevTs = new Date(prevMsg.timestamp).getTime();

        if (message.sender === prevMsg.sender && message.type === 'normal' && prevMsg.type === 'normal' && (currentTs - prevTs < 60000)) {
            const metaEl = lastWrapper.querySelector('.message-meta');
            if (metaEl) metaEl.style.display = 'none';
            const avatarEl = lastWrapper.querySelector('.message-avatar');
            if (avatarEl) avatarEl.style.marginBottom = '';
        }
    }
    
    // --- Append new message ---
    let lastSenderRef = { current: null };
    if (prevMsg) {
        lastSenderRef.current = prevMsg.sender;
    }
    
    const newMsgFragment = createMessageFragment(message, prevMsg, null, lastSenderRef);
    
    const spacer = container.querySelector('div[style*="flex: 1"]');
    if (spacer && spacer === container.lastElementChild) {
        spacer.before(newMsgFragment);
    } else {
        container.appendChild(newMsgFragment);
    }

    // 连续收发消息时回收 DOM 顶部的旧消息：停留在底部不会触发 scroll，原先消息节点会无限累积，
    // 这里每次追加后都限制 DOM 总量，避免"连续操作越来越卡"（与上面的未追底分支逻辑一致）
    if (typeof _trimLatestModeTop === 'function') { try { _trimLatestModeTop(); } catch (e) {} }

    requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
    });

    throttledSaveData();

    // 钩子：通知陪伴模块"梦角刚说了一句话"，让陪伴页可以同步显示气泡
    // 只对梦角的普通消息触发（不是用户消息、不是 system call-event 等）
    // 保留原有的单函数赋值方式（陪伴模块在用，不改动，避免影响它）
    if (message.sender !== 'user' && message.type === 'normal' && typeof window._onPartnerMessage === 'function') {
        try { window._onPartnerMessage(message); } catch (e) { console.warn('[onPartnerMessage]', e); }
    }
    // 新增：多监听通道，供电影院等新模块注册，跟上面那个单函数钩子并行、互不覆盖
    if (message.sender !== 'user' && message.type === 'normal' && Array.isArray(window._partnerMessageListeners)) {
        window._partnerMessageListeners.forEach(function (fn) {
            try { fn(message); } catch (e) { console.warn('[onPartnerMessage:listener]', e); }
        });
    }
    // 钩子：通知陪伴模块"用户刚发了一条消息"，让陪伴页气泡同步显示
    if (message.sender === 'user' && message.type === 'normal' && typeof window._onUserMessage === 'function') {
        try { window._onUserMessage(message); } catch (e) { console.warn('[onUserMessage]', e); }
    }
};

        window.addMessage = addMessage; // 暴露给其他模块（转账/红包）向聊天注入消息

        window._addCallEvent = (icon, label, detail) => {
            addMessage({
                id: Date.now() + Math.random(),
                sender: 'system',
                text: label + (detail ? ' · ' + detail : ''),
                timestamp: new Date(),
                status: 'received',
                type: 'call-event',
                callIcon: icon || 'fa-video',
                callDetail: detail || null,
                favorited: false,
                note: null,
            });
        };

        function optimizeImage(file, maxWidth = 800, quality = 0.7) {
            return new Promise((resolve, reject) => {
                if (file.size < 300 * 1024) {
                    const reader = new FileReader();
                    reader.onload = e => resolve(e.target.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                    return;
                }
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    let {
                        width,
                        height
                    } = img;
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                    URL.revokeObjectURL(img.src);
                };
                img.onerror = () => {
                    const reader = new FileReader();
                    reader.onload = e => resolve(e.target.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                    URL.revokeObjectURL(img.src);
                };
                img.src = URL.createObjectURL(file);
            });
        }

        window.updateReplyPreview = function() {
            const container = DOMElements.replyPreviewContainer;
            if (!container) return;
            if (!currentReplyTo) {
                container.innerHTML = '';
                container.style.display = 'none';
                return;
            }
            const senderName = currentReplyTo.sender === 'user' ? (settings.myName || '我') : (settings.partnerName || '对方');
            const previewText = currentReplyTo.text ? currentReplyTo.text.slice(0, 40) : (currentReplyTo.voice ? `语音 ${currentReplyTo.voice.duration || 0}"` : '🖼 图片');
            container.style.display = 'flex';
            container.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(var(--accent-color-rgb),0.07);border-left:3px solid var(--accent-color);border-radius:0 8px 8px 0;width:100%;">
                    <div style="flex:1;min-width:0;">
                        <span style="font-size:11px;color:var(--accent-color);font-weight:600;">回复 ${senderName}</span>
                        <div style="font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${previewText}</div>
                    </div>
                    <button onclick="currentReplyTo=null;window.updateReplyPreview();" style="background:none;border:none;cursor:pointer;color:var(--text-secondary);padding:2px 4px;font-size:14px;">✕</button>
                </div>`;
        };
        function updateReplyPreview() { window.updateReplyPreview(); }

        // ── 对方拍一拍核心逻辑（提取为独立函数，供随机触发和测试指令共用）──
        window._triggerPartnerPoke = function() {
            let pokeAction = null;

            const groups = window.customPokeGroups || [];
            const allPokes = (typeof customPokes !== 'undefined' ? customPokes : []) || [];

            const enabledGroups = groups.filter(function(g) {
                return !g.disabled && Array.isArray(g.items) && g.items.length > 0;
            });

            const groupedItems = new Set();
            enabledGroups.forEach(function(g) { g.items.forEach(function(t) { groupedItems.add(t); }); });

            const ungroupedPokes = allPokes.filter(function(t) { return !groupedItems.has(t); });

            if (enabledGroups.length > 0) {
                const pickedGroup = enabledGroups[Math.floor(Math.random() * enabledGroups.length)];
                const groupPool = pickedGroup.items.filter(function(t) { return allPokes.includes(t); });
                if (groupPool.length > 0) {
                    pokeAction = groupPool[Math.floor(Math.random() * groupPool.length)];
                }
            }

            if (!pokeAction && ungroupedPokes.length > 0) {
                pokeAction = ungroupedPokes[Math.floor(Math.random() * ungroupedPokes.length)];
            }
            if (!pokeAction && allPokes.length > 0) {
                pokeAction = allPokes[Math.floor(Math.random() * allPokes.length)];
            }
            if (!pokeAction && CONSTANTS.POKE_ACTIONS && CONSTANTS.POKE_ACTIONS.length > 0) {
                pokeAction = getRandomItem(CONSTANTS.POKE_ACTIONS);
            }
            if (!pokeAction) {
                if (typeof showNotification === 'function') showNotification('拍一拍库为空，请先添加内容', 'warning', 2500);
                return;
            }

            if (typeof window._sanitizePokeTextForDisplay === 'function') {
                pokeAction = window._sanitizePokeTextForDisplay(pokeAction);
            }
            const pokeText = (typeof window._formatPartnerPokeText === 'function')
                ? window._formatPartnerPokeText(`${settings.partnerName} ${pokeAction}`)
                : `${settings.partnerName} ${pokeAction}`;

            addMessage({ id: Date.now(), text: pokeText, timestamp: new Date(), type: 'system' });
            if (typeof playSound === 'function') playSound('partner_poke');
            // 拍一拍归属"普通消息"：弹普通通知
            if (typeof window._sendPartnerNotification === 'function') {
                window._sendPartnerNotification(settings.partnerName || '对方', pokeText);
            }
            (function(){try{if(window._typingIndicatorAutoHideTimer){clearTimeout(window._typingIndicatorAutoHideTimer);window._typingIndicatorAutoHideTimer=null;}}catch(e){}var _tiW=document.getElementById('typing-indicator-wrapper');if(_tiW){var _tiInner=_tiW.querySelector('.typing-indicator');if(_tiInner){_tiInner.classList.add('hiding');setTimeout(function(){_tiW.style.display='none';if(_tiInner)_tiInner.classList.remove('hiding');},240);}else{_tiW.style.display='none';}}})();
        };

        // ── 对方撤回消息核心逻辑：随机撤回一条梦角最近发出的普通消息 ──
        window._triggerPartnerRecall = function() {
            try {
                if (!messages || !messages.length) return;
                var candidates = [];
                for (var i = messages.length - 1; i >= 0; i--) {
                    var m = messages[i];
                    if (m.sender === 'user' || m.type === 'system' || m.type === 'call-event') continue;
                    if (m.recalled || !m.text) continue;
                    candidates.push(m);
                    if (candidates.length >= 5) break;
                }
                if (!candidates.length) return;
                var target = candidates[Math.floor(Math.random() * candidates.length)];
                target.recalled = true;
                window._markChatDataChanged();
                if (typeof throttledSaveData === 'function') throttledSaveData();
                if (typeof renderMessages === 'function') renderMessages(true);
            } catch (e) {}
        };

        function sendMessage(textOverride = null, type = 'normal') {
            const text = textOverride || DOMElements.messageInput.value.trim();
            const imageFile = DOMElements.imageInput.files[0];
            if (!text && !imageFile && type === 'normal') return;

            // ── 斜杠指令拦截 ──
            if (text && text.startsWith('/') && type === 'normal') {
                const cmd = text.replace(/\s+/g, '').toLowerCase();
                if (cmd === '/测试拍一拍' || cmd === '/testpoke') {
                    DOMElements.messageInput.value = '';
                    DOMElements.messageInput.style.height = '46px';
                    if (typeof window._triggerPartnerPoke === 'function') window._triggerPartnerPoke();
                    if (typeof showNotification === 'function') showNotification('✦ 强制触发对方拍一拍', 'info', 1800);
                    return;
                }
                if (cmd === '/测试状态更新' || cmd === '/teststatus') {
                    DOMElements.messageInput.value = '';
                    DOMElements.messageInput.style.height = '46px';
                    if (typeof window._triggerStatusChange === 'function') window._triggerStatusChange();
                    if (typeof showNotification === 'function') showNotification('✦ 强制触发状态更新', 'info', 1800);
                    return;
                }
            }

            DOMElements.messageInput.value = '';
            DOMElements.messageInput.style.height = '46px';
            if (imageFile && imageFile.size > MAX_IMAGE_SIZE) {
                showNotification('图片大小不能超过5MB', 'error'); DOMElements.imageInput.value = ''; return;
            }

            const createMessage = (imgSrc = null) => {
                const messageData = {
                    id: Date.now(),
                    sender: 'user',
                    text: text || '',
                    timestamp: new Date(),
                    image: imgSrc,
                    status: 'sent',
                    favorited: false,
                    note: null,
                    replyTo: currentReplyTo,
                    type: type
                };
                if (type === 'system') messageData.sender = null;

                addMessage(messageData);
                if (type !== 'system') playSound('send');
                currentReplyTo = null;
                updateReplyPreview();

if (!isBatchMode && type === 'normal') {
    // 触发延迟回复（真实用户消息 → isUserMessage = true）
    window._triggerDelayedReply(true);
}
};

            if (imageFile) {
                showNotification('正在优化图片...', 'info', 1500);
                optimizeImage(imageFile).then(createMessage).catch(() => showNotification('图片处理失败', 'error'));
            } else {
                createMessage();
            }
            DOMElements.imageInput.value = '';
        }

        function toggleBatchMode() {
            isBatchMode = !isBatchMode;
            DOMElements.batchBtn.classList.toggle('active', isBatchMode);
            DOMElements.batchBtn.title = isBatchMode ? "退出批量模式": "批量发送模式";
            DOMElements.batchPreview.style.display = isBatchMode ? 'flex': 'none';
            const placeholder = "";
            DOMElements.messageInput.placeholder = isBatchMode ? "此刻，想说的有很多很多...": (placeholder.length > 20 ? placeholder.substring(0, 20) + "...": placeholder);
            if (isBatchMode) {
                batchMessages = []; updateBatchPreview();
            }
        }

        function addToBatch(imageOverride = null) {
            const text = DOMElements.messageInput.value.trim();
            if (!text && !imageOverride) return;
            batchMessages.push({
                id: Date.now() + batchMessages.length, text: text || '', image: imageOverride || null
            });
            DOMElements.messageInput.value = ''; DOMElements.messageInput.style.height = '46px';
            updateBatchPreview();
        }

        function updateBatchPreview() {
            const previewContainer = DOMElements.batchPreview;
            let listHTML = '';
            if (batchMessages.length > 0) {
                listHTML = batchMessages.map((msg, index) => {
                    // 阶段三B：识别 oss:// 走懒加载（预览不设 src，塞完 innerHTML 后绑定）
                    let preview = '';
                    if (msg.image) {
                        const isCloudImg = typeof msg.image === 'string' && msg.image.indexOf('oss://') === 0;
                        if (isCloudImg) {
                            preview = `<img data-lazy-cloud-ref="${msg.image}" style="height:36px;width:36px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:6px;">`;
                        } else {
                            preview = `<img src="${msg.image}" style="height:36px;width:36px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:6px;">`;
                        }
                    }
                    const label = msg.text
                        ? `<span class="batch-preview-text">${msg.text}</span>`
                        : `<span class="batch-preview-text" style="color:var(--text-secondary);font-style:italic;">图片</span>`;
                    return `<div class="batch-preview-item" data-index="${index}">${preview}${label}<button class="batch-preview-edit" title="编辑"><i class="fas fa-pencil-alt"></i></button><button class="batch-preview-remove"><i class="fas fa-times"></i></button></div>`;
                }).join('');
            } else {
                listHTML = '<div style="text-align: center; color: var(--text-secondary); font-size: 14px; padding: 10px;">つ♡⊂</div>';
            }

            previewContainer.innerHTML = `
        <div class="batch-preview-title">我有很多的话想说…！</div>
        <div class="batch-actions-top" style="display:flex;gap:6px;padding:4px 10px 0;"><label style="flex:1;display:flex;align-items:center;justify-content:center;gap:5px;padding:5px 8px;background:var(--secondary-bg);border:1px solid var(--border-color);border-radius:8px;cursor:pointer;font-size:12px;color:var(--text-secondary);"><i class="fas fa-image"></i>添加图片<input type="file" accept="image/*" style="display:none;" id="batch-image-input"></label></div>
        <div class="batch-preview-list">${listHTML}</div>
        <div class="batch-actions">
        <button class="batch-action-btn batch-cancel-btn">取消</button>
        <button class="batch-action-btn batch-send-btn" ${batchMessages.length === 0 ? 'disabled': ''}>发送全部 (${batchMessages.length})</button>
        </div>`;

            // 阶段三B：innerHTML 塞完后绑定云端图懒加载
            if (window.CloudMedia) {
                previewContainer.querySelectorAll('img[data-lazy-cloud-ref]').forEach(function (imgEl) {
                    const ref = imgEl.getAttribute('data-lazy-cloud-ref');
                    window.CloudMedia.bindLazyImage(imgEl, ref);
                });
            }

            const batchImgInput = document.getElementById('batch-image-input');
            if (batchImgInput) {
                batchImgInput.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    if (file.size > MAX_IMAGE_SIZE) { showNotification('图片超过5MB限制', 'warning'); return; }
                    try {
                        const base64 = await optimizeImage(file, 600, 0.8);
                        addToBatch(base64);
                    } catch(err) { showNotification('图片处理失败', 'error'); }
                    e.target.value = '';
                });
            }
        }

        function sendBatchMessages() {
            if (batchMessages.length === 0) return;
            showNotification(`正在发送 ${batchMessages.length} 条消息...`, 'info', 2000);
            batchMessages.forEach((msg, index) => {
                setTimeout(() => {
                    addMessage({
                        id: Date.now() + index, sender: 'user', text: msg.text || '', image: msg.image || null, timestamp: new Date(), status: 'sent', favorited: false, type: 'normal'
                    });
                    playSound('send');
                }, index * 300);
            });
            const delayRange = settings.replyDelayMax - settings.replyDelayMin;
            const randomDelay = settings.replyDelayMin + Math.random() * delayRange;
            window._replyScheduledAt = Date.now(); // 排期回复：后台冻结时回到前台立即补发
            setTimeout(simulateReply, batchMessages.length * 300 + randomDelay);
            isBatchMode = false; batchMessages = [];
            DOMElements.batchBtn.classList.remove('active'); DOMElements.batchPreview.style.display = 'none';
            const placeholder = "";
            DOMElements.messageInput.placeholder = placeholder.length > 20 ? placeholder.substring(0, 20) + "...": placeholder;
        }

        function positionTypingIndicator() {
            var tiW = document.getElementById('typing-indicator-wrapper');
            var inputArea = document.querySelector('.input-area-wrapper');
            if (!tiW || !inputArea) return;
            var h = inputArea.offsetHeight;
            tiW.style.bottom = h + 'px';
        }
        (function() {
            var inputArea = document.querySelector('.input-area-wrapper');
            if (!inputArea) return;
            if (typeof ResizeObserver === 'undefined') {
                window.addEventListener('resize', function() {
                    var tiW = document.getElementById('typing-indicator-wrapper');
                    if (tiW && tiW.style.display !== 'none') positionTypingIndicator();
                });
                return;
            }
            var ro = new ResizeObserver(function() {
                var tiW = document.getElementById('typing-indicator-wrapper');
                if (tiW && tiW.style.display !== 'none') positionTypingIndicator();
            });
            ro.observe(inputArea);
        })();

        // ─── 正在输入指示器：统一隐藏 + 超时兜底（防止超出发送节奏后仍一直显示） ───
        function _hideTyping() {
            try { if (window._typingIndicatorAutoHideTimer) { clearTimeout(window._typingIndicatorAutoHideTimer); window._typingIndicatorAutoHideTimer = null; } } catch (e) {}
            var _tiW = document.getElementById('typing-indicator-wrapper');
            if (_tiW) {
                var _tiInner = _tiW.querySelector('.typing-indicator');
                if (_tiInner) {
                    _tiInner.classList.add('hiding');
                    setTimeout(function () { _tiW.style.display = 'none'; if (_tiInner) _tiInner.classList.remove('hiding'); }, 240);
                } else {
                    _tiW.style.display = 'none';
                }
            }
        }
        function _scheduleTypingAutoHide(ms) {
            try { if (window._typingIndicatorAutoHideTimer) { clearTimeout(window._typingIndicatorAutoHideTimer); } } catch (e) {}
            window._typingIndicatorAutoHideTimer = setTimeout(function () {
                window._typingIndicatorAutoHideTimer = null;
                _hideTyping();
            }, ms);
        }

        // 通用：触发"模拟用户发了消息后的延迟回复"机制
        //   isUserMessage: true 表示真实有用户消息（默认），false 表示陪伴页点击触发（不存在的虚拟消息）
        //   返回 true 表示已排队等待回复，false 表示被"已读不回"概率拦截
        // ─── 回复排队：连续触发不互相取消，按顺序依次回复 ───────────
        window._replyQueue = [];
        function _drainReplyQueue() {
            if (!window._replyQueue || window._replyQueue.length === 0) return;
            const task = window._replyQueue[0];
            // 只当"后面还有排队回复"时才插入节奏间隔（用于串联多条消息的回复）；
            // 单独一条消息立即执行，避免在 simulateReply 内部的回复延迟之外再叠一层，
            // 否则正在输入会超出发送的回复节奏（总等待时长接近翻倍）。
            const hasNext = window._replyQueue.length > 1;
            const delayRange = settings.replyDelayMax - settings.replyDelayMin;
            const randomDelay = hasNext ? settings.replyDelayMin + Math.random() * delayRange : 0;
            setTimeout(() => {
                if (window._replyQueue.length > 0) window._replyQueue.shift();
                try {
                    window._simulateReplyLockUntil = 0; // 让每条排队的回复都能正常触发
                    task();
                } catch (e) {}
                _drainReplyQueue();
            }, randomDelay);
        }
        function _queueReply(task) {
            if (!window._replyQueue) window._replyQueue = [];
            const wasEmpty = window._replyQueue.length === 0;
            window._replyQueue.push(task);
            if (wasEmpty) _drainReplyQueue();
        }
        window._queueReply = _queueReply;

        window._triggerDelayedReply = function(isUserMessage) {
            if (isBatchMode) return false;
            // 真实用户消息一定要清除陪伴静默标志（避免陪伴中点了一下，回首页发消息时还跳过引用）
            if (isUserMessage) {
                window._companionSilentTrigger = false;
            }
            const delayRange = settings.replyDelayMax - settings.replyDelayMin;
            const randomDelay = settings.replyDelayMin + Math.random() * delayRange;

            const chance = Math.max(0, Math.min(1, Number(settings.readNoReplyChance) || 0));
            const shouldIgnore = settings.allowReadNoReply && (Math.random() < chance);

            // 只在有真实用户消息时才更新已读状态
            if (isUserMessage) {
                const readDelay = 1500 + Math.random() * 2500;
                setTimeout(() => {
                    let changed = false;
                    messages.forEach(msg => {
                        if (msg.sender === 'user' && msg.status !== 'read') {
                            msg.status = 'read';
                            changed = true;
                        }
                    });
                    if (changed) { _updateReadReceiptsDOM(); }
                }, readDelay);
            }

            // 排队：不取消之前已排队的回复，连续触发按顺序依次回复
            if (shouldIgnore) return false;

            // 显示 typing
            if (settings.typingIndicatorEnabled) {
                const tiWrapper = document.getElementById('typing-indicator-wrapper');
                const tiLabel = document.getElementById('typing-indicator-label');
                const tiAvatar = document.getElementById('typing-indicator-avatar');
                if (tiLabel) tiLabel.textContent = (settings.partnerName || '对方') + ' 正在输入';
                if (tiWrapper) {
                    positionTypingIndicator();
                    tiWrapper.style.display = 'block';
                }
                if (tiAvatar) {
                    const partnerImg = DOMElements.partner.avatar.querySelector('img');
                    tiAvatar.innerHTML = partnerImg ? `<img src="${partnerImg.src}">` : '<i class="fas fa-user"></i>';
                }
                if (_isCaughtUpToLatest() && DOMElements.chatContainer) DOMElements.chatContainer.scrollTop = DOMElements.chatContainer.scrollHeight;
                // 超时兜底：即使后续回复流程提前中断，正在输入也会在合理时间后自动消失
                _scheduleTypingAutoHide((settings.replyDelayMax || 7000) * 5 + 3000);
            }

            // 排队回复（不覆盖已有排队，连续触发会在前面回复完成后依次执行）
            window._replyScheduledAt = Date.now(); // 排期回复：后台冻结时回到前台立即补发
            _queueReply(() => {
                simulateReply();
                // 清除陪伴静默标志：延迟清除，确保 simulateReply 内部所有消息都已取到 recentUserMsgs 之后再清
                setTimeout(() => { window._companionSilentTrigger = false; }, (settings.replyDelayMax || 3000) + 500);
            });
            return true;
        };

        window.simulateReply = function() {
            // 防抖：2 秒内不重复触发，防止切回前台时浏览器批量回调导致洪水
            var now = Date.now();
            if (window._simulateReplyLockUntil && now < window._simulateReplyLockUntil) {
                return;
            }
            window._simulateReplyLockUntil = now + 2000;
            window._lastReplyTs = now;
            window._replyScheduledAt = 0; // 回复已在产出，清除待补发标记

            function showTypingIndicator() {
                if (!settings.typingIndicatorEnabled) return;
                const tiWrapper = document.getElementById('typing-indicator-wrapper');
                const tiLabel = document.getElementById('typing-indicator-label');
                const tiAvatar = document.getElementById('typing-indicator-avatar');
                if (tiLabel) tiLabel.textContent = (settings.partnerName || '对方') + ' 正在输入';
                if (tiWrapper) { 
                    positionTypingIndicator(); 
                    tiWrapper.style.display = 'block'; 
                }
                if (tiAvatar) {
                    const partnerImg = DOMElements.partner.avatar.querySelector('img');
                    tiAvatar.innerHTML = partnerImg ? `<img src="${partnerImg.src}">` : '<i class="fas fa-user"></i>';
                }
                // 判断标准不是"在不在历史浏览模式"，而是"用户现在实际有没有停在底部"——
                // 哪怕没有搜索/跳转，正常聊天时手指往上划了一点，也一样不该被强行拽回去
                if (_isCaughtUpToLatest()) {
                    DOMElements.chatContainer.scrollTop = DOMElements.chatContainer.scrollHeight;
                }
            }

            let changed = false;
            messages.forEach(msg => {
                if (msg.sender === 'user' && msg.status !== 'read') {
                    msg.status = 'read'; changed = true;
                }
            });
            if (changed) {
                // 已读状态是会话内瞬态：只更新 DOM，不再触发 chatMessages 整数组重写。
                // 否则每次伴侣回复都要把含 base64 的整份消息历史 structuredClone 进 IndexedDB，
                // 消息越多越卡——这是"数据太多后连续聊天卡顿"的重要来源。
                _updateReadReceiptsDOM();
            }

if (partnerPersonas && partnerPersonas.length > 0 && Math.random() < 0.3) {
                const currentPool = [
                    ...partnerPersonas
                ];
                if(currentPool.length > 0) {
                     const nextPersona = currentPool[Math.floor(Math.random() * currentPool.length)];
                     
                     settings.partnerName = nextPersona.name;
                     DOMElements.partner.name.textContent = nextPersona.name;

                     // 同步更新前台服务通知昵称
                     if (typeof ForegroundBridge !== 'undefined') {
                         ForegroundBridge.updateNotification();
                     }

                     if (nextPersona.avatar) {
                         updateAvatar(DOMElements.partner.avatar, nextPersona.avatar);
                         localforage.setItem(getStorageKey('partnerAvatar'), nextPersona.avatar);
                     }
                     throttledSaveData();
                }
            }
            if (settings.partnerRecallEnabled && Math.random() < 0.03) {
                // ── 对方撤回消息：触发概率 3%，用一个独立回复周期触发 ──
                if (typeof window._triggerPartnerRecall === 'function') window._triggerPartnerRecall();
                _hideTyping(); // 撤回不产生回复，隐藏正在输入，避免一直显示
                return;
            }
            if (Math.random() < 0.03) {
                // ── 对方拍一拍：调用提取的通用函数（同时供 /测试拍一拍 指令使用）──
                if (typeof window._triggerPartnerPoke === 'function') window._triggerPartnerPoke();
                _hideTyping(); // 拍一拍不产生回复，隐藏正在输入
                return;
            }

            const replyCount = Math.random() < 0.75 ? 1: (Math.random() < 0.95 ? 2: 3);
            if (!customReplies || customReplies.length === 0) {
                showNotification('回复库为空，请先到「自定义回复」中添加内容', 'info', 3500);
                _hideTyping(); // 无回复可发，隐藏正在输入
                return;
            }
            const disabledItemsOnce = (() => {
                try {
                    const raw = localStorage.getItem(window.dgKey('disabledReplyItems'));
                    return raw ? new Set(JSON.parse(raw)) : new Set();
                } catch (e) { return new Set(); }
            })();
            const disabledGroupItemsOnce = new Set();
            (window.customReplyGroups || []).forEach(g => {
                if (g.disabled && Array.isArray(g.items)) g.items.forEach(item => disabledGroupItemsOnce.add(item));
            });
            const replyPoolOnce = customReplies
                .filter(r => !disabledItemsOnce.has(r) && !disabledGroupItemsOnce.has(r))
                .map(r => String(r || '').trim())
                .filter(Boolean);
            // 语音字卡池（开启开关且未被屏蔽的字卡；与文字字卡一同作为回复内容）
        const vcEnabledReply = (typeof voiceCardEnabled !== 'undefined') ? !!voiceCardEnabled : true;
        let disabledVoiceIdsOnce = new Set();
        try {
            const raw = localStorage.getItem(window.dgKey('disabledVoiceCards'));
            if (raw) disabledVoiceIdsOnce = new Set(JSON.parse(raw));
        } catch (e) {}
        const enabledVoicePool = vcEnabledReply ? (voiceCards || []).filter(v => v && v.audio && !disabledVoiceIdsOnce.has(v.id)) : [];
        if (!replyPoolOnce.length && !enabledVoicePool.length) {
            showNotification('回复库可用内容为空（无可用文字字卡或语音字卡），请到「自定义回复」中调整', 'info', 4000);
            _hideTyping(); // 无可用回复，隐藏正在输入
            return;
        }

            // 确认有可用回复后再展示“正在输入中”，避免空转
            showTypingIndicator();
            // 按实际回复条数收紧超时兜底：正常路径会在最后一条回复到达时主动隐藏并清除计时器
            _scheduleTypingAutoHide((settings.replyDelayMax || 7000) * replyCount + 2500);
            let delay = 0;
            // 陪伴页静默触发时不引用用户消息（陪伴中的触发不是用户发了某条具体消息）
            const recentUserMsgs = (settings.replyEnabled && !window._companionSilentTrigger)
                ? messages.filter(m => m.sender === 'user' && m.text && !m.recalled).slice(-10)
                : [];

            // 前台服务保活确保 WebView 持续运行，setTimeout 可正常触发通知

            for (let i = 0; i < replyCount; i++) {
                const delayRange = settings.replyDelayMax - settings.replyDelayMin;
                delay += settings.replyDelayMin + Math.random() * delayRange;
                // 文字字卡与语音字卡混合回复：无文字字卡时用语音卡兜底，否则约35%概率本条改为发语音字卡
                const slotIsVoice = enabledVoicePool.length > 0 && (replyPoolOnce.length === 0 || Math.random() < 0.35);
                const slotVc = slotIsVoice ? enabledVoicePool[Math.floor(Math.random() * enabledVoicePool.length)] : null;
                setTimeout(() => {
                    try {
                    if (slotVc) {
                        // 本条回复为语音字卡：上方为语音条可点击播放，下方为上传时编辑的文字内容
                        addMessage({
                            id: Date.now() + i + 3000,
                            sender: settings.partnerName || '对方',
                            text: '',
                            timestamp: new Date(),
                            voice: {
                                url: slotVc.audio || '',
                                duration: Number(slotVc.duration || 0) || Math.max(1, Math.round((slotVc.text || '').length / 3)),
                                fakeText: slotVc.text || '',
                                transcript: ''
                            },
                            status: 'received',
                            favorited: false,
                            note: null,
                            replyTo: (i === 0 && recentUserMsgs.length > 0 && Math.random() < 0.3)
                                ? (function(){ const m = recentUserMsgs[Math.floor(Math.random() * recentUserMsgs.length)]; return { id: m.id, text: m.text, sender: m.sender }; })()
                                : null,
                            type: 'normal'
                        });
                        if (typeof window._sendPartnerNotification === 'function') {
                            window._sendPartnerNotification(settings.partnerName || '对方', slotVc.text ? `[语音]${slotVc.text}` : '[语音]');
                        }
                        playSound('message');
                        if (i === replyCount - 1) {
                            (function(){try{if(window._typingIndicatorAutoHideTimer){clearTimeout(window._typingIndicatorAutoHideTimer);window._typingIndicatorAutoHideTimer=null;}}catch(e){}var _tiW=document.getElementById('typing-indicator-wrapper');if(_tiW){var _tiInner=_tiW.querySelector('.typing-indicator');if(_tiInner){_tiInner.classList.add('hiding');setTimeout(function(){_tiW.style.display='none';if(_tiInner)_tiInner.classList.remove('hiding');},240);}else{_tiW.style.display='none';}}})();
                        }
                    } else {
                    // 前台服务保活后 WebView 持续运行，始终发送通知
                    const replyPool = replyPoolOnce;
                    // 被屏蔽或无效项直接换下一个，尽量保证每次都产出可用回复
                    let replyText = '';
                    if (settings.combineReplyCards) {
                        // 拼接字卡：1 ~ combineReplyMaxCards 句随机拼接，句子间随机加标点断句
                        const maxN = Math.max(1, Math.min(5, parseInt(settings.combineReplyMaxCards, 10) || 3));
                        const n = 1 + Math.floor(Math.random() * maxN);
                        for (let k = 0; k < n; k++) {
                            const picked = replyPool[Math.floor(Math.random() * replyPool.length)];
                            replyText += picked + (Math.random() < .2 ? '！' : Math.random() < .2 ? '……' : '。');
                        }
                    } else {
                        // 开关关闭：老逻辑，只抽1句（保留原有的跳过空/无效项重试）
                        for (let t = 0; t < 6; t++) {
                            const picked = replyPool[Math.floor(Math.random() * replyPool.length)];
                            if (picked && String(picked).trim()) {
                                replyText = String(picked).trim();
                                break;
                            }
                        }
                    }
                    if (!replyText && i === replyCount - 1) {
                        (function(){try{if(window._typingIndicatorAutoHideTimer){clearTimeout(window._typingIndicatorAutoHideTimer);window._typingIndicatorAutoHideTimer=null;}}catch(e){}var _tiW=document.getElementById('typing-indicator-wrapper');if(_tiW){var _tiInner=_tiW.querySelector('.typing-indicator');if(_tiInner){_tiInner.classList.add('hiding');setTimeout(function(){_tiW.style.display='none';if(_tiInner)_tiInner.classList.remove('hiding');},240);}else{_tiW.style.display='none';}}})();
                        return;
                    }

                    let disabledStickerItems = new Set();
                    try {
                        const raw = localStorage.getItem(window.dgKey('disabledStickerItems'));
                        if (raw) disabledStickerItems = new Set(JSON.parse(raw));
                    } catch (e) {}
                    const enabledStickerPool = (stickerLibrary || []).filter(s => !disabledStickerItems.has(s));
                    const shouldSendSticker = enabledStickerPool.length > 0 && Math.random() < 0.2;

                    let finalText = replyText;
                    let separateEmoji = null;
                    if (customEmojis && customEmojis.length > 0 && Math.random() < 0.2) {
                        const emoji = customEmojis[Math.floor(Math.random() * customEmojis.length)];
                        if (settings.emojiMixEnabled !== false) {
                            finalText = Math.random() < 0.5
                                ? emoji + ' ' + replyText
                                : replyText + ' ' + emoji;
                        } else {
                            separateEmoji = emoji;
                        }
                    }

                    addMessage({
                        id: Date.now() + i,
                        sender: settings.partnerName || '对方',
                        text: finalText,
                        timestamp: new Date(),
                        status: 'received',
                        favorited: false,
                        note: null,
                        replyTo: (i === 0 && recentUserMsgs.length > 0 && Math.random() < 0.3)
                            ? (function(){ const m = recentUserMsgs[Math.floor(Math.random() * recentUserMsgs.length)]; return { id: m.id, text: m.text, sender: m.sender }; })()
                            : null,
                        type: 'normal'
                    });
                    // 发送通知
                    if (typeof window._sendPartnerNotification === 'function') {
                        window._sendPartnerNotification(settings.partnerName || '对方', finalText);
                    }
                    playSound('message');

                    if (shouldSendSticker) {
                        const randomSticker = enabledStickerPool[Math.floor(Math.random() * enabledStickerPool.length)];
                        setTimeout(() => {
                            addMessage({
                                id: Date.now() + i + 2000,
                                sender: settings.partnerName || '对方',
                                text: '',
                                timestamp: new Date(),
                                image: randomSticker,
                                status: 'received',
                                favorited: false,
                                note: null,
                                type: 'normal'
                            });
                            playSound('message');
                            if (typeof window._sendPartnerNotification === 'function') {
                                window._sendPartnerNotification(settings.partnerName || '对方', '[表情]');
                            }
                        }, 400 + Math.random() * 600);
                    }

                    if (separateEmoji) {
                        setTimeout(() => {
                            addMessage({
                                id: Date.now() + i + 1000,
                                sender: settings.partnerName || '对方',
                                text: separateEmoji,
                                timestamp: new Date(),
                                status: 'received',
                                favorited: false,
                                note: null,
                                type: 'normal'
                            });
                            playSound('message');
                            if (typeof window._sendPartnerNotification === 'function') {
                                window._sendPartnerNotification(settings.partnerName || '对方', separateEmoji);
                            }
                        }, 300 + Math.random() * 400);
                    }

                    if (i === replyCount - 1) {
                        (function() {
                            try {
                                if (window._typingIndicatorAutoHideTimer) {
                                    clearTimeout(window._typingIndicatorAutoHideTimer);
                                    window._typingIndicatorAutoHideTimer = null;
                                }
                            } catch (e) {}
                            var _tiW = document.getElementById('typing-indicator-wrapper');
                            if (_tiW) {
                                var _tiInner = _tiW.querySelector('.typing-indicator');
                                if (_tiInner) {
                                    _tiInner.classList.add('hiding');
                                    setTimeout(function() {
                                        _tiW.style.display = 'none';
                                        if (_tiInner) _tiInner.classList.remove('hiding');
                                    }, 240);
                                } else {
                                    _tiW.style.display = 'none';
                                }
                            }
                        })();
                    }
                    }
                    } catch (e) {
                        console.error('[simulateReply] 渲染/回填出错:', e);
                        // 机制性兜底：出错时至少让“正在输入中”消失，避免假死
                        try {
                            (function(){
                                try { if (window._typingIndicatorAutoHideTimer) { clearTimeout(window._typingIndicatorAutoHideTimer); window._typingIndicatorAutoHideTimer = null; } } catch (e2) {}
                                var _tiW2 = document.getElementById('typing-indicator-wrapper');
                                if (_tiW2) _tiW2.style.display = 'none';
                            })();
                        } catch (e2) {}
                    }
                }, delay);
            }
        }

        // ─── 后台补发：回到前台时，若排期的回复因浏览器冻结定时器而一直未产出，立即补发一次 ───
        // 浏览器会节流/冻结后台标签页的定时器（尤其隐藏 5 分钟后 intensive throttling），
        // 导致"对方正在输入→回复+通知"整套 setTimeout 链在后台不触发；回到前台时在这里补上。
        // 仅当确实排期过回复且已离后台一段时间才触发，避免每次切标签都打扰。
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState !== 'visible') return;
            var scheduled = window._replyScheduledAt;
            if (!scheduled) return;
            if (Date.now() - scheduled < 2000) return; // 快速切回不打扰，正常排期照常执行
            window._replyScheduledAt = 0;
            try {
                if (typeof window.simulateReply === 'function') window.simulateReply();
            } catch (e) {}
        });

function showModal(modalElement, focusElement = null) {
            if (modalElement._hideTimeout) {
                clearTimeout(modalElement._hideTimeout);
                modalElement._hideTimeout = null;
            }
            modalElement.style.display = 'flex';
            modalElement.style.opacity = '';
            requestAnimationFrame(() => {
                const content = modalElement.querySelector('.modal-content');
                if (content) {
                    content.style.opacity = '1';
                    content.style.transform = 'translateY(0) scale(1)';
                }
                if (focusElement) {
                    setTimeout(() => focusElement.focus(), 100);
                }
            });
        }

        function hideModal(modalElement) {
            const content = modalElement.querySelector('.modal-content');
            if (content) {
                content.style.opacity = '0';
                content.style.transform = 'translateY(20px) scale(0.95)';
            }
            // 遮罩连同透明一起淡出，避免 display:none 时黑底突然消失造成闪屏
            modalElement.style.opacity = '0';
            modalElement.style.transition = 'opacity 0.28s ease';
            if (modalElement._hideTimeout) clearTimeout(modalElement._hideTimeout);
            modalElement._hideTimeout = setTimeout(() => {
                modalElement.style.display = 'none';
                modalElement.style.opacity = '';
                modalElement.style.transition = '';
            }, 300);
        }

        // 点击消息图片统一入口：从 <img> 往上找所属的消息 wrapper，按消息 id 取最新图片地址。
        // 这样 <img> 的 HTML 里就不需要内嵌整段 base64（避免字符串翻倍、重渲染重解析超长 HTML）。
        window._viewMsgImage = function (imgEl) {
            if (!imgEl) return;
            const wrapper = imgEl.closest('.message-wrapper');
            if (!wrapper) return;
            const msgId = wrapper.dataset.id || wrapper.dataset.msgId;
            const msg = messages.find(m => String(m.id) === String(msgId));
            if (msg && msg.image) {
                viewImage(msg.image);
            } else if (imgEl.src) {
                viewImage(imgEl.src);
            }
        };

        async function viewImage(src) {
            // 阶段三B：云端引用先下载；pending 引用从本地 base64 读
            let displaySrc = src;
            let downloadHref = src;
            if (typeof src === 'string' && src.indexOf('oss://') === 0) {
                if (!window.CloudMedia) return;
                try {
                    displaySrc = await window.CloudMedia.fetchUrl(src);
                    downloadHref = displaySrc;
                } catch (e) {
                    if (typeof showNotification === 'function') showNotification('图片加载失败', 'error');
                    return;
                }
            } else if (typeof src === 'string' && src.indexOf('pending://') === 0) {
                if (!window.CloudMedia) return;
                const base64 = await window.CloudMedia.getPendingBase64(src);
                if (!base64) {
                    if (typeof showNotification === 'function') showNotification('图片仍在准备中', 'info');
                    return;
                }
                displaySrc = base64;
                downloadHref = base64;
            }
            // 防堆叠：快速连点多张图/多次打开时，先移除旧的全屏查看器，
            // 避免多个 z-index:99999 全屏遮罩叠加拦截所有点击，让 App 看起来"卡死"
            const oldViewers = document.querySelectorAll('.image-viewer-modal');
            for (let i = 0; i < oldViewers.length; i++) {
                if (oldViewers[i].parentNode) oldViewers[i].parentNode.removeChild(oldViewers[i]);
            }

            const modal = document.createElement('div');
            modal.className = 'image-viewer-modal';
            modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;touch-action:pinch-zoom;';
            modal.innerHTML = `
                <div style="position:relative;max-width:95vw;max-height:92vh;display:flex;align-items:center;justify-content:center;">
                    <img src="${displaySrc}" style="max-width:95vw;max-height:88vh;object-fit:contain;display:block;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.6);" draggable="false">
                    <button onclick="this.closest('.image-viewer-modal').remove()" style="position:fixed;top:16px;right:16px;width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.15);border:1.5px solid rgba(255,255,255,0.3);color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);z-index:10;line-height:1;">×</button>
                    <a href="${downloadHref}" download style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 24px;background:rgba(255,255,255,0.15);border:1.5px solid rgba(255,255,255,0.3);border-radius:20px;color:#fff;font-size:13px;text-decoration:none;backdrop-filter:blur(8px);display:flex;align-items:center;gap:6px;"><i class="fas fa-download"></i> 保存图片</a>
                </div>`;
            modal.addEventListener('click', (e) => {
                if (e.target === modal || e.target.tagName === 'IMG') modal.remove();
            });
            document.body.appendChild(modal);
        }

        async function exportChatHistory() {
            // 直接从 localforage 读取日记（不依赖内存缓存，防止懒加载未就绪时为空）
            let _diaryForExport = [];
            let _moodForExport = null;
            let _customMoodOptionsForExport = [];
            try {
                // 按当前对象命名空间读取：对象切换后导出不串别的对象的数据。
                // 用 getStorageKey 取当前 SESSION_ID 分桶的键；取不到再回退旧版单对象无前缀键（APP_PREFIX + 键名）。
                function _sessionKey(sfx) {
                    try { return getStorageKey(sfx); } catch (e) {}
                    return (APP_PREFIX || '') + sfx;
                }
                const _scopedGet = async (sfx, fb) => {
                    const sk = _sessionKey(sfx);
                    const v = await localforage.getItem(sk).catch(() => null);
                    if (v != null) return v;
                    const legacy = (APP_PREFIX || '') + sfx;
                    if (legacy !== sk) {
                        const lv = await localforage.getItem(legacy).catch(() => null);
                        if (lv != null) return lv;
                    }
                    return fb;
                };
                _diaryForExport = (await _scopedGet('companionDiary', [])) || [];
                _moodForExport = (await _scopedGet('moodCalendar', {})) || {};
                _customMoodOptionsForExport = (await _scopedGet('customMoodOptions', [])) || [];
            } catch(e) { _diaryForExport = []; _moodForExport = {}; }

            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';
            overlay.innerHTML = `
                <div style="background:var(--secondary-bg);border-radius:20px;padding:24px;width:88%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.4);animation:modalContentSlideIn 0.3s ease forwards;">
                    <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px;display:flex;align-items:center;gap:8px;">
                        <i class="fas fa-file-export" style="color:var(--accent-color);font-size:14px;"></i>选择导出内容
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:16px;">勾选需要导出的数据模块</div>
                    <div style="display:flex;flex-direction:column;gap:9px;margin-bottom:20px;">
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);transition:border-color 0.2s;">
                            <input type="checkbox" id="_exp_msgs" checked style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="fas fa-comments" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>聊天记录 <span style="font-size:11px;color:var(--text-secondary);">(${messages.length} 条)</span></span>
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);transition:border-color 0.2s;">
                            <input type="checkbox" id="_exp_settings" checked style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="fas fa-sliders-h" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>外观与聊天设置</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);transition:border-color 0.2s;">
                            <input type="checkbox" id="_exp_replies" style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="fas fa-reply" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>字卡回复库</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);transition:border-color 0.2s;">
                            <input type="checkbox" id="_exp_ann" style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="fas fa-calendar-heart" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>纪念日 / 倒计时</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);transition:border-color 0.2s;">
                            <input type="checkbox" id="_exp_themes" style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="fas fa-palette" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>自定义主题配色</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);transition:border-color 0.2s;">
                            <input type="checkbox" id="_exp_diary" style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="fas fa-book-open" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>陪伴日记 <span style="font-size:11px;color:var(--text-secondary);">(${_diaryForExport.length} 条)</span></span>
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);transition:border-color 0.2s;">
                            <input type="checkbox" id="_exp_mood" style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="fas fa-face-smile" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>心情手账 <span style="font-size:11px;color:var(--text-secondary);">(${Object.keys(_moodForExport || {}).length} 天)</span></span>
                        </label>
                    </div>
                    <div style="display:flex;gap:10px;">
                        <button id="_exp_cancel" style="flex:1;padding:11px;border:1px solid var(--border-color);border-radius:12px;background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;font-family:var(--font-family);">取消</button>
                        <button id="_exp_confirm" style="flex:2;padding:11px;border:none;border-radius:12px;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-family);display:flex;align-items:center;justify-content:center;gap:7px;">
                            <i class="fas fa-download"></i>确认导出
                        </button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            function closeDialog() { overlay.remove(); }
            overlay.addEventListener('click', e => { if (e.target === overlay) closeDialog(); });
            const _expCancelBtn = document.getElementById('_exp_cancel');
            const _expConfirmBtn = document.getElementById('_exp_confirm');
            if (_expCancelBtn) _expCancelBtn.onclick = closeDialog;

            if (_expConfirmBtn) _expConfirmBtn.onclick = function() {
                const inclMsgs     = !!document.getElementById('_exp_msgs')?.checked;
                const inclSettings = !!document.getElementById('_exp_settings')?.checked;
                const inclReplies  = !!document.getElementById('_exp_replies')?.checked;
                const inclAnn      = !!document.getElementById('_exp_ann')?.checked;
                const inclThemes   = !!document.getElementById('_exp_themes')?.checked;
                const inclDiary    = !!document.getElementById('_exp_diary')?.checked;
                const inclMood     = !!document.getElementById('_exp_mood')?.checked;

                if (!inclMsgs && !inclSettings && !inclReplies && !inclAnn && !inclThemes && !inclDiary && !inclMood) {
                    showNotification('请至少选择一项导出内容', 'error');
                    return;
                }
                closeDialog();

                try {
                    let dgCustomData = null, dgStatusPool = null, customWeatherMap = {};
                    if (inclSettings) {
                        try { dgCustomData = JSON.parse(localStorage.getItem(window.dgKey('dg_custom_data')) || 'null'); } catch(e2) {}
                        try { dgStatusPool = JSON.parse(localStorage.getItem(window.dgKey('dg_status_pool')) || 'null'); } catch(e2) {}
                        try {
                            Object.keys(localStorage).forEach(kk => {
                                if (kk && kk.startsWith('customWeather_')) {
                                    customWeatherMap[kk] = localStorage.getItem(kk);
                                }
                            });
                        } catch(e2) {}
                    }

                    const exportObj = {
                        version: '3.1',
                        appName: 'ChatApp',
                        exportDate: new Date().toISOString(),
                        exportModules: []
                    };
                    if (inclMsgs)     {
                        // 永远省略图片字段，只导出文字等基础信息，减小体积
                        exportObj.messages = messages.map(m => {
                            const { image, ...rest } = m;
                            return rest;
                        });
                        exportObj.exportModules.push('messages');
                    }
                    if (inclSettings) {
                        exportObj.settings = settings;
                        exportObj.exportModules.push('settings');
                        exportObj.dgCustomData = dgCustomData;
                        exportObj.dgStatusPool = dgStatusPool;
                        exportObj.customWeatherMap = customWeatherMap;
                    }
                    if (inclReplies)  {
                        exportObj.customReplies = customReplies;
                        if (customEmojis && customEmojis.length > 0) exportObj.customEmojis = customEmojis;
                        if (customPokes && customPokes.length > 0) exportObj.customPokes = customPokes;
                        if (customStatuses && customStatuses.length > 0) exportObj.customStatuses = customStatuses;
                        if (customMottos && customMottos.length > 0) exportObj.customMottos = customMottos;
                        if (customIntros && customIntros.length > 0) exportObj.customIntros = customIntros;
                        if (window.customReplyGroups && window.customReplyGroups.length > 0) exportObj.customReplyGroups = window.customReplyGroups;
                        if (window.customPokeGroups && window.customPokeGroups.length > 0) exportObj.customPokeGroups = window.customPokeGroups;
                        if (window.customStatusGroups && window.customStatusGroups.length > 0) exportObj.customStatusGroups = window.customStatusGroups;
                        exportObj.exportModules.push('customReplies');
                    }
                    if (inclAnn)      { exportObj.anniversaries = anniversaries; exportObj.exportModules.push('anniversaries'); }
                    if (inclThemes)   {
                        exportObj.customThemes = customThemes;
                        exportObj.exportModules.push('themes');
                    }
                    if (inclDiary) {
                        exportObj.companionDiary = _diaryForExport;
                        exportObj.exportModules.push('companionDiary');
                    }
                    if (inclMood && _moodForExport && Object.keys(_moodForExport).length > 0) {
                        exportObj.moodCalendar = _moodForExport;
                        if (_customMoodOptionsForExport.length > 0) exportObj.customMoodOptions = _customMoodOptionsForExport;
                        exportObj.exportModules.push('moodCalendar');
                    }

                    const dataStr = JSON.stringify(exportObj, null, 2);
                    const parts = exportObj.exportModules.join('+');
                    const fileName = `chat-export-${parts}-${new Date().toISOString().slice(0,10)}.json`;

                    // Capacitor 环境优先使用原生分享
                    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
                        fallbackExport(dataStr, fileName);
                        return;
                    }

                    if (navigator.share && /Mobile|Android|iPhone|iPad/.test(navigator.userAgent)) {
                        const blob = new Blob([dataStr], { type: 'application/json;charset=utf-8' });
                        const file = new File([blob], fileName, { type: 'application/json' });
                        if (navigator.canShare && navigator.canShare({ files: [file] })) {
                            navigator.share({ files: [file], title: '传讯数据导出', text: `导出日期：${new Date().toLocaleDateString()}` })
                                .catch(() => fallbackExport(dataStr, fileName));
                            return;
                        }
                    }
                    fallbackExport(dataStr, fileName);
                } catch (error) {
                    console.error('导出失败:', error);
                    showNotification('导出失败，请重试', 'error');
                }
            };
        }

        function fallbackExport(dataStr, fileName) {
            fileName = fileName || `chat-backup-${SESSION_ID}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
            const dataBlob = new Blob([dataStr], { type: 'application/json;charset=utf-8' });
            // 优先使用全局 downloadFileFallback（已处理 WebView 兼容）
            if (typeof downloadFileFallback === 'function') {
                downloadFileFallback(dataBlob, fileName);
                showNotification('导出成功', 'success');
                return;
            }
            // WebView 环境检测
            var isAndroidWebView = /Android/.test(navigator.userAgent) && /wv/.test(navigator.userAgent);
            if (isAndroidWebView) {
                var reader = new FileReader();
                reader.onload = function () {
                    var dataUrl = reader.result;
                    if (window.Android && typeof window.Android.downloadFile === 'function') {
                        window.Android.downloadFile(dataUrl, fileName, 'application/json');
                        return;
                    }
                    var w = window.open(dataUrl, '_blank');
                    if (!w && typeof showNotification === 'function') {
                        showNotification('无法下载文件，请尝试在浏览器中打开', 'warning', 3000);
                    }
                };
                reader.readAsDataURL(dataBlob);
                showNotification('导出成功', 'success');
                return;
            }
            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            showNotification('导出成功', 'success');
        }

        function importChatHistory(file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    let rawText = e.target.result;
                    if (rawText.charCodeAt(0) === 0xFEFF) rawText = rawText.slice(1);
                    let importedData = JSON.parse(rawText);

                    // 兼容全量备份格式（type:'full' 或含 indexedDB/localforage 字段）
                    // 将其转换为 importChatHistory 能识别的标准字段
                    if (importedData && typeof importedData === 'object' &&
                        (importedData.type === 'full' || importedData.indexedDB || importedData.localforage) &&
                        !importedData.messages && !importedData.settings) {

                        const idb = importedData.indexedDB || importedData.localforage || {};
                        const ls  = importedData.localStorage || {};
                        const allKv = Object.assign({}, idb, ls);

                        // 找到 sessionId（取第一个带 _chatMessages 的键前缀）
                        let detectedSid = null;
                        const appPfx = importedData.appPrefix || 'CHAT_APP_V3_';
                        for (const k of Object.keys(allKv)) {
                            if (k.indexOf('_chatMessages') !== -1 && k.startsWith(appPfx)) {
                                const after = k.slice(appPfx.length);
                                const u = after.indexOf('_');
                                if (u > 0) { detectedSid = after.slice(0, u); break; }
                            }
                        }

                        const pfxSid = detectedSid ? (appPfx + detectedSid + '_') : null;
                        const getVal = (suffix) => {
                            if (pfxSid) {
                                const v = allKv[pfxSid + suffix];
                                if (v !== undefined && v !== null) return v;
                            }
                            // 无前缀回退
                            return allKv[suffix] !== undefined ? allKv[suffix] : null;
                        };
                        const parseVal = (v) => {
                            if (v === null || v === undefined) return null;
                            if (typeof v !== 'string') return v;
                            try { return JSON.parse(v); } catch(e2) { return v; }
                        };

                        const converted = {
                            version: importedData.version || '3.1',
                            appName:  importedData.appName || 'ChatApp',
                            exportDate: importedData.exportDate || importedData.timestamp || new Date().toISOString(),
                            exportModules: []
                        };

                        const msgs = parseVal(getVal('chatMessages'));
                        if (Array.isArray(msgs)) { converted.messages = msgs; converted.exportModules.push('messages'); }

                        const chatSettings = parseVal(getVal('chatSettings'));
                        if (chatSettings && typeof chatSettings === 'object') {
                            converted.settings = chatSettings;
                            converted.exportModules.push('settings');
                        }
                        // 额外的 localStorage 设置字段
                        const dgCustomData = parseVal(ls[window.dgKey('dg_custom_data')] !== undefined ? ls[window.dgKey('dg_custom_data')] : null);
                        if (dgCustomData) converted.dgCustomData = dgCustomData;
                        const dgStatusPool = parseVal(ls[window.dgKey('dg_status_pool')] !== undefined ? ls[window.dgKey('dg_status_pool')] : null);
                        if (dgStatusPool) converted.dgStatusPool = dgStatusPool;
                        const customWeatherMap = {};
                        for (const wk of Object.keys(ls)) {
                            if (wk && wk.startsWith('customWeather_')) customWeatherMap[wk] = ls[wk];
                        }
                        if (Object.keys(customWeatherMap).length) converted.customWeatherMap = customWeatherMap;

                        const replies = parseVal(getVal('customReplies'));
                        if (Array.isArray(replies)) { converted.customReplies = replies; converted.exportModules.push('customReplies'); }

                        const emojis = parseVal(getVal('customEmojis'));
                        if (Array.isArray(emojis)) converted.customEmojis = emojis;

                        const ann = parseVal(getVal('anniversaries'));
                        if (Array.isArray(ann)) { converted.anniversaries = ann; converted.exportModules.push('anniversaries'); }

                        const themes = parseVal(allKv[appPfx + 'customThemes'] !== undefined ? allKv[appPfx + 'customThemes'] : (ls[appPfx + 'customThemes'] || null));
                        if (themes) { converted.customThemes = themes; converted.exportModules.push('themes'); }

                        // 其余字卡/贴纸/语音字卡键：全量备份转标准格式时一并提取，
                        // 否则走本入口导入时 customPokes / customStatuses / 分组 / 贴纸 / 语音字卡 会被静默丢弃
                        const pokes = parseVal(getVal('customPokes'));
                        if (Array.isArray(pokes)) converted.customPokes = pokes;
                        const statuses = parseVal(getVal('customStatuses'));
                        if (Array.isArray(statuses)) converted.customStatuses = statuses;
                        const mottos = parseVal(getVal('customMottos'));
                        if (Array.isArray(mottos)) converted.customMottos = mottos;
                        const intros = parseVal(getVal('customIntros'));
                        if (Array.isArray(intros)) converted.customIntros = intros;
                        const replyGroups = parseVal(getVal('customReplyGroups'));
                        if (replyGroups) converted.customReplyGroups = replyGroups;
                        const pokeGroups = parseVal(getVal('customPokeGroups'));
                        if (pokeGroups) converted.customPokeGroups = pokeGroups;
                        const statusGroups = parseVal(getVal('customStatusGroups'));
                        if (statusGroups) converted.customStatusGroups = statusGroups;
                        const stickerLib = parseVal(getVal('stickerLibrary'));
                        if (Array.isArray(stickerLib)) converted.stickerLibrary = stickerLib;
                        const myStickers = parseVal(getVal('myStickerLibrary'));
                        if (Array.isArray(myStickers)) converted.myStickerLibrary = myStickers;
                        const voiceCards = parseVal(getVal('customVoiceCards'));
                        if (Array.isArray(voiceCards)) converted.customVoiceCards = voiceCards;
                        const voiceGroups = parseVal(getVal('customVoiceGroups'));
                        if (voiceGroups) converted.customVoiceGroups = voiceGroups;
                        const voiceEnabled = parseVal(getVal('voiceCardEnabled'));
                        if (voiceEnabled !== null) converted.voiceCardEnabled = voiceEnabled;

                        importedData = converted;
                    }

                    const hasMessages  = importedData.messages && Array.isArray(importedData.messages);
                    const hasSettings  = !!importedData.settings;
                    const hasReplies   = (importedData.customReplies && Array.isArray(importedData.customReplies)) ||
                                         (importedData.customPokes && Array.isArray(importedData.customPokes)) ||
                                         (importedData.customStatuses && Array.isArray(importedData.customStatuses)) ||
                                         (importedData.customMottos && Array.isArray(importedData.customMottos)) ||
                                         (importedData.customIntros && Array.isArray(importedData.customIntros)) ||
                                         (importedData.customEmojis && Array.isArray(importedData.customEmojis)) ||
                                         !!importedData.customReplyGroups || !!importedData.customPokeGroups || !!importedData.customStatusGroups ||
                                         !!importedData.customVoiceCards || !!importedData.customVoiceGroups;
                    const hasAnn       = importedData.anniversaries && Array.isArray(importedData.anniversaries);
                    const hasThemes    = !!importedData.customThemes || !!importedData.stickerLibrary;
                    const hasDiary     = importedData.companionDiary && Array.isArray(importedData.companionDiary);
                    const hasMood      = !!importedData.moodCalendar && typeof importedData.moodCalendar === 'object';

                    if (!hasMessages && !hasSettings && !hasReplies && !hasAnn && !hasThemes && !hasDiary && !hasMood) {
                        throw new Error('无效的聊天记录文件（未检测到可识别的数据模块）');
                    }

                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';

                    const makeRow = (id, icon, label, sublabel, available, checked) => {
                        if (!available) return '';
                        return `<label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);">
                            <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} style="accent-color:var(--accent-color);width:15px;height:15px;">
                            <i class="${icon}" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                            <span>${label}${sublabel ? `<span style="font-size:11px;color:var(--text-secondary);margin-left:4px;">${sublabel}</span>` : ''}</span>
                        </label>`;
                    };

                    overlay.innerHTML = `
                        <div style="background:var(--secondary-bg);border-radius:20px;padding:24px;width:88%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.4);animation:modalContentSlideIn 0.3s ease forwards;">
                            <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px;display:flex;align-items:center;gap:8px;">
                                <i class="fas fa-file-import" style="color:var(--accent-color);font-size:14px;"></i>选择导入内容
                            </div>
                            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:16px;">文件中检测到以下数据，选择要导入的模块</div>
                            <div style="display:flex;flex-direction:column;gap:9px;margin-bottom:20px;">
                                ${makeRow('_imp_msgs', 'fas fa-comments', '聊天记录', hasMessages ? `(${importedData.messages.length} 条)` : '', hasMessages, true)}
                                ${makeRow('_imp_settings', 'fas fa-sliders-h', '外观与聊天设置', '', hasSettings, true)}
                                ${makeRow('_imp_replies', 'fas fa-reply', '字卡回复库', '', hasReplies, false)}
                                ${makeRow('_imp_ann', 'fas fa-calendar-heart', '纪念日 / 倒计时', '', hasAnn, false)}
                                ${makeRow('_imp_themes', 'fas fa-palette', '自定义主题配色', '', hasThemes, false)}
                                ${makeRow('_imp_diary', 'fas fa-book-open', '陪伴日记', hasDiary ? `(${importedData.companionDiary.length} 条)` : '', hasDiary, false)}
                                ${makeRow('_imp_mood', 'fas fa-face-smile', '心情手账', hasMood ? `(${Object.keys(importedData.moodCalendar).length} 天)` : '', hasMood, false)}
                            </div>
                            <div style="display:flex;gap:10px;">
                                <button id="_imp_cancel" style="flex:1;padding:11px;border:1px solid var(--border-color);border-radius:12px;background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;font-family:var(--font-family);">取消</button>
                                <button id="_imp_confirm" style="flex:2;padding:11px;border:none;border-radius:12px;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-family);display:flex;align-items:center;justify-content:center;gap:7px;">
                                    <i class="fas fa-upload"></i>确认导入
                                </button>
                            </div>
                        </div>`;
                    document.body.appendChild(overlay);

                    function closeDialog() { overlay.remove(); }
                    overlay.addEventListener('click', ev => { if (ev.target === overlay) closeDialog(); });
                    const _impCancelBtn = document.getElementById('_imp_cancel');
                    const _impConfirmBtn = document.getElementById('_imp_confirm');
                    if (_impCancelBtn) _impCancelBtn.onclick = closeDialog;

                    if (_impConfirmBtn) _impConfirmBtn.onclick = function() {
                        const doMsgs     = hasMessages  && !!document.getElementById('_imp_msgs')?.checked;
                        const doSettings = hasSettings  && !!document.getElementById('_imp_settings')?.checked;
                        const doReplies  = hasReplies   && !!document.getElementById('_imp_replies')?.checked;
                        const doAnn      = hasAnn       && !!document.getElementById('_imp_ann')?.checked;
                        const doThemes   = hasThemes    && !!document.getElementById('_imp_themes')?.checked;
                        const doDiary    = hasDiary     && !!document.getElementById('_imp_diary')?.checked;
                        const doMood     = hasMood      && !!document.getElementById('_imp_mood')?.checked;

                        if (!doMsgs && !doSettings && !doReplies && !doAnn && !doThemes && !doDiary && !doMood) {
                            showNotification('请至少选择一项导入内容', 'error');
                            return;
                        }

                        if (doMsgs && messages.length > 0 && !confirm('导入将覆盖当前会话的聊天记录，确定继续吗？')) return;
                        closeDialog();

                        if (doMsgs) {
                            messages = importedData.messages.map(m => {
                                const ts = new Date(m.timestamp);
                                return { ...m, timestamp: isNaN(ts.getTime()) ? new Date() : ts };
                            });
                        }
                        if (doSettings) {
                            if (importedData.settings) {
                                Object.assign(settings, importedData.settings);
                                try {
                                    if (settings.customFontUrl) applyCustomFont(settings.customFontUrl);
                                    if (settings.customBubbleCss) applyCustomBubbleCss(settings.customBubbleCss);
                                    if (settings.customGlobalCss) applyGlobalThemeCss(settings.customGlobalCss);
                                } catch(e2) { console.warn('导入后样式应用失败', e2); }
                            }
                            if (importedData.dgCustomData) { try { localStorage.setItem(window.dgKey('dg_custom_data'), JSON.stringify(importedData.dgCustomData)); } catch(e2) {} }
                            if (importedData.dgStatusPool) { try { localStorage.setItem(window.dgKey('dg_status_pool'), JSON.stringify(importedData.dgStatusPool)); } catch(e2) {} }
                            if (importedData.customWeatherMap) { try { Object.keys(importedData.customWeatherMap).forEach(wk => localStorage.setItem(wk, importedData.customWeatherMap[wk])); } catch(e2) {} }
                        }
                        if (doReplies  && importedData.customReplies)  customReplies  = importedData.customReplies;
                        if (doReplies  && importedData.customEmojis && Array.isArray(importedData.customEmojis)) customEmojis = importedData.customEmojis;
                        if (doReplies  && importedData.customPokes && Array.isArray(importedData.customPokes)) customPokes = importedData.customPokes;
                        if (doReplies  && importedData.customStatuses && Array.isArray(importedData.customStatuses)) customStatuses = importedData.customStatuses;
                        if (doReplies  && importedData.customMottos && Array.isArray(importedData.customMottos)) customMottos = importedData.customMottos;
                        if (doReplies  && importedData.customIntros && Array.isArray(importedData.customIntros)) customIntros = importedData.customIntros;
                        if (doReplies  && importedData.customReplyGroups) window.customReplyGroups = importedData.customReplyGroups;
                        if (doReplies  && importedData.customPokeGroups) window.customPokeGroups = importedData.customPokeGroups;
                        if (doReplies  && importedData.customStatusGroups) window.customStatusGroups = importedData.customStatusGroups;
                        if (doReplies  && importedData.customVoiceCards && Array.isArray(importedData.customVoiceCards)) {
                            voiceCards = importedData.customVoiceCards;
                            window._voiceCards = voiceCards;
                        }
                        if (doReplies  && importedData.customVoiceGroups) window.customVoiceGroups = importedData.customVoiceGroups;
                        if (doReplies  && importedData.voiceCardEnabled !== undefined) voiceCardEnabled = !!importedData.voiceCardEnabled;
                        if (doAnn      && importedData.anniversaries)   anniversaries  = importedData.anniversaries;
                        if (doThemes   && importedData.customThemes)    customThemes   = importedData.customThemes;
                        if (doThemes   && importedData.stickerLibrary)  stickerLibrary = importedData.stickerLibrary;
                        if (doThemes   && importedData.myStickerLibrary && Array.isArray(importedData.myStickerLibrary)) myStickerLibrary = importedData.myStickerLibrary;
                        if (doDiary    && importedData.companionDiary && typeof window._setCompanionDiaryEntries === 'function') {
                            window._setCompanionDiaryEntries(importedData.companionDiary);
                        }
                        if (doMood && importedData.moodCalendar && typeof window._setMoodData === 'function') {
                            window._setMoodData(importedData.moodCalendar, importedData.customMoodOptions || []);
                        }

                        // 导入直接替换了内存数据，必须先递增版本号再落盘，否则消息写入守卫
                        // (版本号+长度未变即跳过重写) 会误判为"未变更"而跳过保存，导致导入的数据没存进 IndexedDB。
                        if (window._markChatDataChanged) window._markChatDataChanged();
                        saveData();
                        if (doMsgs && typeof renderMessages === 'function') renderMessages();
                        if (typeof applySettings === 'function') applySettings();
                        updateUI();
                        const count = doMsgs ? `${messages.length} 条消息` : '所选数据';
                        showNotification(`成功导入${count}`, 'success');
                    };
                } catch (error) {
                    console.error('导入失败:', error);
                    showNotification('文件格式错误或已损坏', 'error');
                }
            };
            reader.onerror = () => showNotification('文件读取失败', 'error');
            reader.readAsText(file);
        }

        // ── 对方状态更新核心逻辑（提取为独立函数，供定时触发和 /测试状态更新 指令共用）──
        window._triggerStatusChange = function() {
            let newStatus = null;

            const groups = window.customStatusGroups || [];
            const allStatuses = (typeof customStatuses !== 'undefined' ? customStatuses : []) || [];

            // 只保留「启用」且「有内容」的分组，内容必须也在 allStatuses 里存在
            const enabledGroups = groups.filter(function(g) {
                return !g.disabled && Array.isArray(g.items) && g.items.length > 0;
            });

            // 收集所有在分组内的状态文本
            const groupedItems = new Set();
            enabledGroups.forEach(function(g) { g.items.forEach(function(t) { groupedItems.add(t); }); });

            // 未分组的状态
            const ungroupedStatuses = allStatuses.filter(function(t) { return !groupedItems.has(t); });

            if (enabledGroups.length > 0) {
                // 有启用分组时：随机选一个分组 → 从该分组随机选一条状态
                const pickedGroup = enabledGroups[Math.floor(Math.random() * enabledGroups.length)];
                const groupPool = pickedGroup.items.filter(function(t) { return allStatuses.includes(t); });
                if (groupPool.length > 0) {
                    newStatus = groupPool[Math.floor(Math.random() * groupPool.length)];
                }
            }

            // 分组里没找到内容时，退回到：未分组状态 → 全部 customStatuses → 内置 PARTNER_STATUSES
            if (!newStatus && ungroupedStatuses.length > 0) {
                newStatus = ungroupedStatuses[Math.floor(Math.random() * ungroupedStatuses.length)];
            }
            if (!newStatus && allStatuses.length > 0) {
                newStatus = allStatuses[Math.floor(Math.random() * allStatuses.length)];
            }
            if (!newStatus && CONSTANTS.PARTNER_STATUSES && CONSTANTS.PARTNER_STATUSES.length > 0) {
                newStatus = getRandomItem(CONSTANTS.PARTNER_STATUSES);
            }
            if (!newStatus) {
                // 静默跳过（不再 toast 提示用户）
                return;
            }

            settings.partnerStatus = newStatus;
            settings.lastStatusChange = Date.now();
            settings.nextStatusChange = 1 + Math.random() * 7;
            DOMElements.partner.status.textContent = newStatus;
            throttledSaveData();
        };

        const checkStatusChange = () => {
            if ((Date.now() - settings.lastStatusChange) / 36e5 >= settings.nextStatusChange) {
                window._triggerStatusChange();
            }
        };



        function getStorageKey(baseKey) {
            if (!SESSION_ID) {
                console.error('[getStorageKey] SESSION_ID 尚未初始化，拒绝生成存储键:', baseKey);
                throw new Error('SESSION_ID 未初始化，存储操作已中止');
            }
            return `${APP_PREFIX}${SESSION_ID}_${baseKey}`;
        }

        // 阶段四：收藏语音键名（带 SESSION_ID 前缀，按梦角隔离）
        function favAudioKey(messageId) {
            return getStorageKey(`favAudio_${messageId}`);
        }
        window.favAudioKey = favAudioKey;

        async function migrateData() {
            const isMigrated = await localforage.getItem(APP_PREFIX + 'MIGRATION_V2_DONE');
            if (isMigrated) return;

            try {
                const keys = Object.keys(localStorage);
                for (const key of keys) {
                    if (key.startsWith(APP_PREFIX)) {
                        try {
                            const val = localStorage.getItem(key);
                            if (val) {
                                let dataToStore = val;
                                try {
                                    if (val.startsWith('{') || val.startsWith('[')) {
                                        dataToStore = JSON.parse(val);
                                    }
                                } catch (e) {
                                    console.warn(`迁移期间解析数据失败: ${key}，将作为原始字符串存储。`, e);
                                }
                                await localforage.setItem(key, dataToStore);
                            }
                        } catch (e) {
                            console.error(`迁移键值 ${key} 时发生错误，已跳过。`, e);
                        }
                    }
                }
                
                await localforage.setItem(APP_PREFIX + 'MIGRATION_V2_DONE', 'true');
            } catch (e) {
                console.error("数据迁移过程中发生严重错误:", e);
                showNotification('数据迁移失败，部分旧数据可能丢失', 'error');
            }
        }

window.initializeSession = async function() {
    await migrateData();

    const sessionsData = await localforage.getItem(`${APP_PREFIX}sessionList`);
    sessionList = sessionsData || [];

    const hash = window.location.hash.substring(1);
    if (hash && sessionList.some(s => s.id === hash)) {
        SESSION_ID = hash;
    } else if (sessionList.length > 0) {
        const lastId = await localforage.getItem(`${APP_PREFIX}lastSessionId`);
        SESSION_ID = lastId && sessionList.some(s => s.id === lastId) ? lastId : sessionList[0].id;
    } else {
        SESSION_ID = await createNewSession(false);
    }

    await localforage.setItem(`${APP_PREFIX}lastSessionId`, SESSION_ID);
    // 同步镜像一份到 localStorage，供模块在 initializeSession 完成前同步解析当前对象
    try { localStorage.setItem(APP_PREFIX + 'lastSessionId', SESSION_ID); } catch (e) {}
}

// ── 夜间模式：手动切换按钮 + 默认跟随系统 ──
// themeNightPref：'dark' | 'light' | 缺省(空) = 跟随系统
const THEME_NIGHT_PREF_KEY = 'themeNightPref';

function applyPreferredTheme() {
    var pref = localStorage.getItem(THEME_NIGHT_PREF_KEY);
    if (pref === 'dark' || pref === 'light') return pref;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function syncThemeToggleIcon() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var icon = dark ? 'fas fa-sun' : 'fas fa-moon';
    var title = dark ? '切换白天模式' : '切换夜间模式';
    var i = btn.querySelector('i');
    if (!i) { i = document.createElement('i'); btn.appendChild(i); }
    i.className = icon;
    btn.title = title;
}

function toggleNightMode() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var next = dark ? 'light' : 'dark';
    localStorage.setItem(THEME_NIGHT_PREF_KEY, next);
    document.documentElement.setAttribute('data-theme', next);
    syncThemeToggleIcon();
}

document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', toggleNightMode);
    syncThemeToggleIcon();
});

// 监听系统昼夜变化，实时更新 data-theme（用户手动设置过时以手动为准）
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (localStorage.getItem(THEME_NIGHT_PREF_KEY) === 'dark' ||
        localStorage.getItem(THEME_NIGHT_PREF_KEY) === 'light') return;
    document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
});

// 注：往上/往下翻页加载更多消息的触发，只靠 listeners.js 里那个绑定在真正可滚动容器（chat-container）
// 上的 scroll 事件监听（检查 scrollTop 实际位置）。这里原本还有一套用 IntersectionObserver 做的重复监听，
// 但它绑定的参照容器（.main-chat-area）本身并不会滚动，导致这套监听只要"加载提示条一显示出来"就会误触发，
// 跟用户有没有真的滑动到顶部/底部没有关系，会引发连环自动加载、把用户拽到意料之外的位置。已确认删除，不会影响功能。
