import { JSDOM } from "jsdom";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div></body></html>`, { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.confirm = () => true;
window.confirm = () => true;

// jsdom 不支持在合成 submit 事件中 new FormData(form)，用等价实现替代
const NativeFormData = window.FormData;
window.FormData = class FormData extends NativeFormData {
  constructor(form) {
    super();
    if (form && form.elements) {
      [...form.elements].forEach((el) => {
        if (!el.name || el.disabled) return;
        if ((el.type === "checkbox" || el.type === "radio") && !el.checked) return;
        this.append(el.name, el.value);
      });
    }
  }
};
globalThis.FormData = window.FormData;

const source = readFileSync("src/main.js", "utf8").replace('import "./styles.css";', "");
const tmpPath = "/tmp/app-under-test.js";
writeFileSync(tmpPath, source);

async function loadApp() {
  return import(pathToFileURL(tmpPath).href + `?v=${Date.now()}-${Math.random()}`);
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const setValue = (el, value) => {
  el.value = value;
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const click = (el) => el.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));

function state() {
  return JSON.parse(localStorage.getItem("zfl-14-repairs"));
}

async function submitBatch(budget, idxs) {
  setValue($('#batch-form [name="budget"]'), budget);
  const boxes = $$('#batch-form [name="batchItem"]');
  boxes.forEach((box, i) => {
    box.checked = idxs.includes(i);
    box.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  $("#batch-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}

await loadApp();

// 1. 创建批次：260 的事项，预算 200，整批拒绝
await submitBatch(200, [0]);
assert.match($("#batch-error").textContent, /整批拒绝/);
assert.equal(localStorage.getItem("zfl-14-repairs"), null, "拒绝时不落盘任何数据");
assert.equal($$(".batch-card").length, 0);
assert.match($(".repair .status.todo") !== null ? "todo" : "", /todo/);
console.log("✔ 合计预计超过预算 -> 整批拒绝，状态与批次不变");

// 2. 预算 300 创建成功
await submitBatch(300, [0]);
let saved = state();
assert.equal(saved.batches.length, 1);
assert.equal(saved.batches[0].status, "created");
assert.equal(saved.repairs[0].batchId, saved.batches[0].id);
assert.equal(saved.repairs[0].status, "todo");
console.log("✔ 预算内创建批次成功，事项关联批次但未开工");

// 3. 开工 -> todo 自动转 doing
click($("[data-batch-start]"));
assert.equal(state().batches[0].status, "started");
assert.equal(state().repairs[0].status, "doing");
console.log("✔ 批次开工，事项进入处理中");

// 4. 完工：实际 350 > 预算 300，未填原因被阻止
click($("[data-complete]"));
setValue($('#complete-form [name="actualCost"]'), 350);
$("#complete-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
assert.match($("#complete-form .form-error").textContent, /超支原因/);
assert.equal(state().repairs[0].status, "doing");
console.log("✔ 实际费用超过预算且无超支原因 -> 阻止完工");

// 5. 填写超支原因后完工，批次自动闭环
setValue($('#complete-form [name="overrunReason"]'), "软管老化需整体更换");
$("#complete-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
saved = state();
assert.equal(saved.repairs[0].status, "done");
assert.equal(saved.repairs[0].actualCost, 350);
assert.equal(saved.repairs[0].overrunReason, "软管老化需整体更换");
assert.equal(saved.batches[0].status, "done");
console.log("✔ 填写超支原因后完工，实际费用与原因保留，批次自动完工");

// 6. 新增两个自由事项，用于取消批次测试
function addRepair(title, cost) {
  const form = $("#repair-form");
  form.querySelector('[name="location"]').value = "卫生间";
  form.querySelector('[name="title"]').value = title;
  form.querySelector('[name="cost"]').value = cost;
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}
addRepair("顶灯不亮", 100);
addRepair("地漏堵塞", 120);
assert.equal($$('#batch-form [name="batchItem"]').length, 2);
console.log("✔ 新增的未完成自由事项可被批次勾选");

// 7. 创建并开工，完工一项后取消：doing 保留、done 保留
await submitBatch(1000, [0, 1]);
saved = state();
const batch2 = saved.batches[1];
click($("[data-batch-start]"));
let [a, b] = state().repairs.filter((r) => r.batchId === batch2.id);
assert.equal(a.status, "doing");
assert.equal(b.status, "doing");

click($$("[data-complete]").find((el) => el.dataset.complete === a.id));
setValue($('#complete-form [name="actualCost"]'), 80);
$("#complete-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
assert.equal(state().repairs.find((r) => r.id === a.id).status, "done");

click($("[data-batch-cancel]"));
saved = state();
assert.equal(saved.batches[1].status, "cancelled");
assert.equal(saved.repairs.find((r) => r.id === a.id).batchId, batch2.id, "已完工事项保留在取消批次中");
assert.equal(saved.repairs.find((r) => r.id === b.id).batchId, batch2.id, "已开工事项继续保留");
assert.equal(saved.repairs.find((r) => r.id === b.id).status, "doing");
console.log("✔ 取消进行中批次：已完工与已开工事项均保留");

// 8. 保留的 doing 事项仍可完工
click($$("[data-complete]").find((el) => el.dataset.complete === b.id));
setValue($('#complete-form [name="actualCost"]'), 110);
$("#complete-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
assert.equal(state().repairs.find((r) => r.id === b.id).status, "done");
console.log("✔ 取消批次后保留的事项可继续完工");

// 9. 待开工批次取消 -> 释放 todo
addRepair("门锁松动", 90);
await submitBatch(500, [0]);
saved = state();
const batch3 = saved.batches[2];
assert.equal(saved.batches[2].status, "created");
click($("[data-batch-cancel]"));
saved = state();
assert.equal(saved.batches[2].status, "cancelled");
const lock = saved.repairs.find((r) => r.title === "门锁松动");
assert.equal(lock.batchId, undefined);
assert.equal(lock.status, "todo");
console.log("✔ 取消待开工批次：未开工事项被释放为自由事项");

// 10. 模拟刷新：重新加载模块，从 localStorage 恢复
await loadApp();
const restored = state();
assert.equal(restored.batches.length, 3);
assert.equal(restored.repairs.length, 4);
assert.match($(".batch-card.done h3").textContent, /批次 01/);
const doingCount = restored.repairs.filter((r) => r.status === "doing").length;
const unfinished = restored.repairs.filter((r) => r.status !== "done").length;
const expectedCost = restored.repairs.filter((r) => r.status !== "done").reduce((t, r) => t + r.cost, 0);
const stats = $$(".stat strong").map((el) => el.textContent);
assert.deepEqual(stats, [String(unfinished), String(doingCount), `¥${expectedCost}`]);
console.log("✔ 刷新后批次、事项、三项统计均从浏览器本地数据恢复");

console.log("\n全部闭环测试通过");
