/**
 * cloud-sync-ui.js — 云端同步的 UI（第一阶段：入口 + 密钥填写表单 + 状态显示）
 * 依赖：CloudSync、showNotification、data.js 数据管理页
 *
 * 提供内容：
 *   - 在数据管理页动态插入「云端同步」板块（入口卡片 + 状态标签）
 *   - 抽屉/弹窗：填写 Bucket / 地区 / AccessKey ID / Secret
 *   - 「测试连接」「保存并连接」「断开连接」按钮
 *   - 「如何申请密钥」教程链接（点击弹出简要说明）
 */
(function () {
    'use strict';

    var SECTION_ID = 'cloud-sync-section';
    var TILE_ID = 'cloud-sync-tile';
    var STATUS_ID = 'cloud-sync-status';
    var MODAL_ID = 'cloud-sync-modal';
    var HELP_MODAL_ID = 'cloud-sync-help-modal';

    // ==== 样式（内联注入，避免碰其他 CSS） ====
    function injectStyles() {
        if (document.getElementById('cloud-sync-style')) return;
        var s = document.createElement('style');
        s.id = 'cloud-sync-style';
        s.textContent = [
            // 强制我们的弹窗内容始终可见，覆盖 data.js 里的全局动画重置
            '#' + MODAL_ID + ' .modal-content, #' + HELP_MODAL_ID + ' .modal-content { opacity: 1 !important; transform: none !important; }',
            '#' + SECTION_ID + ' .cs-tile { background: var(--secondary-bg, #fff); border: 1px solid var(--border-color, #eee); border-radius: 14px; padding: 14px 16px; display: flex; align-items: center; gap: 12px; cursor: pointer; transition: transform .15s ease; }',
            '#' + SECTION_ID + ' .cs-tile:active { transform: scale(0.98); }',
            '#' + SECTION_ID + ' .cs-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #fff; background: linear-gradient(135deg, #6EC7E8, #4AA3D4); flex-shrink: 0; font-size: 18px; }',
            '#' + SECTION_ID + ' .cs-info { flex: 1; min-width: 0; }',
            '#' + SECTION_ID + ' .cs-title { font-size: 14px; font-weight: 600; color: var(--text-color, #333); margin-bottom: 2px; }',
            '#' + SECTION_ID + ' .cs-desc { font-size: 12px; color: var(--text-secondary, #999); }',
            '#' + SECTION_ID + ' .cs-status-badge { font-size: 11px; padding: 3px 8px; border-radius: 10px; font-weight: 500; }',
            '#' + SECTION_ID + ' .cs-status-connected { background: rgba(60,180,120,0.12); color: #2ba46e; }',
            '#' + SECTION_ID + ' .cs-status-disconnected { background: rgba(160,160,160,0.14); color: #888; }',
            '#' + SECTION_ID + ' .cs-status-error { background: rgba(230,90,90,0.14); color: #d05656; }',

            '#' + MODAL_ID + ' .cs-form { padding: 4px 20px 12px 20px; overflow-y: auto; }',
            '#' + MODAL_ID + ' .cs-field { margin-bottom: 14px; }',
            '#' + MODAL_ID + ' .cs-label { font-size: 12px; color: var(--text-secondary, #888); margin-bottom: 6px; display: block; }',
            '#' + MODAL_ID + ' .cs-input, #' + MODAL_ID + ' .cs-select { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--border-color, #e6e6e6); border-radius: 10px; font-size: 14px; background: var(--input-bg, #fafafa); color: var(--text-color, #333); font-family: inherit; }',
            '#' + MODAL_ID + ' .cs-input:focus, #' + MODAL_ID + ' .cs-select:focus { outline: none; border-color: var(--accent-color, #c5a47e); background: var(--secondary-bg, #fff); }',
            '#' + MODAL_ID + ' .cs-hint { font-size: 11px; color: var(--text-secondary, #aaa); margin-top: 5px; line-height: 1.5; }',
            '#' + MODAL_ID + ' .cs-help-link { color: var(--accent-color, #c5a47e); font-size: 12px; text-decoration: underline; cursor: pointer; margin-bottom: 12px; display: inline-block; }',
            '#' + MODAL_ID + ' .cs-actions { display: flex; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--border-color, #eee); background: var(--secondary-bg, #fafafa); flex-shrink: 0; }',
            '#' + MODAL_ID + ' .cs-btn { flex: 1; padding: 11px 6px; border-radius: 10px; border: none; font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit; white-space: nowrap; }',
            '#' + MODAL_ID + ' #cs-disconnect.cs-btn { padding: 10px; font-size: 13px; }',
            '#' + MODAL_ID + ' .cs-btn-primary { background: var(--accent-color, #c5a47e); color: #fff; }',
            '#' + MODAL_ID + ' .cs-btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }',
            '#' + MODAL_ID + ' .cs-btn-secondary { background: var(--input-bg, #f0f0f0); color: var(--text-color, #333); }',
            '#' + MODAL_ID + ' .cs-btn-danger { background: rgba(230,90,90,0.12); color: #d05656; }',
            '#' + MODAL_ID + ' .cs-test-result { padding: 10px 12px; border-radius: 10px; font-size: 13px; margin-bottom: 12px; display: none; white-space: pre-line; line-height: 1.5; }',
            '#' + MODAL_ID + ' .cs-test-result.ok { display: block; background: rgba(60,180,120,0.10); color: #2ba46e; }',
            '#' + MODAL_ID + ' .cs-test-result.err { display: block; background: rgba(230,90,90,0.10); color: #d05656; }',
            '#' + MODAL_ID + ' .cs-test-result.loading { display: block; background: rgba(120,120,120,0.08); color: #666; }',

            '#' + HELP_MODAL_ID + ' .cs-help-body { padding: 8px 20px 20px; font-size: 13px; line-height: 1.7; color: var(--text-color, #333); }',
            '#' + HELP_MODAL_ID + ' .cs-help-body h4 { margin: 14px 0 6px; font-size: 14px; }',
            '#' + HELP_MODAL_ID + ' .cs-help-body ol { padding-left: 22px; margin: 6px 0; }',
            '#' + HELP_MODAL_ID + ' .cs-help-body a { color: var(--accent-color, #c5a47e); }'
        ].join('\n');
        document.head.appendChild(s);
    }

    // ==== 在数据管理页插入云端同步板块 ====
    function insertCloudSection() {
        var dataModal = document.getElementById('data-modal');
        if (!dataModal) return false;
        var body = dataModal.querySelector('.dm-body');
        if (!body) return false;
        if (document.getElementById(SECTION_ID)) return true; // 已插入

        var backupLabel = null;
        var labels = body.querySelectorAll('.dm-section-label');
        for (var i = 0; i < labels.length; i++) {
            if (/备份与恢复/.test(labels[i].textContent)) {
                backupLabel = labels[i];
                break;
            }
        }

        var section = document.createElement('div');
        section.id = SECTION_ID;
        section.innerHTML =
            '<div class="dm-section-label" style="margin-top:16px;"><i class="fas fa-cloud"></i> 云端同步</div>' +
            '<div class="cs-tile" id="' + TILE_ID + '">' +
                '<div class="cs-icon"><i class="fas fa-cloud"></i></div>' +
                '<div class="cs-info">' +
                    '<div class="cs-title">阿里云 OSS</div>' +
                    '<div class="cs-desc" id="' + TILE_ID + '-desc">未连接，点击设置密钥</div>' +
                '</div>' +
                '<div class="cs-status-badge cs-status-disconnected" id="' + STATUS_ID + '">未连接</div>' +
            '</div>';

        // 插入位置：备份与恢复标签之前
        if (backupLabel) {
            body.insertBefore(section, backupLabel);
        } else {
            body.insertBefore(section, body.firstChild);
        }

        var tile = document.getElementById(TILE_ID);
        if (tile) tile.addEventListener('click', openConfigModal);

        updateStatusBadge();
        return true;
    }

    function updateStatusBadge() {
        var badge = document.getElementById(STATUS_ID);
        var desc = document.getElementById(TILE_ID + '-desc');
        if (!badge || !desc) return;
        var connected = window.CloudSync && window.CloudSync.isConnected();
        var cfg = window.CloudSync && window.CloudSync.getConfig();
        var syncStatus = (window.CloudSyncEngine && window.CloudSyncEngine.getSyncStatus)
            ? window.CloudSyncEngine.getSyncStatus() : null;

        if (connected && cfg) {
            // 有连续同步失败告警时，用错误样式提示
            if (syncStatus && syncStatus.hasFailAlert) {
                badge.className = 'cs-status-badge cs-status-error';
                badge.textContent = '同步异常';
                desc.textContent = '云端同步连续失败，点击查看';
                return;
            }
            badge.className = 'cs-status-badge cs-status-connected';
            badge.textContent = syncStatus && syncStatus.syncing ? '同步中…' : '已连接';
            var subLine = cfg.bucket + '（' + _regionLabel(cfg.region) + '）';
            if (syncStatus && syncStatus.lastSyncAt) {
                subLine += ' · 上次同步：' + _timeAgo(syncStatus.lastSyncAt);
            }
            desc.textContent = subLine;
        } else if (cfg && cfg.bucket) {
            badge.className = 'cs-status-badge cs-status-error';
            badge.textContent = '未验证';
            desc.textContent = cfg.bucket + '（连接未验证，点击重试）';
        } else {
            badge.className = 'cs-status-badge cs-status-disconnected';
            badge.textContent = '未连接';
            desc.textContent = '未连接，点击设置密钥';
        }
    }

    function _timeAgo(date) {
        if (!(date instanceof Date)) date = new Date(date);
        var diff = Math.floor((Date.now() - date.getTime()) / 1000);
        if (diff < 10) return '刚刚';
        if (diff < 60) return diff + ' 秒前';
        if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
        if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
        return Math.floor(diff / 86400) + ' 天前';
    }

    function _regionLabel(id) {
        var regs = (window.CloudSync && window.CloudSync.getRegions()) || [];
        for (var i = 0; i < regs.length; i++) {
            if (regs[i].id === id) return regs[i].label;
        }
        return id || '';
    }

    // ==== 配置弹窗 ====
    function ensureConfigModal() {
        var m = document.getElementById(MODAL_ID);
        if (m) return m;
        m = document.createElement('div');
        m.id = MODAL_ID;
        m.style.cssText = 'display:none;position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.45);align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
        m.innerHTML =
            '<div class="modal-content" style="max-width:460px;width:100%;max-height:90vh;display:flex;flex-direction:column;background:var(--secondary-bg,#fff);border-radius:16px;overflow:hidden;opacity:1;transform:none;">' +
                '<div class="modal-title" style="flex-shrink:0;padding:16px 20px;">' +
                    '<i class="fas fa-cloud"></i><span>云端同步设置</span>' +
                '</div>' +
                    '<div class="cs-form" style="flex:1;overflow-y:auto;">' +
                    '<span class="cs-help-link" id="cs-open-help"><i class="fas fa-circle-question"></i> 如何申请阿里云密钥？</span>' +
                    '<div class="cs-test-result" id="cs-test-result"></div>' +
                    '<div class="cs-field">' +
                        '<label class="cs-label">Bucket 名称</label>' +
                        '<input class="cs-input" id="cs-bucket" type="text" placeholder="例如 mengjiao-storage" autocomplete="off" />' +
                    '</div>' +
                    '<div class="cs-field">' +
                        '<label class="cs-label">地区</label>' +
                        '<select class="cs-select" id="cs-region"></select>' +
                        '<div class="cs-hint">与创建 Bucket 时选择的地区保持一致</div>' +
                    '</div>' +
                    '<div class="cs-field">' +
                        '<label class="cs-label">AccessKey ID</label>' +
                        '<input class="cs-input" id="cs-ak-id" type="text" autocomplete="off" />' +
                    '</div>' +
                    '<div class="cs-field">' +
                        '<label class="cs-label">AccessKey Secret</label>' +
                        '<input class="cs-input" id="cs-ak-secret" type="password" autocomplete="off" />' +
                        '<div class="cs-hint">密钥仅保存在你的浏览器本地，不会上传到任何服务器（除了阿里云本身）。</div>' +
                    '</div>' +
                    '<button class="cs-btn cs-btn-danger" id="cs-disconnect" style="display:none;width:100%;margin-top:6px;">断开连接</button>' +
                    '<button class="cs-btn cs-btn-secondary" id="cs-restore" style="display:none;width:100%;margin-top:8px;">从云端恢复梦角到本浏览器</button>' +
                    '<button class="cs-btn cs-btn-secondary" id="cs-migrate" style="display:none;width:100%;margin-top:8px;">迁移本地图片到云端（省空间）</button>' +
                '</div>' +
                '<div class="cs-actions">' +
                    '<button class="cs-btn cs-btn-secondary" id="cs-cancel">取消</button>' +
                    '<button class="cs-btn cs-btn-secondary" id="cs-test">测试连接</button>' +
                    '<button class="cs-btn cs-btn-primary" id="cs-save">保存并连接</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(m);

        // 填充地区下拉
        var regionSel = m.querySelector('#cs-region');
        var regions = (window.CloudSync && window.CloudSync.getRegions()) || [];
        regionSel.innerHTML = regions.map(function (r) {
            return '<option value="' + r.id + '">' + r.label + '</option>';
        }).join('');

        // 绑定事件
        m.querySelector('#cs-cancel').addEventListener('click', closeConfigModal);
        m.querySelector('#cs-test').addEventListener('click', onTestConnection);
        m.querySelector('#cs-save').addEventListener('click', onSaveAndConnect);
        m.querySelector('#cs-disconnect').addEventListener('click', onDisconnect);
        m.querySelector('#cs-restore').addEventListener('click', onManualRestore);
        m.querySelector('#cs-migrate').addEventListener('click', onMigrate);
        m.querySelector('#cs-open-help').addEventListener('click', openHelpModal);

        // 点击背景关闭
        m.addEventListener('click', function (e) {
            if (e.target === m) closeConfigModal();
        });

        return m;
    }

    // 表单临时草稿（弹窗关闭后仍保留，直到成功保存或用户明确清除）
    var _formDraft = null;

    function openConfigModal() {
        injectStyles();
        var m = ensureConfigModal();
        var cfg = (window.CloudSync && window.CloudSync.getConfig()) || {};
        // 优先用草稿（用户上次填了但没成功保存的），否则用已保存的配置
        var initial = _formDraft || cfg;
        m.querySelector('#cs-bucket').value    = initial.bucket || '';
        m.querySelector('#cs-region').value    = initial.region || 'oss-cn-hangzhou';
        m.querySelector('#cs-ak-id').value     = initial.accessKeyId || '';
        m.querySelector('#cs-ak-secret').value = initial.accessKeySecret || '';
        m.querySelector('#cs-test-result').className = 'cs-test-result';
        m.querySelector('#cs-test-result').textContent = '';
        m.querySelector('#cs-disconnect').style.display =
            (window.CloudSync && window.CloudSync.isConnected()) ? '' : 'none';
        m.querySelector('#cs-restore').style.display =
            (window.CloudSync && window.CloudSync.isConnected() && window.CloudSyncEngine && window.CloudSyncEngine.listCloudSessions) ? '' : 'none';
        m.querySelector('#cs-migrate').style.display =
            (window.CloudSync && window.CloudSync.isConnected() && window.CloudMediaMigration) ? '' : 'none';
        m.style.display = 'flex';
    }

    function closeConfigModal() {
        var m = document.getElementById(MODAL_ID);
        if (!m) return;
        // 关闭时把当前输入内容存到草稿，下次打开还在
        try { _formDraft = _readForm(); } catch (e) {}
        m.style.display = 'none';
    }

    function _readForm() {
        var m = document.getElementById(MODAL_ID);
        if (!m) return null;
        return {
            bucket:          (m.querySelector('#cs-bucket').value || '').trim(),
            region:          (m.querySelector('#cs-region').value || '').trim(),
            accessKeyId:     (m.querySelector('#cs-ak-id').value || '').trim(),
            accessKeySecret: (m.querySelector('#cs-ak-secret').value || '').trim()
        };
    }

    function _validateForm(cfg) {
        if (!cfg.bucket)          return 'Bucket 名称不能为空';
        if (!cfg.region)          return '请选择地区';
        if (!cfg.accessKeyId)     return 'AccessKey ID 不能为空';
        if (!cfg.accessKeySecret) return 'AccessKey Secret 不能为空';
        return null;
    }

    function _showResult(state, message) {
        var el = document.getElementById('cs-test-result');
        if (!el) return;
        el.className = 'cs-test-result ' + state; // loading | ok | err
        el.textContent = message;
    }

    async function onTestConnection() {
        var cfg = _readForm();
        var err = _validateForm(cfg);
        if (err) { _showResult('err', err); return; }
        _showResult('loading', '正在测试连接…');
        var btn = document.querySelector('#' + MODAL_ID + ' #cs-test');
        if (btn) btn.disabled = true;
        try {
            var result = await window.CloudSync.testConnection(cfg);
            if (result.ok) {
                _showResult('ok', '✓ 连接成功，密钥可用');
            } else {
                _showResult('err', '✗ ' + (result.message || '连接失败'));
            }
        } catch (e) {
            _showResult('err', '✗ 连接失败：' + (e && e.message || e));
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function onSaveAndConnect() {
        var cfg = _readForm();
        var err = _validateForm(cfg);
        if (err) { _showResult('err', err); return; }
        _showResult('loading', '正在验证并保存…');
        var saveBtn = document.querySelector('#' + MODAL_ID + ' #cs-save');
        if (saveBtn) saveBtn.disabled = true;
        try {
            var result = await window.CloudSync.testConnection(cfg);
            if (!result.ok) {
                // 测试失败也让用户可以强制保存（可能是权限刚授权还没生效等临时情况）
                var msg = result.message || '连接失败';
                var forceSave = confirm(
                    '连接测试失败：\n\n' + msg + '\n\n' +
                    '这可能是权限刚授权还没生效、或者暂时的网络问题。\n' +
                    '是否仍然保存密钥？（保存后可稍后重试连接）'
                );
                if (!forceSave) {
                    _showResult('err', '✗ ' + msg);
                    return;
                }
                // 用户选择强制保存：不设 connectedAt，标记为"未验证"
                cfg.connectedAt = null;
                cfg.savedAt = new Date().toISOString();
                await window.CloudSync.saveConfig(cfg);
                _formDraft = null;
                _showResult('err', '⚠ 密钥已保存，但连接未验证。稍后请重新测试。');
                updateStatusBadge();
                return;
            }
            cfg.connectedAt = new Date().toISOString();
            await window.CloudSync.saveConfig(cfg);
            _formDraft = null; // 保存成功，清掉草稿
            _showResult('ok', '✓ 已连接并保存');
            updateStatusBadge();
            if (typeof showNotification === 'function') {
                showNotification('云端同步已连接', 'success', 2500);
            }
            setTimeout(closeConfigModal, 700);
        } catch (e) {
            _showResult('err', '✗ 保存失败：' + (e && e.message || e));
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    async function onDisconnect() {
        if (!confirm('断开连接后，本地数据不会丢失，云端已同步的数据也仍在阿里云上。\n\n确定要断开吗？')) return;
        try {
            await window.CloudSync.clearConfig();
            updateStatusBadge();
            if (typeof showNotification === 'function') {
                showNotification('已断开云端连接', 'info', 2500);
            }
            closeConfigModal();
        } catch (e) {
            _showResult('err', '断开失败：' + (e && e.message || e));
        }
    }

    async function onMigrate() {
        if (!window.CloudMediaMigration) {
            _showResult('err', '迁移模块未就绪，请刷新页面后重试');
            return;
        }
        if (window.CloudMediaMigration.getStatus().running) {
            _showResult('err', '迁移正在进行中');
            return;
        }

        if (!confirm('将扫描本地所有 base64 图片并上传到云端，之后本地只保留缩略图，可节省大量空间。\n\n迁移过程中请不要关闭页面。\n\n继续吗？')) return;

        closeConfigModal();

        // 创建进度弹窗
        var overlay = document.createElement('div');
        overlay.id = 'cs-migrate-progress';
        overlay.style.cssText = 'display:flex;position:fixed;inset:0;z-index:10003;background:rgba(0,0,0,0.55);align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
        overlay.innerHTML =
            '<div style="max-width:420px;width:100%;background:var(--secondary-bg,#fff);border-radius:16px;padding:24px;">' +
                '<div style="font-size:16px;font-weight:600;color:var(--text-color,#333);margin-bottom:16px;">' +
                    '<i class="fas fa-cloud-upload-alt"></i>&nbsp;正在迁移本地图片到云端' +
                '</div>' +
                '<div id="cs-mig-task" style="font-size:13px;color:var(--text-secondary,#888);margin-bottom:12px;min-height:36px;white-space:pre-line;line-height:1.6;"></div>' +
                '<div style="height:8px;background:var(--input-bg,#f0f0f0);border-radius:4px;overflow:hidden;margin-bottom:12px;">' +
                    '<div id="cs-mig-bar" style="height:100%;width:0%;background:var(--accent-color,#c5a47e);transition:width .2s ease;"></div>' +
                '</div>' +
                '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary,#888);">' +
                    '<span id="cs-mig-count">0 / 0</span>' +
                    '<span id="cs-mig-stats">成功 0 · 失败 0</span>' +
                '</div>' +
                '<button id="cs-mig-close" class="cs-btn cs-btn-primary" style="display:none;width:100%;margin-top:16px;padding:11px;border-radius:10px;border:none;font-size:14px;background:var(--accent-color,#c5a47e);color:#fff;cursor:pointer;">完成</button>' +
            '</div>';
        document.body.appendChild(overlay);

        var taskEl = overlay.querySelector('#cs-mig-task');
        var barEl = overlay.querySelector('#cs-mig-bar');
        var countEl = overlay.querySelector('#cs-mig-count');
        var statsEl = overlay.querySelector('#cs-mig-stats');
        var closeBtn = overlay.querySelector('#cs-mig-close');
        closeBtn.addEventListener('click', function () { overlay.remove(); });

        window.CloudMediaMigration.onStatusChange(function (s) {
            if (!document.body.contains(overlay)) return;
            taskEl.textContent = s.currentTask || '';
            var pct = s.total > 0 ? Math.round(s.progress / s.total * 100) : 0;
            barEl.style.width = pct + '%';
            countEl.textContent = s.progress + ' / ' + s.total;
            statsEl.textContent = '成功 ' + s.completed + ' · 失败 ' + s.failed;
        });

        try {
            var result = await window.CloudMediaMigration.run();

            // ==== 迁移完毕后立刻强制同步到云端 ====
            // 原因：迁移把 base64 替换成 oss:// 写回 localforage，但云端同步是 3 秒防抖，
            // 如果用户马上切换到另一个浏览器恢复，云端还是旧快照（表情库可能是空的）。
            // 强制立即同步确保云端在用户看到完成弹窗时已经是最新状态。
            // 迁移完后先触发陪伴日记的 key 迁移（懒加载，如果用户没打开过日记，
            // key 还在旧位置，同步快照会丢失日记数据）
            if (typeof window.reloadCompanionDiary === 'function') {
                try { await window.reloadCompanionDiary(); } catch (e) {}
            }

            if (window.CloudSyncEngine && window.CloudSyncEngine.requestSyncNow) {
                taskEl.textContent = '↑ 正在同步到云端，请勿关闭页面…';
                barEl.style.width = '100%';

                await new Promise(function (resolve) {
                    var done = false;
                    function settle() {
                        if (!done) { done = true; resolve(); }
                    }
                    // 超时兜底：文字同步通常 1-3 秒，给 10 秒余量
                    var timeout = setTimeout(settle, 10000);

                    // 触发立即同步
                    window.CloudSyncEngine.requestSyncNow();

                    // 监听同步状态变化：syncing true→false 即完成
                    var sawSyncing = !!(window.CloudSyncEngine.getSyncStatus().syncing);
                    window.CloudSyncEngine.onSyncStatusChange(function (st) {
                        if (done) return;
                        if (st.syncing) {
                            sawSyncing = true;
                            return;
                        }
                        // syncing 变 false：如果之前确认已开始同步，则认为完成
                        if (sawSyncing) {
                            clearTimeout(timeout);
                            settle();
                        }
                    });

                    // 如果触发时同步已经跑完了（非常快），等 1.5 秒再 resolve
                    if (!sawSyncing) {
                        setTimeout(function () {
                            if (!done && !window.CloudSyncEngine.getSyncStatus().syncing) {
                                clearTimeout(timeout);
                                settle();
                            }
                        }, 1500);
                    }
                });
            }

            // 显示最终结果
            var failNote = result.failed > 0
                ? '\n⚠️ ' + result.failed + ' 项失败，可能是网络问题，可再次运行迁移重试。'
                : '';
            taskEl.textContent = '✓ 完成：共 ' + result.total + ' 项，成功 ' + result.migrated + '，失败 ' + result.failed + failNote;
            closeBtn.style.display = '';
            if (typeof showNotification === 'function') {
                showNotification(
                    result.failed > 0 ? '迁移完成（有失败项，可重试）' : '图片迁移完成',
                    'success',
                    3000
                );
            }
        } catch (e) {
            taskEl.textContent = '✗ 迁移失败：' + (e && e.message || e);
            closeBtn.style.display = '';
            closeBtn.textContent = '关闭';
        }
    }

    async function onManualRestore() {
        if (!window.CloudSyncEngine || !window.CloudSyncEngine.listCloudSessions) {
            _showResult('err', '同步引擎未就绪，请刷新页面后重试');
            return;
        }
        _showResult('loading', '正在读取云端梦角列表…');
        var btn = document.querySelector('#' + MODAL_ID + ' #cs-restore');
        if (btn) btn.disabled = true;
        try {
            var list = await window.CloudSyncEngine.listCloudSessions();
            if (!list || list.length === 0) {
                _showResult('err', '云端没有可恢复的梦角');
                return;
            }
            _showResult('', '');
            closeConfigModal();
            showRestorePicker(list, { autoTriggered: false });
        } catch (e) {
            _showResult('err', '✗ ' + (e && e.message || e));
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ==== 梦角选择弹窗 ====
    function showRestorePicker(list, opts) {
        opts = opts || {};
        injectStyles();
        var existing = document.getElementById('cs-restore-picker');
        if (existing) existing.remove();

        var m = document.createElement('div');
        m.id = 'cs-restore-picker';
        m.style.cssText = 'display:flex;position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,0.55);align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';

        var itemsHtml = list.map(function (s, idx) {
            var name = s.name || '未命名梦角';
            var timeStr = s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString('zh-CN') : '未知';
            return '<div class="cs-session-item" data-idx="' + idx + '" style="' +
                'padding:14px 16px;border:1px solid var(--border-color,#e6e6e6);border-radius:12px;' +
                'margin-bottom:10px;cursor:pointer;background:var(--input-bg,#fafafa);' +
                'transition:transform .12s ease, border-color .12s ease;">' +
                '<div style="font-size:15px;font-weight:600;color:var(--text-color,#333);margin-bottom:4px;">' + _escape(name) + '</div>' +
                '<div style="font-size:12px;color:var(--text-secondary,#888);">上次同步：' + timeStr + '</div>' +
            '</div>';
        }).join('');

        var titleText = opts.autoTriggered
            ? '选择要在本浏览器使用的梦角'
            : '从云端恢复梦角';
        var descText = opts.autoTriggered
            ? '云端有以下梦角，请选择一个恢复到本浏览器：'
            : '⚠️ 选中后，本浏览器当前的所有数据将被替换，不可撤销。';

        m.innerHTML =
            '<div style="max-width:460px;width:100%;max-height:82vh;display:flex;flex-direction:column;' +
                'background:var(--secondary-bg,#fff);border-radius:16px;overflow:hidden;opacity:1;transform:none;">' +
                '<div style="padding:16px 20px;font-size:16px;font-weight:600;color:var(--text-color,#333);flex-shrink:0;">' +
                    '<i class="fas fa-cloud-download-alt"></i>&nbsp;' + titleText +
                '</div>' +
                '<div style="padding:0 20px 8px;font-size:12px;color:var(--text-secondary,#888);flex-shrink:0;">' + descText + '</div>' +
                '<div style="flex:1;overflow-y:auto;padding:8px 20px 4px;" id="cs-session-list">' + itemsHtml + '</div>' +
                '<div style="padding:12px 20px;border-top:1px solid var(--border-color,#eee);background:var(--secondary-bg,#fafafa);display:flex;gap:10px;flex-shrink:0;">' +
                    '<button class="cs-btn cs-btn-secondary" id="cs-picker-cancel" style="flex:1;padding:11px;border-radius:10px;border:none;font-size:14px;background:var(--input-bg,#f0f0f0);color:var(--text-color,#333);cursor:pointer;">取消</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(m);

        function _closePicker() {
            m.remove();
            // 如果是自动弹出的（本地空+云端有），用户取消 → 通知引擎解除等待锁
            if (opts.autoTriggered && window.CloudSyncEngine && window.CloudSyncEngine.cancelRestorePrompt) {
                window.CloudSyncEngine.cancelRestorePrompt();
            }
        }

        m.addEventListener('click', function (e) {
            if (e.target === m) _closePicker();
        });
        m.querySelector('#cs-picker-cancel').addEventListener('click', _closePicker);

        var items = m.querySelectorAll('.cs-session-item');
        for (var i = 0; i < items.length; i++) {
            (function (item) {
                item.addEventListener('click', async function () {
                    var idx = parseInt(item.getAttribute('data-idx'), 10);
                    var s = list[idx];
                    var name = s.name || '未命名梦角';

                    // 特别提示：如果选中的就是当前梦角
                    var isCurrent = (typeof SESSION_ID !== 'undefined') && (s.sessionId === SESSION_ID);
                    var confirmMsg;
                    if (isCurrent) {
                        confirmMsg = '你选择的是当前正在使用的梦角「' + name + '」。\n\n' +
                                     '恢复操作会用云端数据覆盖本地。如果本地有云端还没同步的最新改动，会丢失。\n\n' +
                                     '是否继续？';
                    } else {
                        confirmMsg = '将本浏览器切换为「' + name + '」，当前所有数据会被替换，不可撤销。\n\n确定继续？';
                    }
                    if (!confirm(confirmMsg)) return;

                    item.style.opacity = '0.5';
                    item.textContent = '正在恢复…';
                    try {
                        var result = await window.CloudSyncEngine.restoreSession(s.sessionId);
                        alert('已恢复「' + name + '」，共 ' + result.count + ' 项数据。\n\n即将刷新页面以生效。');
                        m.remove();
                        // 最后一刻再清一次紧急备份（防止 alert 期间 app 重写）
                        try {
                            localStorage.removeItem('BACKUP_V1_critical');
                            localStorage.removeItem('BACKUP_V1_timestamp');
                        } catch (e) {}
                        location.reload();
                    } catch (e) {
                        alert('恢复失败：' + (e && e.message || e));
                        item.style.opacity = '1';
                    }
                });
            })(items[i]);
        }
    }

    function _escape(s) {
        return String(s || '').replace(/[&<>"']/g, function (c) {
            return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c];
        });
    }

    // 暴露给引擎调用（启动自动检测触发时用）
    window.__cloudSyncShowRestorePicker = showRestorePicker;

    // ==== 帮助弹窗 ====
    function ensureHelpModal() {
        var m = document.getElementById(HELP_MODAL_ID);
        if (m) return m;
        m = document.createElement('div');
        m.id = HELP_MODAL_ID;
        m.style.cssText = 'display:none;position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.45);align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
        m.innerHTML =
            '<div class="modal-content" style="max-width:480px;width:100%;max-height:88vh;display:flex;flex-direction:column;background:var(--secondary-bg,#fff);border-radius:16px;overflow:hidden;opacity:1;transform:none;">' +
                '<div class="modal-title" style="flex-shrink:0;padding:16px 20px;">' +
                    '<i class="fas fa-circle-question"></i><span>如何申请阿里云 OSS 密钥</span>' +
                '</div>' +
                '<div class="cs-help-body" style="flex:1;overflow-y:auto;">' +
                    '<h4>1. 开通对象存储 OSS</h4>' +
                    '<ol>' +
                        '<li>打开 <a href="https://www.aliyun.com" target="_blank" rel="noopener">aliyun.com</a>，用手机号登录并完成实名认证</li>' +
                        '<li>搜索「对象存储 OSS」并开通（免费开通，只按实际用量收费）</li>' +
                    '</ol>' +
                    '<h4>2. 创建 Bucket</h4>' +
                    '<ol>' +
                        '<li>进入 OSS 控制台 → Bucket 列表 → 创建 Bucket</li>' +
                        '<li>名称：随便起，例如 <code>mengjiao-storage</code></li>' +
                        '<li>地区：选离你近的（例如「华东1-杭州」），记住这个地区</li>' +
                        '<li>读写权限：<b>私有</b></li>' +
                    '</ol>' +
                    '<h4>3. 配置跨域（CORS）</h4>' +
                    '<ol>' +
                        '<li>进入刚创建的 Bucket → 权限管理 → 跨域设置 → 创建规则</li>' +
                        '<li>来源：<code>*</code>（或填你的域名，如 <code>https://ivyo1214.github.io</code>）</li>' +
                        '<li>允许 Methods：勾选 <b>GET、PUT、POST、DELETE、HEAD</b></li>' +
                        '<li>允许 Headers：<code>*</code></li>' +
                        '<li>暴露 Headers：<code>ETag</code></li>' +
                    '</ol>' +
                    '<h4>4. 创建 AccessKey</h4>' +
                    '<ol>' +
                        '<li>右上角头像 → AccessKey 管理</li>' +
                        '<li>推荐创建「RAM 用户」而不是主账号 AccessKey（更安全）</li>' +
                        '<li>给该 RAM 用户授权：<code>AliyunOSSFullAccess</code>（或只对刚创建的 Bucket 授权）</li>' +
                        '<li>获取 AccessKey ID 与 Secret，<b>Secret 只显示一次，请妥善保存</b></li>' +
                    '</ol>' +
                    '<h4>5. 回到本页填写</h4>' +
                    '<ol>' +
                        '<li>Bucket 名称：第 2 步起的名字</li>' +
                        '<li>地区：第 2 步选的地区</li>' +
                        '<li>AccessKey ID / Secret：第 4 步生成的</li>' +
                        '<li>点「测试连接」，绿色即为成功</li>' +
                    '</ol>' +
                '</div>' +
                '<div class="modal-buttons" style="padding:12px 20px;border-top:1px solid var(--border-color,#eee);flex-shrink:0;text-align:right;">' +
                    '<button class="modal-btn modal-btn-primary" id="cs-help-close">我知道了</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(m);
        m.querySelector('#cs-help-close').addEventListener('click', function () { m.style.display = 'none'; });
        m.addEventListener('click', function (e) { if (e.target === m) m.style.display = 'none'; });
        return m;
    }

    function openHelpModal() {
        var m = ensureHelpModal();
        m.style.display = 'flex';
    }

    // ==== 与数据管理页的挂接 ====
    // 数据管理弹窗每次打开时（点击设置里的入口）会触发 rebuild；用 MutationObserver 监听插入时机
    // 静默重测（用于面板打开时，如果处于"已保存但未验证"状态，后台尝试再连一次）
    // 为避免刷屏，本次会话只尝试一次
    var _silentRetestDone = false;
    async function _silentRetest() {
        if (_silentRetestDone) return;
        if (!window.CloudSync) return;
        var cfg = window.CloudSync.getConfig();
        if (!cfg || !cfg.bucket) return;
        if (window.CloudSync.isConnected()) return; // 已连接，不用重测
        _silentRetestDone = true;
        try {
            var result = await window.CloudSync.testConnection(cfg);
            if (result.ok) {
                cfg.connectedAt = new Date().toISOString();
                await window.CloudSync.saveConfig(cfg);
                updateStatusBadge();
                if (typeof showNotification === 'function') {
                    showNotification('云端连接已恢复', 'success', 2000);
                }
            }
        } catch (e) {
            // 静默失败
        }
    }

    function watchDataModal() {
        var dataModal = document.getElementById('data-modal');
        if (!dataModal) {
            setTimeout(watchDataModal, 500);
            return;
        }
        // data.js 用 setTimeout(init,0) 注册它自己的 observer，所以我们的 observer 会先触发。
        // 延迟 120ms，等 data.js 的 ensureHTML/writeHTML 执行完毕再插入，否则会被覆盖。
        var observer = new MutationObserver(function () {
            var d = dataModal.style.display;
            if (d === 'flex' || d === 'block') {
                setTimeout(function () {
                    injectStyles();
                    insertCloudSection();
                    updateStatusBadge();
                    _silentRetest();
                }, 120);
            }
        });
        observer.observe(dataModal, { attributes: true, attributeFilter: ['style'] });
    }

    // ==== 启动 ====
    function boot() {
        if (typeof window.CloudSync === 'undefined') {
            // cloud-sync.js 尚未加载完成，延迟启动
            setTimeout(boot, 200);
            return;
        }
        window.CloudSync.onStatusChange(function () { updateStatusBadge(); });

        // 同步引擎的状态变化（同步中 / 完成 / 失败）也刷新 UI
        function _hookEngine() {
            if (window.CloudSyncEngine && window.CloudSyncEngine.onSyncStatusChange) {
                window.CloudSyncEngine.onSyncStatusChange(function () { updateStatusBadge(); });
            } else {
                setTimeout(_hookEngine, 300);
            }
        }
        _hookEngine();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', watchDataModal);
        } else {
            watchDataModal();
        }
    }

    boot();
})();
