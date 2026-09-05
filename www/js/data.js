(function () {
    'use strict';
    (function blockDm6CSS() {
        if (document.getElementById('dm6-style')) return; 
        var s = document.createElement('style');
        s.id = 'dm6-style'; 
        s.textContent = '/* dm6-style blocked by data-modal v9 */';
        document.head.appendChild(s);
    })();

    var INNER_HTML =
        '<div class="modal-title" style="flex-shrink:0;">'
        +   '<i class="fas fa-database"></i><span>数据管理</span>'
        + '</div>'

        + '<div class="dm-body">'

        +   '<div class="dm-storage-card">'
        +     '<div class="dm-storage-header">'
        +       '<span class="dm-storage-title"><i class="fas fa-database" style="margin-right:5px;opacity:0.55"></i>存储用量</span>'
        +       '<span class="dm-storage-label" id="dm-storage-total">计算中…</span>'
        +     '</div>'
        +     '<div class="dm-stats-grid">'
        +       '<div class="dm-stat-block"><div class="dm-stat-block-icon" style="color:var(--accent-color)"><i class="fas fa-comments"></i></div><div class="dm-stat-pill-val" id="dm-stat-msgs">—</div><div class="dm-stat-pill-key">聊天记录</div></div>'
        +       '<div class="dm-stat-block"><div class="dm-stat-block-icon" style="color:#9C6FD4"><i class="fas fa-sliders"></i></div><div class="dm-stat-pill-val" id="dm-stat-settings">—</div><div class="dm-stat-pill-key">设置数据</div></div>'
        +       '<div class="dm-stat-block"><div class="dm-stat-block-icon" style="color:#3BC8A4"><i class="fas fa-images"></i></div><div class="dm-stat-pill-val" id="dm-stat-media">—</div><div class="dm-stat-pill-key">图片媒体</div></div>'
        +     '</div>'
        +     '<div class="dm-progress-track"><div class="dm-progress-fill" id="dm-storage-bar" style="width:0%"></div></div>'
        +   '</div>'

        +   '<div class="dm-section-label"><i class="fas fa-cloud-upload-alt"></i> 备份与恢复</div>'
        +   '<div class="dm-grid">'
        +     '<div class="dm-tile" id="dm-tile-full-backup">'
        +       '<div class="dm-tile-icon blue"><i class="fas fa-layer-group"></i></div>'
        +       '<div class="dm-tile-info"><div class="dm-tile-title">全量备份</div><div class="dm-tile-desc">所有设置与数据</div></div>'
        +       '<i class="fas fa-chevron-right dm-tile-arrow"></i>'
        +     '</div>'
        +     '<div class="dm-tile" id="dm-tile-partner-backup">'
        +       '<div class="dm-tile-icon violet"><i class="fas fa-user-astronaut"></i></div>'
        +       '<div class="dm-tile-info"><div class="dm-tile-title">按角色备份</div><div class="dm-tile-desc">仅当前对象，可还原</div></div>'
        +       '<i class="fas fa-chevron-right dm-tile-arrow"></i>'
        +     '</div>'
        +     '<div class="dm-tile" id="dm-tile-chat-backup">'
        +       '<div class="dm-tile-icon teal"><i class="fas fa-comments"></i></div>'
        +       '<div class="dm-tile-info"><div class="dm-tile-title">聊天记录</div><div class="dm-tile-desc">消息内容单独备份</div></div>'
        +       '<i class="fas fa-chevron-right dm-tile-arrow"></i>'
        +     '</div>'
        +     '<div class="dm-tile" id="dm-tile-rollback">'
        +       '<div class="dm-tile-icon amber"><i class="fas fa-clock-rotate-left"></i></div>'
        +       '<div class="dm-tile-info"><div class="dm-tile-title">恢复上一步</div><div class="dm-tile-desc">操作/更新前自动快照</div></div>'
        +       '<i class="fas fa-chevron-right dm-tile-arrow"></i>'
        +     '</div>'
        +   '</div>'

        +   '<div style="display:none">'
        +     '<button id="export-all-settings"></button>'
        +     '<button id="import-all-settings"></button>'
        +     '<button id="export-chat-btn"></button>'
        +     '<button id="import-chat-btn"></button>'
        +   '</div>'

        +   '<div class="dm-section-label"><i class="fas fa-info-circle"></i> 关于</div>'
        +   '<div class="dm-row-card">'
        +     '<div class="dm-row-item" id="replay-tutorial-btn-row" style="cursor:pointer">'
        +       '<div class="dm-row-icon slate"><i class="fas fa-compass"></i></div>'
        +       '<div class="dm-row-info"><div class="dm-row-title">重放新手引导</div><div class="dm-row-desc">重新播放功能介绍教程</div></div>'
        +       '<button class="dm-nav-btn" id="replay-tutorial-btn"><i class="fas fa-play"></i></button>'
        +     '</div>'
        +     '<div class="dm-row-item" id="open-credits-row" style="cursor:pointer">'
        +       '<div class="dm-row-icon violet"><i class="fas fa-scroll"></i></div>'
        +       '<div class="dm-row-info"><div class="dm-row-title">声明与致谢</div><div class="dm-row-desc">开源声明、致谢名单</div></div>'
        +       '<button class="dm-nav-btn" id="open-credits-btn"><i class="fas fa-chevron-right"></i></button>'
        +     '</div>'
        +     '<div class="dm-row-item" id="check-update-row" style="cursor:pointer">'
        +       '<div class="dm-row-icon green"><i class="fas fa-sync-alt"></i></div>'
        +       '<div class="dm-row-info"><div class="dm-row-title">检查更新</div><div class="dm-row-desc" id="dm-update-status">当前版本 v' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '3.0.0') + '</div></div>'
        +       '<button class="dm-nav-btn" id="check-update-dm-btn"><i class="fas fa-chevron-right"></i></button>'
        +     '</div>'
        +   '</div>'

        +   '<div class="dm-section-label danger-label"><i class="fas fa-triangle-exclamation"></i> 危险操作</div>'
        +   '<div class="dm-danger-cards dm-danger-cards-row">'
        +     '<button class="dm-danger-card dm-danger-card-orange dm-danger-card-half" id="clear-chat-only">'
        +       '<div class="dm-danger-card-icon"><i class="fas fa-eraser"></i></div>'
        +       '<div class="dm-danger-card-body">'
        +         '<div class="dm-danger-card-title">清除会话</div>'
        +         '<div class="dm-danger-card-desc">删除本会话消息</div>'
        +       '</div>'
        +     '</button>'
        +     '<button class="dm-danger-card dm-danger-card-red dm-danger-card-half" id="clear-storage">'
        +       '<div class="dm-danger-card-icon"><i class="fas fa-skull-crossbones"></i></div>'
        +       '<div class="dm-danger-card-body">'
        +         '<div class="dm-danger-card-title">重置数据</div>'
        +         '<div class="dm-danger-card-desc">清空所有，不可撤销</div>'
        +       '</div>'
        +     '</button>'
        +   '</div>'

        + '</div>'
        + '<div class="modal-buttons" style="display:flex;justify-content:space-between;padding:12px 20px;border-top:1px solid var(--border-color);background:var(--secondary-bg);flex-shrink:0;">'
        +   '<button class="modal-btn modal-btn-secondary" id="back-data"><i class="fas fa-arrow-left"></i> 返回</button>'
        +   '<button class="modal-btn modal-btn-secondary" id="close-data">关闭</button>'
        + '</div>';

    var DRAWER_FULL_HTML =
        '<div class="dm-action-drawer" id="dm-drawer-full">'
        +   '<div class="dm-drawer-backdrop" id="dm-drawer-full-backdrop"></div>'
        +   '<div class="dm-drawer-sheet">'
        +     '<div class="dm-drawer-handle"></div>'
        +     '<div class="dm-drawer-title">'
        +       '<div class="dm-drawer-title-icon blue" style="background:linear-gradient(135deg,#4A90E2,#3576C8);color:#fff"><i class="fas fa-layer-group"></i></div>'
        +       '<div><div class="dm-drawer-title-text">全量备份</div><div class="dm-drawer-subtitle">包含所有设置、外观、字卡等数据</div></div>'
        +     '</div>'
        +     '<div class="dm-drawer-actions">'
        +       '<button class="dm-drawer-action-btn primary" id="export-all-settings-real">'
        +         '<div class="dm-drawer-btn-icon"><i class="fas fa-download"></i></div>'
        +         '<div class="dm-drawer-btn-text"><div class="dm-drawer-btn-title">导出备份</div><div class="dm-drawer-btn-desc">将数据保存为文件</div></div>'
        +       '</button>'
        +       '<button class="dm-drawer-action-btn" id="import-all-settings-real">'
        +         '<div class="dm-drawer-btn-icon"><i class="fas fa-upload"></i></div>'
        +         '<div class="dm-drawer-btn-text"><div class="dm-drawer-btn-title">从文件恢复</div><div class="dm-drawer-btn-desc">选择之前导出的备份文件</div></div>'
        +       '</button>'
        +     '</div>'
        +     '<div id="dm-drawer-full-notice"></div>'
        +     '<button class="dm-drawer-cancel" id="dm-drawer-full-cancel">取消</button>'
        +   '</div>'
        + '</div>';

    var DRAWER_CHAT_HTML =
        '<div class="dm-action-drawer" id="dm-drawer-chat">'
        +   '<div class="dm-drawer-backdrop" id="dm-drawer-chat-backdrop"></div>'
        +   '<div class="dm-drawer-sheet">'
        +     '<div class="dm-drawer-handle"></div>'
        +     '<div class="dm-drawer-title">'
        +       '<div class="dm-drawer-title-icon" style="background:linear-gradient(135deg,#3BC8A4,#20A882);color:#fff"><i class="fas fa-comments"></i></div>'
        +       '<div><div class="dm-drawer-title-text">聊天记录</div><div class="dm-drawer-subtitle">仅包含消息内容</div></div>'
        +     '</div>'
        +     '<div class="dm-drawer-actions">'
        +       '<button class="dm-drawer-action-btn primary" id="export-chat-btn-real" style="background:linear-gradient(135deg,#3BC8A4,#20A882);border-color:#3BC8A4">'
        +         '<div class="dm-drawer-btn-icon"><i class="fas fa-download"></i></div>'
        +         '<div class="dm-drawer-btn-text"><div class="dm-drawer-btn-title">导出聊天</div><div class="dm-drawer-btn-desc">将消息记录保存为文件</div></div>'
        +       '</button>'
        +       '<button class="dm-drawer-action-btn" id="import-chat-btn-real">'
        +         '<div class="dm-drawer-btn-icon"><i class="fas fa-upload"></i></div>'
        +         '<div class="dm-drawer-btn-text"><div class="dm-drawer-btn-title">导入聊天</div><div class="dm-drawer-btn-desc">从文件恢复历史消息</div></div>'
        +       '</button>'
        +     '</div>'
        +     '<button class="dm-drawer-cancel" id="dm-drawer-chat-cancel">取消</button>'
        +   '</div>'
        + '</div>'

    function isCorrect(mc) {
        return mc.querySelector('.modal-title') !== null
            && mc.querySelector('.dm-storage-card') !== null
            && mc.querySelector('.dm6') === null
            && mc.querySelector('.dm6-tabs') === null;
    }

    function ensureDrawersOnBody() {
        var DRAWER_IDS = ['dm-drawer-full', 'dm-drawer-chat'];
        DRAWER_IDS.forEach(function(id) {
            var existing = document.getElementById(id);
            if (existing && existing.parentElement === document.body) return;
            if (existing) {
                document.body.appendChild(existing);
                return;
            }
            var dummy = document.createElement('div');
            if (id === 'dm-drawer-full') dummy.innerHTML = DRAWER_FULL_HTML;
            else dummy.innerHTML = DRAWER_CHAT_HTML;
            document.body.appendChild(dummy.firstElementChild);
        });
    }

    function writeHTML(mc) {
        mc.innerHTML = INNER_HTML;
        mc.dataset.dm6Built = 'v11'; 
        ensureDrawersOnBody();
        bindAll(mc);
    }

    function ensureHTML(mc) {
        if (!mc) return;
        if (mc.dataset.dm6Built !== 'v11' || !isCorrect(mc)) writeHTML(mc);
        else ensureDrawersOnBody(); 
    }

    function fmt(b) {
        if (b < 1024) return Math.round(b) + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        return (b / 1048576).toFixed(2) + ' MB';
    }

    function applyStats(total, msgs, cfg, media) {
        var g = function (id) { return document.getElementById(id); };

        // 直接显示手动累加的分类
        if (g('dm-stat-msgs'))     g('dm-stat-msgs').textContent     = fmt(msgs);
        if (g('dm-stat-settings')) g('dm-stat-settings').textContent = fmt(cfg);
        if (g('dm-stat-media'))    g('dm-stat-media').textContent    = fmt(media);

        // 顶部总用量 = total（手动累加），进度条 = total / quota
        var totalEl = g('dm-storage-total');
        var barEl   = g('dm-storage-bar');

        if (navigator.storage && navigator.storage.estimate) {
            navigator.storage.estimate().then(function(est) {
                var quota = est.quota || 0;
                var pct = quota > 0 ? Math.min(100, total / quota * 100) : 0;
                var pctStr = pct.toFixed(1);
                var quotaStr = quota >= 1073741824 ? (quota/1073741824).toFixed(2)+' GB'
                             : quota >= 1048576    ? (quota/1048576).toFixed(1)+' MB'
                             : quota > 0           ? (quota/1024).toFixed(1)+' KB' : '未知';
                if (totalEl) totalEl.textContent = fmt(total) + ' / ' + quotaStr + ' (' + pctStr + '%)';
                if (barEl) {
                    barEl.style.width = pctStr + '%';
                    barEl.style.background = pct > 80
                        ? 'linear-gradient(90deg,#FF3B30,#CC0000)'
                        : pct > 50
                        ? 'linear-gradient(90deg,#FF9F0A,#E07000)'
                        : 'linear-gradient(90deg,var(--accent-color),rgba(var(--accent-color-rgb),0.6))';
                }
            }).catch(function() {
                if (totalEl) totalEl.textContent = fmt(total);
                if (barEl) barEl.style.width = '0%';
            });
        } else {
            if (totalEl) totalEl.textContent = fmt(total);
            if (barEl) barEl.style.width = '0%';
        }
    }

    // 递归估算任意值的占用字节数（UTF-16 *2）。只用"累加 length"，不整份 JSON.stringify，
    // 避免对含大量 base64 的巨键再生成一份超大字符串把主线程卡死。
    function estimateValueBytes(v) {
        if (typeof v === 'string') return v.length * 2;
        if (v == null) return 0;
        if (v instanceof Blob) return v.size || 0; // 本地直存音频等二进制：按实际体积计入，不等同于字符串
        if (typeof v === 'number') return 8;
        if (typeof v === 'boolean') return 1;
        if (Array.isArray(v)) {
            var s = v.length * 2;
            for (var i = 0; i < v.length; i++) s += estimateValueBytes(v[i]);
            return s;
        }
        if (typeof v === 'object') {
            var t = 0;
            for (var k in v) {
                if (Object.prototype.hasOwnProperty.call(v, k)) { t += k.length * 2; t += estimateValueBytes(v[k]); }
            }
            return t;
        }
        return 0;
    }
    // 已在内存引用估算过的大键，后续不再从 IndexedDB getItem（否则巨键 structuredClone + stringify 会卡死打开面板）
    var MEM_EST_KEYS = ['messages', 'stickerLibrary', 'myStickerLibrary', 'voiceCards', 'customThemes'];

    function updateStats() {
        var total = 0, msgs = 0, cfg = 0, media = 0;
        // 1) localStorage 即时累加（轻量，仅字符串长度）
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i) || '';
            var v = localStorage.getItem(k) || '';
            var bytes = (k.length + v.length) * 2;
            total += bytes;
            if (/messages|msgs|session/i.test(k)) msgs += bytes;
            else if (v.indexOf('data:image') === 0 || v.indexOf('data:video') === 0) media += bytes;
            else cfg += bytes;
        }
        // 2) 大键从内存引用估算（window 已由 saveData 同步）——不 getItem、不 stringify
        for (var mi = 0; mi < MEM_EST_KEYS.length; mi++) {
            var ref = (typeof window !== 'undefined') ? window[MEM_EST_KEYS[mi]] : undefined;
            if (ref == null) continue;
            var b = estimateValueBytes(ref);
            total += b;
            if (MEM_EST_KEYS[mi] === 'messages') msgs += b;
            else if (MEM_EST_KEYS[mi] === 'customThemes') cfg += b;
            else media += b;
        }
        // 3) 其余 IndexedDB 键（头像/背景/分组等量小）异步分片统计，批次间让出主线程，避免一次卡死
        var moreTotal = 0, moreMsgs = 0, moreCfg = 0, moreMedia = 0;
        function finish() {
            applyStats(total + moreTotal, msgs + moreMsgs, cfg + moreCfg, media + moreMedia);
        }
        function doMore(keys, startIdx) {
            if (!keys || startIdx >= keys.length) { finish(); return; }
            var end = Math.min(startIdx + 4, keys.length);
            (function next(batchIdx) {
                if (batchIdx >= end) { setTimeout(function () { doMore(keys, end); }, 0); return; }
                var kk = keys[batchIdx];
                if (MEM_EST_KEYS.indexOf(kk) !== -1) { next(batchIdx + 1); return; } // 已在内存估算，跳过
                localforage.getItem(kk).then(function (raw) {
                    if (raw != null) {
                        var bb = estimateValueBytes(raw);
                        moreTotal += bb;
                        if (/messages|msgs|session/i.test(kk)) moreMsgs += bb;
                        else if (/avatar|image|photo|bg|background|wallpaper|favAudio/i.test(kk)) moreMedia += bb;
                        else moreCfg += bb;
                    }
                    next(batchIdx + 1);
                }).catch(function () { next(batchIdx + 1); });
            })(startIdx);
        }
        try {
            if (window.localforage) {
                localforage.keys().then(function (keys) { doMore(keys, 0); })
                    .catch(function () { finish(); });
            } else { finish(); }
        } catch (e) { finish(); }
    }

    function syncToggles() {
        var n = document.getElementById('notif-permission-toggle');
        if (!n) return;
        var enabled = localStorage.getItem('notifEnabled') === '1';
        // APK 环境：通过 PushBridge 检查权限状态
        if (typeof PushBridge !== 'undefined' && PushBridge.isNative()) {
            n.checked = enabled && PushBridge.getStatus() === 'granted';
            return;
        }
        n.checked = enabled && 'Notification' in window && Notification.permission === 'granted';
    }

    function openDrawer(drawerId) {
        var drawer = document.getElementById(drawerId);
        if (!drawer) return;
        drawer.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function closeDrawer(drawerId) {
        var drawer = document.getElementById(drawerId);
        if (!drawer) return;
        drawer.classList.remove('open');
        document.body.style.overflow = '';
    }

    function bindAll(mc) {
        var closeBtn = mc.querySelector('#close-data');
        if (closeBtn) closeBtn.addEventListener('click', function () {
            var modal = document.getElementById('data-modal');
            if (modal && typeof hideModal === 'function') hideModal(modal);
        });

        var backBtn = mc.querySelector('#back-data');
        if (backBtn) backBtn.addEventListener('click', function () {
            var dataModal = document.getElementById('data-modal');
            if (dataModal && typeof hideModal === 'function') hideModal(dataModal);
            var settingsModal = document.getElementById('settings-modal');
            if (settingsModal && typeof showModal === 'function') showModal(settingsModal);
        });

        var tileFullBackup = mc.querySelector('#dm-tile-full-backup');
        if (tileFullBackup) tileFullBackup.addEventListener('click', function () {
            openDrawer('dm-drawer-full');
            var notice = document.getElementById('dm-drawer-full-notice');
            if (notice) {
                var isCloudConnected = window.CloudSync && typeof window.CloudSync.isConnected === 'function' && window.CloudSync.isConnected();
                if (isCloudConnected) {
                    notice.innerHTML = '<div style="margin:12px 0 4px;padding:10px 12px;background:rgba(197,164,126,0.12);border:1px solid rgba(197,164,126,0.35);border-radius:10px;font-size:12px;color:var(--text-secondary);line-height:1.6;">'
                        + '<i class="fas fa-circle-info" style="color:var(--accent-color);margin-right:5px;"></i>'
                        + '已启用云端存储：全量备份<b>不包含</b>背景图、表情包、聊天图片、收藏语音等媒体文件，这些文件仅存储在云端。文字类数据（聊天记录、字卡回复库、陪伴日记、心情手账、纪念日/倒计时、主题配色）可通过「聊天记录 → 选择导出」单独备份。'
                        + '</div>';
                } else {
                    notice.innerHTML = '';
                }
            }
        });

        var tileChatBackup = mc.querySelector('#dm-tile-chat-backup');
        if (tileChatBackup) tileChatBackup.addEventListener('click', function () { openDrawer('dm-drawer-chat'); });

        var tilePartnerBackup = mc.querySelector('#dm-tile-partner-backup');
        if (tilePartnerBackup) tilePartnerBackup.addEventListener('click', function () {
            if (typeof window.openPartnerBackup === 'function') window.openPartnerBackup();
            else if (typeof showNotification === 'function') showNotification('备份模块未就绪', 'error');
        });

        var rollbackTile = mc.querySelector('#dm-tile-rollback');
        if (rollbackTile) rollbackTile.addEventListener('click', function () {
            _openRollbackList();
        });

        // 恢复上一步：列出自动快照，用户可一键找回（针对导入/云同步/更新误覆盖）
        function _openRollbackList() {
            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;z-index:999991;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
            overlay.innerHTML =
                '<div style="width:min(480px,92vw);max-height:78vh;display:flex;flex-direction:column;background:var(--secondary-bg,#fff);border-radius:18px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3);">'
                + '<div style="padding:16px 18px;font-size:16px;font-weight:800;color:var(--text-primary);border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:8px;"><i class="fas fa-clock-rotate-left" style="color:var(--accent-color);"></i>恢复上一步（自动快照）</div>'
                + '<div id="rollback-list-body" style="flex:1;overflow:auto;padding:14px 16px;min-height:160px;color:var(--text-secondary);font-size:13px;">加载中…</div>'
                + '<div style="padding:12px 16px;border-top:1px solid var(--border-color);display:flex;justify-content:flex-end;"><button class="modal-btn modal-btn-secondary" id="rollback-close" style="padding:8px 20px;">关闭</button></div>'
                + '</div>';
            overlay.addEventListener('click', function (ev) { if (ev.target === overlay) overlay.remove(); });
            document.body.appendChild(overlay);
            document.getElementById('rollback-close').onclick = function () { overlay.remove(); };

            var body = document.getElementById('rollback-list-body');
            var apply = function (html) { if (body) body.innerHTML = html; };

            if (!window.ChatBackup || !window.ChatBackup.listRollbackSnapshots) {
                apply('<div style="padding:24px 0;text-align:center;">备份模块未就绪，无法读取快照。</div>'); return;
            }

            window.ChatBackup.listRollbackSnapshots().then(function (snaps) {
                if (!snaps || snaps.length === 0) {
                    apply('<div style="padding:28px 0;text-align:center;line-height:2;">'
                        + '暂无自动快照。<br><span style="font-size:12px;opacity:0.7;">每当进行「导入 / 从文件恢复 / 云同步恢复到本地」前，应用都会自动留一份可回滚快照（保留最近 2 份）。</span></div>');
                    return;
                }
                var rows = snaps.map(function (s) {
                    var d = new Date(s.t);
                    var tm = (d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2));
                    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 12px;border:1.5px solid var(--border-color);border-radius:12px;margin-bottom:10px;background:var(--primary-bg,#fff);">'
                        + '<div style="flex:1;min-width:0;"><div style="font-weight:700;color:var(--text-primary);font-size:13px;">' + (s.reason || '操作前') + '</div>'
                        + '<div style="font-size:12px;opacity:0.7;margin-top:2px;">' + tm + '</div></div>'
                        + '<button class="modal-btn modal-btn-primary" data-k="' + s.key + '" style="flex-shrink:0;padding:8px 16px;">恢复</button></div>';
                }).join('');
                apply(rows);
                Array.prototype.forEach.call(body.querySelectorAll('button[data-k]'), function (btn) {
                    btn.onclick = function () {
                        var k = btn.getAttribute('data-k');
                        if (!confirm('确定恢复到该快照？当前所有数据会被该快照覆盖。')) return;
                        btn.disabled = true; btn.textContent = '恢复中…';
                        if (window.ChatBackup.restoreRollbackSnapshot) {
                            window.ChatBackup.restoreRollbackSnapshot(k).then(function () {
                                if (typeof showNotification === 'function') showNotification('已恢复，正在刷新页面…', 'success', 2000);
                                setTimeout(function () { location.reload(); }, 600);
                            }).catch(function (err) {
                                btn.disabled = false; btn.textContent = '恢复';
                                if (typeof showNotification === 'function') showNotification('恢复失败：' + (err && err.message || err), 'error', 4000);
                            });
                        }
                    };
                });
            }).catch(function (err) {
                apply('<div style="padding:24px 0;text-align:center;">读取快照失败：' + (err && err.message || err) + '</div>');
            });
        }

        var fullDrawer = document.getElementById('dm-drawer-full');
        if (fullDrawer) {
            var backdrop1 = fullDrawer.querySelector('#dm-drawer-full-backdrop');
            if (backdrop1) backdrop1.addEventListener('click', function () { closeDrawer('dm-drawer-full'); });
            var cancelBtn1 = fullDrawer.querySelector('#dm-drawer-full-cancel');
            if (cancelBtn1) cancelBtn1.addEventListener('click', function () { closeDrawer('dm-drawer-full'); });
            var exportAllReal = fullDrawer.querySelector('#export-all-settings-real');
            if (exportAllReal) exportAllReal.addEventListener('click', function () {
                closeDrawer('dm-drawer-full');
                if (typeof exportAllData === 'function') exportAllData();
            });
            var importAllReal = fullDrawer.querySelector('#import-all-settings-real');
            if (importAllReal) importAllReal.addEventListener('click', function () {
                closeDrawer('dm-drawer-full');
                var inp = document.createElement('input');
                inp.type = 'file'; inp.accept = '.json,.zip,application/json,application/zip';
                inp.onchange = function (e) {
                    var f = e.target.files && e.target.files[0];
                    if (f && typeof importAllData === 'function') importAllData(f);
                };
                inp.click();
            });
        }

        var chatDrawer = document.getElementById('dm-drawer-chat');
        if (chatDrawer) {
            var backdrop2 = chatDrawer.querySelector('#dm-drawer-chat-backdrop');
            if (backdrop2) backdrop2.addEventListener('click', function () { closeDrawer('dm-drawer-chat'); });
            var cancelBtn2 = chatDrawer.querySelector('#dm-drawer-chat-cancel');
            if (cancelBtn2) cancelBtn2.addEventListener('click', function () { closeDrawer('dm-drawer-chat'); });
            var exportChatReal = chatDrawer.querySelector('#export-chat-btn-real');
            if (exportChatReal) exportChatReal.addEventListener('click', function () {
                closeDrawer('dm-drawer-chat');
                if (typeof exportChatHistory === 'function') exportChatHistory();
            });
            var importChatReal = chatDrawer.querySelector('#import-chat-btn-real');
            if (importChatReal) importChatReal.addEventListener('click', function () {
                closeDrawer('dm-drawer-chat');
                var inp = document.createElement('input');
                inp.type = 'file'; inp.accept = '.json';
                inp.onchange = function (e) {
                    var f = e.target.files && e.target.files[0];
                    if (f && typeof importChatHistory === 'function') importChatHistory(f);
                };
                inp.click();
            });
        }

        var clearChatBtn = mc.querySelector('#clear-chat-only');
        if (clearChatBtn) clearChatBtn.addEventListener('click', function () {
            if (!confirm('确定要清除当前会话的所有消息吗？\n\n所有设置、头像、字卡等数据将保留，仅聊天记录会被删除。\n\n此操作无法恢复！')) return;
            // 修复：直接赋值 let messages（window.messages 赋值不影响 let 绑定）
            messages = [];
            displayedMessageCount = typeof HISTORY_BATCH_SIZE !== 'undefined' ? HISTORY_BATCH_SIZE : 20;
            try { localStorage.removeItem('BACKUP_V1_critical'); } catch(e) {}
            try { localStorage.removeItem('BACKUP_V1_timestamp'); } catch(e) {}
            if (window.localforage && typeof getStorageKey === 'function') {
                localforage.setItem(getStorageKey('chatMessages'), []).catch(function() {});
            }
            if (typeof renderMessages === 'function') renderMessages();
            if (typeof showNotification === 'function') showNotification('聊天记录已清除', 'success');
        });

        var clearBtn = mc.querySelector('#clear-storage');
        if (clearBtn) clearBtn.addEventListener('click', function () {
            if (!confirm('⚠️ 确定要清空全部数据吗？\n\n所有消息、设置、字卡、头像等将被永久删除，不可恢复！')) return;
            if (!confirm('最后确认：清空后页面将自动刷新，无法撤销，继续吗？')) return;
            window._skipBackup = true;
            var doReset = function () {
                localStorage.clear();
                if (typeof showNotification === 'function') showNotification('所有数据已清空，即将刷新…', 'info', 2000);
                setTimeout(function () { window.location.href = window.location.pathname + '?reset=' + Date.now(); }, 2000);
            };
            window.localforage ? localforage.clear().then(doReset).catch(doReset) : doReset();
        });

        var exportAll = mc.querySelector('#export-all-settings');
        if (exportAll) exportAll.addEventListener('click', function () {
            if (typeof exportAllData === 'function') exportAllData();
        });

        var importAll = mc.querySelector('#import-all-settings');
        if (importAll) importAll.addEventListener('click', function () {
            var inp = document.createElement('input');
            inp.type = 'file'; inp.accept = '.json,.zip,application/json,application/zip';
            inp.onchange = function (e) {
                var f = e.target.files && e.target.files[0];
                if (f && typeof importAllData === 'function') importAllData(f);
            };
            inp.click();
        });

        var exportChat = mc.querySelector('#export-chat-btn');
        if (exportChat) exportChat.addEventListener('click', function () {
            if (typeof exportChatHistory === 'function') exportChatHistory();
        });

        var importChat = mc.querySelector('#import-chat-btn');
        if (importChat) importChat.addEventListener('click', function () {
            var inp = document.createElement('input');
            inp.type = 'file'; inp.accept = '.json';
            inp.onchange = function (e) {
                var f = e.target.files && e.target.files[0];
                if (f && typeof importChatHistory === 'function') importChatHistory(f);
            };
            inp.click();
        });

        var creditsBtn = mc.querySelector('#open-credits-btn');
        if (creditsBtn) creditsBtn.addEventListener('click', function () {
            var dataModal = document.getElementById('data-modal');
            if (dataModal && typeof hideModal === 'function') hideModal(dataModal);
            var disc = document.getElementById('disclaimer-modal');
            if (disc && typeof showModal === 'function') showModal(disc);
        });

        var tutorialBtn = mc.querySelector('#replay-tutorial-btn');
        if (tutorialBtn) tutorialBtn.addEventListener('click', function () {
            var dataModal = document.getElementById('data-modal');
            if (dataModal && typeof hideModal === 'function') hideModal(dataModal);
            if (typeof startTour === 'function') {
                if (window.localforage && window.APP_PREFIX) {
                    localforage.removeItem(APP_PREFIX + 'tour_seen').then(startTour).catch(startTour);
                } else { startTour(); }
            }
        });

        // 检查更新按钮
        var updateRow = mc.querySelector('#check-update-row');
        var updateBtn = mc.querySelector('#check-update-dm-btn');
        var updateHandler = function () {
            if (typeof checkAppUpdateDM === 'function') checkAppUpdateDM();
        };
        if (updateRow) updateRow.addEventListener('click', updateHandler);
        if (updateBtn) updateBtn.addEventListener('click', updateHandler);
    }

    function onModalOpen(modal) {
        var mc = modal.querySelector('.modal-content');
        if (!mc) return;
        ensureHTML(mc);
        requestAnimationFrame(function () {
            mc.style.opacity = '1';
            mc.style.transform = 'none';
        });
        setTimeout(function () {
            updateStats();
            syncToggles();
        }, 60);
    }

    var _styleObserver = null;
    var _contentObserver = null;

    function init() {
        var modal = document.getElementById('data-modal');
        if (!modal) return;

        var mc = modal.querySelector('.modal-content');
        if (mc) mc.dataset.dm6Built = 'v9';

        if (_styleObserver) { _styleObserver.disconnect(); _styleObserver = null; }
        if (_contentObserver) { _contentObserver.disconnect(); _contentObserver = null; }

        _styleObserver = new MutationObserver(function () {
            var d = modal.style.display;
            if (d === 'flex' || d === 'block') onModalOpen(modal);
        });
        _styleObserver.observe(modal, { attributes: true, attributeFilter: ['style'] });

        if (mc) {
            _contentObserver = new MutationObserver(function () {
                var mc2 = modal.querySelector('.modal-content');
                if (mc2 && !isCorrect(mc2)) {
                    mc2.dataset.dm6Built = 'v9';
                    writeHTML(mc2);
                }
            });
            _contentObserver.observe(mc, { childList: true, subtree: false });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
    } else {
        init();
    }

    window.updateStats = updateStats;

})();

function updateStorageUsageBar() {
    if (typeof window.updateStats === 'function') window.updateStats();
}

(function() {
    var orig = window.showModal;
    if (typeof orig === 'function') {
        window.showModal = function(el) {
            orig.apply(this, arguments);
            if (el && el.id === 'data-modal') {
                setTimeout(updateStorageUsageBar, 250);
            }
        };
    }
})();

document.addEventListener('DOMContentLoaded', function() {
    var btn = document.getElementById('data-settings');
    if (btn) {
        btn.addEventListener('click', function() { setTimeout(updateStorageUsageBar, 350); });
    }
});

/* ===== 应用内"系统信息弹窗" =====
 * 恢复 1.6.1 的消息弹窗体验：所有"梦角"消息类型
 * （聊天 / 视频邀请 / 陪伴邀请 / 拍一拍 / 电影邀请 / 听音乐邀请 / 空间动态）
 * 在收到时都会在页面顶部弹出系统信息条，几秒后自动收回。
 * 与原生系统通知（PushBridge）并行：原生环境走系统通知，这里提供应用内弹窗兜底。
 */
window._sysInfoPopup = {
    wrapEl: null,
    timer: null,
    unread: 0,
    jumpWorthy: false,
    _ensure: function () {
        if (this.wrapEl) return this.wrapEl;
        var wrap = document.getElementById('sysinfo-popup-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'sysinfo-popup-wrap';
            wrap.style.cssText = [
                'position:fixed','top:max(14px,env(safe-area-inset-top))','left:0','right:0',
                'display:flex','justify-content:center','pointer-events:none',
                'z-index:2147483000','padding:0 12px','transform:translateY(-140%)',
                'transition:transform .28s cubic-bezier(.2,.9,.3,1.2)'
            ].join(';');
            wrap.setAttribute('aria-live','polite');
            wrap.innerHTML = [
                '<div id="sysinfo-popup-card" style="'+[
                    'pointer-events:auto','max-width:420px','width:100%','box-sizing:border-box',
                    'display:flex','align-items:center','gap:10px',
                    'background:rgba(24,24,30,.92)','color:#fff',
                    'border:1px solid rgba(255,255,255,.12)','border-radius:14px',
                    'padding:10px 14px','box-shadow:0 8px 30px rgba(0,0,0,.35)',
                    'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
                    'font-size:14px','line-height:1.35','cursor:pointer','-webkit-backdrop-filter:blur(10px)'
                ].join(';')+'" onclick="window._sysInfoPopup&&window._sysInfoPopup.tap()">',
                '<div style="flex-shrink:0;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;background:rgba(255,255,255,.12)" id="sysinfo-popup-ico">💬</div>',
                '<div style="flex:1;min-width:0">',
                '  <div style="font-weight:600;font-size:13px;color:rgba(255,255,255,.82);display:flex;align-items:center;gap:6px" id="sysinfo-popup-title">系统信息</div>',
                '  <div style="margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" id="sysinfo-popup-body"></div>',
                '</div>',
                '</div>'
            ].join('');
            document.body.appendChild(wrap);
        }
        this.wrapEl = wrap;
        return wrap;
    },
    show: function (title, body, options) {
        options = options || {};
        var wrap = this._ensure();
        title = title || '系统信息';
        body = body || '';
        this.unread++;
        // 点击弹窗是否“收起遮盖并跳回最新消息”：紧急邀请（视频/来电等）跳转可能与邀请自身的浮层冲突，仅普通消息跳回
        this.jumpWorthy = !options.urgent;

        var titleEl = document.getElementById('sysinfo-popup-title');
        var bodyEl  = document.getElementById('sysinfo-popup-body');
        var icoEl   = document.getElementById('sysinfo-popup-ico');
        if (titleEl) {
            if (this.unread > 1) titleEl.textContent = title + '（' + this.unread + '条新消息）';
            else titleEl.textContent = title;
        }
        if (bodyEl) bodyEl.textContent = body;
        if (icoEl) {
            var m = (title + body);
            if (/视频|来电|呼叫/.test(m)) icoEl.textContent = '🎥';
            else if (/陪伴/.test(m)) icoEl.textContent = '💞';
            else if (/拍一拍|拍了拍/.test(m)) icoEl.textContent = '👋';
            else if (/电影|看|影院|片/.test(m)) icoEl.textContent = '🎬';
            else if (/音乐|听歌|听一曲/.test(m)) icoEl.textContent = '🎵';
            else if (/动态|空间|新的动态|更新了动态/.test(m)) icoEl.textContent = '✨';
            else icoEl.textContent = '💬';
        }

        // 收起旧的再重新弹出，确保每次都完整出现
        wrap.style.transition = 'none';
        wrap.style.transform = 'translateY(-140%)';
        // 强制回流后再弹出，保证过渡动画生效
        void wrap.offsetHeight;
        wrap.style.transition = 'transform .28s cubic-bezier(.2,.9,.3,1.2)';
        wrap.style.transform = 'translateY(0)';

        if (this.timer) clearTimeout(this.timer);
        // 紧急邀请（视频/来电等）停留更久，普通消息几秒后自动收回
        var hold = options.urgent ? 6000 : 2600;
        this.timer = setTimeout(function(){ window._sysInfoPopup.hide(); }, hold);
    },
    hide: function () {
        if (!this.wrapEl) return;
        this.wrapEl.style.transform = 'translateY(-140%)';
        var self = this;
        setTimeout(function(){ if (self.wrapEl) self.wrapEl.style.transform = 'translateY(-140%)'; self.unread = 0; }, 300);
        this.jumpWorthy = false;
    },
    // 点击系统信息弹窗：收起弹窗；若是普通消息，顺手关掉盖在聊天上的弹窗/情侣空间并跳回最新消息
    tap: function () {
        if (!this.jumpWorthy) { this.hide(); return; }
        this.hide();
        var self = this;
        setTimeout(function () {
            try {
                document.querySelectorAll('.modal').forEach(function (m) {
                    if (getComputedStyle(m).display !== 'none' && typeof window.hideModal === 'function') {
                        window.hideModal(m);
                    }
                });
                if (typeof window.closeCoupleSpace === 'function') window.closeCoupleSpace();
            } catch (e) {}
            if (typeof window._backToLatestMessages === 'function') {
                window._backToLatestMessages();
            }
        }, 420);
    }
};
window.showSystemInfoPopup = function (title, body, options) {
    try { window._sysInfoPopup.show(title, body, options || {}); } catch (e) {}
};

window._sendPartnerNotification = function(title, body, options) {
    options = options || {};
    title = title || '传讯';
    body = body || '对方发来了消息';
    var isApk = !!(window.Capacitor && window.Capacitor.Plugins);

    // 默认带发件人名字与对方头像：让 APK 系统通知呈现"联系人式"大图 + 发件人小字，
    // 与聊天/桌面头像一致，比纯文字更醒目可辨认。
    if (!options.sender) {
        try { if (window.settings && settings.partnerName) options.sender = settings.partnerName; } catch (e) {}
    }
    if (!options.avatar) {
        try {
            var av = document.querySelector('#partner-avatar img,[id*="partner-avatar"] img,.partner-avatar img');
            if (av && av.src) options.avatar = av.src;
        } catch (e) {}
    }

    // 1) 应用内"系统信息弹窗"：独立 try，任何情况都不可阻塞系统通知
    try {
        if (typeof window.showSystemInfoPopup === 'function') {
            window.showSystemInfoPopup(title, body, options);
        }
    } catch (e) { console.warn('[notify] 应用内弹窗异常(不影响系统通知):', e); }

    // 2) 系统通知：统一走 PushBridge（浏览器 / APK 自适应）。独立 try + 到点重试，
    //    确保"新内容已生成"就必定送达——尤其 梦角来信 / 空间动态 这类一次性触发，
    //    若触发瞬间原生桥尚未就绪/抖动，不再静默吞掉而是稍后重试。
    function doSystemSend(attempt) {
        attempt = attempt || 1;
        try {
            if (typeof PushBridge !== 'undefined') {
                PushBridge.send(title, body, options);
                return;
            }
        } catch (e) { console.warn('[notify] PushBridge 发送异常，稍后重试:', e); }
        // 已确认非原生/无桥，走 Web Notification 回退
        if (!isApk) { doBrowserSend(); return; }
        // 原生环境但 PushBridge 未就绪：短延迟重试（最多 3 次）
        if (attempt < 3) {
            setTimeout(function () { try { doSystemSend(attempt + 1); } catch (e2) {} }, 700 * attempt);
        }
    }

    function doBrowserSend() {
        try {
            if (localStorage.getItem('notifEnabled') !== '1') return;
            if (!('Notification' in window)) return;
            if (Notification.permission !== 'granted') return;
            if (!document.hidden) return;
            new Notification(title, {
                body: body,
                icon: (document.querySelector('#partner-avatar img') || {}).src || 'https://file.youtochat.com/images/20260216/1771224856844_qdqqd.jpeg',
                badge: 'https://file.youtochat.com/images/20260216/1771224856844_qdqqd.jpeg',
                tag: options.urgent ? 'partner-invite' : 'partner-msg',
                renotify: true,
                requireInteraction: !!options.urgent,
                vibrate: options.urgent ? [120, 80, 120] : undefined
            });
        } catch (e) {}
    }

    doSystemSend(1);
};

window.handleNotifToggle = function(checkbox) {
    var statusEl = document.getElementById('notif-status-text');

    // 使用 PushBridge 统一权限请求
    if (typeof PushBridge !== 'undefined' && PushBridge.isAvailable()) {
        if (checkbox.checked) {
            PushBridge.requestPermission().then(function(perm) {
                if (perm === 'granted') {
                    if (statusEl) statusEl.textContent = '✅ 已开启 — 当页面在后台时，收到消息会弹出系统通知';
                    localStorage.setItem('notifEnabled', '1');
                    // 浏览器环境发送测试通知，APK 环境跳过
                    if (!PushBridge.isNative()) {
                        try { new Notification('传讯通知已开启 ✨', { body: '你现在可以在后台收到消息提醒了', tag: 'notif-test' }); } catch(e) {}
                    }
                } else if (perm === 'denied') {
                    checkbox.checked = false;
                    if (statusEl) statusEl.textContent = '❌ 权限被拒绝，请到系统设置中开启通知权限';
                    localStorage.setItem('notifEnabled', '0');
                } else {
                    checkbox.checked = false;
                    if (statusEl) statusEl.textContent = '⚠️ 未做出选择，请重试';
                    localStorage.setItem('notifEnabled', '0');
                }
            }).catch(function() {
                checkbox.checked = false;
                if (statusEl) statusEl.textContent = '❌ 请求权限失败，请自行搜索如何打开';
                localStorage.setItem('notifEnabled', '0');
            });
        } else {
            if (statusEl) statusEl.textContent = '已关闭 — 后台将不再弹出消息提醒';
            localStorage.setItem('notifEnabled', '0');
        }
        return;
    }

    // 回退：原有的 Web Notification API
    if (!('Notification' in window)) {
        checkbox.checked = false;
        if (statusEl) statusEl.textContent = '⚠️ 您的浏览器不支持通知功能，请更换浏览器';
        return;
    }
    if (checkbox.checked) {
        Notification.requestPermission().then(function(perm) {
            if (perm === 'granted') {
                if (statusEl) statusEl.textContent = '✅ 已开启 — 当页面在后台时，收到消息会弹出系统通知';
                localStorage.setItem('notifEnabled', '1');
                try { new Notification('传讯通知已开启 ✨', { body: '你现在可以在后台收到消息提醒了', tag: 'notif-test' }); } catch(e) {}
            } else if (perm === 'denied') {
                checkbox.checked = false;
                if (statusEl) statusEl.textContent = '❌ 权限被拒绝，请自行搜索如何开启';
                localStorage.setItem('notifEnabled', '0');
            } else {
                checkbox.checked = false;
                if (statusEl) statusEl.textContent = '⚠️ 未做出选择，请重试';
                localStorage.setItem('notifEnabled', '0');
            }
        }).catch(function() {
            checkbox.checked = false;
            if (statusEl) statusEl.textContent = '❌ 请求权限失败，请自行搜索如何打开';
            localStorage.setItem('notifEnabled', '0');
        });
    } else {
        if (statusEl) statusEl.textContent = '已关闭 — 后台将不再弹出消息提醒';
        localStorage.setItem('notifEnabled', '0');
    }
};

document.addEventListener('DOMContentLoaded', function() {
    var toggle   = document.getElementById('notif-permission-toggle');
    var statusEl = document.getElementById('notif-status-text');
    if (!toggle) return;
    var enabled = localStorage.getItem('notifEnabled') === '1';

    // APK 环境：通过 PushBridge 检查权限状态
    var isNative = typeof PushBridge !== 'undefined' && PushBridge.isNative();
    var granted = isNative
        ? PushBridge.getStatus() === 'granted'
        : ('Notification' in window) && Notification.permission === 'granted';

    toggle.checked = enabled && granted;
    if (!statusEl) return;
    if (toggle.checked) {
        statusEl.textContent = '✅ 已开启 — 当页面在后台时，收到消息会弹出系统通知';
    } else if (isNative && PushBridge.getStatus() === 'denied') {
        statusEl.textContent = '❌ 通知权限已被系统屏蔽，请到系统设置中开启';
    } else if ('Notification' in window && Notification.permission === 'denied') {
        statusEl.textContent = '❌ 通知权限已被浏览器屏蔽，请自行搜索如何开启';
    } else {
        statusEl.textContent = '关闭状态 — 开启后可在后台接收消息提醒';
    }
});
