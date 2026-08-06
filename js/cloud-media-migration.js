/**
 * cloud-media-migration.js — 旧数据迁移工具
 *
 * 扫描本地所有 base64 图片/音频，上传到云端，替换成 oss:// 引用。
 * 迁移完成后本地空间会大幅减少。
 *
 * 已支持的类别：
 *   - 背景图库（backgroundGallery）→ 云端全尺寸 + 本地缩略图
 *   - 当前聊天背景（chatBackground）→ 云端全尺寸
 *   - 日记背景图库（companionDiaryBgGallery）→ 云端全尺寸 + 本地缩略图
 *   - 当前日记背景（companionDiaryBg）→ 云端全尺寸
 *   - 对方表情库（stickerLibrary）→ 云端引用（无缩略图，直接懒加载）
 *   - 我的表情库（myStickerLibrary）→ 云端引用
 *   - 陪伴媒体（companionData.backgrounds/voices/noises）→ 云端引用
 *   - 收藏语音（favAudio_*）→ 云端引用（旧键名 + 旧格式 base64 全覆盖）
 *   - 聊天图片（chatMessages[].image）→ 云端引用（base64 替换，消息内容不变）
 */
(function (global) {
    'use strict';

    var APP_PREFIX_STR = (typeof APP_PREFIX !== 'undefined' ? APP_PREFIX : 'CHAT_APP_V3_');
    var COMPANION_MODES = ['study', 'work', 'exercise', 'sleep'];
    var COMPANION_MEDIA_TYPES = [
        { field: 'backgrounds', category: 'companion-backgrounds' },
        { field: 'voices',      category: 'companion-voices' },
        { field: 'noises',      category: 'companion-noises' }
    ];

    // 聊天图片每批处理数量：每批上传完立即写回 localforage，
    // 这样即使中途崩溃也能保留已完成进度，下次迁移会跳过已是 oss:// 的条目
    var CHAT_IMAGE_BATCH_SIZE = 15;

    // 迁移状态
    var _state = {
        running: false,
        progress: 0,
        total: 0,
        currentTask: '',
        completed: 0,
        failed: 0,
        listeners: []
    };

    function _notify() {
        _state.listeners.forEach(function (fn) {
            try { fn(getStatus()); } catch (e) {}
        });
    }

    function getStatus() {
        return {
            running: _state.running,
            progress: _state.progress,
            total: _state.total,
            currentTask: _state.currentTask,
            completed: _state.completed,
            failed: _state.failed
        };
    }

    function onStatusChange(fn) { if (typeof fn === 'function') _state.listeners.push(fn); }

    // 判断是否是需要迁移的 base64 图片
    function _isBase64Image(v) {
        return typeof v === 'string' && v.indexOf('data:image/') === 0 && v.length > 1000;
    }

    // 判断是否是需要迁移的裸 base64 音频（favAudio 旧格式：没有 data:audio 前缀，直接是 base64 字符串）
    function _isRawBase64Audio(v) {
        return typeof v === 'string'
            && v.indexOf('oss://') !== 0
            && v.indexOf('data:') !== 0
            && v.length > 1000;
    }

    // 判断是否是需要迁移的 base64 音视频（陪伴媒体 .data 字段，带 data:audio/ 或 data:video/ 前缀）
    function _isBase64Media(v) {
        return typeof v === 'string'
            && (v.indexOf('data:audio/') === 0 || v.indexOf('data:video/') === 0 || v.indexOf('data:image/') === 0)
            && v.length > 1000;
    }

    // ==== 关键：迁移后同步内存变量，防止 saveData() 用旧 base64 覆盖已迁移数据 ====
    //
    // app 的 saveData() 会定期把内存里的 stickerLibrary / myStickerLibrary / messages 写回
    // localforage。迁移只更新了 localforage，内存变量仍是 base64。
    // 只要 saveData() 一跑（用户切换标签页、定时保存等），localforage 就被覆盖回去了。
    // 解决方案：迁移写 localforage 的同时，也把对应的全局内存变量更新成 oss:// 版本。
    function _syncMemory(key, value) {
        try {
            if (key.indexOf('_stickerLibrary') !== -1 && key.indexOf('mySticker') === -1) {
                /* global stickerLibrary */
                stickerLibrary = value;
            } else if (key.indexOf('_myStickerLibrary') !== -1) {
                /* global myStickerLibrary */
                myStickerLibrary = value;
            }
            // chatMessages 的内存变量（messages）由 _migrateChatImages 逐条更新，不在此处理
        } catch (e) {
            // 全局变量不存在时静默跳过（不影响 localforage 已写入的数据）
        }
    }

    // ==== 通用：对象数组类型的背景图库迁移（backgroundGallery / companionDiaryBgGallery）====
    async function _migrateObjectGallery(sid, keySuffix, category, label) {
        var key = APP_PREFIX_STR + sid + '_' + keySuffix;
        var gallery = await localforage.getItem(key);
        if (!Array.isArray(gallery) || gallery.length === 0) return;

        var newGallery = [];
        for (var i = 0; i < gallery.length; i++) {
            var bg = gallery[i];
            if (!bg || typeof bg !== 'object') { newGallery.push(bg); continue; }
            // 已经是云端引用了：跳过
            if (typeof bg.value === 'string' && bg.value.indexOf('oss://') === 0) {
                newGallery.push(bg);
                continue;
            }
            // 不是图片（是颜色/渐变）：跳过
            if (!_isBase64Image(bg.value)) {
                newGallery.push(bg);
                continue;
            }
            // 需要迁移
            _state.currentTask = label + ' ' + (i + 1) + '/' + gallery.length;
            _notify();
            try {
                var uploadResult = await window.CloudMedia.upload(bg.value, category, bg.id || undefined);
                var thumb = null;
                try {
                    thumb = await window.CloudMedia.makeThumbnail(bg.value, 200);
                } catch (thumbErr) {
                    console.warn('[migration] 缩略图生成失败，跳过', thumbErr);
                }
                newGallery.push({
                    id: bg.id,
                    type: bg.type,
                    value: uploadResult.url,
                    thumbnail: thumb,
                    cloudKey: uploadResult.key
                });
                _state.completed++;
            } catch (e) {
                console.warn('[migration] ' + label + '上传失败', e);
                newGallery.push(bg); // 失败保留原状
                _state.failed++;
            }
            _state.progress++;
            _notify();
        }
        await localforage.setItem(key, newGallery);
    }

    // ==== 通用：单张图迁移（chatBackground / companionDiaryBg）====
    async function _migrateSingleImage(sid, keySuffix, category, label) {
        var key = APP_PREFIX_STR + sid + '_' + keySuffix;
        var bg = await localforage.getItem(key);
        if (!_isBase64Image(bg)) return;

        _state.currentTask = label;
        _notify();
        try {
            var r = await window.CloudMedia.upload(bg, category);
            await localforage.setItem(key, r.url);
            _state.completed++;
        } catch (e) {
            console.warn('[migration] ' + label + '上传失败', e);
            _state.failed++;
        }
        _state.progress++;
        _notify();
    }

    // ==== 贴纸库迁移（字符串数组）====
    async function _migrateStickerArray(sid, keySuffix, category, label) {
        var key = APP_PREFIX_STR + sid + '_' + keySuffix;
        var arr = await localforage.getItem(key);
        if (!Array.isArray(arr) || arr.length === 0) return;

        // 读取屏蔽集合
        var disabledSet = null;
        try {
            var raw = localStorage.getItem('disabledStickerItems');
            if (raw) disabledSet = new Set(JSON.parse(raw));
        } catch (e) {}

        var newArr = [];
        for (var i = 0; i < arr.length; i++) {
            var item = arr[i];
            if (typeof item !== 'string' || item.indexOf('oss://') === 0) {
                newArr.push(item);
                continue;
            }
            if (!_isBase64Image(item)) {
                newArr.push(item);
                continue;
            }
            _state.currentTask = label + ' ' + (i + 1) + '/' + arr.length;
            _notify();
            try {
                var r = await window.CloudMedia.upload(item, category);
                newArr.push(r.url);
                if (disabledSet && disabledSet.has(item)) {
                    disabledSet.delete(item);
                    disabledSet.add(r.url);
                }
                _state.completed++;
            } catch (e) {
                console.warn('[migration] ' + label + '上传失败', e);
                newArr.push(item);
                _state.failed++;
            }
            _state.progress++;
            _notify();
        }
        await localforage.setItem(key, newArr);

        // 同步内存变量，防止 saveData() 把旧 base64 重新写回 localforage
        _syncMemory(key, newArr);

        if (disabledSet !== null) {
            try {
                localStorage.setItem('disabledStickerItems', JSON.stringify(Array.from(disabledSet)));
            } catch (e) {}
        }
    }

    // ==== 陪伴媒体迁移（companionData.backgrounds / voices / noises）====
    async function _migrateCompanionData(sid) {
        var key = APP_PREFIX_STR + sid + '_companionData';
        var data = await localforage.getItem(key);
        if (!data || typeof data !== 'object') return;

        var changed = false;

        for (var ti = 0; ti < COMPANION_MEDIA_TYPES.length; ti++) {
            var typeInfo = COMPANION_MEDIA_TYPES[ti];
            var field = typeInfo.field;      // 'backgrounds' / 'voices' / 'noises'
            var category = typeInfo.category;

            if (!data[field] || typeof data[field] !== 'object') continue;

            for (var mi = 0; mi < COMPANION_MODES.length; mi++) {
                var mode = COMPANION_MODES[mi];
                var arr = data[field][mode];
                if (!Array.isArray(arr) || arr.length === 0) continue;

                for (var i = 0; i < arr.length; i++) {
                    var item = arr[i];
                    if (!item || typeof item !== 'object') continue;
                    // 已经是云端引用：跳过
                    if (typeof item.data === 'string' && item.data.indexOf('oss://') === 0) continue;
                    // 不是 base64 媒体：跳过
                    if (!_isBase64Media(item.data)) continue;

                    var labelStr = '陪伴' + field + '[' + mode + '] ' + (i + 1) + '/' + arr.length;
                    _state.currentTask = labelStr;
                    _notify();

                    try {
                        var r = await window.CloudMedia.upload(item.data, category, item.id || undefined);
                        arr[i] = Object.assign({}, item, {
                            data: r.url,
                            cloudKey: r.key
                        });
                        changed = true;
                        _state.completed++;
                    } catch (e) {
                        console.warn('[migration] 陪伴媒体上传失败', field, mode, i, e);
                        _state.failed++;
                    }
                    _state.progress++;
                    _notify();
                }
            }
        }

        if (changed) {
            await localforage.setItem(key, data);
        }
    }

    // ==== 收藏语音迁移（旧格式 favAudio）====
    async function _migrateFavAudio(sid) {
        var allKeys = await localforage.keys();

        var targets = [];
        for (var ki = 0; ki < allKeys.length; ki++) {
            var k = allKeys[ki];
            var isSidKey   = k.indexOf(APP_PREFIX_STR + sid + '_favAudio_') === 0;
            var isNoSidKey = k.indexOf('favAudio_') === 0 && k.indexOf(APP_PREFIX_STR) !== 0;
            if (!isSidKey && !isNoSidKey) continue;

            var val = await localforage.getItem(k);
            if (typeof val === 'string' && val.indexOf('oss://') === 0) continue;
            if (!_isRawBase64Audio(val)) continue;

            var msgId = isSidKey
                ? k.slice((APP_PREFIX_STR + sid + '_favAudio_').length)
                : k.slice('favAudio_'.length);

            targets.push({ oldKey: k, msgId: msgId, val: val, isSidKey: isSidKey });
        }

        for (var ti = 0; ti < targets.length; ti++) {
            var t = targets[ti];
            _state.currentTask = '收藏语音 ' + (ti + 1) + '/' + targets.length;
            _notify();

            try {
                var binary = atob(t.val);
                var bytes = new Uint8Array(binary.length);
                for (var bi = 0; bi < binary.length; bi++) bytes[bi] = binary.charCodeAt(bi);
                var blob = new Blob([bytes], { type: 'audio/mpeg' });

                var r = await window.CloudMedia.upload(blob, 'fav-audio', t.msgId);
                var newKey = APP_PREFIX_STR + sid + '_favAudio_' + t.msgId;

                await localforage.setItem(newKey, r.url);

                if (t.oldKey !== newKey) {
                    await localforage.removeItem(t.oldKey);
                }

                _state.completed++;
            } catch (e) {
                console.warn('[migration] 收藏语音上传失败', t.msgId, e);
                _state.failed++;
            }
            _state.progress++;
            _notify();
        }
    }

    // ==== 聊天图片迁移（chatMessages[].image base64 → oss://）====
    //
    // 分批处理，每批完成后立即写回 localforage 并同步内存变量（messages）。
    // 防止 saveData() 用旧 base64 覆盖已迁移数据。
    async function _migrateChatImages(sid) {
        var key = APP_PREFIX_STR + sid + '_chatMessages';
        var msgs;
        try {
            msgs = await localforage.getItem(key);
        } catch (loadErr) {
            console.warn('[migration] 聊天图片：加载 chatMessages 失败，跳过', loadErr);
            return;
        }
        if (!Array.isArray(msgs) || msgs.length === 0) return;

        // 找出所有需要迁移的图片索引
        var toMigrate = [];
        for (var i = 0; i < msgs.length; i++) {
            var msg = msgs[i];
            if (!msg || !msg.image) continue;
            if (typeof msg.image !== 'string') continue;
            if (msg.image.indexOf('oss://') === 0) continue;
            if (msg.image.indexOf('pending://') === 0) continue;
            if (!_isBase64Image(msg.image)) continue;
            toMigrate.push(i);
        }
        if (toMigrate.length === 0) return;

        // 分批上传，每批完成后写回 localforage + 同步内存变量
        for (var batchStart = 0; batchStart < toMigrate.length; batchStart += CHAT_IMAGE_BATCH_SIZE) {
            var batchEnd = Math.min(batchStart + CHAT_IMAGE_BATCH_SIZE, toMigrate.length);
            var batchChanged = false;

            for (var j = batchStart; j < batchEnd; j++) {
                var idx = toMigrate[j];
                var m = msgs[idx];
                _state.currentTask = '聊天图片 ' + (j + 1) + '/' + toMigrate.length;
                _notify();
                try {
                    var r = await window.CloudMedia.upload(m.image, 'chat-images');
                    msgs[idx] = Object.assign({}, msgs[idx], { image: r.url });
                    batchChanged = true;
                    _state.completed++;
                } catch (e) {
                    console.warn('[migration] 聊天图片上传失败 msgId=' + (m.id || idx), e);
                    _state.failed++;
                }
                _state.progress++;
                _notify();
            }

            if (batchChanged) {
                try {
                    await localforage.setItem(key, msgs);
                } catch (saveErr) {
                    console.error('[migration] 聊天图片写回失败（第 ' + Math.floor(batchStart / CHAT_IMAGE_BATCH_SIZE + 1) + ' 批）', saveErr);
                    throw saveErr;
                }

                // 同步内存变量 messages，防止 saveData() 把旧 base64 重新写回 localforage
                try {
                    /* global messages */
                    if (typeof messages !== 'undefined' && Array.isArray(messages)) {
                        for (var si = batchStart; si < batchEnd; si++) {
                            var sidx = toMigrate[si];
                            if (msgs[sidx] && msgs[sidx].image && msgs[sidx].image.indexOf('oss://') === 0) {
                                if (messages[sidx]) {
                                    messages[sidx] = Object.assign({}, messages[sidx], { image: msgs[sidx].image });
                                }
                            }
                        }
                    }
                } catch (memErr) {
                    // 内存同步失败不影响 localforage 写入，静默跳过
                }
            }
        }
    }

    // ==== 扫描：计算总项数 ====
    async function _countTasks(sid) {
        var count = 0;

        // 背景图库
        var g = await localforage.getItem(APP_PREFIX_STR + sid + '_backgroundGallery');
        if (Array.isArray(g)) {
            g.forEach(function (bg) { if (bg && _isBase64Image(bg.value)) count++; });
        }
        // 聊天背景
        var cb = await localforage.getItem(APP_PREFIX_STR + sid + '_chatBackground');
        if (_isBase64Image(cb)) count++;

        // 日记背景图库
        var dg = await localforage.getItem(APP_PREFIX_STR + sid + '_companionDiaryBgGallery');
        if (Array.isArray(dg)) {
            dg.forEach(function (bg) { if (bg && _isBase64Image(bg.value)) count++; });
        }
        // 日记当前背景
        var dcb = await localforage.getItem(APP_PREFIX_STR + sid + '_companionDiaryBg');
        if (_isBase64Image(dcb)) count++;

        // 贴纸库
        var sl = await localforage.getItem(APP_PREFIX_STR + sid + '_stickerLibrary');
        if (Array.isArray(sl)) {
            sl.forEach(function (item) { if (_isBase64Image(item)) count++; });
        }
        var ml = await localforage.getItem(APP_PREFIX_STR + sid + '_myStickerLibrary');
        if (Array.isArray(ml)) {
            ml.forEach(function (item) { if (_isBase64Image(item)) count++; });
        }

        // 陪伴媒体
        var cd = await localforage.getItem(APP_PREFIX_STR + sid + '_companionData');
        if (cd && typeof cd === 'object') {
            COMPANION_MEDIA_TYPES.forEach(function (typeInfo) {
                var field = typeInfo.field;
                if (!cd[field] || typeof cd[field] !== 'object') return;
                COMPANION_MODES.forEach(function (mode) {
                    var arr = cd[field][mode];
                    if (!Array.isArray(arr)) return;
                    arr.forEach(function (item) {
                        if (item && _isBase64Media(item.data)) count++;
                    });
                });
            });
        }

        // 收藏语音（旧格式）
        var allKeys = await localforage.keys();
        for (var ki = 0; ki < allKeys.length; ki++) {
            var k = allKeys[ki];
            var isSidKey   = k.indexOf(APP_PREFIX_STR + sid + '_favAudio_') === 0;
            var isNoSidKey = k.indexOf('favAudio_') === 0 && k.indexOf(APP_PREFIX_STR) !== 0;
            if (!isSidKey && !isNoSidKey) continue;
            var val = await localforage.getItem(k);
            if (_isRawBase64Audio(val)) count++;
        }

        // 聊天图片：用 try/catch 包裹，防止大数组加载失败导致整个 count 流程中断
        try {
            var cm = await localforage.getItem(APP_PREFIX_STR + sid + '_chatMessages');
            if (Array.isArray(cm)) {
                cm.forEach(function (msg) {
                    if (msg && msg.image && _isBase64Image(msg.image)) count++;
                });
            }
        } catch (e) {
            console.warn('[migration] 无法统计聊天图片数量（数据过大？），将在迁移时尝试处理', e);
        }

        return count;
    }

    // ==== 主入口 ====
    async function runMigration() {
        if (_state.running) throw new Error('迁移正在进行中');
        if (!window.CloudSync || !window.CloudSync.isConnected()) {
            throw new Error('请先连接云端');
        }
        if (!window.CloudMedia) throw new Error('云端媒体模块未就绪');

        var sid = SESSION_ID;
        if (!sid) throw new Error('SESSION_ID 未就绪');

        _state.running = true;
        _state.progress = 0;
        _state.completed = 0;
        _state.failed = 0;
        _state.currentTask = '扫描中…';
        _notify();

        // 暂停紧急备份系统，防止迁移过程中 base64 快照覆盖迁移结果
        window._skipBackup = true;
        try { localStorage.removeItem('BACKUP_V1_critical'); } catch (e) {}
        try { localStorage.removeItem('BACKUP_V1_timestamp'); } catch (e) {}

        try {
            _state.total = await _countTasks(sid);
            if (_state.total === 0) {
                _state.currentTask = '没有需要迁移的项目';
                _notify();
                return { migrated: 0, failed: 0, total: 0 };
            }
            _notify();

            // 聊天背景
            await _migrateObjectGallery(sid, 'backgroundGallery', 'backgrounds', '背景图库');
            await _migrateSingleImage(sid, 'chatBackground', 'backgrounds', '当前聊天背景');

            // 日记背景
            await _migrateObjectGallery(sid, 'companionDiaryBgGallery', 'diary-backgrounds', '日记背景图库');
            await _migrateSingleImage(sid, 'companionDiaryBg', 'diary-backgrounds', '当前日记背景');

            // 贴纸（写 localforage 后同步内存变量）
            await _migrateStickerArray(sid, 'stickerLibrary', 'stickers', '对方表情库');
            await _migrateStickerArray(sid, 'myStickerLibrary', 'my-stickers', '我的表情库');

            // 陪伴媒体
            await _migrateCompanionData(sid);

            // 收藏语音
            await _migrateFavAudio(sid);

            // 聊天图片（分批，每批同步内存变量）
            await _migrateChatImages(sid);

            _state.currentTask = '完成';
            _notify();
            return { migrated: _state.completed, failed: _state.failed, total: _state.total };
        } finally {
            _state.running = false;
            // 迁移完成后清掉备份，恢复备份系统
            try { localStorage.removeItem('BACKUP_V1_critical'); } catch (e) {}
            try { localStorage.removeItem('BACKUP_V1_timestamp'); } catch (e) {}
            window._skipBackup = false;
            _notify();
        }
    }

    global.CloudMediaMigration = {
        run: runMigration,
        getStatus: getStatus,
        onStatusChange: onStatusChange
    };
})(typeof window !== 'undefined' ? window : this);
