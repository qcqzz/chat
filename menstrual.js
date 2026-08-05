// js/menstrual.js - 经期记录核心模块
const Menstrual = {
    data: [],
    init() {
        const saved = localStorage.getItem('menstrual_records');
        this.data = saved ? JSON.parse(saved) : [];
        this.renderCalendar();
    },
    save() {
        localStorage.setItem('menstrual_records', JSON.stringify(this.data));
        this.renderCalendar();
    },
    addRecord(date, flow, symptoms) {
        const index = this.data.findIndex(item => item.date === date);
        const record = { date, flow, symptoms: symptoms || [] };
        if (index > -1) this.data[index] = record;
        else this.data.push(record);
        this.save();
    },
    deleteRecord(date) {
        this.data = this.data.filter(item => item.date !== date);
        this.save();
    },
    getRecord(date) {
        return this.data.find(item => item.date === date) || null;
    },
    predictNext() {
        if (this.data.length === 0) return '暂无数据，请先记录';
        const sorted = [...this.data].sort((a,b) => new Date(b.date) - new Date(a.date));
        const last = new Date(sorted[0].date);
        last.setDate(last.getDate() + 28);
        return last.toISOString().split('T')[0];
    },
    renderCalendar() {
        // 可选：如果你需要日历视图，可在这里扩展
    }
};
document.addEventListener('DOMContentLoaded', () => Menstrual.init());

function openMenstrualModal() {
    const modal = document.getElementById('menstrualModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('recordDate').value = new Date().toISOString().split('T')[0];
    renderHistory();
    document.getElementById('nextPredict').textContent = Menstrual.predictNext();
}
function closeMenstrualModal() {
    const modal = document.getElementById('menstrualModal');
    if (modal) modal.style.display = 'none';
}
function saveMenstrualRecord() {
    const date = document.getElementById('recordDate').value;
    if (!date) return alert('请选择日期');
    const flow = document.getElementById('recordFlow').value;
    const symptoms = [];
    document.querySelectorAll('#menstrualModal input[type="checkbox"]:checked').forEach(el => symptoms.push(el.value));
    Menstrual.addRecord(date, flow, symptoms);
    renderHistory();
    document.getElementById('nextPredict').textContent = Menstrual.predictNext();
    alert('✅ 保存成功！');
}
function renderHistory() {
    const container = document.getElementById('menstrualHistory');
    if (!container) return;
    if (Menstrual.data.length === 0) {
        container.innerHTML = '<p style="color:#999;font-size:13px;">暂无记录</p>';
        return;
    }
    const sorted = [...Menstrual.data].sort((a,b) => new Date(b.date) - new Date(a.date));
    container.innerHTML = sorted.map(item => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-color);">
            <span>${item.date} | ${item.flow} | ${item.symptoms.join('/') || '无'}</span>
            <button onclick="deleteRecord('${item.date}')" style="color:#ff6b6b;border:none;background:none;cursor:pointer;font-size:14px;">🗑️</button>
        </div>
    `).join('');
}
window.deleteRecord = function(date) {
    if (confirm(`确认删除 ${date} 的记录吗？`)) {
        Menstrual.deleteRecord(date);
        renderHistory();
        document.getElementById('nextPredict').textContent = Menstrual.predictNext();
    }
};

// 绑定高级功能中的点击事件（在 DOM 加载后绑定）
document.addEventListener('DOMContentLoaded', function() {
    const menstrualEntry = document.getElementById('menstrual-function');
    if (menstrualEntry) {
        menstrualEntry.addEventListener('click', function(e) {
            e.stopPropagation();
            openMenstrualModal();
        });
    }
});
