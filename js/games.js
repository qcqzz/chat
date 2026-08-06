function renderStatsContent() {
            const statsContent = DOMElements.statsModal.content;

            const partnerMessages = messages.filter(msg =>
                msg.sender !== 'user' && msg.sender !== null &&
                msg.text &&
                msg.type !== 'system'
            );
            
            const myMessages = messages.filter(msg =>
                msg.sender === 'user' &&
                msg.text &&
                msg.type !== 'system'
            );

            if (partnerMessages.length === 0 && myMessages.length === 0) {
                statsContent.innerHTML = `
                    <div class="stats-empty-state">
                        <div class="stats-empty-icon"><i class="fas fa-chart-pie"></i></div>
                        <h3>暂无数据</h3>
                        <p>多聊几句再来看看吧...</p>
                    </div>`;
                return;
            }

            const getTopReplies = (msgs) => {
                const countMap = {};
                msgs.forEach(msg => {
                    const text = msg.text.trim();
                    if (text) {
                        countMap[text] = (countMap[text] || 0) + 1;
                    }
                });
                return Object.entries(countMap)
                    .map(([text, count]) => ({ text, count }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 5); 
            };

            const partnerTop = getTopReplies(partnerMessages);
            const myTop = getTopReplies(myMessages);

            const generateRankHTML = (list) => {
                if (list.length === 0) return '<div style="text-align:center;color:var(--text-secondary);font-size:12px;padding:10px;">暂无数据</div>';
                const maxVal = list[0].count;
                return list.map((item, index) => {
                    const percent = (item.count / maxVal) * 100;
                    return `
                    <div class="rank-item">
                        <div class="rank-progress-bg" style="width: ${percent}%; opacity: 0.1; background-color: var(--text-primary);"></div>
                        <div class="rank-info">
                            <div class="rank-number">#${index + 1}</div>
                            <div class="rank-text" title="${item.text}">${item.text}</div>
                            <div class="rank-count">${item.count}次</div>
                        </div>
                    </div>`;
                }).join('');
            };

            const allMsgs = messages.filter(m => m.timestamp);
            const firstMsg = allMsgs.length > 0 ? allMsgs[0] : { timestamp: new Date() };
            const lastMsg = allMsgs.length > 0 ? allMsgs[allMsgs.length - 1] : { timestamp: new Date() };

            const formatDate = (dateObj) => {
                return new Date(dateObj).toLocaleDateString('zh-CN', {
                    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                });
            };

            statsContent.innerHTML = `
                <div class="stats-dashboard">
                    <div class="stats-overview-grid">
                        <div class="overview-item overview-large">
                            <div class="overview-value">${messages.length}</div>
                            <div class="overview-label">总消息数</div>
                        </div>
                        <div class="overview-row-two">
                            <div class="overview-item">
                                <div class="overview-value">${myMessages.length}</div>
                                <div class="overview-label">我发送的</div>
                            </div>
                            <div class="overview-item">
                                <div class="overview-value">${partnerMessages.length}</div>
                                <div class="overview-label">对方发送的</div>
                            </div>
                        </div>
                        <div class="overview-row-dates">
                            <div class="overview-item overview-date">
                                <div class="overview-date-icon"><i class="fas fa-seedling"></i></div>
                                <div>
                                    <div class="overview-date-label">初次相遇</div>
                                    <div class="overview-date-value">${formatDate(firstMsg.timestamp)}</div>
                                </div>
                            </div>
                            <div class="overview-item overview-date">
                                <div class="overview-date-icon"><i class="fas fa-heart"></i></div>
                                <div>
                                    <div class="overview-date-label">最近联络</div>
                                    <div class="overview-date-value">${formatDate(lastMsg.timestamp)}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="stats-card">
                        <div style="display:flex; gap:8px; margin-bottom:12px;">
                            <button id="stats-toggle-partner" class="stats-toggle-btn active" onclick="switchStatsView('partner')">
                                <i class="fas fa-user-circle"></i> 对方
                            </button>
                            <button id="stats-toggle-me" class="stats-toggle-btn" onclick="switchStatsView('me')">
                                <i class="fas fa-user"></i> 我方
                            </button>
                        </div>
                        <div class="stats-card-title" id="stats-rank-title">
                            <i class="fas fa-user-circle"></i> 对方高频词 TOP 5
                        </div>
                        <div class="stats-rank-list" id="stats-rank-list">
                            ${generateRankHTML(partnerTop)}
                        </div>
                    </div>
                </div>
            `;

            statsContent._partnerHTML = generateRankHTML(partnerTop);
            statsContent._myHTML = generateRankHTML(myTop);
        }

        window.switchStatsView = function(who) {
            const statsContent = DOMElements.statsModal.content;
            const partnerBtn = document.getElementById('stats-toggle-partner');
            const meBtn = document.getElementById('stats-toggle-me');
            const title = document.getElementById('stats-rank-title');
            const list = document.getElementById('stats-rank-list');
            if (!partnerBtn || !meBtn || !list) return;

            if (who === 'partner') {
                partnerBtn.classList.add('active');
                meBtn.classList.remove('active');
                title.innerHTML = '<i class="fas fa-user-circle"></i> 对方高频词 TOP 5';
                list.innerHTML = statsContent._partnerHTML || '<div style="text-align:center;color:var(--text-secondary);font-size:12px;padding:10px;">暂无数据</div>';
            } else {
                meBtn.classList.add('active');
                partnerBtn.classList.remove('active');
                title.innerHTML = '<i class="fas fa-user"></i> 我方高频词 TOP 5';
                list.innerHTML = statsContent._myHTML || '<div style="text-align:center;color:var(--text-secondary);font-size:12px;padding:10px;">暂无数据</div>';
            }
        };
        function renderSessionList() {
            const listContainer = DOMElements.sessionModal.list;
            if (sessionList.length === 0) {
                listContainer.innerHTML = '<div class="stats-empty" style="padding: 20px 0;"><p>还没有会话</p></div>';
                return;
            }
            listContainer.innerHTML = sessionList.map(session => `
            <div class="session-item ${session.id === SESSION_ID ? 'active': ''}" data-id="${session.id}">
            <div class="session-info">
            <div class="session-name">${session.name}</div>
            <div class="session-meta">创建于 ${new Date(session.createdAt).toLocaleDateString()}</div>
            </div>
            <div class="session-actions">
            <button class="session-action-btn rename" title="重命名"><i class="fas fa-pen"></i></button>
            <button class="session-action-btn delete" title="删除"><i class="fas fa-trash"></i></button>
            </div>
            </div>
            `).join('');
        }


async function generateFortune() {
    const today = new Date();
    const todayKey = today.toDateString(); 
    const start = new Date(today.getFullYear(), 0, 1);
    const diff = today - start + (start.getTimezoneOffset() - today.getTimezoneOffset()) * 60000;
    const weekNum = Math.floor(diff / (1000 * 60 * 60 * 24) / 7);
    const weekKey = today.getFullYear() + '-W' + weekNum;

    const storageKey = `${APP_PREFIX}weekly_fortune`;
    let fortuneData = null;

    try {
        const savedData = await localforage.getItem(storageKey);
        if (savedData && savedData.week === weekKey) {
            fortuneData = savedData;
        }
    } catch (e) { console.warn("读取运势失败", e); }

const majorCards = CONSTANTS.TAROT_CARDS;
    if (!fortuneData) {
        const randomIndex = Math.floor(Math.random() * majorCards.length);
        const isUpright = Math.random() > 0.5;
        
        const fixedStars = isUpright ? (Math.floor(Math.random() * 2) + 4) : (Math.floor(Math.random() * 2) + 3);

        fortuneData = {
            week: weekKey,
            cardIndex: randomIndex,
            isUpright: isUpright,
            stars: fixedStars 
        };
        await localforage.setItem(storageKey, fortuneData);
    }

    renderFortunePanel(fortuneData, majorCards, todayKey);
}

function renderFortunePanel(weeklyData, majorCards, todayKey) {
    const content = document.getElementById('fortune-content');
    if (!content) return;

    content.innerHTML = `
        <div class="fortune-sub-tabs" style="display:flex;gap:8px;margin-bottom:14px;">
            <button id="fsub-weekly" class="modal-btn modal-btn-primary" style="flex:1;font-size:12px;padding:7px 0;" onclick="showFortuneSub('weekly')"><i class="fas fa-calendar-week"></i> 每周主牌</button>
            <button id="fsub-daily" class="modal-btn modal-btn-secondary" style="flex:1;font-size:12px;padding:7px 0;" onclick="showFortuneSub('daily')"><i class="fas fa-sun"></i> 每日运势</button>
        </div>
        <div id="fortune-sub-weekly"></div>
        <div id="fortune-sub-daily" style="display:none;"></div>
    `;

    renderWeeklyFortune(weeklyData, majorCards);
    renderDailyFortune(todayKey);

    showModal(document.getElementById('fortune-lenormand-modal'));
}

window.showFortuneSub = function(tab) {
    const weeklyEl = document.getElementById('fortune-sub-weekly');
    const dailyEl = document.getElementById('fortune-sub-daily');
    const weeklyBtn = document.getElementById('fsub-weekly');
    const dailyBtn = document.getElementById('fsub-daily');
    if (tab === 'weekly') {
        if (weeklyEl) weeklyEl.style.display = '';
        if (dailyEl) dailyEl.style.display = 'none';
        if (weeklyBtn) weeklyBtn.className = 'modal-btn modal-btn-primary';
        if (dailyBtn) dailyBtn.className = 'modal-btn modal-btn-secondary';
        weeklyBtn.style.flex = dailyBtn.style.flex = '1';
        weeklyBtn.style.fontSize = dailyBtn.style.fontSize = '12px';
        weeklyBtn.style.padding = dailyBtn.style.padding = '7px 0';
    } else {
        if (weeklyEl) weeklyEl.style.display = 'none';
        if (dailyEl) dailyEl.style.display = '';
        if (weeklyBtn) weeklyBtn.className = 'modal-btn modal-btn-secondary';
        if (dailyBtn) dailyBtn.className = 'modal-btn modal-btn-primary';
        weeklyBtn.style.flex = dailyBtn.style.flex = '1';
        weeklyBtn.style.fontSize = dailyBtn.style.fontSize = '12px';
        weeklyBtn.style.padding = dailyBtn.style.padding = '7px 0';
    }
};

function renderWeeklyFortune(data, majorCards) {
    const el = document.getElementById('fortune-sub-weekly');
    if (!el) return;

    const card = majorCards[data.cardIndex];
    const isUpright = data.isUpright;
    const starCount = data.stars || 3;

    let starsHtml = Array(5).fill(0).map((_, i) => 
        `<i class="fas fa-star" style="color: ${i < starCount ? 'var(--accent-color)' : 'var(--border-color)'}; font-size: 12px; margin: 0 2px;"></i>`
    ).join('');

    el.innerHTML = `
        <div style="text-align:center; margin-bottom:15px; color:var(--text-secondary); font-size:12px; letter-spacing: 1px;">
            <i class="fas fa-sparkles" style="color:var(--accent-color);"></i> 凭直觉点击翻开你的每周主牌
        </div>
        
        <div class="tarot-container-3d" onclick="this.classList.toggle('flipped');">
            <div class="tarot-card-inner">
                <div class="tarot-face tarot-front">
                    <div class="tarot-pattern"><i class="fas fa-star-and-crescent"></i></div>
                </div>
                <div class="tarot-face tarot-back" style="background: linear-gradient(135deg, var(--secondary-bg), rgba(var(--accent-color-rgb), 0.05)); border: 2px solid rgba(var(--accent-color-rgb), 0.3); padding: 14px 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow-y: auto;">
                    <div class="tarot-visual ${isUpright ? '' : 'reversed'}" style="height:80px; flex-shrink:0;">
                        <i class="fas ${card.icon} tarot-icon-vector" style="font-size:42px; color: var(--accent-color);"></i>
                    </div>
                    <div style="text-align:center; width:100%;">
                        <div class="tarot-card-name" style="font-size:18px; font-weight: 700; margin-bottom:3px;">${card.name}</div>
                        <div style="font-size:10px; color:var(--text-secondary); margin-bottom:6px;">${isUpright ? '正位' : '逆位'}</div>
                        <div style="font-size:12px; color: var(--accent-color); font-weight:600; margin-bottom:6px;">「${card.keyword}」</div>
                        <div style="margin-bottom:8px;">${starsHtml}</div>
                        <div style="font-size:11px; color:var(--text-secondary); line-height:1.6; text-align:left;">${card.meaning}</div>
                    </div>
                </div>
            </div>
        </div>

    `;
}

async function renderDailyFortune(todayKey) {
    const el = document.getElementById('fortune-sub-daily');
    if (!el) return;

    const storageKey = `${APP_PREFIX}daily_fortune_3`;
    let dailyData = null;

    try {
        const saved = await localforage.getItem(storageKey);
        if (saved && saved.day === todayKey) {
            dailyData = saved;
        }
    } catch(e) {}

    if (!dailyData) {
        const deck = [...ALL_78_TAROT_CARDS];
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        const drawn = deck.slice(0, 3).map(card => ({
            name: card.name,
            type: card.type || 'major',
            keyword: card.keyword,
            upright: card.upright || card.meaning,
            reversed: card.reversed || card.meaning,
            icon: card.icon || 'fa-star',
            img: card.img || null,
            isUpright: Math.random() > 0.5
        }));
        dailyData = { day: todayKey, cards: drawn };
        try { await localforage.setItem(storageKey, dailyData); } catch(e) {}
    }

    const positionLabels = ['过去 · 根源', '现在 · 核心', '未来 · 启示'];
    const positionColors = ['rgba(var(--accent-color-rgb),0.6)', 'var(--accent-color)', 'rgba(var(--accent-color-rgb),0.8)'];

    el.innerHTML = `
        <div style="text-align:center; margin-bottom:14px; color:var(--text-secondary); font-size:12px; letter-spacing:1px;">
            <i class="fas fa-moon" style="color:var(--accent-color);"></i> ${new Date().toLocaleDateString('zh-CN', {month:'long',day:'numeric'})} · 三牌展开
        </div>
        <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-bottom:16px;">
            ${dailyData.cards.map((card, i) => `
                <div style="flex:1;min-width:90px;max-width:130px;text-align:center;">
                    <div style="font-size:10px;color:${positionColors[i]};margin-bottom:6px;font-weight:600;letter-spacing:0.5px;">${positionLabels[i]}</div>
                    <div class="tarot-container-3d tarot-responsive" style="cursor:pointer;margin-bottom:8px;" onclick="this.classList.toggle('flipped'); document.getElementById('daily-interp-${i}').style.display = this.classList.contains('flipped') ? 'block' : 'none';">
                        <div class="tarot-card-inner">
                            <div class="tarot-face tarot-front"><div class="tarot-pattern" style="font-size:18px;"><i class="fas fa-star-and-crescent"></i></div></div>
                            <div class="tarot-face tarot-back" style="background:linear-gradient(135deg,var(--secondary-bg),rgba(var(--accent-color-rgb),0.07));border:1.5px solid rgba(var(--accent-color-rgb),0.3);padding:0;overflow:hidden;">
                                <div class="tarot-visual ${card.isUpright ? '' : 'reversed'}" style="height:100%;width:100%;margin:0;padding:0;">
                                    ${card.img ? `<img src="${card.img}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div style="display:none;height:100%;align-items:center;justify-content:center;"><i class="fas ${card.icon}" style="font-size:28px;color:var(--accent-color);"></i></div>` : `<div style="height:100%;display:flex;align-items:center;justify-content:center;"><i class="fas ${card.icon}" style="font-size:28px;color:var(--accent-color);"></i></div>`}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div id="daily-interp-${i}" style="display:none;text-align:left;margin-top:6px;padding:8px 10px;background:rgba(var(--accent-color-rgb),0.06);border-radius:10px;border:1px solid rgba(var(--accent-color-rgb),0.15);">
                        <div style="font-size:11px;font-weight:700;color:var(--accent-color);margin-bottom:4px;">${card.keyword}</div>
                        <div style="font-size:11px;color:var(--text-secondary);line-height:1.6;">${card.isUpright ? (card.upright || card.meaning || '') : (card.reversed || card.meaning || '')}</div>
                    </div>
                </div>
            `).join('')}
        </div>
      <div style="margin-bottom:10px;">
            <div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;font-weight:500;">✍️ 今日解读</div>
            <textarea id="daily-fortune-notes" placeholder="写下你对今日牌阵的感悟..." style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid var(--border-color);border-radius:10px;background:var(--primary-bg);color:var(--text-primary);font-size:12px;font-family:var(--font-family);resize:vertical;min-height:72px;outline:none;transition:border 0.18s;line-height:1.6;" onfocus="this.style.borderColor='var(--accent-color)'" onblur="this.style.borderColor='var(--border-color)'">${(function(){try{return localStorage.getItem('dailyFortuneNotes_'+todayKey)||''}catch(e){return ''}}())}</textarea>
            <div style="display:flex;justify-content:flex-end;margin-top:4px;">
                <button onclick="(function(){var t=document.getElementById('daily-fortune-notes');try{localStorage.setItem('dailyFortuneNotes_'+'${todayKey}',t.value);}catch(e){}this.textContent='已保存 ✓';var self=this;setTimeout(function(){self.textContent='保存';},1500);}).call(this)" style="font-size:11px;padding:4px 12px;border:1.5px solid var(--accent-color);border-radius:8px;background:transparent;color:var(--accent-color);cursor:pointer;font-family:var(--font-family);">保存</button>
            </div>
        </div>
        <div style="font-size:11px;color:var(--text-secondary);text-align:center;padding:8px;background:rgba(var(--accent-color-rgb),0.05);border-radius:8px;">
            <i class="fas fa-sync-alt" style="color:var(--accent-color);margin-right:4px;"></i>每日零时自动更新 · 点击牌背翻开查看解读
        </div>
    `;
}

let lenormandSystem = 36;
let lenormandCount = 1;

const LENORMAND_CARDS_40 = [
    { num: 1, name: "骑士", icon: "🏇", keyword: "消息·速度", meaning: "快速到来的消息，行动迅速，使者，短途旅行。" },
    { num: 2, name: "四叶草", icon: "🍀", keyword: "幸运·机遇", meaning: "小幸运，偶然的好运，短暂的喜悦，乐观面对生活。" },
    { num: 3, name: "帆船", icon: "⛵", keyword: "旅行·方向", meaning: "旅行，冒险，追寻目标，人生的航向。" },
    { num: 4, name: "房屋", icon: "🏠", keyword: "家庭·安稳", meaning: "家，稳定，安全感，家庭关系，房产。" },
    { num: 5, name: "大树", icon: "🌳", keyword: "健康·根基", meaning: "健康，生命力，成长，根基，长久稳固。" },
    { num: 6, name: "乌云", icon: "☁️", keyword: "困惑·障碍", meaning: "困惑，不确定，暂时的阴霾，需要耐心等待。" },
    { num: 7, name: "蛇", icon: "🐍", keyword: "诱惑·迂回", meaning: "竞争者，诱惑，迂回的道路，复杂的女性。" },
    { num: 8, name: "棺材", icon: "⚰️", keyword: "结束·转变", meaning: "结束，转变，某事告一段落，低落期，疾病。" },
    { num: 9, name: "花束", icon: "💐", keyword: "礼物·喜悦", meaning: "礼物，惊喜，喜悦，美好的关系，感激之情。" },
    { num: 10, name: "镰刀", icon: "🌾", keyword: "决断·收割", meaning: "突然的决定，危险，收割，结束，手术。" },
    { num: 11, name: "鞭子", icon: "⚡", keyword: "争执·激情", meaning: "争论，冲突，重复，激情，体育运动。" },
    { num: 12, name: "鸟儿", icon: "🐦", keyword: "对话·焦虑", meaning: "对话，流言，消息，焦虑，一对情侣。" },
    { num: 13, name: "孩童", icon: "🧒", keyword: "新开始·纯真", meaning: "新的开始，纯真，孩子，小事，新鲜感。" },
    { num: 14, name: "狐狸", icon: "🦊", keyword: "狡猾·工作", meaning: "狡猾，策略，工作，谨防欺骗，自我保护。" },
    { num: 15, name: "熊", icon: "🐻", keyword: "力量·权威", meaning: "强大的力量，老板，财务，母性，保护者。" },
    { num: 16, name: "星星", icon: "⭐", keyword: "希望·指引", meaning: "希望，梦想，灵感，指引，清晰，美好未来。" },
    { num: 17, name: "鹳鸟", icon: "🕊️", keyword: "变化·移动", meaning: "变化，移动，适应，新的生活阶段，迁徙。" },
    { num: 18, name: "狗", icon: "🐕", keyword: "友谊·忠诚", meaning: "忠诚的朋友，友谊，可靠，支持，宠物。" },
    { num: 19, name: "高塔", icon: "🏰", keyword: "孤独·机构", meaning: "孤独，边界，机构，官方，距离，自我保护。" },
    { num: 20, name: "花园", icon: "🌺", keyword: "社交·公众", meaning: "社交场合，公众，聚会，开放的空间。" },
    { num: 21, name: "山丘", icon: "⛰️", keyword: "障碍·挑战", meaning: "障碍，挑战，延迟，竞争，需要攀越的困难。" },
    { num: 22, name: "十字路口", icon: "🛤️", keyword: "选择·方向", meaning: "选择，岔路，可能性，多条道路，决策时刻。" },
    { num: 23, name: "老鼠", icon: "🐀", keyword: "损耗·压力", meaning: "损失，压力，焦虑，偷走，逐渐减少，担忧。" },
    { num: 24, name: "心", icon: "❤️", keyword: "爱情·感情", meaning: "爱，感情，关怀，真心，情感的核心。" },
    { num: 25, name: "指环", icon: "💍", keyword: "承诺·契约", meaning: "承诺，契约，婚姻，合作，循环往复。" },
    { num: 26, name: "书", icon: "📚", keyword: "秘密·知识", meaning: "秘密，知识，学习，隐藏的信息，需要深入了解。" },
    { num: 27, name: "信件", icon: "✉️", keyword: "沟通·文件", meaning: "通讯，文件，信息，书面合同，重要的消息。" },
    { num: 28, name: "男士", icon: "👨", keyword: "男性·当事人", meaning: "主要男性人物，男性提问者或重要男性。" },
    { num: 29, name: "女士", icon: "👩", keyword: "女性·当事人", meaning: "主要女性人物，女性提问者或重要女性。" },
    { num: 30, name: "百合", icon: "🌸", keyword: "纯洁·平静", meaning: "纯洁，平静，和谐，成熟的感情，高尚的品格。" },
    { num: 31, name: "太阳", icon: "☀️", keyword: "成功·活力", meaning: "成功，活力，快乐，温暖，光明，积极能量。" },
    { num: 32, name: "月亮", icon: "🌙", keyword: "荣誉·直觉", meaning: "荣誉，名声，直觉，情感波动，创造力，梦境。" },
    { num: 33, name: "钥匙", icon: "🔑", keyword: "答案·解锁", meaning: "答案，解决方案，重要发现，开启新的可能。" },
    { num: 34, name: "鱼", icon: "🐟", keyword: "财富·流动", meaning: "财富，生意，流动，丰盛，商业活动，资源。" },
    { num: 35, name: "锚", icon: "⚓", keyword: "稳定·坚持", meaning: "稳定，坚持，目标，长期，踏实，工作。" },
    { num: 36, name: "十字架", icon: "✝️", keyword: "命运·担当", meaning: "命运，责任，痛苦，信仰，接受，精神使命。" },
    { num: 37, name: "灵体", icon: "💭", keyword: "高我·感受", meaning: "直觉，感受，觉察，因果规律，灵魂伴侣，。" },
    { num: 38, name: "香炉", icon: "⚖️", keyword: "清除·归零", meaning: "清除，净化，消散，弥漫，清净之地，氛围感。" },
    { num: 39, name: "床", icon: "🛏", keyword: "舒适·休息", meaning: "睡觉，回避，躺平，舒适，卧室，性关系。" },
    { num: 40, name: "市场", icon: "🏪", keyword: "交易·工作", meaning: "工作，交易，维护，运营，势均力敌，出去游玩。" }
];

function getLenormandCards() {
    return LENORMAND_CARDS_40.slice(0, lenormandSystem);
}

function setLenormandSystem(n) {
    lenormandSystem = n;
}

function setLenormandCount(n) {
    lenormandCount = n;
    document.querySelectorAll('.lenormand-num-btn').forEach(btn => {
        const numEl = btn.querySelector('.leno-btn-num');
        btn.classList.toggle('active', numEl && parseInt(numEl.textContent) === n);
    });
    updateLenoNumDesc(n);
}

function updateLenoNumDesc(n) {
    const desc = document.getElementById('leno-num-desc');
    if (!desc) return;
    if (n === 1) desc.textContent = '单张牌 · 直达答案';
    else if (n === 3) desc.textContent = '三张牌 · 洞察全局';
}

function switchFLTab(tab) {
    document.querySelectorAll('.fl-tab').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.fl-panel').forEach(panel => panel.classList.remove('fl-panel-active'));
    const activeTab = document.getElementById('fl-tab-' + tab);
    const activePanel = document.getElementById('fl-panel-' + tab);
    if (activeTab) activeTab.classList.add('active');
    if (activePanel) activePanel.classList.add('fl-panel-active');
}

function openLenormandModal() {
    resetLenormand();
    switchFLTab('lenormand');
    showModal(document.getElementById('fortune-lenormand-modal'));
}

function resetLenormand() {
    const setup = document.getElementById('lenormand-setup');
    const result = document.getElementById('lenormand-result');
    const resetBtn = document.getElementById('lenormand-reset-btn');
    const qInput = document.getElementById('lenormand-question');
    if (setup) setup.style.display = '';
    if (result) result.style.display = 'none';
    if (resetBtn) resetBtn.style.display = 'none';
    if (qInput) qInput.value = '';
    lenormandSystem = 40;
    lenormandCount = 1;
    document.querySelectorAll('.lenormand-num-btn').forEach(btn => {
        const num = btn.querySelector('.leno-btn-num');
        btn.classList.toggle('active', num && num.textContent.trim() === '1');
    });
    updateLenoNumDesc(1);
}

function startLenormandDraw() {
    const cards = getLenormandCards();
    const shuffled = [...cards].sort(() => Math.random() - 0.5);
    const drawn = shuffled.slice(0, lenormandCount);
    const question = document.getElementById('lenormand-question').value.trim();

    let cardsHTML = drawn.map((card, i) => `
        <div class="lenormand-card-item" style="animation-delay:${i * 0.1}s;">
            <span class="lenormand-card-icon">${card.icon}</span>
            <div class="lenormand-card-name">${card.name}</div>
            <div class="lenormand-card-num">No.${card.num}</div>
            <div class="lenormand-card-keyword">「${card.keyword}」</div>
            <div class="lenormand-card-meaning">${card.meaning}</div>
        </div>
    `).join('');

    let synthesisHTML = '';
    if (drawn.length > 1) {
        const keywords = drawn.map(c => c.keyword.split('·')[0]).join('、');
        const energies = drawn.map(c => c.name).join(' + ');
        const m0 = drawn[0].meaning.split('，')[0];
        const m2 = drawn.length >= 3 ? drawn[2].meaning.split('，')[0] : '';
        const n0 = drawn[0].name, n1 = drawn[1].name, n2 = drawn.length >= 3 ? drawn[2].name : '';
        
        const templates3 = [
            `「${n0}」的能量如同${m0}的底色，与「${n1}」相互呼应；「${n2}」则带来${m2}的质感。三张牌的能量流动，共同编织出一段关于${keywords}的故事。`,
            `星盘之上，「${n0}」、「${n1}」、「${n2}」三张牌依次展开——各自携带的能量在此汇聚，悄悄低语。${keywords}，是此刻需要关注的核心能量。`,
            `「${n0}」与「${n1}」、「${n2}」共同呈现：${m0}的力量与${m2}的方向在这里交织，等待你迈出那一步。愿三张牌的能量，成为你此刻的指引。`,
            `三张牌共同呈现了一段旅程：「${n0}」、「${n1}」、「${n2}」依次展开，${keywords}的主题贯穿其中，指引着前行的方向。`,
            `宇宙借${energies}的能量，向你传递信息：${m0}的力量与${m2}的可能性已悄然开启，请相信这段旅程有其深意。`
        ];
        const templates2 = [
            `「${n0}」与「${n1}」的能量相遇，${keywords}的主题在此交汇。${m0}的力量遇见了新的可能，共同描绘出当下局势的面貌。`,
            `两张牌携手而来：「${n0}」带着${m0}的底色，「${n1}」带来新的视角。它们共同指向一个关于${keywords}的答案，等待你细细品味。`,
            `${energies}——两种能量在你的问题上留下印记。${m0}与对方的能量相互作用，当前局面因此充满了${keywords}的质感。静下心来，答案已在其中。`,
            `牌与牌之间总有呼应。「${n0}」和「${n1}」的组合，像是宇宙特意为你排列的密码，${keywords}便是解读这段缘分的钥匙。`
        ];
        
        const templates = drawn.length === 3 ? templates3 : templates2;
        const chosenText = templates[Math.floor(Math.random() * templates.length)];
        
        synthesisHTML = `
        <div class="lenormand-synthesis">
            <div class="lenormand-synthesis-title">✦ 综合解读</div>
            ${chosenText}
        </div>`;
    }

    const questionDisplay = question ? `<div class="lenormand-question-show">「${question}」</div>` : '';

    document.getElementById('lenormand-result').innerHTML = `
        ${questionDisplay}
        <div style="text-align:center; font-size:12px; color:var(--text-secondary); margin-bottom:12px;">
            <i class="fas fa-moon"></i> 雷诺曼轻声说 · 爱能克服远距离
        </div>
        <div class="lenormand-cards-row">${cardsHTML}</div>
        ${synthesisHTML}
    `;

    document.getElementById('lenormand-setup').style.display = 'none';
    document.getElementById('lenormand-result').style.display = '';
    document.getElementById('lenormand-reset-btn').style.display = '';

    const lCards = drawn.map(c => ({ name: c.name, keyword: c.keyword, position: '', isReversed: false, meaning: c.meaning }));
    saveDiviHistory({ type: `雷诺曼${lenormandCount === 1 ? '单张' : '三张'}`, question, cards: lCards });
}

const ALL_78_TAROT_CARDS = [
    { name: "愚人", num: "0", type: "major", eng: "The Fool", keyword: "流浪", upright: "全新的开始、冒险精神、天真无邪、活在当下、无限可能、信任直觉、大胆尝试、不受约束", reversed: "愚蠢的决定、鲁莽行事、逃避责任、犹豫不决、缺乏方向感、错失良机、不切实际", img: "https://i.postimg.cc/hGv9scYL/96e54bea7c980b53d1f2904d6de1139b.jpg" },
    { name: "魔术师", num: "I", type: "major", eng: "The Magician", keyword: "创造", upright: "创造力爆发、技能娴熟、意志力强大、化腐朽为神奇、行动力强、专注目标、资源整合、自信满满", reversed: "欺骗手段、操纵他人、能力未充分发挥、意图不纯、缺乏自信、拖延行动、滥用天赋", img: "https://i.postimg.cc/156PgF5Q/bb1a94f3f1b8beaae766b320d766ff7b.jpg" },
    { name: "女祭司", num: "II", type: "major", eng: "The High Priestess", keyword: "智慧", upright: "直觉敏锐、潜意识觉醒、神秘力量、内在智慧、静待时机、倾听内心、保持沉默、精神觉醒", reversed: "秘密暴露、压抑直觉、信息隐藏、非理性判断、抗拒内在声音、表面化、情感封闭", img: "https://i.postimg.cc/Vs2mLg1z/522ea5704ba75a6b17a2bd1ad94c7843.jpg" },
    { name: "女帝", num: "III", type: "major", eng: "The Empress", keyword: "丰收", upright: "丰饶富足、母性光辉、自然力量、感官享受、创造力旺盛、孕育新生、艺术灵感、爱与关怀", reversed: "过度依赖、创意阻塞、过分保护、忽视自我需求、创造力枯竭、情感空虚、放纵", img: "https://i.postimg.cc/FFwNspmX/94c11c30f386c5f3b307fb73e931e0ff.jpg" },
    { name: "皇帝", num: "IV", type: "major", eng: "The Emperor", keyword: "支配", upright: "权威力量、结构秩序、控制能力、稳定可靠、父亲形象、领导才能、理性决策、建立规则", reversed: "专横跋扈、刚愎自用、滥用权力、缺乏弹性、控制欲过强、优柔寡断、失去威信", img: "https://i.postimg.cc/c1P04hWj/acc86a61cbac497830cc9b5e3f5eedbf.jpg" },
    { name: "教皇", num: "V", type: "major", eng: "The Hierophant", keyword: "援助", upright: "传统价值、信仰力量、教导他人、精神指引、遵循制度、寻求导师、群体归属、仪式感", reversed: "叛逆传统、个人信仰觉醒、突破规范、独立思想、质疑权威、脱离束缚、寻找新路", img: "https://i.postimg.cc/L4G26DSb/45bd1da5e8e05458ac85deba2dcf1b4c.jpg" },
    { name: "恋人", num: "VI", type: "major", eng: "The Lovers", keyword: "结合", upright: "真爱降临、和谐关系、价值观选择、灵魂伴侣、情感连接、吸引力强烈、重要抉择、平衡", reversed: "关系失衡、误判对方、价值观冲突、分离危机、犹豫不决、情感考验、选择困难", img: "https://i.postimg.cc/tR8pCkbv/c8e193de2db78acd8d6b0f4b94ceb9eb.jpg" },
    { name: "战车", num: "VII", type: "major", eng: "The Chariot", keyword: "胜利", upright: "意志力坚定、胜利在望、决心强大、自我掌控、勇往直前、克服障碍、明确目标、自信", reversed: "失去控制、方向迷失、挫败感强、固执己见、内在冲突、停滞不前、缺乏自律", img: "https://i.postimg.cc/XNt47LW2/9952b0b90e242125af82412d43a3ddfc.jpg" },
    { name: "力量", num: "VIII", type: "major", eng: "Strength", keyword: "意志", upright: "勇气可嘉、耐心等待、内在力量、温柔坚定、同理心强、情绪管理、化解冲突、自信", reversed: "自我怀疑、软弱无力、压抑内在力量、失去信心、恐惧支配、情绪失控、退缩", img: "https://i.postimg.cc/SQHkNd4G/bbf5a7098702778a0d3f96a7f8ff356e.jpg" },
    { name: "隐士", num: "IX", type: "major", eng: "The Hermit", keyword: "探索", upright: "内省深思、孤独旅程、寻求真理、内在指引、智慧积累、自我探索、独处需要、导师", reversed: "孤立无援、拒绝帮助、过度孤独、逃避现实、与社会脱节、封闭自我、不愿成长", img: "https://i.postimg.cc/2j1CDJst/28e4666f91395d530d5e2e754edf723d.jpg" },
    { name: "命运之轮", num: "X", type: "major", eng: "Wheel of Fortune", keyword: "轮回", upright: "命运转折、循环往复、好运降临、因果报应、机遇来临、顺势而为、变化将至、意外", reversed: "逆境来袭、抗拒改变、恶性循环、运气不佳、错失良机、无法掌控、命运捉弄", img: "https://i.postimg.cc/59XfVGhk/794c115c0d699838ca5be1775e93ad20.jpg" },
    { name: "正义", num: "XI", type: "major", eng: "Justice", keyword: "均衡", upright: "公正裁决、真相大白、因果报应、法律事务、诚实守信、平衡判断、责任承担、公平", reversed: "不公正待遇、逃避责任、不诚实行为、法律纠纷、失衡状态、偏见歧视、后果", img: "https://i.postimg.cc/v84GsjJX/1be9b7793332da671dd8843bc13134a4.jpg" },
    { name: "倒吊人", num: "XII", type: "major", eng: "The Hanged Man", keyword: "奉献", upright: "牺牲精神、新视角看问题、等待时机、放下执念、顿悟时刻、换位思考、暂停", reversed: "拖延症、无谓牺牲、停滞不前、抗拒改变、无法放手、固执己见、错失顿悟", img: "https://i.postimg.cc/XNrnbhRg/55b46df567a1b9a4c4e6d3e8c90f8114.jpg" },
    { name: "死神", num: "XIII", type: "major", eng: "Death", keyword: "结束", upright: "结束与开始、转变来临、重生机会、放手过去、蜕变成长、不可抗拒的变化、新生", reversed: "抗拒改变、无法放手、腐朽停滞、恐惧新生、固执不变、拒绝结束、拖延", img: "https://i.postimg.cc/G34bCNWk/f9f117b116ed89070375ff8b2b8f2906.jpg" },
    { name: "节制", num: "XIV", type: "major", eng: "Temperance", keyword: "净化", upright: "平衡之道、适度原则、耐心等待、调和矛盾、中庸智慧、情绪管理、调和", reversed: "失衡状态、过度放纵、缺乏耐心、极端行为、矛盾激化、无法调和、冲动", img: "https://i.postimg.cc/HWrTgKqX/f6bba5a04896b1eafd85e4b414e5e7fe.jpg" },
    { name: "恶魔", num: "XV", type: "major", eng: "The Devil", keyword: "诱惑", upright: "束缚关系、物质主义、欲望诱惑、沉迷享乐、阴暗面显现、执着成瘾、被困", reversed: "解脱束缚、重获自由、自我觉醒、放下执念、摆脱控制、认清真相、解放", img: "https://i.postimg.cc/ZYWJSgG9/0193aa497922eb37bdef24da7e82fc5c.jpg" },
    { name: "高塔", num: "XVI", type: "major", eng: "The Tower", keyword: "毁灭", upright: "突变降临、混乱局面、启示觉醒、破坏重建、真相大白、意外打击、崩塌", reversed: "延迟变化、避免灾难、内在崩溃、抗拒真相、恐惧改变、压抑爆发、缓慢", img: "https://i.postimg.cc/RCWvB8kW/b3aa6bb2075c9333cd2fe88ffe6b8845.jpg" },
    { name: "星星", num: "XVII", type: "major", eng: "The Star", keyword: "希望", upright: "希望之光、灵感涌现、平静安宁、治愈能量、信念坚定、心灵指引、乐观", reversed: "绝望情绪、失去信仰、悲观消极、灵感枯竭、信心动摇、迷茫无助、失望", img: "https://i.postimg.cc/fWVMNFGy/efc1373d89e1fb57fd39ba46809a5d6e.jpg" },
    { name: "月亮", num: "XVIII", type: "major", eng: "The Moon", keyword: "不安", upright: "幻觉迷惑、恐惧心理、焦虑情绪、潜意识浮现、不确定性、梦境启示、直觉", reversed: "恐惧消散、真相浮现、走出迷惘、看清现实、克服焦虑、方向明确、稳定", img: "https://i.postimg.cc/PfCdjcg5/f91356263746aaf0574a4074b5c75a71.jpg" },
    { name: "太阳", num: "XIX", type: "major", eng: "The Sun", keyword: "生命", upright: "快乐洋溢、成功在望、活力充沛、清晰明朗、正能量满满、积极向上、成就", reversed: "悲观情绪、自我怀疑、短暂挫折、快乐受阻、缺乏自信、阴霾笼罩、暂时", img: "https://i.postimg.cc/NF3JqL3t/cc7920c1085e317299e6022f7c11418f.jpg" },
    { name: "审判", num: "XX", type: "major", eng: "Judgement", keyword: "复活", upright: "复活重生、觉醒时刻、号召来临、重要决定、自我评价、因果报应、召唤", reversed: "自我怀疑、拒绝接受审判、过去纠缠、逃避责任、后悔自责、无法觉醒", img: "https://i.postimg.cc/ZnG7t01X/2af3b253975f72db648372f5f67b19c8.jpg" },
    { name: "世界", num: "XXI", type: "major", eng: "The World", keyword: "达成", upright: "完成圆满、整合统一、成就达成、世界在脚下、旅途终点、成功实现、圆满", reversed: "未完成事项、拖延症、缺乏完结感、停滞不前、未能整合、遗憾残留", img: "https://i.postimg.cc/tJKSQ7LD/7f69519939b241e131dbd58d7bb8b648.jpg" },
    { name: "权杖一", num: "Ace", type: "wands", eng: "Ace of Wands", keyword: "灵感", upright: "新灵感迸发、创意火花、激情开始、行动欲望、创业精神、能量涌现、新项目", reversed: "创意受阻、缺乏动力、计划搁浅、拖延行动、热情消退、不敢开始", img: "https://i.postimg.cc/8zh3GBk9/ed2ce5320ab2882ead4f42a9492923ae.jpg" },
    { name: "权杖二", num: "2", type: "wands", eng: "Two of Wands", keyword: "规划", upright: "规划未来、展望远方、个人力量、决策时刻、探索可能、离开舒适区、勇敢", reversed: "恐惧未知、缺乏计划、自我设限、犹豫不决、停滞不前、害怕改变", img: "https://i.postimg.cc/pLD7vYVq/181ffcef5e2caec52135f3fd3bb60e60.jpg" },
    { name: "权杖三", num: "3", type: "wands", eng: "Three of Wands", keyword: "扩展", upright: "扩展视野、远见卓识、探索精神、等待成果、贸易合作、海外机会、领导", reversed: "障碍出现、延迟到来、预期未达、合作受阻、远见不足、耐心缺失", img: "https://i.postimg.cc/XYwhWcNk/170261009cbe95510da1b5ab7c3ecdcc.jpg" },
    { name: "权杖四", num: "4", type: "wands", eng: "Four of Wands", keyword: "庆典", upright: "庆祝时刻、稳定基础、家庭幸福、里程碑达成、和谐团聚、安居乐业、丰收", reversed: "不稳定状态、家庭矛盾、延迟庆祝、基础动摇、和谐被打破、暂缓", img: "https://i.postimg.cc/VkjTwBsq/a4480049b7630cec92c1245db9b65035.jpg" },
    { name: "权杖五", num: "5", type: "wands", eng: "Five of Wands", keyword: "竞争", upright: "竞争激烈、冲突不断、挑战重重、意见分歧、斗争状态、能量争夺、混乱", reversed: "内部冲突、避免对抗、达成协议、和解可能、放下争执、寻求共识", img: "https://i.postimg.cc/zGnMNSDn/71341bdf2261a50098c9cf5b4763e238.jpg" },
    { name: "权杖六", num: "6", type: "wands", eng: "Six of Wands", keyword: "凯旋", upright: "胜利凯旋、获得认可、成功喜悦、公众赞誉、自信满满、领导地位、好消息", reversed: "私下的成功、不稳定的成功、傲慢自大、失去支持、期待落空、延迟", img: "https://i.postimg.cc/0yp3vd5m/02c1bb07bb55c9c7ad18daea4ea4732a.jpg" },
    { name: "权杖七", num: "7", type: "wands", eng: "Seven of Wands", keyword: "坚守", upright: "防御姿态、坚守立场、面对挑战、坚持信念、不畏艰难、迎难而上、勇气", reversed: "放弃抵抗、被压倒、自我怀疑、无力应对、屈服压力、退缩逃避", img: "https://i.postimg.cc/Mpy4wbZB/b2437558d88e7ad755ab686ca5c16f44.jpg" },
    { name: "权杖八", num: "8", type: "wands", eng: "Eight of Wands", keyword: "速度", upright: "迅速行动、进展加速、旅行将至、消息传来、能量释放、快速发展、冲刺", reversed: "延误延迟、等待过程、障碍出现、计划受阻、缓慢进展、消息迟到", img: "https://i.postimg.cc/sgp8z9fv/8dedf2bca5a629d0778f1260d812868f.jpg" },
    { name: "权杖九", num: "9", type: "wands", eng: "Nine of Wands", keyword: "坚韧", upright: "坚韧不拔、弹性恢复、最后挑战、边界意识、谨慎戒备、准备迎战、耐力", reversed: "偏执多疑、顽固不化、不愿妥协、防卫过度、精疲力竭、被迫放弃", img: "https://i.postimg.cc/13pTScRt/79248609ebe669bfdbbf0bb8a6f3baf4.jpg" },
    { name: "权杖十", num: "10", type: "wands", eng: "Ten of Wands", keyword: "重担", upright: "责任过重、负担压力、努力奋斗、接近终点、承担过多、疲惫不堪、坚持", reversed: "放下重担、委派任务、精简生活、解脱压力、学会放手、减轻负担", img: "https://i.postimg.cc/RZr82bmq/d6e15b8d05aa8769a873f91cefa5a340.jpg" },
    { name: "权杖侍者", num: "Page", type: "wands", eng: "Page of Wands", keyword: "热情", upright: "热情洋溢、探索精神、新消息将至、好奇心强、创意潜力、冒险尝试、活力", reversed: "轻率决定、三分钟热度、缺乏方向、消息延迟、创意受阻、热情消退", img: "https://i.postimg.cc/Mpk4grwK/3375196008b411d59a8ef6b218a706d8.jpg" },
    { name: "权杖骑士", num: "Knight", type: "wands", eng: "Knight of Wands", keyword: "冒险", upright: "冒险精神、充沛能量、勇敢行动、自信进取、旅行出发、追求激情、冲动", reversed: "鲁莽行事、分散注意力、缺乏耐心、冲动后果、半途而废、能量耗尽", img: "https://i.postimg.cc/2SpJgXYk/47f44a5727edbaf82f76c243387bcf41.jpg" },
    { name: "权杖女王", num: "Queen", type: "wands", eng: "Queen of Wands", keyword: "魅力", upright: "魅力四射、自信满满、热情洋溢、独立自主、领袖气质、吸引他人、阳光", reversed: "自私自利、嫉妒心强、内向退缩、缺乏自信、热情熄灭、控制欲强", img: "https://i.postimg.cc/4xCMjFGX/82d378bbafc5c9a257c91a40e5a0deaf.jpg" },
    { name: "权杖国王", num: "King", type: "wands", eng: "King of Wands", keyword: "领袖", upright: "领袖风范、愿景远大、创业精神、激励他人、果断决策、成熟稳重、权威", reversed: "专横霸道、冲动行事、高压控制、滥用权力、决策失误、失去威信", img: "https://i.postimg.cc/MKfNPJC8/08f0f33165febd7ee79ac12ec795ad7e.jpg" },
    { name: "圣杯一", num: "Ace", type: "cups", eng: "Ace of Cups", keyword: "爱涌现", upright: "新恋情萌芽、情感开始流动、灵性连接、直觉增强、丰盛喜悦、爱满溢", reversed: "情感封闭、爱的阻塞、内心空虚、无法付出、情感枯竭、缺乏共鸣", img: "https://i.postimg.cc/nryRbM6k/273ec8e6e58eeb6ee63a63fd4f639b1f.jpg" },
    { name: "圣杯二", num: "2", type: "cups", eng: "Two of Cups", keyword: "联结", upright: "联结关系、伙伴关系、相互吸引、和谐互动、平等相爱、心灵相通、合作", reversed: "失衡关系、误解误会、分离倾向、单相思、情感不公、关系破裂", img: "https://i.postimg.cc/ZnG7t01P/e74f7e6d4e351965dc2b0ef1b3442d93.jpg" },
    { name: "圣杯三", num: "3", type: "cups", eng: "Three of Cups", keyword: "庆祝", upright: "庆祝欢聚、友情深厚、社群温暖、喜悦分享、创意合作、姐妹情谊、派对", reversed: "过度放纵、孤立自己、朋友冲突、表面和谐、情感消耗、团体矛盾", img: "https://i.postimg.cc/0jTWRrL0/832c9a5200494a0c807429cc93952286.jpg" },
    { name: "圣杯四", num: "4", type: "cups", eng: "Four of Cups", keyword: "冥想", upright: "冥想状态、无聊倦怠、重新评估、内省时刻、错过眼前机会、不满现状", reversed: "新机会出现、重新参与生活、走出冷漠、接受馈赠、打开心扉、觉醒", img: "https://i.postimg.cc/6q2jmC1M/15d1185a92f07038c32528152d7f73d0.jpg" },
    { name: "圣杯五", num: "5", type: "cups", eng: "Five of Cups", keyword: "失落", upright: "失落感强、悲伤情绪、后悔自责、专注负面、遗憾过去、无法释怀、痛苦", reversed: "从失去中恢复、学会接受、继续前进、看到希望、宽恕他人、放下", img: "https://i.postimg.cc/rs0nP5Yg/49dffe658b336e3f72b6c8e08d34eb24.jpg" },
    { name: "圣杯六", num: "6", type: "cups", eng: "Six of Cups", keyword: "怀旧", upright: "怀旧情绪、过去回忆、天真烂漫、收到礼物、童年记忆、重逢时刻、单纯", reversed: "困在过去、不切实际、成长受阻、无法前进、沉溺回忆、拒绝长大", img: "https://i.postimg.cc/J0D62jd3/1b73e7a42135de2e8bf75ec7d5731355.jpg" },
    { name: "圣杯七", num: "7", type: "cups", eng: "Seven of Cups", keyword: "幻想", upright: "幻想重重、选择过多、白日做梦、愿望投射、迷失方向、不切实际、诱惑", reversed: "聚焦目标、从幻想回归现实、决断时刻、看清真相、选择明确、落地", img: "https://i.postimg.cc/brDCB1Fk/6b9cba94ba7e150fee51a0deedbdfeca.jpg" },
    { name: "圣杯八", num: "8", type: "cups", eng: "Eight of Cups", keyword: "离去", upright: "离开现状、追寻更深意义、放下过去、踏上旅程、告别过去、探索精神", reversed: "逃避问题、放弃责任、停滞不前、不敢离开、犹豫不决、无处可去", img: "https://i.postimg.cc/KjkqHtsg/9d037a30311a7c71d8b112066e90a90a.jpg" },
    { name: "圣杯九", num: "9", type: "cups", eng: "Nine of Cups", keyword: "满足", upright: "满足感强、愿望成真、幸福满满、感恩之心、丰盛富足、自我实现、快乐", reversed: "不满足感、物质主义、过分自满、贪婪欲望、表面光鲜、内心空虚", img: "https://i.postimg.cc/Gt875vS8/2ee0bc4068be0dc8dc916a3d602da2af.jpg" },
    { name: "圣杯十", num: "10", type: "cups", eng: "Ten of Cups", keyword: "圆满", upright: "情感圆满、家庭幸福、内心平和、真爱永恒、和谐关系、幸福归宿、喜悦", reversed: "家庭矛盾、不和谐音、幸福幻灭、关系紧张、情感裂痕、失去和谐", img: "https://i.postimg.cc/ZnB7M6DR/28cf2538308f40a6a6bc321a45e80ba2.jpg" },
    { name: "圣杯侍者", num: "Page", type: "cups", eng: "Page of Cups", keyword: "直觉", upright: "创意涌现、直觉信息、情感探索、艺术灵感、梦境启示、温柔敏感、消息", reversed: "情绪化严重、逃避现实、创意受阻、幼稚行为、情感混乱、不成熟", img: "https://i.postimg.cc/9MNgbL14/362ea49a1b85f4e980578e652a2e5097.jpg" },
    { name: "圣杯骑士", num: "Knight", type: "cups", eng: "Knight of Cups", keyword: "浪漫", upright: "浪漫多情、魅力四射、艺术气质、追求理想、情感冒险、温柔体贴、邀请", reversed: "多愁善感、幻想破灭、无法兑现诺言、情感欺骗、不切实际、逃避", img: "https://i.postimg.cc/85nX4Zwj/a194c456550d36f2c798a6b2ec24a9af.jpg" },
    { name: "圣杯女王", num: "Queen", type: "cups", eng: "Queen of Cups", keyword: "慈悲", upright: "同理心强、慈悲为怀、直觉敏锐、情感成熟、关怀他人、温柔包容、滋养", reversed: "情绪失控、不安全感强、依赖他人、情感勒索、过度敏感、脆弱", img: "https://i.postimg.cc/Sst1dgVK/80204fb42105c75a3ed665961917b0c4.jpg" },
    { name: "圣杯国王", num: "King", type: "cups", eng: "King of Cups", keyword: "情感智慧", upright: "情感平衡、智慧圆融、外交手腕、慷慨大方、情感成熟、包容稳定、温和", reversed: "情绪操控、冷漠无情、情绪不稳定、喜怒无常、压抑情感、虚假", img: "https://i.postimg.cc/G2SgKXzd/94e1246d36f6e13dc303bd3144b2896f.jpg" },
    { name: "宝剑一", num: "Ace", type: "swords", eng: "Ace of Swords", keyword: "真相", upright: "真相大白、思维清晰、突破困境、新思想涌现、正义伸张、理智战胜、洞察", reversed: "混乱思维、谎言欺骗、思维混乱、无法决断、真相被掩、误解重重", img: "https://i.postimg.cc/25GKbkZv/8796ef62d2135917b2585380ef1e403d.jpg" },
    { name: "宝剑二", num: "2", type: "swords", eng: "Two of Swords", keyword: "僵局", upright: "僵持不下、难以决断、封闭心门、逃避真相、拒绝看见、内心矛盾、平衡", reversed: "信息显现、做出决定、困境解除、看清真相、打开心扉、释放压力", img: "https://i.postimg.cc/yNjbg1ZJ/46a8207ec3f77e0436bdd2d958d85153.jpg" },
    { name: "宝剑三", num: "3", type: "swords", eng: "Three of Swords", keyword: "心碎", upright: "心碎欲绝、悲伤难抑、失去之痛、分离打击、痛苦折磨、泪水流淌、失望", reversed: "从悲伤恢复、宽恕他人、疗愈开始、接受现实、释放心痛、重新开始", img: "https://i.postimg.cc/bvgBDytZ/3f88e25f2caa455fab226c8e9b71e2b7.jpg" },
    { name: "宝剑四", num: "4", type: "swords", eng: "Four of Swords", keyword: "休养", upright: "休息恢复、静默冥想、暂时撤退、休养生息、独处充电、等待时机、安宁", reversed: "重返活动、再次激活、不耐烦休息、提前行动、精力恢复、躁动不安", img: "https://i.postimg.cc/3w1c48vN/0b76c577cc2f356ab474fde5c653a4f8.jpg" },
    { name: "宝剑五", num: "5", type: "swords", eng: "Five of Swords", keyword: "冲突", upright: "冲突升级、失败收场、空洞胜利、不诚实手段、争吵不断、胜之不武、损失", reversed: "和解可能、超越冲突、走向和平、放下争执、接受失败、寻求共识", img: "https://i.postimg.cc/XvLzGjCv/c7e327ad086f503b55be7b22a8ec7805.jpg" },
    { name: "宝剑六", num: "6", type: "swords", eng: "Six of Swords", keyword: "过渡", upright: "过渡时期、逃离困境、平静旅程、向前迈进、艰难前行、希望在前、疗愈", reversed: "抗拒改变、无处可逃、困难过渡、停滞不前、反复挣扎、无法摆脱", img: "https://i.postimg.cc/fbCrtz9M/c4d36a80ec72fcc67689b64f536e6c5a.jpg" },
    { name: "宝剑七", num: "7", type: "swords", eng: "Seven of Swords", keyword: "策略", upright: "策略计划、欺骗隐瞒、单独行动、不诚实手段、智取逃避、偷偷摸摸、机智", reversed: "真相揭露、良心发现、归还所得、承认错误、放弃欺骗、面对后果", img: "https://i.postimg.cc/jjcFwx7b/a3f6098c94ec09059bfc931d09bd6b16.jpg" },
    { name: "宝剑八", num: "8", type: "swords", eng: "Eight of Swords", keyword: "束缚", upright: "受困束缚、限制重重、负面思维、无助感强、自我设限、无法挣脱、恐惧", reversed: "重获自由、新视角出现、接受帮助、打破枷锁、释放自我、看清真相", img: "https://i.postimg.cc/MGqLpMvT/04fcc588cd33657692a92619aea39ed7.jpg" },
    { name: "宝剑九", num: "9", type: "swords", eng: "Nine of Swords", keyword: "焦虑", upright: "焦虑不安、噩梦连连、担忧过度、内心痛苦、罪恶感强、失眠困扰、绝望", reversed: "从绝望走出、寻求帮助、希望重现、减轻焦虑、放下负担、自我宽恕", img: "https://i.postimg.cc/cJ0zLgr4/e81e8ab062e810198907252f14b0b2f2.jpg" },
    { name: "宝剑十", num: "10", type: "swords", eng: "Ten of Swords", keyword: "终结", upright: "终结时刻、失败打击、被背叛感、最低谷期、痛苦结束、崩溃边缘、绝望", reversed: "从失败恢复、抗拒接受、新开始萌芽、慢慢起身、教训吸取、重生", img: "https://i.postimg.cc/FKN6Hd7h/227daf3b9af1be2460550dca58bded74.jpg" },
    { name: "宝剑侍者", num: "Page", type: "swords", eng: "Page of Swords", keyword: "洞察", upright: "好奇心强、洞察力敏锐、机警灵活、新想法涌现、警觉性高、学习迅速、消息", reversed: "散漫无序、粗心大意、言语伤人、八卦传播、缺乏重点、沟通不畅", img: "https://i.postimg.cc/yNsG8gk4/f3bac9ab5a52947e4b66a4ac632d70ef.jpg" },
    { name: "宝剑骑士", num: "Knight", type: "swords", eng: "Knight of Swords", keyword: "冲劲", upright: "行动力强、冲劲十足、直接果断、野心勃勃、智慧战斗、快速前进、勇气", reversed: "鲁莽行事、仓促决定、过于好斗、言语尖刻、不顾后果、急躁冲动", img: "https://i.postimg.cc/1zsd3n42/522975dc24a7604bd9446badf86a42d1.jpg" },
    { name: "宝剑女王", num: "Queen", type: "swords", eng: "Queen of Swords", keyword: "独立", upright: "独立自主、清晰思考、直接坦率、聪明睿智、设立界限、理性决策、诚实", reversed: "刻薄无情、过于批判、痛苦过往、冷漠疏离、心胸狭隘、报复心强", img: "https://i.postimg.cc/KYxW8k4V/7e8f572137114fa7dc96882b66dfc560.jpg" },
    { name: "宝剑国王", num: "King", type: "swords", eng: "King of Swords", keyword: "理性", upright: "理性权威、思维清晰、道德标准高、客观决策、公正判断、智慧领导、经验", reversed: "操控他人、专横霸道、滥用权力、冷酷无情、判断失误、刚愎自用", img: "https://i.postimg.cc/7LwRZGbN/b0f5d9218e2e4ef9a4652df089b97b9a.jpg" },
    { name: "星币一", num: "Ace", type: "pentacles", eng: "Ace of Pentacles", keyword: "机遇", upright: "新物质机遇、丰盛富足、财富开始、安全感增强、实用开端、踏实起步、礼物", reversed: "错失良机、财务不稳、固执己见、投资失误、缺乏规划、机会溜走", img: "https://i.postimg.cc/9MNgbL1V/94448c6a431ceb9959491624fea0e38a.jpg" },
    { name: "星币二", num: "2", type: "pentacles", eng: "Two of Pentacles", keyword: "平衡", upright: "多任务处理、适应性强、时间管理、收支平衡、灵活应对、忙中有序、节奏", reversed: "失去平衡、混乱无序、过度承诺、财务紧张、手忙脚乱、无法兼顾", img: "https://i.postimg.cc/G2SgKXK6/757698797cf41a491b3ab99d688854dc.jpg" },
    { name: "星币三", num: "3", type: "pentacles", eng: "Three of Pentacles", keyword: "协作", upright: "团队合作、技能提升、协作共赢、学习成长、学徒阶段、共同目标、认可", reversed: "缺乏团队精神、品质不达标、孤立工作、沟通不畅、技术不足、合作失败", img: "https://i.postimg.cc/Kzspf0fp/a452903cc09ba4daa5cab2093c51a5c3.jpg" },
    { name: "星币四", num: "4", type: "pentacles", eng: "Four of Pentacles", keyword: "守护", upright: "安全感需求、节俭储蓄、守护财富、控制欲强、固守现状、保守稳重、积累", reversed: "过度节俭、贪婪成性、财务损失、抓得太紧、不愿分享、害怕失去", img: "https://i.postimg.cc/k45hW0NP/26b157d62962905f2dc877344c61e1b9.jpg" },
    { name: "星币五", num: "5", type: "pentacles", eng: "Five of Pentacles", keyword: "艰难", upright: "艰难时期、物质损失、孤立无援、健康问题、贫困感强、被排斥外、担忧", reversed: "从艰难恢复、寻求帮助、好转迹象、重获支持、走出低谷、改善", img: "https://i.postimg.cc/TwPHnzVz/d4f448dd9e6eac42bd34952713f8b35a.jpg" },
    { name: "星币六", num: "6", type: "pentacles", eng: "Six of Pentacles", keyword: "给予", upright: "慷慨给予、接受馈赠、平衡施受、慈善行为、财富流动、帮助他人、分享", reversed: "债务缠身、吝啬小气、权力不平衡、索取过度、依赖他人、不公", img: "https://i.postimg.cc/ZRqD6G82/68b1beb7020af71fa4e727c28dc610d6.jpg" },
    { name: "星币七", num: "7", type: "pentacles", eng: "Seven of Pentacles", keyword: "耕耘", upright: "长期投资、耐心等待、成果评估、持续努力、耕耘收获、审视进度、坚持", reversed: "缺乏远见、焦虑不安、无效努力、回报不足、灰心丧气、放弃坚持", img: "https://i.postimg.cc/cHJ5fpRD/4e78f21fb36d384b237ce384885a5fb0.jpg" },
    { name: "星币八", num: "8", type: "pentacles", eng: "Eight of Pentacles", keyword: "精进", upright: "工匠精神、技能提升、投入工作、专注细节、精益求精、学习钻研、勤奋", reversed: "完美主义、缺乏专注、质量下降、工作倦怠、敷衍了事、技能不足", img: "https://i.postimg.cc/JnhdjfNp/dde01f64fc66e6c7446edc3750f81cb0.jpg" },
    { name: "星币九", num: "9", type: "pentacles", eng: "Nine of Pentacles", keyword: "优雅", upright: "丰盛富足、优雅从容、自给自足、物质享受、独立自信、花园丰收、宁静", reversed: "过度劳累、物质主义、虚假繁荣、孤独空虚、依赖他人、表面光鲜", img: "https://i.postimg.cc/4d3FpD65/68db2a7d50d230a020feb7f6f404efa3.jpg" },
    { name: "星币十", num: "10", type: "pentacles", eng: "Ten of Pentacles", keyword: "圆满", upright: "家族传承、长期稳定、财富圆满、遗产继承、世代繁荣、根基深厚、归属", reversed: "家族冲突、财务不稳、传统破裂、遗产纠纷、失去根基、离散", img: "https://i.postimg.cc/tTgmFK3d/40492228d3d7b1658ef883153e8d6e3b.jpg" },
    { name: "星币侍者", num: "Page", type: "pentacles", eng: "Page of Pentacles", keyword: "学习", upright: "学习热情、实际技能、计划制定、谨慎踏实、新工作开始、专注努力、潜力", reversed: "缺乏进展、不切实际、懒惰拖延、学习受阻、目标不明、浪费时间", img: "https://i.postimg.cc/76LQSF3S/372d86040b237875ac164802856a4432.jpg" },
    { name: "星币骑士", num: "Knight", type: "pentacles", eng: "Knight of Pentacles", keyword: "务实", upright: "勤勉可靠、务实稳重、责任心强、按部就班、耐心坚持、工作努力、守护", reversed: "停滞不前、无聊乏味、过于保守、缺乏冒险、效率低下、固执不变", img: "https://i.postimg.cc/G2pSvWFD/f9dedf51440bafc9ddb64b8ecf45362a.jpg" },
    { name: "星币女王", num: "Queen", type: "pentacles", eng: "Queen of Pentacles", keyword: "滋养", upright: "务实养育、富足慷慨、关爱家庭、接地气的生活、物质与情感平衡、舒适", reversed: "工作与生活失衡、嫉妒他人、过度物质、忽视情感、操劳过度、焦虑", img: "https://i.postimg.cc/xCdFLwvN/9aa38a0ab78af98aeb73d93a00b74573.jpg" },
    { name: "星币国王", num: "King", type: "pentacles", eng: "King of Pentacles", keyword: "繁荣", upright: "物质成功、财务安全、商业头脑、可靠稳重、富足丰盛、投资有道、成就", reversed: "固执己见、物质主义、冒险财务、贪婪腐败、失去判断、投资失败", img: "https://i.postimg.cc/MG5FM6Q0/c8093dafa7eb0921bb16f32c77df51f6.jpg" }
];const TAROT_TYPE_NAMES = { major: '大阿卡纳', wands: '权杖', cups: '圣杯', swords: '宝剑', pentacles: '星币' };

let currentTarotSpread = 'single';

function setTarotSpread(spread) {
    currentTarotSpread = spread;
    document.querySelectorAll('.tarot-spread-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.spread === spread);
    });
    const desc = document.getElementById('tarot-spread-desc');
    if (spread === 'single') {
        if (desc) desc.textContent = '单张牌 · 直指当下';
    } else if (spread === 'three') {
        if (desc) desc.textContent = '三张牌 · 洞察全局';
    }
}

function resetTarotDivination() {
    const setup = document.getElementById('tarot-setup');
    const result = document.getElementById('tarot-result');
    const resetBtn = document.getElementById('tarot-reset-btn');
    const qInput = document.getElementById('tarot-question');
    if (setup) setup.style.display = '';
    if (result) result.style.display = 'none';
    if (resetBtn) resetBtn.style.display = 'none';
    if (qInput) qInput.value = '';
    currentTarotSpread = 'single';
    document.querySelectorAll('.tarot-spread-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.spread === 'single');
    });
    const desc = document.getElementById('tarot-spread-desc');
    if (desc) desc.textContent = '单张牌 · 直指当下';
}

function startTarotDraw() {
    const shuffled = [...ALL_78_TAROT_CARDS].sort(() => Math.random() - 0.5);
    const question = (document.getElementById('tarot-question') || {}).value || '';
    const questionTrimmed = question.trim();
    const drawnCards = [];

function cardHTML(card, position, labelOverride) {
        const isReversed = Math.random() > 0.5;
        const meaning = isReversed ? card.reversed : card.upright;
        const posLabel = labelOverride || position;
        
        drawnCards.push({ name: card.name, keyword: card.keyword, position: posLabel, isReversed, meaning });

        const frontContent = card.img 
            ? `<img src="${card.img}" style="width: 100%; height: 100%; object-fit: cover; ${isReversed ? 'transform: rotate(180deg);' : ''}">`
            : `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; background:var(--primary-bg); color:var(--text-secondary);">
                 <i class="fas ${card.icon}" style="font-size:40px; margin-bottom:10px; ${isReversed ? 'transform: rotate(180deg);' : ''}"></i>
                 <div style="font-size:14px; font-weight:bold;">${card.name}</div>
                 <div style="font-size:10px; margin-top:5px;"></div>
               </div>`;

return `
        <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
            <div class="tarot-container-3d tarot-responsive" style="margin-bottom: 10px; cursor: pointer;" onclick="this.classList.toggle('flipped');">
                <div class="tarot-card-inner">
                    <div class="tarot-face tarot-front" style="padding: 0; overflow: hidden; border: 2px solid var(--border-color); background: var(--secondary-bg);">
                        ${frontContent}
                    </div>

                    <div class="tarot-face tarot-back" style="background: linear-gradient(135deg, var(--secondary-bg), rgba(var(--accent-color-rgb), 0.05)); border: 2px solid rgba(var(--accent-color-rgb), 0.3); padding: 15px 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow-y: auto;">
                        <div style="font-size:10px; color:var(--text-secondary); margin-bottom:6px;">${posLabel}</div>
                        <div class="tarot-card-name" style="font-size:16px; font-weight: 700;">${card.name}</div>
                        <div class="tarot-position-badge ${isReversed ? 'reversed' : 'upright'}" style="margin:4px auto; font-size:10px; padding: 2px 8px; background: var(--primary-bg);">${isReversed ? '逆位' : '正位'}</div>
                        <div style="font-weight: bold; color: var(--accent-color); font-size:12px; margin: 8px 0 4px;">「${card.keyword}」</div>
                        <div style="font-size: 11px; text-align: left; line-height: 1.6; color: var(--text-primary); width: 100%;">${meaning}</div>
                    </div>
                </div>
            </div>
        </div>`;
    }
    let resultHTML = '';
    const qDisplay = questionTrimmed ? `<div class="lenormand-question-show">「${questionTrimmed}」</div>` : '';
    let spreadLabel = '';

    if (currentTarotSpread === 'single') {
        spreadLabel = '单张塔罗';
        const card = shuffled[0];
        resultHTML = `${qDisplay}
        <div style="text-align:center;font-size:12px;color:var(--text-secondary);margin-bottom:12px;"><i class="fas fa-star-and-crescent"></i> 塔罗为你揭示 · 一切皆有答案</div>
        <div class="tarot-row single-card">${cardHTML(card, '当下')}</div>`;
    } else if (currentTarotSpread === 'three') {
        spreadLabel = '三张塔罗';
        const [card1, card2, card3] = shuffled.slice(0, 3);
        resultHTML = `${qDisplay}
        <div style="text-align:center;font-size:12px;color:var(--text-secondary);margin-bottom:12px;"><i class="fas fa-star-and-crescent"></i> 三张牌为你揭示 · 洞见能量流动</div>
        <div class="tarot-row">${cardHTML(card1, '牌一')}${cardHTML(card2, '牌二')}${cardHTML(card3, '牌三')}</div>`;
    }

    const resultEl = document.getElementById('tarot-result');
    const setupEl = document.getElementById('tarot-setup');
    const resetBtn = document.getElementById('tarot-reset-btn');
    if (resultEl) { resultEl.innerHTML = resultHTML; resultEl.style.display = ''; }
    if (setupEl) setupEl.style.display = 'none';
    if (resetBtn) resetBtn.style.display = '';

    saveDiviHistory({ type: spreadLabel, question: questionTrimmed, cards: drawnCards });
}

document.addEventListener('click', function(e) {
    const btn = e.target.closest('.tarot-spread-btn');
    if (!btn) return;
    setTarotSpread(btn.dataset.spread);
});
document.addEventListener('click', function(e) {
    if (e.target.id === 'close-tarot-divination') {
        const modal = document.getElementById('fortune-lenormand-modal');
        if (modal) hideModal(modal);
    }
});

const DIVI_HISTORY_KEY = 'diviHistory_v1';
const DIVI_HISTORY_MAX = 50;

function getDiviHistory() {
    try { return JSON.parse(localStorage.getItem(DIVI_HISTORY_KEY) || '[]'); } catch(e) { return []; }
}

function saveDiviHistory(entry) {
    const history = getDiviHistory();
    entry.id = Date.now();
    entry.time = new Date().toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    history.unshift(entry);
    if (history.length > DIVI_HISTORY_MAX) history.splice(DIVI_HISTORY_MAX);
    localStorage.setItem(DIVI_HISTORY_KEY, JSON.stringify(history));
}

function clearDiviHistory() {
    if (!confirm('确定要清空所有占卜记录吗？')) return;
    localStorage.removeItem(DIVI_HISTORY_KEY);
    renderDiviHistory();
}

function renderDiviHistory() {
    const list = document.getElementById('divi-history-list');
    const empty = document.getElementById('divi-history-empty');
    if (!list) return;
    const history = getDiviHistory();
    if (!history.length) {
        list.innerHTML = '';
        if (empty) empty.style.display = '';
        return;
    }
    if (empty) empty.style.display = 'none';
    list.innerHTML = history.map(entry => {
        const cardTags = (entry.cards || []).map(c =>
            `<span class="divi-history-card-tag ${c.isReversed ? 'reversed' : ''}">
                ${c.isReversed ? '<i class="fas fa-arrow-down" style="font-size:9px;"></i>' : '<i class="fas fa-arrow-up" style="font-size:9px;"></i>'}
                ${c.name}
            </span>`
        ).join('');
        const detailLines = (entry.cards || []).map(c =>
            `<div style="margin-bottom:6px;"><b>${c.name}${c.isReversed ? ' 逆位' : ' 正位'}</b><br>${c.keyword} — ${c.meaning}</div>`
        ).join('');
        return `
        <div class="divi-history-item">
            <div class="divi-history-meta">
                <span class="divi-history-type">${entry.type || '占卜'}</span>
                <span class="divi-history-time">${entry.time || ''}</span>
            </div>
            ${entry.question ? `<div class="divi-history-question">「${entry.question}」</div>` : ''}
            <div class="divi-history-cards">${cardTags}</div>
            ${detailLines ? `<button class="divi-history-expand-btn" onclick="toggleDiviDetail(this)">查看解读 ▾</button>
            <div class="divi-history-detail">${detailLines}</div>` : ''}
        </div>`;
    }).join('');
}
function toggleDiviDetail(btn) {
    const detail = btn.nextElementSibling;
    if (!detail) return;
    const open = detail.classList.toggle('open');
    btn.textContent = open ? '收起 ▴' : '查看解读 ▾';
}

const _origSwitchFLTab = switchFLTab;
window.switchFLTab = function(tab) {
    _origSwitchFLTab(tab);
    if (tab === 'divihistory') renderDiviHistory();
};

document.addEventListener('click', function(e) {
    if (e.target.id === 'close-divihistory') {
        const modal = document.getElementById('fortune-lenormand-modal');
        if (modal) hideModal(modal);
    }
});

function renderFavorites() {
    const list = document.getElementById('favorites-list');
    if (!list) return;

    const favoritedMessages = (typeof messages !== 'undefined' ? messages : [])
        .filter(m => m.favorited && m.type !== 'system');

    if (favoritedMessages.length === 0) {
        list.innerHTML = `
            <div class="stats-empty-state">
                <div class="stats-empty-icon"><i class="fas fa-star"></i></div>
                <h3>收藏夹空空如也</h3>
                <p>点击消息旁的 ☆ 星标即可收藏</p>
            </div>`;
        return;
    }

    list.innerHTML = favoritedMessages.map(msg => {
        const isUser = msg.sender === 'user';
        const senderName = isUser
            ? ((typeof settings !== 'undefined' && settings.myName) || '我')
            : ((typeof settings !== 'undefined' && settings.partnerName) || msg.sender || '对方');
        const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        }) : '';
        const content = msg.text
            ? msg.text.replace(/</g, '&lt;').replace(/>/g, '&gt;')
            : msg.image
                ? `<img src="${msg.image}" style="max-width:100%;max-height:180px;border-radius:8px;display:block;margin-top:4px;cursor:pointer;" onclick="if(typeof viewImage==='function')viewImage('${msg.image.replace(/'/g,'\\\'')}')" loading="lazy">`
                : msg.voice
                    ? `<div class="fav-voice-btn" data-msg-id="${msg.id}" data-fake-text="${(msg.voice.fakeText||'').replace(/"/g,'&quot;')}" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(var(--accent-color-rgb),0.1);border-radius:20px;cursor:pointer;"><svg viewBox="0 0 22 22" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-color);flex-shrink:0;"><circle cx="6" cy="11" r="1.3" fill="currentColor" stroke="none"/><path d="M10 8 A 3.5 3.5 0 0 1 10 14"/><path d="M13 5 A 7 7 0 0 1 13 17"/></svg><span style="font-size:12px;color:var(--accent-color);">${msg.voice.duration || 0}"</span></div>${msg.voice.fakeText ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${msg.voice.fakeText.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>` : ''}`
                    : '';
        const avatarEl = isUser
            ? (typeof DOMElements !== 'undefined' ? DOMElements.me.avatar : null)
            : (typeof DOMElements !== 'undefined' ? DOMElements.partner.avatar : null);
        const avatarImg = avatarEl ? avatarEl.querySelector('img') : null;
        const avatarHtml = avatarImg
            ? `<img src="${avatarImg.src}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
            : `<div style="width:28px;height:28px;border-radius:50%;background:rgba(var(--accent-color-rgb),0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas fa-user" style="font-size:11px;color:var(--accent-color);"></i></div>`;
        return `
            <div class="fav-item" style="
                display:flex;flex-direction:column;gap:4px;
                padding:12px 14px;border-radius:12px;
                background:var(--primary-bg);
                border:1px solid var(--border-color);
                margin-bottom:10px;
                position:relative;
            ">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                    ${avatarHtml}
                    <span style="font-size:12px;font-weight:600;color:var(--accent-color);">${senderName}</span>
                    <span style="font-size:11px;color:var(--text-secondary);margin-left:auto;padding-right:24px;">${ts}</span>
                </div>
                <div style="font-size:13px;color:var(--text-primary);line-height:1.5;word-break:break-word;">${content}</div>
                <button class="fav-remove-btn" data-id="${msg.id}" style="
                    position:absolute;top:8px;right:10px;
                    background:none;border:none;cursor:pointer;
                    color:var(--text-secondary);font-size:14px;padding:2px 4px;
                    opacity:0.6;
                " title="取消收藏"><i class="fas fa-star" style="color:var(--accent-color);"></i></button>
            </div>`;
    }).join('');

    list.querySelectorAll('.fav-remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = Number(btn.dataset.id);
            const msg = (typeof messages !== 'undefined' ? messages : []).find(m => m.id === id);
            if (msg) {
                msg.favorited = false;
                if (typeof throttledSaveData === 'function') throttledSaveData();
                if (typeof showNotification === 'function') showNotification('已取消收藏', 'success', 1500);
                // 同步更新聊天里对应消息的星星按钮状态
                const chatWrapper = document.querySelector(`.message-wrapper[data-msg-id="${id}"], .message-wrapper[data-id="${id}"]`);
                if (chatWrapper) {
                    const favBtn = chatWrapper.querySelector('.favorite-action-btn');
                    if (favBtn) {
                        favBtn.classList.remove('favorited');
                        favBtn.title = '收藏';
                        const icon = favBtn.querySelector('i');
                        if (icon) { icon.className = 'far fa-star'; }
                    }
                }
                renderFavorites();
            }
        });
    });

    // 语音条点击播放
    let _favCurrentAudio = null;
    let _favCurrentBtn = null;

    list.querySelectorAll('.fav-voice-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (btn.dataset.playing === '1') {
                // 点同一个正在播的 → 暂停
                if (_favCurrentAudio) { _favCurrentAudio.pause(); _favCurrentAudio = null; }
                btn.dataset.playing = '0';
                btn.style.opacity = '1';
                _favCurrentBtn = null;
                return;
            }

            // 停掉正在播的其他语音
            if (_favCurrentAudio) {
                _favCurrentAudio.pause();
                _favCurrentAudio = null;
            }
            if (_favCurrentBtn && _favCurrentBtn !== btn) {
                _favCurrentBtn.dataset.playing = '0';
                _favCurrentBtn.style.opacity = '1';
                _favCurrentBtn = null;
            }

            const msgId = btn.dataset.msgId;
            const fakeText = btn.dataset.fakeText;
            btn.dataset.playing = '1';
            btn.style.opacity = '0.6';
            _favCurrentBtn = btn;
            try {
                let audioUrl = null;

                // 先查 IndexedDB 持久化缓存（有缓存则直接播，不依赖 TTS 配置）
                try {
                    // 阶段四：键名带 SESSION_ID 前缀；值可以是 base64 或 oss:// 引用
                    const key = window.favAudioKey ? window.favAudioKey(msgId) : `favAudio_${msgId}`;
                    let stored = await localforage.getItem(key);
                    // 兼容旧键名（无 SESSION_ID 前缀）
                    if (!stored) {
                        stored = await localforage.getItem(`favAudio_${msgId}`);
                    }
                    if (stored && typeof stored === 'string') {
                        if (stored.startsWith('oss://')) {
                            // 云端引用：fetch blob URL
                            if (window.CloudMedia) {
                                const blobUrl = await window.CloudMedia.fetchUrl(stored);
                                audioUrl = blobUrl;
                            }
                        } else {
                            // 老格式：裸 base64
                            const binary = atob(stored);
                            const bytes = new Uint8Array(binary.length);
                            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                            const blob = new Blob([bytes], { type: 'audio/mpeg' });
                            audioUrl = URL.createObjectURL(blob);
                        }
                    }
                } catch (e) {}

                // 没有缓存才需要 TTS，此时检查配置是否就绪
                if (!audioUrl) {
                    if (!fakeText) {
                        btn.dataset.playing = '0';
                        btn.style.opacity = '1';
                        if (_favCurrentBtn === btn) { _favCurrentBtn = null; }
                        return;
                    }
                    if (!window.voiceTTS || !window.voiceTTS.isTtsReady()) {
                        if (typeof showNotification === 'function') showNotification('请先在聊天设置里配置真实语音', 'info');
                        btn.dataset.playing = '0';
                        btn.style.opacity = '1';
                        if (_favCurrentBtn === btn) { _favCurrentBtn = null; }
                        return;
                    }
                    audioUrl = await window.voiceTTS.getAudioForMessage(msgId, fakeText);
                }

                // 加载期间可能已经被别的点击停掉了
                if (_favCurrentBtn !== btn) return;

                const audio = new Audio(audioUrl);
                if (window.voiceTTS && window.voiceTTS.applyPlaybackSettings) window.voiceTTS.applyPlaybackSettings(audio);
                _favCurrentAudio = audio;
                audio.play();
                audio.onended = () => {
                    btn.dataset.playing = '0';
                    btn.style.opacity = '1';
                    if (_favCurrentBtn === btn) { _favCurrentBtn = null; _favCurrentAudio = null; }
                };
                audio.onerror = () => {
                    btn.dataset.playing = '0';
                    btn.style.opacity = '1';
                    if (_favCurrentBtn === btn) { _favCurrentBtn = null; _favCurrentAudio = null; }
                };
            } catch (err) {
                btn.dataset.playing = '0';
                btn.style.opacity = '1';
                if (_favCurrentBtn === btn) { _favCurrentBtn = null; _favCurrentAudio = null; }
                console.error('[fav voice]', err);
            }
        });
    });
}
window.renderFavorites = renderFavorites;

window._runMsgSearch = function() {
    const input = document.getElementById('msg-search-input');
    const dateFrom = document.getElementById('msg-search-date-from');
    const dateTo = document.getElementById('msg-search-date-to');
    const resultsEl = document.getElementById('msg-search-results');
    if (!resultsEl) return;

    const q = (input ? input.value.trim() : '').toLowerCase();
    const from = dateFrom && dateFrom.value ? new Date(dateFrom.value) : null;
    const to = dateTo && dateTo.value ? new Date(dateTo.value + 'T23:59:59') : null;

    if (!q && !from && !to) {
        resultsEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);font-size:13px;">输入关键词或选择日期开始搜索</div>';
        return;
    }

    const allMessages = typeof messages !== 'undefined' ? messages : [];
    const results = allMessages.filter(m => {
        if (m.type === 'system') return false;
        const ts = m.timestamp ? new Date(m.timestamp) : null;
        if (from && ts && ts < from) return false;
        if (to && ts && ts > to) return false;
        if (q && m.text && m.text.toLowerCase().includes(q)) return true;
        if (q && !m.text && m.image) return false; 
        return !q; 
    });

    if (results.length === 0) {
        resultsEl.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-secondary);font-size:13px;">未找到 "${q || '相关'}" 的消息</div>`;
        return;
    }

    const myAvatarEl = typeof DOMElements !== 'undefined' ? DOMElements.me.avatar : null;
    const partnerAvatarEl = typeof DOMElements !== 'undefined' ? DOMElements.partner.avatar : null;
    const myImg = myAvatarEl ? myAvatarEl.querySelector('img') : null;
    const partnerImg = partnerAvatarEl ? partnerAvatarEl.querySelector('img') : null;

    function getAvatarHtml(isUser) {
        const img = isUser ? myImg : partnerImg;
        if (img) return `<img src="${img.src}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;">`;
        return `<div style="width:28px;height:28px;border-radius:50%;background:rgba(var(--accent-color-rgb),0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas fa-user" style="font-size:11px;color:var(--accent-color);"></i></div>`;
    }

    function highlight(text, keyword) {
        if (!keyword) return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const escaped = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const re = new RegExp('(' + keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        return escaped.replace(re, '<mark style="background:rgba(var(--accent-color-rgb),0.25);color:var(--accent-color);border-radius:2px;padding:0 1px;">$1</mark>');
    }

    resultsEl.innerHTML = results.slice(0, 100).map(msg => {
        const isUser = msg.sender === 'user';
        const senderName = isUser
            ? ((typeof settings !== 'undefined' && settings.myName) || '我')
            : ((typeof settings !== 'undefined' && settings.partnerName) || msg.sender || '对方');
        const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        }) : '';
        const content = msg.text
            ? highlight(msg.text, q)
            : (msg.image ? `<img src="${msg.image}" style="max-height:60px;border-radius:6px;display:block;margin-top:4px;" loading="lazy">` : '');
        return `<div style="display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border-radius:12px;background:var(--primary-bg);border:1px solid var(--border-color);margin-bottom:8px;cursor:pointer;"
            onclick="if(typeof showNotification==='function')showNotification('已定位消息', 'info', 1500); if(typeof scrollToQuotedMessage==='function'){var el=document.createElement('div');el.dataset.replyId='${msg.id}';scrollToQuotedMessage(el);}">
            ${getAvatarHtml(isUser)}
            <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                    <span style="font-size:12px;font-weight:600;color:var(--accent-color);">${senderName}</span>
                    <span style="font-size:11px;color:var(--text-secondary);">${ts}</span>
                </div>
                <div style="font-size:13px;color:var(--text-primary);line-height:1.5;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;">${content}</div>
            </div>
        </div>`;
    }).join('') + (results.length > 100 ? `<div style="text-align:center;padding:10px;font-size:12px;color:var(--text-secondary);">仅显示前100条，共找到 ${results.length} 条</div>` : '');
};

let wheelOptions = ["是", "否", "再想一想", "听你的"];
let wheelResultText = "";

function initDecisionModule() {
    const entryBtn = document.getElementById('decision-function'); 
    if(entryBtn) {
        const newBtn = entryBtn.cloneNode(true);
        entryBtn.parentNode.replaceChild(newBtn, entryBtn);
        newBtn.addEventListener('click', () => {
            hideModal(document.getElementById('advanced-modal'));
            showModal(document.getElementById('decision-menu-modal'));
        });
    }

    const openCoinBtn = document.getElementById('open-coin-toss');
    const openWheelBtn = document.getElementById('open-wheel');
    const closeMenuBtn = document.getElementById('close-decision-menu');
    const closeWheelBtn = document.getElementById('close-wheel');
    const addOptionBtn = document.getElementById('add-wheel-option');
    const spinBtn = document.getElementById('spin-wheel-btn');
    const sendResultBtn = document.getElementById('send-wheel-result');

    if (openCoinBtn && !openCoinBtn.dataset.initialized) {
        openCoinBtn.addEventListener('click', () => {
            hideModal(document.getElementById('decision-menu-modal'));
            handleCoinToss();
        });
        openCoinBtn.dataset.initialized = 'true';
    }

    if (openWheelBtn && !openWheelBtn.dataset.initialized) {
        openWheelBtn.addEventListener('click', () => {
            hideModal(document.getElementById('decision-menu-modal'));
            initPicker();
            showModal(document.getElementById('wheel-modal'));
        });
        openWheelBtn.dataset.initialized = 'true';
    }
    
    if (closeMenuBtn && !closeMenuBtn.dataset.initialized) {
        closeMenuBtn.addEventListener('click', () => hideModal(document.getElementById('decision-menu-modal')));
        closeMenuBtn.dataset.initialized = 'true';
    }

    if (closeWheelBtn && !closeWheelBtn.dataset.initialized) {
        closeWheelBtn.addEventListener('click', () => hideModal(document.getElementById('wheel-modal')));
        closeWheelBtn.dataset.initialized = 'true';
    }

    if (addOptionBtn && !addOptionBtn.dataset.initialized) {
        addOptionBtn.addEventListener('click', () => {
            wheelOptions.push(`选项 ${wheelOptions.length + 1}`);
            renderPickerOptions();
            renderPickerCards();
        });
        addOptionBtn.dataset.initialized = 'true';
    }

    if (spinBtn && !spinBtn.dataset.initialized) {
        spinBtn.addEventListener('click', doPick);
        spinBtn.dataset.initialized = 'true';
    }
    
    if (sendResultBtn && !sendResultBtn.dataset.initialized) {
        sendResultBtn.addEventListener('click', () => {
            if(wheelResultText) {
                sendMessage(`✨ 随机抽签结果：${wheelResultText}`, 'normal');
                hideModal(document.getElementById('wheel-modal'));
                wheelResultText = "";
                sendResultBtn.style.display = 'none';
                const resultEl = document.getElementById('wheel-result');
                if (resultEl) { resultEl.textContent = ""; resultEl.classList.remove('show'); }
                spinBtn.disabled = false;
            }
        });
        sendResultBtn.dataset.initialized = 'true';
    }
}

function initPicker() {
    renderPickerOptions();
    renderPickerCards();
    const result = document.getElementById('wheel-result');
    const sendBtn = document.getElementById('send-wheel-result');
    const spinBtn = document.getElementById('spin-wheel-btn');
    if (result) { result.textContent = ""; result.classList.remove('show'); }
    if (sendBtn) sendBtn.style.display = 'none';
    if (spinBtn) spinBtn.disabled = false;
    wheelResultText = "";
}

function renderPickerOptions() {
    const list = document.getElementById('wheel-options-list');
    if (!list) return;
    list.innerHTML = '';
    const colors = ['#FFD93D','#FF6B6B','#6BCB77','#4D96FF','#E0C3FC','#FF9A8B','#A8D8EA','#C44569'];
    wheelOptions.forEach((opt, index) => {
        const item = document.createElement('div');
        item.className = 'picker-option-item';
        item.innerHTML = `
            <div class="picker-option-color-dot" style="background:${colors[index % colors.length]}"></div>
            <input type="text" class="picker-option-input" value="${opt}" placeholder="输入选项...">
            <span class="picker-option-remove"><i class="fas fa-times"></i></span>
        `;
        item.querySelector('input').addEventListener('input', (e) => {
            wheelOptions[index] = e.target.value;
            renderPickerCards();
        });
        item.querySelector('.picker-option-remove').addEventListener('click', () => {
            if(wheelOptions.length <= 2) {
                showNotification('至少保留两个选项', 'warning');
                return;
            }
            wheelOptions.splice(index, 1);
            renderPickerOptions();
            renderPickerCards();
        });
        list.appendChild(item);
    });
}

function renderPickerCards(selectedIndex = -1) {
    const row = document.getElementById('picker-cards-row');
    if (!row) return;
    const colors = ['#FFD93D','#FF6B6B','#6BCB77','#4D96FF','#E0C3FC','#FF9A8B','#A8D8EA','#C44569'];
    row.innerHTML = '';
    wheelOptions.forEach((opt, i) => {
        const card = document.createElement('div');
        card.className = 'picker-card';
        if (selectedIndex >= 0) {
            if (i === selectedIndex) card.classList.add('selected');
            else card.classList.add('unselected');
        }
        if (selectedIndex >= 0 && i === selectedIndex) {
            card.style.background = `linear-gradient(135deg, ${colors[i % colors.length]}, ${colors[(i+2) % colors.length]})`;
        } else {
            card.style.borderTop = `3px solid ${colors[i % colors.length]}`;
        }
        card.style.animationDelay = (i * 0.06) + 's';
        const label = opt || `选项${i+1}`;
        card.textContent = label.length > 6 ? label.slice(0,5) + '…' : label;
        row.appendChild(card);
    });
}

function doPick() {
    if (wheelOptions.length < 2) {
        showNotification("请至少添加两个选项", "warning");
        return;
    }
    const spinBtn = document.getElementById('spin-wheel-btn');
    const resultDisplay = document.getElementById('wheel-result');
    const sendBtn = document.getElementById('send-wheel-result');
    
    spinBtn.disabled = true;
    sendBtn.style.display = 'none';
    resultDisplay.classList.remove('show');
    resultDisplay.textContent = "";

    let flashCount = 0;
    const totalFlashes = 16 + Math.floor(Math.random() * 8);
    const finalIndex = Math.floor(Math.random() * wheelOptions.length);
    
    function flash() {
        const row = document.getElementById('picker-cards-row');
        if (!row) return;
        const cards = row.querySelectorAll('.picker-card');
        cards.forEach(c => c.style.transform = '');
        
        let showIdx;
        if (flashCount < totalFlashes - 3) {
            showIdx = Math.floor(Math.random() * wheelOptions.length);
        } else {
            showIdx = finalIndex;
        }
        
        cards.forEach((c, i) => {
            if (i === showIdx) {
                c.style.transform = 'translateY(-4px) scale(1.06)';
                c.style.background = `linear-gradient(135deg, var(--accent-color), rgba(var(--accent-color-rgb),0.7))`;
                c.style.borderColor = 'transparent';
                c.style.color = '#fff';
            } else {
                c.style.transform = '';
                c.style.background = '';
                c.style.borderColor = '';
                c.style.color = '';
            }
        });
        
        flashCount++;
        const delay = flashCount < 8 ? 80 : flashCount < 14 ? 130 : 250;
        if (flashCount < totalFlashes) {
            setTimeout(flash, delay);
        } else {
            setTimeout(() => {
                renderPickerCards(finalIndex);
                wheelResultText = wheelOptions[finalIndex];
                resultDisplay.innerHTML = `<i class="fas fa-star" style="font-size:14px; margin-right:6px;"></i>${wheelResultText}`;
                resultDisplay.classList.add('show');
                spinBtn.disabled = false;
                sendBtn.style.display = 'inline-block';
                playSound('favorite');
            }, 300);
        }
    }
    
    flash();
}

function handleCoinToss() {
    const overlay = DOMElements.coinTossOverlay;
    if (!overlay) return;
    overlay.classList.remove('finished');
    overlay.classList.add('visible');
    const resultText = DOMElements.coinResultText;
    if (resultText) resultText.textContent = '';
    const sendBtn = DOMElements.sendCoinResult;
    if (sendBtn) sendBtn.style.display = 'none';
    const retryBtn = document.getElementById('retry-coin-toss');
    if (retryBtn) retryBtn.style.display = 'none';
    if (DOMElements.animatedCoin) DOMElements.animatedCoin.style.transform = '';
    startCoinFlipAnimation();
}
window.handleCoinToss = handleCoinToss;

function startCoinFlipAnimation() {
    const coin = DOMElements.animatedCoin;
    const resultText = DOMElements.coinResultText;
    const overlay = DOMElements.coinTossOverlay;
    if (!coin || !overlay) return;

    overlay.classList.remove('finished');
    if (resultText) resultText.textContent = '';
    const sendBtn = DOMElements.sendCoinResult;
    if (sendBtn) sendBtn.style.display = 'none';
    const retryBtn = document.getElementById('retry-coin-toss');
    if (retryBtn) retryBtn.style.display = 'none';

    const isHeads = Math.random() < 0.5;
    const result = isHeads ? '正面 ☀️' : '反面 🌙';
    lastCoinResult = result;

    coin.classList.remove('flipping-heads', 'flipping-tails', 'coin-show-front', 'coin-show-back');
    void coin.offsetWidth;
    coin.classList.add(isHeads ? 'flipping-heads' : 'flipping-tails');
    setTimeout(() => {
        coin.classList.remove('flipping-heads', 'flipping-tails');
        coin.style.transform = isHeads ? 'rotateY(0deg)' : 'rotateY(180deg)';
        if (resultText) resultText.textContent = result;
        overlay.classList.add('finished');
        if (sendBtn) sendBtn.style.display = '';
        if (retryBtn) retryBtn.style.display = '';
        if (typeof playSound === 'function') playSound('favorite');
    }, 3050);
}
window.startCoinFlipAnimation = startCoinFlipAnimation;

function initComboMenu() {
    const comboBtn = document.getElementById('combo-btn');
    const picker = document.getElementById('user-sticker-picker');
    const contentArea = document.getElementById('combo-content-area');
    
    if (!comboBtn || !picker) return;
    
    if (comboBtn.dataset.initialized) return;
    
    comboBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = picker.classList.contains('active');
        
        if (isActive) {
            picker.classList.remove('active');
        } else {
            switchTab('my-sticker');
            picker.classList.add('active');
        }
    });
    
    comboBtn.dataset.initialized = 'true';

    document.addEventListener('click', (e) => {
        if (!picker.contains(e.target) && !comboBtn.contains(e.target)) {
            picker.classList.remove('active');
        }
    });

    const tabs = picker.querySelectorAll('.combo-tab-btn');
    tabs.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const tabId = btn.dataset.tab;
            switchTab(tabId);
        });
    });

    function updateAddBtnVisibility(tabId) {
        const addBtn = document.getElementById('sticker-add-btn');
        if (addBtn) addBtn.style.display = (tabId === 'my-sticker') ? 'flex' : 'none';
    }

    function switchTab(tabId) {
        tabs.forEach(b => b.classList.remove('active'));
        const activeBtn = Array.from(tabs).find(b => b.dataset.tab === tabId);
        if (activeBtn) activeBtn.classList.add('active');
        updateAddBtnVisibility(tabId);

        if (tabId === 'my-sticker') {
            renderMyStickerLibrary();
        } else if (tabId === 'partner-sticker') {
            renderPartnerStickerLibrary();
        } else {
            renderUserPokeMenu();
        }
    }

    function makeStickerItem(src, onClick) {
        const item = document.createElement('div');
        item.className = 'sticker-grid-item';
        // 阶段三B：识别 oss:// 走懒加载
        const isCloud = typeof src === 'string' && src.indexOf('oss://') === 0;
        item.innerHTML = `<img loading="lazy">`;
        const imgEl = item.querySelector('img');
        if (isCloud) {
            if (window.CloudMedia) window.CloudMedia.bindLazyImage(imgEl, src);
        } else {
            imgEl.src = src;
        }
        item.onclick = (e) => { e.stopPropagation(); onClick(); };
        return item;
    }

    function makeDeletableStickerItem(src, onClick, onDelete) {
        const item = document.createElement('div');
        item.className = 'sticker-grid-item';
        item.style.position = 'relative';
        const isCloud = typeof src === 'string' && src.indexOf('oss://') === 0;
        item.innerHTML = `<img loading="lazy"><div class="sticker-delete-btn" title="删除"><i class="fas fa-times"></i></div>`;
        const imgEl = item.querySelector('img');
        if (isCloud) {
            if (window.CloudMedia) window.CloudMedia.bindLazyImage(imgEl, src);
        } else {
            imgEl.src = src;
        }
        imgEl.onclick = (e) => { e.stopPropagation(); onClick(); };
        item.querySelector('.sticker-delete-btn').onclick = (e) => { e.stopPropagation(); onDelete(); };
        return item;
    }

    function renderMyStickerLibrary() {
        contentArea.innerHTML = '';
        if (!myStickerLibrary || myStickerLibrary.length === 0) {
            contentArea.innerHTML = `
                <div class="empty-sticker-tip">
                    <i class="fas fa-user-circle"></i>
                    还没有我的专属表情哦<br>
                    点击右上角"添加"按钮上传图片~
                </div>
            `;
            return;
        }
        const grid = document.createElement('div');
        grid.className = 'sticker-grid-view';
        myStickerLibrary.forEach((src, idx) => {
            const item = makeDeletableStickerItem(src, () => {
                addMessage({ id: Date.now(), sender: 'user', text: '', timestamp: new Date(), image: src, status: 'sent', type: 'normal' });
                playSound('send');
                picker.classList.remove('active');
                const delayRange = settings.replyDelayMax - settings.replyDelayMin;
                setTimeout(simulateReply, settings.replyDelayMin + Math.random() * delayRange);
            }, async () => {
                // 阶段三B：如果是云端引用，先删云端（失败不阻塞）
                if (window.CloudMedia && typeof src === 'string' && src.indexOf('oss://') === 0) {
                    try {
                        await window.CloudMedia.delete(src);
                    } catch (err) {
                        console.warn('[cloud-media] 云端删除失败', err);
                    }
                }
                myStickerLibrary.splice(idx, 1);
                localforage.setItem(getStorageKey('myStickerLibrary'), myStickerLibrary);
                showNotification('✓ 已删除', 'success');
                renderMyStickerLibrary();
            });
            grid.appendChild(item);
        });
        contentArea.appendChild(grid);
    }

    function renderPartnerStickerLibrary() {
        contentArea.innerHTML = '';
        if (!stickerLibrary || stickerLibrary.length === 0) {
            contentArea.innerHTML = `
                <div class="empty-sticker-tip">
                    <i class="far fa-images"></i>
                    对方表情库还是空的哦<br>
                    请去"高级功能"->"自定义回复"->"表情库"中添加图片~
                </div>
            `;
            return;
        }
        const grid = document.createElement('div');
        grid.className = 'sticker-grid-view';
        stickerLibrary.forEach(src => {
            const item = makeStickerItem(src, () => {
                addMessage({ id: Date.now(), sender: 'user', text: '', timestamp: new Date(), image: src, status: 'sent', type: 'normal' });
                playSound('send');
                picker.classList.remove('active');
                const delayRange = settings.replyDelayMax - settings.replyDelayMin;
                setTimeout(simulateReply, settings.replyDelayMin + Math.random() * delayRange);
            });
            grid.appendChild(item);
        });
        contentArea.appendChild(grid);
    }

    function renderStickerLibrary() { renderMyStickerLibrary(); }
    function renderUserPokeMenu() {
        contentArea.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'poke-list-view';

        const customBtn = document.createElement('button');
        customBtn.className = 'custom-poke-btn';
        customBtn.innerHTML = '<i class="fas fa-pen"></i> 自定义动作';
        customBtn.onclick = (e) => {
            e.stopPropagation();
            picker.classList.remove('active');
            if (DOMElements.pokeModal.input) {
                DOMElements.pokeModal.input.value = settings.myPokeText || '';
            }
            showModal(DOMElements.pokeModal.modal, DOMElements.pokeModal.input);
        };
        wrapper.appendChild(customBtn);

        const userPresets = [
            "拍了拍对方的头",
            "戳了戳对方的脸颊",
            "抱住了对方",
            "给对方比了个心",
            "牵起了对方的手",
            "看着对方发呆"
        ];

        const title = document.createElement('div');
        title.style.fontSize = '12px';
        title.style.color = 'var(--text-secondary)';
        title.style.marginBottom = '5px';
        title.innerText = '快捷动作';
        wrapper.appendChild(title);

        userPresets.forEach(text => {
            const item = document.createElement('div');
            item.className = 'poke-quick-item';
            item.innerText = text;
            item.onclick = (e) => {
                e.stopPropagation();
                addMessage({
                    id: Date.now(),
                    text: _formatPokeText(`${settings.myName} ${text}`), 
                    timestamp: new Date(),
                    type: 'system' 
                });
                picker.classList.remove('active');
                
                setTimeout(simulateReply, 1500);
            };
            wrapper.appendChild(item);
        });

        contentArea.appendChild(wrapper);
    }
}

(function() {
    var STOP_WORDS = new Set([
        '的','了','是','我','你','他','她','它','们','这','那','有','在','就','也','都',
        '和','与','或','但','不','没','很','太','更','最','已','被','让','把','对','从',
        '到','于','以','为','之','其','而','则','所','等','啊','哦','嗯','哈','呢','吧',
        '吗','嘛','呀','哇','哎','唉','嗯嗯','哈哈','嘻嘻','呵呵','哦哦','啊啊','哈哈哈',
        '一','二','三','四','五','六','七','八','九','十','个','次','条','件','种',
        '好','行','可以','可','又','再','还','来','去','说','想','知道','觉得','感觉',
        '什么','怎么','为什么','哪','谁','哪里','怎样','如何','这么','那么',
        '然后','因为','所以','如果','虽然','但是','而且','不过','只是','只有',
        '没有','不是','还是','就是','真的','对啊','好的','好吧','那个','这个',
        '今天','昨天','明天','现在','以前','以后','时候','时间','一下','一直','一个',
        'ok','OK','Ok','yes','no','hh','hhhh','hhh','嗯','额',
        '图片','表情','语音','【图片】','【表情】','【语音】','撤回了一条消息','已撤回'
    ]);

    function tokenize(text) {
        text = text
            .replace(/https?:\/\/\S+/g, '')
            .replace(/\[.*?\]/g, '')
            .replace(/<[^>]+>/g, '')
            .replace(/[^\u4e00-\u9fa5a-zA-Z]/g, ' ')
            .toLowerCase();
        var words = {};
        var cn = text.replace(/[a-z ]/g, '');
        // 使用非重叠分词：优先提取长词，避免"我想你"同时产生"我想"和"想你"
        // 策略：对每个起点只取一次最长匹配（4>3>2），跳过已覆盖字符
        var covered = new Array(cn.length).fill(false);
        // 先扫一遍提取4字词
        for (var i = 0; i + 4 <= cn.length; i++) {
            var w4 = cn.slice(i, i + 4);
            if (!STOP_WORDS.has(w4)) {
                words[w4] = (words[w4] || 0) + 2.4;
                covered[i] = covered[i+1] = covered[i+2] = covered[i+3] = true;
                i += 3; // 跳过已覆盖字符
            }
        }
        // 再扫3字词（跳过已覆盖位置）
        covered = new Array(cn.length).fill(false); // 重置，用于3字
        for (var j = 0; j + 3 <= cn.length; j++) {
            var w3 = cn.slice(j, j + 3);
            if (!STOP_WORDS.has(w3)) {
                words[w3] = (words[w3] || 0) + 1.8;
                j += 2;
            }
        }
        // 2字词：步长2，非重叠，不与已有词重复计数
        for (var k = 0; k + 2 <= cn.length; k += 2) {
            var w2 = cn.slice(k, k + 2);
            if (!STOP_WORDS.has(w2)) {
                words[w2] = (words[w2] || 0) + 1;
            }
        }
        // 英文单词（长度≥3）
        (text.match(/[a-z]{3,}/g) || []).forEach(function(w) {
            if (!STOP_WORDS.has(w)) words[w] = (words[w] || 0) + 1;
        });
        return words;
    }

    function mergeFreq(a, b) {
        var o = Object.assign({}, a);
        Object.keys(b).forEach(function(k) { o[k] = (o[k] || 0) + b[k]; });
        return o;
    }

    function topWords(freq, n) {
        var min = Object.keys(freq).length > 60 ? 2 : 1;
        return Object.entries(freq)
            .filter(function(e) { return e[1] >= min && e[0].length >= 2; })
            .sort(function(a, b) { return b[1] - a[1]; })
            .slice(0, n)
            .map(function(e) { return { word: e[0], count: e[1] }; });
    }

    function resolveFont() {
        var el = document.createElement('span');
        el.style.cssText = 'position:absolute;visibility:hidden;font-family:var(--font-family)';
        document.body.appendChild(el);
        var f = getComputedStyle(el).fontFamily || '"PingFang SC","Microsoft YaHei",sans-serif';
        document.body.removeChild(el);
        return f;
    }

    function hex3(hex) {
        hex = hex.replace('#','');
        if (hex.length === 3) hex = hex.split('').map(function(c){return c+c;}).join('');
        var n = parseInt(hex, 16);
        return [(n>>16)&255, (n>>8)&255, n&255];
    }
    function drawWordCloud(canvas, words) {
        var ctx   = canvas.getContext('2d');
        var dpr   = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var W = canvas.width / dpr;
        var H = canvas.height / dpr;

        var cs     = getComputedStyle(document.documentElement);
        var accent = cs.getPropertyValue('--accent-color').trim() || '#c5a47e';
        var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        var rgb    = hex3(accent);
        var font   = resolveFont();

        ctx.fillStyle = isDark ? '#141414' : '#ffffff';
        ctx.fillRect(0, 0, W, H);

        if (!words.length) return;

        var maxC = words[0].count;
        var minC = words[words.length - 1].count;
        var placed = [];

        var MIN_F = 11, MAX_F = 54;

        function fontSize(c) {
            if (maxC === minC) return 24;
            var t = Math.log(1 + c - minC) / Math.log(1 + maxC - minC);
            return Math.round(MIN_F + t * (MAX_F - MIN_F));
        }

        function wordAlpha(idx, total) {
            if (idx === 0) return 1.0;
            if (idx < 3)   return 0.82;
            if (idx < 8)   return 0.64;
            if (idx < 20)  return 0.46;
            return Math.max(0.20, 0.46 - (idx - 20) / total * 0.25);
        }

        function tilt(word, idx) {
            if (idx < 5) return 0;
            var h = 0;
            for (var i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) | 0;
            return (Math.abs(h) % 6 === 0) ? (Math.PI / 2) : 0;
        }

        function overlaps(x, y, w, h, pad) {
            for (var i = 0; i < placed.length; i++) {
                var p = placed[i];
                if (x - pad < p.x + p.w && x + w + pad > p.x &&
                    y - pad < p.y + p.h && y + h + pad > p.y) return true;
            }
            return false;
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowBlur = 0;

        words.forEach(function(item, idx) {
            var fs  = fontSize(item.count);
            var fw  = idx < 2 ? '800' : idx < 8 ? '600' : '400';
            var rot = tilt(item.word, idx);
            var a   = wordAlpha(idx, words.length);

            ctx.font = fw + ' ' + fs + 'px ' + font;
            var tw = ctx.measureText(item.word).width;
            var th = fs * 1.25;

            var bw = rot !== 0 ? th + 2 : tw;
            var bh = rot !== 0 ? tw + 2 : th;
            var pad = idx < 3 ? 9 : idx < 12 ? 4 : 2;

            var placed_ = false;
            var cx = W / 2, cy = H / 2;

            for (var t = 0; t < 320; t += 0.09) {
                var ang = t * 2.2;
                var r   = 1.8 * ang;
                var bx  = cx + r * Math.cos(ang) * 1.2 - bw / 2;
                var by  = cy + r * Math.sin(ang) * 0.88 - bh / 2;

                if (bx >= pad && by >= pad && bx + bw <= W - pad && by + bh <= H - pad) {
                    if (!overlaps(bx, by, bw, bh, pad)) {
                        ctx.save();
                        ctx.globalAlpha = a;
                        ctx.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
                        ctx.translate(bx + bw/2, by + bh/2);
                        ctx.rotate(rot);
                        ctx.fillText(item.word, 0, 0);
                        ctx.restore();
                        placed.push({ x: bx, y: by, w: bw, h: bh });
                        placed_ = true;
                        break;
                    }
                }
            }

            if (!placed_) {
                var fsS = Math.max(10, fs * 0.58);
                ctx.font = '400 ' + fsS + 'px ' + font;
                var tw2 = ctx.measureText(item.word).width + 2;
                var th2 = fsS * 1.25;
                for (var fb = 0; fb < 60; fb++) {
                    var fx = 6 + Math.random() * (W - tw2 - 12);
                    var fy = 6 + Math.random() * (H - th2 - 12);
                    if (!overlaps(fx, fy, tw2, th2, 2)) {
                        ctx.save();
                        ctx.globalAlpha = Math.min(a, 0.32);
                        ctx.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
                        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
                        ctx.fillText(item.word, fx, fy);
                        ctx.restore();
                        placed.push({ x: fx, y: fy, w: tw2, h: th2 });
                        break;
                    }
                }
            }
        });
    }

    window.renderWordCloud = function() {
        var container = document.getElementById('wordcloud-container');
        if (!container) return;

        if (typeof messages === 'undefined' || !messages || !messages.length) {
            container.innerHTML = '<div class="wc-empty"><i class="fas fa-ghost"></i><p>还没有聊天记录</p><span>多聊几句，词云就会出现～</span></div>';
            return;
        }

        var pName = (typeof settings !== 'undefined' && settings.partnerName) ? settings.partnerName : '对方';
        var mName = (typeof settings !== 'undefined' && settings.myName)      ? settings.myName      : '我';

        var partnerMsgs = messages.filter(function(m) { return m.sender !== 'user' && m.text && m.type !== 'system' && m.type !== 'call-event'; });
        var myMsgs      = messages.filter(function(m) { return m.sender === 'user' && m.text && m.type !== 'system' && m.type !== 'call-event'; });

        var pFreq = {}, mFreq = {};
        partnerMsgs.forEach(function(m) { pFreq = mergeFreq(pFreq, tokenize(m.text)); });
        myMsgs.forEach(function(m)      { mFreq = mergeFreq(mFreq, tokenize(m.text)); });
        var aFreq = mergeFreq(pFreq, mFreq);

        var pTop = topWords(pFreq, 60);
        var mTop = topWords(mFreq, 60);
        var aTop = topWords(aFreq, 60);

        var cur = container._currentView || 'all';

        function data(v) {
            if (v === 'partner') return { words: pTop, total: partnerMsgs.length };
            if (v === 'me')      return { words: mTop, total: myMsgs.length };
            return { words: aTop, total: partnerMsgs.length + myMsgs.length };
        }

        function renderRank(words) {
            var el = container.querySelector('.wc-rank-list');
            if (!el) return;
            if (!words.length) { el.innerHTML = '<div class="wc-rank-empty">暂无数据</div>'; return; }
            var cs     = getComputedStyle(document.documentElement);
            var accent = cs.getPropertyValue('--accent-color').trim() || '#c5a47e';
            var rgb    = hex3(accent);
            var max    = words[0].count;
            el.innerHTML = words.slice(0, 10).map(function(item, i) {
                var pct = Math.round(item.count / max * 100);
                var numStyle = i < 3
                    ? 'color:rgb('+rgb[0]+','+rgb[1]+','+rgb[2]+');font-weight:700;'
                    : 'color:var(--text-secondary);font-weight:500;';
                return '<div class="wc-rank-item">'
                    + '<span class="wc-rank-num" style="'+numStyle+'">' + (i < 9 ? '0'+(i+1) : i+1) + '</span>'
                    + '<span class="wc-rank-word">' + item.word + '</span>'
                    + '<div class="wc-rank-bar-wrap">'
                    +   '<div class="wc-rank-bar" style="width:'+pct+'%;background:rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+','+(0.2+pct/100*0.6)+');"></div>'
                    + '</div>'
                    + '<span class="wc-rank-count">' + Math.round(item.count) + '</span>'
                    + '</div>';
            }).join('');
        }

        function renderSummary(d) {
            var el = container.querySelector('.wc-summary');
            if (!el) return;
            el.innerHTML =
                '<span class="wc-summary-pill"><i class="fas fa-comment-dots"></i> ' + d.total + ' 条</span>'
                + '<span class="wc-summary-pill"><i class="fas fa-font"></i> ' + d.words.length + ' 词</span>';
        }

        function renderView(v) {
            container._currentView = v;
            container.querySelectorAll('.wc-view-btn').forEach(function(b) {
                b.classList.toggle('active', b.dataset.view === v);
            });
            var canvas = container.querySelector('#wc-canvas');
            if (!canvas) return;
            var d = data(v);
            drawWordCloud(canvas, d.words);
            renderRank(d.words);
            renderSummary(d);
        }

        if (!container.querySelector('#wc-canvas')) {
            var dpr = window.devicePixelRatio || 1;
            var cw  = Math.min(container.offsetWidth || (container.parentElement && container.parentElement.offsetWidth) || 340, 500);
            var ch  = Math.round(cw * 0.72);

            container.innerHTML =
                '<div class="wc-header">'
                +   '<div class="wc-tabs"><div class="wc-tabs-track">'
                +     '<button class="wc-view-btn'+(cur==='all'?' active':'')+'" data-view="all">全部</button>'
                +     '<button class="wc-view-btn'+(cur==='partner'?' active':'')+'" data-view="partner">'+pName+'</button>'
                +     '<button class="wc-view-btn'+(cur==='me'?' active':'')+'" data-view="me">'+mName+'</button>'
                +   '</div></div>'
                +   '<button class="wc-regen-btn" title="换一种布局"><i class="fas fa-redo"></i></button>'
                + '</div>'
                + '<div class="wc-summary"></div>'
                + '<div class="wc-canvas-wrap">'
                +   '<canvas id="wc-canvas" width="'+(cw*dpr)+'" height="'+(ch*dpr)+'" style="width:'+cw+'px;height:'+ch+'px;display:block;"></canvas>'
                + '</div>'
                + '<div class="wc-rank-section">'
                +   '<div class="wc-rank-title"><i class="fas fa-bars"></i> 高频词 Top 10</div>'
                +   '<div class="wc-rank-list"></div>'
                + '</div>';

            container.querySelector('.wc-tabs-track').addEventListener('click', function(e) {
                var b = e.target.closest('.wc-view-btn');
                if (b) renderView(b.dataset.view);
            });
            container.querySelector('.wc-regen-btn').addEventListener('click', function() {
                var canvas = container.querySelector('#wc-canvas');
                var d = data(container._currentView);
                var shuffled = d.words.slice().sort(function(a, b) {
                    return a.count !== b.count ? b.count - a.count : Math.random() - 0.5;
                });
                drawWordCloud(canvas, shuffled);
            });
        }

        renderView(cur);
    };

})();
