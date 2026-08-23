function safeGetItem(key) {
            try { return localStorage.getItem(key); }
            catch (e) { console.error('Error getting item:', e); return null; }
        }

        function safeSetItem(key, value) {
            try {
                if (typeof value === 'object') value = JSON.stringify(value);
                localStorage.setItem(key, value);
            } catch (e) { console.error('Error setting item:', e); }
        }

        function safeRemoveItem(key) {
            try { localStorage.removeItem(key); }
            catch (e) { console.error('Error removing item:', e); }
        }

function getRandomItem(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

function normalizeStringStrict(s) {
    if (typeof s !== 'string') return '';
    return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function deduplicateContentArray(arr, baseSystemArray = []) {
    const seen = new Set(baseSystemArray.map(normalizeStringStrict));
    const result = [];
    let removedCount = 0;
    for (const item of arr) {
        const norm = normalizeStringStrict(item);
        if (norm !== '' && !seen.has(norm)) {
            seen.add(norm);
            result.push(item);
        } else {
            removedCount++;
        }
    }
    return { result, removedCount };
}

        function cropImageToSquare(file, maxSize = 640) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const minSide = Math.min(img.width, img.height);
                        const sx = (img.width - minSide) / 2;
                        const sy = (img.height - minSide) / 2;
                        const canvas = document.createElement('canvas');
                        canvas.width = maxSize; canvas.height = maxSize;
                        const ctx = canvas.getContext('2d');
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';
                        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, maxSize, maxSize);
                        resolve(canvas.toDataURL('image/jpeg', 0.95));
                    };
                    img.onerror = reject;
                    img.src = e.target.result;
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }

        function _isCapacitorEnv() {
            return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share);
        }

        function exportDataToMobileOrPC(dataString, fileName) {
            const blob = new Blob([dataString], { type: 'application/json' });
            // Capacitor 环境优先使用原生分享
            if (_isCapacitorEnv()) {
                downloadFileFallback(blob, fileName);
                return;
            }
            if (navigator.share && navigator.canShare) {
                try {
                    const file = new File([blob], fileName, { type: 'application/json' });
                    if (navigator.canShare({ files: [file] })) {
                        navigator.share({ files: [file], title: '传讯数据备份', text: '请选择"保存到文件"' })
                            .catch(() => downloadFileFallback(blob, fileName));
                        return;
                    }
                } catch (e) {}
            }
            downloadFileFallback(blob, fileName);
        }

        function downloadFileFallback(blob, fileName) {
            // 优先：直接保存到手机「下载」目录（无需分享面板选位置）
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ExportPlugin) {
                _exportViaExportPlugin(blob, fileName);
                return;
            }
            // Capacitor 环境：使用原生分享
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
                _capacitorShareFile(blob, fileName);
                return;
            }
            // 检测是否在 Android WebView 中运行
            var isAndroidWebView = /Android/.test(navigator.userAgent) && /wv/.test(navigator.userAgent);

            if (isAndroidWebView) {
                // 方案1: 尝试通过 navigator.share 分享（需要 WebView 启用 WebShare）
                if (navigator.share && navigator.canShare) {
                    var file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
                    if (navigator.canShare({ files: [file] })) {
                        navigator.share({ files: [file], title: '传讯 - 保存备份' }).catch(function () {
                            _webViewDataUrlFallback(blob, fileName);
                        });
                        return;
                    }
                }
                // 方案2: 尝试通过原生 Android 接口下载
                if (window.Android && typeof window.Android.downloadFile === 'function') {
                    var reader = new FileReader();
                    reader.onload = function () {
                        window.Android.downloadFile(reader.result, fileName, blob.type);
                    };
                    reader.onerror = function () {
                        _webViewDataUrlFallback(blob, fileName);
                    };
                    reader.readAsDataURL(blob);
                    return;
                }
                // 方案3: 用 data URL 在新窗口打开（部分 WebView 会触发下载）
                _webViewDataUrlFallback(blob, fileName);
                return;
            }

            // 标准浏览器环境
            var url = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = url; link.download = fileName; link.style.display = 'none';
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
            setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        }

        // WebView 备用方案：将 blob 转为 data URL 并尝试在新窗口打开
        function _webViewDataUrlFallback(blob, fileName) {
            var reader = new FileReader();
            reader.onload = function () {
                var dataUrl = reader.result;
                // 尝试通过原生 Android 接口下载
                if (window.Android && typeof window.Android.downloadFile === 'function') {
                    window.Android.downloadFile(dataUrl, fileName, blob.type);
                    return;
                }
                // 尝试在新窗口打开 data URL（部分 WebView 会触发下载）
                var w = window.open(dataUrl, '_blank');
                if (!w) {
                    // 最后尝试：直接修改 location（会离开当前页面）
                    if (typeof showNotification === 'function') {
                        showNotification('无法下载文件，请尝试在浏览器中打开', 'warning', 3000);
                    }
                }
            };
            reader.readAsDataURL(blob);
        }

        // 直接保存到手机「下载」目录（ExportPlugin）
        function _exportViaExportPlugin(blob, fileName) {
            var reader = new FileReader();
            reader.onload = function () {
                var base64Data = reader.result.split(',')[1];
                var mimeType = blob.type || 'application/octet-stream';
                window.Capacitor.Plugins.ExportPlugin.saveBase64({
                    data: base64Data,
                    fileName: fileName,
                    mimeType: mimeType
                }).then(function () {
                    if (typeof showNotification === 'function') {
                        showNotification('备份已保存到手机「下载/ChuanXun」目录', 'success', 4000);
                    }
                }).catch(function (error) {
                    console.warn('[utils] ExportPlugin 保存失败，回退分享:', error);
                    _capacitorShareFile(blob, fileName);
                });
            };
            reader.onerror = function () {
                _capacitorShareFile(blob, fileName);
            };
            reader.readAsDataURL(blob);
        }

        // Capacitor 原生分享（使用 Filesystem 写入文件）
        function _capacitorShareFile(blob, fileName) {
            // 优先使用 Filesystem 写入文件（真正保存到设备）
            if (_getCapFilesystem()) {
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
                    console.warn('[utils] Web Share 失败，尝试其他方式', e);
                    _capacitorShareFallback(blob, fileName);
                });
                return;
            }
            _capacitorShareFallback(blob, fileName);
        }

        function _getCapFilesystem() {
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
                return window.Capacitor.Plugins.Filesystem;
            }
            return null;
        }

        function _capacitorSaveAndShare(blob, fileName) {
            var fs = _getCapFilesystem();
            if (!fs) {
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
                    console.log('[utils] 文件已写入:', writeResult.uri);
                    return fs.getUri({ path: filePath, directory: 'CACHE' });
                }).then(function (uriResult) {
                    console.log('[utils] 文件 URI:', uriResult.uri);
                    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
                        // 用 files 数组真实携带本地文件 URI 分享文件内容。
                        // 若只用 url:（file:// 本地 URI），Android/iOS 会把文件路径当"链接"分享，
                        // 接收端常得到空文件或无法打开。
                        var shareOpts = {
                            title: '传讯 - 保存备份',
                            text: '备份文件：' + fileName,
                            dialogTitle: '保存备份文件'
                        };
                        if (uriResult && uriResult.uri) shareOpts.files = [uriResult.uri];
                        return window.Capacitor.Plugins.Share.share(shareOpts);
                    }
                    var file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
                    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                        return navigator.share({ files: [file], title: '传讯 - 保存备份', text: '备份文件：' + fileName });
                    }
                    throw new Error('无可用分享方式');
                }).then(function () {
                    if (typeof showNotification === 'function') showNotification('备份已导出，请选择保存位置', 'success', 4000);
                }).catch(function (e) {
                    console.warn('[utils] 保存分享失败:', e);
                    _capacitorShareFallback(blob, fileName);
                });
            };
            reader.onerror = function () {
                _capacitorShareFallback(blob, fileName);
            };
            reader.readAsDataURL(blob);
        }

        function _capacitorShareFallback(blob, fileName) {
            // 回退：Capacitor Share 插件
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
                        console.warn('[utils] Capacitor Share 失败', e);
                        _webViewDataUrlFallback(blob, fileName);
                    });
                };
                reader.readAsDataURL(blob);
                return;
            }
            _webViewDataUrlFallback(blob, fileName);
        }

        if (typeof localforage !== 'undefined') {
            localforage.config({
                driver: [localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE],
                name: 'ChatApp_V3', version: 1.0, storeName: 'chat_data',
                description: 'Storage for Chat App V3'
            });
        } else {
            console.warn('[storage] localforage 未加载，IndexedDB 能力不可用，将退回 localStorage/内存兜底');
        }

        function showNotification(message, type = 'info', duration = 3000) {
            const existing = document.querySelector('.notification');
            if (existing) existing.remove();
            const notification = document.createElement('div');
            notification.className = `notification ${type}`;
            const iconMap = { success:'fa-check-circle', error:'fa-exclamation-circle', info:'fa-info-circle', warning:'fa-exclamation-triangle' };
            notification.innerHTML = `<i class="fas ${iconMap[type] || 'fa-info-circle'}"></i><span>${message}</span>`;
            document.body.appendChild(notification);
            setTimeout(() => {
                notification.classList.add('hiding');
                notification.addEventListener('animationend', () => notification.remove());
            }, duration);
        }

        let _currentAudioContext = null;
        let _currentAudio = null;

        const stopCurrentSound = () => {
            try {
                if (_currentAudio) {
                    _currentAudio.pause();
                    _currentAudio.currentTime = 0;
                    _currentAudio = null;
                }
                if (_currentAudioContext) {
                    _currentAudioContext.close();
                    _currentAudioContext = null;
                }
            } catch(e) {}
        };

        // 暴露停止音效函数，供邀请等场景手动调用
        window.stopCurrentSound = stopCurrentSound;

        const playSound = (type, loopOverride) => {
            if (!settings.soundEnabled) return;
            stopCurrentSound();

            // =============== 邀请类音效（独立路径，播放 mp3 文件） ===============
            const INVITE_TYPES = ['invite_study', 'invite_work', 'invite_exercise', 'invite_sleep', 'invite_videocall'];
            if (INVITE_TYPES.indexOf(type) !== -1) {
                try {
                    // 配置：每种邀请的预设 / 自定义 URL 设置 key
                    const inviteKey = {
                        invite_study:     { preset: 'inviteStudySoundPreset',     custom: 'inviteStudyCustomSoundUrl',     defaultFile: 'assets/audio/invite_study.mp3' },
                        invite_work:      { preset: 'inviteWorkSoundPreset',      custom: 'inviteWorkCustomSoundUrl',      defaultFile: 'assets/audio/invite_work.mp3' },
                        invite_exercise:  { preset: 'inviteExerciseSoundPreset',  custom: 'inviteExerciseCustomSoundUrl',  defaultFile: 'assets/audio/invite_exercise.mp3' },
                        invite_sleep:     { preset: 'inviteSleepSoundPreset',     custom: 'inviteSleepCustomSoundUrl',     defaultFile: 'assets/audio/invite_sleep.mp3' },
                        invite_videocall: { preset: 'inviteVideocallSoundPreset', custom: 'inviteVideocallCustomSoundUrl', defaultFile: 'assets/audio/invite_videocall.mp3' }
                    }[type];

                    if (!inviteKey) return;

                    const preset = settings[inviteKey.preset] || 'default';
                    if (preset === 'mute') return;

                    // URL 解析顺序：自定义 URL > 内置文件
                    const customUrl = (settings[inviteKey.custom] || '').trim();
                    const url = customUrl || inviteKey.defaultFile;

                    // 邀请音效循环播放，试听只播一次（由调用方传第二个参数 loop 控制，默认循环）
                    const shouldLoop = (typeof loopOverride === 'undefined') ? true : !!loopOverride;

                    const audio = new Audio(url);
                    audio.volume = Math.min(1, Math.max(0, settings.soundVolume || 0.3));
                    audio.loop = shouldLoop;
                    _currentAudio = audio;
                    audio.play().catch((e) => { console.warn('[playSound] invite audio play failed:', e); });
                    if (!shouldLoop) {
                        audio.addEventListener('ended', () => { _currentAudio = null; });
                    }
                } catch (e) {
                    console.warn('[playSound] invite audio error:', e);
                }
                return;
            }

            try {
                // =============== 两方音效配置 ===============
                const category = (() => {
                    // 新类型（按两方区分）
                    if (type === 'my_send') return 'my_send';
                    if (type === 'partner_message') return 'partner_message';
                    if (type === 'my_poke') return 'my_poke';
                    if (type === 'partner_poke') return 'partner_poke';
                    // 兼容旧调用
                    if (type === 'send') return 'my_send';
                    if (type === 'message') return 'partner_message';
                    if (type === 'poke') return 'my_poke';
                    return null;
                })();

                const customUrlByCategory = (() => {
                    if (!category) return '';
                    if (category === 'my_send') return settings.mySendCustomSoundUrl || '';
                    if (category === 'partner_message') return settings.partnerMessageCustomSoundUrl || '';
                    if (category === 'my_poke') return settings.myPokeCustomSoundUrl || '';
                    if (category === 'partner_poke') return settings.partnerPokeCustomSoundUrl || '';
                    return '';
                })();

                const legacyCustomUrl = (settings.customSoundUrl || '').trim();
                const resolvedCustomUrlBase = (customUrlByCategory && customUrlByCategory.trim())
                    ? customUrlByCategory.trim()
                    : legacyCustomUrl;

                const KAKAO_TALK_URL = 'https://image.uglycat.cc/jl5xf9.mp3';

                // 预设音效（无音效 / kakaoTalk）需要优先级高于自定义 URL
                const presetId = (() => {
                    if (!category) return '';
                    if (category === 'my_send') return settings.mySendSoundPreset || 'tone_low';
                    if (category === 'partner_message') return settings.partnerMessageSoundPreset || 'tone_low';
                    if (category === 'my_poke') return settings.myPokeSoundPreset || 'tone_low';
                    if (category === 'partner_poke') return settings.partnerPokeSoundPreset || 'tone_low';
                    return 'tone_low';
                })();

                if (presetId === 'mute') return;

                // kakaoTalk 作为"固定预设"，选择它就播放对应音频
                let resolvedCustomUrl = (presetId === 'kakaotalk') ? KAKAO_TALK_URL : resolvedCustomUrlBase;

                // 自定义 URL：只要填了就直接播放（不区分内置/预设）
                if (resolvedCustomUrl) {
                    const audio = new Audio(resolvedCustomUrl);
                    audio.volume = Math.min(1, Math.max(0, settings.soundVolume || 0.15));
                    _currentAudio = audio;
                    audio.play().catch(() => {});
                    audio.addEventListener('ended', () => { _currentAudio = null; });
                    return;
                }

                // =============== 内置合成音效（两方 + 预设） ===============
                const CATEGORY_BASE = {
                    my_send: { osc1Type: 'triangle', osc2Type: 'sine', freq: 520, dur: 0.18, up: 1.06, down: 0.72 },
                    partner_message: { osc1Type: 'triangle', osc2Type: 'sine', freq: 460, dur: 0.2, up: 1.04, down: 0.74 },
                    my_poke: { osc1Type: 'sawtooth', osc2Type: 'triangle', freq: 400, dur: 0.16, up: 1.08, down: 0.76 },
                    partner_poke: { osc1Type: 'sawtooth', osc2Type: 'triangle', freq: 380, dur: 0.16, up: 1.08, down: 0.76 }
                };

                const PRESET_EFFECTS = {
                    // 预设 effect：允许覆盖波形与倍率（不填则沿用基础音色）
                    tone_default: { osc1Type: 'triangle', osc2Type: 'sine', fMul: 0.92, durMul: 1.08, upMul: 1.0, downMul: 0.95 },
                    tone_soft: { osc1Type: 'sine', osc2Type: 'triangle', fMul: 0.88, durMul: 1.15, upMul: 0.98, downMul: 0.92 },
                    tone_low: { osc1Type: 'sawtooth', osc2Type: 'triangle', fMul: 0.78, durMul: 1.2, upMul: 0.96, downMul: 0.88 },
                    tone_warm: { osc1Type: 'triangle', osc2Type: 'triangle', fMul: 0.84, durMul: 1.1, upMul: 0.98, downMul: 0.9 },
                    tone_dark: { osc1Type: 'square', osc2Type: 'triangle', fMul: 0.72, durMul: 1.25, upMul: 0.95, downMul: 0.85 },
                    tone_haze: { osc1Type: 'sine', osc2Type: 'square', fMul: 0.8, durMul: 1.18, upMul: 0.97, downMul: 0.9 }
                };

                // presetId 已在上方计算

                const cfg = (() => {
                    if (category && CATEGORY_BASE[category]) {
                        const base = CATEGORY_BASE[category];
                        const fx = PRESET_EFFECTS[presetId] || PRESET_EFFECTS.tone_default;
                        const osc1Type = (typeof fx.osc1Type === 'string') ? fx.osc1Type : base.osc1Type;
                        const osc2Type = (typeof fx.osc2Type === 'string') ? fx.osc2Type : base.osc2Type;
                        const freq = base.freq * (fx.fMul || 1);
                        const dur = base.dur * (fx.durMul || 1);
                        const up = base.up * (fx.upMul || 1);
                        const down = base.down * (fx.downMul || 1);
                        return { osc1Type, osc2Type, freq, dur, up, down };
                    }

                    // 兼容其它旧声音类型（不走两方预设）
                    if (type === 'favorite') return { osc1Type: 'sine', osc2Type: 'sine', freq: 1200, dur: 0.18, up: 1.06, down: 0.70 };
                    if (type === 'anniversary') return { osc1Type: 'sawtooth', osc2Type: 'triangle', freq: 660, dur: 0.22, up: 1.10, down: 0.62 };
                    if (type === 'mood') return { osc1Type: 'sine', osc2Type: 'square', freq: 440, dur: 0.16, up: 1.12, down: 0.60 };
                    if (type === 'import') return { osc1Type: 'square', osc2Type: 'triangle', freq: 330, dur: 0.16, up: 1.25, down: 0.70 };
                    if (type === 'export') return { osc1Type: 'triangle', osc2Type: 'sine', freq: 520, dur: 0.16, up: 1.15, down: 0.66 };
                    if (type === 'error') return { osc1Type: 'sawtooth', osc2Type: 'square', freq: 180, dur: 0.14, up: 1.03, down: 0.42 };
                    return { osc1Type: 'sine', osc2Type: 'triangle', freq: 600, dur: 0.15, up: 1.05, down: 0.60 };
                })();

                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                _currentAudioContext = audioContext;
                const gainNode = audioContext.createGain();
                const vol = Math.min(0.55, Math.max(0.01, settings.soundVolume || 0.1));

                // 叠加一层泛音让音色更"厚"
                const osc1 = audioContext.createOscillator();
                const osc2 = audioContext.createOscillator();

                osc1.connect(gainNode);
                osc2.connect(gainNode);
                gainNode.connect(audioContext.destination);

                const now = audioContext.currentTime;
                gainNode.gain.setValueAtTime(vol, now);

                const jitter = (Math.random() - 0.5) * 0.02; // 轻微随机
                const f1 = cfg.freq * (1 + jitter);
                const f2 = f1 * 2;

                osc1.type = cfg.osc1Type;
                osc2.type = cfg.osc2Type;

                osc1.frequency.setValueAtTime(f1, now);
                osc2.frequency.setValueAtTime(f2, now);

                // 频率滑动 + 音量包络
                osc1.frequency.exponentialRampToValueAtTime(f1 * cfg.up, now + 0.04);
                osc2.frequency.exponentialRampToValueAtTime(f2 * (cfg.up - 0.03), now + 0.04);

                osc1.frequency.exponentialRampToValueAtTime(f1 * cfg.down, now + cfg.dur);
                osc2.frequency.exponentialRampToValueAtTime(f2 * cfg.down, now + cfg.dur);

                const end = now + cfg.dur;
                osc1.start(now);
                osc2.start(now);

                gainNode.gain.exponentialRampToValueAtTime(0.0001, end);

                osc1.stop(end);
                osc2.stop(end);
                audioContext.addEventListener('statechange', () => {
                    if (audioContext.state === 'closed') _currentAudioContext = null;
                });
            } catch (e) { console.warn("音频播放失败:", e); }
        };

        const throttledSaveData = () => {
            if (typeof saveTimeout !== 'undefined') clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                try {
                    const maybePromise = saveData();
                    if (maybePromise && typeof maybePromise.catch === 'function') {
                        maybePromise.catch(e => console.error('[throttledSaveData] 保存失败:', e));
                    }
                } catch (e) {
                    console.error('[throttledSaveData] 保存失败:', e);
                }
            }, 500);
        };

async function applyCustomFont(url) {
    if (!url || !url.trim()) {
        document.documentElement.style.removeProperty('--font-family');
        document.documentElement.style.removeProperty('--message-font-family');
        return;
    }
    const fontName = 'UserCustomFont';
    try {
        const font = new FontFace(fontName, `url(${url})`);
        await font.load();
        document.fonts.add(font);
        const fontStack = `"${fontName}", 'Noto Serif SC', serif`;
        document.documentElement.style.setProperty('--font-family', fontStack);
        document.documentElement.style.setProperty('--message-font-family', fontStack);
        if (typeof settings !== 'undefined') settings.messageFontFamily = fontStack;
    } catch (e) {
        console.error('字体加载失败:', e);
        showNotification('字体加载失败，请检查链接是否有效', 'error');
    }
}

function applyCustomBubbleCss(cssCode) {
    const styleId = 'user-custom-bubble-style';
    let styleTag = document.getElementById(styleId);
    if (!cssCode || !cssCode.trim()) { if (styleTag) styleTag.remove(); return; }
    if (!styleTag) { styleTag = document.createElement('style'); styleTag.id = styleId; }
    document.head.appendChild(styleTag);

    function boostSpecificity(css) {
        return css.replace(/([^{}@][^{}]*)\{([^{}]*)\}/g, (match, rawSel, body) => {
            const selectors = rawSel.split(',').map(s => s.trim()).filter(Boolean);
            const boosted = selectors.map(sel => {
                if (sel.startsWith('html') || sel.startsWith('@') || sel.startsWith('from') || sel.startsWith('to') || /^\d/.test(sel)) return sel;
                return `html body ${sel}`;
            });
            return `${boosted.join(', ')} {${body}}`;
        });
    }

    const boostedCss = boostSpecificity(cssCode);

    styleTag.textContent = boostedCss + `
/* image bubble reset — must stay !important */
html[data-theme] .message.message-image-bubble-none,
html body .message.message-image-bubble-none {
    background: transparent !important; border: none !important;
    box-shadow: none !important; padding: 0 !important; border-radius: 0 !important;
}`;

    try {
        const alreadyCustomized = (typeof settings !== 'undefined' && settings.customThemeColors) ? settings.customThemeColors : {};
        const sentMatch  = cssCode.match(/\.message-sent\s*\{([^}]*)\}/);
        const recvMatch  = cssCode.match(/\.message-received\s*\{([^}]*)\}/);
        if (sentMatch && !alreadyCustomized['--message-sent-text']) {
            const colorLine = sentMatch[1].match(/\bcolor\s*:\s*([^;}\n]+)/);
            if (colorLine) {
                const v = colorLine[1].trim().replace(/!important/g,'').trim();
                if (v && !v.startsWith('var(')) {
                    document.documentElement.style.setProperty('--message-sent-text', v);
                }
            }
        }
        if (recvMatch && !alreadyCustomized['--message-received-text']) {
            const colorLine = recvMatch[1].match(/\bcolor\s*:\s*([^;}\n]+)/);
            if (colorLine) {
                const v = colorLine[1].trim().replace(/!important/g,'').trim();
                if (v && !v.startsWith('var(')) {
                    document.documentElement.style.setProperty('--message-received-text', v);
                }
            }
        }
    } catch(e) {}
}

function applyGlobalThemeCss(cssCode) {
    const styleId = 'user-custom-global-theme-style';
    let styleTag = document.getElementById(styleId);
    if (!cssCode || !cssCode.trim()) { if (styleTag) styleTag.remove(); return; }
    if (!styleTag) { styleTag = document.createElement('style'); styleTag.id = styleId; document.head.appendChild(styleTag); }
    styleTag.textContent = cssCode;
}

// 全量备份进度条弹窗：返回 { update(pct,label), done(), close() }
window.showBackupProgress = function () {
    try {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999992;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML =
            '<div style="width:min(420px,88vw);background:var(--secondary-bg,#fff);border-radius:18px;padding:22px 24px;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center;">'
            + '<div style="font-size:17px;font-weight:800;color:var(--text-primary);display:flex;align-items:center;justify-content:center;gap:8px;"><i class="fas fa-file-export" style="color:var(--accent-color);"></i>正在备份</div>'
            + '<div id="bkprog-label" style="margin:12px 0 6px;font-size:13px;color:var(--text-secondary);min-height:18px;">准备中…</div>'
            + '<div style="height:12px;border-radius:8px;background:rgba(127,127,127,0.18);overflow:hidden;">'
            +   '<div id="bkprog-bar" style="height:100%;width:0%;border-radius:8px;background:linear-gradient(90deg,var(--accent-color,#4A90E2),#6ab0ff);transition:width .25s ease;"></div>'
            + '</div>'
            + '<div style="margin-top:8px;font-size:12px;color:var(--text-secondary);opacity:0.8;" id="bkprog-pct">0%</div>'
            + '</div>';
        document.body.appendChild(overlay);
        var bar = overlay.querySelector('#bkprog-bar');
        var pctEl = overlay.querySelector('#bkprog-pct');
        var labelEl = overlay.querySelector('#bkprog-label');
        var started = Date.now();
        return {
            update: function (pct, label) {
                pct = Math.max(0, Math.min(100, Math.round(pct || 0)));
                if (bar) bar.style.width = pct + '%';
                if (pctEl) pctEl.textContent = pct + '%';
                if (labelEl && label) labelEl.textContent = label;
            },
            done: function () {
                if (bar) bar.style.width = '100%';
                if (pctEl) pctEl.textContent = '100%';
                if (labelEl) labelEl.textContent = '备份完成 ✓';
                var self = overlay;
                setTimeout(function () { if (self && self.parentNode) self.parentNode.removeChild(self); }, 900);
            },
            close: function () {
                if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }
        };
    } catch (e) {
        // 弹窗创建失败时静默降级，不影响备份本身
        return { update: function () {}, done: function () {}, close: function () {} };
    }
};

async function exportAllData() {
    // 打开全量备份的进度条弹窗
    var prog = typeof window.showBackupProgress === 'function' ? window.showBackupProgress() : null;
    var onProgress = function (pct, label) {
        if (prog && typeof prog.update === 'function') prog.update(pct, label);
    };
    try {
        if (typeof ChatBackup !== 'undefined' && ChatBackup.exportBackupToFile) {
            await ChatBackup.exportBackupToFile({
                inclMsgs: true,
                inclSet: true,
                inclCustom: true,
                inclAnn: true,
                inclThemes: true,
                inclDg: true,
                inclStickers: true,
                inclCS: true
            }, onProgress);
            if (prog && typeof prog.done === 'function') prog.done();
            return;
        }
        if (typeof ChatBackup !== 'undefined' && ChatBackup.buildBackupPayload && ChatBackup.serializeBackupV4) {
            if (prog && typeof prog.update === 'function') prog.update(15, '正在读取本地数据…');
            const payload = await ChatBackup.buildBackupPayload({
                inclMsgs: true,
                inclSet: true,
                inclCustom: true,
                inclAnn: true,
                inclThemes: true,
                inclDg: true,
                inclStickers: true,
                inclCS: true
            });
            if (prog && typeof prog.update === 'function') prog.update(60, '正在生成备份文件…');
            const jsonString = ChatBackup.serializeBackupV4(payload);
            const dateStr = new Date().toISOString().slice(0, 10);
            const fileName = `chatapp-backup-${dateStr}.json`;
            const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
            // Capacitor 环境优先使用原生分享
            if (_isCapacitorEnv()) {
                if (prog && typeof prog.update === 'function') prog.update(92, '正在保存到手机…');
                downloadFileFallback(blob, fileName);
                if (typeof showNotification === 'function') showNotification('已导出 JSON 备份', 'success');
                if (prog && typeof prog.done === 'function') prog.done();
                return;
            }
            // 移动端 / WebView 优先尝试系统分享（保存到文件）
            if (navigator.share && navigator.canShare && /Mobile|Android|iPhone|iPad/.test(navigator.userAgent)) {
                try {
                    var file = new File([blob], fileName, { type: 'application/json' });
                    if (navigator.canShare({ files: [file] })) {
                        await navigator.share({ files: [file], title: '传讯全量备份', text: '备份日期：' + dateStr });
                        if (typeof showNotification === 'function') showNotification('备份导出成功', 'success');
                        if (prog && typeof prog.done === 'function') prog.done();
                        return;
                    }
                } catch (e) { /* 用户取消或不支持，回退到下载 */ }
            }
            downloadFileFallback(blob, fileName);
            if (typeof showNotification === 'function') showNotification('已导出 JSON 备份', 'success');
            if (prog && typeof prog.done === 'function') prog.done();
        } else {
            if (prog && typeof prog.close === 'function') prog.close();
            showNotification('备份模块或函数未加载，请刷新页面', 'error');
        }
    } catch (e) {
        console.error('全量导出失败:', e);
        if (prog && typeof prog.close === 'function') prog.close();
        showNotification('全量导出失败，请重试', 'error');
    }
}

async function importAllData(file) {
    if (!file) return;
    if (file.size > 220 * 1024 * 1024) {
        showNotification('文件过大（>220MB），请确认是否为正确备份', 'error');
        return;
    }
    try {
        if (typeof ChatBackup === 'undefined' || !ChatBackup.loadBackupFromFile || !ChatBackup.applyBackupToStorage) {
            showNotification('备份模块未加载，请刷新页面重试', 'error');
            return;
        }
        const data = await ChatBackup.loadBackupFromFile(file);
        const fullLike = ChatBackup.isFullBackupShape
            ? ChatBackup.isFullBackupShape(data)
            : (
                data.type === 'full' ||
                (typeof data.type === 'string' && data.type.includes('full-backup')) ||
                !!data.indexedDB ||
                !!data.localforage
            );
        if (!fullLike) {
            if (typeof importChatHistory === 'function') importChatHistory(file);
            return;
        }
        if (!confirm('导入全量备份将按你的选择覆盖对应数据。\n\n头像/背景等如勾选导入会写入备份中的内容。\n\n确定继续吗？')) return;

        const categories = [
            {
                id: 'chat',
                label: '聊天记录 / 会话 / 红包',
                indexedDBNeedles: ['chatMessages', 'sessionList', 'chatSettings', 'showPartnerNameInChat', 'envelopeData', 'pending_envelope'],
                localStorageNeedles: ['groupChatSettings']
            },
            {
                id: 'replies',
                label: '回复 / 拍一拍 / 氛围',
                indexedDBNeedles: ['customReplies', 'customPokes', 'customStatuses', 'customMottos', 'customIntros', 'customEmojis', 'customReplyGroups', 'customPokeGroups', 'customStatusGroups', 'customVoiceCards', 'customVoiceGroups', 'voiceCardEnabled'],
                localStorageNeedles: ['disabledReplyItems', 'pokeSym_my', 'pokeSym_partner', 'pokeSym_my_custom', 'pokeSym_partner_custom']
            },
            {
                id: 'stickers',
                label: '表情库（贴纸）',
                indexedDBNeedles: ['stickerLibrary', 'myStickerLibrary'],
                localStorageNeedles: ['disabledStickerItems']
            },
            {
                id: 'ann',
                label: '纪念日',
                indexedDBNeedles: ['anniversaries'],
                localStorageNeedles: []
            },
            {
                id: 'cs',
                label: '空间（动态 / 相册 / 壁纸 / 纪念日封面）',
                indexedDBNeedles: ['momentsData', 'albumData', 'csSpaceSettings', 'csWallpaper', 'csWallpaperGallery', 'annMeetOverride', 'annPinnedId', 'annCoverBg_'],
                localStorageNeedles: []
            },
            {
                id: 'ent',
                label: '娱乐（影院 / 音乐厅 / 观影记录）',
                indexedDBNeedles: ['_cinema', 'customSongs'],
                localStorageNeedles: ['__mh']
            },
            {
                id: 'mood',
                label: '心晴手账',
                indexedDBNeedles: ['moodCalendar', 'customMoodOptions', 'moodTrash'],
                localStorageNeedles: []
            },
            {
                id: 'themes',
                label: '主题 / 外观 / 图库',
                indexedDBNeedles: ['customThemes', 'themeSchemes', 'backgroundGallery', 'chatBackground', 'partnerAvatar', 'myAvatar', 'partnerPersonas'],
                localStorageNeedles: []
            },
            {
                id: 'dg',
                label: '每日公告 / 运势 / 天气',
                indexedDBNeedles: [],
                localStorageNeedles: ['dg_custom_data', 'dg_status_pool', 'weekly_fortune', 'daily_fortune'],
                localStoragePrefixes: ['customWeather_']
            },
            {
                id: 'diary',
                label: '陪伴模式（背景 / 语音 / 白噪音 / 日记）',
                indexedDBNeedles: ['companionData', 'companionDiary', 'companionDiaryBg', 'companionDiaryBgGallery'],
                localStorageNeedles: []
            },
            {
                id: 'tts',
                label: '真实语音配置',
                indexedDBNeedles: ['favAudio_', '_favAudio_'],
                localStorageNeedles: ['voiceTtsConfig']
            }
        ];

        const pickSelected = () => new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.6);
                backdrop-filter:blur(10px);display:flex;align-items:flex-end;justify-content:center;
            `;
            overlay.innerHTML = `
                <div style="
                    width:100%;max-width:560px;background:var(--secondary-bg);border-radius:24px 24px 0 0;
                    box-shadow:0 -10px 60px rgba(0,0,0,0.3);
                    padding:16px 18px env(safe-area-inset-bottom,0);
                ">
                    <div style="width:36px;height:4px;border-radius:2px;background:var(--border-color);margin:0 auto 14px;"></div>
                    <div style="font-size:16px;font-weight:800;color:var(--text-primary);margin-bottom:10px;">全量恢复：选择要导入的部分</div>
                    <div style="display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow:auto;padding-right:6px;">
                        ${categories.map(c => {
                            return `
                                <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 12px;border:1.5px solid var(--border-color);border-radius:16px;background:var(--primary-bg);">
                                    <span style="font-size:13px;font-weight:700;color:var(--text-primary);">${c.label}</span>
                                    <input type="checkbox" data-cat="${c.id}" checked style="transform:scale(1.1);accent-color:var(--accent-color);">
                                </label>
                            `;
                        }).join('')}
                    </div>
                    <div style="display:flex;gap:10px;margin-top:14px;">
                        <button id="full-imp-cancel" class="modal-btn modal-btn-secondary" style="flex:1;padding:12px 0;">取消</button>
                        <button id="full-imp-confirm" class="modal-btn modal-btn-primary" style="flex:1;padding:12px 0;">确认恢复</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            overlay.addEventListener('click', (ev) => { if (ev.target === overlay) { overlay.remove(); resolve(null); } });
            const fullImpCancelBtn = document.getElementById('full-imp-cancel');
            const fullImpConfirmBtn = document.getElementById('full-imp-confirm');
            if (fullImpCancelBtn) fullImpCancelBtn.onclick = () => { overlay.remove(); resolve(null); };
            if (fullImpConfirmBtn) fullImpConfirmBtn.onclick = () => {
                const selected = Array.from(overlay.querySelectorAll('input[type=checkbox]:checked'))
                    .map(i => i.dataset.cat);
                overlay.remove();
                resolve(selected);
            };
        });

        const selectedCats = await pickSelected();
        if (!selectedCats || selectedCats.length === 0) return;

        showNotification('正在恢复数据…', 'info', 3000);
        await ChatBackup.applyBackupToStorage(data, {
            selective: true,
            selectedCategoryIds: selectedCats,
            categories
        });

        // 导入守卫：内存里还是旧数据，写盘后、reload 前禁止 saveData/紧急备份回写，
        // 否则 beforeunload/pagehide 会把内存旧数据覆盖回 IndexedDB 造成"导入数据丢失"
        window._importGuarded = true;

        showNotification('恢复完成，即将刷新页面…', 'success', 2000);
        setTimeout(() => location.reload(), 2200);
    } catch (err) {
        console.error('全量导入失败:', err);
        const msg = err && err.message ? err.message : '未知错误';
        showNotification('导入失败：' + msg, 'error', 5000);
    }
}

// ====== 软件更新检查 ======
var APP_VERSION = '2.3.3';
var GITHUB_REPO = 'qcqzz/chat';
var GITHUB_RELEASES_URL = 'https://github.com/' + GITHUB_REPO + '/releases/latest';
var GITHUB_API_URL = 'https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest';
var GITHUB_DOWNLOAD_LATEST_URL = 'https://github.com/' + GITHUB_REPO + '/releases/latest/download/app-release.apk';
var _updatePendingInfo = null; // 待处理的更新信息，供弹窗按钮使用

// 比较两个版本号，返回 1（a>b）、-1（a<b）、0（相等）
function _compareVersions(a, b) {
    var pa = (a || '0').split('.').map(Number);
    var pb = (b || '0').split('.').map(Number);
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
        var na = pa[i] || 0;
        var nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}

// 自动检查更新（启动时静默检查，有更新则弹窗）
function autoCheckUpdate() {
    var ignoredKey = (typeof APP_PREFIX !== 'undefined' ? APP_PREFIX : 'CHAT_APP_V3_') + 'ignored_update_version';

    // 先清理：如果当前 APP 版本变了，清除旧的忽略记录
    var savedAppVerKey = (typeof APP_PREFIX !== 'undefined' ? APP_PREFIX : 'CHAT_APP_V3_') + 'saved_app_version';
    localforage.getItem(savedAppVerKey).then(function (savedVer) {
        if (savedVer && savedVer !== APP_VERSION) {
            // 用户已经升级过了，清除旧的忽略记录
            localforage.removeItem(ignoredKey).catch(function () {});
        }
        localforage.setItem(savedAppVerKey, APP_VERSION).catch(function () {});
    }).catch(function () {});

    fetch(GITHUB_API_URL, { headers: { 'Accept': 'application/vnd.github.v3+json' } })
        .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(function (data) {
            var latestTag = (data.tag_name || '').replace(/^v/, '');
            var currentVer = APP_VERSION.replace(/^v/, '');

            if (!latestTag) return;
            // 只有远程版本比当前版本更高时才弹窗
            if (_compareVersions(latestTag, currentVer) <= 0) {
                console.log('[update] 当前已是最新版本 v' + currentVer + '（远程 v' + latestTag + '）');
                return;
            }

            var downloadUrl = GITHUB_DOWNLOAD_LATEST_URL;
            if (data.assets && data.assets.length > 0) {
                for (var i = 0; i < data.assets.length; i++) {
                    if (data.assets[i].name && data.assets[i].name.endsWith('.apk')) {
                        downloadUrl = data.assets[i].browser_download_url;
                        break;
                    }
                }
            }

            // 检查是否已经忽略过此版本
            localforage.getItem(ignoredKey).then(function (ignoredVer) {
                if (ignoredVer === latestTag) {
                    console.log('[update] 版本 v' + latestTag + ' 已被用户忽略，跳过弹窗');
                    return;
                }
                // 显示更新弹窗
                _showUpdateModal(latestTag, currentVer, downloadUrl);
            }).catch(function () {
                // localforage 不可用时直接弹窗
                _showUpdateModal(latestTag, currentVer, downloadUrl);
            });
        })
        .catch(function (err) {
            console.warn('[update] 自动检查更新失败:', err.message || err);
        });
}

// 显示版本更新弹窗
function _showUpdateModal(latestTag, currentVer, downloadUrl) {
    var modal = document.getElementById('update-available-modal');
    if (!modal) {
        if (confirm('发现新版本 v' + latestTag + '！\n当前版本: v' + currentVer + '\n\n是否立即下载更新？')) {
            _downloadAndInstallApk(downloadUrl, latestTag);
        }
        return;
    }

    // 更新弹窗内容
    var newVerEl = document.getElementById('update-new-version');
    var curVerEl = document.getElementById('update-current-version');
    if (newVerEl) newVerEl.textContent = 'v' + latestTag;
    if (curVerEl) curVerEl.textContent = currentVer;

    // 重置进度区域为隐藏
    var progressSection = document.getElementById('update-progress-section');
    var infoSection = document.getElementById('update-info-section');
    var buttonsSection = document.getElementById('update-buttons-section');
    var githubBtn = document.getElementById('update-github-btn');
    if (progressSection) progressSection.style.display = 'none';
    if (infoSection) infoSection.style.display = '';
    if (buttonsSection) buttonsSection.style.display = '';
    if (githubBtn) {
        githubBtn.style.display = '';
        githubBtn.textContent = '';
        var ghIcon = document.createElement('i');
        ghIcon.className = 'fab fa-github';
        ghIcon.style.marginRight = '4px';
        githubBtn.appendChild(ghIcon);
        githubBtn.appendChild(document.createTextNode('GitHub 下载'));
    }

    // 保存待处理信息
    _updatePendingInfo = { latestTag: latestTag, downloadUrl: downloadUrl };

    // 绑定按钮事件（只绑定一次）
    var ignoreBtn = document.getElementById('update-ignore-btn');
    var downloadBtn = document.getElementById('update-download-btn');

    if (ignoreBtn && !ignoreBtn._updateBound) {
        ignoreBtn._updateBound = true;
        ignoreBtn.addEventListener('click', function () {
            var ignoredKey = (typeof APP_PREFIX !== 'undefined' ? APP_PREFIX : 'CHAT_APP_V3_') + 'ignored_update_version';
            localforage.setItem(ignoredKey, _updatePendingInfo.latestTag).catch(function () {});
            if (typeof hideModal === 'function') hideModal(modal);
            _updatePendingInfo = null;
        });
    }

    if (githubBtn && !githubBtn._updateBound) {
        githubBtn._updateBound = true;
        githubBtn.addEventListener('click', function () {
            // 跳转到 GitHub Release 页面，用户可手动下载 APK
            if (typeof showNotification === 'function') showNotification('正在跳转 GitHub Release...', 'info', 2000);
            try { window.open(GITHUB_RELEASES_URL, '_blank'); } catch (e) {
                // WebView 环境兜底：用 location.href（如果支持）
                if (window.Android && typeof window.Android.openUrl === 'function') {
                    window.Android.openUrl(GITHUB_RELEASES_URL);
                } else {
                    location.href = GITHUB_RELEASES_URL;
                }
            }
        });
    }

    if (downloadBtn && !downloadBtn._updateBound) {
        downloadBtn._updateBound = true;
        downloadBtn.addEventListener('click', function () {
            if (_updatePendingInfo) {
                // 隐藏信息区，显示进度区
                if (infoSection) infoSection.style.display = 'none';
                if (buttonsSection) buttonsSection.style.display = 'none';
                if (progressSection) progressSection.style.display = '';
                _downloadAndInstallApk(_updatePendingInfo.downloadUrl, _updatePendingInfo.latestTag);
                _updatePendingInfo = null;
            }
        });
    }

    if (typeof showModal === 'function') showModal(modal);
}

// 手动检查更新（设置页面调用，忽略已忽略的版本，直接弹出）
function checkAppUpdateDM() {
    var statusEl = document.getElementById('dm-update-status');
    if (statusEl) {
        statusEl.textContent = '正在检查更新...';
        statusEl.style.color = 'var(--text-secondary)';
    }

    fetch(GITHUB_API_URL, { headers: { 'Accept': 'application/vnd.github.v3+json' } })
        .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(function (data) {
            var latestTag = (data.tag_name || '').replace(/^v/, '');
            var currentVer = APP_VERSION.replace(/^v/, '');
            var downloadUrl = GITHUB_DOWNLOAD_LATEST_URL;

            if (data.assets && data.assets.length > 0) {
                for (var i = 0; i < data.assets.length; i++) {
                    if (data.assets[i].name && data.assets[i].name.endsWith('.apk')) {
                        downloadUrl = data.assets[i].browser_download_url;
                        break;
                    }
                }
            }

            if (!latestTag || _compareVersions(latestTag, currentVer) <= 0) {
                if (statusEl) {
                    statusEl.textContent = '已是最新版本 v' + currentVer;
                    statusEl.style.color = '#4caf50';
                }
                if (typeof showNotification === 'function') showNotification('已是最新版本 v' + currentVer, 'success');
            } else {
                if (statusEl) {
                    statusEl.textContent = '发现新版本 v' + latestTag + '，点击下载';
                    statusEl.style.color = '#e53935';
                }
                // 手动检查时清除忽略记录，强制弹窗
                var ignoredKey = (typeof APP_PREFIX !== 'undefined' ? APP_PREFIX : 'CHAT_APP_V3_') + 'ignored_update_version';
                localforage.removeItem(ignoredKey).catch(function () {});
                _showUpdateModal(latestTag, currentVer, downloadUrl);
            }
        })
        .catch(function (err) {
            console.warn('[update] API 检查失败:', err.message || err);
            if (statusEl) {
                statusEl.textContent = '网络错误，点击打开下载页';
                statusEl.style.color = 'var(--text-secondary)';
            }
            // 点击状态文字时打开下载页
            if (statusEl && !statusEl._clickBound) {
                statusEl._clickBound = true;
                statusEl.style.cursor = 'pointer';
                statusEl.addEventListener('click', function () {
                    window.open(GITHUB_RELEASES_URL, '_blank');
                });
            }
        });
}

// 下载 APK 并触发安装
// 优先使用原生 NotificationPlugin.downloadApk（下载+安装），JS 轮询 getDownloadProgress 获取进度
// 原生不可用时回退到浏览器下载
function _downloadAndInstallApk(downloadUrl, version) {
    var progressBar = document.getElementById('update-progress-bar');
    var progressPercent = document.getElementById('update-progress-percent');
    var progressText = document.getElementById('update-progress-text');
    var progressStatus = document.getElementById('update-progress-status');
    var buttonsSection = document.getElementById('update-buttons-section');
    var progressSection = document.getElementById('update-progress-section');

    // 更新进度 UI
    function updateProgress(pct, downloaded, total) {
        if (progressBar) progressBar.style.width = pct + '%';
        if (progressPercent) progressPercent.textContent = pct + '%';
        if (progressText) progressText.textContent = '正在下载更新...';
        if (progressStatus) {
            if (total > 0) {
                var downloadedMB = (downloaded / 1048576).toFixed(1);
                var totalMB = (total / 1048576).toFixed(1);
                progressStatus.textContent = downloadedMB + ' MB / ' + totalMB + ' MB';
            } else {
                progressStatus.textContent = '正在连接...';
            }
        }
    }

    // 完成后的处理
    function onComplete() {
        if (progressBar) progressBar.style.width = '100%';
        if (progressPercent) progressPercent.textContent = '100%';
        if (progressText) progressText.textContent = '下载完成';
        if (progressStatus) progressStatus.textContent = '即将安装更新...';
        if (typeof showNotification === 'function') showNotification('下载完成，即将安装更新', 'success', 3000);
    }

    // 失败处理
    function onError(msg) {
        console.warn('[update] 下载失败:', msg);
        if (progressText) progressText.textContent = '下载失败';
        if (progressStatus) progressStatus.textContent = (msg || '请检查网络后重试') + '（可点击下方按钮跳转 GitHub 手动下载）';
        if (typeof showNotification === 'function') showNotification('下载失败，请重试或跳转 GitHub 手动下载', 'error', 4000);
        if (buttonsSection) buttonsSection.style.display = '';
        if (progressSection) progressSection.style.display = 'none';
        var githubBtn = document.getElementById('update-github-btn');
        if (githubBtn) {
            githubBtn.style.display = '';
            githubBtn.textContent = '';
            var ghIcon = document.createElement('i');
            ghIcon.className = 'fab fa-github';
            ghIcon.style.marginRight = '4px';
            githubBtn.appendChild(ghIcon);
            githubBtn.appendChild(document.createTextNode('GitHub 下载'));
        }
        var ignoreBtn = document.getElementById('update-ignore-btn');
        if (ignoreBtn) ignoreBtn.style.display = 'none';
        var downloadBtn = document.getElementById('update-download-btn');
        if (downloadBtn) {
            downloadBtn.textContent = '重试更新';
            downloadBtn.onclick = function () {
                if (ignoreBtn) ignoreBtn.style.display = '';
                if (buttonsSection) buttonsSection.style.display = 'none';
                if (progressSection) progressSection.style.display = '';
                _downloadAndInstallApk(downloadUrl, version);
            };
        }
    }

    // 方案1：原生环境使用 NotificationPlugin（下载+进度轮询+安装）
    var isNative = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web';
    var notifPlugin = isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.NotificationPlugin;

    if (notifPlugin && typeof notifPlugin.downloadApk === 'function' && typeof notifPlugin.getDownloadProgress === 'function') {
        if (progressText) progressText.textContent = '正在下载更新...';
        if (progressStatus) progressStatus.textContent = '正在连接...';

        // 启动原生下载
        var downloadPromise = notifPlugin.downloadApk({ url: downloadUrl, version: version });

        // 轮询进度（每 500ms）
        var pollTimer = setInterval(function () {
            notifPlugin.getDownloadProgress().then(function (state) {
                if (!state || !state.active) {
                    // 下载已结束（可能已完成或已失败）
                    clearInterval(pollTimer);
                    return;
                }
                updateProgress(state.progress || 0, state.downloadedBytes || 0, state.totalBytes || 0);
            }).catch(function () {
                // 轮询失败，忽略
            });
        }, 500);

        // 处理下载结果
        downloadPromise.then(function (result) {
            clearInterval(pollTimer);
            if (result && result.success) {
                onComplete();
            }
        }).catch(function (err) {
            clearInterval(pollTimer);
            onError('下载失败: ' + (err.message || err));
        });
        return;
    }

    // 方案2：回退 — 浏览器直接下载
    if (typeof showNotification === 'function') showNotification('正在跳转下载...', 'info', 2000);
    window.open(downloadUrl, '_blank');
}

// 兼容旧版 disclaimer modal 中的按钮
function checkAppUpdate() {
    checkAppUpdateDM();
}

// 初始化版本号显示
(function () {
    var el = document.getElementById('app-version-info');
    if (el) el.textContent = '当前版本: v' + APP_VERSION;
    var dmEl = document.getElementById('dm-update-status');
    if (dmEl) dmEl.textContent = '当前版本 v' + APP_VERSION;
})();
