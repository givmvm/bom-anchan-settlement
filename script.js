const PEOPLE = {
  bom: "ボム",
  anchan: "あんちゃん",
};

const STORAGE_KEY = "couple-ledger-expenses-v1";
const PASSWORD = "0809PS.";

const app = document.querySelector("#app");
const passwordGate = document.querySelector("#passwordGate");
const passwordForm = document.querySelector("#passwordForm");
const passwordInput = document.querySelector("#passwordInput");
const passwordError = document.querySelector("#passwordError");
const addExpenseButton = document.querySelector("#addExpense");
const expenseRows = document.querySelector("#expenseRows");
const mobileExpenseList = document.querySelector("#mobileExpenseList");
const totalSpent = document.querySelector("#totalSpent");
const quickSettlementAmount = document.querySelector("#quickSettlementAmount");
const quickSettlementText = document.querySelector("#quickSettlementText");
const bomPaid = document.querySelector("#bomPaid");
const anchanPaid = document.querySelector("#anchanPaid");
const bomShare = document.querySelector("#bomShare");
const anchanShare = document.querySelector("#anchanShare");
const bomBalance = document.querySelector("#bomBalance");
const anchanBalance = document.querySelector("#anchanBalance");
const bomDetail = document.querySelector("#bomDetail");
const anchanDetail = document.querySelector("#anchanDetail");
const settlement = document.querySelector("#settlement");
const deleteDialog = document.querySelector("#deleteDialog");
const deleteTarget = document.querySelector("#deleteTarget");
const cancelDeleteButton = document.querySelector("#cancelDelete");
const confirmDeleteButton = document.querySelector("#confirmDelete");
const roomCodeInput = document.querySelector("#roomCode");
const connectSyncButton = document.querySelector("#connectSync");
const syncNowButton = document.querySelector("#syncNow");
const syncStatus = document.querySelector("#syncStatus");
const addDialog = document.querySelector("#addDialog");
const addExpenseForm = document.querySelector("#addExpenseForm");
const expenseFormTitle = document.querySelector("#expenseFormTitle");
const cancelAddButton = document.querySelector("#cancelAdd");
const deleteFromFormButton = document.querySelector("#deleteFromForm");
const saveExpenseButton = document.querySelector("#saveExpense");
const newDateInput = document.querySelector("#newDate");
const newTitleInput = document.querySelector("#newTitle");
const newAmountInput = document.querySelector("#newAmount");
const newPayerInput = document.querySelector("#newPayer");
const newBomRatioInput = document.querySelector("#newBomRatio");
const newAnchanRatioInput = document.querySelector("#newAnchanRatio");

let nextExpenseId = 4;
let expenses = loadExpenses();
let pendingDeleteId = null;
let syncTimer = null;
let activeRoomCode = localStorage.getItem("couple-ledger-room-code") || "bom-anchan";
let lastCloudUpdatedAt = localStorage.getItem("couple-ledger-cloud-updated-at") || "";
let isApplyingRemote = false;
let editingExpenseId = null;

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatYen(value) {
  return yen.format(Math.round(value));
}

function formatShortDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value || "";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatMonthLabel(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "日付なし";
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function unlockApp() {
  passwordGate.classList.add("is-unlocked");
  app.classList.remove("is-locked");
  sessionStorage.setItem("couple-ledger-unlocked", "true");
}

function checkPassword(event) {
  event.preventDefault();

  if (passwordInput.value === PASSWORD) {
    passwordError.textContent = "";
    unlockApp();
    return;
  }

  passwordError.textContent = "パスワードが違います。";
  passwordInput.select();
}

function extractExpenseNumber(id) {
  const match = String(id || "").match(/\d+$/);
  return match ? Number(match[0]) : 0;
}

function createExpenseId() {
  return `expense-${nextExpenseId++}`;
}

function sortExpenses(rows) {
  return [...rows].sort((a, b) => {
    const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
    if (dateCompare !== 0) return dateCompare;
    return extractExpenseNumber(b.id) - extractExpenseNumber(a.id);
  });
}

function defaultExpenses() {
  return [
    { id: "expense-1", date: today(), title: "ランチ", amount: 3200, payer: "bom", bomRatio: 50, anchanRatio: 50 },
    { id: "expense-2", date: today(), title: "スーパー", amount: 5800, payer: "anchan", bomRatio: 60, anchanRatio: 40 },
    { id: "expense-3", date: today(), title: "映画", amount: 4000, payer: "bom", bomRatio: 50, anchanRatio: 50 },
  ];
}

function loadExpenses() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultExpenses();

  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return defaultExpenses();
    const normalized = parsed.map((expense, index) => {
      const bomRatio = clamp(toNumber(expense.bomRatio), 0, 100);
      return {
        id: expense.id || `expense-${index + 1}`,
        date: expense.date || today(),
        title: expense.title || "",
        amount: Math.max(0, toNumber(expense.amount)),
        payer: expense.payer === "anchan" ? "anchan" : "bom",
        bomRatio,
        anchanRatio: 100 - bomRatio,
      };
    });
    nextExpenseId = Math.max(...normalized.map((expense) => extractExpenseNumber(expense.id)), 0) + 1;
    return normalized;
  } catch {
    return defaultExpenses();
  }
}

function saveExpenses() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
  queueCloudSave();
}

function normalizeRoomCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getSyncConfig() {
  return window.COUPLE_LEDGER_SYNC || {};
}

function isSyncConfigured() {
  const config = getSyncConfig();
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

function setSyncStatus(message, state = "") {
  syncStatus.textContent = message;
  syncStatus.className = `sync-status ${state}`.trim();
}

function supabaseEndpoint(roomCode) {
  const config = getSyncConfig();
  const baseUrl = config.supabaseUrl.replace(/\/$/, "");
  return `${baseUrl}/rest/v1/ledgers?room_code=eq.${encodeURIComponent(roomCode)}`;
}

function supabaseHeaders(prefer) {
  const config = getSyncConfig();
  const headers = {
    apikey: config.supabaseAnonKey,
    Authorization: `Bearer ${config.supabaseAnonKey}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function loadCloudLedger(roomCode) {
  const response = await fetch(supabaseEndpoint(roomCode), {
    headers: supabaseHeaders(),
  });
  if (!response.ok) throw new Error("クラウドから読み込めませんでした。");
  const rows = await response.json();
  return rows[0] || null;
}

async function saveCloudLedger(roomCode) {
  if (!isSyncConfigured() || isApplyingRemote || !roomCode) return;

  const now = new Date().toISOString();
  const response = await fetch(supabaseEndpoint(roomCode), {
    method: "POST",
    headers: supabaseHeaders("resolution=merge-duplicates"),
    body: JSON.stringify({
      room_code: roomCode,
      data: expenses,
      updated_at: now,
    }),
  });

  if (!response.ok) throw new Error("クラウドへ保存できませんでした。");
  lastCloudUpdatedAt = now;
  localStorage.setItem("couple-ledger-cloud-updated-at", lastCloudUpdatedAt);
  setSyncStatus(`同期済み: ${new Date(now).toLocaleString("ja-JP")}`, "ok");
}

function queueCloudSave() {
  if (!isSyncConfigured() || isApplyingRemote || !activeRoomCode) return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    saveCloudLedger(activeRoomCode).catch((error) => setSyncStatus(error.message, "warn"));
  }, 700);
}

function applyRemoteExpenses(remoteExpenses, updatedAt) {
  if (!Array.isArray(remoteExpenses)) return;
  isApplyingRemote = true;
  expenses = remoteExpenses.map((expense, index) => {
    const bomRatio = clamp(toNumber(expense.bomRatio), 0, 100);
    return {
      id: expense.id || `expense-${index + 1}`,
      date: expense.date || today(),
      title: expense.title || "",
      amount: Math.max(0, toNumber(expense.amount)),
      payer: expense.payer === "anchan" ? "anchan" : "bom",
      bomRatio,
      anchanRatio: 100 - bomRatio,
    };
  });
  nextExpenseId = Math.max(...expenses.map((expense) => extractExpenseNumber(expense.id)), 0) + 1;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
  lastCloudUpdatedAt = updatedAt || "";
  localStorage.setItem("couple-ledger-cloud-updated-at", lastCloudUpdatedAt);
  render();
  isApplyingRemote = false;
}

async function syncWithCloud({ forcePush = false } = {}) {
  if (!isSyncConfigured()) {
    setSyncStatus("クラウド設定がまだありません。Supabase設定を入れると同期できます。", "warn");
    return;
  }

  const roomCode = normalizeRoomCode(roomCodeInput.value);
  if (!roomCode) {
    setSyncStatus("共有コードを入れてください。", "warn");
    return;
  }

  activeRoomCode = roomCode;
  roomCodeInput.value = roomCode;
  localStorage.setItem("couple-ledger-room-code", roomCode);
  setSyncStatus("同期中です...", "");

  const cloudLedger = await loadCloudLedger(roomCode);
  if (!cloudLedger || forcePush) {
    await saveCloudLedger(roomCode);
    return;
  }

  const cloudUpdatedAt = cloudLedger.updated_at || "";
  if (cloudUpdatedAt && cloudUpdatedAt !== lastCloudUpdatedAt) {
    applyRemoteExpenses(cloudLedger.data, cloudUpdatedAt);
    setSyncStatus(`クラウドから読み込みました: ${new Date(cloudUpdatedAt).toLocaleString("ja-JP")}`, "ok");
    return;
  }

  await saveCloudLedger(roomCode);
}

function startAutoSync() {
  window.setInterval(() => {
    syncWithCloud().catch((error) => setSyncStatus(error.message, "warn"));
  }, 8000);
}

function calculateExpense(expense) {
  const bomRate = expense.bomRatio / 100;
  const anchanRate = expense.anchanRatio / 100;

  return {
    ...expense,
    bomCost: expense.amount * bomRate,
    anchanCost: expense.amount * anchanRate,
    ratioOk: true,
  };
}

function calculateTotals(rows) {
  return rows.reduce(
    (totals, expense) => {
      totals.spent += expense.amount;
      totals.bomPaid += expense.payer === "bom" ? expense.amount : 0;
      totals.anchanPaid += expense.payer === "anchan" ? expense.amount : 0;
      totals.bomShare += expense.bomCost;
      totals.anchanShare += expense.anchanCost;
      totals.invalidRatios += expense.ratioOk ? 0 : 1;
      return totals;
    },
    {
      spent: 0,
      bomPaid: 0,
      anchanPaid: 0,
      bomShare: 0,
      anchanShare: 0,
      invalidRatios: 0,
    }
  );
}

function updateExpense(id, key, value) {
  const shouldResort = key === "date";
  expenses = expenses.map((expense) => {
    if (expense.id !== id) return expense;

    const next = { ...expense };
    if (key === "amount") next.amount = Math.max(0, toNumber(value));
    if (key === "bomRatio") {
      next.bomRatio = clamp(toNumber(value), 0, 100);
      next.anchanRatio = 100 - next.bomRatio;
    }
    if (key === "anchanRatio") {
      next.anchanRatio = clamp(toNumber(value), 0, 100);
      next.bomRatio = 100 - next.anchanRatio;
    }
    if (key === "date") next.date = value;
    if (key === "title") next.title = value;
    if (key === "payer") next.payer = value === "anchan" ? "anchan" : "bom";
    return next;
  });

  saveExpenses();
  if (shouldResort) {
    render();
    return;
  }
  updateLiveRow(id);
  renderSummary();
}

function addExpense(expense) {
  expenses = [
    ...expenses,
    expense,
  ];

  saveExpenses();
  render();
}

function resetAddForm() {
  addExpenseForm.reset();
  editingExpenseId = null;
  expenseFormTitle.textContent = "支出の詳細を入力";
  saveExpenseButton.textContent = "登録";
  deleteFromFormButton.classList.add("is-hidden");
  newDateInput.value = today();
  newBomRatioInput.value = "50";
  newAnchanRatioInput.value = "50";
}

function openAddDialog() {
  resetAddForm();

  if (typeof addDialog.showModal === "function") {
    addDialog.showModal();
    newTitleInput.focus();
    return;
  }

  addDialog.setAttribute("open", "");
  newTitleInput.focus();
}

function closeAddDialog() {
  if (typeof addDialog.close === "function") {
    addDialog.close();
    return;
  }

  addDialog.removeAttribute("open");
}

function fillExpenseForm(expense) {
  newDateInput.value = expense.date || today();
  newTitleInput.value = expense.title || "";
  newAmountInput.value = Math.max(0, toNumber(expense.amount));
  newPayerInput.value = expense.payer === "anchan" ? "anchan" : "bom";
  newBomRatioInput.value = clamp(toNumber(expense.bomRatio), 0, 100);
  newAnchanRatioInput.value = 100 - clamp(toNumber(expense.bomRatio), 0, 100);
}

function openEditDialog(id) {
  const expense = getExpense(id);
  if (!expense) return;

  editingExpenseId = id;
  expenseFormTitle.textContent = "支出の詳細を編集";
  saveExpenseButton.textContent = "保存";
  deleteFromFormButton.classList.remove("is-hidden");
  fillExpenseForm(expense);

  if (typeof addDialog.showModal === "function") {
    addDialog.showModal();
    newTitleInput.focus();
    return;
  }

  addDialog.setAttribute("open", "");
  newTitleInput.focus();
}

function syncNewRatios(changedKey) {
  if (changedKey === "bom") {
    const bomRatio = clamp(toNumber(newBomRatioInput.value), 0, 100);
    newBomRatioInput.value = bomRatio;
    newAnchanRatioInput.value = 100 - bomRatio;
    return;
  }

  const anchanRatio = clamp(toNumber(newAnchanRatioInput.value), 0, 100);
  newAnchanRatioInput.value = anchanRatio;
  newBomRatioInput.value = 100 - anchanRatio;
}

function registerExpense(event) {
  event.preventDefault();

  if (!addExpenseForm.reportValidity()) return;

  const bomRatio = clamp(toNumber(newBomRatioInput.value), 0, 100);
  const nextExpense = {
    id: editingExpenseId || createExpenseId(),
    date: newDateInput.value || today(),
    title: newTitleInput.value.trim(),
    amount: Math.max(0, toNumber(newAmountInput.value)),
    payer: newPayerInput.value === "anchan" ? "anchan" : "bom",
    bomRatio,
    anchanRatio: 100 - bomRatio,
  };

  if (editingExpenseId) {
    expenses = expenses.map((expense) => (expense.id === editingExpenseId ? nextExpense : expense));
    saveExpenses();
    render();
  } else {
    addExpense(nextExpense);
  }

  closeAddDialog();
}

function removeExpense(id) {
  expenses = expenses.filter((expense) => expense.id !== id);
  saveExpenses();
  render();
}

function requestDeleteExpense(id) {
  const expense = getExpense(id);
  pendingDeleteId = id;
  deleteTarget.textContent = expense?.title
    ? `「${expense.title}」の支出を削除します。`
    : "この支出を削除します。";

  if (typeof deleteDialog.showModal === "function") {
    deleteDialog.showModal();
    return;
  }

  if (window.confirm("本当に削除してもよろしいですか？")) {
    removeExpense(id);
  }
}

function closeDeleteDialog() {
  pendingDeleteId = null;
  deleteDialog.close();
}

function confirmDeleteExpense() {
  if (pendingDeleteId) {
    removeExpense(pendingDeleteId);
  }
  closeDeleteDialog();
}

function deleteEditingExpense() {
  if (!editingExpenseId) return;
  const id = editingExpenseId;
  closeAddDialog();
  requestDeleteExpense(id);
}

function createInput(type, value, label, id, key) {
  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  input.ariaLabel = label;
  input.dataset.id = id;
  input.dataset.key = key;

  if (type === "number") {
    input.min = "0";
    input.step = key.includes("Ratio") ? "1" : "1";
    input.inputMode = "decimal";
  }

  input.addEventListener("input", (event) => updateExpense(id, key, event.target.value));
  return input;
}

function createRatioInput(value, label, id, key) {
  const wrap = document.createElement("div");
  const input = createInput("number", value, label, id, key);
  const suffix = document.createElement("span");

  wrap.className = "percent-input";
  suffix.textContent = "%";
  input.max = "100";
  wrap.append(input, suffix);
  return wrap;
}

function createPayerSelect(value, id) {
  const select = document.createElement("select");
  select.ariaLabel = "払った人";
  select.dataset.id = id;
  select.dataset.key = "payer";

  for (const [key, name] of Object.entries(PEOPLE)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = name;
    option.selected = value === key;
    select.appendChild(option);
  }

  select.addEventListener("change", (event) => updateExpense(id, "payer", event.target.value));
  return select;
}

function renderRows(rows) {
  const activeElement = document.activeElement;
  const activeId = activeElement?.dataset?.id;
  const activeKey = activeElement?.dataset?.key;

  expenseRows.innerHTML = "";

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 9;
    td.className = "empty-row";
    td.textContent = "まだ支出がありません。支出を追加してください。";
    tr.appendChild(td);
    expenseRows.appendChild(tr);
    return;
  }

  for (const expense of rows) {
    const tr = document.createElement("tr");
    if (!expense.ratioOk) tr.className = "row-warn";

    const dateCell = document.createElement("td");
    const titleCell = document.createElement("td");
    const amountCell = document.createElement("td");
    const payerCell = document.createElement("td");
    const bomRatioCell = document.createElement("td");
    const anchanRatioCell = document.createElement("td");
    const bomCostCell = document.createElement("td");
    const anchanCostCell = document.createElement("td");
    const actionCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    const labeledCells = [
      [dateCell, "日にち"],
      [titleCell, "何に使ったか"],
      [amountCell, "金額"],
      [payerCell, "払った人"],
      [bomRatioCell, "ボム負担割合"],
      [anchanRatioCell, "あんちゃん負担割合"],
      [bomCostCell, "ボム負担額"],
      [anchanCostCell, "あんちゃん負担額"],
      [actionCell, ""],
    ];

    dateCell.appendChild(createInput("date", expense.date, "日にち", expense.id, "date"));
    titleCell.appendChild(createInput("text", expense.title, "何に使ったか", expense.id, "title"));
    amountCell.appendChild(createInput("number", expense.amount, "金額", expense.id, "amount"));
    payerCell.appendChild(createPayerSelect(expense.payer, expense.id));
    bomRatioCell.appendChild(createRatioInput(expense.bomRatio, "ボム負担割合", expense.id, "bomRatio"));
    anchanRatioCell.appendChild(createRatioInput(expense.anchanRatio, "あんちゃん負担割合", expense.id, "anchanRatio"));

    bomCostCell.className = "amount";
    bomCostCell.dataset.id = expense.id;
    bomCostCell.dataset.key = "bomCost";
    bomCostCell.textContent = formatYen(expense.bomCost);
    anchanCostCell.className = "amount";
    anchanCostCell.dataset.id = expense.id;
    anchanCostCell.dataset.key = "anchanCost";
    anchanCostCell.textContent = formatYen(expense.anchanCost);

    deleteButton.className = "delete";
    deleteButton.type = "button";
    deleteButton.textContent = "×";
    deleteButton.ariaLabel = "支出を削除";
    deleteButton.addEventListener("click", () => requestDeleteExpense(expense.id));
    actionCell.appendChild(deleteButton);

    for (const [cell, label] of labeledCells) {
      cell.dataset.label = label;
    }

    tr.append(
      dateCell,
      titleCell,
      amountCell,
      payerCell,
      bomRatioCell,
      anchanRatioCell,
      bomCostCell,
      anchanCostCell,
      actionCell
    );
    expenseRows.appendChild(tr);
  }

  if (activeId && activeKey) {
    const nextActive = expenseRows.querySelector(`[data-id="${activeId}"][data-key="${activeKey}"]`);
    nextActive?.focus();
  }
}

function renderMobileList(rows) {
  mobileExpenseList.innerHTML = "";

  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "mobile-empty";
    empty.textContent = "まだ支出がありません。";
    mobileExpenseList.appendChild(empty);
    return;
  }

  let currentMonth = "";

  for (const expense of rows) {
    const month = formatMonthLabel(expense.date);
    if (month !== currentMonth) {
      currentMonth = month;
      const monthHeader = document.createElement("div");
      monthHeader.className = "mobile-month";
      monthHeader.textContent = month;
      mobileExpenseList.appendChild(monthHeader);
    }

    const button = document.createElement("button");
    const date = document.createElement("span");
    const title = document.createElement("span");
    const amount = document.createElement("span");
    const arrow = document.createElement("span");

    button.type = "button";
    button.className = "mobile-expense-button";
    button.addEventListener("click", () => openEditDialog(expense.id));
    date.className = "mobile-date";
    title.className = "mobile-title";
    amount.className = "mobile-amount";
    arrow.className = "mobile-arrow";

    date.textContent = formatShortDate(expense.date);
    title.textContent = expense.title || "未入力";
    amount.textContent = formatYen(expense.amount);
    arrow.textContent = "›";

    button.append(date, title, amount, arrow);
    mobileExpenseList.appendChild(button);
  }
}

function getExpense(id) {
  return expenses.find((expense) => expense.id === id);
}

function updateLiveRow(id) {
  const expense = getExpense(id);
  if (!expense) return;

  const row = calculateExpense(expense);
  const bomRatioInput = expenseRows.querySelector(`[data-id="${id}"][data-key="bomRatio"]`);
  const anchanRatioInput = expenseRows.querySelector(`[data-id="${id}"][data-key="anchanRatio"]`);
  const bomCostCell = expenseRows.querySelector(`[data-id="${id}"][data-key="bomCost"]`);
  const anchanCostCell = expenseRows.querySelector(`[data-id="${id}"][data-key="anchanCost"]`);

  if (document.activeElement !== bomRatioInput) bomRatioInput.value = row.bomRatio;
  if (document.activeElement !== anchanRatioInput) anchanRatioInput.value = row.anchanRatio;
  bomCostCell.textContent = formatYen(row.bomCost);
  anchanCostCell.textContent = formatYen(row.anchanCost);
}

function setBalance(element, detailElement, balance) {
  element.textContent = formatYen(Math.abs(balance));
  element.className = balance >= 0 ? "positive" : "negative";

  if (Math.abs(balance) <= 0.5) {
    element.textContent = "0円";
    element.className = "";
    detailElement.textContent = "過不足なし";
    return;
  }

  detailElement.textContent = balance > 0 ? "多く払っている" : "不足している";
}

function renderSettlement(bomDiff, invalidRatios) {
  settlement.innerHTML = "";
  quickSettlementAmount.className = "";

  if (invalidRatios > 0) {
    settlement.className = "settlement-box warn";
    settlement.textContent = `負担割合が100%ではない行が${invalidRatios}件あります。割合を確認してください。`;
    quickSettlementAmount.textContent = "確認";
    quickSettlementText.textContent = "負担割合を確認";
    return;
  }

  settlement.className = "settlement-box";

  if (Math.abs(bomDiff) <= 0.5) {
    settlement.textContent = "今のところ精算は不要です。";
    quickSettlementAmount.textContent = "0円";
    quickSettlementText.textContent = "精算は不要です";
    return;
  }

  const from = bomDiff > 0 ? PEOPLE.anchan : PEOPLE.bom;
  const to = bomDiff > 0 ? PEOPLE.bom : PEOPLE.anchan;
  const amount = formatYen(Math.abs(bomDiff));
  settlement.textContent = `${from} が ${to} に ${amount} 支払う`;
  quickSettlementAmount.textContent = amount;
  quickSettlementAmount.className = bomDiff > 0 ? "positive" : "negative";
  quickSettlementText.textContent = `${from} が ${to} に支払う`;
}

function renderSummary() {
  const rows = expenses.map(calculateExpense);
  const totals = calculateTotals(rows);
  const bomDiff = totals.bomPaid - totals.bomShare;
  const anchanDiff = totals.anchanPaid - totals.anchanShare;

  totalSpent.textContent = formatYen(totals.spent);
  bomPaid.textContent = formatYen(totals.bomPaid);
  anchanPaid.textContent = formatYen(totals.anchanPaid);
  bomShare.textContent = formatYen(totals.bomShare);
  anchanShare.textContent = formatYen(totals.anchanShare);

  setBalance(bomBalance, bomDetail, bomDiff);
  setBalance(anchanBalance, anchanDetail, anchanDiff);
  renderSettlement(bomDiff, totals.invalidRatios);
}

function render() {
  const rows = sortExpenses(expenses.map(calculateExpense));
  renderRows(rows);
  renderMobileList(rows);
  renderSummary();
}

addExpenseButton.addEventListener("click", openAddDialog);
passwordForm.addEventListener("submit", checkPassword);
addExpenseForm.addEventListener("submit", registerExpense);
cancelAddButton.addEventListener("click", closeAddDialog);
deleteFromFormButton.addEventListener("click", deleteEditingExpense);
addDialog.addEventListener("click", (event) => {
  if (event.target === addDialog) closeAddDialog();
});
newBomRatioInput.addEventListener("input", () => syncNewRatios("bom"));
newAnchanRatioInput.addEventListener("input", () => syncNewRatios("anchan"));
cancelDeleteButton.addEventListener("click", closeDeleteDialog);
confirmDeleteButton.addEventListener("click", confirmDeleteExpense);
deleteDialog.addEventListener("click", (event) => {
  if (event.target === deleteDialog) closeDeleteDialog();
});
connectSyncButton.addEventListener("click", () => {
  syncWithCloud({ forcePush: false }).catch((error) => setSyncStatus(error.message, "warn"));
});
syncNowButton.addEventListener("click", () => {
  syncWithCloud().catch((error) => setSyncStatus(error.message, "warn"));
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

roomCodeInput.value = activeRoomCode;
if (sessionStorage.getItem("couple-ledger-unlocked") === "true") {
  unlockApp();
} else {
  passwordInput.focus();
}

if (isSyncConfigured()) {
  setSyncStatus("共有コードを確認して「同期する」を押してください。");
  startAutoSync();
} else {
  setSyncStatus("クラウド設定がまだありません。設定後に同期できます。", "warn");
}

render();
