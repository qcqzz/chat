/**
 * cloud-sync-engine.js — 阶段二：文字数据实时同步引擎
 *
 * 依赖：CloudSync（阶段一）、localforage、APP_PREFIX
 *
 * 职责：
 *   1. 收集本地所有"文字类"数据，打包成一个 JSON
 *   2. 通过阿里云 OSS V4 签名上传到 Bucket 的 sync/text-data.json
 *   3. 触发时机：本地写入后 3 秒防抖 / 页面隐藏 / 启动检测
 *   4. 静默恢复：启动时若本地空但云端有数据，弹窗询问是否恢复
 *   5. 状态：exposed via CloudSync.getSyncStatus()，UI 主动读取
 *
 * 完全后台运行，不弹 Toast、不闪图标、不打断用户。
 * 唯一会打扰用户的是：连续失败 → 数据管理面板显示不显眼红点。
 */
(function (global) {
    'use strict';

    // ==== 常量 ====
    var APP_PREFIX_STR = (typeof APP_PREFIX !== 'undefined' ? APP_PREFIX : 'CHAT_APP_V3_');

    // 云端对象命名
    function _syncObjectKey() {
        var sid = (typeof SESSION_ID !== 'undefined' && SESSION_ID) ? SESSION_ID : 'default';
        return 'sync/' + sid + '/text-data.json';
    }
    // 云端所有梦角的索引文件
    function _indexObjectKey() {
        return 'sync/index.json';
    }

    // 从 payload 中提取梦角名字（partnerName）用于展示
    function _extractPartnerName(payload) {
        try {
            if (!payload || !payload.indexedDB) return null;
            for (var k in payload.indexedDB) {
                if (k.indexOf('chatSettings') !== -1) {
                    var s = payload.indexedDB[k];
                    if (s && typeof s === 'object' && s.partnerName) return s.partnerName;
                }
            }
        } catch (e) {}
        return null;
    }

    // ==== 键名分类 ====

    // 1) 带 SESSION_ID 前缀的文字类键（媒体类不在此列，留阶段三）
    var SESSION_TEXT_NEEDLES = [
        // 聊天
        'chatMessages', 'chatSettings', 'showPartnerNameInChat',
        'envelopeData', 'pending_envelope',
        // 回复 / 氛围
        'customReplies', 'customPokes', 'customStatuses', 'customMottos',
        'customIntros', 'customEmojis',
        'customReplyGroups', 'customPokeGroups', 'customStatusGroups',
        // 纪念日
        'anniversaries',
        // 心情手账（不含图片）
        'moodCalendar', 'customMoodOptions', 'moodTrash',
        // 主题人设
        'partnerPersonas',
        // 贴纸库（文字索引，实际图片阶段三B处理）
        'stickerLibrary', 'myStickerLibrary',
        // 陪伴日记文字
        'companionData', 'companionDiary',
        // 信件
        'partnerLetterNextTime',
        // 阶段三A：背景图库（现在存的是 oss:// 引用 + 缩略图，可以同步）
        'backgroundGallery', 'chatBackground',
        // 阶段三B：日记背景（同上，云端引用后可同步；有 payload 保护过滤 base64）
        'companionDiaryBg', 'companionDiaryBgGallery',
        // 阶段四：收藏语音（值是 oss:// 引用，体积小可以同步；有 sanitize 过滤 base64）
        'favAudio_'
    ];

    // 媒体类键（大 base64，不走文字同步 payload）
    var SESSION_MEDIA_NEEDLES = [
        'partnerAvatar', 'myAvatar'
    ];

    // 2) 全局键（无 SESSION_ID 前缀）- 文字类，需要同步
    var GLOBAL_TEXT_KEYS = [
        APP_PREFIX_STR + 'sessionList',    // 梦角列表（最重要！）
        APP_PREFIX_STR + 'customThemes',   // 主题
        APP_PREFIX_STR + 'themeSchemes'    // 主题方案
    ];

    // 不同步的全局键（系统状态，不属于用户数据）
    var GLOBAL_SKIP_KEYS = [
        APP_PREFIX_STR + 'cloudSyncConfig',
        APP_PREFIX_STR + 'tour_seen',
        APP_PREFIX_STR + 'MIGRATION_V2_DONE',
        APP_PREFIX_STR + 'lastSessionId'
    ];

    // 3) localStorage 中的文字类键
    var TEXT_LS_KEYS = [
        'groupChatSettings',
        'disabledReplyItems', 'pokeSym_my', 'pokeSym_partner',
        'pokeSym_my_custom', 'pokeSym_partner_custom',
        'disabledStickerItems',
        'dg_custom_data', 'dg_status_pool', 'weekly_fortune', 'daily_fortune',
        'voiceTtsConfig'
    ];
    var TEXT_LS_PREFIXES = ['customWeather_'];

    // 同步状态（内存）
    var _state = {
        lastSyncAt: null,          // Date | null
        lastSyncOk: null,          // true | false | null
        lastError: null,           // string | null
        consecutiveFailures: 0,
        syncing: false,
        pendingTimer: null,
        pendingReason: null,       // 'change' | 'visibility' | 'manual'
        restoreOffered: false,     // 本次会话是否已经询问过恢复
        listeners: [],
        // ready 标记：只有 SESSION_ID 就绪 + 启动检测完成后才允许触发同步。
        // 避免 app 启动加载数据时被误认为"数据变化"，把 pending 表覆盖到云端。
        ready: false,
        // 本次会话是否已经弹过失败告警 toast（避免连续刷屏）
        failAlertShown: false,
        // 是否有恢复流程正在进行（暂停所有同步）
        restoreInProgress: false,
        // 是否有梦角选择器正在等待用户操作（本地是空的，未选择前不允许同步覆盖云端）
        awaitingRestoreChoice: false
    };

    // 防抖延迟（数据变化后）
    var DEBOUNCE_MS = 3000;
    // 静默失败告警阈值（连续失败几次才提示）
    var FAIL_ALERT_THRESHOLD = 3;

    // ==== 状态通知 ====
    function _notify() {
        for (var i = 0; i < _state.listeners.length; i++) {
            try {
                _state.listeners[i]({
                    lastSyncAt: _state.lastSyncAt,
                    lastSyncOk: _state.lastSyncOk,
                    lastError: _state.lastError,
                    consecutiveFailures: _state.consecutiveFailures,
                    syncing: _state.syncing,
                    hasFailAlert: _state.consecutiveFailures >= FAIL_ALERT_THRESHOLD
                });
            } catch (e) {}
        }
    }

    function onSyncStatusChange(fn) {
        if (typeof fn === 'function') _state.listeners.push(fn);
    }

    function getSyncStatus() {
        return {
            lastSyncAt: _state.lastSyncAt,
            lastSyncOk: _state.lastSyncOk,
            lastError: _state.lastError,
            consecutiveFailures: _state.consecutiveFailures,
            syncing: _state.syncing,
            hasFailAlert: _state.consecutiveFailures >= FAIL_ALERT_THRESHOLD
        };
    }

    // ==== 判断某个 localforage key 是否需要同步 ====
    function _isTextKey(key) {
        if (key.indexOf(APP_PREFIX_STR) !== 0) return false;

        // 全局文字键（直接匹配）
        if (GLOBAL_TEXT_KEYS.indexOf(key) !== -1) return true;

        // 跳过的全局键（密钥、系统状态）
        if (GLOBAL_SKIP_KEYS.indexOf(key) !== -1) return false;

        // 跳过媒体类键（带 SESSION_ID 前缀，阶段三处理）
        for (var m = 0; m < SESSION_MEDIA_NEEDLES.length; m++) {
            if (key.indexOf(SESSION_MEDIA_NEEDLES[m]) !== -1) return false;
        }

        // 带 SESSION_ID 前缀的文字类键
        var sid = (typeof SESSION_ID !== 'undefined' && SESSION_ID) ? SESSION_ID : null;
        if (sid) {
            var sessionPrefix = APP_PREFIX_STR + sid + '_';
            if (key.indexOf(sessionPrefix) !== 0) return false;
        }
        for (var i = 0; i < SESSION_TEXT_NEEDLES.length; i++) {
            if (key.indexOf(SESSION_TEXT_NEEDLES[i]) !== -1) return true;
        }
        return false;
    }

    // ==== 收集本地文字类数据 ====
    async function _collectTextData() {
        var payload = {
            version: 1,
            sessionId: (typeof SESSION_ID !== 'undefined' ? SESSION_ID : null),
            savedAt: new Date().toISOString(),
            indexedDB: {},
            localStorage: {}
        };

        // localforage
        try {
            var keys = await localforage.keys();
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                if (!_isTextKey(k)) continue;
                try {
                    var v = await localforage.getItem(k);
                    if (v === undefined) continue;
                    // 阶段三B 修：backgroundGallery 本地 value 现在是全尺寸 base64
                    // 同步时把 value 换成 cloudUrl（oss:// 引用），让换设备恢复时能从云端下载
                    // 没有 cloudUrl 的（未上云）：如果有 thumbnail 用 thumbnail 兜底，否则跳过
                    if (k.indexOf('backgroundGallery') !== -1 && Array.isArray(v)) {
                        var sanitized = [];
                        v.forEach(function (bg) {
                            if (!bg || typeof bg !== 'object') { sanitized.push(bg); return; }
                            // 颜色/渐变：直接同步
                            if (typeof bg.value !== 'string' || (!bg.value.startsWith('data:image') && bg.value.indexOf('oss://') !== 0)) {
                                sanitized.push(bg);
                                return;
                            }
                            // 有云端备份引用：把 value 换成 cloudUrl
                            if (bg.cloudUrl && bg.cloudUrl.indexOf('oss://') === 0) {
                                var copy = Object.assign({}, bg);
                                copy.value = bg.cloudUrl; // 换成云端引用
                                // 本地 base64 不上传到云端 payload
                                delete copy.cloudUrl;
                                sanitized.push(copy);
                                return;
                            }
                            // 旧格式：value 已经是 oss://（历史数据）
                            if (bg.value.indexOf('oss://') === 0) {
                                sanitized.push(bg);
                                return;
                            }
                            // 纯本地 base64，没有云端备份：thumbnail 兜底，否则跳过
                            if (bg.thumbnail) {
                                var copy2 = Object.assign({}, bg);
                                copy2.value = bg.thumbnail;
                                sanitized.push(copy2);
                            }
                            // 没 thumbnail 也没云端：跳过，不上传大 base64
                        });
                        payload.indexedDB[k] = sanitized;
                        continue;
                    }
                    if (k.indexOf('chatBackground') !== -1) {
                        // chatBackground 本地存 base64，不同步到云端（体积大，换设备从 gallery 恢复）
                        if (typeof v === 'string' && v.indexOf('data:image') === 0) continue;
                        // 颜色/渐变等非图片类型：正常同步
                        payload.indexedDB[k] = v;
                        continue;
                    }
                    // 阶段三B 保护：日记背景图库（对象数组，同 backgroundGallery 逻辑）
                    // 注意：必须先判断 companionDiaryBgGallery（更长），再判断 companionDiaryBg，
                    // 否则 companionDiaryBg 的 indexOf 会先命中 companionDiaryBgGallery 的键
                    if (k.indexOf('companionDiaryBgGallery') !== -1 && Array.isArray(v)) {
                        var sanitizedDiary = v.filter(function (bg) {
                            if (!bg || typeof bg !== 'object') return true;
                            if (typeof bg.value !== 'string') return true;
                            if (bg.value.indexOf('oss://') === 0) return true;
                            if (!bg.value.startsWith('data:image')) return true;
                            return false;
                        });
                        sanitizedDiary = sanitizedDiary.map(function (bg) {
                            if (!bg || typeof bg !== 'object') return bg;
                            if (typeof bg.value === 'string' && bg.value.indexOf('data:image') === 0) {
                                var copy = Object.assign({}, bg);
                                if (bg.thumbnail) copy.value = bg.thumbnail;
                                else return null;
                                return copy;
                            }
                            return bg;
                        }).filter(Boolean);
                        payload.indexedDB[k] = sanitizedDiary;
                        continue;
                    }
                    // 阶段三B 保护：日记单张背景（同 chatBackground 逻辑）
                    if (k.indexOf('companionDiaryBg') !== -1 && !Array.isArray(v)) {
                        if (typeof v === 'string' && v.indexOf('data:image') === 0) continue;
                        payload.indexedDB[k] = v;
                        continue;
                    }
                    // 阶段三B 保护：贴纸库（字符串数组，元素可以是 base64 或 oss://）
                    // 过滤掉 base64 大图（避免 payload 爆炸），等迁移工具处理
                    if (k.indexOf('stickerLibrary') !== -1 && Array.isArray(v)) {
                        var sanitizedStickers = v.filter(function (item) {
                            if (typeof item !== 'string') return true;
                            if (item.indexOf('oss://') === 0) return true;
                            // base64 图片：跳过
                            if (item.indexOf('data:image') === 0) return false;
                            return true;
                        });
                        payload.indexedDB[k] = sanitizedStickers;
                        continue;
                    }
                    // 阶段三B 保护：companionData（嵌套对象，递归过滤 base64 大数据）
                    // backgrounds/voices/noises 里的 .data 字段可能是 base64，需要过滤
                    if (k.indexOf('companionData') !== -1 && v && typeof v === 'object') {
                        var sanitizeCompanionItems = function (items) {
                            if (!Array.isArray(items)) return items;
                            return items.map(function (item) {
                                if (!item || typeof item !== 'object') return item;
                                if (typeof item.data !== 'string') return item;
                                // 是 oss:// 引用：保留
                                if (item.data.indexOf('oss://') === 0) return item;
                                // 是 base64：过滤掉 data 字段，保留元数据
                                if (item.data.indexOf('data:') === 0) {
                                    var copy = Object.assign({}, item);
                                    delete copy.data; // 不上传 base64，换设备后需要迁移
                                    return copy;
                                }
                                return item;
                            });
                        };
                        var sanitizedCompanion = Object.assign({}, v);
                        var modes = ['study', 'work', 'exercise', 'sleep'];
                        ['backgrounds', 'voices', 'noises'].forEach(function (field) {
                            if (sanitizedCompanion[field] && typeof sanitizedCompanion[field] === 'object') {
                                var sanitizedField = {};
                                modes.forEach(function (mode) {
                                    sanitizedField[mode] = sanitizeCompanionItems(sanitizedCompanion[field][mode] || []);
                                });
                                sanitizedCompanion[field] = sanitizedField;
                            }
                        });
                        payload.indexedDB[k] = sanitizedCompanion;
                        continue;
                    }
                    // 阶段四：收藏语音键（favAudio_）只同步 oss:// 引用，base64 跳过（太大）
                    if (k.indexOf('favAudio_') !== -1) {
                        if (typeof v === 'string' && v.indexOf('oss://') === 0) {
                            payload.indexedDB[k] = v; // oss:// 引用：允许同步
                        }
                        // base64 或其他格式：跳过（不进 payload）
                        continue;
                    }
                    payload.indexedDB[k] = v;
                } catch (e) {
                    console.warn('[cloud-sync-engine] 读取失败', k, e);
                }
            }
        } catch (e) {
            console.warn('[cloud-sync-engine] 遍历 localforage 失败', e);
        }

        // localStorage
        try {
            for (var j = 0; j < localStorage.length; j++) {
                var lk = localStorage.key(j);
                if (!lk) continue;
                var match = false;
                if (TEXT_LS_KEYS.indexOf(lk) !== -1) match = true;
                else {
                    for (var p = 0; p < TEXT_LS_PREFIXES.length; p++) {
                        if (lk.indexOf(TEXT_LS_PREFIXES[p]) === 0) { match = true; break; }
                    }
                }
                if (!match) continue;
                try {
                    payload.localStorage[lk] = localStorage.getItem(lk);
                } catch (e) {}
            }
        } catch (e) {}

        return payload;
    }

    // ==== 上传到 OSS ====
    async function _uploadToOSS(jsonString, objectKey) {
        var cfg = window.CloudSync && window.CloudSync.getConfig();
        if (!cfg || !window.CloudSync.isConnected()) {
            throw new Error('未连接云端');
        }
        if (!objectKey) objectKey = _syncObjectKey();
        // 阿里云 V4 签名要求：如果请求头有 Content-Type，就必须签入 CanonicalHeaders。
        // 注意：Safari 会把 charset 值改成小写 utf-8，我们签名时必须用完全一致的字符串。
        var contentType = 'application/json;charset=utf-8';
        var url = await window.CloudSync.buildSignedUrl(cfg, 'PUT', objectKey, {}, contentType);
        var blob = new Blob([jsonString], { type: contentType });
        var res = await fetch(url, {
            method: 'PUT',
            body: blob
        });
        if (!res.ok) {
            var text = '';
            try { text = await res.text(); } catch (e) {}
            throw new Error('上传失败：HTTP ' + res.status + (text ? ' - ' + text.slice(0, 200) : ''));
        }
        return true;
    }

    // ==== 从 OSS 下载 ====
    async function _downloadFromOSS(objectKey) {
        var cfg = window.CloudSync && window.CloudSync.getConfig();
        if (!cfg || !window.CloudSync.isConnected()) {
            throw new Error('未连接云端');
        }
        if (!objectKey) objectKey = _syncObjectKey();
        var url = await window.CloudSync.buildSignedUrl(cfg, 'GET', objectKey, {});
        var res = await fetch(url, { method: 'GET' });
        if (res.status === 404) return null; // 云端没有数据
        if (!res.ok) {
            throw new Error('下载失败：HTTP ' + res.status);
        }
        var text = await res.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            throw new Error('云端数据格式错误');
        }
    }

    // ==== 更新云端 index（登记当前梦角） ====
    async function _updateIndex(payload) {
        try {
            var sid = payload.sessionId;
            if (!sid) return;
            var name = _extractPartnerName(payload) || '未命名梦角';
            // 拉旧 index（首次不存在会 404，属正常，静默处理）
            var index = null;
            try {
                index = await _downloadFromOSS(_indexObjectKey());
            } catch (e) {}
            if (!index || !index.sessions) index = { version: 1, sessions: {} };

            // 按名字去重：如果已有同名梦角（但 SESSION_ID 不同），
            // 把旧的那条删掉，只保留最新的 SESSION_ID。
            // 这样换设备/恢复操作不会在列表里累积重复条目。
            for (var existingSid in index.sessions) {
                if (!Object.prototype.hasOwnProperty.call(index.sessions, existingSid)) continue;
                if (existingSid === sid) continue; // 自己不删
                if (index.sessions[existingSid].name === name) {
                    delete index.sessions[existingSid];
                }
            }

            index.sessions[sid] = {
                name: name,
                lastSyncAt: payload.savedAt
            };
            index.updatedAt = new Date().toISOString();
            await _uploadToOSS(JSON.stringify(index), _indexObjectKey());
        } catch (e) {
            console.debug && console.debug('[cloud-sync-engine] 更新 index 失败', e);
        }
    }

    // ==== 列出云端所有梦角 ====
    async function listCloudSessions() {
        var index = await _downloadFromOSS(_indexObjectKey());
        if (!index || !index.sessions) return [];
        var list = [];
        for (var sid in index.sessions) {
            if (!Object.prototype.hasOwnProperty.call(index.sessions, sid)) continue;
            var entry = index.sessions[sid];
            list.push({
                sessionId: sid,
                name: entry.name || '未命名梦角',
                lastSyncAt: entry.lastSyncAt || null
            });
        }
        // 按最后同步时间倒序
        list.sort(function (a, b) {
            var ta = a.lastSyncAt ? new Date(a.lastSyncAt).getTime() : 0;
            var tb = b.lastSyncAt ? new Date(b.lastSyncAt).getTime() : 0;
            return tb - ta;
        });
        return list;
    }

    // ==== 恢复指定 sessionId 的数据到本地 ====
    // 会先清掉本地所有当前 session 的相关数据，再写入云端数据，最后切换 SESSION_ID
    // 注意：会保留云端同步配置（密钥）不被清除
    async function restoreSession(targetSessionId) {
        if (!targetSessionId) throw new Error('未指定要恢复的梦角');

        // 关键：进入恢复模式，禁止一切同步（否则清空过程中触发的防抖会把半状态数据上传，
        // 可能污染云端其他梦角的 index，甚至覆盖当前梦角自己的完整数据）
        _state.restoreInProgress = true;
        _state.awaitingRestoreChoice = false;
        if (_state.pendingTimer) {
            clearTimeout(_state.pendingTimer);
            _state.pendingTimer = null;
        }

        try {
            var objectKey = 'sync/' + targetSessionId + '/text-data.json';
            var remote = await _downloadFromOSS(objectKey);
            if (!remote) throw new Error('云端找不到该梦角的数据');

            // 需要保留的 key（不清空）：全局配置，不属于任何梦角
            var PRESERVE_KEYS = [
                APP_PREFIX_STR + 'cloudSyncConfig',   // 阿里云密钥
                APP_PREFIX_STR + 'tour_seen',          // 新手引导已看过
                APP_PREFIX_STR + 'MIGRATION_V2_DONE'   // 数据迁移标记
            ];
            function _isPreserved(k) {
                return PRESERVE_KEYS.indexOf(k) !== -1;
            }

            // 1) 清掉本地所有 CHAT_APP 相关 key（IndexedDB），但保留全局配置
            var keys = await localforage.keys();
            for (var i = 0; i < keys.length; i++) {
                if (keys[i].indexOf(APP_PREFIX_STR) === 0 && !_isPreserved(keys[i])) {
                    try { await localforage.removeItem(keys[i]); } catch (e) {}
                }
            }
            // 2) 清 localStorage 里 app 相关的（包括紧急备份！）
            try {
                var lsKeys = [];
                for (var j = 0; j < localStorage.length; j++) {
                    var lk = localStorage.key(j);
                    if (lk) lsKeys.push(lk);
                }
                for (var m = 0; m < lsKeys.length; m++) {
                    // 紧急备份 / crash recovery 数据：必须清掉，否则 app 重启会用旧数据覆盖我们刚恢复的数据
                    if (lsKeys[m] === 'BACKUP_V1_critical' ||
                        lsKeys[m] === 'BACKUP_V1_timestamp' ||
                        lsKeys[m] === '_cdRecLogs') {
                        localStorage.removeItem(lsKeys[m]);
                        continue;
                    }
                    if (TEXT_LS_KEYS.indexOf(lsKeys[m]) !== -1) {
                        localStorage.removeItem(lsKeys[m]);
                        continue;
                    }
                    for (var p = 0; p < TEXT_LS_PREFIXES.length; p++) {
                        if (lsKeys[m].indexOf(TEXT_LS_PREFIXES[p]) === 0) {
                            localStorage.removeItem(lsKeys[m]);
                            break;
                        }
                    }
                }
            } catch (e) {}

            // 3) 写入云端数据（键名带有目标 SESSION_ID 前缀，直接写入即可）
            var count = 0;
            if (remote.indexedDB) {
                for (var k in remote.indexedDB) {
                    if (!Object.prototype.hasOwnProperty.call(remote.indexedDB, k)) continue;
                    try {
                        await localforage.setItem(k, remote.indexedDB[k]);
                        count++;
                    } catch (e) {}
                }
            }
            if (remote.localStorage) {
                for (var lk2 in remote.localStorage) {
                    if (!Object.prototype.hasOwnProperty.call(remote.localStorage, lk2)) continue;
                    try {
                        var v = remote.localStorage[lk2];
                        if (v == null) localStorage.removeItem(lk2);
                        else localStorage.setItem(lk2, v);
                        count++;
                    } catch (e) {}
                }
            }

            // 4) 强制设置 lastSessionId 和 sessionList，确保 app 用正确的 session 启动
            try {
                // 从 remote 拿到正确的 sessionList（云端存的原始 sessionList）
                var remoteSessionList = (remote.indexedDB && remote.indexedDB[APP_PREFIX_STR + 'sessionList']) || null;
                if (Array.isArray(remoteSessionList) && remoteSessionList.some(function(s) { return s && s.id === targetSessionId; })) {
                    // 直接用云端的 sessionList，它包含目标 session
                    await localforage.setItem(APP_PREFIX_STR + 'sessionList', remoteSessionList);
                } else {
                    // 兜底：确保目标 session 在列表里
                    var sl = await localforage.getItem(APP_PREFIX_STR + 'sessionList');
                    if (!Array.isArray(sl)) sl = [];
                    if (!sl.some(function(s) { return s && s.id === targetSessionId; })) {
                        sl.push({ id: targetSessionId, name: _extractPartnerName(remote) || '已恢复的梦角', createdAt: Date.now() });
                        await localforage.setItem(APP_PREFIX_STR + 'sessionList', sl);
                    }
                }
                // lastSessionId 强制指向目标
                await localforage.setItem(APP_PREFIX_STR + 'lastSessionId', targetSessionId);
            } catch (e) {}

            // 5) 在 reload 之前最后一刻清掉紧急备份
            // 注意：visibilitychange/pagehide 可能在 reload 触发时重新写入备份，
            // 所以这里清完之后要尽快 reload，不给 app 重写的机会
            try {
                localStorage.removeItem('BACKUP_V1_critical');
                localStorage.removeItem('BACKUP_V1_timestamp');
                localStorage.removeItem('_cdRecLogs');
            } catch (e) {}

            // 恢复完成后不清除 restoreInProgress 标记，让即将到来的 reload 处理一切
            // （如果 reload 因某种原因失败，页面下次刷新时也会正常初始化）
            return { count: count, savedAt: remote.savedAt, sessionId: targetSessionId };
        } catch (e) {
            // 失败时解除锁定
            _state.restoreInProgress = false;
            // 也清掉可能因清空触发的防抖
            if (_state.pendingTimer) {
                clearTimeout(_state.pendingTimer);
                _state.pendingTimer = null;
            }
            throw e;
        }
    }

    // ==== 主同步动作（异步，不抛错） ====
    async function _doSync(reason) {
        if (_state.syncing) return;
        if (!window.CloudSync || !window.CloudSync.isConnected()) return;
        // SESSION_ID 未就绪时不同步（避免读取到错误的 session 数据）
        if (typeof SESSION_ID === 'undefined' || !SESSION_ID) return;

        _state.syncing = true;
        _notify();
        try {
            var payload = await _collectTextData();
            var jsonString = JSON.stringify(payload);
            await _uploadToOSS(jsonString);
            // 顺便更新云端 index（登记当前梦角）— 失败不影响主同步
            _updateIndex(payload);

            _state.lastSyncAt = new Date();
            _state.lastSyncOk = true;
            _state.lastError = null;
            _state.consecutiveFailures = 0;
            _state.failAlertShown = false; // 成功后重置，下次失败可以再提示
        } catch (e) {
            _state.lastSyncOk = false;
            _state.lastError = String(e && e.message || e);
            _state.consecutiveFailures++;
            console.warn('[cloud-sync-engine] 同步失败（第 ' + _state.consecutiveFailures + ' 次）:', e);
            // 达到阈值时告知用户（本次会话只提示一次）
            if (_state.consecutiveFailures >= FAIL_ALERT_THRESHOLD && !_state.failAlertShown) {
                _state.failAlertShown = true;
                if (typeof showNotification === 'function') {
                    showNotification('云端同步失败，请检查网络或密钥（数据管理 → 云端同步）', 'error', 5000);
                }
            }
        } finally {
            _state.syncing = false;
            _notify();
        }
    }

    // ==== 触发（防抖） ====
    function _scheduleSync(reason, immediate) {
        if (!window.CloudSync || !window.CloudSync.isConnected()) return;
        // 未就绪时不同步：避免 app 启动加载数据时被误触发
        if (!_state.ready && reason === 'change') return;
        // 恢复进行中：完全暂停同步（避免半状态被上传覆盖云端好数据）
        if (_state.restoreInProgress) return;
        // 等待用户选择要恢复哪个梦角时：暂停同步（本地是空的，别上传空数据覆盖云端）
        if (_state.awaitingRestoreChoice) return;
        if (_state.pendingTimer) {
            clearTimeout(_state.pendingTimer);
            _state.pendingTimer = null;
        }
        if (immediate) {
            _doSync(reason);
        } else {
            _state.pendingReason = reason;
            _state.pendingTimer = setTimeout(function () {
                _state.pendingTimer = null;
                _doSync(reason);
            }, DEBOUNCE_MS);
        }
    }

    function requestSync() { _scheduleSync('manual', false); }
    function requestSyncNow() { _scheduleSync('manual', true); }

    // ==== 监听 localforage 写入（Hook） ====
    // 通过包装 localforage.setItem / removeItem 来监听变化
    function _hookLocalforage() {
        if (typeof localforage === 'undefined') return;
        if (localforage.__cloudSyncHooked) return;
        localforage.__cloudSyncHooked = true;

        var origSetItem = localforage.setItem.bind(localforage);
        var origRemoveItem = localforage.removeItem.bind(localforage);

        localforage.setItem = function (key, value, cb) {
            var p = origSetItem(key, value, cb);
            if (typeof key === 'string' && _isTextKey(key)) {
                _scheduleSync('change', false);
            }
            return p;
        };
        localforage.removeItem = function (key, cb) {
            var p = origRemoveItem(key, cb);
            if (typeof key === 'string' && _isTextKey(key)) {
                _scheduleSync('change', false);
            }
            return p;
        };
    }

    // ==== 监听 localStorage 写入 ====
    // Safari 里直接给 localStorage.setItem 赋值可能失败，用 Storage.prototype 覆盖更稳
    function _hookLocalStorage() {
        if (window.__cloudSyncLSHooked) return;
        try {
            window.__cloudSyncLSHooked = true;
            var proto = Storage.prototype;
            var origSet = proto.setItem;
            var origRemove = proto.removeItem;

            function _matchLS(k) {
                if (TEXT_LS_KEYS.indexOf(k) !== -1) return true;
                for (var p = 0; p < TEXT_LS_PREFIXES.length; p++) {
                    if (k.indexOf(TEXT_LS_PREFIXES[p]) === 0) return true;
                }
                return false;
            }

            proto.setItem = function (key, value) {
                var r = origSet.call(this, key, value);
                if (this === window.localStorage && typeof key === 'string' && _matchLS(key)) {
                    _scheduleSync('change', false);
                }
                return r;
            };
            proto.removeItem = function (key) {
                var r = origRemove.call(this, key);
                if (this === window.localStorage && typeof key === 'string' && _matchLS(key)) {
                    _scheduleSync('change', false);
                }
                return r;
            };
        } catch (e) {
            console.warn('[cloud-sync-engine] Hook localStorage 失败', e);
        }
    }

    // ==== 页面隐藏时立即同步 ====
    function _hookVisibility() {
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') {
                // 强制立即同步（如果有 pending 的话）
                if (_state.pendingTimer) {
                    clearTimeout(_state.pendingTimer);
                    _state.pendingTimer = null;
                    _scheduleSync('visibility', true);
                }
            }
        });
        // pagehide 事件更可靠（iOS Safari 关闭页签时）
        window.addEventListener('pagehide', function () {
            if (_state.pendingTimer) {
                clearTimeout(_state.pendingTimer);
                _state.pendingTimer = null;
                _scheduleSync('visibility', true);
            }
        });
    }

    // ==== 启动检测：本地空但云端有 → 询问选择哪个梦角恢复 ====
    async function _checkRestoreOnStart() {
        if (_state.restoreOffered) return;
        if (!window.CloudSync || !window.CloudSync.isConnected()) {
            // 未连接也允许后续同步（连接后会自动重跑本函数）
            _state.ready = true;
            return;
        }
        // 等 SESSION_ID 就绪（app 初始化异步）
        if (typeof SESSION_ID === 'undefined' || !SESSION_ID) {
            setTimeout(_checkRestoreOnStart, 1000);
            return;
        }

        // 判断本地是否为"空"：只要有 chatMessages 或 sessionList 就算非空
        // 注意：新设备第一次打开会默认初始化 sessionList / chatMessages 为空数据。
        // 因此这里要额外判断 sessionList 里是否真的有内容。
        try {
            var sessionList = await localforage.getItem(APP_PREFIX_STR + 'sessionList');
            var hasLocalData = sessionList && sessionList.length > 0;

            if (hasLocalData) {
                _state.ready = true;
                return;
            }

            // 本地实质为空，检查云端是否有梦角
            var list = await listCloudSessions();
            if (!list || list.length === 0) {
                _state.ready = true;
                return;
            }
            _state.restoreOffered = true;

            // 关键：在用户做出选择之前，禁止同步——否则本地空数据会被上传，
            // 覆盖云端 index 里已有的梦角登记。
            _state.awaitingRestoreChoice = true;

            // 交给 UI 层展示选择器
            if (typeof window.__cloudSyncShowRestorePicker === 'function') {
                window.__cloudSyncShowRestorePicker(list, { autoTriggered: true });
            }
            // 不设 ready=true，直到用户做出选择（选完会 reload，或取消时 UI 层解除锁定）
        } catch (e) {
            console.warn('[cloud-sync-engine] 启动检测失败', e);
            _state.ready = true;
        }
    }

    // ==== 启动 ====
    function boot() {
        if (typeof window.CloudSync === 'undefined' || typeof localforage === 'undefined') {
            setTimeout(boot, 200);
            return;
        }

        // 需要在阶段一暴露 buildSignedUrl；如果没有，等待
        if (typeof window.CloudSync.buildSignedUrl !== 'function') {
            setTimeout(boot, 200);
            return;
        }

        _hookLocalforage();
        _hookLocalStorage();
        _hookVisibility();

        // 首次启动检测（延迟 3 秒等 app 加载完）
        setTimeout(_checkRestoreOnStart, 3000);

        // 连接状态变化时重新检查恢复（比如用户在数据管理里刚填完密钥）
        window.CloudSync.onStatusChange(function (evt) {
            if (evt.connected) {
                setTimeout(_checkRestoreOnStart, 1000);
            }
        });
    }

    // ==== 暴露 ====
    // 供 UI 调用：用户在"自动触发的选择器"里点了取消 / 关闭
    // 释放"等待选择"锁，允许后续正常同步
    function cancelRestorePrompt() {
        _state.awaitingRestoreChoice = false;
        _state.ready = true;
    }

    global.CloudSyncEngine = {
        requestSync: requestSync,
        requestSyncNow: requestSyncNow,
        listCloudSessions: listCloudSessions,
        restoreSession: restoreSession,
        cancelRestorePrompt: cancelRestorePrompt,
        getSyncStatus: getSyncStatus,
        onSyncStatusChange: onSyncStatusChange
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(typeof window !== 'undefined' ? window : this);
