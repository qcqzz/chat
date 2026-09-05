/**
 * partner-manager.js — 对象管理：切换对象 / 新建对象 / 删除对象
 *
 * 复用项目既有的多会话机制：
 *   - sessionList  → 对象清单（global key: CHAT_APP_V3_sessionList）
 *   - SESSION_ID   → 当前对象指针（存储层 getStorageKey 已按 SESSION_ID 命名空间隔离）
 *   - location.hash + reload → 切换对象后整机重载，重新初始化到目标对象的世界
 *
 * 非破坏性铁律：
 *   - 切换 = 只改指针(lastSessionId)与 location.hash，不清不删任何已落盘数据；
 *   - 删除 = 软删除（仅从清单移除，数据桶完整保留，可随时再找回）。
 */
(function () {
    'use strict';

    var P = (typeof APP_PREFIX !== 'undefined' ? APP_PREFIX : 'CHAT_APP_V3_');

    function currentPartner() {
        // settings 是 state.js 里顶层 `let`，全局可通过裸标识符访问，但不会挂到 window 上
        // （window.settings 恒为 undefined）。必须用裸 settings，否则取不到当前对象名字/状态。
        return (typeof settings !== 'undefined' && settings) ? settings : {};
    }

    function firstLetter(nm) {
        var s = String(nm == null ? '' : nm).trim();
        return s ? s.charAt(0) : '？';
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function makeNewId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
    }

    async function loadSessionList() {
        try {
            var stored = await localforage.getItem(P + 'sessionList');
            return Array.isArray(stored) ? stored : [];
        } catch (e) {
            return [];
        }
    }

    window.openPartnerManager = function () {
        var m = document.getElementById('partner-manager-modal');
        if (!m) return;
        renderPartnerManager(m);
        if (typeof showModal === 'function') showModal(m);
        else m.style.display = 'flex';
    };

    async function renderPartnerManager(m) {
        var current = currentPartner();
        var cName = current.partnerName || '梦角';
        var cStatus = current.partnerStatus || '在线';

        var curEl = document.getElementById('partner-manager-current');
        if (curEl) {
            curEl.innerHTML =
                '<div class="pm-avatar">' + esc(firstLetter(cName)) + '</div>' +
                '<div class="pm-cur-info">' +
                '<div class="pm-cur-name">' + esc(cName) + '</div>' +
                '<div class="pm-cur-status"><span class="pm-online-dot"></span>' + esc(cStatus) + '</div>' +
                '</div>';
        }

        var listEl = document.getElementById('partner-manager-list');
        if (!listEl) return;

        var list = await loadSessionList();
        listEl.innerHTML = '';
        if (!list.length) {
            listEl.innerHTML = '<div class="pm-empty">暂无可切换对象，请先新建</div>';
            return;
        }

        list.forEach(function (sess) {
            if (!sess || !sess.id) return;
            var isCur = (typeof SESSION_ID !== 'undefined' && sess.id === SESSION_ID);
            var fallbackNm = (sess && sess.name) ? sess.name : '未命名对象';

            // 异步读取每个对象的展示信息。
            // 关键：某个对象 chatSettings 读取失败/出错时，绝不能让它在列表里"消失"——
            // 此前 .catch(()=>{}) 会静默跳过该项，导致该对象从清单里看不到（数据其实还在）。
            // 这里无论成功失败都用兜底信息把该对象项渲染出来，保证清单与 sessionList 一致。
            Promise.resolve(localforage.getItem(P + sess.id + '_chatSettings')).then(
                function (cs) { buildItem(cs); },
                function () { buildItem(null); }
            );

            function buildItem(cs) {
                cs = (cs && typeof cs === 'object') ? cs : null;
                var nm = (cs && cs.partnerName) ? cs.partnerName : fallbackNm;
                var st = (cs && cs.partnerStatus) ? cs.partnerStatus : '未知';
                var bg = (cs && cs.partnerColor) ? cs.partnerColor : ('linear-gradient(135deg,' + avatarGradient(sess.id) + ')');

                var item = document.createElement('div');
                item.className = 'pm-item' + (isCur ? ' pm-item-cur' : '');
                item.innerHTML =
                    '<div class="pm-avatar" style="background:' + bg + '">' + esc(firstLetter(nm)) + '</div>' +
                    '<div class="pm-item-info">' +
                    '<div class="pm-item-name">' + esc(nm) + '</div>' +
                    '<div class="pm-item-hint">' + (isCur ? '当前对象' : st) + '</div>' +
                    '</div>' +
                    (isCur
                        ? '<div class="pm-tag">使用中</div>'
                        : '<button class="pm-switch-btn">切换</button>') +
                    '<button class="pm-del-btn" title="删除该对象（软删除，数据保留）"><i class="fas fa-trash"></i></button>';

                listEl.appendChild(item);

                var sw = item.querySelector('.pm-switch-btn');
                if (sw) sw.addEventListener('click', function () { switchPartner(sess.id); });

                var del = item.querySelector('.pm-del-btn');
                if (del) del.addEventListener('click', function (e) {
                    e.stopPropagation();
                    deletePartner(sess.id);
                });
            }
        });
    }

    // 为每个对象生成各自的头像主题色（同名字也能区分）
    function avatarGradient(seed) {
        var h = 0;
        for (var i = 0; i < String(seed).length; i++) h = (h * 31 + String(seed).charCodeAt(i)) % 360;
        return (h + 30) + 'deg, hsl(' + h + ',62%,62%), hsl(' + ((h + 50) % 360) + ',58%,48%)';
    }

    // 切换对象：非目标对象数据不动，只改指针 + hash → reload 重载到新世界
    window.switchPartner = async function (id) {
        try { await localforage.setItem(P + 'lastSessionId', id); } catch (e) {}
        window.location.hash = id;
        window.location.reload();
    };

    // 新建对象：预建完整人设(继承当前设置 + 自定义名字/配色) → 写入清单 → 切换重载
    window.createPartner = async function (name, color) {
        var nm = String(name || '').trim();
        if (!nm) nm = '新的梦角';

        var list = (await loadSessionList()).filter(function (s) { return s && s.id; });
        var newId = makeNewId();
        var sess = { id: newId, name: nm, createdAt: Date.now() };
        // 防重复：极端情况下同 id 已存在则不再次追加，避免清单出现重复对象
        if (!list.some(function (s) { return s.id === newId; })) list.push(sess);

        var seed = Object.assign({}, currentPartner(), { partnerName: nm, partnerStatus: '在线' });
        // 头像/外观字段不随人设克隆，避免新对象沿用原对象的头像、配色与样式。
        // partnerColor 未显式传色时置空，各对象头像由渲染层按 SESSION_ID 派生独立渐变。
        ['partnerAvatar', 'myAvatar',
         'partnerAvatarFrame', 'myAvatarFrame',
         'partnerAvatarShape', 'myAvatarShape',
         'partnerColor'].forEach(function (k) { delete seed[k]; });
        if (color) seed.partnerColor = color;
        try {
            await localforage.setItem(P + 'sessionList', list);
            await localforage.setItem(P + newId + '_chatSettings', seed);
            await localforage.setItem(P + 'lastSessionId', newId);
            // 同步内存中的全局 sessionList：新增对象用的是独立读取的数组写入存储，
            // 若不回写全局变量，reload 前其它模块（如会话切换器）会读到缺了新增对象的旧清单，
            // 造成"新建后其它对象/清单不一致"。写入后立即让内存与存储保持一致。
            try {
                if (typeof sessionList !== 'undefined') {
                    sessionList.length = 0;
                    for (var _i = 0; _i < list.length; _i++) sessionList.push(list[_i]);
                }
            } catch (e) {}
        } catch (e) {
            console.error('[partner-manager] 新建对象失败', e);
            if (typeof showNotification === 'function') showNotification('新建对象失败', 'error');
            return;
        }
        window.location.hash = newId;
        window.location.reload();
    };

    // 删除对象：软删除（仅从清单移除，数据桶保留）
    window.deletePartner = async function (id) {
        var list = await loadSessionList();
        if (list.length <= 1) {
            if (typeof showNotification === 'function') showNotification('至少保留一个对象', 'error');
            return;
        }
        if (!window.confirm('确定删除该对象吗？\n此操作仅从列表移除（软删除），该对象的所有数据会完整保留，可随时再找回。')) return;

        list = list.filter(function (s) { return s.id !== id; });
        try {
            await localforage.setItem(P + 'sessionList', list);
            var isCur = (typeof SESSION_ID !== 'undefined' && id === SESSION_ID);
            if (isCur && list.length) {
                await localforage.setItem(P + 'lastSessionId', list[0].id);
                window.location.hash = list[0].id;
                window.location.reload();
                return;
            }
            renderPartnerManager(document.getElementById('partner-manager-modal'));
        } catch (e) {}
    };

    // ================= 新建梦角弹窗 =================
    var NP_COLORS = [
        { label: '暖金', g: 'linear-gradient(135deg,#e7b96a,#c98a4b)' },
        { label: '蔷薇', g: 'linear-gradient(135deg,#f4a7b9,#d4637e)' },
        { label: '黛紫', g: 'linear-gradient(135deg,#b79be8,#7d5bc0)' },
        { label: '绯红', g: 'linear-gradient(135deg,#f08a7d,#d15b4a)' },
        { label: '碧蓝', g: 'linear-gradient(135deg,#6fc3ef,#3b82c4)' },
        { label: '薄荷', g: 'linear-gradient(135deg,#7fe3c0,#33b58f)' }
    ];
    var _npColor = NP_COLORS[0].g;

    function firstLetterFor(s) {
        var t = String(s || '').trim();
        return t ? t.charAt(0) : '梦';
    }

    function npRenderPreview(name, colorG) {
        var pv = document.getElementById('np-preview');
        if (!pv) return;
        if (colorG) pv.style.background = colorG;
        pv.textContent = firstLetterFor(name);
    }

    function npBuildSwatches() {
        var box = document.getElementById('np-colors');
        if (!box) return;
        box.innerHTML = '';
        NP_COLORS.forEach(function (c) {
            var sw = document.createElement('div');
            sw.className = 'np-swatch' + (c.g === _npColor ? ' sel' : '');
            sw.style.background = c.g;
            sw.title = c.label;
            sw.addEventListener('click', function () {
                _npColor = c.g;
                var sels = box.querySelectorAll('.np-swatch');
                for (var i = 0; i < sels.length; i++) sels[i].classList.remove('sel');
                sw.classList.add('sel');
                npRenderPreview(document.getElementById('np-name').value, _npColor);
            });
            box.appendChild(sw);
        });
    }

    window.openNewPartnerModal = function () {
        var m = document.getElementById('new-partner-modal');
        if (!m) return;
        var inp = document.getElementById('np-name');
        if (inp) { inp.value = ''; }
        _npColor = NP_COLORS[Math.floor(Math.random() * NP_COLORS.length)].g;
        npBuildSwatches();
        npRenderPreview('', _npColor);
        if (typeof showModal === 'function') showModal(m);
        else m.style.display = 'flex';
        if (inp) setTimeout(function () { inp.focus(); }, 150);
    };

    document.addEventListener('DOMContentLoaded', function () {
        var btn = document.getElementById('pm-new-btn');
        if (btn && !btn._bound) {
            btn._bound = true;
            btn.addEventListener('click', function () { openNewPartnerModal(); });
        }

        var nameIn = document.getElementById('np-name');
        if (nameIn && !nameIn._bound) {
            nameIn._bound = true;
            nameIn.addEventListener('input', function () { npRenderPreview(nameIn.value, _npColor); });
            nameIn.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); doCreateFromNp(); }
            });
        }

        var createBtn = document.getElementById('np-create');
        if (createBtn && !createBtn._bound) {
            createBtn._bound = true;
            createBtn.addEventListener('click', function () { doCreateFromNp(); });
        }
    });

    function doCreateFromNp() {
        var inp = document.getElementById('np-name');
        var nm = (inp && inp.value) ? String(inp.value).trim() : '';
        createPartner(nm, _npColor);
    }

    // ================= 按角色备份（仅当前对象） =================

    // 收集当前对象命名空间下的全部数据（只含 `${P}${sid}_` 前缀的键）
    async function collectPartnerKeys(sid) {
        var prefix = P + sid + '_';
        var out = {};
        var keys = await localforage.keys();
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf(prefix) !== 0) continue;
            try {
                var v = await localforage.getItem(keys[i]);
                if (v != null) out[keys[i]] = v;
            } catch (e) {}
        }
        return out;
    }

    function downloadText(filename, text) {
        var blob = new Blob([text], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { document.body.removeChild(a); try { URL.revokeObjectURL(a.href); } catch (e) {} }, 200);
    }

    window.exportPartnerBackup = async function () {
        var sid = (typeof SESSION_ID !== 'undefined' && SESSION_ID) ? SESSION_ID : 'default';
        var nm = currentPartner().partnerName || '对象';
        var safe = (nm || '对象').replace(/[\\/:*?"<>|]/g, '_').slice(0, 20);
        // 与全量备份一致的进度条弹窗
        var prog = (typeof window.showBackupProgress === 'function') ? window.showBackupProgress() : null;
        var onProgress = function (pct, label) {
            if (prog && typeof prog.update === 'function') prog.update(pct, label);
        };
        try {
            if (window.ChatBackup && window.ChatBackup.exportBackupToFile) {
                await window.ChatBackup.exportBackupToFile({
                    inclMsgs: true, inclSet: true, inclCustom: true, inclAnn: true,
                    inclThemes: true, inclDg: true, inclStickers: true, inclCS: true,
                    onlySession: sid,          // 仅当前对象命名空间
                    fileNameBase: '按角色备份_' + safe,
                    shareTitle: '传讯·按角色备份'
                }, onProgress);
                if (prog && typeof prog.done === 'function') prog.done();
                return;
            }
        } catch (e) {
            console.error('[partner-manager] 按角色 ZIP 备份失败', e);
            if (prog && typeof prog.close === 'function') prog.close();
            if (typeof showNotification === 'function') showNotification('备份失败：' + ((e && e.message) || e), 'error');
            return;
        }
        // 极端回退：旧式单字段 JSON
        if (typeof showNotification === 'function') showNotification('正在打包当前对象数据…', 'info', 1500);
        var data = await collectPartnerKeys(sid);
        var sessionList = [];
        try { var sl = await localforage.getItem(P + 'sessionList'); sessionList = Array.isArray(sl) ? sl : []; } catch (e) {}
        var payload = {
            type: 'partnerBackup',
            version: 1,
            sourcePrefix: P + sid + '_',
            partnerId: sid,
            partnerName: nm,
            createdAt: Date.now(),
            data: data,
            sessionList: sessionList
        };
        downloadText('按角色备份_' + safe + '_' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(payload));
        if (prog && typeof prog.done === 'function') prog.done();
        if (typeof showNotification === 'function') showNotification('已导出当前对象备份', 'success');
    };

    // 从备份文件导入：支持 ZIP(v5，与全量备份同格式) 与旧版单 JSON(pairtBackup)
    // ZIP 仅含当前对象命名空间，经 applyBackupToStorage 还原到当前对象；旧 JSON 源前缀→当前对象前缀重映射。
    window.importPartnerBackup = function () {
        var inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json,application/json,application/zip,application/x-zip-compressed,.zip';
        inp.style.display = 'none';
        document.body.appendChild(inp);
        inp.onchange = async function () {
            var file = inp.files && inp.files[0];
            if (!file) { inp.remove(); return; }
            // 与全量备份恢复的过程一致：先确认，再提示正在恢复
            if (typeof confirm === 'function' &&
                !confirm('导入按角色备份将覆盖当前对象的数据。\n\n导入前会自动留一份「恢复上一步」快照，可随时回滚。\n\n确定继续吗？')) {
                inp.remove(); return;
            }
            if (typeof showNotification === 'function') showNotification('正在恢复数据…', 'info', 3000);
            try {
                // ArrayBuffer 不可按下标取值（arrBuff[0] 恒为 undefined），必须先包成 Uint8Array，
                // 否则 ZIP 文件会被误判为 JSON，解成二进制后 JSON.parse 抛错 → “导入失败”。
                var arrBuff = new Uint8Array(await file.arrayBuffer());
                var isZip = arrBuff && arrBuff.byteLength >= 4 &&
                    arrBuff[0] === 0x50 && arrBuff[1] === 0x4B; // 'PK'
                var sid = (typeof SESSION_ID !== 'undefined' && SESSION_ID) ? SESSION_ID : 'default';

                if (isZip) {
                    if (!(window.ChatBackup && window.ChatBackup.loadBackupFromFile)) {
                        if (typeof showNotification === 'function') showNotification('解析 ZIP 所需组件未加载', 'error');
                        inp.remove(); return;
                    }
                    var data = await window.ChatBackup.loadBackupFromFile(file);
                    await window.ChatBackup.applyBackupToStorage(data, {});
                } else {
                    // 旧版单 JSON（partnerBackup）
                    var payload = JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(arrBuff));
                    if (!payload || payload.type !== 'partnerBackup') {
                        if (typeof showNotification === 'function') showNotification('不是有效的按角色备份文件', 'error');
                        inp.remove(); return;
                    }
                    var prefix = P + sid + '_';
                    var data2 = payload.data || {};

                    // 覆盖前快照（保险丝，可回滚）
                    if (window.ChatBackup && window.ChatBackup.makeRollbackSnapshot) {
                        try { await window.ChatBackup.makeRollbackSnapshot('按角色导入前'); } catch (e) { console.warn('[partner-manager] 快照失败', e); }
                    }

                    var count = 0;
                    for (var k in data2) {
                        var newKey = k;
                        // 源前缀 → 当前对象前缀（只换对象段，其余键名原样）
                        if (payload.sourcePrefix && newKey.indexOf(payload.sourcePrefix) === 0) {
                            newKey = prefix + newKey.slice(payload.sourcePrefix.length);
                        }
                        // 只写当前对象命名空间，绝不触碰其它对象/系统全局键
                        if (newKey.indexOf(prefix) !== 0) continue;
                        await localforage.setItem(newKey, data2[k]);
                        count++;
                    }
                }

                // 与全量备份一致的导入守卫：写盘后、reload 前禁止内存里的旧数据回写，
                // 否则 beforeunload/pagehide 会把内存旧数据覆盖回 IndexedDB 造成“导入数据丢失”。
                window._importGuarded = true;

                if (isZip) {
                    if (typeof showNotification === 'function') showNotification('已导入当前对象 ZIP 备份，即将刷新…', 'success');
                } else {
                    if (typeof showNotification === 'function') showNotification('已导入到当前对象，即将刷新…', 'success');
                }
                inp.remove();
                setTimeout(function () { window.location.reload(); }, 800);
            } catch (e) {
                console.error('[partner-manager] 导入失败', e);
                if (typeof showNotification === 'function') showNotification('导入失败', 'error');
                inp.remove();
            }
        };
        inp.click();
    };

    // 数据管理 → 按角色备份 入口：小型操作浮层（导出/导入）
    window.openPartnerBackup = function () {
        var sid = (typeof SESSION_ID !== 'undefined' && SESSION_ID) ? SESSION_ID : 'default';
        var nm = currentPartner().partnerName || '对象';

        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999991;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML =
            '<div style="width:min(440px,92vw);background:var(--secondary-bg,#fff);border-radius:18px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3);">'
            + '<div style="padding:16px 18px;font-size:16px;font-weight:800;color:var(--text-primary);border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:8px;"><i class="fas fa-user-astronaut" style="color:var(--accent-color);"></i>按角色备份 · 当前对象</div>'
            + '<div style="padding:6px 18px;font-size:12px;color:var(--text-secondary);line-height:1.7;">'
            + '当前对象：<b style="color:var(--text-primary)">' + esc(nm) + '</b><br>'
            + '仅备份/还原当前对象的世界（聊天、陪伴、娱乐、字卡、主题、桌面等），不影响其他对象。<br>'
            + '从文件导入会覆盖当前对象数据，导入前自动留一份「恢复上一步」快照，可随时回滚。'
            + '</div>'
            + '<div style="padding:12px 18px;display:flex;flex-direction:column;gap:10px;">'
            + '<button class="dm-drawer-action-btn primary" id="pb-export" style="width:100%;"><div class="dm-drawer-btn-icon"><i class="fas fa-download"></i></div><div class="dm-drawer-btn-text"><div class="dm-drawer-btn-title">导出当前对象</div><div class="dm-drawer-btn-desc">保存为 ZIP 文件（含媒体与进度）</div></div></button>'
            + '<button class="dm-drawer-action-btn" id="pb-import" style="width:100%;"><div class="dm-drawer-btn-icon"><i class="fas fa-upload"></i></div><div class="dm-drawer-btn-text"><div class="dm-drawer-btn-title">从文件导入</div><div class="dm-drawer-btn-desc">支持 ZIP / JSON，还原当前对象（可回滚）</div></div></button>'
            + '</div>'
            + '<div style="padding:10px 18px;border-top:1px solid var(--border-color);display:flex;justify-content:flex-end;"><button class="modal-btn modal-btn-secondary" id="pb-close" style="padding:8px 20px;">关闭</button></div>'
            + '</div>';
        overlay.addEventListener('click', function (ev) { if (ev.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);

        overlay.querySelector('#pb-close').addEventListener('click', function () { overlay.remove(); });
        overlay.querySelector('#pb-export').addEventListener('click', function () { window.exportPartnerBackup(); });
        overlay.querySelector('#pb-import').addEventListener('click', function () { window.importPartnerBackup(); });
    };
})();