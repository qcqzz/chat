/* ────────────────────────────────────────────────────────────────
 * 首页改造 · 表情面板仿微信样式
 *   - tab 栏已通过 CSS 隐藏（隐藏整条 combo-tabs-header）
 *   - 这里负责：在 sticker grid 的首位插入"加号格子"（点击 = 上传新表情）
 *   - 沿用项目原有的 my-sticker-quick-upload input，逻辑不动
 * ──────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    function ready(fn) {
        if (document.readyState !== 'loading') {
            setTimeout(fn, 100);
        } else {
            document.addEventListener('DOMContentLoaded', () => setTimeout(fn, 100));
        }
    }

    ready(function init() {
        const contentArea = document.getElementById('combo-content-area');
        const uploadInput = document.getElementById('my-sticker-quick-upload');
        const picker = document.getElementById('user-sticker-picker');
        const inputArea = document.querySelector('.input-area');
        const inputAreaWrapper = document.querySelector('.input-area-wrapper');

        if (!contentArea || !uploadInput) {
            console.warn('[sticker] 元素未找到，跳过');
            return;
        }

        // DOM 重排 1：把 picker 从 input-area 里搬出来，放到 input-area-wrapper 内 input-area 后面
        // 这样 wrapper 用 column 布局后，input-area 在上、picker 在下（仿微信样式）
        if (picker && inputAreaWrapper && inputArea && picker.parentElement !== inputAreaWrapper) {
            inputAreaWrapper.appendChild(picker);
        }

        // DOM 重排 2：把 uploadInput 节点移到 picker 内
        // 避免 uploadInput.click() 触发后被项目的"点击 picker 外部就关闭"监听识别为外部点击
        if (picker && uploadInput && !picker.contains(uploadInput)) {
            picker.appendChild(uploadInput);
        }

        // 监听 grid 变化（用户切 tab、添加/删除表情时会 re-render）
        const observer = new MutationObserver(() => {
            injectAddButton();
        });
        observer.observe(contentArea, { childList: true, subtree: true });

        // 启动时也插一次
        injectAddButton();

        // ─────── 监听上传成功 → 强制刷新表情面板 ───────
        // 项目自己的代码会调用 renderComboContent（但这个函数其实未定义），所以面板不会刷新
        // 我们自己监听 input 的 change，等图片处理完后重新点 combo-btn 触发面板刷新
        if (uploadInput) {
            uploadInput.addEventListener('change', () => {
                const beforeLen = (typeof myStickerLibrary !== 'undefined' && Array.isArray(myStickerLibrary))
                    ? myStickerLibrary.length : 0;
                let tries = 0;
                const check = setInterval(() => {
                    tries++;
                    const nowLen = (typeof myStickerLibrary !== 'undefined' && Array.isArray(myStickerLibrary))
                        ? myStickerLibrary.length : 0;
                    if (nowLen > beforeLen) {
                        clearInterval(check);
                        // 直接强制刷新：先 remove active，再点 combo-btn（触发 switchTab + add active）
                        const comboBtn = document.getElementById('combo-btn');
                        if (comboBtn && picker) {
                            picker.classList.remove('active');
                            // 50ms 让 DOM 反应一下，再 click 触发 switchTab + 重新打开
                            setTimeout(() => comboBtn.click(), 50);
                        }
                    } else if (tries > 30) {
                        clearInterval(check);
                    }
                }, 200);
            });
        }

        function injectAddButton() {
            // 决定要不要显示"添加表情"标题
            const hasEmptyTip = !!contentArea.querySelector('.empty-sticker-tip');
            const hasGrid = !!contentArea.querySelector('.sticker-grid-view');
            // 空状态（有 empty-tip）或不是表情 tab（没 grid 也没 tip，比如拍一拍）→ 不显示标题
            if (hasGrid && !hasEmptyTip) {
                contentArea.classList.add('show-title');
            } else {
                contentArea.classList.remove('show-title');
            }

            let grid = contentArea.querySelector('.sticker-grid-view');

            // 空表情库时，contentArea 只有 .empty-sticker-tip 没有 grid
            // 我们额外造一个 grid 并加进去，让用户依然可以点加号上传
            if (!grid) {
                const emptyTip = contentArea.querySelector('.empty-sticker-tip');
                if (!emptyTip) return;   // 当前可能在显示别的内容（如拍一拍 tab）
                // 已经塞过一次就不重复
                if (contentArea.querySelector('.sticker-grid-add')) return;

                grid = document.createElement('div');
                grid.className = 'sticker-grid-view';
                grid.style.marginTop = '12px';
                contentArea.appendChild(grid);
            }

            // 已经有加号按钮就不重复插
            if (grid.querySelector('.sticker-grid-add')) return;

            const addBtn = document.createElement('div');
            addBtn.className = 'sticker-grid-add';
            addBtn.title = '添加表情';
            addBtn.innerHTML = '<i class="fas fa-plus"></i>';
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                uploadInput.click();
            });
            // 插到第一个位置
            grid.insertBefore(addBtn, grid.firstChild);
        }
    });
})();
