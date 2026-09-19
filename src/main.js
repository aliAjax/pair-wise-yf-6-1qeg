import "./styles.css";

const STORAGE_KEY = "zfl-14-repairs";
const statuses = {
  all: "全部",
  todo: "待处理",
  doing: "处理中",
  done: "已完成"
};

const batchStatuses = {
  created: "待开工",
  started: "进行中",
  done: "已完工",
  cancelled: "已取消"
};

const priorities = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

let state = loadState();
const ui = {
  completingId: null,
  completeError: "",
  completeDraft: { actual: "", reason: "" },
  batchError: "",
  batchDraft: { budget: "", ids: [] }
};
const app = document.querySelector("#app");

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    parsed.filter ??= "all";
    parsed.repairs ??= [];
    parsed.batches ??= [];
    return parsed;
  }
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
        note: "先检查软管接口"
      }
    ],
    batches: []
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  const repairs = filteredRepairs();
  const unfinished = state.repairs.filter((repair) => repair.status !== "done");
  const totalCost = unfinished.reduce((total, repair) => total + Number(repair.cost || 0), 0);
  const doing = state.repairs.filter((repair) => repair.status === "doing").length;

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

      ${renderBatchSection()}

      <section class="layout">
        <aside class="panel">
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
        </aside>

        <section>
          <div class="toolbar">
            ${Object.entries(statuses).map(([value, label]) => `<button class="seg ${state.filter === value ? "active" : ""}" data-filter="${value}">${label}</button>`).join("")}
          </div>
          <div class="repairs">
            ${repairs.length ? repairs.map(renderRepair).join("") : `<div class="empty">当前状态下没有维修事项</div>`}
          </div>
        </section>
      </section>
    </main>
    ${ui.completingId ? renderCompleteModal() : ""}
  `;

  bindEvents();
}

function renderBatchSection() {
  const eligible = eligibleRepairs();
  const pickedSum = ui.batchDraft.ids.reduce((total, id) => {
    const repair = state.repairs.find((item) => item.id === id);
    return total + (repair ? Number(repair.cost || 0) : 0);
  }, 0);
  const draftBudget = Number(ui.batchDraft.budget || 0);

  return `
    <section class="batch-section">
      <div class="section-head">
        <h2>预算批次</h2>
        <p>勾选未完成事项并填写总预算创建批次；预计合计超过预算将整批拒绝。开工后完工需确认实际费用，超预算须保留超支原因；取消批次只释放未开工事项。</p>
      </div>
      <div class="batch-grid">
        <aside class="panel batch-create">
          <h3>创建预算批次</h3>
          <form class="form" id="batch-form">
            <label>总预算（元）<input name="budget" type="number" min="0" step="1" placeholder="例如 1000" value="${escapeHtml(ui.batchDraft.budget)}"></label>
            <div class="pick-head">选择未完成事项</div>
            <div class="pick-list">
              ${
                eligible.length
                  ? eligible
                      .map(
                        (repair) => `
                <label class="pick">
                  <input type="checkbox" name="batchItem" value="${repair.id}" data-cost="${Number(repair.cost || 0)}" ${ui.batchDraft.ids.includes(repair.id) ? "checked" : ""}>
                  <span class="pick-title">${escapeHtml(repair.location)} · ${escapeHtml(repair.title)}</span>
                  <span class="pick-cost">¥${Number(repair.cost || 0)}</span>
                </label>`
                      )
                      .join("")
                  : `<div class="empty small">暂无可加入批次的未完成事项</div>`
              }
            </div>
            <div class="batch-summary ${pickedSum > draftBudget ? "over" : ""}">
              <span>已选预计合计 <strong id="batch-sum">¥${pickedSum}</strong></span>
              <span>预算余量 <strong id="batch-remain">¥${draftBudget - pickedSum}</strong></span>
            </div>
            ${ui.batchError ? `<p class="form-error" id="batch-error">${escapeHtml(ui.batchError)}</p>` : `<p class="form-error" id="batch-error" hidden></p>`}
            <button class="primary" type="submit" ${eligible.length ? "" : "disabled"}>创建批次</button>
          </form>
        </aside>

        <div class="batch-cards">
          ${state.batches.length ? [...state.batches].reverse().map(renderBatchCard).join("") : `<div class="empty batch-empty">还没有预算批次</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderBatchCard(batch) {
  const items = batchItems(batch.id);
  const estimate = items.reduce((total, repair) => total + Number(repair.cost || 0), 0);
  const actual = items.reduce((total, repair) => total + Number(repair.actualCost || 0), 0);
  const doneCount = items.filter((repair) => repair.status === "done").length;
  const percent = items.length ? Math.round((doneCount / items.length) * 100) : 0;
  const overBudget = actual > batch.budget;

  return `
    <article class="batch-card ${batch.status}">
      <div class="batch-head">
        <div>
          <h3>${escapeHtml(batch.name)}</h3>
          <p class="muted">创建于 ${new Date(batch.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>
        </div>
        <span class="batch-status ${batch.status}">${batchStatuses[batch.status]}</span>
      </div>
      <div class="batch-metrics">
        <span>总预算 <strong>¥${batch.budget}</strong></span>
        <span>预计合计 <strong>¥${estimate}</strong></span>
        <span>实际合计 <strong class="${overBudget ? "danger-text" : ""}">¥${actual}${overBudget ? "（超支）" : ""}</strong></span>
        <span>完工进度 <strong>${doneCount}/${items.length}</strong></span>
      </div>
      <div class="progress"><span style="width:${percent}%"></span></div>
      <ul class="batch-items">
        ${items
          .map(
            (repair) => `
          <li>
            <span class="status ${repair.status}">${statuses[repair.status]}</span>
            <span class="batch-item-title">${escapeHtml(repair.location)} · ${escapeHtml(repair.title)}</span>
            <span class="chip">预计 ¥${Number(repair.cost || 0)}</span>
            ${repair.actualCost != null ? `<span class="chip actual">实际 ¥${repair.actualCost}</span>` : ""}
            ${repair.overrunReason ? `<span class="chip overrun" title="${escapeHtml(repair.overrunReason)}">超支原因：${escapeHtml(repair.overrunReason)}</span>` : ""}
            ${renderBatchItemAction(batch, repair)}
          </li>`
          )
          .join("")}
      </ul>
      <div class="actions">
        ${batch.status === "created" ? `<button class="primary small" data-batch-start="${batch.id}">批次开工</button>` : ""}
        ${batch.status === "created" || batch.status === "started" ? `<button class="ghost danger" data-batch-cancel="${batch.id}">取消批次</button>` : ""}
        ${batch.status === "done" ? `<span class="lock-hint">批次内事项已全部完工，闭环完成。</span>` : ""}
        ${batch.status === "cancelled" ? `<span class="lock-hint">批次已取消：未开工事项已释放，已开工事项继续保留至完工。</span>` : ""}
      </div>
    </article>
  `;
}

function renderBatchItemAction(batch, repair) {
  if (repair.status !== "doing") return "";
  if (batch.status === "started" || batch.status === "cancelled") {
    return `<button class="primary small" data-complete="${repair.id}">完工</button>`;
  }
  return "";
}

function renderRepair(repair) {
  const batch = getBatch(repair.batchId);
  return `
    <article class="repair">
      <div class="photo">${repair.photo ? `<img src="${escapeHtml(repair.photo)}" alt="${escapeHtml(repair.location)}维修照片">` : "未添加照片"}</div>
      <div class="content">
        <div class="row">
          <h3>${escapeHtml(repair.location)}</h3>
          <span class="priority ${repair.priority}">${priorities[repair.priority]}</span>
          <span class="status ${repair.status}">${statuses[repair.status]}</span>
          ${batch ? `<span class="batch-tag">${escapeHtml(batch.name)} · ${batchStatuses[batch.status]}</span>` : ""}
        </div>
        <p>${escapeHtml(repair.title)}</p>
        <div class="row">
          <span class="chip">预计 ¥${Number(repair.cost || 0)}</span>
          ${repair.actualCost != null ? `<span class="chip actual">实际 ¥${Number(repair.actualCost)}</span>` : ""}
          ${repair.overrunReason ? `<span class="chip overrun" title="${escapeHtml(repair.overrunReason)}">超支原因：${escapeHtml(repair.overrunReason)}</span>` : ""}
          <span class="chip">${escapeHtml(repair.note || "暂无备注")}</span>
        </div>
        <div class="actions">${renderRepairActions(repair, batch)}</div>
      </div>
    </article>
  `;
}

function renderRepairActions(repair, batch) {
  if (!batch) {
    return `
      <select data-status="${repair.id}">${renderStatusOptions(repair.status)}</select>
      <button class="ghost" data-delete="${repair.id}">删除</button>
    `;
  }
  if (batch.status === "created") {
    return `<span class="lock-hint">已加入批次，待批次开工</span>`;
  }
  if (repair.status === "todo") {
    return `<button class="ghost small" data-start-item="${repair.id}">开工</button><span class="lock-hint">已纳入${escapeHtml(batch.name)}</span>`;
  }
  if (repair.status === "doing") {
    return `
      <button class="primary small" data-complete="${repair.id}">完工</button>
      <span class="lock-hint">${batch.status === "cancelled" ? "批次已取消，事项继续保留" : "完工需确认实际费用"}</span>
    `;
  }
  return `<span class="lock-hint">已在${escapeHtml(batch.name)}内完工</span>`;
}

function renderCompleteModal() {
  const repair = state.repairs.find((item) => item.id === ui.completingId);
  if (!repair) return "";
  const batch = getBatch(repair.batchId);
  if (!batch) return "";
  const spent = batchItems(batch.id)
    .filter((item) => item.status === "done" && item.id !== repair.id)
    .reduce((total, item) => total + Number(item.actualCost || 0), 0);
  const draftActual = Number(ui.completeDraft.actual || 0);
  const after = spent + draftActual;
  const over = after > batch.budget;

  return `
    <div class="modal-mask" data-modal-close>
      <form class="modal" id="complete-form" data-repair-id="${repair.id}">
        <h3>确认完工实际费用</h3>
        <p class="muted">${escapeHtml(repair.location)} · ${escapeHtml(repair.title)}（${escapeHtml(batch.name)}）</p>
        <div class="batch-summary ${over ? "over" : ""}">
          <span>批次预算 <strong>¥${batch.budget}</strong></span>
          <span>已确认实际 <strong>¥${spent}</strong></span>
          <span>填写后合计 <strong id="complete-after">¥${after}</strong></span>
        </div>
        <label>实际费用（元）<input name="actualCost" type="number" min="0" step="1" required value="${escapeHtml(ui.completeDraft.actual)}" placeholder="请输入实际费用"></label>
        <label>超支原因<textarea name="overrunReason" placeholder="实际费用合计超过批次预算时必填">${escapeHtml(ui.completeDraft.reason)}</textarea></label>
        <p class="muted small" id="complete-hint">${over ? "实际合计已超过批次预算，请填写超支原因后再完工。" : "实际合计未超过批次预算，超支原因可留空。"}</p>
        ${ui.completeError ? `<p class="form-error">${escapeHtml(ui.completeError)}</p>` : ""}
        <div class="actions">
          <button class="primary" type="submit">确认完工</button>
          <button class="ghost" type="button" data-cancel-complete>取消</button>
        </div>
      </form>
    </div>
  `;
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
  const repairForm = document.querySelector("#repair-form");
  repairForm.addEventListener("submit", (event) => {
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
      note: data.note.trim()
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

  bindBatchEvents();
  bindCompleteEvents();

  document.querySelectorAll("[data-start-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const repair = state.repairs.find((item) => item.id === button.dataset.startItem);
      if (repair && repair.status === "todo") {
        repair.status = "doing";
        saveState();
        render();
      }
    });
  });
}

function bindBatchEvents() {
  const batchForm = document.querySelector("#batch-form");
  if (!batchForm) return;

  const budgetInput = batchForm.querySelector('[name="budget"]');
  const checkboxes = () => [...batchForm.querySelectorAll('[name="batchItem"]')];
  const syncDraft = () => {
    ui.batchDraft.budget = budgetInput.value;
    ui.batchDraft.ids = checkboxes()
      .filter((box) => box.checked)
      .map((box) => box.value);
    const sum = checkboxes()
      .filter((box) => box.checked)
      .reduce((total, box) => total + Number(box.dataset.cost || 0), 0);
    const budget = Number(budgetInput.value || 0);
    const sumNode = document.querySelector("#batch-sum");
    const remainNode = document.querySelector("#batch-remain");
    if (sumNode) {
      sumNode.textContent = `¥${sum}`;
      sumNode.parentElement.parentElement.classList.toggle("over", sum > budget);
    }
    if (remainNode) remainNode.textContent = `¥${budget - sum}`;
  };
  budgetInput.addEventListener("input", syncDraft);
  checkboxes().forEach((box) => box.addEventListener("change", syncDraft));

  batchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const budget = Number(budgetInput.value || 0);
    const selectedIds = checkboxes()
      .filter((box) => box.checked)
      .map((box) => box.value);
    const items = eligibleRepairs().filter((repair) => selectedIds.includes(repair.id));

    if (!items.length) {
      ui.batchError = "请至少勾选一个未完成事项。";
      render();
      return;
    }
    const sum = items.reduce((total, repair) => total + Number(repair.cost || 0), 0);
    if (sum > budget) {
      // 整批拒绝：不创建批次、不改动任何事项状态
      ui.batchError = `合计预计费用 ¥${sum} 超过总预算 ¥${budget}，整批拒绝，事项状态与批次均未改动。`;
      render();
      return;
    }

    const batch = {
      id: crypto.randomUUID(),
      name: `批次 ${String(state.batches.length + 1).padStart(2, "0")}`,
      budget,
      status: "created",
      createdAt: Date.now()
    };
    state.batches.push(batch);
    items.forEach((repair) => {
      repair.batchId = batch.id;
    });
    ui.batchError = "";
    ui.batchDraft = { budget: "", ids: [] };
    saveState();
    render();
  });

  document.querySelectorAll("[data-batch-start]").forEach((button) => {
    button.addEventListener("click", () => {
      const batch = getBatch(button.dataset.batchStart);
      if (!batch || batch.status !== "created") return;
      batch.status = "started";
      batchItems(batch.id).forEach((repair) => {
        if (repair.status === "todo") repair.status = "doing";
      });
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-batch-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      const batch = getBatch(button.dataset.batchCancel);
      if (!batch || (batch.status !== "created" && batch.status !== "started")) return;
      if (!window.confirm(`确定取消${batch.name}？未开工事项将被释放，已开工事项继续保留。`)) return;
      batch.status = "cancelled";
      batchItems(batch.id).forEach((repair) => {
        if (repair.status === "todo") repair.batchId = undefined;
      });
      saveState();
      render();
    });
  });
}

function bindCompleteEvents() {
  document.querySelectorAll("[data-complete]").forEach((button) => {
    button.addEventListener("click", () => {
      const repair = state.repairs.find((item) => item.id === button.dataset.complete);
      if (!repair || repair.status !== "doing") return;
      ui.completingId = repair.id;
      ui.completeError = "";
      ui.completeDraft = { actual: repair.actualCost != null ? String(repair.actualCost) : "", reason: repair.overrunReason || "" };
      render();
    });
  });

  const mask = document.querySelector("[data-modal-close]");
  if (mask) {
    mask.addEventListener("mousedown", (event) => {
      if (event.target === mask) closeCompleteModal();
    });
  }

  const cancelButton = document.querySelector("[data-cancel-complete]");
  if (cancelButton) cancelButton.addEventListener("click", closeCompleteModal);

  const form = document.querySelector("#complete-form");
  if (!form) return;
  const actualInput = form.querySelector('[name="actualCost"]');
  const reasonInput = form.querySelector('[name="overrunReason"]');

  const syncHint = () => {
    ui.completeDraft.actual = actualInput.value;
    const repair = state.repairs.find((item) => item.id === form.dataset.repairId);
    const batch = getBatch(repair?.batchId);
    if (!repair || !batch) return;
    const spent = batchItems(batch.id)
      .filter((item) => item.status === "done" && item.id !== repair.id)
      .reduce((total, item) => total + Number(item.actualCost || 0), 0);
    const after = spent + Number(actualInput.value || 0);
    const over = after > batch.budget;
    const afterNode = document.querySelector("#complete-after");
    const hintNode = document.querySelector("#complete-hint");
    if (afterNode) afterNode.textContent = `¥${after}`;
    const summary = document.querySelector("#complete-form .batch-summary");
    if (summary) summary.classList.toggle("over", over);
    if (hintNode) hintNode.textContent = over ? "实际合计已超过批次预算，请填写超支原因后再完工。" : "实际合计未超过批次预算，超支原因可留空。";
  };
  actualInput.addEventListener("input", syncHint);
  reasonInput.addEventListener("input", () => {
    ui.completeDraft.reason = reasonInput.value;
  });
  setTimeout(() => actualInput.focus(), 0);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const repair = state.repairs.find((item) => item.id === form.dataset.repairId);
    if (!repair) return;
    const batch = getBatch(repair.batchId);
    if (!batch) return;
    const actual = Number(actualInput.value);
    const reason = reasonInput.value.trim();

    if (!Number.isFinite(actual) || actual < 0 || actualInput.value === "") {
      ui.completeError = "请填写不小于 0 的实际费用。";
      render();
      return;
    }

    const spent = batchItems(batch.id)
      .filter((item) => item.status === "done" && item.id !== repair.id)
      .reduce((total, item) => total + Number(item.actualCost || 0), 0);
    if (spent + actual > batch.budget && !reason) {
      ui.completeError = `实际费用合计 ¥${spent + actual} 超过批次预算 ¥${batch.budget}，请填写超支原因。`;
      render();
      return;
    }

    repair.status = "done";
    repair.actualCost = actual;
    repair.overrunReason = spent + actual > batch.budget ? reason : "";

    if (batch.status === "started" && batchItems(batch.id).every((item) => item.status === "done")) {
      batch.status = "done";
    }

    closeCompleteModal();
    saveState();
    render();
  });
}

function closeCompleteModal() {
  ui.completingId = null;
  ui.completeError = "";
  ui.completeDraft = { actual: "", reason: "" };
  render();
}

function filteredRepairs() {
  if (state.filter === "all") return state.repairs;
  return state.repairs.filter((repair) => repair.status === state.filter);
}

function eligibleRepairs() {
  return state.repairs.filter((repair) => repair.status !== "done" && !repair.batchId);
}

function getBatch(batchId) {
  if (!batchId) return undefined;
  return state.batches.find((batch) => batch.id === batchId);
}

function batchItems(batchId) {
  return state.repairs.filter((repair) => repair.batchId === batchId);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

render();
