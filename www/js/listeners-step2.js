/* ────────────────────────────────────────────────────────────────
 * 首页改造 · 双击对方头像 = 拍一拍
 *   （原先的加号菜单、相册选择、语音按钮占位都已经移除）
 * ──────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    function ready(fn) {
        if (document.readyState !== 'loading') {
            setTimeout(fn, 50);
        } else {
            document.addEventListener('DOMContentLoaded', () => setTimeout(fn, 50));
        }
    }

    ready(function init() {
        const chatContainer = document.getElementById('chat-container') || document.body;

        // 双击聊天里"对方头像" = 拍一拍 + 抖动
        chatContainer.addEventListener('dblclick', (e) => {
            const avatarEl = e.target.closest('.message-avatar');
            if (!avatarEl) return;
            const wrapper = avatarEl.closest('.message-wrapper');
            if (!wrapper || !wrapper.classList.contains('received')) return;
            triggerPoke(avatarEl);
        });

        function triggerPoke(avatarEl) {
            if (avatarEl) {
                avatarEl.classList.remove('poking');
                void avatarEl.offsetWidth;
                avatarEl.classList.add('poking');
                setTimeout(() => avatarEl.classList.remove('poking'), 600);
            }

            const myName      = (typeof settings !== 'undefined' && settings.myName)      ? settings.myName      : '我';
            const partnerName = (typeof settings !== 'undefined' && settings.partnerName) ? settings.partnerName : '梦角';
            const verb        = (typeof settings !== 'undefined' && settings.myPokeText)  ? settings.myPokeText  : '拍了拍';
            let pokeText = `${myName} ${verb} ${partnerName}`;
            if (typeof window._sanitizePokeTextForDisplay === 'function') {
                pokeText = window._sanitizePokeTextForDisplay(pokeText);
            }
            const finalText = (typeof _formatPokeText === 'function')
                ? _formatPokeText(pokeText)
                : pokeText;

            if (typeof addMessage !== 'function') return;
            addMessage({
                id: Date.now(),
                text: finalText,
                timestamp: new Date(),
                type: 'system'
            });

            if (typeof playSound === 'function') playSound('poke');

            if (typeof simulateReply === 'function' && typeof settings !== 'undefined') {
                const range = (settings.replyDelayMax || 3000) - (settings.replyDelayMin || 1000);
                const delay = (settings.replyDelayMin || 1000) + Math.random() * range;
                setTimeout(simulateReply, delay);
            }
        }

        console.log('[step2] 双击头像拍一拍已就绪');
    });
})();
