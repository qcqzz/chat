document.addEventListener('DOMContentLoaded', async () => {
    const loaderBar = document.getElementById('loader-tech-bar');
    const welcomeSubtitle = document.querySelector('.welcome-subtitle-scramble');
    const welcomeScreen = document.getElementById('welcome-animation');
    const disclaimerModal = document.getElementById('disclaimer-modal');
    const acceptDisclaimerBtn = document.getElementById('accept-disclaimer');

    const updateLoader = (text, width) => {
        if (welcomeSubtitle) welcomeSubtitle.textContent = text;
        if (loaderBar) loaderBar.style.width = width;
    };

    const hideWelcomeScreen = () => {
        if (!welcomeScreen) return;
        welcomeScreen.classList.add('hidden');
        setTimeout(() => {
            welcomeScreen.style.display = 'none';
        }, 800);
    };

    const safeAwait = async (promise, fallback = null) => {
        try {
            return await promise;
        } catch (error) {
            console.error('操作失败:', error);
            return fallback;
        }
    };

    try {
        try { setupEventListeners?.(); } catch(e) { console.error('setupEventListeners:', e); }

        if (typeof localforage === 'undefined') {
            console.warn('LocalForage 未加载，将使用 localStorage 降级方案');
        }

        try {
            const emergencyBackupRaw = localStorage.getItem('BACKUP_V1_critical');
            if (emergencyBackupRaw) {
                const emergencyBackup = JSON.parse(emergencyBackupRaw);
                if (emergencyBackup && Array.isArray(emergencyBackup.messages) && emergencyBackup.messages.length > 0) {
                    console.warn('[boot] 检测到紧急备份，可用于异常恢复');
                }
            }
        } catch (e) {
            console.warn('[boot] 紧急备份检查失败:', e);
        }

        updateLoader('正在建立安全连接...', '10%');
        await safeAwait(initializeSession());

        updateLoader('正在读取记忆存档...', '40%');
        await safeAwait(loadData());

        updateLoader('正在渲染我们的世界...', '70%');
        
        await Promise.allSettled([
            safeAwait(initializeRandomUI?.()),
            safeAwait(initMusicPlayer?.())
        ]);

        setInterval(checkStatusChange, 60000);

        if (disclaimerModal) {
            const tourSeen = await safeAwait(localforage?.getItem(APP_PREFIX + 'tour_seen'), false);
            
            if (!tourSeen) {
                showModal(disclaimerModal);
                
                if (acceptDisclaimerBtn && !acceptDisclaimerBtn._bound) {
                    acceptDisclaimerBtn._bound = true;
                    acceptDisclaimerBtn.addEventListener('click', () => {
                        hideModal(disclaimerModal);
                        localforage?.setItem(APP_PREFIX + 'tour_seen', true).catch(() => {});
                        startTour?.();
                    }, { once: true });
                }
            }
        }

        updateLoader('连接成功，欢迎回来。', '100%');
        setTimeout(hideWelcomeScreen, 3500);

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                try {
                    if (typeof saveTimeout !== 'undefined') clearTimeout(saveTimeout);
                } catch (e) {}
                try { _backupCriticalData(); } catch (e) { console.warn('[visibilitychange] 紧急备份失败:', e); }
                try {
                    const p = saveData();
                    if (p && typeof p.catch === 'function') {
                        p.catch(e => console.error('[visibilitychange] 保存失败:', e));
                    }
                } catch (e) {
                    console.error('[visibilitychange] 保存失败:', e);
                }
            } else if (document.visibilityState === 'visible') {
                try {
                    const backup = typeof _tryRecoverFromBackup === 'function' ? _tryRecoverFromBackup() : null;
                    if (backup && Array.isArray(backup.messages) && backup.messages.length > 0 && Array.isArray(messages) && backup.messages.length > messages.length) {
                        console.warn('[visibilitychange] 检测到备份消息比当前更多，自动尝试恢复');
                        try {
                            messages = backup.messages.map(m => ({
                                ...m,
                                timestamp: new Date(m.timestamp)
                            }));
                            if (backup.settings) Object.assign(settings, backup.settings);
                            if (typeof updateUI === 'function') updateUI();
                            if (typeof throttledSaveData === 'function') throttledSaveData();
                            showNotification('已自动恢复本地临时备份内容', 'warning', 3500);
                        } catch (restoreErr) {
                            console.warn('[visibilitychange] 自动恢复失败，保留当前页面内容:', restoreErr);
                        }
                    }
                } catch (e) {
                    console.warn('[visibilitychange] 恢复备份失败:', e);
                }
            }
        });

        window.addEventListener('pagehide', () => {
            try { _backupCriticalData(); } catch (e) {}
        });

        window.addEventListener('beforeunload', () => {
            try { _backupCriticalData(); } catch (e) {}
        });

        setInterval(() => {
            saveData().catch(e => console.warn('[autoBackup] 定时保存失败:', e));
        }, 3 * 60 * 1000);

        (() => {
            const REMIND_KEY = 'exportReminderLastShown';
            const last = parseInt(localStorage.getItem(REMIND_KEY) || '0', 10);
            const daysSince = (Date.now() - last) / (1000 * 60 * 60 * 24);
            if (daysSince >= 7) {
                setTimeout(() => {
                    showNotification('建议定期导出备份，防止数据意外丢失', 'info', 7000);
                    localStorage.setItem(REMIND_KEY, String(Date.now()));
                }, 8000);
            }
        })();

        setTimeout(async () => {
            if ('Notification' in window && Notification.permission === 'default') {
                try {
                    const permission = await Notification.requestPermission();
                    if (permission === 'granted') {
                        showNotification('已开启系统通知，收到消息时会提醒你', 'success', 3000);
                    }
                } catch(e) {
                    console.warn('通知权限请求失败:', e);
                }
            }
        }, 3000);

    } catch (err) {
        console.error('严重初始化错误:', err);
        try {
            const backup = typeof _tryRecoverFromBackup === 'function' ? _tryRecoverFromBackup() : null;
            if (backup && Array.isArray(backup.messages) && backup.messages.length > 0) {
                messages = backup.messages.map(m => ({
                    ...m,
                    timestamp: new Date(m.timestamp)
                }));
                if (backup.settings) Object.assign(settings, backup.settings);
                if (typeof updateUI === 'function') updateUI();
                showNotification('初始化异常，已使用本地紧急备份恢复', 'warning', 5000);
            }
        } catch (recoverErr) {
            console.warn('[boot] 初始化失败后的恢复也失败:', recoverErr);
        }
        updateLoader('加载遇到问题，已强制进入...', '100%');
        setTimeout(hideWelcomeScreen, 3500);
    }
});
const stickerInput = document.getElementById('sticker-file-input');
            if (stickerInput) {
                stickerInput.addEventListener('change', async (e) => {
                    const files = Array.from(e.target.files);
                    if (!files.length) return;

                    const oversized = files.filter(f => f.size > 2 * 1024 * 1024);
                    if (oversized.length > 0) {
                        showNotification(oversized.length + ' 张图片超过 2MB 限制，已跳过', 'warning');
                    }

                    const validFiles = files.filter(f => f.size <= 2 * 1024 * 1024);
                    if (!validFiles.length) return;

                    showNotification('正在批量处理 ' + validFiles.length + ' 张图片...', 'info');

                    let successCount = 0;
                    let failCount = 0;
                    const cloudReady = !!(window.CloudMedia && window.CloudSync && window.CloudSync.isConnected());

                    for (const file of validFiles) {
                        try {
                            const base64 = await optimizeImage(file, 300, 0.8);
                            let toStore = base64;
                            // 阶段三B：连了云端就上传，本地只存 oss:// 引用
                            if (cloudReady) {
                                try {
                                    const r = await window.CloudMedia.upload(base64, 'stickers');
                                    toStore = r.url;
                                } catch (upErr) {
                                    console.warn('[cloud-media] 贴纸上传失败，降级本地', upErr);
                                    // toStore 保持 base64
                                }
                            }
                            stickerLibrary.push(toStore);
                            successCount++;
                        } catch (err) {
                            console.error(err);
                            failCount++;
                        }
                    }

                    throttledSaveData();
                    renderReplyLibrary();

                    if (failCount > 0) {
                        showNotification('上传完成：' + successCount + ' 张成功，' + failCount + ' 张失败', 'warning');
                    } else {
                        showNotification('上传成功，共 ' + successCount + ' 张', 'success');
                    }

                    e.target.value = '';
                });
            }
const myStickerQuickUpload = document.getElementById('my-sticker-quick-upload');
if (myStickerQuickUpload) {
    myStickerQuickUpload.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        const oversized = files.filter(f => f.size > 2 * 1024 * 1024);
        if (oversized.length > 0) showNotification(oversized.length + ' 张图片超过 2MB，已跳过', 'warning');
        const validFiles = files.filter(f => f.size <= 2 * 1024 * 1024);
        if (!validFiles.length) return;
        showNotification('正在处理 ' + validFiles.length + ' 张...', 'info');
        let ok = 0, fail = 0;
        const newStickers = [];
        const cloudReady = !!(window.CloudMedia && window.CloudSync && window.CloudSync.isConnected());
        for (const file of validFiles) {
            try {
                const base64 = await optimizeImage(file, 300, 0.8);
                let toStore = base64;
                if (cloudReady) {
                    try {
                        const r = await window.CloudMedia.upload(base64, 'my-stickers');
                        toStore = r.url;
                    } catch (upErr) {
                        console.warn('[cloud-media] 我的贴纸上传失败，降级本地', upErr);
                    }
                }
                newStickers.push(toStore);
                ok++;
            } catch(err) { fail++; }
        }
        // 新表情插到最前面，批量上传时保持原顺序
        myStickerLibrary.unshift(...newStickers);
        throttledSaveData();
        if (typeof renderComboContent === 'function') renderComboContent('my-sticker');
        showNotification(fail > 0 ? `上传完成：${ok} 成功 ${fail} 失败` : `✓ 已添加 ${ok} 张到我的表情库`, fail > 0 ? 'warning' : 'success');
        e.target.value = '';
    });
}

// 启动时检查闪退未结束的陪伴会话（独立于 load 事件，确保一定执行）
(function() {
    function _cdRecLog(msg, data) {
        try {
            const logs = JSON.parse(localStorage.getItem('_cdRecLogs') || '[]');
            logs.push({ t: new Date().toLocaleTimeString(), msg: msg, data: data === undefined ? '' : JSON.stringify(data) });
            if (logs.length > 50) logs.splice(0, logs.length - 50);
            localStorage.setItem('_cdRecLogs', JSON.stringify(logs));
        } catch (e) {}
        try { console.log('[cdRec]', msg, data !== undefined ? data : ''); } catch (e) {}
    }

    _cdRecLog('script 已加载，准备启动检查');

    async function doRecoverCheck(attempt) {
        attempt = attempt || 1;
        _cdRecLog('开始恢复检查，第 ' + attempt + ' 次');
        try {
            if (!window.localforage) {
                _cdRecLog('❌ localforage 未加载');
                if (attempt < 5) setTimeout(() => doRecoverCheck(attempt + 1), 2000);
                return;
            }

            // 直接扫描所有 key，找含 companionLiveSession 的那个
            // 这样不依赖 SESSION_ID 是否初始化
            const allKeys = await localforage.keys();
            _cdRecLog('localforage key 总数', allKeys.length);

            const sessionKeys = allKeys.filter(k => k.indexOf('companionLiveSession') !== -1);
            _cdRecLog('匹配的 session key', sessionKeys);

            if (sessionKeys.length === 0) {
                _cdRecLog('无未结束的会话');
                return;
            }

            // 取最近一条（按心跳时间排序，最新的优先）
            let bestSession = null;
            let bestKey = null;
            for (const k of sessionKeys) {
                const s = await localforage.getItem(k);
                if (s && s.mode && s.heartbeatTs) {
                    if (!bestSession || s.heartbeatTs > bestSession.heartbeatTs) {
                        bestSession = s;
                        bestKey = k;
                    }
                }
            }

            _cdRecLog('最近的会话 key', bestKey);
            _cdRecLog('会话数据', bestSession);

            if (!bestSession) {
                _cdRecLog('所有 key 都是空数据，清理');
                for (const k of sessionKeys) {
                    await localforage.removeItem(k).catch(() => {});
                }
                return;
            }

            const elapsedSinceHeartbeat = Date.now() - bestSession.heartbeatTs;
            _cdRecLog('心跳距今秒数', Math.floor(elapsedSinceHeartbeat / 1000));

            if (elapsedSinceHeartbeat > 24 * 60 * 60 * 1000) {
                _cdRecLog('超过 24 小时，丢弃');
                await localforage.removeItem(bestKey).catch(() => {});
                return;
            }

            // 新逻辑：按真实墙上时间计算
            // 不再"暂停时间"，而是"时间一直在跑"
            const realElapsedSec = Math.floor((Date.now() - bestSession.startTs) / 1000)
                                 + (bestSession.accumulatedExtendTime || 0);
            _cdRecLog('从开始时间到现在的真实秒数', realElapsedSec);

            // 把找到的真实 key 存起来，方便弹窗按钮使用
            window.__cdRecoverFoundKey = bestKey;
            window.__cdRecoverFoundSession = bestSession;
            bestSession._realElapsedSec = realElapsedSec;

            // 如果是倒计时模式 + 时间已经到了 → 自动写入日记 + 弹"已结束"提示
            if (bestSession.isCountdown && realElapsedSec >= bestSession.totalSeconds) {
                _cdRecLog('✓ 倒计时已到，自动写入日记 + 弹结束提示');
                // 用正常的字卡逻辑（30% 概率不写、70% 抽 1-2 句）
                const partnerNote = (typeof window.pickCompanionDiaryCards === 'function')
                    ? window.pickCompanionDiaryCards()
                    : '';
                if (typeof window.addCompanionDiaryEntry === 'function') {
                    await window.addCompanionDiaryEntry({
                        ts: bestSession.startTs,
                        mode: bestSession.mode,
                        duration: bestSession.totalSeconds, // 完整时长
                        initiator: bestSession.initiator || 'user',
                        partnerNote: partnerNote,
                        userNote: ''
                    });
                    _cdRecLog('✓ 日记已写入');
                }
                await localforage.removeItem(bestKey).catch(() => {});
                // 弹"已结束"提示窗
                if (typeof showCompanionCompletedDialog === 'function') {
                    showCompanionCompletedDialog(bestSession);
                    _cdRecLog('✓ 已结束提示已显示');
                } else {
                    setTimeout(() => {
                        if (typeof showCompanionCompletedDialog === 'function') {
                            showCompanionCompletedDialog(bestSession);
                        }
                    }, 2000);
                }
                return;
            }

            _cdRecLog('✓ 准备显示恢复弹窗');
            if (typeof showCompanionRecoverDialog === 'function') {
                showCompanionRecoverDialog(bestSession);
                _cdRecLog('✓ 弹窗函数已调用');
            } else {
                _cdRecLog('❌ showCompanionRecoverDialog 函数不存在，等待 2 秒后重试');
                setTimeout(() => {
                    if (typeof showCompanionRecoverDialog === 'function') {
                        showCompanionRecoverDialog(bestSession);
                        _cdRecLog('✓ 重试成功，弹窗函数已调用');
                    } else {
                        _cdRecLog('❌ 重试后仍无 showCompanionRecoverDialog');
                    }
                }, 2000);
            }
        } catch(e) {
            _cdRecLog('❌ 异常', String(e && e.message || e));
        }
    }

    // 8 秒后启动（给 localforage、SESSION_ID 充足初始化时间）
    setTimeout(() => doRecoverCheck(1), 8000);

    // 通话闪退恢复（独立于陪伴的）
    async function doCallRecoverCheck(attempt) {
        attempt = attempt || 1;
        try {
            if (!window.localforage) {
                if (attempt < 5) setTimeout(() => doCallRecoverCheck(attempt + 1), 2000);
                return;
            }
            if (!window._callModule || !window._callModule.getCallSessionKey) {
                if (attempt < 5) setTimeout(() => doCallRecoverCheck(attempt + 1), 2000);
                return;
            }

            // 扫描 callLiveSession 相关 key
            const allKeys = await localforage.keys();
            const sessionKeys = allKeys.filter(k => k.indexOf('callLiveSession') !== -1);
            if (sessionKeys.length === 0) return;

            // 取最新的
            let bestSession = null;
            let bestKey = null;
            for (const k of sessionKeys) {
                const s = await localforage.getItem(k);
                if (s && s.startTs && s.heartbeatTs) {
                    if (!bestSession || s.heartbeatTs > bestSession.heartbeatTs) {
                        bestSession = s;
                        bestKey = k;
                    }
                }
            }

            if (!bestSession) {
                // 清理无效数据
                for (const k of sessionKeys) {
                    await localforage.removeItem(k).catch(() => {});
                }
                return;
            }

            // 直接恢复通话（不弹任何窗），并弹一个 toast 提示
            const ok = window._callModule.resumeFromSession(bestSession);
            if (ok) {
                if (typeof showNotification === 'function') {
                    showNotification('通话已恢复', 'success', 3000);
                }
            } else {
                // 恢复失败 → 清掉这个 session
                await localforage.removeItem(bestKey).catch(() => {});
            }
        } catch (e) {
            console.warn('[call-recover] error:', e);
        }
    }
    setTimeout(() => doCallRecoverCheck(1), 8500);
})();

window.addEventListener('load', function() {
    // 阶段三B：恢复未完成的图片上传队列（页面刷新后继续传）
    setTimeout(function () {
        if (!window.CloudMedia || typeof window.CloudMedia.restorePendingQueue !== 'function') return;
        window.CloudMedia.restorePendingQueue(function (taskId, record) {
            var msgId = record && record.messageId;
            if (msgId == null) return null;
            return async function (result) {
                try {
                    if (typeof messages === 'undefined' || !Array.isArray(messages)) return;
                    var target = messages.find(function (m) { return String(m.id) === String(msgId); });
                    if (!target) return;
                    target.image = result.url;
                    delete target.uploadStatus;
                    try { if (typeof throttledSaveData === 'function') throttledSaveData(); } catch (e) {}
                    try {
                        var wrapper = document.querySelector('.message-wrapper[data-id="' + msgId + '"]');
                        if (wrapper) {
                            var wrap = wrapper.querySelector('.message-image-pending-wrap');
                            if (wrap) {
                                var img = wrap.querySelector('img');
                                var parent = wrap.parentNode;
                                if (img && parent) {
                                    var blobUrl = null;
                                    try {
                                        blobUrl = window.CloudMedia ? await window.CloudMedia.fetchUrl(result.url) : null;
                                    } catch (fetchErr) {
                                        console.warn('[cloud-media] restore 拉图失败', fetchErr);
                                    }
                                    img.removeAttribute('data-pending-ref');
                                    img.setAttribute('onclick', "viewImage('" + result.url + "')");
                                    if (blobUrl) {
                                        img.src = blobUrl;
                                    } else {
                                        img.src = '';
                                        img.setAttribute('data-lazy-cloud-ref', result.url);
                                        if (window.CloudMedia) window.CloudMedia.bindLazyImage(img, result.url);
                                    }
                                    parent.replaceChild(img, wrap);
                                }
                            }
                        }
                    } catch (e) { console.warn('[cloud-media] restore 局部更新失败', e); }
                } catch (e) { console.warn(e); }
            };
        });
    }, 3000);

    setTimeout(function() {
        try {
            if (localStorage.getItem('dailyGreetingShown') === new Date().toDateString()) return;
            try { if (typeof checkPartnerDailyMood === 'function') checkPartnerDailyMood(); } catch(e2) { console.warn('checkPartnerDailyMood error:', e2); }
            if (typeof _buildDailyGreeting === 'function') _buildDailyGreeting();
            if (window.localforage && window.APP_PREFIX) {
                localforage.getItem(window.APP_PREFIX + 'tour_seen').then(function(seen) {
                    if (seen) {
                        var modal = document.getElementById('daily-greeting-modal');
                        if (modal) modal.classList.remove('hidden');
                        localStorage.setItem('dailyGreetingShown', new Date().toDateString());
                    }
                }).catch(function() {
                    var modal = document.getElementById('daily-greeting-modal');
                    if (modal) modal.classList.remove('hidden');
                    localStorage.setItem('dailyGreetingShown', new Date().toDateString());
                });
            } else {
                var modal = document.getElementById('daily-greeting-modal');
                if (modal) modal.classList.remove('hidden');
                localStorage.setItem('dailyGreetingShown', new Date().toDateString());
            }
        } catch(e) { console.warn('Daily greeting timing error:', e); }

        // 启动时检查梦角是否主动来信
        try {
            if (typeof checkEnvelopeStatus === 'function') {
                checkEnvelopeStatus().catch(function(e) { console.warn('envelope launch check error:', e); });
            }
        } catch(e) { console.warn('envelope launch check error:', e); }
    }, 4500);
}, { once: true });

// 陪伴闪退恢复弹窗
function showCompanionRecoverDialog(session) {
    const modeNames = { study: '学习', work: '工作', exercise: '运动', sleep: '睡觉' };
    const modeName = modeNames[session.mode] || '陪伴';
    const startTime = new Date(session.startTs);
    const startTimeStr = ('0' + startTime.getHours()).slice(-2) + ':' + ('0' + startTime.getMinutes()).slice(-2);

    // 用真实墙上时间算（不再用心跳）
    function calcElapsedSec() {
        return Math.max(0, Math.floor((Date.now() - session.startTs) / 1000) + (session.accumulatedExtendTime || 0));
    }
    function formatMin(sec) {
        const m = Math.floor(sec / 60);
        return m >= 60
            ? Math.floor(m / 60) + 'h ' + (m % 60) + 'min'
            : m + 'min';
    }

    let elapsedSec = calcElapsedSec();
    let canContinue = !(session.isCountdown && session.totalSeconds - elapsedSec <= 0);

    const overlay = document.createElement('div');
    overlay.id = 'companion-recover-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.25s ease;padding:20px;';

    overlay.innerHTML = `
        <div style="background:var(--secondary-bg);border-radius:20px;padding:24px 22px 20px;width:100%;max-width:340px;box-shadow:0 20px 60px rgba(0,0,0,0.4);font-family:var(--font-family);">
            <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:6px;display:flex;align-items:center;gap:8px;">
                <i class="fas fa-hourglass-half" style="color:var(--accent-color);"></i>
                上次陪伴还没结束
            </div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.7;margin-bottom:16px;">
                检测到一次未结束的「${modeName}」陪伴<br>
                · 开始时间：${startTimeStr}<br>
                · 已陪伴：<span id="_cmp_rec_elapsed">${formatMin(elapsedSec)}</span>
                ${session.isCountdown ? '<br>· 剩余时间：约 <span id="_cmp_rec_remaining">' + formatMin(Math.max(0, session.totalSeconds - elapsedSec)) + '</span>' : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;" id="_cmp_rec_btns">
                <button id="_cmp_rec_continue" style="padding:11px;border:none;border-radius:12px;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-family);${canContinue ? '' : 'display:none;'}">
                    <i class="fas fa-play" style="margin-right:6px;"></i>继续陪伴
                </button>
                <button id="_cmp_rec_save" style="padding:11px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);color:var(--text-primary);font-size:13px;cursor:pointer;font-family:var(--font-family);">
                    <i class="fas fa-save" style="margin-right:6px;color:var(--accent-color);"></i>结束并保存到日记
                </button>
                <button id="_cmp_rec_discard" style="padding:11px;border:1px solid var(--border-color);border-radius:12px;background:none;color:var(--text-secondary);font-size:12px;cursor:pointer;font-family:var(--font-family);">
                    丢弃这次陪伴
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // 每秒刷新：让用户看到时间一直在跑
    const tickHandle = setInterval(() => {
        const curElapsed = calcElapsedSec();
        const elEl = document.getElementById('_cmp_rec_elapsed');
        const remEl = document.getElementById('_cmp_rec_remaining');
        if (elEl) elEl.textContent = formatMin(curElapsed);

        if (session.isCountdown) {
            const remainSec = session.totalSeconds - curElapsed;
            if (remEl) remEl.textContent = formatMin(Math.max(0, remainSec));

            // 如果在弹窗页停留到时间过完了 → 自动转为"已结束"弹窗
            if (remainSec <= 0) {
                clearInterval(tickHandle);
                // 自动完成：写入日记，提示用户
                (async () => {
                    if (typeof window._companionRecoverModule !== 'undefined') {
                        // 用正常字卡逻辑
                        const partnerNote = (typeof window.pickCompanionDiaryCards === 'function')
                            ? window.pickCompanionDiaryCards()
                            : '';
                        if (typeof window.addCompanionDiaryEntry === 'function') {
                            await window.addCompanionDiaryEntry({
                                ts: session.startTs,
                                mode: session.mode,
                                duration: session.totalSeconds,
                                initiator: session.initiator || 'user',
                                partnerNote: partnerNote,
                                userNote: ''
                            });
                        }
                        window._companionRecoverModule.clearLiveSession();
                    }
                    closeDialog();
                    if (typeof showCompanionCompletedDialog === 'function') {
                        showCompanionCompletedDialog(session);
                    }
                })();
            }
        }
    }, 1000);

    function closeDialog() {
        clearInterval(tickHandle);
        overlay.remove();
    }

    const continueBtn = document.getElementById('_cmp_rec_continue');
    if (continueBtn) {
        continueBtn.onclick = function() {
            const ok = window._companionRecoverModule.resumeFromSession(session);
            if (!ok) {
                // 恢复失败 → 写日记
                window._companionRecoverModule.saveSessionAsDiary(session);
                window._companionRecoverModule.clearLiveSession();
            }
            closeDialog();
        };
    }
    document.getElementById('_cmp_rec_save').onclick = async function() {
        await window._companionRecoverModule.saveSessionAsDiary(session);
        window._companionRecoverModule.clearLiveSession();
        if (typeof showNotification === 'function') showNotification('已保存到陪伴日记', 'success');
        closeDialog();
    };
    document.getElementById('_cmp_rec_discard').onclick = function() {
        if (!confirm('确定丢弃这次陪伴记录吗？')) return;
        window._companionRecoverModule.clearLiveSession();
        closeDialog();
    };
}

// 陪伴已结束提示弹窗（倒计时模式：闪退后过太久，时间已经到了）
function showCompanionCompletedDialog(session) {
    const modeNames = { study: '学习', work: '工作', exercise: '运动', sleep: '睡觉' };
    const modeName = modeNames[session.mode] || '陪伴';
    const startTime = new Date(session.startTs);
    const startTimeStr = ('0' + startTime.getHours()).slice(-2) + ':' + ('0' + startTime.getMinutes()).slice(-2);

    const totalMin = Math.floor(session.totalSeconds / 60);
    const totalStr = totalMin >= 60
        ? Math.floor(totalMin / 60) + 'h' + (totalMin % 60 > 0 ? ' ' + (totalMin % 60) + 'min' : '')
        : totalMin + 'min';

    const overlay = document.createElement('div');
    overlay.id = 'companion-completed-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.25s ease;padding:20px;';

    overlay.innerHTML = `
        <div style="background:var(--secondary-bg);border-radius:20px;padding:24px 22px 20px;width:100%;max-width:340px;box-shadow:0 20px 60px rgba(0,0,0,0.4);font-family:var(--font-family);">
            <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:6px;display:flex;align-items:center;gap:8px;">
                <i class="fas fa-check-circle" style="color:var(--accent-color);"></i>
                上次陪伴已结束
            </div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.7;margin-bottom:16px;">
                这次「${modeName}」陪伴已经完整结束<br>
                · 开始时间：${startTimeStr}<br>
                · 陪伴时长：${totalStr}<br>
                <span style="color:var(--accent-color);">已自动保存到陪伴日记 📔</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
                <button id="_cmp_completed_ok" style="padding:11px;border:none;border-radius:12px;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-family);">
                    好的
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('_cmp_completed_ok').onclick = function() {
        overlay.remove();
    };
}

// ============================================
// 陪伴模式 (Companion Mode) - 新增功能
// ============================================
function selectCompanionMode(mode) {
    // mode 可以是: 'study' | 'work' | 'exercise' | 'sleep'
    const modeNames = {
        study: '陪我学习',
        work: '陪我工作',
        exercise: '陪我运动',
        sleep: '陪我睡觉'
    };

    const modeName = modeNames[mode] || '陪伴';

    // 关闭陪伴主弹窗
    const modal = document.getElementById('companion-modal');
    if (modal && typeof hideModal === 'function') {
        hideModal(modal);
    }

    // 子页面占位 —— 后续可在此处接入对应子功能
    // TODO: 后续接入 study / work / exercise / sleep 各自的子页面
    setTimeout(() => {
        if (typeof window.showToast === 'function') {
            window.showToast(`已选择「${modeName}」，子页面开发中...`);
        } else {
            alert(`已选择「${modeName}」，子页面开发中...`);
        }
    }, 300);
}


// ============================================
// TTS 真实语音 · 设置页逻辑
// ============================================
(function () {
    'use strict';

    let _lastSavedTtsConfig = null;
    let _ttsConfigDirty = false;
    let _ttsFieldsBound = false;

    const TTS_FIELD_IDS = ['tts-minimax-key', 'tts-group-id', 'tts-model', 'tts-voice-id'];

    function _normalizeTtsConfig(cfg) {
        cfg = cfg || {};
        let speed;
        if (cfg.speed === undefined || cfg.speed === null || cfg.speed === '') {
            speed = 1.0;
        } else {
            speed = Number(cfg.speed);
            if (!isFinite(speed)) speed = 1.0;
        }
        speed = Math.max(0.5, Math.min(2.0, speed));
        return {
            minimaxKey: String(cfg.minimaxKey || '').trim(),
            groupId: String(cfg.groupId || '').trim(),
            model: String(cfg.model || 'speech-02-turbo').trim() || 'speech-02-turbo',
            voiceId: String(cfg.voiceId || '').trim(),
            targetLang: String(cfg.targetLang || 'JA').trim() || 'JA',
            gender: String(cfg.gender || 'male').trim() || 'male',
            styleText: String(cfg.styleText || '').trim(),
            speed: speed
        };
    }

    function _readTtsFormConfig() {
        return _normalizeTtsConfig({
            minimaxKey: document.getElementById('tts-minimax-key')?.value,
            groupId: document.getElementById('tts-group-id')?.value,
            model: document.getElementById('tts-model')?.value,
            voiceId: document.getElementById('tts-voice-id')?.value,
            targetLang: _getSelectedTtsLang(),
            gender: document.querySelector('.tts-gender-btn.active')?.dataset.gender || 'male',
            styleText: (document.getElementById('tts-style-text')?.value || '').trim(),
            speed: document.getElementById('tts-speed')?.value
        });
    }

    function _isSameTtsConfig(a, b) {
        const left = _normalizeTtsConfig(a);
        const right = _normalizeTtsConfig(b);
        return left.minimaxKey === right.minimaxKey &&
            left.groupId === right.groupId &&
            left.model === right.model &&
            left.voiceId === right.voiceId &&
            left.targetLang === right.targetLang &&
            left.gender === right.gender &&
            left.styleText === right.styleText &&
            left.speed === right.speed;
    }

    function _paintTtsLangButtons(selectedLang) {
        document.querySelectorAll('.tts-lang-btn').forEach(btn => {
            const isActive = btn.dataset.lang === selectedLang;
            btn.classList.toggle('active', isActive);
            btn.style.border = isActive ? '1px solid var(--accent-color)' : '1px solid var(--border-color)';
            btn.style.background = isActive ? 'rgba(var(--accent-color-rgb),0.1)' : 'transparent';
            btn.style.color = isActive ? 'var(--accent-color)' : 'var(--text-secondary)';
            btn.style.fontWeight = isActive ? '600' : 'normal';
        });
        // 选原文时隐藏翻译选项
        const translateOpts = document.getElementById('tts-translate-options');
        if (translateOpts) translateOpts.style.display = selectedLang === 'RAW' ? 'none' : '';
    }

    function _getSelectedTtsLang() {
        return document.querySelector('.tts-lang-btn.active')?.dataset.lang || 'JA';
    }

    function _hasSavedTtsConfig() {
        const cfg = _normalizeTtsConfig(_lastSavedTtsConfig || {});
        return !!(cfg.minimaxKey || cfg.groupId || cfg.voiceId || cfg.model !== 'speech-02-turbo' || cfg.targetLang !== 'JA');
    }

    function _applyTtsSaveButtonState(isDirty) {
        const saveBtn = document.getElementById('tts-save-btn');
        if (!saveBtn) return;

        saveBtn.disabled = !isDirty;
        saveBtn.textContent = isDirty ? '保存配置' : (_hasSavedTtsConfig() ? '已保存' : '保存配置');
        saveBtn.style.background = isDirty ? 'var(--accent-color)' : 'var(--border-color)';
        saveBtn.style.color = isDirty ? '#fff' : 'var(--text-secondary)';
        saveBtn.style.cursor = isDirty ? 'pointer' : 'not-allowed';
        saveBtn.style.opacity = isDirty ? '1' : '0.65';
        saveBtn.style.boxShadow = isDirty ? '0 4px 14px rgba(var(--accent-color-rgb),0.24)' : 'none';
        saveBtn.style.transform = 'none';
    }

    function _setTtsDirty(isDirty) {
        _ttsConfigDirty = !!isDirty;
        _applyTtsSaveButtonState(_ttsConfigDirty);
        _updateTtsStatus();
    }

    function _checkTtsDirty() {
        if (!_lastSavedTtsConfig && window.voiceTTS) {
            _lastSavedTtsConfig = _normalizeTtsConfig(window.voiceTTS.getTtsConfig());
        }
        _setTtsDirty(!_isSameTtsConfig(_readTtsFormConfig(), _lastSavedTtsConfig));
    }

    function _bindTtsFieldListeners() {
        if (_ttsFieldsBound) return;
        const fields = TTS_FIELD_IDS
            .map(id => document.getElementById(id))
            .filter(Boolean);
        if (fields.length !== TTS_FIELD_IDS.length) return;

        fields.forEach(el => {
            el.addEventListener('input', _checkTtsDirty);
            el.addEventListener('change', _checkTtsDirty);
        });
        _ttsFieldsBound = true;
    }

    // ─── 初始化：打开聊天设置时填入已保存的值 ───
    function _initTtsFields() {
        if (!window.voiceTTS) return;
        const cfg = _normalizeTtsConfig(window.voiceTTS.getTtsConfig());
        const mKey  = document.getElementById('tts-minimax-key');
        const gId   = document.getElementById('tts-group-id');
        const model = document.getElementById('tts-model');
        const vId   = document.getElementById('tts-voice-id');
        const styleText = document.getElementById('tts-style-text');
        const styleCount = document.getElementById('tts-style-count');
        const speedEl   = document.getElementById('tts-speed');
        const speedInput = document.getElementById('tts-speed-value'); // 现在是 input 不是 span
        if (mKey)  mKey.value  = cfg.minimaxKey;
        if (gId)   gId.value   = cfg.groupId;
        if (model) model.value = cfg.model;
        if (vId)   vId.value   = cfg.voiceId;
        if (styleText) { styleText.value = cfg.styleText || ''; }
        if (styleCount) styleCount.textContent = (cfg.styleText || '').length;
        if (speedEl)    speedEl.value = String(cfg.speed);
        if (speedInput) speedInput.value = cfg.speed.toFixed(2);
        // 滑块 ↔ 输入框双向同步 + dirty 检测（只绑一次）
        if (speedEl && !speedEl.dataset.bound) {
            speedEl.dataset.bound = '1';
            speedEl.addEventListener('input', () => {
                // 拖滑块 → 同步到输入框
                if (speedInput) speedInput.value = Number(speedEl.value).toFixed(2);
                _checkTtsDirty();
            });
        }
        if (speedInput && !speedInput.dataset.bound) {
            speedInput.dataset.bound = '1';
            // 输入框变化时 → 同步到滑块
            // 用 input 事件实时同步；用 change/blur 时做边界夹紧（避免打字打到一半被改值）
            speedInput.addEventListener('input', () => {
                const v = Number(speedInput.value);
                if (isFinite(v) && speedEl) {
                    // 实时反映到滑块（不强制夹边界，让用户继续打字）
                    speedEl.value = String(Math.max(0.5, Math.min(2, v)));
                }
                _checkTtsDirty();
            });
            const clampInput = () => {
                let v = Number(speedInput.value);
                if (!isFinite(v) || speedInput.value === '') v = 1.0;
                v = Math.max(0.5, Math.min(2, v));
                // 四舍五入到 0.01
                v = Math.round(v * 100) / 100;
                speedInput.value = v.toFixed(2);
                if (speedEl) speedEl.value = String(v);
                _checkTtsDirty();
            };
            speedInput.addEventListener('change', clampInput);
            speedInput.addEventListener('blur', clampInput);
            // 回车直接确认（防止表单意外提交）
            speedInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    clampInput();
                    speedInput.blur();
                }
            });
        }
        _lastSavedTtsConfig = cfg;
        _paintTtsLangButtons(cfg.targetLang);
        // 性别按钮高亮
        const savedGender = cfg.gender || 'male';
        document.querySelectorAll('.tts-gender-btn').forEach(btn => {
            const isActive = btn.dataset.gender === savedGender;
            btn.classList.toggle('active', isActive);
            btn.style.border = isActive ? '1px solid var(--accent-color)' : '1px solid var(--border-color)';
            btn.style.background = isActive ? 'rgba(var(--accent-color-rgb),0.1)' : 'transparent';
            btn.style.color = isActive ? 'var(--accent-color)' : 'var(--text-secondary)';
            btn.style.fontWeight = isActive ? '600' : 'normal';
        });
        _bindTtsFieldListeners();
        _setTtsDirty(false);
    }

    function _updateTtsStatus() {
        const el = document.getElementById('tts-status');
        if (!el || !window.voiceTTS) return;
        if (_ttsConfigDirty) {
            el.style.color = 'var(--accent-color)';
            el.textContent = '配置有修改，点击保存配置后才会生效';
            return;
        }
        if (window.voiceTTS.isTtsReady()) {
            el.style.color = '#4CAF50';
            el.textContent = '✓ 配置已保存，真实语音已启用';
        } else {
            el.style.color = 'var(--text-secondary)';
            el.textContent = '填写 MiniMax API Key、Group ID 和 Voice ID 后保存即可启用';
        }
    }

    // ─── 语言切换 ───
    window._setTtsLang = function(lang) {
        const nextLang = lang || 'JA';
        _paintTtsLangButtons(nextLang);
        _checkTtsDirty();
    };

    // ─── 性别切换 ───
    window._setTtsGender = function(gender, btn) {
        document.querySelectorAll('.tts-gender-btn').forEach(b => {
            const isActive = b === btn;
            b.classList.toggle('active', isActive);
            b.style.border = isActive ? '1px solid var(--accent-color)' : '1px solid var(--border-color)';
            b.style.background = isActive ? 'rgba(var(--accent-color-rgb),0.1)' : 'transparent';
            b.style.color = isActive ? 'var(--accent-color)' : 'var(--text-secondary)';
            b.style.fontWeight = isActive ? '600' : 'normal';
        });
        _checkTtsDirty();
    };

    // ─── 风格预设 ───
    window._setTtsStylePreset = function(btn) {
        const styleText = document.getElementById('tts-style-text');
        const styleCount = document.getElementById('tts-style-count');
        if (styleText) {
            styleText.value = btn.dataset.style || '';
            if (styleCount) styleCount.textContent = styleText.value.length;
        }
        _checkTtsDirty();
    };

    // ─── 保存配置 ───
    window._saveTtsConfig = function () {
        if (!window.voiceTTS || !_ttsConfigDirty) return;
        const cfg = _readTtsFormConfig();
        window.voiceTTS.saveTtsConfig(cfg.minimaxKey, cfg.groupId, cfg.voiceId, cfg.model, cfg.targetLang, cfg.gender, cfg.styleText, cfg.speed);
        _lastSavedTtsConfig = cfg;
        _setTtsDirty(false);
        // 清掉内存缓存，让下次点击用新设置重新翻译+TTS
        // 注意：IndexedDB 里的收藏音频不动
        if (window.voiceTTS.clearMemoryCache) window.voiceTTS.clearMemoryCache();
        if (typeof showNotification === 'function') {
            showNotification('配置已保存，语音缓存已重置', 'success');
        }
    };

    // ─── 试听：用当前表单状态合成测试句，按滑块语速本地播放 ───
    // 不读 / 不写 localStorage，所以可以在「保存」之前就听到效果。
    let _speedPreviewAudio = null;
    window._previewTts = async function () {
        if (!window.voiceTTS) return;
        const btn   = document.getElementById('tts-preview-btn');
        const label = document.getElementById('tts-preview-label');
        const speedEl = document.getElementById('tts-speed');

        // 正在播放 → 再点一次=停止
        if (_speedPreviewAudio && !_speedPreviewAudio.paused) {
            try { _speedPreviewAudio.pause(); } catch (_) {}
            _speedPreviewAudio = null;
            if (label) label.textContent = '试听';
            return;
        }

        const cfg = _readTtsFormConfig();
        if (!cfg.minimaxKey || !cfg.groupId || !cfg.voiceId) {
            if (typeof showNotification === 'function') {
                showNotification('请先填写 MiniMax Key、Group ID 和 Voice ID', 'error');
            }
            return;
        }

        if (btn) btn.disabled = true;
        if (label) label.textContent = '生成中…';

        try {
            const audioUrl = await window.voiceTTS.previewWithConfig(cfg);
            const audio = new Audio(audioUrl);
            // 按滑块当前值（未保存）应用语速 + 保留音调
            const currentSpeed = speedEl ? Number(speedEl.value) : cfg.speed;
            window.voiceTTS.applyPlaybackSettings(audio, currentSpeed);
            _speedPreviewAudio = audio;
            if (label) label.textContent = '播放中';
            audio.onended = () => {
                if (label) label.textContent = '试听';
                if (_speedPreviewAudio === audio) _speedPreviewAudio = null;
            };
            audio.onerror = () => {
                if (label) label.textContent = '试听';
                if (_speedPreviewAudio === audio) _speedPreviewAudio = null;
                if (typeof showNotification === 'function') showNotification('试听播放失败', 'error');
            };
            await audio.play();
        } catch (err) {
            console.error('[tts-preview]', err);
            if (label) label.textContent = '试听';
            if (typeof showNotification === 'function') {
                showNotification('试听失败：' + (err.message || '未知错误'), 'error');
            }
        } finally {
            if (btn) btn.disabled = false;
        }
    };

    // 拖动滑块或输入数字时，如果正在播放试听，实时改变播放速度（即时反馈）
    document.addEventListener('input', (e) => {
        if (!_speedPreviewAudio || !window.voiceTTS) return;
        if (e.target && (e.target.id === 'tts-speed' || e.target.id === 'tts-speed-value')) {
            const v = Number(e.target.value);
            if (isFinite(v)) {
                window.voiceTTS.applyPlaybackSettings(_speedPreviewAudio, Math.max(0.5, Math.min(2, v)));
            }
        }
    });

    // ─── 聊天设置打开时初始化 ───
    const chatModal = document.getElementById('chat-modal');
    if (chatModal) {
        const observer = new MutationObserver(() => {
            if (chatModal.classList.contains('active')) {
                setTimeout(_initTtsFields, 50);
            }
        });
        observer.observe(chatModal, { attributes: true, attributeFilter: ['class'] });
    }

    // ─── 页面加载时也回填一次（防止刷新后显示空白）───
    document.addEventListener('DOMContentLoaded', () => setTimeout(_initTtsFields, 300));
    setTimeout(_initTtsFields, 500);

    // ============================================
    // 声音克隆 Modal 控制
    // ============================================
    let _clonedVoiceId = null;
    let _previewAudio  = null;

    window._openVoiceCloneModal = function () {
        const modal = document.getElementById('voice-clone-modal');
        if (!modal) return;
        _resetCloneModal();
        // 兼容不同时机：优先用全局showModal，否则直接操作class
        if (typeof showModal === 'function') {
            showModal(modal);
        } else {
            modal.classList.add('active');
            document.body.classList.add('modal-open');
        }
    };

    window._closeVoiceCloneModal = function () {
        const modal = document.getElementById('voice-clone-modal');
        if (!modal) return;
        if (typeof hideModal === 'function') {
            hideModal(modal);
        } else {
            modal.classList.remove('active');
            document.body.classList.remove('modal-open');
        }
        if (_previewAudio) { _previewAudio.pause(); _previewAudio = null; }
    };

    function _resetCloneModal() {
        _clonedVoiceId = null;
        if (_previewAudio) { _previewAudio.pause(); _previewAudio = null; }
        const s1 = document.getElementById('voice-clone-step1');
        const s2 = document.getElementById('voice-clone-step2');
        const loading = document.getElementById('voice-clone-loading');
        const preview = document.getElementById('voice-clone-preview');
        const status  = document.getElementById('voice-clone-step1-status');
        const label   = document.getElementById('voice-clone-upload-label');
        const fileInput = document.getElementById('voice-clone-file-input');
        if (s1) s1.style.display = '';
        if (s2) s2.style.display = 'none';
        if (loading) loading.style.display = '';
        if (preview) preview.style.display = 'none';
        if (status)  status.textContent = '';
        if (label)   label.textContent  = '点击选择音频文件';
        if (fileInput) fileInput.value  = '';
    }

    window._retryVoiceClone = _resetCloneModal;

    // 文件选择后更新标签
    document.addEventListener('DOMContentLoaded', function () {
        const fileInput = document.getElementById('voice-clone-file-input');
        if (fileInput) {
            fileInput.addEventListener('change', function () {
                const label = document.getElementById('voice-clone-upload-label');
                if (label && fileInput.files[0]) {
                    label.textContent = '已选择：' + fileInput.files[0].name;
                }
            });
        }
    });

    // ─── 开始克隆 ───
    window._startVoiceClone = async function () {
        if (!window.voiceTTS) return;
        const fileInput = document.getElementById('voice-clone-file-input');
        const file = fileInput && fileInput.files[0];
        if (!file) {
            const status = document.getElementById('voice-clone-step1-status');
            if (status) { status.style.color = '#e57373'; status.textContent = '请先选择音频文件'; }
            return;
        }
        const name = (document.getElementById('voice-clone-name')?.value || '').trim() || '梦角';

        // 切到 step2 · loading
        const s1 = document.getElementById('voice-clone-step1');
        const s2 = document.getElementById('voice-clone-step2');
        if (s1) s1.style.display = 'none';
        if (s2) s2.style.display = '';

        try {
            _clonedVoiceId = await window.voiceTTS.cloneVoice(file, name);
            // 显示预览区
            const loading = document.getElementById('voice-clone-loading');
            const preview = document.getElementById('voice-clone-preview');
            if (loading) loading.style.display = 'none';
            if (preview) preview.style.display = '';
        } catch (err) {
            console.error('[voice-clone]', err);
            // 回到 step1 并显示错误
            if (s1) s1.style.display = '';
            if (s2) s2.style.display = 'none';
            const status = document.getElementById('voice-clone-step1-status');
            if (status) {
                status.style.color = '#e57373';
                status.textContent = '克隆失败：' + (err.message || '请检查 API Key 和网络');
            }
        }
    };

    // ─── 试听 ───
    window._playVoicePreview = async function () {
        if (!_clonedVoiceId || !window.voiceTTS) return;
        const btn = document.getElementById('voice-clone-play-preview');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> 生成中…'; }
        try {
            // 先把临时 voiceId 存进配置用于试听（不影响真正保存）
            const cfg = window.voiceTTS.getTtsConfig();
            const origId = cfg.voiceId;
            window.voiceTTS.saveTtsConfig(cfg.minimaxKey, cfg.groupId, _clonedVoiceId, cfg.model, cfg.targetLang);

            const audioUrl = await window.voiceTTS.previewClonedVoice(_clonedVoiceId);
            if (_previewAudio) _previewAudio.pause();
            _previewAudio = new Audio(audioUrl);
            _previewAudio.play();
            _previewAudio.onended = () => {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-play"></i> 再听一次'; }
            };

            // 恢复原 voiceId（等确认后才真正写入）
            window.voiceTTS.saveTtsConfig(cfg.minimaxKey, cfg.groupId, origId, cfg.model, cfg.targetLang);
        } catch (err) {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-play"></i> 试听效果'; }
            if (typeof showNotification === 'function') {
                showNotification('试听失败：' + (err.message || ''), 'error');
            }
        }
    };

    // ─── 确认使用克隆的声音 ───
    window._confirmVoiceClone = function () {
        if (!_clonedVoiceId || !window.voiceTTS) return;

        // 同步回设置页输入框，但不直接保存。
        // 让用户统一点击「保存配置」后再生效，避免配置被悄悄改掉。
        const vIdInput = document.getElementById('tts-voice-id');
        if (vIdInput) vIdInput.value = _clonedVoiceId;
        _checkTtsDirty();

        window._closeVoiceCloneModal();
        if (typeof showNotification === 'function') {
            showNotification('声音 ID 已填入，请点击保存配置后生效', 'success');
        }
    };

})();
