/**
 * cloud-media.js — 阶段三：图片/媒体云端存储模块
 *
 * 职责：
 *   - 图片上传到 OSS（自动生成缩略图存本地）
 *   - 按需从 OSS 下载图片
 *   - 图片元素懒加载（滚动到才加载）
 *   - 缓存管理（避免重复下载）
 *   - 旧数据迁移（base64 → OSS URL）
 *
 * 数据分层：
 *   1) 头像（partnerAvatar / myAvatar）：本地全尺寸 + 云端全尺寸（双保存）
 *   2) 背景图库：本地缩略图 + 云端全尺寸
 *   3) 聊天图片、贴纸库、陪伴背景、日记背景：仅云端 URL，按需加载
 *
 * 云端路径：
 *   - media/<SESSION_ID>/<category>/<id>.<ext>
 *   - 例如：media/mqjndirn8xxx/chat-images/img_001.png
 */
(function (global) {
    'use strict';

    var APP_PREFIX_STR = (typeof APP_PREFIX !== 'undefined' ? APP_PREFIX : 'CHAT_APP_V3_');

    // ==== 缩略图生成 ====
    /**
     * 从 base64 或 File 生成缩略图（宽度 200px）
     * @param {string|File|Blob} source
     * @param {number} maxWidth
     * @returns {Promise<string>} base64 缩略图
     */
    async function makeThumbnail(source, maxWidth) {
        maxWidth = maxWidth || 200;
        var dataUrl;
        if (typeof source === 'string') {
            dataUrl = source;
        } else if (source instanceof Blob) {
            dataUrl = await _blobToBase64(source);
        } else {
            throw new Error('缩略图源类型不支持');
        }
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () {
                var ratio = maxWidth / img.width;
                if (ratio >= 1) {
                    // 图片本来就小，直接返回原图
                    resolve(dataUrl);
                    return;
                }
                var canvas = document.createElement('canvas');
                canvas.width = maxWidth;
                canvas.height = Math.round(img.height * ratio);
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                try {
                    // 用 jpeg 压缩到 0.75 质量，一般 10-30KB
                    resolve(canvas.toDataURL('image/jpeg', 0.75));
                } catch (e) {
                    reject(e);
                }
            };
            img.onerror = function () { reject(new Error('图片加载失败')); };
            img.src = dataUrl;
        });
    }

    function _blobToBase64(blob) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () { resolve(r.result); };
            r.onerror = function () { reject(new Error('读取文件失败')); };
            r.readAsDataURL(blob);
        });
    }

    function _base64ToBlob(base64) {
        var match = /^data:([^;]+);base64,(.+)$/.exec(base64);
        if (!match) return null;
        var mime = match[1];
        var b64 = match[2];
        var binary = atob(b64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        // 用 magic bytes 修正 mime，防止浏览器把 GIF/PNG 文件误报为 image/jpeg
        if (bytes.length >= 6 &&
            bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
            mime = 'image/gif'; // GIF87a / GIF89a
        } else if (bytes.length >= 4 &&
            bytes[0] === 0x89 && bytes[1] === 0x50 &&
            bytes[2] === 0x4E && bytes[3] === 0x47) {
            mime = 'image/png'; // PNG
        } else if (bytes.length >= 4 &&
            bytes[0] === 0x52 && bytes[1] === 0x49 &&
            bytes[2] === 0x46 && bytes[3] === 0x46) {
            mime = 'image/webp'; // WEBP (RIFF header)
        }
        return new Blob([bytes], { type: mime });
    }

    function _extFromMime(mime) {
        var map = {
            'image/jpeg': 'jpg', 'image/jpg': 'jpg',
            'image/png': 'png', 'image/gif': 'gif',
            'image/webp': 'webp', 'image/svg+xml': 'svg',
            // 视频
            'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
            'video/x-m4v': 'm4v', 'video/avi': 'avi', 'video/x-matroska': 'mkv',
            // 音频
            'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
            'audio/wav': 'wav', 'audio/x-wav': 'wav',
            'audio/webm': 'webm', 'audio/ogg': 'ogg',
            'audio/aac': 'aac', 'audio/x-aac': 'aac',
            'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
            'audio/flac': 'flac', 'audio/x-flac': 'flac',
            'audio/amr': 'amr',
        };
        if (map[mime]) return map[mime];
        // 兜底：从 mime 子类型里提取（如 audio/x-foo → foo）
        var sub = mime.split('/')[1];
        if (sub) return sub.replace(/^x-/, '').split(';')[0].trim() || 'bin';
        return 'bin';
    }

    function _generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    // ==== 云端上传 ====
    /**
     * 上传媒体到云端
     * @param {string|Blob} source  base64 字符串或 Blob
     * @param {string} category  分类（如 'chat-images', 'backgrounds', 'stickers'）
     * @param {string} [id]  可选：指定 ID，否则自动生成
     * @returns {Promise<{url: string, key: string, id: string, size: number}>}
     */
    async function uploadMedia(source, category, id) {
        if (!window.CloudSync || !window.CloudSync.isConnected()) {
            throw new Error('未连接云端');
        }
        var cfg = window.CloudSync.getConfig();
        var sid = (typeof SESSION_ID !== 'undefined' && SESSION_ID) ? SESSION_ID : 'default';

        var blob;
        if (typeof source === 'string') {
            blob = _base64ToBlob(source);
            if (!blob) throw new Error('base64 格式错误');
        } else if (source instanceof Blob) {
            blob = source;
        } else {
            throw new Error('上传源类型不支持');
        }

        var ext = _extFromMime(blob.type);
        id = id || _generateId();
        var objectKey = 'media/' + sid + '/' + category + '/' + id + '.' + ext;

        var contentType = blob.type || 'application/octet-stream';
        // 大文件需要更长的签名有效期（每 10MB 预留 60 秒，最少 120 秒，最多 600 秒）
        var fileMB = blob.size / 1024 / 1024;
        var expiresSeconds = Math.min(Math.max(Math.ceil(fileMB / 10) * 60, 120), 600);
        var url = await window.CloudSync.buildSignedUrl(cfg, 'PUT', objectKey, {}, contentType, expiresSeconds);

        // 大文件给足超时时间（每 MB 预留 3 秒，最少 30 秒，最多 10 分钟）
        var timeoutMs = Math.min(Math.max(blob.size / 1024 / 1024 * 3000, 30000), 600000);
        var controller = new AbortController();
        var timeoutId = setTimeout(function () { controller.abort(); }, timeoutMs);

        var res;
        try {
            res = await fetch(url, { method: 'PUT', body: blob, signal: controller.signal });
        } finally {
            clearTimeout(timeoutId);
        }
        if (!res.ok) {
            var text = '';
            try { text = await res.text(); } catch (e) {}
            throw new Error('上传失败 HTTP ' + res.status + (text ? ' - ' + text.slice(0, 200) : ''));
        }

        // 生成永久访问 URL（后续下载时会重新签名）
        return {
            url: 'oss://' + objectKey,   // 内部标识，实际访问时会解析成签名 URL
            key: objectKey,
            id: id,
            size: blob.size
        };
    }

    // ==== 云端下载 ====
    // 内存缓存：objectKey -> objectURL（blob:）
    var _mediaCache = new Map();
    var _pendingFetches = new Map();

    /**
     * 从云端下载媒体，返回可直接用于 <img src> 的 blob URL
     * @param {string} ref  内部引用（"oss://media/xxx" 或 objectKey）
     * @returns {Promise<string>} blob URL
     */
    async function fetchMediaUrl(ref) {
        if (!ref) throw new Error('无媒体引用');
        var objectKey = ref.indexOf('oss://') === 0 ? ref.slice(6) : ref;

        // 缓存命中
        if (_mediaCache.has(objectKey)) return _mediaCache.get(objectKey);
        // 正在下载中
        if (_pendingFetches.has(objectKey)) return _pendingFetches.get(objectKey);

        var promise = (async function () {
            if (!window.CloudSync || !window.CloudSync.isConnected()) {
                throw new Error('未连接云端');
            }
            var cfg = window.CloudSync.getConfig();
            var url = await window.CloudSync.buildSignedUrl(cfg, 'GET', objectKey, {});
            var res = await fetch(url);
            if (!res.ok) throw new Error('下载失败 HTTP ' + res.status);
            var blob = await res.blob();
            var blobUrl = URL.createObjectURL(blob);
            _mediaCache.set(objectKey, blobUrl);
            return blobUrl;
        })();

        _pendingFetches.set(objectKey, promise);
        try {
            return await promise;
        } finally {
            _pendingFetches.delete(objectKey);
        }
    }

    /**
     * 判断一个值是否是我们的云端引用格式
     */
    function isCloudRef(value) {
        return typeof value === 'string' && value.indexOf('oss://') === 0;
    }

    // ==== 云端删除 ====
    /**
     * 从云端删除对象
     * @param {string} refOrKey  'oss://media/xxx' 或 objectKey 'media/xxx'
     * @returns {Promise<boolean>} 成功返回 true
     */
    async function deleteMedia(refOrKey) {
        if (!refOrKey) return false;
        if (!window.CloudSync || !window.CloudSync.isConnected()) {
            throw new Error('未连接云端');
        }
        var objectKey = refOrKey.indexOf('oss://') === 0 ? refOrKey.slice(6) : refOrKey;
        var cfg = window.CloudSync.getConfig();
        var url = await window.CloudSync.buildSignedUrl(cfg, 'DELETE', objectKey, {});
        var res = await fetch(url, { method: 'DELETE' });
        // OSS DELETE 成功返回 204，即使对象不存在也返回 204
        if (!res.ok && res.status !== 204 && res.status !== 404) {
            var text = '';
            try { text = await res.text(); } catch (e) {}
            throw new Error('删除失败 HTTP ' + res.status + (text ? ' - ' + text.slice(0, 200) : ''));
        }
        // 清理内存缓存
        if (_mediaCache.has(objectKey)) {
            try { URL.revokeObjectURL(_mediaCache.get(objectKey)); } catch (e) {}
            _mediaCache.delete(objectKey);
        }
        return true;
    }

    /**
     * 判断是否是 base64
     */
    function isBase64(value) {
        return typeof value === 'string' && value.indexOf('data:') === 0;
    }

    // ==== 懒加载图片元素 ====
    var _lazyObserver = null;

    function _ensureObserver() {
        if (_lazyObserver) return _lazyObserver;
        if (!('IntersectionObserver' in window)) return null;
        _lazyObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var img = entry.target;
                _lazyObserver.unobserve(img);
                var ref = img.getAttribute('data-cloud-ref');
                if (!ref) return;
                _loadImageElement(img, ref);
            });
        }, { rootMargin: '200px' });
        return _lazyObserver;
    }

    async function _loadImageElement(img, ref) {
        img.classList.add('cloud-media-loading');
        try {
            var blobUrl = await fetchMediaUrl(ref);
            img.src = blobUrl;
            img.classList.remove('cloud-media-loading');
            img.classList.remove('cloud-media-pending');
            img.classList.add('cloud-media-loaded');
        } catch (e) {
            img.classList.remove('cloud-media-loading');
            img.classList.remove('cloud-media-pending');
            img.classList.add('cloud-media-error');
            console.warn('[cloud-media] 加载失败', ref, e);
        }
    }

    /**
     * 绑定一个 <img> 元素做懒加载
     * @param {HTMLImageElement} imgEl
     * @param {string} ref  云端引用（oss://xxx）
     * @param {string} [placeholder]  占位图 base64/URL
     */
    function bindLazyImage(imgEl, ref, placeholder) {
        if (!imgEl || !ref) return;
        imgEl.setAttribute('data-cloud-ref', ref);
        // 占位图
        if (placeholder) {
            imgEl.src = placeholder;
        } else {
            // 1x1 透明 gif 兜底
            imgEl.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        }
        imgEl.classList.add('cloud-media-pending');
        var obs = _ensureObserver();
        if (obs) {
            obs.observe(imgEl);
        } else {
            // 不支持 IO 则立即加载
            _loadImageElement(imgEl, ref);
        }
    }

    /**
     * 立即加载（不懒加载）
     */
    async function loadNow(imgEl, ref) {
        if (!imgEl || !ref) return;
        imgEl.setAttribute('data-cloud-ref', ref);
        await _loadImageElement(imgEl, ref);
    }

    // ==== 迁移辅助 ====
    /**
     * 检查一个字符串是否是 base64 图片，如果是则上传到云端，返回新引用
     * 如果本来就是 oss://，直接返回
     */
    async function migrateIfBase64(value, category) {
        if (!value) return value;
        if (isCloudRef(value)) return value;
        if (!isBase64(value)) return value;
        try {
            var r = await uploadMedia(value, category);
            return r.url;
        } catch (e) {
            console.warn('[cloud-media] 迁移失败', category, e);
            return value; // 失败保持原样
        }
    }

    // ==== 缓存清理 ====
    function clearMemoryCache() {
        _mediaCache.forEach(function (blobUrl) {
            try { URL.revokeObjectURL(blobUrl); } catch (e) {}
        });
        _mediaCache.clear();
    }

    // ==== 样式（占位加载效果） ====
    function _injectStyles() {
        if (document.getElementById('cloud-media-styles')) return;
        var s = document.createElement('style');
        s.id = 'cloud-media-styles';
        s.textContent = [
            '.cloud-media-pending, .cloud-media-loading {',
            '  background: linear-gradient(90deg, #eaeaea 0%, #f5f5f5 50%, #eaeaea 100%);',
            '  background-size: 200% 100%;',
            '  animation: cloudMediaShimmer 1.4s ease-in-out infinite;',
            '  min-height: 60px;',
            '}',
            '@keyframes cloudMediaShimmer {',
            '  0% { background-position: 200% 0; }',
            '  100% { background-position: -200% 0; }',
            '}',
            '.cloud-media-error {',
            '  background: #f8d7da;',
            '  color: #721c24;',
            '  padding: 8px;',
            '  font-size: 12px;',
            '  min-height: 40px;',
            '  display: flex;',
            '  align-items: center;',
            '  justify-content: center;',
            '}',
            '.cloud-media-error::after {',
            '  content: "图片加载失败";',
            '}'
        ].join('\n');
        document.head.appendChild(s);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _injectStyles);
    } else {
        _injectStyles();
    }

    // ==== 上传队列（阶段三B：聊天图片"发送即成功"，后台自动重试）====
    // 队列 task 结构：{ base64, category, messageId, onSuccess, attempts, timerId }
    var _uploadQueue = new Map();
    // 内存 base64 缓存：taskId → base64。让 bindPendingImage 同步读到数据，避免竞态
    var _pendingBase64Cache = new Map();
    // 加 APP_PREFIX 前缀，让恢复流程能一并清掉（避免残留别的梦角的 pending 数据）
    var _pendingKeyPrefix = APP_PREFIX_STR + 'pendingUpload_';
    var _uploaderStarted = false;

    // 指数退避（毫秒）：2s → 5s → 15s → 60s → 之后每 60s
    function _retryDelay(attempt) {
        var table = [2000, 5000, 15000, 60000];
        return attempt < table.length ? table[attempt] : 60000;
    }

    function _pendingKey(taskId) {
        return _pendingKeyPrefix + taskId;
    }

    /**
     * 加入上传队列（聊天图片专用，同步函数，立即返回 taskId）
     * @param {string} base64
     * @param {string} category
     * @param {object} opts  { taskId?, messageId, onSuccess?(result), onFailure?(err) }
     * @returns {string} taskId
     */
    function queueUpload(base64, category, opts) {
        opts = opts || {};
        var taskId = opts.taskId || ('up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
        // 内存缓存立即写入（同步），供随后立刻渲染的消息读取，避免竞态
        _pendingBase64Cache.set(taskId, base64);
        // 内存队列同步写入
        _uploadQueue.set(taskId, {
            base64: base64,
            category: category,
            messageId: opts.messageId,
            onSuccess: opts.onSuccess,
            onFailure: opts.onFailure,
            attempts: 0,
            timerId: null
        });
        // 持久化（异步 fire-and-forget，即使失败也不影响本次发送体验）
        var record = {
            base64: base64,
            category: category,
            messageId: opts.messageId,
            createdAt: Date.now()
        };
        localforage.setItem(_pendingKey(taskId), record).catch(function (e) {
            console.error('[cloud-media] pending 键持久化失败（不影响本次上传）', e);
        });
        // 触发上传（不 await）
        _tryUpload(taskId);
        return taskId;
    }

    async function _tryUpload(taskId) {
        var task = _uploadQueue.get(taskId);
        if (!task) return;
        // 清理已排的定时器
        if (task.timerId) { clearTimeout(task.timerId); task.timerId = null; }

        if (!window.CloudSync || !window.CloudSync.isConnected()) {
            // 没连云端，等 online 或 CloudSync 就绪
            task.timerId = setTimeout(function () { _tryUpload(taskId); }, _retryDelay(task.attempts));
            return;
        }

        try {
            var result = await uploadMedia(task.base64, task.category);
            // 成功：清队列 + 清持久化 + 清内存缓存
            _uploadQueue.delete(taskId);
            _pendingBase64Cache.delete(taskId);
            try { await localforage.removeItem(_pendingKey(taskId)); } catch (e) {}
            if (typeof task.onSuccess === 'function') {
                try { await task.onSuccess(result); } catch (e) { console.warn('[cloud-media] onSuccess 回调出错', e); }
            }
        } catch (err) {
            task.attempts++;
            console.warn('[cloud-media] 上传失败，第 ' + task.attempts + ' 次，将重试', err);
            task.timerId = setTimeout(function () { _tryUpload(taskId); }, _retryDelay(task.attempts - 1));
        }
    }

    /**
     * 从 pendingUpload_ 键读出 base64（供消息渲染显示上传中的图）
     * 优先查内存缓存（同步命中，无竞态），未命中再读 localforage（页面刷新后的恢复场景）
     */
    async function getPendingBase64(taskIdOrRef) {
        var taskId = taskIdOrRef.indexOf('pending://') === 0 ? taskIdOrRef.slice(10) : taskIdOrRef;
        // 优先内存
        if (_pendingBase64Cache.has(taskId)) {
            return _pendingBase64Cache.get(taskId);
        }
        // 回退到 localforage
        try {
            var record = await localforage.getItem(_pendingKey(taskId));
            if (record && record.base64) {
                // 顺便回填内存缓存
                _pendingBase64Cache.set(taskId, record.base64);
                return record.base64;
            }
        } catch (e) {}
        return null;
    }

    /**
     * 绑定"上传中"图片的 src
     * 内存命中：同步设置 src（无闪烁）
     * 内存未命中：await localforage，异步设置 src
     */
    function bindPendingImage(imgEl, pendingRef) {
        if (!imgEl || !pendingRef) return;
        var taskId = pendingRef.indexOf('pending://') === 0 ? pendingRef.slice(10) : pendingRef;
        // 同步路径
        if (_pendingBase64Cache.has(taskId)) {
            imgEl.src = _pendingBase64Cache.get(taskId);
            return;
        }
        // 异步路径（刷新后恢复的场景）
        localforage.getItem(_pendingKey(taskId)).then(function (record) {
            if (record && record.base64) {
                _pendingBase64Cache.set(taskId, record.base64);
                imgEl.src = record.base64;
            }
        }).catch(function () {});
    }

    /**
     * 启动时扫描 pendingUpload_ 键恢复队列（页面刷新后继续未完成的上传）
     * 需要外部提供 onRestore(taskId, record) 回调，用来在消息层面重建 onSuccess 回调
     */
    async function restorePendingQueue(onRestore) {
        if (_uploaderStarted) return;
        _uploaderStarted = true;
        try {
            var allKeys = await localforage.keys();
            for (var i = 0; i < allKeys.length; i++) {
                var k = allKeys[i];
                if (k.indexOf(_pendingKeyPrefix) !== 0) continue;
                var taskId = k.slice(_pendingKeyPrefix.length);
                var record = await localforage.getItem(k);
                if (!record || !record.base64) {
                    try { await localforage.removeItem(k); } catch (e) {}
                    continue;
                }
                // 交给外部（core.js）重建 onSuccess 回调
                var onSuccess = null;
                if (typeof onRestore === 'function') {
                    try { onSuccess = onRestore(taskId, record); } catch (e) { console.warn(e); }
                }
                _uploadQueue.set(taskId, {
                    base64: record.base64,
                    category: record.category,
                    messageId: record.messageId,
                    onSuccess: onSuccess,
                    attempts: 0,
                    timerId: null
                });
                // 恢复内存缓存，让重启后消息重新渲染时能同步显示 base64
                _pendingBase64Cache.set(taskId, record.base64);
                _tryUpload(taskId);
            }
        } catch (e) {
            console.warn('[cloud-media] 恢复上传队列失败', e);
        }
    }

    // 网络恢复：把所有 task 立即再试一次（重置 timer）
    if (typeof window !== 'undefined') {
        window.addEventListener('online', function () {
            _uploadQueue.forEach(function (task, taskId) {
                if (task.timerId) { clearTimeout(task.timerId); task.timerId = null; }
                _tryUpload(taskId);
            });
        });
    }

    /**
     * 判断字符串是否是 pending 引用
     */
    function isPendingRef(v) {
        return typeof v === 'string' && v.indexOf('pending://') === 0;
    }

    // ==== 暴露 ====
    global.CloudMedia = {
        // 上传下载
        upload: uploadMedia,
        fetchUrl: fetchMediaUrl,
        delete: deleteMedia,
        // 缩略图
        makeThumbnail: makeThumbnail,
        // 判断
        isCloudRef: isCloudRef,
        isBase64: isBase64,
        isPendingRef: isPendingRef,
        // 懒加载
        bindLazyImage: bindLazyImage,
        loadNow: loadNow,
        // 迁移
        migrateIfBase64: migrateIfBase64,
        // 缓存
        clearMemoryCache: clearMemoryCache,
        // 上传队列（阶段三B）
        queueUpload: queueUpload,
        getPendingBase64: getPendingBase64,
        bindPendingImage: bindPendingImage,
        restorePendingQueue: restorePendingQueue,
        // 工具
        _blobToBase64: _blobToBase64,
        _base64ToBlob: _base64ToBlob
    };
})(typeof window !== 'undefined' ? window : this);
