/* Pure merge logic shared by the app and offline regression tests. */
(function (root) {
  "use strict";
  const fields = ["date", "title", "amount", "payer", "bomRatio", "anchanRatio"];
  function content(row) {
    return JSON.stringify(fields.map((key) => row[key]));
  }
  function fingerprint(value) {
    let a = 2166136261, b = 5381;
    for (let i = 0; i < value.length; i++) {
      a = Math.imul(a ^ value.charCodeAt(i), 16777619);
      b = Math.imul(b, 33) ^ value.charCodeAt(i);
    }
    return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
  }
  function normalize(rows) {
    if (!Array.isArray(rows)) throw new Error("共有データの形式を確認できません。上書きせず停止しました。");
    return rows.map((row) => {
      if (!row || typeof row !== "object" || typeof row.id !== "string" ||
          typeof row.date !== "string" || typeof row.title !== "string" ||
          typeof row.amount !== "number" || !Number.isFinite(row.amount) || row.amount < 0 ||
          !["bom", "anchan"].includes(row.payer) || typeof row.bomRatio !== "number" ||
          !Number.isFinite(row.bomRatio) || row.bomRatio < 0 || row.bomRatio > 100) {
        throw new Error("支出データに確認が必要です。上書きせず停止しました。");
      }
      const next = { id: row.id };
      for (const key of fields) next[key] = row[key];
      next.anchanRatio = 100 - row.bomRatio;
      if (row._rev !== undefined) {
        if (!/^\d{16}:[a-zA-Z0-9-]+$/.test(row._rev)) throw new Error("未対応の同期データです。上書きせず停止しました。");
        next._rev = row._rev;
        next._deleted = row._deleted === true;
        if (typeof row._legacyId === "string") next._legacyId = row._legacyId;
      } else {
        // Old sequential IDs can identify different expenses on two offline phones.
        // Identical legacy rows collapse; different content is retained for review.
        next.id = `legacy-${fingerprint(JSON.stringify([row.id, content(next)]))}`;
        next._legacyId = row.id;
        next._rev = "0000000000000000:legacy";
        next._deleted = false;
      }
      return next;
    });
  }
  function merge(...groups) {
    const rows = new Map();
    for (const group of groups) {
      for (const row of normalize(group)) {
        const old = rows.get(row.id);
        if (!old || row._rev > old._rev) rows.set(row.id, row);
        else if (row._rev === old._rev && JSON.stringify(row) !== JSON.stringify(old)) {
          throw new Error("同じ支出に競合があります。バックアップを保持して同期を停止しました。");
        }
      }
    }
    return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  function visible(records) { return records.filter((row) => !row._deleted).map((row) => ({ ...row })); }
  function revise(records, expenses, device) {
    let clock = records.reduce((max, row) => Math.max(max, Number(row._rev.split(":")[0])), 0);
    const stamp = () => `${String(++clock).padStart(16, "0")}:${device}`;
    const before = new Map(records.map((row) => [row.id, row]));
    const current = new Map(expenses.map((row) => [row.id, row]));
    const next = records.map((row) => {
      const expense = current.get(row.id);
      if (!expense) return row._deleted ? row : { ...row, _deleted: true, _rev: stamp() };
      if (row._deleted || content(row) !== content(expense)) return { ...expense, _deleted: false, _rev: stamp() };
      return row;
    });
    for (const expense of expenses) {
      if (!before.has(expense.id)) next.push({ ...expense, _deleted: false, _rev: stamp() });
    }
    return merge(next);
  }
  root.LedgerSync = { normalize, merge, visible, revise, content };
  if (typeof module !== "undefined") module.exports = root.LedgerSync;
})(typeof globalThis !== "undefined" ? globalThis : this);
