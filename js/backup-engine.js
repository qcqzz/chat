/**
 * 统一备份/恢复：v5 默认 ZIP（结构 JSON + media/ 二进制），避免单文件巨型 JSON 无法解析；
 * v4 单文件 JSON 仍可导入。依赖：localforage、JSZip（CDN）、全局 APP_PREFIX / SESSION_ID。
 */
(function (global) {
    'use strict';

    var MIN_MEDIA_CHARS = 800;

    function escapeRe(s) {
        return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function isDataMediaUrl(s) {
        return typeof s === 'string' && s.length > MIN_MEDIA_CHARS && /^data:(image|video|audio)\//i.test(s);
    }

    function isZipArrayBuffer(ab) {
        if (!ab || ab.byteLength < 4) return false;
        var u = new Uint8Array(ab);
        return u[0] === 0x50 && u[1] === 0x4b && (u[2] === 0x03 || u[2] === 0x05 || u[2] === 0x07) &&
            (u[3] === 0x04 || u[3] === 0x06 || u[3] === 0x08);
    }

    function dataUrlToBinary(dataUrl) {
        if (typeof dataUrl !== 'string') return null;
        var m = /^data:([^,]+),([\s\S]*)$/.exec(dataUrl);
        if (!m) return null;
        var header = m[1];
        var body = m[2].replace(/\s/g, '');
        var mime = header.split(';')[0].trim();
        var isB64 = /;base64/i.test(header);
        if (isB64) {
            try {
                var binary = atob(body);
                var len = binary.length;
                var bytes = new Uint8Array(len);
                for (var i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
                return { mime: mime, bytes: bytes };
            } catch (e) {
                return null;
            }
        }
        try {
            return { mime: mime, bytes: new TextEncoder().encode(decodeURIComponent(body)) };
        } catch (e2) {
            return null;
        }
    }

    function uint8ToBase64Chunked(u8) {
        var CHUNK = 0x8000;
        var str = '';
        for (var i = 0; i < u8.length; i += CHUNK) {
            str += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CHUNK, u8.length)));
        }
        return btoa(str);
    }

    function binaryToDataUrl(mime, u8) {
        return 'data:' + (mime || 'application/octet-stream') + ';base64,' + uint8ToBase64Chunked(u8);
    }

    // 把 Blob 读成 data:URL 字符串（供备份链路承载二进制；分块编码避免大文件内存峰值）
    async function blobToDataUrl(blob) {
        var mime = blob.type || 'application/octet-stream';
        var u8;
        // 优先用 Blob.arrayBuffer()；较老的 Android WebView 不实现该方法，则走 FileReader 兜底，
        // 否则遇到备份里的本地音频 Blob 会抛 "arrayBuffer is not a function"，导致导出在读取阶段直接失败。
        if (typeof blob.arrayBuffer === 'function') {
            u8 = new Uint8Array(await blob.arrayBuffer());
        } else {
            u8 = await blobToUint8Compat(blob);
        }
        return binaryToDataUrl(mime, u8);
    }

    function blobToUint8Compat(blob) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () { resolve(new Uint8Array(r.result)); };
            r.onerror = function () { reject(r.error || new Error('读取 Blob 失败')); };
            r.readAsArrayBuffer(blob);
        });
    }

    // 递归把子树中的 Blob 替换成 data:URL 字符串（原地）
    async function blobToDataUrlTree(node) {
        if (node instanceof Blob) return await blobToDataUrl(node);
        if (Array.isArray(node)) {
            for (var i = 0; i < node.length; i++) node[i] = await blobToDataUrlTree(node[i]);
            return node;
        }
        if (node && typeof node === 'object' && !(node instanceof Date)) {
            for (var k in node) {
                if (Object.prototype.hasOwnProperty.call(node, k)) node[k] = await blobToDataUrlTree(node[k]);
            }
        }
        return node;
    }

    // 恢复时把 audio data:URL 还原成 Blob（保持本地直存，不膨胀体积）
    function dataUrlToBlobTree(node) {
        if (typeof node === 'string' && /^data:audio\//.test(node) && node.length > 120) {
            var m = dataUrlToBinary(node);
            if (m && m.bytes && m.bytes.length) return new Blob([m.bytes], { type: m.mime || 'audio/mpeg' });
            return node;
        }
        if (Array.isArray(node)) {
            var arr = new Array(node.length);
            for (var i = 0; i < node.length; i++) arr[i] = dataUrlToBlobTree(node[i]);
            return arr;
        }
        if (node && typeof node === 'object') {
            var o = {};
            for (var k in node) if (Object.prototype.hasOwnProperty.call(node, k)) o[k] = dataUrlToBlobTree(node[k]);
            return o;
        }
        return node;
    }

    /**
     * 将大树中的 data: 媒体字符串抽离到 store，原处替换为 { __mRef: id }（导入时再展开）
     */
    function extractMediaTree(node, state) {
        if (!state) state = { store: {}, map: new Map(), n: 0 };
        if (node === null || node === undefined) return node;
        if (typeof node === 'string') {
            if (isDataMediaUrl(node)) {
                var id = state.map.get(node);
                if (!id) {
                    id = 'm' + state.n++;
                    state.map.set(node, id);
                    state.store[id] = node;
                }
                return { __mRef: id };
            }
            return node;
        }
        if (Array.isArray(node)) return node.map(function (x) { return extractMediaTree(x, state); });
        if (typeof node === 'object') {
            if (node instanceof Date) return node.toISOString();
            var out = {};
            for (var k in node) {
                if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
                out[k] = extractMediaTree(node[k], state);
            }
            return out;
        }
        return node;
    }

    function inlineMediaTree(node, store) {
        if (!store) store = {};
        if (node === null || node === undefined) return node;
        if (typeof node === 'object' && !Array.isArray(node) && node.__mRef && typeof node.__mRef === 'string') {
            var blob = store[node.__mRef];
            return blob !== undefined && blob !== null ? blob : node;
        }
        if (Array.isArray(node)) return node.map(function (x) { return inlineMediaTree(x, store); });
        if (typeof node === 'object') {
            var o = {};
            for (var k in node) {
                if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
                o[k] = inlineMediaTree(node[k], store);
            }
            return o;
        }
        return node;
    }

    function processLocalStorageValueForExport(str, state) {
        if (str == null) return str;
        if (typeof str !== 'string') return str;
        if (isDataMediaUrl(str)) {
            var id = state.map.get(str);
            if (!id) {
                id = 'm' + state.n++;
                state.map.set(str, id);
                state.store[id] = str;
            }
            return JSON.stringify({ __mRef: id });
        }
        try {
            var parsed = JSON.parse(str);
            var extracted = extractMediaTree(parsed, state);
            return JSON.stringify(extracted);
        } catch (e) {
            return str;
        }
    }

    function processLocalStorageValueForImport(str, store) {
        if (str == null) return str;
        if (typeof str !== 'string') return str;
        try {
            var parsed = JSON.parse(str);
            var inlined = inlineMediaTree(parsed, store);
            // 原值为"裸 data URL 字符串"（非 JSON，例如桌面/顶部栏背景的 active 值、桌面头像）时，
            // 导出被包成 {"__mRef":id}，这里应还原为裸字符串。若再 JSON.stringify 会多加一层引号，
            // 使 `value.indexOf('data:')===0` 之类的判定失效，导致恢复后背景/头像显示不出来。
            if (typeof inlined === 'string' && /^data:(image|video|audio)\//.test(inlined)) return inlined;
            return JSON.stringify(inlined);
        } catch (e) {
            return str;
        }
    }

    function inferBackupSessionId(lfKeys, appPrefix) {
        var pfx = appPrefix || (typeof APP_PREFIX !== 'undefined' ? APP_PREFIX : 'CHAT_APP_V3_');
        var skipParts = ['MIGRATION', 'sessionList', 'lastSessionId', 'customThemes', 'themeSchemes'];
        for (var i = 0; i < lfKeys.length; i++) {
            var sk = lfKeys[i];
            if (!sk || !sk.startsWith(pfx)) continue;
            if (skipParts.some(function (s) { return sk.startsWith(pfx + s); })) continue;
            var after = sk.slice(pfx.length);
            var u = after.indexOf('_');
            if (u > 0) return after.slice(0, u);
        }
        return null;
    }

    function remapLfKey(key, oldSid, newSid, appPrefix) {
        if (!oldSid || !newSid || oldSid === newSid || !key) return key;
        var re = new RegExp(escapeRe(oldSid), 'g');
        return key.replace(re, newSid);
    }

    /** 与 group-chat 导出勾选项一致：未勾选的模块对应键名子串会被排除 */
    function buildModuleSkipPatterns(flags) {
        flags = flags || {};
        var p = [];
        // 桌面挂件"自定义问候/状态池/运势"键当前为按对象命名空间命名，跳过时按其对应对象键模式匹配
        var sKey = function (base) { return (typeof window.appSessionKey === 'function') ? window.appSessionKey(base) : ((typeof window !== 'undefined' && window.APP_PREFIX) ? window.APP_PREFIX : 'CHAT_APP_V3_') + base; };
        if (!flags.inclStickers) p.push('stickerLibrary', 'myStickerLibrary');
        if (!flags.inclThemes) p.push('backgroundGallery', 'chatBackground', 'partnerAvatar', 'myAvatar', 'playerCover');
        if (!flags.inclMsgs) p.push('chatMessages');
        if (!flags.inclSet) p.push('chatSettings', 'partnerPersonas', 'showPartnerNameInChat');
        if (!flags.inclCustom) p.push('customReplies', 'customPokes', 'customStatuses', 'customMottos', 'customIntros', 'customEmojis', 'customReplyGroups', 'customPokeGroups', 'customStatusGroups');
        if (!flags.inclAnn) p.push('anniversaries');
        if (!flags.inclThemes) p.push('customThemes', 'themeSchemes');
        if (!flags.inclDg) p.push(sKey('dg_custom_data'), sKey('dg_status_pool'), sKey('weekly_fortune'), sKey('daily_fortune'), 'customWeather_');
        // 空间：动态 / 相册 / 壁纸 / 纪念日封面与设置（默认纳入，勾选关闭时排除）
        if (flags.inclCS === false) p.push('momentsData', 'albumData', 'csSpaceSettings', 'csWallpaper', 'csWallpaperGallery', 'annMeetOverride', 'annPinnedId', 'annCoverBg_');
        // 娱乐：影院 / 音乐厅 / 自定义音乐（默认纳入，勾选关闭时排除）
        if (flags.inclEnt === false) p.push('_cinema', 'customSongs', '__mh');
        return p;
    }

    function shouldSkipKeyGroupChat(key, flags) {
        if (!key) return true;
        var patterns = buildModuleSkipPatterns(flags || {});
        return patterns.some(function (p) { return key.indexOf(p) !== -1; });
    }

    /**
     * 从当前环境收集备份数据并打包为 v4（紧凑 JSON + mediaStore）
     */
    async function buildBackupPayload(flags) {
        flags = flags || {
            inclMsgs: true, inclSet: true, inclCustom: true, inclAnn: true,
            inclThemes: true, inclDg: true, inclStickers: true, inclCS: true,
            inclEnt: true
        };
        // 指定 onlySession 时只导出该对象命名空间（按角色备份）：${APP_PREFIX}${sid}_ 前缀
        var onlyPfx = null;
        if (flags.onlySession) {
            onlyPfx = (typeof APP_PREFIX !== 'undefined' ? APP_PREFIX : 'CHAT_APP_V3_') + String(flags.onlySession) + '_';
        }
        var lfData = {};
        var keys = await localforage.keys();
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (onlyPfx && key.indexOf(onlyPfx) !== 0) continue;
            if (shouldSkipKeyGroupChat(key, flags)) continue;
            try {
                var rawVal = await localforage.getItem(key);
                if (rawVal === null || rawVal === undefined) continue;
                // 直接使用原值：extractMediaTree 会重建新对象，不做整树 JSON 克隆，
                // 避免超大体量(内联 base64 图片/语音) 出现 数倍内存峰值导致闪退
                lfData[key] = rawVal;
            } catch (e) { console.warn('[backup] 读取失败', key, e); }
        }
        var lsData = {};
        for (var j = 0; j < localStorage.length; j++) {
            var lk = localStorage.key(j);
            if (!lk || (onlyPfx && lk.indexOf(onlyPfx) !== 0) || shouldSkipKeyGroupChat(lk, flags)) continue;
            try {
                lsData[lk] = localStorage.getItem(lk);
            } catch (e2) {}
        }
        var state = { store: {}, map: new Map(), n: 0 };
        var lfOut = {};
        for (var k in lfData) {
            if (!Object.prototype.hasOwnProperty.call(lfData, k)) continue;
            try {
                // 先把 Blob 直存的本地音频等二进制转成 data:URL，交给 extractMediaTree 抽到 mediaStore
                lfData[k] = await blobToDataUrlTree(lfData[k]);
                lfOut[k] = extractMediaTree(lfData[k], state);
            } catch (e) {
                // 单条数据异常（如个别损坏 Blob）不得中断整包导出：跳过该键并告警
                console.warn('[backup] 处理局部数据失败，跳过该键:', k, e);
            }
        }
        var lsOut = {};
        for (var k2 in lsData) {
            if (!Object.prototype.hasOwnProperty.call(lsData, k2)) continue;
            lsOut[k2] = processLocalStorageValueForExport(lsData[k2], state);
        }
        return {
            type: 'chatapp-backup-v4',
            formatVersion: 4,
            appName: 'ChatApp',
            timestamp: new Date().toISOString(),
            sessionId: typeof SESSION_ID !== 'undefined' ? SESSION_ID : null,
            appPrefix: typeof APP_PREFIX !== 'undefined' ? APP_PREFIX : 'CHAT_APP_V3_',
            modules: flags,
            mediaStore: state.store,
            localforage: lfOut,
            localStorage: lsOut
        };
    }

    function serializeBackupV4(payload) {
        var bom = '\uFEFF';
        return bom + JSON.stringify(payload);
    }

    function downloadBlob(blob, fileName) {
        // 优先：全量备份直接保存到手机「下载」目录（无需分享面板选位置）
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ExportPlugin) {
            _saveViaExportPluginStreaming(blob, fileName, function (ok) {
                if (!ok && typeof downloadFileFallback === 'function') downloadFileFallback(blob, fileName);
            });
            return;
        }
        if (typeof downloadFileFallback === 'function') {
            downloadFileFallback(blob, fileName);
            return;
        }
        // Capacitor 环境：使用原生分享
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
            _capacitorShareFile(blob, fileName);
            return;
        }
        // WebView 环境检测：Android WebView 不支持 a.click() 下载
        var isAndroidWebView = /Android/.test(navigator.userAgent) && /wv/.test(navigator.userAgent);
        if (isAndroidWebView) {
            // 尝试通过 navigator.share 分享
            if (navigator.share && navigator.canShare) {
                var file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
                if (navigator.canShare({ files: [file] })) {
                    navigator.share({ files: [file], title: '传讯 - 保存备份' }).catch(function () {
                        _downloadBlobDataUrlFallback(blob, fileName);
                    });
                    return;
                }
            }
            _downloadBlobDataUrlFallback(blob, fileName);
            return;
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    function _saveViaExportPlugin(blob, fileName, onDone) {
        var reader = new FileReader();
        reader.onload = function () {
            var base64Data = reader.result.split(',')[1];
            var mimeType = blob.type || 'application/octet-stream';
            window.Capacitor.Plugins.ExportPlugin.saveBase64({
                data: base64Data,
                fileName: fileName,
                mimeType: mimeType
            }).then(function (result) {
                if (typeof showNotification === 'function') {
                    showNotification('备份已保存到手机「下载/ChuanXun」目录', 'success', 4000);
                }
                if (onDone) onDone(true);
            }).catch(function (error) {
                console.warn('[backup] ExportPlugin 保存失败，回退分享面板:', error);
                if (onDone) onDone(false);
            });
        };
        reader.onerror = function () {
            if (onDone) onDone(false);
        };
        reader.readAsDataURL(blob);
    }

    // ---- 分块流式保存（Android 15 低内存机闪退修复）----
    // 旧 saveBase64 会把整个 Blob 一次性 base64 再交给原生整写：备份越大内存峰值越高，
    // 在部分机型（尤其 Android 15 低内存 WebView）会直接 OOM 闪退。改为分块上传：
    // 前端一次只读一个切片（256KB）转 base64，Native 端 openSave → 多次 writeChunk → finishSave
    // 边收边写，全程峰值内存≈一块大小，不再因大备份崩溃。
    var _BACKUP_CHUNK_BYTES = 256 * 1024; // 256KB 二进制/块

    function _readBlobSliceBase64(blobSlice) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () {
                try { resolve(r.result.split(',')[1]); } catch (e) { reject(e); }
            };
            r.onerror = function () { reject(r.error || new Error('读取分块失败')); };
            r.readAsDataURL(blobSlice);
        });
    }

    async function _saveViaExportPluginStreaming(blob, fileName, onDone) {
        var plugin = (window.Capacitor && window.Capacitor.Plugins)
            ? window.Capacitor.Plugins.ExportPlugin : null;
        if (!plugin) { if (onDone) onDone(false); return; }
        // 旧版本原生插件没有分块方法：回退到一次性 saveBase64
        // 注意：Capacitor 插件是 Proxy，typeof 探测任何方法都返回 function，所以这里不靠 typeof
        // 判定，改为"先试流式，失败即回退"，既兼容旧原生包也避免硬探测误判。
        var mimeType = blob.type || 'application/octet-stream';
        var token = null;
        try {
            var openRes = await plugin.openSave({ fileName: fileName, mimeType: mimeType });
            token = (openRes && openRes.token) || null;
            if (!token) throw new Error('openSave 未返回 token');
            var i = 0;
            while (i < blob.size) {
                var end = Math.min(blob.size, i + _BACKUP_CHUNK_BYTES);
                var b64 = await _readBlobSliceBase64(blob.slice(i, end));
                await plugin.writeChunk({ token: token, data: b64 });
                i = end;
            }
            await plugin.finishSave({ token: token });
            token = null;
            if (typeof showNotification === 'function') {
                showNotification('备份已保存到手机「下载/ChuanXun」目录', 'success', 4000);
            }
            if (onDone) onDone(true);
        } catch (err) {
            console.warn('[backup] 分块导出失败，回退 saveBase64:', err);
            if (token && typeof plugin.abortSave === 'function') {
                try { await plugin.abortSave({ token: token }); } catch (e) {}
            }
            // 回退到一次性 saveBase64（旧原生包或 openSave 因权限等失败时）：原生侧 saveBase64
            // 自带旧系统 WRITE_EXTERNAL_STORAGE 授权流程；成功则视为导出成功。
            _saveViaExportPlugin(blob, fileName, onDone);
        }
    }

    // 把 Blob 真正保存到手机「下载/ChuanXun」目录（MediaStore 写入，文件管理器立即可见），返回 Promise
    function _saveToDevice(blob, fileName) {
        return new Promise(function (resolve, reject) {
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ExportPlugin) {
                _saveViaExportPluginStreaming(blob, fileName, function (ok) {
                    if (ok) {
                        if (typeof showNotification === 'function') {
                            showNotification('备份已保存到手机「下载/ChuanXun」目录', 'success', 4000);
                        }
                        resolve();
                    } else {
                        // 原生保存（流式 + saveBase64）均失败：兜底走系统分享/浏览器下载，保证文件不丢。
                        // Capacitor 下 downloadFileFallback 走分享面板或系统下载，用户可自行选位置。
                        // 注意不要回退到 downloadBlob——它在 Capacitor+ExportPlugin 下会再次进入流式保存，形成重复尝试。
                        console.warn('[backup] ExportPlugin 保存失败，回退系统分享/下载');
                        try {
                            if (typeof downloadFileFallback === 'function') {
                                downloadFileFallback(blob, fileName);
                                resolve();
                            } else {
                                reject(new Error('保存失败且无兜底函数 downloadFileFallback'));
                            }
                        } catch (fbErr) {
                            reject(new Error('保存失败且兜底也未成功: ' + (fbErr && fbErr.message)));
                        }
                    }
                });
                return;
            }
            // 兜底：走通用下载（浏览器环境或缺少插件时）
            try {
                downloadBlob(blob, fileName);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }

    function _capacitorSaveAndShare(blob, fileName) {
        // 使用 Filesystem 插件将文件写入缓存目录，然后分享
        var fs = _getFilesystemPlugin();
        if (!fs) {
            console.warn('[backup] Filesystem 插件未找到，回退到旧方案');
            _capacitorShareFallback(blob, fileName);
            return;
        }

        var reader = new FileReader();
        reader.onload = function () {
            var base64Data = reader.result.split(',')[1];
            var filePath = 'backups/' + fileName;

            fs.writeFile({
                path: filePath,
                data: base64Data,
                directory: 'CACHE',
                recursive: true
            }).then(function (writeResult) {
                console.log('[backup] 文件已写入:', writeResult.uri);
                // 获取文件 URI 并分享
                return fs.getUri({ path: filePath, directory: 'CACHE' });
            }).then(function (uriResult) {
                console.log('[backup] 文件 URI:', uriResult.uri);
                // 使用 Share 插件分享文件（files 携带本地 URI 真实分享文件内容；
                // 仅 url: 会把本地 file:// 当链接分享，接收端常得到空文件/无法打开）
                if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
                    var shareOpts = {
                        title: '传讯 - 保存备份',
                        text: '备份文件：' + fileName,
                        dialogTitle: '保存备份文件'
                    };
                    if (uriResult && uriResult.uri) shareOpts.files = [uriResult.uri];
                    return window.Capacitor.Plugins.Share.share(shareOpts);
                }
                // 回退：用 navigator.share
                var file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
                if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                    return navigator.share({ files: [file], title: '传讯 - 保存备份', text: '备份文件：' + fileName });
                }
                throw new Error('无可用分享方式');
            }).then(function () {
                if (typeof showNotification === 'function') showNotification('备份已导出，请选择保存位置', 'success', 4000);
            }).catch(function (e) {
                console.warn('[backup] 保存分享失败:', e);
                // 最终回退：尝试用旧方案
                _capacitorShareFallback(blob, fileName);
            });
        };
        reader.onerror = function () {
            _capacitorShareFallback(blob, fileName);
        };
        reader.readAsDataURL(blob);
    }

    function _getFilesystemPlugin() {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
            return window.Capacitor.Plugins.Filesystem;
        }
        return null;
    }

    function _capacitorShareFile(blob, fileName) {
        // 优先使用 Filesystem 写入文件（真正保存到设备）
        if (_getFilesystemPlugin()) {
            _capacitorSaveAndShare(blob, fileName);
            return;
        }

        // 回退：Web Share API
        var file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({
                files: [file],
                title: '传讯 - 保存备份',
                text: '备份文件：' + fileName
            }).then(function () {
                if (typeof showNotification === 'function') showNotification('备份已导出', 'success');
            }).catch(function (e) {
                console.warn('[backup] Web Share 失败，尝试其他方式', e);
                _capacitorShareFallback(blob, fileName);
            });
            return;
        }
        _capacitorShareFallback(blob, fileName);
    }

    function _capacitorShareFallback(blob, fileName) {
        // 回退1：Capacitor Share 插件
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
            var reader = new FileReader();
            reader.onload = function () {
                window.Capacitor.Plugins.Share.share({
                    title: '传讯 - 保存备份',
                    text: '备份文件：' + fileName,
                    url: 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + reader.result.split(',')[1],
                    dialogTitle: '保存备份文件'
                }).then(function () {
                    if (typeof showNotification === 'function') showNotification('备份已导出', 'success');
                }).catch(function (e) {
                    console.warn('[backup] Capacitor Share 失败', e);
                    _downloadBlobDataUrlFallback(blob, fileName);
                });
            };
            reader.readAsDataURL(blob);
            return;
        }
        _downloadBlobDataUrlFallback(blob, fileName);
    }

    function _downloadBlobDataUrlFallback(blob, fileName) {
        var reader = new FileReader();
        reader.onload = function () {
            var dataUrl = reader.result;
            if (window.Android && typeof window.Android.downloadFile === 'function') {
                window.Android.downloadFile(dataUrl, fileName, blob.type);
                return;
            }
            var w = window.open(dataUrl, '_blank');
            if (!w && typeof showNotification === 'function') {
                showNotification('无法下载文件，请尝试在浏览器中打开', 'warning', 3000);
            }
        };
        reader.readAsDataURL(blob);
    }

    /**
     * 从 ZIP 解析备份（v5）；若包内为旧版单 JSON（仅改扩展名等）则按其中 JSON 原样返回。
     */
    async function parseZipBackup(arrayBuffer) {
        if (typeof JSZip === 'undefined') throw new Error('JSZip 未加载，无法读取 ZIP 备份，请检查网络后刷新页面');
        var zip = await JSZip.loadAsync(arrayBuffer);
        var jsonFile = zip.file('backup.json');
        if (!jsonFile) {
            var names = Object.keys(zip.files).filter(function (n) {
                var e = zip.files[n];
                return e && !e.dir && /\.json$/i.test(n);
            });
            if (names.length === 1) jsonFile = zip.file(names[0]);
        }
        if (!jsonFile) throw new Error('ZIP 内未找到 backup.json');
        var raw = await jsonFile.async('string');
        if (raw.length && raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        var data = JSON.parse(raw);
        var idx = data.mediaIndex;
        if (data.formatVersion === 5 && data.type === 'chatapp-backup-v5' && idx && typeof idx === 'object') {
            var built = {};
            var ids = Object.keys(idx);
            for (var i = 0; i < ids.length; i++) {
                var id = ids[i];
                var meta = idx[id];
                var path = (meta && meta.path) ? meta.path : ('media/' + id);
                var zf = zip.file(path);
                if (!zf) {
                    console.warn('[backup] ZIP 缺少媒体文件', path);
                    continue;
                }
                try {
                    var mimeMeta = (meta && meta.mime) ? meta.mime : 'application/octet-stream';
                    if (mimeMeta === 'text/plain+dataurl') {
                        built[id] = await zf.async('string');
                    } else {
                        var ab = await zf.async('arraybuffer');
                        built[id] = binaryToDataUrl(mimeMeta, new Uint8Array(ab));
                    }
                } catch (e) {
                    // 单个媒体文件损坏/读取失败时跳过该文件，不中断整包导入（文字数据照常恢复）
                    console.warn('[backup] ZIP 媒体文件读取失败，跳过', path, e);
                }
            }
            var ms = data.mediaStore || {};
            for (var k in ms) {
                if (Object.prototype.hasOwnProperty.call(ms, k) && built[k] == null) built[k] = ms[k];
            }
            data.mediaStore = built;
        }
        return data;
    }

    async function loadBackupFromArrayBuffer(ab) {
        if (isZipArrayBuffer(ab)) return await parseZipBackup(ab);
        var text = new TextDecoder('utf-8', { fatal: false }).decode(ab);
        if (text.length && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        return JSON.parse(text);
    }

    async function loadBackupFromFile(file) {
        var ab = await file.arrayBuffer();
        return await loadBackupFromArrayBuffer(ab);
    }

    function _isCapacitorEnv() {
        return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share);
    }

    async function exportBackupToFile(flags, progress) {
        progress = progress || function () {};
        // 进度回调：0-100，仅在有效阶段上报
        var report = function (pct, label) {
            try { progress(Math.max(0, Math.min(100, pct)), label || ''); } catch (e) {}
        };

        if (typeof showNotification === 'function') showNotification('正在打包备份（ZIP：结构与媒体分离）…', 'info', 4000);
        report(8, '正在读取本地数据…');
        var payload = await buildBackupPayload(flags);
        report(35, '数据读取完成，正在打包 ZIP…');
        var dateStr = new Date().toISOString().slice(0, 10);
        var fileNameBase = flags.fileNameBase || 'chatapp-backup';
        var shareTitle = flags.shareTitle || '传讯全量备份';
        var fileNameZip = fileNameBase + '-' + dateStr + '.zip';

        if (typeof JSZip !== 'undefined') {
            try {
                var zip = new JSZip();
                var store = payload.mediaStore || {};
                var mediaIndex = {};
                var totalMedia = 0;
                for (var sid in store) {
                    if (!Object.prototype.hasOwnProperty.call(store, sid)) continue;
                    totalMedia++;
                }
                var doneMedia = 0;
                for (var sid2 in store) {
                    if (!Object.prototype.hasOwnProperty.call(store, sid2)) continue;
                    var url = store[sid2];
                    var parts = dataUrlToBinary(url);
                    var path = 'media/' + sid2;
                    if (parts && parts.bytes && parts.bytes.length) {
                        zip.file(path, parts.bytes, { binary: true });
                        mediaIndex[sid2] = { path: path, mime: parts.mime };
                    } else {
                        var txtPath = path + '.txt';
                        zip.file(txtPath, String(url));
                        mediaIndex[sid2] = { path: txtPath, mime: 'text/plain+dataurl' };
                    }
                    doneMedia++;
                    // 媒体压缩阶段：35% → 60%
                    report(35 + Math.round(25 * doneMedia / (totalMedia || 1)), '正在压缩媒体文件…');
                }
                var jsonBody = {
                    type: 'chatapp-backup-v5',
                    formatVersion: 5,
                    appName: payload.appName || 'ChatApp',
                    timestamp: payload.timestamp,
                    sessionId: payload.sessionId,
                    appPrefix: payload.appPrefix,
                    modules: payload.modules,
                    localforage: payload.localforage,
                    localStorage: payload.localStorage,
                    mediaIndex: mediaIndex
                };
                zip.file('backup.json', '\uFEFF' + JSON.stringify(jsonBody));
                report(65, '正在生成 ZIP 压缩包…');
                var zipBlob = await zip.generateAsync({
                    type: 'blob',
                    compression: 'DEFLATE',
                    compressionOptions: { level: 6 }
                }, function (meta) {
                    // 压缩阶段：65% → 88%
                    if (meta && typeof meta.percent === 'number') {
                        report(65 + Math.round(23 * meta.percent / 100), '正在压缩文件…');
                    }
                });
                // Capacitor 环境：直接保存到手机「下载/ChuanXun」目录（文件管理器可见）
                if (_isCapacitorEnv()) {
                    report(92, '正在保存到手机「下载/ChuanXun」…');
                    await _saveToDevice(zipBlob, fileNameZip);
                    report(100, '保存完成');
                    return;
                }
                if (navigator.share && /Mobile|Android|iPhone|iPad/.test(navigator.userAgent)) {
                    try {
                        var shareFile = new File([zipBlob], fileNameZip, { type: 'application/zip' });
                        if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
                            await navigator.share({
                                files: [shareFile],
                                title: shareTitle,
                                text: 'ZIP 备份：' + new Date().toLocaleDateString()
                            });
                            report(100, '备份导出成功');
                            if (typeof showNotification === 'function') showNotification('备份导出成功', 'success');
                            return;
                        }
                    } catch (e) { /* fall through */ }
                }
                downloadBlob(zipBlob, fileNameZip);
                report(100, '备份导出成功');
                if (typeof showNotification === 'function') {
                    showNotification('已导出 ZIP：主 JSON 不含大图，导入更不易失败', 'success', 3500);
                }
                return;
            } catch (zipErr) {
                console.error('[backup] ZIP 导出失败，回退单文件 JSON', zipErr);
                if (typeof showNotification === 'function') {
                    showNotification('ZIP 打包失败，已改为单文件 JSON（大备份可能较难解析）', 'warning', 4500);
                }
            }
        } else if (typeof showNotification === 'function') {
            showNotification('JSZip 未加载，将导出单文件 JSON', 'warning', 3000);
        }

        var str = serializeBackupV4(payload);
        var blob = new Blob([str], { type: 'application/json;charset=utf-8' });
        var fileName = fileNameBase + '-' + dateStr + '.json';
        // Capacitor 环境：直接保存到手机「下载/ChuanXun」目录（文件管理器可见）
        if (_isCapacitorEnv()) {
            report(92, '正在保存到手机「下载/ChuanXun」…');
            await _saveToDevice(blob, fileName);
            report(100, '保存完成');
            return;
        }
        if (navigator.share && /Mobile|Android|iPhone|iPad/.test(navigator.userAgent)) {
            try {
                var f = new File([blob], fileName, { type: 'application/json' });
                if (navigator.canShare && navigator.canShare({ files: [f] })) {
                    await navigator.share({ files: [f], title: '传讯全量备份', text: '备份日期：' + new Date().toLocaleDateString() });
                    report(100, '备份导出成功');
                    if (typeof showNotification === 'function') showNotification('备份导出成功', 'success');
                    return;
                }
            } catch (e2) { /* fall through */ }
        }
        downloadBlob(blob, fileName);
        report(100, '备份导出成功');
        if (typeof showNotification === 'function') showNotification('备份导出成功（JSON）', 'success');
    }

    function getLfSource(data) {
        if (!data || typeof data !== 'object') return {};
        var a = data.indexedDB || {};
        var b = data.localforage || {};
        var out = {};
        for (var k in a) {
            if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
        }
        for (var k2 in b) {
            if (Object.prototype.hasOwnProperty.call(b, k2)) out[k2] = b[k2];
        }
        return out;
    }

    function matchAnyNeedles(key, needles) {
        if (!key || !needles || !needles.length) return false;
        for (var i = 0; i < needles.length; i++) {
            if (key.indexOf(needles[i]) !== -1) return true;
        }
        return false;
    }

    function matchLsKey(key, cat) {
        if (!cat) return false;
        if (cat.localStorageNeedles && matchAnyNeedles(key, cat.localStorageNeedles)) return true;
        if (cat.localStoragePrefixes && cat.localStoragePrefixes.some(function (p) { return key.indexOf(p) === 0; })) return true;
        return false;
    }

    function filterLfByCategories(lf, selectedIds, categories) {
        if (!selectedIds || !selectedIds.length) return {};
        var selected = categories.filter(function (c) { return selectedIds.indexOf(c.id) !== -1; });
        var out = {};
        for (var k in lf) {
            if (!Object.prototype.hasOwnProperty.call(lf, k)) continue;
            var ok = selected.some(function (c) { return matchAnyNeedles(k, c.indexedDBNeedles); });
            if (ok) out[k] = lf[k];
        }
        return out;
    }

    function filterLsByCategories(ls, selectedIds, categories) {
        if (!selectedIds || !selectedIds.length) return {};
        var selected = categories.filter(function (c) { return selectedIds.indexOf(c.id) !== -1; });
        var out = {};
        for (var k in ls) {
            if (!Object.prototype.hasOwnProperty.call(ls, k)) continue;
            var ok = selected.some(function (c) { return matchLsKey(k, c); });
            if (ok) out[k] = ls[k];
        }
        return out;
    }

    /**
     * 将备份写入存储（已解析的对象）
     * @param {object} data 原始备份 JSON
     * @param {{ selective?: boolean, selectedCategoryIds?: string[], categories?: array }} opt
     */
    async function applyBackupToStorage(data, opt) {
        opt = opt || {};
        var selective = !!opt.selective;
        // 覆盖写盘前的安全网：先生成一份"操作前"完整快照（恢复回滚时跳过，避免自相覆盖）
        if (!window._restoringRollback) {
            try { await _makeRollbackSnapshot('导入/恢复'); } catch (e) {}
        }
        var mediaStore = data.mediaStore || {};
        var lfRaw = getLfSource(data);
        var lsRaw = data.localStorage || {};

        if (selective && opt.selectedCategoryIds && opt.categories) {
            // 全选（未做取舍）时不按分类 needle 过滤，完整恢复文件中的所有键，避免白名单外内容丢失
            if (opt.selectedCategoryIds.length < opt.categories.length) {
                lfRaw = filterLfByCategories(lfRaw, opt.selectedCategoryIds, opt.categories);
                lsRaw = filterLsByCategories(lsRaw, opt.selectedCategoryIds, opt.categories);
            }
        }

        var lfKeys = Object.keys(lfRaw);
        var backupSid = data.sessionId || inferBackupSessionId(lfKeys, data.appPrefix);
        var curSid = typeof SESSION_ID !== 'undefined' ? SESSION_ID : null;
        var appPfx = data.appPrefix || (typeof APP_PREFIX !== 'undefined' ? APP_PREFIX : 'CHAT_APP_V3_');
        var needRemap = backupSid && curSid && backupSid !== curSid;

        for (var i = 0; i < lfKeys.length; i++) {
            var lk = lfKeys[i];
            var targetKey = needRemap ? remapLfKey(lk, backupSid, curSid, appPfx) : lk;
            var val = inlineMediaTree(lfRaw[lk], mediaStore);
            // 自定义歌单里的本地直存音频：把 data:URL 还原成 Blob，保持本地直存
            if (targetKey && targetKey.indexOf('customSongs') !== -1) val = dataUrlToBlobTree(val);
            try {
                await localforage.setItem(targetKey, val);
            } catch (e) {
                console.warn('[backup] 写入失败', targetKey, e);
            }
        }

        for (var k in lsRaw) {
            if (!Object.prototype.hasOwnProperty.call(lsRaw, k)) continue;
            var targetLsKey = needRemap ? remapLfKey(k, backupSid, curSid, appPfx) : k;
            try {
                var lsv = processLocalStorageValueForImport(lsRaw[k], mediaStore);
                // 不再因“是较长 data URL”而整条丢弃：先尝试写入，仅在实际写失败（如超出配额）时才跳过该项
                if (typeof lsv === 'string' && (/^data:(image|video|audio)\//.test(lsv)) && lsv.length > 2000) {
                    try {
                        localStorage.setItem(targetLsKey, lsv);
                    } catch (qerr) {
                        console.warn('[backup] localStorage 媒体过大，跳过', targetLsKey, qerr);
                    }
                    continue;
                }
                localStorage.setItem(targetLsKey, lsv);
            } catch (e2) {
                console.warn('[backup] localStorage 恢复失败', targetLsKey, e2);
            }
        }

        // 修复 sessionList 中的会话 ID：键已被 remap，但值里的 id 字段还是旧 sessionId
        if (needRemap) {
            try {
                var slKey = appPfx + 'sessionList';
                var sl = await localforage.getItem(slKey);
                if (Array.isArray(sl)) {
                    var remappedSl = sl.map(function(s) {
                        if (s && s.id === backupSid) {
                            var copy = {};
                            for (var p in s) { if (Object.prototype.hasOwnProperty.call(s, p)) copy[p] = s[p]; }
                            copy.id = curSid;
                            return copy;
                        }
                        return s;
                    });
                    await localforage.setItem(slKey, remappedSl);
                }
            } catch (e4) {}
        }

        if (typeof APP_PREFIX !== 'undefined' && typeof SESSION_ID !== 'undefined') {
            try { await localforage.setItem(APP_PREFIX + 'lastSessionId', SESSION_ID); } catch (e3) {}
        }
    }

    // ===== 自动回滚快照 =====
    // 无论"更新覆盖"、"云同步覆盖"还是"导入/恢复"，任何覆盖写盘前都会先生成一份完整本地快照，
    // 存入独立的 IndexedDB 快照槽（保留最近 2 份），即使后续操作/更新导致数据丢失，也能一键找回。
    // 独立前缀（不以 APP_PREFIX 开头），这样"云同步覆盖到本地"在清空 CHAT_APP 前缀 key 时不会把快照一起清掉
    var ROLLBACK_PREFIX = '__rollback_';

    function _appPfx() {
        return (typeof APP_PREFIX !== 'undefined') ? APP_PREFIX : 'CHAT_APP_V3_';
    }

    async function _makeRollbackSnapshot(reason) {
        try {
            var lfMap = {};
            var allKeys = await localforage.keys();
            for (var i = 0; i < allKeys.length; i++) {
                var k = allKeys[i];
                if (k.indexOf(ROLLBACK_PREFIX) === 0) continue; // 快照槽不嵌套进快照
                try { lfMap[k] = await localforage.getItem(k); } catch (e) {}
            }
            var lsMap = {};
            for (var j = 0; j < localStorage.length; j++) {
                var lk = localStorage.key(j);
                try { lsMap[lk] = localStorage.getItem(lk); } catch (e) {}
            }
            var slotKey = ROLLBACK_PREFIX + Date.now();
            var payload = {
                formatVersion: 5,
                type: 'chatapp-backup-v5',
                appPrefix: _appPfx(),
                sessionId: (typeof SESSION_ID !== 'undefined') ? SESSION_ID : undefined,
                t: Date.now(),
                reason: reason || '操作前',
                indexedDB: lfMap,
                localStorage: lsMap
            };
            await localforage.setItem(slotKey, payload);
            // 只保留最近 2 份，避免无限膨胀
            var prefix = ROLLBACK_PREFIX;
            var all2 = await localforage.keys();
            var mine = all2.filter(function (x) { return x.indexOf(prefix) === 0; }).sort();
            while (mine.length > 2) { try { await localforage.removeItem(mine[0]); } catch (e) {} mine.shift(); }
            console.log('[rollback] 已生成操作前快照:', reason || '操作前', slotKey);
            return slotKey;
        } catch (e) {
            console.warn('[rollback] 快照失败:', e);
            return null;
        }
    }

    // 快照是否属于当前对象：跨对象守卫。切换对象后，每个对象的自动快照会混在同一个 ROLLBACK_PREFIX 桶里，
    // 若不校验，"恢复上一步"会列出别的对象的快照；恢复时 applyBackupToStorage 又会按旧 sessionId 重映射，
    // 等于把对象 A 的数据改写成对象 B 的命名空间（跨对象污染）。因此只认当前对象的快照；
    // 无 sessionId 的旧版快照（单对象时期）视为归属当前，仍可恢复。
    function _rollbackSessionMatches(p) {
        if (!p) return false;
        if (typeof SESSION_ID !== 'undefined' && SESSION_ID && p.sessionId) {
            return p.sessionId === SESSION_ID;
        }
        return true;
    }

    async function _listRollbackSnapshots() {
        var prefix = ROLLBACK_PREFIX;
        var all = await localforage.keys();
        var out = [];
        for (var i = 0; i < all.length; i++) {
            if (all[i].indexOf(prefix) === 0) {
                var p = null;
                try { p = await localforage.getItem(all[i]); } catch (e) {}
                if (p && _rollbackSessionMatches(p)) out.push({ key: all[i], t: (p.t || 0), reason: (p.reason || '操作前') });
            }
        }
        out.sort(function (a, b) { return b.t - a.t; });
        return out;
    }

    async function _restoreRollbackSnapshot(slotKey) {
        var payload = await localforage.getItem(slotKey);
        if (!payload) throw new Error('快照不存在或已被清理');
        // 双保险：即使绕过列表直接调用，也禁止把非当前对象的快照恢复进当前对象
        if (!_rollbackSessionMatches(payload)) {
            throw new Error('该快照属于其他对象，请先切换到对应对象后再恢复');
        }
        window._restoringRollback = true;
        // 复用统一的恢复写盘逻辑（含 session remap、_importGuarded 守卫）
        await applyBackupToStorage(payload, {});
        window._importGuarded = true;
        try {
            localStorage.removeItem('BACKUP_V1_critical');
            localStorage.removeItem('BACKUP_V1_timestamp');
            localStorage.removeItem('_cdRecLogs');
        } catch (e) {}
        return slotKey;
    }

    function isFullBackupShape(d) {
        if (!d || typeof d !== 'object') return false;
        if (d.formatVersion === 5 && d.type === 'chatapp-backup-v5') return true;
        if (d.formatVersion === 4 && d.type === 'chatapp-backup-v4') return true;
        if (d.type === 'full' || (typeof d.type === 'string' && d.type.indexOf('full-backup') !== -1)) return true;
        if (d.indexedDB && typeof d.indexedDB === 'object') return true;
        if (d.localforage && typeof d.localforage === 'object') return true;
        return false;
    }

    global.ChatBackup = {
        MIN_MEDIA_CHARS: MIN_MEDIA_CHARS,
        extractMediaTree: extractMediaTree,
        inlineMediaTree: inlineMediaTree,
        buildBackupPayload: buildBackupPayload,
        exportBackupToFile: exportBackupToFile,
        loadBackupFromFile: loadBackupFromFile,
        loadBackupFromArrayBuffer: loadBackupFromArrayBuffer,
        applyBackupToStorage: applyBackupToStorage,
        makeRollbackSnapshot: _makeRollbackSnapshot,
        listRollbackSnapshots: _listRollbackSnapshots,
        restoreRollbackSnapshot: _restoreRollbackSnapshot,
        serializeBackupV4: serializeBackupV4,
        getLfSource: getLfSource,
        isFullBackupShape: isFullBackupShape,
        shouldSkipKeyGroupChat: shouldSkipKeyGroupChat,
        buildModuleSkipPatterns: buildModuleSkipPatterns
    };
})(typeof window !== 'undefined' ? window : this);
