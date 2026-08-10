/**
 * moments.js — 情侣空间：动态功能
 */

let momentsData = { posts: [], notifications: [] };
let _momentsDataLoaded = false; // 只有loadMomentsData()成功跑完一次才会变true，saveMomentsData()靠这个判断能不能安全保存

const _M_STORAGE_KEY  = 'momentsData';
const _M_COOLDOWN_KEY = 'partnerLetterNextTime';
const _M_CD_MIN  = 48 * 60 * 60 * 1000;
const _M_CD_MAX  = 72 * 60 * 60 * 1000;
const _M_PROB    = 0.40;
const _M_DLY_MIN = 5  * 60 * 1000;
const _M_DLY_MAX = 20 * 60 * 1000;
const _CS_SETTINGS_KEY = 'csSpaceSettings';

// 情侣空间设置（默认值）
let _csSettings = { dlyMin: 5, dlyMax: 20, savePartnerImg: false, allowReadNoReply: false, readNoReplyChance: 0.2, cmtCombineCards: false, emojiMixEnabled: false };

// 情侣空间"已读不回"判定：关闭开关时必回；开启后按 readNoReplyChance 概率跳过。
// 统一给"梦角评论新动态"和"梦角回复用户评论"这两处共用。
function _mShouldReply() {
    if (!_csSettings.allowReadNoReply) return true;
    const chance = Math.max(0, Math.min(1, Number(_csSettings.readNoReplyChance) || 0));
    return Math.random() >= chance;
}

// 情侣空间"表情混入"：开关打开且表情库不为空时，20%概率把一个表情符号混进文字前面或后面。
// 跟主聊天"表情混入消息"是完全独立的开关，互不影响，但复用同一个 customEmojis 表情库。
function _mMixEmoji(text) {
    if (!text) return text; // 没有文字内容（比如纯贴纸）不需要混入
    if (!_csSettings.emojiMixEnabled) return text;
    const pool = window.customEmojis || (typeof customEmojis !== 'undefined' ? customEmojis : []);
    if (!pool || !pool.length) return text;
    if (Math.random() >= 0.2) return text;
    const emoji = pool[Math.floor(Math.random() * pool.length)];
    return Math.random() < 0.5 ? emoji + ' ' + text : text + ' ' + emoji;
}

const _mDly   = () => {
    const minMs = (_csSettings.dlyMin || 5) * 60000;
    const maxMs = (_csSettings.dlyMax || 20) * 60000;
    return minMs + Math.random() * Math.max(0, maxMs - minMs);
};
const _mToday = () => new Date().toISOString().slice(0, 10);
const _mUid   = p  => (p||'id') + '_' + Date.now() + '_' + Math.random().toString(36).substr(2,4);
const _mPName = () => (typeof settings !== 'undefined' && settings.partnerName) || '梦角';
const _mMName = () => (typeof settings !== 'undefined' && settings.myName)      || '我';

function _mPostText() {
    const pool = [...(window._customReplies || customReplies || [])];
    if (!pool.length) return null;
    let t = ''; const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) { const s = pool[Math.floor(Math.random()*pool.length)]; t += s + (Math.random()<.2?'！':Math.random()<.2?'……':'。'); }
    return _mMixEmoji(t);
}
function _mPickStickers() {
    if (Math.random() >= 0.40) return [];
    const pool = [...(stickerLibrary||[])]; if (!pool.length) return [];
    const n = 1+Math.floor(Math.random()*3); return pool.sort(()=>Math.random()-.5).slice(0,Math.min(n,pool.length));
}

// 梦角评论内容：纯文字 60% / 文字+贴纸 20% / 纯贴纸 20%
// 没有字卡也没有贴纸时返回 null，调用方应跳过评论
function _mCmtContent() {
    const textPool   = [...(window._customReplies || customReplies || [])];
    const stickerPool = [...(stickerLibrary || [])];
    const hasText    = textPool.length > 0;
    const hasSticker = stickerPool.length > 0;
    const randSticker = () => stickerPool[Math.floor(Math.random() * stickerPool.length)];
    const randText   = () => {
        let t;
        if (!_csSettings.cmtCombineCards) { t = textPool[Math.floor(Math.random() * textPool.length)]; } // 开关关闭：老效果，只抽1句
        else {
            t = ''; const n = 1 + Math.floor(Math.random() * 3); // 开关打开：1~3句拼接，跟发动态的拼句逻辑一致，但句数少一点
            for (let i = 0; i < n; i++) { const s = textPool[Math.floor(Math.random()*textPool.length)]; t += s + (Math.random()<.2?'！':Math.random()<.2?'……':'。'); }
        }
        return _mMixEmoji(t);
    };

    if (!hasText && !hasSticker) return null;  // 没有可用内容，不回复
    if (!hasSticker) return { text: randText(), image: null };
    if (!hasText)    return { text: '', image: randSticker() };

    const r = Math.random();
    if (r < 0.60) return { text: randText(), image: null };            // 60% 纯文字
    if (r < 0.80) return { text: randText(), image: randSticker() };   // 20% 文字+贴纸
    return { text: '', image: randSticker() };                         // 20% 纯贴纸
}

async function loadMomentsData() {
    try { const s=await localforage.getItem(getStorageKey(_M_STORAGE_KEY)); if(s){momentsData=s;if(!momentsData.notifications)momentsData.notifications=[];} _momentsDataLoaded=true; } catch(e){console.warn('[Moments] load 失败',e);}
}
async function saveMomentsData() {
    if (!_momentsDataLoaded) { console.warn('[Moments] 本次会话还没有确认加载成功过动态数据，为了避免覆盖历史记录，跳过这次保存'); return; }
    try{await localforage.setItem(getStorageKey(_M_STORAGE_KEY),momentsData);}catch(e){console.warn('[Moments] save 失败',e);}
}

// ─── 通知 ───
let _nQ=[], _nBusy=false;
function _pushNotif(type, postId) {
    momentsData.notifications=momentsData.notifications||[];
    const name=_mPName(), texts={newPost:`${name}发了新动态`,liked:`${name}为你的动态点了赞`,commented:`${name}评论了你的动态`,replied:`${name}回复了你`};
    momentsData.notifications.unshift({id:_mUid('n'),type,postId,text:texts[type]||type,timestamp:Date.now(),read:false});
    if(momentsData.notifications.length>50)momentsData.notifications=momentsData.notifications.slice(0,50);
    saveMomentsData(); _updateBadge(); _nQ.push({type,postId}); _drainN();
}
function _drainN(){if(_nBusy||!_nQ.length)return;_nBusy=true;_showN(_nQ.shift());}
function _showN({type,postId}){
    const el=document.getElementById('moments-notif-popup');if(el)el.remove();
    const name=_mPName(),C={newPost:{icon:'📸',title:`${name}发了新动态`,sub:'快去看看 Ta 的动态~'},liked:{icon:'❤️',title:`${name}为你的动态点了赞`,sub:''},commented:{icon:'💬',title:`${name}评论了你的动态`,sub:'去看看 Ta 说了什么~'},replied:{icon:'💬',title:`${name}回复了你`,sub:'去看看 Ta 说了什么~'}};
    const c=C[type]||C.newPost, p=document.createElement('div'); p.id='moments-notif-popup';
    p.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--secondary-bg);border:1px solid var(--border-color);border-radius:20px;padding:18px 20px;z-index:9000;max-width:320px;width:88%;box-shadow:0 8px 32px rgba(0,0,0,0.18);display:flex;flex-direction:column;gap:12px;animation:_mSlideUp 0.4s cubic-bezier(0.22,1,0.36,1);';
    p.innerHTML=`<style>@keyframes _mSlideUp{from{opacity:0;transform:translateX(-50%) translateY(24px) scale(0.9)}60%{transform:translateX(-50%) translateY(-4px) scale(1.02)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}</style><div style="display:flex;align-items:center;gap:10px;"><span style="font-size:26px;">${c.icon}</span><div><div style="font-size:14px;font-weight:700;color:var(--text-primary);">${c.title}</div>${c.sub?`<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;opacity:0.8;">${c.sub}</div>`:''}</div></div><div style="display:flex;gap:8px;"><button onclick="document.getElementById('moments-notif-popup').remove();window._mND();" style="flex:1;padding:8px 0;border-radius:12px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);font-size:13px;cursor:pointer;">稍后</button><button onclick="window._openMomentsPost('${postId}');document.getElementById('moments-notif-popup').remove();window._mND();" style="flex:2;padding:8px 0;border-radius:12px;border:none;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">立即查看 ✦</button></div>`;
    document.body.appendChild(p); setTimeout(()=>{if(p.parentNode){p.remove();window._mND();}},8000);
}
window._mND=()=>{_nBusy=false;setTimeout(_drainN,400);};

// ─── 铃铛 ───
window._mOpenBell=function(){
    let popup=document.getElementById('cs-notif-popup');
    if(popup&&popup.style.display!=='none'){popup.style.display='none';return;}
    if(!popup){popup=document.createElement('div');popup.id='cs-notif-popup';popup.className='cs-notif-popup';document.getElementById('couple-space-page').appendChild(popup);}
    popup.style.display='block';
    const notifs=(momentsData.notifications||[]).slice(0,15),icons={newPost:'📸',liked:'❤️',commented:'💬',replied:'💬'};
    popup.innerHTML='<div style="padding:10px 14px 6px;font-size:12px;font-weight:600;color:var(--text-secondary);">互动通知</div>'+(!notifs.length?'<div style="padding:20px;text-align:center;color:var(--text-secondary);font-size:13px;opacity:0.6;">暂无通知</div>':notifs.map(n=>{const t=new Date(n.timestamp),ts=`${t.getMonth()+1}/${t.getDate()} ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;return`<div class="cs-notif-item${n.read?'':' cs-notif-unread'}" onclick="window._openMomentsPost('${n.postId}');document.getElementById('cs-notif-popup').style.display='none';"><span style="font-size:18px;flex-shrink:0;">${icons[n.type]||'🔔'}</span><div style="flex:1;min-width:0;"><div style="font-size:13px;color:var(--text-primary);line-height:1.4;">${n.text}</div><div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${ts}</div></div>${!n.read?'<div style="width:7px;height:7px;background:var(--accent-color);border-radius:50%;flex-shrink:0;margin-top:4px;"></div>':''}</div>`;}).join(''));
    (momentsData.notifications||[]).forEach(n=>{n.read=true;}); saveMomentsData(); _updateBadge();
    setTimeout(()=>{function c(e){if(!popup.contains(e.target)&&e.target.id!=='cs-bell-btn'){popup.style.display='none';document.removeEventListener('click',c);}}document.addEventListener('click',c);},100);
};

// ─── 逻辑 ───
// 梦角发动态内容：纯文字 40% / 文字+贴纸 40% / 纯贴纸 20%
function _mPostContent() {
    const textPool    = [...(window._customReplies || customReplies || [])];
    const stickerPool = [...(stickerLibrary || [])];
    const hasText    = textPool.length > 0;
    const hasSticker = stickerPool.length > 0;
    const randText    = () => _mPostText();
    const randImgs    = () => { const n=1+Math.floor(Math.random()*3); return stickerPool.sort(()=>Math.random()-.5).slice(0,Math.min(n,stickerPool.length)); };

    if (!hasText && !hasSticker) return null;
    if (!hasSticker) return { text:randText(), images:[] };
    if (!hasText)    return { text:'', images:randImgs() };

    const r = Math.random();
    if (r < 0.40) return { text:randText(), images:[] };           // 40% 纯文字
    if (r < 0.60) return { text:'', images:randImgs() };           // 20% 纯贴纸
    return { text:randText(), images:randImgs() };                 // 40% 文字+贴纸
}

async function generatePartnerMoment() {
    const now=Date.now();
    const c=_mPostContent(); if(!c) return;const post={id:_mUid('partner'),type:'partner',text:c.text,images:c.images,date:_mToday(),timestamp:now,isNewForUser:true,userLiked:false,partnerLiked:false,pendingLikeTime:null,pendingLikeSilent:false,comments:[],pendingPartnerComment:null};
    if(Math.random()<0.10){const c=_mCmtContent();if(c)post.pendingPartnerComment={text:c.text,image:c.image,time:now+Math.floor(_mDly()),isSelfComment:true};}
    if(Math.random()<0.10){post.pendingLikeTime=now+Math.floor(_mDly());post.pendingLikeSilent=true;}
    momentsData.posts.unshift(post); saveMomentsData(); _pushNotif('newPost',post.id);
    // "保存Ta发的图片"这个设置开着的话，把梦角这条动态里的图片也同步进相册——
    // 跟用户自己发动态时走的是同一套同步函数，只是之前只在用户发帖时调用，梦角发帖漏掉了
    if (_csSettings.savePartnerImg && post.images && post.images.length && typeof window._albumSyncMomentsPost === 'function') {
        window._albumSyncMomentsPost(post.id, post.images, null, null);
    }
}

function onUserPostCreated(postId) {
    const p=momentsData.posts.find(p=>p.id===postId); if(!p||p.type!=='user')return;
    p.pendingLikeTime=Date.now()+_mDly();p.pendingLikeSilent=false;
    if(_mShouldReply()){const c=_mCmtContent();if(c){p.pendingPartnerComment={text:c.text,image:c.image,time:Date.now()+_mDly(),replyTo:null};}}
    saveMomentsData();
}

function onUserCommented(postId) {
    const p=momentsData.posts.find(p=>p.id===postId);if(!p)return;
    if(_mShouldReply()){const c=_mCmtContent();if(c){p.pendingPartnerComment={text:c.text,image:c.image,time:Date.now()+_mDly(),replyTo:{authorName:_mMName()}};}}
    saveMomentsData();
}

async function checkMomentsStatus() {
    await loadMomentsData(); const now=Date.now(); let changed=false;
    for(const p of momentsData.posts){
        if(p.pendingLikeTime&&!p.partnerLiked&&now>=p.pendingLikeTime){
            p.partnerLiked=true;p.pendingLikeTime=null;changed=true;
            if(!p.pendingLikeSilent)_pushNotif('liked',p.id);
            p.pendingLikeSilent=false;
        }
        if(p.pendingPartnerComment&&now>=p.pendingPartnerComment.time){
            const ppc=p.pendingPartnerComment;
            p.comments.push({id:_mUid('c'),authorType:'partner',text:ppc.text||'',image:ppc.image||null,timestamp:ppc.time,isNew:true,replyTo:ppc.replyTo||null});
            p.pendingPartnerComment=null;changed=true;
            if(!ppc.isSelfComment)_pushNotif(p.type==='user'?'commented':'replied',p.id);
        }
    }
    if(changed){saveMomentsData();_updateBadge();}
    await _checkAction();
}

async function _checkAction(){
    try{
        const KEY=getStorageKey(_M_COOLDOWN_KEY),now=Date.now();
        const next=await localforage.getItem(KEY);if(next!==null&&now<next)return;
        await localforage.setItem(KEY,now+_M_CD_MIN+Math.random()*(_M_CD_MAX-_M_CD_MIN));
        if(Math.random()<0.40){if(typeof window._generatePartnerLetter==='function')window._generatePartnerLetter();}
        if(Math.random()<0.70){await generatePartnerMoment();}
    }catch(e){console.warn('[Moments] _checkAction 失败',e);}
}

function getMomentsUnreadCount(){let n=0;for(const p of momentsData.posts){if(p.isNewForUser)n++;for(const c of p.comments)if(c.authorType==='partner'&&c.isNew)n++;}return n;}
function markPostRead(postId){const p=momentsData.posts.find(p=>p.id===postId);if(!p)return;p.isNewForUser=false;p.comments.forEach(c=>{c.isNew=false;});saveMomentsData();_updateBadge();}
function _updateBadge(){
    const b=document.getElementById('moments-header-badge');if(b)b.style.display=getMomentsUnreadCount()>0?'inline-block':'none';
    const bell=document.getElementById('cs-bell-dot');if(bell)bell.style.display=(momentsData.notifications||[]).some(n=>!n.read)?'block':'none';
}

// ─── 图片工具 ───
function _imgEl(src){
    if(!src||typeof src!=='string')return'';
    const isCloud=src.indexOf('oss://')===0;
    const ca=!src.startsWith('data:')?`onclick="viewImage('${src}')" style="cursor:pointer;"`:'';
    return isCloud?`<img data-lazy-cloud-ref="${src}" style="width:100%;height:100%;object-fit:cover;" ${ca}>`:`<img src="${src}" style="width:100%;height:100%;object-fit:cover;" ${ca}>`;
}
function _imgElThumb(src, style){
    if(!src||typeof src!=='string')return'';
    const isCloud=src.indexOf('oss://')===0;
    const s=style||'max-width:100px;border-radius:8px;cursor:pointer;';
    const ca=`onclick="viewImage('${src}')"`;
    return isCloud?`<img data-lazy-cloud-ref="${src}" style="${s}" ${ca}>`:`<img src="${src}" style="${s}" ${ca}>`;
}
function _bindLazy(el){if(!window.CloudMedia)return;el.querySelectorAll('img[data-lazy-cloud-ref]').forEach(img=>window.CloudMedia.bindLazyImage(img,img.getAttribute('data-lazy-cloud-ref')));}
function _imgGrid(images){
    if(!images||!images.length)return'';const n=Math.min(images.length,6);
    return`<div class="cs-post-imgs n${n}">${images.slice(0,n).map(src=>`<div style="aspect-ratio:1;overflow:hidden;border-radius:8px;">${_imgEl(src)}</div>`).join('')}</div>`;
}
function _videoThumb(videoSrc, coverSrc){
    const cover=coverSrc||'';
    const isCloud=cover.indexOf('oss://')===0;
    const coverTag=cover?(isCloud?`<img data-lazy-cloud-ref="${cover}" class="cs-video-cover">`:`<img src="${cover}" class="cs-video-cover">`):`<div class="cs-video-cover cs-video-cover-empty"><i class="fas fa-film"></i></div>`;
    return`<div class="cs-video-thumb" onclick="window.openCsVideoPlayer('${videoSrc}')">${coverTag}<div class="cs-video-play-btn"><i class="fas fa-play"></i></div></div>`;
}
window.openCsVideoPlayer=function(src){
    const overlay=document.getElementById('cs-video-player-overlay');
    const player=document.getElementById('cs-video-player');
    if(!overlay||!player)return;
    const isCloud=src.indexOf('oss://')===0;
    if(isCloud&&window.CloudMedia){
        window.CloudMedia.fetchUrl(src).then(url=>{player.src=url;player.play();}).catch(()=>{player.src=src;player.play();});
    }else{player.src=src;player.play();}
    overlay.style.display='flex';
};
window.closeCsVideoPlayer=function(){
    const overlay=document.getElementById('cs-video-player-overlay');
    const player=document.getElementById('cs-video-player');
    if(player){player.pause();player.src='';}
    if(overlay)overlay.style.display='none';
};
function _fmtDate(d){if(!d)return'';if(d===_mToday())return'今天';const dt=new Date(d),now=new Date();return dt.getFullYear()===now.getFullYear()?`${dt.getMonth()+1}月${dt.getDate()}日`:d;}

// ─── 头像 ───
function _getAvSrc(isPartner){const c=window._avatarCache||{};if(isPartner){if(c.partner)return c.partner;const e=document.getElementById('partner-avatar');return e&&e.src&&!e.src.endsWith('/')?e.src:null;}else{if(c.me)return c.me;const e=document.getElementById('my-avatar');return e&&e.src&&!e.src.endsWith('/')?e.src:null;}}
function _avEl(isPartner,size){const src=_getAvSrc(isPartner),s=size||36;return src?`<img src="${src}" style="width:${s}px;height:${s}px;border-radius:50%;object-fit:cover;display:block;flex-shrink:0;">`:`<span style="width:${s}px;height:${s}px;border-radius:50%;background:var(--border-color,#d0d0d0);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas fa-user" style="font-size:${Math.round(s*0.48)}px;color:var(--text-secondary,#aaa);"></i></span>`;}

// ─── 贴纸选择器（用户自己的 stickerLibrary） ───
window._mToggleSticker=function(postId){
    const existing=document.getElementById('cs-sticker-picker');
    if(existing){existing.remove();return;}
    const pool=[...(myStickerLibrary||[])];
    if(!pool.length){
        const toast=document.createElement('div');
        toast.style.cssText='position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.75);color:#fff;padding:8px 16px;border-radius:20px;font-size:13px;z-index:9999;';
        toast.textContent='还没有表情包，请先在设置中上传哦~';
        document.body.appendChild(toast); setTimeout(()=>toast.remove(),2000); return;
    }
    const btn=document.getElementById('cs-sticker-btn-'+postId);
    const rect=btn?btn.getBoundingClientRect():{top:300,left:10};
    const picker=document.createElement('div'); picker.id='cs-sticker-picker';
    picker.style.cssText=`position:fixed;bottom:${window.innerHeight-rect.top+8}px;left:48px;right:48px;z-index:9500;background:var(--secondary-bg);border:1px solid var(--border-color);border-radius:14px;padding:10px;box-shadow:0 8px 32px rgba(0,0,0,0.25);display:grid;grid-template-columns:repeat(4,1fr);gap:8px;max-height:200px;overflow-y:auto;`;
    pool.forEach(src=>{
        const b=document.createElement('button');
        b.style.cssText='position:relative;background:var(--primary-bg);border:1px solid var(--border-color);padding:0;cursor:pointer;border-radius:7px;overflow:hidden;display:block;';
        const spacer=document.createElement('div');
        spacer.style.cssText='padding-top:100%;'; // 用百分比padding撑出正方形高度，兼容性比aspect-ratio更稳，老浏览器也支持
        b.appendChild(spacer);
        const isCloud=src.indexOf('oss://')===0;
        const imgTag=isCloud?`<img data-lazy-cloud-ref="${src}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;">`:`<img src="${src}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;">`;
        b.insertAdjacentHTML('beforeend', imgTag);
        b.onclick=()=>window._mSelectSticker(postId,src);
        picker.appendChild(b);
    });
    document.body.appendChild(picker);
    _bindLazy(picker);
    setTimeout(()=>{function c(ev){if(!picker.contains(ev.target)&&(!btn||!btn.contains(ev.target))){picker.remove();document.removeEventListener('click',c);}}document.addEventListener('click',c);},100);
};

window._mSelectSticker=function(postId,src){
    _commentImgMap[postId]=src;
    const pv=document.getElementById('cs-cmt-img-prev-'+postId);
    if(pv){
        const isCloud=src.indexOf('oss://')===0;
        const imgTag=isCloud?`<img data-lazy-cloud-ref="${src}" style="height:52px;border-radius:8px;">`:`<img src="${src}" style="height:52px;border-radius:8px;">`;
        pv.innerHTML=`<div style="position:relative;display:inline-block;margin:4px 0;">${imgTag}<button onclick="window._mClearCmtImg('${postId}')" style="position:absolute;top:-4px;right:-4px;width:16px;height:16px;border-radius:50%;background:rgba(0,0,0,.6);border:none;color:#fff;font-size:9px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button></div>`;
        if(isCloud)_bindLazy(pv);
    }
    const picker=document.getElementById('cs-sticker-picker');if(picker)picker.remove();
};
window._mClearCmtImg=function(postId){delete _commentImgMap[postId];const pv=document.getElementById('cs-cmt-img-prev-'+postId);if(pv)pv.innerHTML='';};

// ─── 图片评论（相册选图） ───
window._mCommentImgSelected=function(postId,input){
    const file=input.files[0];if(!file)return;
    optimizeImage(file,600,0.75).then(b64=>{
        _commentImgMap[postId]=b64;
        const pv=document.getElementById('cs-cmt-img-prev-'+postId);
        if(pv)pv.innerHTML=`<div style="position:relative;display:inline-block;margin:4px 0;"><img src="${b64}" style="height:52px;border-radius:8px;"><button onclick="window._mClearCmtImg('${postId}')" style="position:absolute;top:-4px;right:-4px;width:16px;height:16px;border-radius:50%;background:rgba(0,0,0,.6);border:none;color:#fff;font-size:9px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button></div>`;
    });input.value='';
};

// ─── 评论状态 ───
let _replyInfoMap={}, _showAllCmtSet=new Set(), _commentImgMap={};

window._mClickComment=function(postId,commentId,authorName){
    _replyInfoMap[postId]={commentId,authorName};
    const ctxEl=document.getElementById('cs-reply-ctx-'+postId);
    if(ctxEl){ctxEl.style.display='flex';const nm=ctxEl.querySelector('.cs-reply-name');if(nm)nm.textContent='回复 '+authorName+'：';}
    const inp=document.getElementById('cs-ci-'+postId);if(inp){inp.placeholder='回复内容…';inp.focus();}
};
window._mCancelReply=function(postId){
    delete _replyInfoMap[postId];
    const ctxEl=document.getElementById('cs-reply-ctx-'+postId);if(ctxEl)ctxEl.style.display='none';
    const inp=document.getElementById('cs-ci-'+postId);if(inp)inp.placeholder='说点什么…';
};
window._mShowAllCmt=function(postId){_showAllCmtSet.add(postId);_rerenderCmtSection(postId);};
window._mFocusCmt=function(postId){const inp=document.getElementById('cs-ci-'+postId);if(inp)inp.focus();};

// ─── 评论区 HTML ───
function _renderCmtSectionHtml(post){
    const showAll=_showAllCmtSet.has(post.id);
    const cmts=post.comments, toShow=showAll?cmts:cmts.slice(0,3), needMore=!showAll&&cmts.length>3;
    let cmtListHtml='';
    toShow.forEach(c=>{
        const isP=c.authorType==='partner';
        const cName=isP?_mPName():_mMName();
        const replyPart=c.replyTo?` <span class="cs-cmt-reply-word">回复</span> <span class="cs-cmt-reply-target">${c.replyTo.authorName}</span>`:'';
        const dot=isP&&c.isNew?'<span style="width:5px;height:5px;background:var(--accent-color);border-radius:50%;display:inline-block;margin-left:3px;vertical-align:middle;"></span>':'';
        const imgHtml=c.image?`<div style="margin-top:5px;">${_imgElThumb(c.image,'max-width:100px;border-radius:8px;cursor:pointer;')}</div>`:'';
        cmtListHtml+=`<div class="cs-cmt-item" onclick="event.stopPropagation();window._mClickComment('${post.id}','${c.id}','${cName}')"><div class="cs-cmt-content"><span class="cs-cmt-name">${cName}</span>${replyPart}：${c.text?`<span class="cs-cmt-text">${c.text}${dot}</span>`:''}${imgHtml}</div></div>`;
    });
    if(needMore)cmtListHtml+=`<div class="cs-show-all-cmt" onclick="event.stopPropagation();window._mShowAllCmt('${post.id}')">查看全部 ${cmts.length} 条评论</div>`;
    const ri=_replyInfoMap[post.id];
    return`<div class="cs-cmt-section" id="cs-cmt-${post.id}">
        ${cmtListHtml?`<div class="cs-cmt-list">${cmtListHtml}</div>`:''}
        <div class="cs-reply-ctx" id="cs-reply-ctx-${post.id}" style="display:${ri?'flex':'none'};">
            <span class="cs-reply-name">${ri?'回复 '+ri.authorName+'：':''}</span>
            <button onclick="event.stopPropagation();window._mCancelReply('${post.id}')">✕</button>
        </div>
        <div id="cs-cmt-img-prev-${post.id}" class="cs-cmt-img-prev"></div>
        <div class="cs-cmt-input-row">
            <div class="cs-cmt-input-av">${_avEl(false,28)}</div>
            <input type="text" id="cs-ci-${post.id}" class="cs-cmt-input-inline"
                placeholder="${ri?'回复内容…':'说点什么…'}"
                onkeydown="if(event.key==='Enter'){event.preventDefault();window._mSendComment('${post.id}');}">
            <button id="cs-sticker-btn-${post.id}" class="cs-cmt-tool-btn" onclick="event.stopPropagation();window._mToggleSticker('${post.id}')"><i class="far fa-smile"></i></button>
            <button class="cs-cmt-tool-btn" onclick="event.stopPropagation();document.getElementById('cs-cmtimg-${post.id}').click()"><i class="far fa-image"></i></button>
            <button class="cs-cmt-send" onclick="event.stopPropagation();window._mSendComment('${post.id}')"><i class="fas fa-paper-plane"></i></button>
            <input type="file" id="cs-cmtimg-${post.id}" accept="image/*" style="display:none;" onchange="window._mCommentImgSelected('${post.id}',this)">
        </div>
    </div>`;
}

// ─── 帖子卡片 ───
function _renderCard(post){
    const isPartner=post.type==='partner';
    const name=isPartner?_mPName():_mMName();
    const likeOn=post.userLiked;
    const likeCount=(post.partnerLiked?1:0)+(post.userLiked?1:0);
    const cmtCount=post.comments.length;
    const userCommented=post.comments.some(c=>c.authorType==='user');
    const canDel=post.type==='user';
    const hasNew=post.isNewForUser||post.comments.some(c=>c.authorType==='partner'&&c.isNew);
    const likers=[];if(post.partnerLiked)likers.push(_mPName());if(post.userLiked)likers.push(_mMName());
    return`<div class="cs-post" data-pid="${post.id}">
        <div class="cs-post-top">
            <div class="cs-post-av">${_avEl(isPartner,36)}</div>
            <div class="cs-post-name">${name}${hasNew?'<span style="width:7px;height:7px;background:var(--accent-color);border-radius:50%;display:inline-block;margin-left:6px;vertical-align:middle;"></span>':''}</div>
            ${canDel?`<button class="cs-post-del" onclick="event.stopPropagation();window._mDeletePost('${post.id}')"><i class="fas fa-trash-alt"></i></button>`:'<div style="width:24px;"></div>'}
        </div>
        <div class="cs-post-body">${post.text}</div>
        ${post.video?_videoThumb(post.video,post.videoCover):_imgGrid(post.images)}
        <div class="cs-post-foot">
            <span class="cs-post-date">${_fmtDate(post.date)}</span>
            <button class="cs-like-btn${likeOn?' on':''}" id="cs-lbtn-${post.id}" onclick="event.stopPropagation();window._mToggleLike('${post.id}')">
                <i class="${likeOn?'fas':'far'} fa-heart"></i><span id="cs-lc-${post.id}">${likeCount>0?' '+likeCount:''}</span>
            </button>
            <button class="cs-cmt-btn" onclick="event.stopPropagation();window._mFocusCmt('${post.id}')">
                <i class="${userCommented?'fas':'far'} fa-comment"></i><span id="cs-cc-${post.id}">${cmtCount>0?' '+cmtCount:''}</span>
            </button>
        </div>
        <div class="cs-likes-row" id="cs-lr-${post.id}" style="display:${likers.length?'flex':'none'};">
            ${likers.length?`<i class="fas fa-heart"></i><span>${likers.join('、')} 赞了</span>`:''}
        </div>
        ${_renderCmtSectionHtml(post)}
    </div>`;
}

// ─── 评论区局部重渲 ───
function _rerenderCmtSection(postId){
    const post=momentsData.posts.find(p=>p.id===postId);
    const old=document.getElementById('cs-cmt-'+postId);
    if(!post||!old)return;
    const prevVal=(document.getElementById('cs-ci-'+postId)||{}).value||'';
    const tmp=document.createElement('div');tmp.innerHTML=_renderCmtSectionHtml(post);
    old.replaceWith(tmp.firstElementChild);
    _bindLazy(document.getElementById('cs-cmt-'+postId));
    const inp=document.getElementById('cs-ci-'+postId);if(inp&&prevVal)inp.value=prevVal;
}

// ─── 发评论 ───
window._mSendComment=function(postId){
    const inp=document.getElementById('cs-ci-'+postId);if(!inp)return;
    const text=inp.value.trim(), img=_commentImgMap[postId];
    if(!text&&!img)return;
    const post=momentsData.posts.find(p=>p.id===postId);if(!post)return;
    const ri=_replyInfoMap[postId];
    post.comments.push({id:_mUid('c'),authorType:'user',text:text||'',image:img||null,timestamp:Date.now(),isNew:false,replyTo:ri?{commentId:ri.commentId,authorName:ri.authorName}:null});
    saveMomentsData(); inp.value=''; delete _replyInfoMap[postId]; delete _commentImgMap[postId];
    onUserCommented(postId);
    _rerenderCmtSection(postId);
    const cc=document.getElementById('cs-cc-'+postId);if(cc)cc.textContent=' '+post.comments.length;
    const ci=document.querySelector(`[data-pid="${postId}"] .cs-cmt-btn i`);if(ci)ci.className='fas fa-comment';
};

// ─── 点赞（in-place，不闪） ───
window._mToggleLike=function(postId){
    const p=momentsData.posts.find(p=>p.id===postId);if(!p)return;
    p.userLiked=!p.userLiked; saveMomentsData();
    const likeOn=p.userLiked, likeCount=(p.partnerLiked?1:0)+(p.userLiked?1:0);
    const btn=document.getElementById('cs-lbtn-'+postId);
    if(btn){btn.className='cs-like-btn'+(likeOn?' on':'');btn.querySelector('i').className=likeOn?'fas fa-heart':'far fa-heart';}
    const lc=document.getElementById('cs-lc-'+postId);if(lc)lc.textContent=likeCount>0?' '+likeCount:'';
    const lr=document.getElementById('cs-lr-'+postId);
    if(lr){const likers=[];if(p.partnerLiked)likers.push(_mPName());if(p.userLiked)likers.push(_mMName());lr.style.display=likers.length?'flex':'none';lr.innerHTML=likers.length?`<i class="fas fa-heart"></i><span>${likers.join('、')} 赞了</span>`:'';}
};

// ─── 删除 ───
window._mDeletePost=function(postId){
    if(!confirm('确定删除这条动态吗？'))return;
    momentsData.posts=momentsData.posts.filter(p=>p.id!==postId);
    delete _replyInfoMap[postId];delete _commentImgMap[postId];_showAllCmtSet.delete(postId);
    saveMomentsData();_csRenderFeed();
};

// ─── 天数 & 头像 ───
function _updateDaysCounter() {
    var textEl = document.getElementById('cs-days-text');
    if (!textEl) return;

    function render(labelStr, daysStr) {
        textEl.innerHTML =
            '<span class="cs-days-label" id="cs-days-label">' + labelStr + '</span>'
            + '<div class="cs-days-count">'
            + '<span class="cs-days-num" id="cs-days-num">' + daysStr + '</span>'
            + '<span class="cs-days-unit">天</span>'
            + '</div>';
        var lbl = document.getElementById('cs-days-label');
        if (lbl) {
            var len = Array.from(labelStr).length;
            lbl.style.fontSize = (len <= 4 ? 13 : len <= 6 ? 12 : len <= 8 ? 11 : 10) + 'px';
        }
    }

    // 优先：置顶纪念日
    if (typeof window._annGetPinned === 'function') {
        var p = window._annGetPinned();
        if (p) {
            var verb = (p.dayLabel === '天后') ? ' 还有' : ' 已经';
            render(p.name + verb, p.days.toLocaleString('zh-CN'));
            return;
        }
    }

    // 回退：旧逻辑（第一条 anniversary 类型）
    try {
        var list = Array.isArray(anniversaries) ? anniversaries : [];
        var main = list.find(function(a) { return a.type === 'anniversary'; }) || list[0];
        if (main && main.date) {
            var diff = Math.floor((Date.now() - new Date(main.date)) / 86400000) + 1;
            if (diff > 0) { render('相识', diff); return; }
        }
    } catch(e) {}
    render('相识', '---');
}
window._updateDaysCounter = _updateDaysCounter;
function _updateBigAvatars(){
    const dflt='<i class="fas fa-user" style="font-size:36px;color:var(--text-secondary,#aaa);"></i>';
    const ptEl=document.getElementById('cs-bav-partner'),meEl=document.getElementById('cs-bav-me');
    if(ptEl){const s=_getAvSrc(true);ptEl.innerHTML=s?`<img src="${s}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`:dflt;}
    if(meEl){const s=_getAvSrc(false);meEl.innerHTML=s?`<img src="${s}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`:dflt;}
}

// ─── 主入口 ───
window.openCoupleSpace=window.openMomentsModal=function(scrollToPostId){
    const page=document.getElementById('couple-space-page');if(!page)return;
    page.style.display='flex';
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
        // 页面动画前先把 header 放好（此时整页还在 translateY(100%) 不可见）
        const outerHeader=document.getElementById('cs-outer-header');
        const feedPanel=document.getElementById('cs-panel-feed');
        if(outerHeader&&feedPanel&&outerHeader.parentElement!==feedPanel){
            feedPanel.insertBefore(outerHeader,feedPanel.firstChild);
        }
        page.classList.add('cs-open');
        _csSetTab('feed');_csRenderFeed();_updateBigAvatars();
        if(typeof window._annLoadPinned==='function'){
            window._annLoadPinned().then(function(){_updateDaysCounter();});
        }else{_updateDaysCounter();}
        _updateBadge();_csExpandFeedHeader();_csSetupFeedScroll();
        if(scrollToPostId)setTimeout(()=>_csScrollTo(scrollToPostId),350);
    }));
};
window.closeCoupleSpace=window.closeMomentsModal=function(){
    const page=document.getElementById('couple-space-page');if(!page)return;
    page.classList.remove('cs-open');window.closeAllCsSheets();_csExpandFeedHeader();
    [document.getElementById('cs-notif-popup'),document.getElementById('cs-sticker-picker')].forEach(el=>{if(el)el.style.display='none';});
    setTimeout(()=>{page.style.display='none';},380);
};
window.csSwitchTab=function(tab){
    const feedPanel   = document.getElementById('cs-panel-feed');
    const outerHeader = document.getElementById('cs-outer-header');
    const csContent   = document.querySelector('.cs-content');

    if(tab==='feed'){
        // 先移 header 进 feed（feed 还是 display:none，不可见）
        if(outerHeader&&feedPanel&&outerHeader.parentElement!==feedPanel){
            feedPanel.insertBefore(outerHeader,feedPanel.firstChild);
        }
        // 注意：不在这里操作 scrollTop，避免强制 reflow 产生中间帧
    }

    // 切换面板可见性（与上面 DOM 移动合并进同一次渲染批次）
    _csSetTab(tab);
    _csExpandFeedHeader();

    if(tab!=='feed'){
        // feed 已经 display:none，再搬 header 出来（不可见）
        if(outerHeader&&csContent&&outerHeader.parentElement===feedPanel){
            csContent.parentElement.insertBefore(outerHeader,csContent);
        }
    }

    const fab=document.getElementById('cs-feed-fab');
    if(fab)fab.classList.toggle('cs-fab-hidden',tab!=='feed');

    if(tab==='feed'){
        if(feedPanel)feedPanel.scrollTop=0; // 面板已可见再重置，安全
        _csRenderFeed();
    }
    if(tab==='album'&&typeof window._alInit==='function')window._alInit();
    if(tab==='mood'&&typeof window._moodInit==='function')window._moodInit();
    if(tab==='ann'&&typeof window._annInit==='function')window._annInit();
    if(tab==='cinema'&&typeof window._cinemaInit==='function')window._cinemaInit();

    // 切离 feed 后兜底清除 feed title（IntersectionObserver 可能异步残留）
    if(tab!=='feed'){
        setTimeout(function(){
            var t=document.getElementById('cs-topbar-feed-title');
            if(t)t.classList.remove('cs-title-visible');
            var tb=document.getElementById('cs-topbar');
            if(tb)tb.classList.remove('cs-topbar-scrolled');
        },80);
    }
};
function _csSetTab(tab){
    document.querySelectorAll('.cs-panel').forEach(p=>p.classList.remove('cs-panel-active'));
    const panel=document.getElementById('cs-panel-'+tab);
    if(panel)panel.classList.add('cs-panel-active');
    document.querySelectorAll('.cs-pill').forEach(b=>b.classList.remove('cs-pill-on'));
    const btn=document.getElementById('csp-'+tab);
    if(btn)btn.classList.add('cs-pill-on');
}
function _csRenderFeed(){
    const list=document.getElementById('cs-feed-list');if(!list)return;
    if(!momentsData.posts.length){list.innerHTML=`<div class="cs-empty"><i class="fas fa-wind"></i><div class="cs-empty-label">还没有动态<br>来发第一条吧~</div></div>`;return;}
    list.innerHTML=momentsData.posts.map(p=>_renderCard(p)).join('');_bindLazy(list);
    momentsData.posts.forEach(p=>markPostRead(p.id));
}
function _csScrollTo(postId){const idx=momentsData.posts.findIndex(p=>p.id===postId);const panel=document.getElementById('cs-panel-feed');if(!panel||idx<0)return;const cards=panel.querySelectorAll('.cs-post');if(cards[idx])cards[idx].scrollIntoView({behavior:'smooth',block:'start'});}

// ─── 发帖 sheet ───
const _VIDEO_MAX_BYTES = 50 * 1024 * 1024; // 50MB
let _composeImgs=[], _composeVideo=null; // _composeVideo = { file, coverB64, blobUrl }

function _setComposeModeImg(on){
    const imgBtn=document.getElementById('cs-add-img-btn'),vidBtn=document.getElementById('cs-add-video-btn');
    if(imgBtn)imgBtn.disabled=on?false:!!_composeVideo;
    if(vidBtn)vidBtn.disabled=on?!!_composeImgs.length:false;
}

window.openCsCompose=function(){
    _composeImgs=[];_composeVideo=null;
    const ta=document.getElementById('cs-compose-text');if(ta)ta.value='';
    _refreshPreviews();_openSheet('cs-compose-sheet');
    _setComposeModeImg(true);
    setTimeout(()=>{const ta=document.getElementById('cs-compose-text');if(ta)ta.focus();},350);
};
window.closeCsCompose=function(){
    _closeSheet('cs-compose-sheet');
    if(_composeVideo&&_composeVideo.blobUrl)URL.revokeObjectURL(_composeVideo.blobUrl);
    _composeImgs=[];_composeVideo=null;
};
window.onCsImagesSelected=function(input){
    if(_composeVideo){input.value='';return;}
    const files=Array.from(input.files),rem=6-_composeImgs.length;
    if(rem<=0){alert('最多 6 张');return;}
    Promise.all(files.slice(0,rem).map(f=>optimizeImage(f,800,0.75))).then(results=>{
        results.forEach(d=>_composeImgs.push(d));_refreshPreviews();
        const vidBtn=document.getElementById('cs-add-video-btn');if(vidBtn)vidBtn.disabled=true;
    });
    input.value='';
};
window.onCsVideoClick=function(){
    if(_composeImgs.length>0){alert('图片和视频不能同时发布，请先清除已选图片');return;}
    document.getElementById('cs-video-input').click();
};
window.onCsVideoSelected=function(input){
    const file=input.files[0];if(!file)return;
    if(file.size>_VIDEO_MAX_BYTES){alert('视频太大啦，最多支持 50MB 哦');input.value='';return;}
    if(!(window.CloudSync&&window.CloudSync.isConnected())){
        alert('上传视频需要先配置云存储，视频文件太大无法保存在本地');input.value='';return;
    }
    const blobUrl=URL.createObjectURL(file);
    // 取第一帧作封面
    const vid=document.createElement('video');vid.src=blobUrl;vid.muted=true;vid.playsInline=true;
    vid.addEventListener('loadeddata',()=>{
        vid.currentTime=0.1;
    });
    vid.addEventListener('seeked',()=>{
        const cvs=document.createElement('canvas');cvs.width=vid.videoWidth||320;cvs.height=vid.videoHeight||240;
        cvs.getContext('2d').drawImage(vid,0,0,cvs.width,cvs.height);
        const coverB64=cvs.toDataURL('image/jpeg',0.7);
        _composeVideo={file,coverB64,blobUrl};
        _refreshPreviews();
        const imgBtn=document.getElementById('cs-add-img-btn');if(imgBtn)imgBtn.disabled=true;
    });
    vid.load();
    input.value='';
};
function _refreshPreviews(){
    const wrap=document.getElementById('cs-compose-previews');
    if(!wrap)return;
    if(_composeVideo){
        wrap.innerHTML=`<div class="cs-prev-thumb cs-prev-video"><img src="${_composeVideo.coverB64}"><div class="cs-prev-video-icon"><i class="fas fa-play"></i></div><button class="cs-prev-del" onclick="window._mDelVideo()">✕</button></div>`;
    } else {
        wrap.innerHTML=_composeImgs.map((d,i)=>`<div class="cs-prev-thumb"><img src="${d}"><button class="cs-prev-del" onclick="window._mDelImg(${i})">✕</button></div>`).join('');
    }
    const cnt=document.getElementById('cs-image-count');
    if(cnt)cnt.textContent=_composeImgs.length>0?`${_composeImgs.length}/6`:(_composeVideo?'1段视频':'');
}
window._mDelImg=function(i){
    _composeImgs.splice(i,1);_refreshPreviews();
    if(_composeImgs.length===0){const vidBtn=document.getElementById('cs-add-video-btn');if(vidBtn)vidBtn.disabled=false;}
};
window._mDelVideo=function(){
    if(_composeVideo&&_composeVideo.blobUrl)URL.revokeObjectURL(_composeVideo.blobUrl);
    _composeVideo=null;_refreshPreviews();
    const imgBtn=document.getElementById('cs-add-img-btn');if(imgBtn)imgBtn.disabled=false;
};
window.submitCsPost=async function(){
    const ta=document.getElementById('cs-compose-text'),text=ta?ta.value.trim():'';
    if(!text&&!_composeImgs.length&&!_composeVideo){if(ta)ta.focus();return;}
    const btn=document.getElementById('cs-submit-btn');if(btn){btn.disabled=true;btn.textContent='发布中…';}
    try{
        let images=[], video=null, videoCover=null;
        if(_composeVideo){
            // 上传视频封面
            try{const cr=await window.CloudMedia.upload(_composeVideo.coverB64,'moments-cover');videoCover=cr&&cr.url?cr.url:null;}catch(e){videoCover=null;}
            // 上传视频
            const vidUrl=await new Promise((resolve,reject)=>{
                const reader=new FileReader();
                reader.onload=async e=>{
                    try{const r=await window.CloudMedia.upload(e.target.result,'moments-video');resolve(r&&r.url?r.url:null);}catch(err){reject(err);}
                };
                reader.readAsDataURL(_composeVideo.file);
            });
            video=vidUrl;
        } else {
            for(const d of _composeImgs){
                if(window.CloudSync&&window.CloudSync.isConnected()&&window.CloudMedia){
                    try{const r=await window.CloudMedia.upload(d,'moments-img');images.push(r&&r.url?r.url:d);}catch(e){images.push(d);}
                }else{images.push(d);}
            }
        }
        const post={id:_mUid('user'),type:'user',text,images,video:video||null,videoCover:videoCover||null,date:_mToday(),timestamp:Date.now(),isNewForUser:false,userLiked:false,partnerLiked:false,pendingLikeTime:null,pendingLikeSilent:false,comments:[],pendingPartnerComment:null};
        momentsData.posts.unshift(post);saveMomentsData();onUserPostCreated(post.id);
        if(typeof window._albumSyncMomentsPost==="function")window._albumSyncMomentsPost(post.id,images,video,videoCover);
        window.closeCsCompose();_csRenderFeed();
    }finally{if(btn){btn.disabled=false;btn.textContent='发布';}}
};
function _openSheet(id){const s=document.getElementById(id),o=document.getElementById('cs-overlay');if(s)s.classList.add('cs-sheet-open');if(o)o.classList.add('cs-overlay-on');}
function _closeSheet(id){const s=document.getElementById(id);if(s)s.classList.remove('cs-sheet-open');if(!document.querySelectorAll('.cs-sheet.cs-sheet-open').length){const o=document.getElementById('cs-overlay');if(o)o.classList.remove('cs-overlay-on');}}
window.closeAllCsSheets=function(){document.querySelectorAll('.cs-sheet').forEach(s=>s.classList.remove('cs-sheet-open'));const o=document.getElementById('cs-overlay');if(o)o.classList.remove('cs-overlay-on');};
window._openMomentsPost=function(postId){window.openCoupleSpace();setTimeout(()=>{_csScrollTo(postId);},400);};

// ─── 暴露 ───
window.loadMomentsData=loadMomentsData;window.saveMomentsData=saveMomentsData;window.checkMomentsStatus=checkMomentsStatus;window.generatePartnerMoment=generatePartnerMoment;window.onUserPostCreated=onUserPostCreated;window.onUserCommented=onUserCommented;window.getMomentsUnreadCount=getMomentsUnreadCount;window.markPostRead=markPostRead;window._updateMomentsBadge=_updateBadge;

// ── 调试：已读不回测试用（浏览器控制台专用，跟正式功能无关）──────────────────
// 强制设定"已读不回"开关和概率，跳过手动去设置里点的步骤
window._mDebugSetReplyChance = function(allow, chance) {
    _csSettings.allowReadNoReply = !!allow;
    if (typeof chance === 'number') _csSettings.readNoReplyChance = chance;
    console.log('[Moments Debug] allowReadNoReply=', _csSettings.allowReadNoReply, ' readNoReplyChance=', _csSettings.readNoReplyChance);
};
// 把某条帖子（不传就用最新一条）待发送的回复立刻"送达"，不用真的等5~20分钟
window._mDebugForceDeliver = function(postId) {
    const p = postId ? momentsData.posts.find(x => x.id === postId) : momentsData.posts[0];
    if (!p) { console.warn('[Moments Debug] 没找到帖子'); return; }
    if (!p.pendingPartnerComment) { console.warn('[Moments Debug] 这条帖子当前没有待发送的回复（可能是刚才判定为"不回"了）'); return; }
    p.pendingPartnerComment.time = Date.now();
    checkMomentsStatus();
    console.log('[Moments Debug] 已强制送达，刷新一下页面看效果');
};

// ── 情侣空间设置读写 ──────────────────────────────────────────────────────
async function _loadCsSettings() {
    try {
        const key = getStorageKey(_CS_SETTINGS_KEY);
        const saved = await localforage.getItem(key);
        if (saved) Object.assign(_csSettings, saved);
    } catch(e) { console.warn('[cs-settings] 读取失败', e); }
}
async function _saveCsSettings() {
    try { await localforage.setItem(getStorageKey(_CS_SETTINGS_KEY), _csSettings); }
    catch(e) { console.warn('[cs-settings] 保存失败', e); }
}

window.openCsSettings = async function () {
    await _loadCsSettings();
    window._csSettings = _csSettings; // 确保 window 引用始终是最新的
    const minSlider  = document.getElementById('cs-dly-min-slider');
    const maxSlider  = document.getElementById('cs-dly-max-slider');
    const minVal     = document.getElementById('cs-dly-min-val');
    const maxVal     = document.getElementById('cs-dly-max-val');
    const saveToggle = document.getElementById('cs-save-img-toggle');
    const noReplyToggle = document.getElementById('cs-read-no-reply-toggle');
    const combineToggle = document.getElementById('cs-cmt-combine-toggle');
    const emojiMixToggle = document.getElementById('cs-emoji-mix-toggle');

    function updateSliderUI() {
        minSlider.value = _csSettings.dlyMin;
        maxSlider.value = _csSettings.dlyMax;
        maxSlider.min   = _csSettings.dlyMin;
        minSlider.max   = _csSettings.dlyMax;
        minVal.textContent = _csSettings.dlyMin + '分钟';
        maxVal.textContent = _csSettings.dlyMax + '分钟';
    }

    if (minSlider && maxSlider) {
        function updateCsDlyUI() {
            minSlider.value = _csSettings.dlyMin;
            minVal.textContent = _csSettings.dlyMin + '分钟';
            maxSlider.value = _csSettings.dlyMax;
            maxVal.textContent = _csSettings.dlyMax + '分钟';
            maxSlider.min = _csSettings.dlyMin;
        }
        updateCsDlyUI();

        minSlider.addEventListener('input', (e) => {
            _csSettings.dlyMin = parseInt(e.target.value, 10);
            if (_csSettings.dlyMin > _csSettings.dlyMax) {
                _csSettings.dlyMax = _csSettings.dlyMin;
            }
            updateCsDlyUI();
        });
        minSlider.addEventListener('change', _saveCsSettings);

        maxSlider.addEventListener('input', (e) => {
            _csSettings.dlyMax = parseInt(e.target.value, 10);
            if (_csSettings.dlyMax < _csSettings.dlyMin) {
                _csSettings.dlyMin = _csSettings.dlyMax;
            }
            updateCsDlyUI();
        });
        maxSlider.addEventListener('change', _saveCsSettings);
    }
    if (saveToggle) {
        // 没连云端存储，这个功能实际用不了——禁用开关并给出说明，
        // 避免用户开了这个开关却发现贴纸根本存不进相册
        const ossConnected = !!(window.CloudSync && typeof window.CloudSync.isConnected === 'function' && window.CloudSync.isConnected());
        const ossHint = document.getElementById('cs-save-img-oss-hint');
        if (!ossConnected) {
            saveToggle.checked = false;
            saveToggle.disabled = true;
            if (ossHint) ossHint.style.display = 'block';
        } else {
            saveToggle.disabled = false;
            if (ossHint) ossHint.style.display = 'none';
            saveToggle.checked = !!_csSettings.savePartnerImg;
            saveToggle.onchange = () => { _csSettings.savePartnerImg = saveToggle.checked; _saveCsSettings(); };
        }
    }

    if (noReplyToggle) {
        noReplyToggle.checked = !!_csSettings.allowReadNoReply;
        noReplyToggle.onchange = () => { _csSettings.allowReadNoReply = noReplyToggle.checked; _saveCsSettings(); };
    }

    if (combineToggle) {
        combineToggle.checked = !!_csSettings.cmtCombineCards;
        combineToggle.onchange = () => { _csSettings.cmtCombineCards = combineToggle.checked; _saveCsSettings(); };
    }

    if (emojiMixToggle) {
        emojiMixToggle.checked = !!_csSettings.emojiMixEnabled;
        emojiMixToggle.onchange = () => { _csSettings.emojiMixEnabled = emojiMixToggle.checked; _saveCsSettings(); };
    }

    // ── 壁纸画廊 ──
    await _loadCsBgGallery();
    _renderCsBgGallery();

    const bgInput = document.getElementById('cs-bg-input');
    if (bgInput && !bgInput._csBound) {
        bgInput._csBound = true;
        bgInput.addEventListener('change', _handleCsBgUpload);
    }
    const resetBgBtn = document.getElementById('cs-reset-bg');
    if (resetBgBtn) {
        resetBgBtn.onclick = () => { _removeCsBackground(); _renderCsBgGallery(); };
    }

    const modal = document.getElementById('cs-settings-modal');
    if (modal && typeof showModal === 'function') showModal(modal);
};

// 页面加载时预读设置（等 SESSION_ID 真正初始化完成，而不是赌一个固定时间——
// 之前固定等2秒，遇到设备/网络慢的情况2秒可能还不够，会导致读取失败）
(function _waitSessionThenRestoreCsUI(attempt) {
    attempt = attempt || 0;
    if (typeof SESSION_ID !== 'undefined' && SESSION_ID) {
        _loadCsSettings().then(() => { window._csSettings = _csSettings; });
        _restoreCsBackground();
        return;
    }
    if (attempt >= 20) {
        // 等了10秒还没好，大概率是别的问题了，放弃重试，避免无限等下去
        console.warn('[cs-wallpaper] 等待 SESSION_ID 超时，情侣空间设置/壁纸本次未能自动恢复');
        return;
    }
    setTimeout(function () { _waitSessionThenRestoreCsUI(attempt + 1); }, 500);
})();

Object.defineProperty(window,'_momentsData',{get:()=>momentsData});

// ── Feed 滚动行为：header 随内容滚走 + topbar 标题 + FAB ──
function _csExpandFeedHeader() {
    const title  = document.getElementById('cs-topbar-feed-title');
    const fab    = document.getElementById('cs-feed-fab');
    const topbar = document.getElementById('cs-topbar');
    const feedPanel = document.getElementById('cs-panel-feed');
    if (title)  title.classList.remove('cs-title-visible');
    if (fab)    fab.classList.remove('cs-fab-hidden');
    if (topbar) topbar.classList.remove('cs-topbar-scrolled');
    if (feedPanel) { feedPanel._feedLastScrollY = 0; feedPanel._feedUpAccum = 0; }
}

function _csSetupFeedScroll() {
    const feedPanel = document.getElementById('cs-panel-feed');
    if (!feedPanel || feedPanel._scrollListenerSet) return;
    feedPanel._scrollListenerSet = true;
    feedPanel._feedLastScrollY  = 0;
    feedPanel._feedUpAccum      = 0;

    const title  = document.getElementById('cs-topbar-feed-title');
    const fab    = document.getElementById('cs-feed-fab');
    const topbar = document.getElementById('cs-topbar');
    if (title) title.textContent = '动态';

    // ① IntersectionObserver：outer-header 滚出视窗 → 显示 topbar 标题
    const outerHeader = document.getElementById('cs-outer-header');
    if (outerHeader) {
        if (feedPanel._sentinelObs) feedPanel._sentinelObs.disconnect();
        const obs = new IntersectionObserver((entries) => {
            if (!feedPanel.classList.contains('cs-panel-active')) return;
            const visible = entries[0].isIntersecting;
            if (title)  title.classList.toggle('cs-title-visible', !visible);
            if (topbar) topbar.classList.toggle('cs-topbar-scrolled', !visible);
        }, { root: feedPanel, threshold: 0 });
        obs.observe(outerHeader);
        feedPanel._sentinelObs = obs;
    }

    // ② scroll 事件：FAB 方向控制
    feedPanel.addEventListener('scroll', () => {
        const scrollY = feedPanel.scrollTop;
        const delta   = scrollY - feedPanel._feedLastScrollY;
        if (delta > 0) {
            feedPanel._feedUpAccum = 0;
            if (fab) fab.classList.add('cs-fab-hidden');
        } else if (delta < 0) {
            feedPanel._feedUpAccum += Math.abs(delta);
            if (feedPanel._feedUpAccum >= 30 && fab) {
                fab.classList.remove('cs-fab-hidden');
                feedPanel._feedUpAccum = 0;
            }
        }
        feedPanel._feedLastScrollY = scrollY;
    }, { passive: true });

    // ③ topbar 点击回顶
    if (topbar && !topbar._csTopbarClickSet) {
        topbar._csTopbarClickSet = true;
        topbar.addEventListener('click', (e) => {
            if (!e.target.closest('.cs-icon-btn')) {
                feedPanel.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    }
}

// ── 情侣空间壁纸 ─────────────────────────────────────────────────────────────
const _CS_WALLPAPER_KEY         = 'csWallpaper';
const _CS_WALLPAPER_GALLERY_KEY = 'csWallpaperGallery';
var _csBgGallery       = [];
var _csBgGalleryLoaded = false;
var _csActiveBg        = null; // 内存中追踪当前激活的壁纸值（避免走 localStorage）

async function _loadCsBgGallery() {
    if (_csBgGalleryLoaded) return;
    _csBgGalleryLoaded = true;
    try {
        const saved = await localforage.getItem(getStorageKey(_CS_WALLPAPER_GALLERY_KEY));
        if (Array.isArray(saved)) _csBgGallery = saved;
    } catch(e) { console.warn('[cs-wallpaper] 画廊读取失败', e); }
}

function _saveCsBgGallery() {
    try { localforage.setItem(getStorageKey(_CS_WALLPAPER_GALLERY_KEY), _csBgGallery); }
    catch(e) { console.warn('[cs-wallpaper] 画廊保存失败', e); }
}

function _applyCsBackground(value) {
    if (!value || typeof value !== 'string') return;
    _csActiveBg = value;
    try { localforage.setItem(getStorageKey(_CS_WALLPAPER_KEY), value); } catch(e) {}

    const page = document.getElementById('couple-space-page');

    function _setVar(cssVal) {
        document.documentElement.style.setProperty('--cs-bg-image', `url(${cssVal})`);
        if (page) page.classList.add('cs-with-bg');
    }

    if (value.indexOf('oss://') === 0) {
        // 换设备恢复时 value 可能是 oss:// 引用，先找本地画廊有没有对应的 base64
        const local = _csBgGallery.find(bg => bg && (bg.cloudUrl === value || bg.value === value));
        if (local && local.value && local.value.indexOf('data:image') === 0) {
            _setVar(local.value);
            return;
        }
        // 本地没有，从云端拉
        if (window.CloudMedia) {
            if (local && local.thumbnail) _setVar(local.thumbnail); // 先用缩略图垫底
            window.CloudMedia.fetchUrl(value).then(blobUrl => {
                document.documentElement.style.setProperty('--cs-bg-image', `url(${blobUrl})`);
                if (page) page.classList.add('cs-with-bg');
            }).catch(e => console.warn('[cs-wallpaper] 云端壁纸加载失败', e));
        }
        return;
    }

    const cssValue = value.startsWith('url(') ? value : `url(${value})`;
    document.documentElement.style.setProperty('--cs-bg-image', cssValue);
    if (page) page.classList.add('cs-with-bg');
}

function _removeCsBackground() {
    document.documentElement.style.removeProperty('--cs-bg-image');
    const page = document.getElementById('couple-space-page');
    if (page) page.classList.remove('cs-with-bg');
    _csActiveBg = null;
    try { localforage.removeItem(getStorageKey(_CS_WALLPAPER_KEY)); } catch(e) {}
    if (typeof showNotification === 'function') showNotification('壁纸已移除', 'success');
}

function _renderCsBgGallery() {
    const list = document.getElementById('cs-bg-gallery-list');
    if (!list) return;
    list.innerHTML = '';

    // + 按钮
    const addBtn = document.createElement('div');
    addBtn.className = 'bg-item bg-add-btn';
    addBtn.innerHTML = '<i class="fas fa-plus"></i><span></span>';
    addBtn.onclick = () => document.getElementById('cs-bg-input').click();
    list.appendChild(addBtn);

    const currentBg = _csActiveBg;

    _csBgGallery.forEach((bg, index) => {
        const item = document.createElement('div');
        const isActive = currentBg && (
            currentBg === bg.value ||
            (typeof currentBg === 'string' && currentBg.indexOf('oss://') === 0 && bg.cloudUrl === currentBg)
        );
        item.className = `bg-item${isActive ? ' active' : ''}`;

        if (bg.type === 'image' || bg.type === 'gif') {
            item.innerHTML = `<img src="${bg.thumbnail || bg.value}" loading="lazy" alt="wallpaper">`;
        }

        item.onclick = async (e) => {
            if (e.target.closest('.bg-delete-btn')) return;
            _applyCsBackground(bg.value);
            _renderCsBgGallery();
            if (typeof showNotification === 'function') showNotification('壁纸已切换', 'success');
        };

        if (bg.id.startsWith('user-')) {
            const delBtn = document.createElement('div');
            delBtn.className = 'bg-delete-btn';
            delBtn.innerHTML = '<i class="fas fa-trash"></i>';
            delBtn.title = '删除此壁纸';
            delBtn.style.cssText = 'opacity:1;transform:scale(1);'; // 手机无 hover，始终显示
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                const doDelete = async () => {
                    if (window.CloudMedia && bg.cloudKey) {
                        try { await window.CloudMedia.delete(bg.cloudKey); }
                        catch(err) { console.warn('[cs-wallpaper] 云端删除失败', err); }
                    }
                    _csBgGallery.splice(index, 1);
                    _saveCsBgGallery();
                    if (isActive) _removeCsBackground();
                    _renderCsBgGallery();
                };
                if (typeof _alShowConfirm === 'function') {
                    _alShowConfirm('删除壁纸', '删除后无法恢复，确定吗？', '删除', true, doDelete);
                } else if (confirm('确定删除这张壁纸吗？')) {
                    doDelete();
                }
            };
            item.appendChild(delBtn);
        }

        list.appendChild(item);
    });
}

async function _handleCsBgUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
        if (typeof showNotification === 'function') showNotification('壁纸图片不能超过10MB', 'error');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        if (typeof showNotification === 'function') showNotification('文件较大，正在处理中...', 'info', 2000);
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
        const base64 = ev.target.result;
        const bgType = file.type === 'image/gif' ? 'gif' : 'image';
        const bgId   = `user-${Date.now()}`;
        let stored     = { id: bgId, type: bgType, value: base64 }; // 兜底：没配置 OSS 或上传失败时，本地存完整大图
        let applyValue = base64;

        if (window.CloudMedia && window.CloudSync && window.CloudSync.isConnected()) {
            if (typeof showNotification === 'function') showNotification('正在上传到云端...', 'info', 2000);
            try {
                const uploadResult = await window.CloudMedia.upload(base64, 'cs-wallpapers', bgId);
                let thumb = null;
                try { thumb = await window.CloudMedia.makeThumbnail(base64, 200); }
                catch(thumbErr) { console.warn('[cs-wallpaper] 缩略图生成失败', thumbErr); }
                // 配置了 OSS：本地只留一张小缩略图（方便选择器快速显示），完整大图不落本地，
                // value 直接换成云端地址，应用/展示时都从云端拉
                stored = { id: bgId, type: bgType, value: uploadResult.url, thumbnail: thumb, cloudKey: uploadResult.key, cloudUrl: uploadResult.url };
                applyValue = uploadResult.url;
            } catch(err) {
                console.warn('[cs-wallpaper] 背景上传失败，仅本地存储', err);
                if (typeof showNotification === 'function') showNotification('云端上传失败，暂存本地', 'error', 2500);
            }
        }

        _csBgGallery.push(stored);
        _saveCsBgGallery();
        _renderCsBgGallery();
        _applyCsBackground(applyValue);
        if (typeof showNotification === 'function') showNotification('壁纸已添加并应用', 'success');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

async function _restoreCsBackground() {
    await _loadCsBgGallery();
    try {
        const bg = await localforage.getItem(getStorageKey(_CS_WALLPAPER_KEY));
        if (bg) _applyCsBackground(bg);
    } catch(e) { console.warn('[cs-wallpaper] 壁纸恢复失败', e); }
}
