const PEOPLE = {
  bom: "ボム",
  anchan: "あんちゃん",
};

const STORAGE_KEY = "couple-ledger-expenses-v1";
const PASSWORD = "0809";

const app = document.querySelector("#app");
const passwordGate = document.querySelector("#passwordGate");
const passwordForm = document.querySelector("#passwordForm");
const passwordInput = document.querySelector("#passwordInput");
const passwordError = document.querySelector("#passwordError");
const addExpenseButton = document.querySelector("#addExpense");
const expenseRows = document.querySelector("#expenseRows");
const mobileExpenseList = document.querySelector("#mobileExpenseList");
const spendingPeriodInput = document.querySelector("#spendingPeriod");
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
let ledgerState = null;
let syncInFlight = null;
let storageFailure = false;
const DEVICE_KEY = "couple-ledger-device-id-v2";
let deviceId = localStorage.getItem(DEVICE_KEY);
if (!deviceId) {
  deviceId = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, deviceId);
}
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

function monthKey(value) {
  return String(value || "").slice(0, 7);
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
  return `expense-${crypto.randomUUID()}`;
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
  if (!saved) return [];

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

function stateKey(room = activeRoomCode) {
  return `couple-ledger-state-v2:${room}`;
}

function initializeSyncState({ newRoom = false } = {}) {
  try {
    // Preserve the exact pre-migration payload before normalizing or syncing anything.
    const backupKey = `couple-ledger-original-v13:${activeRoomCode}`;
    if (localStorage.getItem(backupKey) === null) {
      localStorage.setItem(backupKey, JSON.stringify({
        expenses: localStorage.getItem(STORAGE_KEY),
        updatedAt: lastCloudUpdatedAt, roomCode: activeRoomCode,
      }));
    }
    const saved = localStorage.getItem(stateKey());
    if (saved) {
      ledgerState = JSON.parse(saved);
      if (ledgerState.version !== 2 || ledgerState.roomCode !== activeRoomCode) throw new Error("保存形式を確認してください。");
      ledgerState.records = LedgerSync.merge(ledgerState.records);
    } else {
      const raw = newRoom ? null : localStorage.getItem(STORAGE_KEY);
      ledgerState = { version: 2, roomCode: activeRoomCode,
        records: LedgerSync.merge(raw ? JSON.parse(raw) : []), dirty: Boolean(raw) };
    }
    persistState();
    expenses = LedgerSync.visible(ledgerState.records);
  } catch (error) {
    storageFailure = true;
    setSyncStatus(`保存データを保護するため同期を停止しました。バックアップを書き出してください。${error.message}`, "warn");
  }
}

function persistState() {
  try {
    // Write the complete state first; if quota is exhausted, never send volatile changes.
    localStorage.setItem(stateKey(), JSON.stringify(ledgerState));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(LedgerSync.visible(ledgerState.records)));
  } catch {
    storageFailure = true;
    throw new Error("端末の保存領域に書き込めません。画面を閉じずにバックアップを書き出してください。");
  }
}

function saveExpenses() {
  try {
    if (storageFailure || !ledgerState) throw new Error("同期を停止しています。先にバックアップを書き出してください。");
    const revised = LedgerSync.revise(ledgerState.records, expenses, deviceId);
    const stored = JSON.parse(localStorage.getItem(stateKey()) || "null");
    ledgerState.records = LedgerSync.merge(revised, stored ? stored.records : []);
    expenses = LedgerSync.visible(ledgerState.records);
    ledgerState.dirty = true;
    persistState();
    setSyncStatus("端末に保存しました。共有先への送信待ちです。", "warn");
    queueCloudSave();
  } catch (error) { setSyncStatus(error.message, "warn"); }
}

function exportBackup() {
  const saved = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith("couple-ledger-")) saved[key] = localStorage.getItem(key);
  }
  const payload = { version: 2, exportedAt: new Date().toISOString(),
    roomCode: activeRoomCode, expenses, state: ledgerState, saved };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `settlement-backup-${today()}-${deviceId.slice(0, 8)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
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
  const headers = { apikey: config.supabaseAnonKey, "Content-Type": "application/json" };
  // Publishable keys belong in apikey; only legacy JWT keys are Bearer tokens.
  if (config.supabaseAnonKey.startsWith("eyJ")) headers.Authorization = `Bearer ${config.supabaseAnonKey}`;
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function cloudRequest(url, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...options, cache: "no-store", signal: controller.signal });
    if (!response.ok) {
      if (response.status === 409) return { conflict: true };
      if ([401, 403].includes(response.status)) throw new Error("共有先のAPIキーまたはアクセス権限を確認してください。");
      if (response.status === 404) throw new Error("共有先のテーブルまたは接続先を確認してください。");
      throw new Error(`共有先でエラーが発生しました（HTTP ${response.status}）。`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError" || error instanceof TypeError) {
      throw new Error("共有先に接続できません。記録は端末内に保持しています。通信環境またはSupabaseの稼働状態を確認してください。");
    }
    throw error;
  } finally { window.clearTimeout(timeout); }
}

async function loadCloudLedger(roomCode) {
  const rows = await cloudRequest(`${supabaseEndpoint(roomCode)}&select=room_code,data,updated_at`, { headers: supabaseHeaders() });
  if (!Array.isArray(rows)) throw new Error("共有先から不正な応答がありました。同期を停止しました。");
  if (rows.length && (rows[0].room_code !== roomCode || typeof rows[0].updated_at !== "string")) {
    throw new Error("共有データを確認できません。同期を停止しました。");
  }
  return rows[0] || null;
}

async function saveCloudLedger(roomCode, records, previous) {
  // Compare-and-swap: a concurrent writer changes updated_at, causing zero rows
  // to be updated. Re-read and merge instead of overwriting their work.
  const now = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updated_at) + 1 : 0)).toISOString();
  const base = getSyncConfig().supabaseUrl.replace(/\/$/, "") + "/rest/v1/ledgers";
  const url = previous
    ? `${supabaseEndpoint(roomCode)}&updated_at=eq.${encodeURIComponent(previous.updated_at)}`
    : base;
  const result = await cloudRequest(url, {
    method: previous ? "PATCH" : "POST",
    headers: supabaseHeaders("return=representation"),
    body: JSON.stringify({ room_code: roomCode, data: records, updated_at: now }),
  });
  if (result.conflict || (Array.isArray(result) && result.length === 0)) return null;
  if (!Array.isArray(result) || result.length !== 1 || result[0].room_code !== roomCode) {
    throw new Error("共有先への保存を確認できません。端末の記録を保持しています。");
  }
  return result[0];
}

function queueCloudSave() {
  if (!isSyncConfigured() || storageFailure || !ledgerState) return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => requestSync(), 700);
}

function applyMergedRecords(records) {
  const changed = JSON.stringify(ledgerState.records) !== JSON.stringify(records);
  ledgerState.records = records;
  persistState();
  if (changed) {
    expenses = LedgerSync.visible(records);
    render();
  }
}

function preserveConflictingVersions(remote) {
  const local = new Map(ledgerState.records.map((row) => [row.id, row]));
  for (const row of remote) {
    const own = local.get(row.id);
    if (!own || own._rev === row._rev ||
        (LedgerSync.content(own) === LedgerSync.content(row) && own._deleted === row._deleted)) continue;
    const losing = own._rev < row._rev ? own : row;
    const key = `couple-ledger-conflict-v2:${activeRoomCode}:${losing.id}:${losing._rev}`;
    // Keep the replaced version locally, including in exported backups.
    if (localStorage.getItem(key) === null) {
      try { localStorage.setItem(key, JSON.stringify(losing)); }
      catch {
        storageFailure = true;
        throw new Error("競合した記録を保護する空き領域がありません。同期を停止しました。バックアップを書き出してください。");
      }
    }
  }
}

async function performSync(roomCode) {
  if (storageFailure || !ledgerState) return;
  setSyncStatus("同期中です…端末内の記録を保持しています。");
  for (let attempt = 0; attempt < 5; attempt++) {
    // Incorporate another tab's durable state before each attempt.
    const stored = JSON.parse(localStorage.getItem(stateKey()) || "null");
    if (stored) ledgerState.records = LedgerSync.merge(ledgerState.records, stored.records);
    const cloud = await loadCloudLedger(roomCode);
    const remote = cloud ? LedgerSync.merge(cloud.data) : [];
    preserveConflictingVersions(remote);
    const merged = LedgerSync.merge(remote, ledgerState.records);
    applyMergedRecords(merged);
    let saved = cloud;
    if (!cloud || JSON.stringify(remote) !== JSON.stringify(merged)) {
      saved = await saveCloudLedger(roomCode, merged, cloud);
      if (!saved) continue;
    }
    // Edits may have happened while the request was in flight. Never mark those sent.
    const current = JSON.parse(localStorage.getItem(stateKey()) || "null");
    const latest = LedgerSync.merge(ledgerState.records, current ? current.records : []);
    const all = LedgerSync.merge(merged, latest);
    ledgerState.dirty = JSON.stringify(all) !== JSON.stringify(merged);
    applyMergedRecords(all);
    lastCloudUpdatedAt = saved.updated_at;
    localStorage.setItem("couple-ledger-cloud-updated-at", lastCloudUpdatedAt);
    if (ledgerState.dirty) continue;
    setSyncStatus(`同期済み: ${new Date().toLocaleString("ja-JP")}（${expenses.length}件）`, "ok");
    return;
  }
  throw new Error("他の端末と同時に更新されています。記録を保持し、次回の同期で再試行します。");
}

async function syncWithCloud({ allowRoomChange = false } = {}) {
  if (storageFailure) return;
  if (!isSyncConfigured()) throw new Error("共有先の設定がありません。記録は端末内に保存しています。");
  const roomCode = allowRoomChange ? normalizeRoomCode(roomCodeInput.value) : activeRoomCode;
  if (!roomCode) throw new Error("共有コードを入れてください。");
  if (roomCode !== activeRoomCode) {
    if (syncInFlight) throw new Error("同期が終わってから共有コードを変更してください。");
    if (!window.confirm(`共有先を「${roomCode}」に切り替えますか？今の記録は「${activeRoomCode}」用として端末に保持し、新しい共有先には送信しません。`)) return;
    persistState();
    activeRoomCode = roomCode;
    localStorage.setItem("couple-ledger-room-code", roomCode);
    initializeSyncState({ newRoom: true });
    roomCodeInput.value = roomCode;
    render();
    if (storageFailure) return;
  }
  if (syncInFlight) return syncInFlight;
  syncInFlight = performSync(roomCode).finally(() => { syncInFlight = null; });
  return syncInFlight;
}

function requestSync() {
  return syncWithCloud().catch((error) => setSyncStatus(error.message, "warn"));
}

function startAutoSync() {
  requestSync();
  window.setInterval(() => {
    if (document.visibilityState !== "hidden") requestSync();
  }, 8000);
  window.addEventListener("online", requestSync);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestSync();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== stateKey() || !event.newValue || storageFailure) return;
    try {
      const other = JSON.parse(event.newValue);
      applyMergedRecords(LedgerSync.merge(ledgerState.records, other.records));
      requestSync();
    } catch (error) { setSyncStatus(error.message, "warn"); }
  });
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

function periodRows(rows) {
  const selectedPeriod = spendingPeriodInput.value;
  if (selectedPeriod === "all") return rows;
  return rows.filter((expense) => monthKey(expense.date) === selectedPeriod);
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
    const payer = document.createElement("span");
    const amount = document.createElement("span");
    const arrow = document.createElement("span");

    button.type = "button";
    button.className = "mobile-expense-button";
    button.addEventListener("click", () => openEditDialog(expense.id));
    date.className = "mobile-date";
    title.className = "mobile-title";
    payer.className = "mobile-payer";
    amount.className = "mobile-amount";
    arrow.className = "mobile-arrow";

    date.textContent = formatShortDate(expense.date);
    title.textContent = expense.title || "未入力";
    payer.textContent = PEOPLE[expense.payer] || "";
    amount.textContent = formatYen(expense.amount);
    arrow.textContent = "›";

    button.append(date, title, payer, amount, arrow);
    mobileExpenseList.appendChild(button);
  }
}

function renderSpendingPeriodOptions() {
  const selectedPeriod = spendingPeriodInput.value || "all";
  const months = [...new Set(expenses.map((expense) => monthKey(expense.date)).filter(Boolean))].sort().reverse();

  spendingPeriodInput.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "全体";
  spendingPeriodInput.appendChild(allOption);

  for (const month of months) {
    const option = document.createElement("option");
    option.value = month;
    option.textContent = formatMonthLabel(`${month}-01`);
    spendingPeriodInput.appendChild(option);
  }

  spendingPeriodInput.value = months.includes(selectedPeriod) ? selectedPeriod : "all";
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
  const displayTotals = calculateTotals(periodRows(rows));
  const bomDiff = totals.bomPaid - totals.bomShare;
  const anchanDiff = totals.anchanPaid - totals.anchanShare;

  totalSpent.textContent = formatYen(displayTotals.spent);
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
  renderSpendingPeriodOptions();
  renderRows(rows);
  renderMobileList(rows);
  renderSummary();
  const notice = document.querySelector("#recoveryNotice");
  const ids = expenses.map((row) => row._legacyId).filter(Boolean);
  const duplicates = new Set(ids).size !== ids.length;
  let conflicts = false;
  for (let i = 0; i < localStorage.length; i++) {
    if (localStorage.key(i).startsWith(`couple-ledger-conflict-v2:${activeRoomCode}:`)) conflicts = true;
  }
  notice.textContent = duplicates
    ? "復旧した支出に、同じ記録か判断できないものがあります。両方残しているため、一覧に重複がないか確認してください。"
    : conflicts ? "更新前の記録もバックアップ内に保持しています。必要な場合は「バックアップを書き出す」で保存できます。" : "";
}

addExpenseButton.addEventListener("click", openAddDialog);
spendingPeriodInput.addEventListener("change", renderSummary);
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
  syncWithCloud({ allowRoomChange: true }).catch((error) => setSyncStatus(error.message, "warn"));
});
syncNowButton.addEventListener("click", () => {
  syncWithCloud().catch((error) => setSyncStatus(error.message, "warn"));
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

roomCodeInput.value = activeRoomCode;
initializeSyncState();
document.querySelector("#exportBackup").addEventListener("click", exportBackup);
if (sessionStorage.getItem("couple-ledger-unlocked") === "true") {
  unlockApp();
} else {
  passwordInput.focus();
}

if (!storageFailure && isSyncConfigured()) {
  setSyncStatus("共有コードを確認して「同期する」を押してください。");
  startAutoSync();
} else if (!storageFailure) {
  setSyncStatus("クラウド設定がまだありません。設定後に同期できます。", "warn");
}

render();
