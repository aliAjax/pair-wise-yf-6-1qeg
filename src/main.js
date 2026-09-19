import "./styles.css";

const STORAGE_KEY = "zfl-14-repairs";
const statuses = {
  all: "全部",
  todo: "待处理",
  doing: "处理中",
  done: "已完成"
};

const priorities = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

const batchStatuses = {
  pending: "待开工",
  active: "进行中",
  cancelled: "已取消"
};

let state = loadState();
const app = document.querySelector("#app");

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return {
      filter: "all",
      repairs: [
        {
          id: crypto.randomUUID(),
          location: "厨房",
          title: "水槽下方渗水",
          priority: "high",
          cost: 260,
          status: "todo",
          photo: "",
          note: "先检查软管接口",
          batchId: null,
          started: false,
          actualCost: null,
          overrunReason: ""
        }
      ],
      batches: []
    };
  }
  const parsed = JSON.parse(saved);
  return {
    filter: parsed.filter || "all",
    batches: Array.isArray(parsed.batches) ? parsed.batches : [],
    repairs: (Array.isArray(parsed.repairs) ? parsed.repairs : []).map((repair) => ({
      batchId: null,
      started: false,
      actualCost: null,
      overrunReason: "",
      ...repair
    }))
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function batchOf(repair) {
  return state.batches.find((batch) => batch.id === repair.batchId) || null;
}

function batchRepairs(batchId) {
  return state.repairs.filter((repair) => repair.batchId === batchId);
}

function sumCost(list) {
  return list.reduce((total, repair) => total + Number(repair.cost || 0), 0);
}

function render() {
  const repairs = filteredRepairs();
  const unfinished = state.repairs.filter((repair) => repair.status !== "done");
  const totalCost = unfinished.reduce((total, repair) => total + Number(repair.cost || 0), 0);
  const doing = state.repairs.filter((repair) => repair.status === "doing").length;
  const selectable = state.repairs.filter((repair) => repair.status !== "done" && !repair.batchId);

  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">本地家庭维护台</p>
          <h1>家庭维修事项</h1>
        </div>
        <section class="stats">
          <div class="stat"><span>未完成</span><strong>${unfinished.length}</strong></div>
          <div class="stat"><span>处理中</span><strong>${doing}</strong></div>
          <div class="stat"><span>预计费用</span><strong>¥${totalCost}</strong></div>
        </section>
      </header>

      <section class="layout">
        <aside class="side">
          <section class="panel">
            <h2>新增维修事项</h2>
            <form class="form" id="repair-form">
              <label>位置<input name="location" required placeholder="例如卫生间"></label>
              <label>问题描述<textarea name="title" required placeholder="例如门锁松动"></textarea></label>
              <label>优先级<select name="priority">${renderPriorityOptions("medium")}</select></label>
              <label>预计费用<input name="cost" type="number" min="0" step="1" value="0"></label>
              <label>处理状态<select name="status">${renderStatusOptions("todo")}</select></label>
              <label>照片链接<input name="photo" type="url" placeholder="可选，粘贴图片地址"></label>
              <label>备注<textarea name="note" placeholder="师傅电话、材料或注意事项"></textarea></label>
              <button class="primary" type="submit">保存事项</button>
            </form>
          </section>

          <section class="panel">
            <h2>创建预算批次</h2>
            <form class="form" id="batch-form">
              <label>总预算<input name="budget" type="number" min="0" step="1" required placeholder="本批次预算上限"></label>
              <div class="batch-picker">
                ${
                  selectable.length
                    ? selectable
                        .map(
                          (repair) => `
                    <label class="batch-option">
                      <input type="checkbox" name="repairIds" value="${repair.id}">
                      <span>${escapeHtml(repair.location)} · ${escapeHtml(repair.title)}</span>
                      <strong>¥${Number(repair.cost || 0)}</strong>
                    </label>`
                        )
                        .join("")
                    : `<p class="hint">暂无可分配的未完成事项</p>`
                }
              </div>
              <p class="hint" id="batch-sum">已选 0 项，合计预计 ¥0</p>
              <p class="error" id="batch-error"></p>
              <button class="primary" type="submit">创建批次</button>
            </form>
          </section>
        </aside>

        <section>
          <div class="toolbar">
            ${Object.entries(statuses).map(([value, label]) => `<button class="seg ${state.filter === value ? "active" : ""}" data-filter="${value}">${label}</button>`).join("")}
          </div>
          <div class="repairs">
            ${repairs.length ? repairs.map(renderRepair).join("") : `<div class="empty">当前状态下没有维修事项</div>`}
          </div>

          <section class="batches">
            <h2>预算批次</h2>
            ${state.batches.length ? state.batches.map(renderBatch).join("") : `<div class="empty">暂无预算批次</div>`}
          </section>
        </section>
      </section>
    </main>
  `;

  bindEvents();
}

function renderRepair(repair) {
  const batch = batchOf(repair);
  return `
    <article class="repair">
      <div class="photo">${repair.photo ? `<img src="${escapeHtml(repair.photo)}" alt="${escapeHtml(repair.location)}维修照片">` : "未添加照片"}</div>
      <div class="content">
        <div class="row">
          <h3>${escapeHtml(repair.location)}</h3>
          <span class="priority ${repair.priority}">${priorities[repair.priority]}</span>
          <span class="status ${repair.status}">${statuses[repair.status]}</span>
          ${batch ? `<span class="chip">${escapeHtml(batch.name)} · ${batchStatuses[batch.status]}</span>` : ""}
        </div>
        <p>${escapeHtml(repair.title)}</p>
        <div class="row">
          <span class="chip">预计 ¥${Number(repair.cost || 0)}</span>
          ${repair.actualCost != null ? `<span class="chip">实际 ¥${Number(repair.actualCost)}</span>` : ""}
          ${repair.overrunReason ? `<span class="chip overrun">超支原因：${escapeHtml(repair.overrunReason)}</span>` : ""}
          <span class="chip">${escapeHtml(repair.note || "暂无备注")}</span>
        </div>
        <div class="actions">
          ${renderRepairActions(repair, batch)}
          <button class="ghost" data-delete="${repair.id}">删除</button>
        </div>
      </div>
    </article>
  `;
}

function renderRepairActions(repair, batch) {
  if (!batch) return `<select data-status="${repair.id}">${renderStatusOptions(repair.status)}</select>`;
  if (repair.status === "done") return "";
  if (!repair.started) {
    if (batch.status === "active") return `<button class="primary" data-start-repair="${repair.id}">开工</button>`;
    return `<span class="hint">已加入批次，待批次开工</span>`;
  }
  return `
    <form class="complete-form" data-complete="${repair.id}">
      <input name="actualCost" type="number" min="0" step="1" required placeholder="实际费用">
      <input name="reason" type="text" placeholder="超支原因（超预算时必填）">
      <button class="primary" type="submit">确认完工</button>
      <p class="error complete-error"></p>
    </form>`;
}

function renderBatch(batch) {
  const items = batchRepairs(batch.id);
  const doneItems = items.filter((repair) => repair.status === "done");
  const actualTotal = doneItems.reduce((total, repair) => total + Number(repair.actualCost || 0), 0);
  return `
    <article class="batch">
      <div class="batch-head">
        <div>
          <h3>${escapeHtml(batch.name)}</h3>
          <span class="batch-status ${batch.status}">${batchStatuses[batch.status]}</span>
        </div>
        <div class="batch-figures">
          <span class="chip">总预算 ¥${Number(batch.budget)}</span>
          <span class="chip">预计合计 ¥${sumCost(items)}</span>
          <span class="chip">实际合计 ¥${actualTotal}</span>
          <span class="chip">完工 ${doneItems.length}/${items.length}</span>
        </div>
      </div>
      <ul class="batch-items">
        ${items.length ? items.map(renderBatchItem).join("") : `<li>批次内暂无事项</li>`}
      </ul>
      <div class="actions">
        ${batch.status === "pending" ? `<button class="primary" data-start-batch="${batch.id}">批次开工</button>` : ""}
        ${batch.status !== "cancelled" ? `<button class="ghost" data-cancel-batch="${batch.id}">取消批次</button>` : ""}
      </div>
    </article>
  `;
}

function renderBatchItem(repair) {
  const stage = repair.status === "done" ? "已完工" : repair.started ? "已开工" : "未开工";
  return `
    <li>
      <span class="item-title">${escapeHtml(repair.location)} · ${escapeHtml(repair.title)}</span>
      <span>预计 ¥${Number(repair.cost || 0)}</span>
      ${repair.actualCost != null ? `<span>实际 ¥${Number(repair.actualCost)}</span>` : ""}
      <span>${stage}</span>
      ${repair.overrunReason ? `<span class="overrun">超支原因：${escapeHtml(repair.overrunReason)}</span>` : ""}
    </li>`;
}

function renderStatusOptions(selected) {
  return Object.entries(statuses)
    .filter(([value]) => value !== "all")
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function renderPriorityOptions(selected) {
  return Object.entries(priorities)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function bindEvents() {
  document.querySelector("#repair-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    state.repairs.unshift({
      id: crypto.randomUUID(),
      location: data.location.trim(),
      title: data.title.trim(),
      priority: data.priority,
      cost: Number(data.cost || 0),
      status: data.status,
      photo: data.photo.trim(),
      note: data.note.trim(),
      batchId: null,
      started: false,
      actualCost: null,
      overrunReason: ""
    });
    saveState();
    render();
  });

  const batchForm = document.querySelector("#batch-form");
  const batchSum = document.querySelector("#batch-sum");
  const batchError = document.querySelector("#batch-error");
  const pickedRepairs = () => {
    const ids = [...batchForm.querySelectorAll('input[name="repairIds"]:checked')].map((input) => input.value);
    return state.repairs.filter((repair) => ids.includes(repair.id));
  };

  batchForm.querySelectorAll('input[name="repairIds"]').forEach((input) => {
    input.addEventListener("change", () => {
      const picked = pickedRepairs();
      batchSum.textContent = `已选 ${picked.length} 项，合计预计 ¥${sumCost(picked)}`;
      batchError.textContent = "";
    });
  });

  batchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const budget = Number(new FormData(batchForm).get("budget"));
    const picked = pickedRepairs();
    if (!picked.length) {
      batchError.textContent = "请至少选择一项未完成事项";
      return;
    }
    const total = sumCost(picked);
    if (total > budget) {
      batchError.textContent = `合计预计费用 ¥${total} 超过总预算 ¥${budget}，已整批拒绝，事项与批次均未变化`;
      return;
    }
    const batch = {
      id: crypto.randomUUID(),
      name: `批次 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
      budget,
      status: "pending",
      createdAt: Date.now()
    };
    state.batches.unshift(batch);
    picked.forEach((repair) => {
      repair.batchId = batch.id;
      repair.started = false;
    });
    saveState();
    render();
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-status]").forEach((select) => {
    select.addEventListener("change", () => {
      const repair = state.repairs.find((item) => item.id === select.dataset.status);
      repair.status = select.value;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      state.repairs = state.repairs.filter((repair) => repair.id !== button.dataset.delete);
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-start-batch]").forEach((button) => {
    button.addEventListener("click", () => {
      const batch = state.batches.find((item) => item.id === button.dataset.startBatch);
      batch.status = "active";
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-cancel-batch]").forEach((button) => {
    button.addEventListener("click", () => {
      const batch = state.batches.find((item) => item.id === button.dataset.cancelBatch);
      batch.status = "cancelled";
      state.repairs.forEach((repair) => {
        if (repair.batchId === batch.id && !repair.started) repair.batchId = null;
      });
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-start-repair]").forEach((button) => {
    button.addEventListener("click", () => {
      const repair = state.repairs.find((item) => item.id === button.dataset.startRepair);
      repair.started = true;
      repair.status = "doing";
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-complete]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const repair = state.repairs.find((item) => item.id === form.dataset.complete);
      const batch = batchOf(repair);
      const data = new FormData(form);
      const actual = Number(data.get("actualCost"));
      const reason = String(data.get("reason") || "").trim();
      const doneActual = batchRepairs(batch.id)
        .filter((item) => item.status === "done")
        .reduce((total, item) => total + Number(item.actualCost || 0), 0);
      const overrun = doneActual + actual > batch.budget;
      if (overrun && !reason) {
        form.querySelector(".complete-error").textContent = `实际合计 ¥${doneActual + actual} 将超过批次预算 ¥${batch.budget}，请填写超支原因`;
        return;
      }
      repair.actualCost = actual;
      repair.overrunReason = overrun ? reason : "";
      repair.status = "done";
      saveState();
      render();
    });
  });
}

function filteredRepairs() {
  if (state.filter === "all") return state.repairs;
  return state.repairs.filter((repair) => repair.status === state.filter);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

render();
