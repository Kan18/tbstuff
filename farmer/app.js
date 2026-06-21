(() => {
  "use strict";

  const DEFAULT_START_PURCHASES = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5650, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const DEFAULT_END_PURCHASES = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const DEFAULT_BONUSES = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  const MODE_CONFIGS = {
    "1v1": { startCash: 650, rewardType: "versus", players: 1 },
    "2v2": { startCash: 600, rewardType: "versus", players: 2 },
    "3v3": { startCash: 550, rewardType: "versus", players: 3 },
    "4v4": { startCash: 550, rewardType: "versus", players: 4 },
    solo: { startCash: 650, rewardType: "survival", rewardMultiplier: 16, rewardDivisor: 9 },
    coop: { startCash: 600, rewardType: "survival", rewardMultiplier: 1, rewardDivisor: 1 },
    triop: { startCash: 550, rewardType: "survival", rewardMultiplier: 8, rewardDivisor: 13 },
    quadop: { startCash: 500, rewardType: "survival", rewardMultiplier: 4, rewardDivisor: 11 },
  };
  const MODE_ALIASES = { qop: "quadop" };

  const el = {
    form: document.getElementById("controls"),
    mode: document.getElementById("mode"),
    endWave: document.getElementById("endWave"),
    objective: document.getElementById("objective"),
    runBtn: document.getElementById("runBtn"),
    stopBtn: document.getElementById("stopBtn"),
    downloadBtn: document.getElementById("downloadBtn"),
    status: document.getElementById("status"),
    output: document.getElementById("output"),
    summary: document.getElementById("summary"),
    planTableWrap: document.getElementById("planTableWrap"),
    presetName: document.getElementById("presetName"),
    presetSelect: document.getElementById("presetSelect"),
    presetSaveBtn: document.getElementById("presetSaveBtn"),
    presetLoadBtn: document.getElementById("presetLoadBtn"),
    presetDeleteBtn: document.getElementById("presetDeleteBtn"),
    exportJsonBtn: document.getElementById("exportJsonBtn"),
    importJsonBtn: document.getElementById("importJsonBtn"),
    importJsonFile: document.getElementById("importJsonFile"),
  };

  const STORAGE_KEY = "tbFarmCalc:v2";
  const PRESETS_KEY = "tbFarmCalc:presets:v1";
  const BACKUP_VERSION = 1;

  function normalizeMode(mode) {
    const canonical = MODE_ALIASES[mode] || mode;
    if (!MODE_CONFIGS[canonical]) throw new Error(`Unknown mode: ${mode}`);
    return canonical;
  }

  function safeJsonParse(text) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  function ensureLen(arr, len) {
    const out = Array.isArray(arr) ? arr.slice() : [];
    while (out.length < len) out.push(0);
    return out;
  }

  function roundHalfUpRatio(numerator, denominator) {
    return Math.floor((2 * numerator + denominator) / (2 * denominator));
  }

  function waveRewardBase(mode, wave) {
    if (wave === 0) return 0;
    const canonical = normalizeMode(mode);
    const cfg = MODE_CONFIGS[canonical];
    if (cfg.rewardType === "versus") {
      return roundHalfUpRatio(200 + 30 * wave, cfg.players);
    }
    return roundHalfUpRatio((100 + 20 * wave) * cfg.rewardMultiplier, cfg.rewardDivisor);
  }

  function farmsHtml(farms) {
    const parts = [];
    for (let level = 4; level >= 1; level -= 1) {
      const count = farms[level - 1];
      if (count) parts.push(`${count}x<span class="farm-l${level}">L${level}</span>`);
    }
    return parts.length ? parts.join(" ") : `<span style="color:#888">—</span>`;
  }

  function splitActionsByReward(actions) {
    const idx = actions.indexOf("__REWARD__");
    if (idx === -1) return { start: actions.slice(), end: [] };
    return {
      start: actions.slice(0, idx),
      end: actions.slice(idx + 1),
    };
  }

  function reorderSegmentForTower(actions) {
    const sells = [];
    const buyTower = [];
    const rest = [];
    for (const act of actions) {
      if (act === "__REWARD__") continue;
      if (act.startsWith("Sell ")) sells.push(act);
      else if (act.startsWith("Buy tower ")) buyTower.push(act);
      else rest.push(act);
    }
    return sells.concat(buyTower, rest);
  }

  function actionCore(act) {
    return String(act || "").trim().split(" for $")[0].replaceAll("→", "->").toLowerCase();
  }

  function parseFarmAction(act) {
    const core = actionCore(act);
    const buyMatch = core.match(/^buy\s+l([1-4])$/);
    if (buyMatch) {
      return { kind: "buy", level: Number(buyMatch[1]) };
    }

    const sellMatch = core.match(/^sell\s+l([1-4])$/);
    if (sellMatch) {
      return { kind: "sell", level: Number(sellMatch[1]) };
    }

    const upgradeMatch = core.match(/^upgrade\s+l([1-4])->l([1-4])$/);
    if (upgradeMatch) {
      return { kind: "upgrade", from: Number(upgradeMatch[1]), to: Number(upgradeMatch[2]) };
    }

    return null;
  }

  function mergeFarmUpgradeChains(actions) {
    const chained = [];
    let i = 0;

    while (i < actions.length) {
      const parsed = parseFarmAction(actions[i]);

      if (parsed?.kind === "buy") {
        let level = parsed.level;
        let j = i + 1;
        while (j < actions.length) {
          const next = parseFarmAction(actions[j]);
          if (next?.kind !== "upgrade" || next.from !== level || next.to !== level + 1) break;
          level = next.to;
          j += 1;
        }
        chained.push(`Buy L${level}`);
        i = j;
        continue;
      }

      if (parsed?.kind === "upgrade") {
        const from = parsed.from;
        let to = parsed.to;
        let j = i + 1;
        while (j < actions.length) {
          const next = parseFarmAction(actions[j]);
          if (next?.kind !== "upgrade" || next.from !== to || next.to !== to + 1) break;
          to = next.to;
          j += 1;
        }
        chained.push(`Upgrade L${from}→L${to}`);
        i = j;
        continue;
      }

      chained.push(actions[i]);
      i += 1;
    }

    return chained;
  }

  function mergeCountedFarmActions(actions) {
    const merged = [];
    let i = 0;

    while (i < actions.length) {
      const parsed = parseFarmAction(actions[i]);
      if (!parsed || (parsed.kind !== "buy" && parsed.kind !== "sell")) {
        merged.push(actions[i]);
        i += 1;
        continue;
      }

      const kind = parsed.kind;
      const counts = new Map();
      let j = i;
      while (j < actions.length) {
        const next = parseFarmAction(actions[j]);
        if (!next || next.kind !== kind) break;
        counts.set(next.level, (counts.get(next.level) || 0) + 1);
        j += 1;
      }

      const verb = kind === "buy" ? "Buy" : "Sell";
      const levels = Array.from(counts.keys()).sort((a, b) => b - a);
      for (const level of levels) {
        const count = counts.get(level);
        if (kind === "buy" && count === 1) {
          merged.push(`${verb} L${level}`);
        } else {
          merged.push(`${verb} ${count}xL${level}`);
        }
      }
      i = j;
    }

    return merged;
  }

  function mergeFarmActions(actions) {
    return mergeCountedFarmActions(mergeFarmUpgradeChains(actions));
  }

  function renderActionsHtml(rawActions) {
    const safe = (rawActions || []).filter((a) => a && a !== "__REWARD__");
    if (!safe.length) return `<span style="color:#888">—</span>`;

    const parts = splitActionsByReward(rawActions || []);
    const start = mergeFarmActions(reorderSegmentForTower(parts.start));
    const end = mergeFarmActions(reorderSegmentForTower(parts.end));

    const startHas = start.length > 0;
    const endHas = end.length > 0;

    const lines = [];
    const addLines = (arr) => {
      for (const a of arr) lines.push(colorizeAction(formatAction(a)));
    };

    if (startHas && endHas) {
      lines.push(`<span class="phase">(start)</span>`);
      addLines(start);
      lines.push(`<span class="phase">(end)</span>`);
      addLines(end);
    } else if (startHas) {
      addLines(start);
    } else {
      addLines(end);
    }

    return lines.join("<br>");
  }

  function formatAction(act) {
    if (!act) return "";
    let s = String(act).trim();
    if (s.includes(" for $")) s = s.split(" for $")[0];
    s = s.toLowerCase();

    const towerMatch = s.match(/^buy\s+tower\s+(\d+(?:\.\d+)?)$/i);
    if (towerMatch) {
      const amount = towerMatch[1];
      return `Buy Tower $<span class="tower-cost">${escapeHtml(amount)}</span>`;
    }

    const countedFarmMatch = s.match(/^(buy|sell)\s+(\d+)xl([1-4])$/i);
    if (countedFarmMatch) {
      const verb = countedFarmMatch[1][0].toUpperCase() + countedFarmMatch[1].slice(1);
      return `${verb} ${countedFarmMatch[2]}xL${countedFarmMatch[3]}`;
    }

    const parts = s.split(" ");
    const verb = parts[0] ? parts[0][0].toUpperCase() + parts[0].slice(1) : "";
    let tail = parts.slice(1).join(" ");
    tail = tail.replaceAll("->", "→");
    tail = tail.replace(/l(?=\d)/g, "L");

    const words = tail.split(" ").filter(Boolean).map((word) => {
      if (/^L\d$/.test(word)) return word;
      if (word.startsWith("→")) return word.replace(/l(?=\d)/g, "L");
      if (word === "tower") return "Tower";
      return word[0] ? word[0].toUpperCase() + word.slice(1) : word;
    });
    tail = words.length ? words.join(" ") : tail.toUpperCase();
    if (tail.includes("→")) tail = tail.replace(/l(?=\d)/g, "L");
    return `${verb} ${tail}`.trim();
  }

  function colorizeAction(htmlText) {
    return String(htmlText)
      .replaceAll("L1", `<span class="farm-l1">L1</span>`)
      .replaceAll("L2", `<span class="farm-l2">L2</span>`)
      .replaceAll("L3", `<span class="farm-l3">L3</span>`)
      .replaceAll("L4", `<span class="farm-l4">L4</span>`);
  }

  function renderPlanTable({ endWave, startPurchases, endPurchases, bonuses, rows, mode }) {
    const html = [];
    html.push(`<table>`);
    html.push(
      `<tr>` +
        `<th>Wave</th>` +
        `<th>Farm income</th>` +
        `<th>Cash after farm income</th>` +
        `<th>Tower purchase (start)</th>` +
        `<th>Wave reward</th>` +
        `<th>Other income</th>` +
        `<th>Cash after reward</th>` +
        `<th>Tower purchase (end)</th>` +
        `<th>Actions at end of wave</th>` +
        `<th>Farms after actions</th>` +
        `<th>Cash after actions</th>` +
        `</tr>`
    );
    const rowsByWave = new Map();
    for (const r of rows || []) rowsByWave.set(r.wave, r);

    for (let wave = 0; wave < endWave; wave += 1) {
      const row = rowsByWave.get(wave) || null;
      const waveLabel = String(wave);

      const startVal = Number.isFinite(startPurchases[wave]) ? Math.abs(startPurchases[wave]) : 0;
      const endVal = Number.isFinite(endPurchases[wave]) ? Math.abs(endPurchases[wave]) : 0;
      const bonusVal = Number.isFinite(bonuses[wave]) ? bonuses[wave] : 0;

      const startHtml =
        `<div class="moneyInput tower-purchase">` +
        `<span class="prefix">$</span>` +
        `<input class="cellInput tower-purchase" inputmode="numeric" step="1" type="number" min="0" value="${escapeHtml(String(startVal))}" data-kind="startPurchase" data-wave="${wave}" />` +
        `</div>`;
      const endHtml =
        `<div class="moneyInput tower-purchase">` +
        `<span class="prefix">$</span>` +
        `<input class="cellInput tower-purchase" inputmode="numeric" step="1" type="number" min="0" value="${escapeHtml(String(endVal))}" data-kind="endPurchase" data-wave="${wave}" />` +
        `</div>`;
      const bonusHtml =
        `<div class="moneyInput other-income">` +
        `<span class="prefix">$</span>` +
        `<input class="cellInput other-income" inputmode="numeric" step="1" type="number" value="${escapeHtml(String(bonusVal))}" data-kind="bonus" data-wave="${wave}" />` +
        `</div>`;

      const rewardBase = row ? Number(row.rewardBase || 0) : waveRewardBase(mode, wave);
      const rewardHtml = `<span class="wave-reward">$${rewardBase}</span>`;

      const incomeHtml = row ? `<span class="farm-income">$${row.income}</span>` : `<span style="color:#888">—</span>`;
      const cashAfterIncomeHtml = row ? `<span class="cash-after-income">$${row.cashAfterIncome}</span>` : `<span style="color:#888">—</span>`;
      const cashAfterRewardHtml = row ? `$${row.cashAfterReward}` : `<span style="color:#888">—</span>`;
      const farmsAfterHtml = row ? farmsHtml(row.farmsAfter) : `<span style="color:#888">—</span>`;
      const cashAfterActionsHtml = row ? `$${row.cashAfterActions}` : `<span style="color:#888">—</span>`;

      const actionsHtml = row ? renderActionsHtml(row.actions || []) : `<span style="color:#888">—</span>`;
      html.push(
        `<tr>` +
          `<td>${waveLabel}</td>` +
          `<td>${incomeHtml}</td>` +
          `<td>${cashAfterIncomeHtml}</td>` +
          `<td>${startHtml}</td>` +
          `<td>${rewardHtml}</td>` +
          `<td>${bonusHtml}</td>` +
          `<td class="cash-after-reward">${cashAfterRewardHtml}</td>` +
          `<td>${endHtml}</td>` +
          `<td class="actions">${actionsHtml}</td>` +
          `<td>${farmsAfterHtml}</td>` +
          `<td class="cash-after-actions">${cashAfterActionsHtml}</td>` +
          `</tr>`
      );
    }
    html.push(`</table>`);
    return html.join("");
  }

  function renderPlanTableStatic({ endWave, startPurchases, endPurchases, bonuses, rows, mode }) {
    const html = [];
    html.push(`<table>`);
    html.push(
      `<tr>` +
        `<th>Wave</th>` +
        `<th>Farm income</th>` +
        `<th>Cash after farm income</th>` +
        `<th>Wave reward</th>` +
        `<th>Other income</th>` +
        `<th>Cash after reward</th>` +
        `<th>Actions at end of wave</th>` +
        `<th>Farms after actions</th>` +
        `<th>Cash after actions</th>` +
        `</tr>`
    );
    const rowsByWave = new Map();
    for (const r of rows || []) rowsByWave.set(r.wave, r);

    for (let wave = 0; wave < endWave; wave += 1) {
      const row = rowsByWave.get(wave) || null;
      const bonusVal = Number.isFinite(bonuses[wave]) ? bonuses[wave] : 0;
      const rewardBase = row ? Number(row.rewardBase || 0) : waveRewardBase(mode, wave);
      const incomeHtml = row ? `<span class="farm-income">$${row.income}</span>` : `<span style="color:#888">—</span>`;
      const cashAfterIncomeHtml = row ? `<span class="cash-after-income">$${row.cashAfterIncome}</span>` : `<span style="color:#888">—</span>`;
      const cashAfterRewardHtml = row ? `$${row.cashAfterReward}` : `<span style="color:#888">—</span>`;
      const farmsAfterHtml = row ? farmsHtml(row.farmsAfter) : `<span style="color:#888">—</span>`;
      const cashAfterActionsHtml = row ? `$${row.cashAfterActions}` : `<span style="color:#888">—</span>`;
      const actionsHtml = row ? renderActionsHtml(row.actions || []) : `<span style="color:#888">—</span>`;

      html.push(
        `<tr>` +
          `<td>${wave}</td>` +
          `<td>${incomeHtml}</td>` +
          `<td>${cashAfterIncomeHtml}</td>` +
          `<td><span class="wave-reward">$${escapeHtml(String(rewardBase))}</span></td>` +
          `<td><span class="other-income">$${escapeHtml(String(bonusVal))}</span></td>` +
          `<td class="cash-after-reward">${cashAfterRewardHtml}</td>` +
          `<td class="actions">${actionsHtml}</td>` +
          `<td>${farmsAfterHtml}</td>` +
          `<td class="cash-after-actions">${cashAfterActionsHtml}</td>` +
          `</tr>`
      );
    }
    html.push(`</table>`);
    return html.join("");
  }

  function buildDownloadHtml({ title, summaryHtml, tableHtml }) {
    return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body { font-family: Arial, sans-serif; background: #f9f9f9; }
table { border-collapse: collapse; margin: 2em auto; background: #fff; box-shadow: 0 2px 8px #ccc; }
th, td { border: 1px solid #bbb; padding: 0.5em 1em; text-align: center; }
th { background: #4a90e2; color: #fff; }
tr:nth-child(even) { background: #f0f6ff; }
.actions { text-align: left; font-size: 0.95em; vertical-align: top; }
.wave-underline { text-decoration: underline; }
.farm-l1 { font-weight: bold; color: #8d6e63; }
.farm-l2 { font-weight: bold; color: #f9a825; }
.farm-l3 { font-weight: bold; color: #388e3c; }
.farm-l4 { font-weight: bold; color: #81c784; }
.farm-income { color: #1976d2; }
.cash-after-income { color: #00897b; }
.wave-reward { color: #1976d2; font-weight: normal; }
.other-income { color: #00897b; }
.cash-after-reward { color: #43a047; }
.cash-after-actions { color: #2e7d32; }
.tower-cost { color: #f59e0b; font-weight: 700; }
.phase { color: #666; font-style: italic; }
.summary { max-width: 900px; margin: 1em auto 0; color: #333; }
code { font-family: Consolas, Menlo, Monaco, monospace; }
</style>
</head>
<body>
<h2 style="text-align:center">${escapeHtml(title)}</h2>
<div class="summary">${summaryHtml}</div>
${tableHtml}
</body>
</html>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function downloadText(filename, content, mime = "text/plain") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function loadSettings() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = safeJsonParse(raw);
    if (!parsed.ok) return null;
    return parsed.value;
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function loadPresetsStore() {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return { version: 1, presets: {} };
    const parsed = safeJsonParse(raw);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return { version: 1, presets: {} };
    const presets = parsed.value.presets && typeof parsed.value.presets === "object" ? parsed.value.presets : {};
    return { version: 1, presets };
  }

  function savePresetsStore(store) {
    localStorage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: store.presets || {} }));
  }

  function listPresetNames() {
    const store = loadPresetsStore();
    return Object.keys(store.presets || {}).sort((a, b) => a.localeCompare(b));
  }

  function refreshPresetSelect() {
    const names = listPresetNames();
    el.presetSelect.innerHTML = "";
    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = names.length ? "— Select —" : "— None saved —";
    el.presetSelect.appendChild(emptyOpt);
    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      el.presetSelect.appendChild(opt);
    }
  }

  function setStatus(text) {
    el.status.textContent = text || "";
  }

  function populateModeSelect() {
    const ordered = [
      { value: "1v1", label: "1v1" },
      { value: "2v2", label: "2v2" },
      { value: "3v3", label: "3v3" },
      { value: "4v4", label: "4v4" },
      { value: "solo", label: "Solo" },
      { value: "coop", label: "Co-Op" },
      { value: "triop", label: "Tri-Op" },
      { value: "quadop", label: "Quad-Op" },
    ];
    for (const item of ordered) {
      const opt = document.createElement("option");
      opt.value = item.value;
      opt.textContent = item.label;
      el.mode.appendChild(opt);
    }
  }

  populateModeSelect();

  // Defaults + persisted settings
  {
    const saved = loadSettings();
    const savedMode = saved?.mode ? (MODE_ALIASES[saved.mode] || saved.mode) : null;
    if (savedMode) el.mode.value = savedMode;
    if (Number.isFinite(saved?.endWave)) el.endWave.value = String(saved.endWave);
    if (saved?.objective) el.objective.value = saved.objective;
  }

  let activeWorker = null;
  let lastResult = null;
  let startPurchases = DEFAULT_START_PURCHASES.slice();
  let endPurchases = DEFAULT_END_PURCHASES.slice();
  let bonuses = DEFAULT_BONUSES.slice();

  function loadWaveArraysFromStorage() {
    const saved = loadSettings();
    if (!saved) return;
    if (Array.isArray(saved.startPurchases)) startPurchases = saved.startPurchases.map(Number).filter((n) => Number.isFinite(n));
    if (Array.isArray(saved.endPurchases)) endPurchases = saved.endPurchases.map(Number).filter((n) => Number.isFinite(n));
    if (Array.isArray(saved.bonuses)) bonuses = saved.bonuses.map(Number).filter((n) => Number.isFinite(n));
  }

  function persistWaveArrays() {
    const saved = loadSettings() || {};
    saveSettings({
      ...saved,
      mode: el.mode.value,
      endWave: Number(el.endWave.value),
      objective: el.objective.value,
      startPurchases,
      endPurchases,
      bonuses,
    });
  }

  function renderTable() {
    const endWave = Number(el.endWave.value);
    const safeEndWave = Number.isFinite(endWave) && endWave >= 0 ? endWave : 0;
    startPurchases = ensureLen(startPurchases, safeEndWave);
    endPurchases = ensureLen(endPurchases, safeEndWave);
    bonuses = ensureLen(bonuses, safeEndWave);
    el.planTableWrap.innerHTML = renderPlanTable({
      endWave: safeEndWave,
      startPurchases,
      endPurchases,
      bonuses,
      rows: lastResult?.rows || null,
      mode: el.mode.value,
    });
  }

  function clearResults(message) {
    lastResult = null;
    el.summary.innerHTML = "";
    el.downloadBtn.disabled = true;
    if (message) setStatus(message);
    renderTable();
  }

  function getCurrentConfigForPreset() {
    const endWave = Number(el.endWave.value);
    const safeEndWave = Number.isFinite(endWave) && endWave >= 0 ? endWave : 0;
    return {
      endWave: safeEndWave,
      startPurchases: ensureLen(startPurchases, safeEndWave),
      endPurchases: ensureLen(endPurchases, safeEndWave),
      bonuses: ensureLen(bonuses, safeEndWave),
    };
  }

  function applyPresetConfig(cfg) {
    if (!cfg || typeof cfg !== "object") throw new Error("Invalid preset.");
    const endWave = Number(cfg.endWave);
    const safeEndWave = Number.isFinite(endWave) && endWave >= 0 ? endWave : 0;
    el.endWave.value = String(safeEndWave);
    startPurchases = ensureLen(Array.isArray(cfg.startPurchases) ? cfg.startPurchases.map((n) => Math.abs(Number(n) || 0)) : [], safeEndWave);
    endPurchases = ensureLen(Array.isArray(cfg.endPurchases) ? cfg.endPurchases.map((n) => Math.abs(Number(n) || 0)) : [], safeEndWave);
    bonuses = ensureLen(Array.isArray(cfg.bonuses) ? cfg.bonuses.map((n) => Number(n) || 0) : [], safeEndWave);
    persistWaveArrays();
    clearResults("Preset loaded; recompute plan.");
  }

  loadWaveArraysFromStorage();
  refreshPresetSelect();
  renderTable();

  el.presetSaveBtn.addEventListener("click", () => {
    const name = (el.presetName.value || "").trim();
    if (!name) {
      setStatus("Enter a preset name to save.");
      return;
    }
    const store = loadPresetsStore();
    store.presets = store.presets || {};
    store.presets[name] = { ...getCurrentConfigForPreset(), savedAt: new Date().toISOString() };
    savePresetsStore(store);
    refreshPresetSelect();
    el.presetSelect.value = name;
    setStatus(`Saved preset: ${name}`);
  });

  el.presetLoadBtn.addEventListener("click", () => {
    const name = el.presetSelect.value;
    if (!name) {
      setStatus("Select a preset to load.");
      return;
    }
    const store = loadPresetsStore();
    const cfg = store.presets?.[name];
    if (!cfg) {
      setStatus("Preset not found.");
      refreshPresetSelect();
      return;
    }
    try {
      applyPresetConfig(cfg);
      setStatus(`Loaded preset: ${name}`);
    } catch (e) {
      setStatus(String(e?.message || e));
    }
  });

  el.presetDeleteBtn.addEventListener("click", () => {
    const name = el.presetSelect.value;
    if (!name) {
      setStatus("Select a preset to delete.");
      return;
    }
    const store = loadPresetsStore();
    if (store.presets?.[name]) {
      delete store.presets[name];
      savePresetsStore(store);
      refreshPresetSelect();
      el.presetSelect.value = "";
      setStatus(`Deleted preset: ${name}`);
    } else {
      setStatus("Preset not found.");
      refreshPresetSelect();
    }
  });

  el.exportJsonBtn.addEventListener("click", () => {
    const presetsStore = loadPresetsStore();
    const backup = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      current: {
        mode: el.mode.value,
        endWave: Number(el.endWave.value),
        objective: el.objective.value,
        ...getCurrentConfigForPreset(),
      },
      presets: presetsStore.presets || {},
    };
    downloadText("tb-farm-backup.json", JSON.stringify(backup, null, 2), "application/json");
    setStatus("Exported JSON backup.");
  });

  el.importJsonBtn.addEventListener("click", () => {
    el.importJsonFile.value = "";
    el.importJsonFile.click();
  });

  el.importJsonFile.addEventListener("change", async () => {
    const file = el.importJsonFile.files && el.importJsonFile.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = safeJsonParse(text);
      if (!parsed.ok) throw new Error("Invalid JSON file.");
      const obj = parsed.value;
      if (!obj || typeof obj !== "object") throw new Error("Invalid backup format.");
      if (obj.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version: ${String(obj.version)}`);

      const store = loadPresetsStore();
      store.presets = store.presets || {};
      const incomingPresets = obj.presets && typeof obj.presets === "object" ? obj.presets : {};
      for (const [name, cfg] of Object.entries(incomingPresets)) {
        if (!name) continue;
        store.presets[name] = cfg;
      }
      savePresetsStore(store);
      refreshPresetSelect();

      if (obj.current) {
        if (obj.current.mode) el.mode.value = MODE_ALIASES[obj.current.mode] || obj.current.mode;
        if (obj.current.objective) el.objective.value = obj.current.objective;
        applyPresetConfig(obj.current);
      }

      setStatus("Imported JSON backup.");
    } catch (e) {
      setStatus(String(e?.message || e));
    }
  });

  el.planTableWrap.addEventListener("input", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement)) return;
    const kind = t.dataset.kind;
    const wave = Number(t.dataset.wave);
    if (!Number.isFinite(wave) || wave < 0) return;
    const value = t.value === "" ? 0 : Number(t.value);
    const numeric = Number.isFinite(value) ? value : 0;
    if (kind === "startPurchase") {
      startPurchases = ensureLen(startPurchases, wave + 1);
      startPurchases[wave] = Math.abs(numeric);
      if (t.value !== "" && Number.isFinite(value) && value < 0) t.value = String(Math.abs(value));
    } else if (kind === "endPurchase") {
      endPurchases = ensureLen(endPurchases, wave + 1);
      endPurchases[wave] = Math.abs(numeric);
      if (t.value !== "" && Number.isFinite(value) && value < 0) t.value = String(Math.abs(value));
    } else if (kind === "bonus") {
      bonuses = ensureLen(bonuses, wave + 1);
      bonuses[wave] = numeric;
    } else {
      return;
    }
    persistWaveArrays();
    if (lastResult) clearResults("Inputs changed; recompute plan.");
  });

  el.endWave.addEventListener("change", () => {
    const endWave = Number(el.endWave.value);
    if (!Number.isFinite(endWave) || endWave < 0) return;
    startPurchases = ensureLen(startPurchases, endWave);
    endPurchases = ensureLen(endPurchases, endWave);
    bonuses = ensureLen(bonuses, endWave);
    persistWaveArrays();
    if (lastResult) clearResults("End wave changed; recompute plan.");
    else renderTable();
  });

  el.mode.addEventListener("change", () => {
    persistWaveArrays();
    if (lastResult) clearResults("Mode changed; recompute plan.");
  });

  el.objective.addEventListener("change", () => {
    persistWaveArrays();
    if (lastResult) clearResults("Objective changed; recompute plan.");
  });

  function stopWorker() {
    if (activeWorker) {
      activeWorker.terminate();
      activeWorker = null;
    }
    el.stopBtn.disabled = true;
    el.runBtn.disabled = false;
  }

  function makeWorker() {
    return new Worker("worker.js");
  }

  el.stopBtn.addEventListener("click", () => {
    stopWorker();
    setStatus("Stopped.");
  });

  el.form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    stopWorker();

    clearResults();

    const modeInput = el.mode.value;
    const endWave = Number(el.endWave.value);
    const objective = el.objective.value;
    if (!Number.isFinite(endWave) || endWave < 0) {
      setStatus("End wave must be a non-negative integer.");
      return;
    }

    startPurchases = ensureLen(startPurchases, endWave);
    endPurchases = ensureLen(endPurchases, endWave);
    bonuses = ensureLen(bonuses, endWave);
    persistWaveArrays();

    for (let i = 0; i < endWave; i += 1) {
      if (!Number.isInteger(startPurchases[i])) {
        setStatus(`Start tower purchase (wave ${i}) must be an integer.`);
        return;
      }
      if (!Number.isInteger(endPurchases[i])) {
        setStatus(`End tower purchase (wave ${i}) must be an integer.`);
        return;
      }
      if (!Number.isInteger(bonuses[i])) {
        setStatus(`Bonus (wave ${i}) must be an integer.`);
        return;
      }
      if (startPurchases[i] < 0 || endPurchases[i] < 0) {
        setStatus(`Tower purchases must be non-negative (wave ${i}).`);
        return;
      }
    }

    el.runBtn.disabled = true;
    el.stopBtn.disabled = false;
    setStatus("Starting…");

    let worker;
    try {
      worker = makeWorker();
    } catch (e) {
      el.runBtn.disabled = false;
      el.stopBtn.disabled = true;
      setStatus("Failed to start worker. Open via a local server (see tip below).");
      return;
    }
    activeWorker = worker;

    const t0 = performance.now();

    worker.onmessage = (msg) => {
      const data = msg.data || {};
      if (data.type === "progress") {
        setStatus(`Computing wave ${data.wave + 1}/${data.endWave}… (actions explored: ${data.actionCounter ?? "?"})`);
        return;
      }
      if (data.type === "result") {
        const ms = performance.now() - t0;
        stopWorker();
        setStatus(`Done in ${ms}ms.`);

        lastResult = data.result;
        const canonicalMode = normalizeMode(modeInput);
        const cfg = MODE_CONFIGS[canonicalMode];
        el.summary.innerHTML =
          `<div><strong>Mode:</strong> ${escapeHtml(modeInput)} (start $${cfg.startCash})</div>` +
          `<div><strong>End wave:</strong> ${escapeHtml(String(endWave))}</div>` +
          `<div><strong>Objective:</strong> ${escapeHtml(objective)}</div>` +
          `<div><strong>Final state:</strong> farms (${lastResult.finalFarms.join(", ")}), cash $${lastResult.finalCash}, income/wave $${lastResult.finalIncome}</div>` +
          `<div><strong>Search:</strong> actions explored ${lastResult.actionCounter}, frontier size ${lastResult.finalFrontierSize}</div>`;

        renderTable();
        el.downloadBtn.disabled = false;
        return;
      }
      if (data.type === "error") {
        stopWorker();
        setStatus(`Error: ${data.error || "Unknown error"}`);
      }
    };

    worker.onerror = (err) => {
      stopWorker();
      setStatus(`Worker error. If opened as a file, use a local server. (${err?.message || "unknown"})`);
    };

    worker.postMessage({
      type: "run",
      input: {
        mode: modeInput,
        endWave,
        objective,
        startPurchases,
        endPurchases,
        bonuses,
      },
    });
  });

  el.downloadBtn.addEventListener("click", () => {
    if (!lastResult) return;
    const title = "Tower Battles Farm Plan";
    const summaryHtml =
      `<div><code>Mode</code>: ${escapeHtml(lastResult.mode)}</div>` +
      `<div><code>End wave</code>: ${escapeHtml(String(lastResult.endWave))}</div>` +
      `<div><code>Objective</code>: ${escapeHtml(lastResult.objective)}</div>` +
      `<div><code>Final</code>: farms (${lastResult.finalFarms.join(", ")}), cash $${lastResult.finalCash}, income/wave $${lastResult.finalIncome}</div>`;
    const tableHtml = renderPlanTableStatic({
      endWave: lastResult.endWave,
      startPurchases,
      endPurchases,
      bonuses,
      rows: lastResult.rows,
      mode: el.mode.value,
    });
    const html = buildDownloadHtml({ title, summaryHtml, tableHtml });
    downloadText("plan.html", html, "text/html");
  });
})();
