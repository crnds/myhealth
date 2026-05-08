/* Workout Adaptation Report
 * Reads workouts.json (extracted from Apple Health export.xml) and renders
 * trends, a searchable session list, a session detail view, and an A-vs-B
 * comparison view.
 */

const STATE = {
  raw: [],         // all workouts (from JSON)
  category: "All", // currently selected category
  sortKey: "date-desc",
  search: "",
  rangeDays: "all",
  smoothing: 5,
  selectedId: null, // detail view
  compareA: null,
  compareB: null,
  charts: {},      // category -> array of Chart instances (for cleanup)
};

// Friendly labels for HealthKit activity types
const TYPE_LABELS = {
  Cycling: "Cycling",
  Walking: "Walking",
  Swimming: "Swimming",
  Pilates: "Pilates",
  TraditionalStrengthTraining: "Strength (Traditional)",
  FunctionalStrengthTraining: "Strength (Functional)",
  Yoga: "Yoga",
  Running: "Running",
  HighIntensityIntervalTraining: "HIIT",
  Hiking: "Hiking",
  Sailing: "Sailing",
  Other: "Other",
};

// Per-category chart specs. Each entry is a metric to plot over time.
// `from(w)` returns a numeric value (or null if missing) for one workout.
const CATEGORY_METRICS = {
  Cycling: [
    { key: "distance",   label: "Distance",            unit: "km",     from: w => w.totalDistance, betterHigher: true },
    { key: "duration",   label: "Duration",            unit: "min",    from: w => w.duration,      betterHigher: true },
    { key: "speed",      label: "Average speed",       unit: "km/h",   from: w => avgSpeedKmh(w),  betterHigher: true },
    { key: "hrAvg",      label: "Avg heart rate",      unit: "bpm",    from: w => stat(w,"HeartRate","average"), betterHigher: false },
    { key: "energy",     label: "Active calories",     unit: "kcal",   from: w => w.totalEnergyBurned, betterHigher: true },
    { key: "mets",       label: "Average METs",        unit: "",       from: w => w.meta?.averageMETs, betterHigher: true },
  ],
  Running: [
    { key: "distance",   label: "Distance",            unit: "km",     from: w => w.totalDistance, betterHigher: true },
    { key: "pace",       label: "Average pace",        unit: "min/km", from: w => paceMinPerKm(w), betterHigher: false },
    { key: "speed",      label: "Average speed",       unit: "km/h",   from: w => stat(w,"RunningSpeed","average") ?? avgSpeedKmh(w), betterHigher: true },
    { key: "hrAvg",      label: "Avg heart rate",      unit: "bpm",    from: w => stat(w,"HeartRate","average"), betterHigher: false },
    { key: "power",      label: "Running power",       unit: "W",      from: w => stat(w,"RunningPower","average"), betterHigher: true },
    { key: "stride",     label: "Stride length",       unit: "m",      from: w => stat(w,"RunningStrideLength","average"), betterHigher: true },
    { key: "vertOsc",    label: "Vertical oscillation",unit: "cm",     from: w => stat(w,"RunningVerticalOscillation","average"), betterHigher: false },
    { key: "groundTime", label: "Ground contact",      unit: "ms",     from: w => stat(w,"RunningGroundContactTime","average"), betterHigher: false },
    { key: "mets",       label: "Average METs",        unit: "",       from: w => w.meta?.averageMETs, betterHigher: true },
  ],
  Walking: [
    { key: "distance",   label: "Distance",            unit: "km",     from: w => w.totalDistance, betterHigher: true },
    { key: "duration",   label: "Duration",            unit: "min",    from: w => w.duration,      betterHigher: true },
    { key: "hrAvg",      label: "Avg heart rate",      unit: "bpm",    from: w => stat(w,"HeartRate","average"), betterHigher: false },
    { key: "energy",     label: "Active calories",     unit: "kcal",   from: w => w.totalEnergyBurned, betterHigher: true },
    { key: "mets",       label: "Average METs",        unit: "",       from: w => w.meta?.averageMETs, betterHigher: true },
  ],
  Swimming: [
    { key: "distance",   label: "Distance",            unit: "m",      from: w => w.totalDistance ? w.totalDistance * 1000 : null, betterHigher: true },
    { key: "duration",   label: "Duration",            unit: "min",    from: w => w.duration,      betterHigher: true },
    { key: "strokes",    label: "Stroke count",        unit: "",       from: w => stat(w,"SwimmingStrokeCount","sum"), betterHigher: false },
    { key: "hrAvg",      label: "Avg heart rate",      unit: "bpm",    from: w => stat(w,"HeartRate","average"), betterHigher: false },
    { key: "energy",     label: "Active calories",     unit: "kcal",   from: w => w.totalEnergyBurned, betterHigher: true },
  ],
  Yoga: yogaPilatesMetrics(),
  Pilates: yogaPilatesMetrics(),
  TraditionalStrengthTraining: strengthMetrics(),
  FunctionalStrengthTraining: strengthMetrics(),
  HighIntensityIntervalTraining: [
    { key: "duration",   label: "Duration",            unit: "min",    from: w => w.duration,      betterHigher: true },
    { key: "hrAvg",      label: "Avg heart rate",      unit: "bpm",    from: w => stat(w,"HeartRate","average"), betterHigher: false },
    { key: "hrMax",      label: "Peak heart rate",     unit: "bpm",    from: w => stat(w,"HeartRate","maximum"), betterHigher: false },
    { key: "energy",     label: "Active calories",     unit: "kcal",   from: w => w.totalEnergyBurned, betterHigher: true },
    { key: "mets",       label: "Average METs",        unit: "",       from: w => w.meta?.averageMETs, betterHigher: true },
  ],
  Hiking: [
    { key: "distance",   label: "Distance",            unit: "km",     from: w => w.totalDistance, betterHigher: true },
    { key: "duration",   label: "Duration",            unit: "min",    from: w => w.duration,      betterHigher: true },
    { key: "hrAvg",      label: "Avg heart rate",      unit: "bpm",    from: w => stat(w,"HeartRate","average"), betterHigher: false },
    { key: "energy",     label: "Active calories",     unit: "kcal",   from: w => w.totalEnergyBurned, betterHigher: true },
  ],
  Other: [
    { key: "duration",   label: "Duration",            unit: "min",    from: w => w.duration,      betterHigher: true },
    { key: "hrAvg",      label: "Avg heart rate",      unit: "bpm",    from: w => stat(w,"HeartRate","average"), betterHigher: false },
    { key: "energy",     label: "Active calories",     unit: "kcal",   from: w => w.totalEnergyBurned, betterHigher: true },
  ],
};
CATEGORY_METRICS.Sailing = CATEGORY_METRICS.Other;

const ALL_METRICS = [
  { key: "duration",   label: "Duration",            unit: "min",    from: w => w.duration,      betterHigher: true },
  { key: "distance",   label: "Distance",            unit: "km",     from: w => w.totalDistance, betterHigher: true },
  { key: "hrAvg",      label: "Avg heart rate",      unit: "bpm",    from: w => stat(w,"HeartRate","average"), betterHigher: false },
  { key: "energy",     label: "Active calories",     unit: "kcal",   from: w => w.totalEnergyBurned, betterHigher: true },
  { key: "mets",       label: "Average METs",        unit: "",       from: w => w.meta?.averageMETs, betterHigher: true },
];

function yogaPilatesMetrics() {
  return [
    { key: "duration", label: "Duration",       unit: "min",  from: w => w.duration, betterHigher: true },
    { key: "hrAvg",    label: "Avg heart rate", unit: "bpm",  from: w => stat(w,"HeartRate","average"), betterHigher: false },
    { key: "energy",   label: "Active calories",unit: "kcal", from: w => w.totalEnergyBurned, betterHigher: true },
    { key: "mets",     label: "Average METs",   unit: "",     from: w => w.meta?.averageMETs, betterHigher: true },
  ];
}
function strengthMetrics() {
  return [
    { key: "duration", label: "Duration",        unit: "min",  from: w => w.duration, betterHigher: true },
    { key: "hrAvg",    label: "Avg heart rate",  unit: "bpm",  from: w => stat(w,"HeartRate","average"), betterHigher: false },
    { key: "hrMax",    label: "Peak heart rate", unit: "bpm",  from: w => stat(w,"HeartRate","maximum"), betterHigher: false },
    { key: "energy",   label: "Active calories", unit: "kcal", from: w => w.totalEnergyBurned, betterHigher: true },
    { key: "mets",     label: "Average METs",    unit: "",     from: w => w.meta?.averageMETs, betterHigher: true },
  ];
}

/* ---------- Helpers ---------- */

function stat(w, key, agg) {
  const s = w?.stats?.[key];
  if (!s) return null;
  const v = s[agg];
  return typeof v === "number" ? v : null;
}

function avgSpeedKmh(w) {
  if (!w.totalDistance || !w.duration) return null;
  const km = w.totalDistance;
  const hr = w.duration / 60;
  return hr > 0 ? km / hr : null;
}

function paceMinPerKm(w) {
  if (!w.totalDistance || !w.duration) return null;
  return w.duration / w.totalDistance;
}

function parseStartDate(s) {
  // "2025-11-02 15:23:29 +0700" -> Date
  if (!s) return null;
  // Replace space between date and time so Safari/old browsers parse it.
  const iso = s.replace(" ", "T").replace(/ ([+-]\d{4})$/, "$1");
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
  if (!(d instanceof Date)) d = parseStartDate(d);
  if (!d) return "—";
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD
}
function fmtDateLong(d) {
  if (!(d instanceof Date)) d = parseStartDate(d);
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
function fmtNum(v, digits = 1) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toLocaleString("en-US", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}
function fmtInt(v) { return v == null ? "—" : Math.round(v).toLocaleString(); }
function fmtDuration(min) {
  if (min == null || isNaN(min)) return "—";
  const total = Math.round(min * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,"0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2,"0")}s`;
  return `${s}s`;
}
function fmtPace(minPerKm) {
  if (minPerKm == null || isNaN(minPerKm) || !isFinite(minPerKm)) return "—";
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2,"0")}/km`;
}
function rolling(values, window) {
  if (!window || window <= 1) return values.slice();
  const out = new Array(values.length).fill(null);
  let sum = 0, n = 0;
  const buf = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v === "number") {
      buf.push(v);
      sum += v; n++;
      if (buf.length > window) { sum -= buf.shift(); n--; }
      out[i] = sum / n;
    } else {
      // Skip null without breaking the rolling window.
      out[i] = buf.length ? sum / n : null;
    }
  }
  return out;
}

function workoutId(w, idx) { return `${w.startDate}|${w.type}|${idx}`; }

/* ---------- Loading ---------- */

async function load() {
  const r = await fetch("workouts.json", { cache: "no-store" });
  if (!r.ok) throw new Error("workouts.json missing — run extract_workouts.py");
  const data = await r.json();
  STATE.raw = data.workouts.map((w, i) => ({ ...w, _id: workoutId(w, i), _date: parseStartDate(w.startDate) }))
                          .filter(w => w._date);
  initUI();
}

function initUI() {
  renderHeader();
  renderSummary();
  renderCategoryNav();
  bindControls();
  renderAll();
}

function renderHeader() {
  const dates = STATE.raw.map(w => w._date.getTime()).sort((a,b) => a-b);
  const first = new Date(dates[0]);
  const last  = new Date(dates[dates.length - 1]);
  const span = `${first.toLocaleDateString("en-US",{month:"short",year:"numeric"})}` +
               ` – ${last.toLocaleDateString("en-US",{month:"short",year:"numeric"})}`;
  document.getElementById("topbar-meta").innerHTML =
    `<div>${STATE.raw.length} sessions tracked</div><div>${span}</div>`;
}

function renderSummary() {
  const w = STATE.raw;
  const totalMin = w.reduce((s,x) => s + (x.duration || 0), 0);
  const totalKm  = w.reduce((s,x) => s + (x.totalDistance || 0), 0);
  const totalKc  = w.reduce((s,x) => s + (x.totalEnergyBurned || 0), 0);
  // Avg sessions per week, computed across the whole tracked span.
  const dates = w.map(x => x._date.getTime());
  const span  = (Math.max(...dates) - Math.min(...dates)) / (1000 * 60 * 60 * 24 * 7);
  const perWeek = span > 0 ? w.length / span : 0;

  const cards = [
    { label: "Total sessions", value: w.length.toLocaleString(), hint: `${perWeek.toFixed(1)} / week avg` },
    { label: "Total time",     value: `${Math.round(totalMin/60).toLocaleString()} h`, hint: `${Math.round(totalMin).toLocaleString()} minutes` },
    { label: "Total distance", value: `${Math.round(totalKm).toLocaleString()} km`, hint: "across all activity types" },
    { label: "Active calories",value: `${Math.round(totalKc).toLocaleString()} kcal`, hint: "lifetime active burn" },
  ];
  document.getElementById("summary").innerHTML = cards.map(c => `
    <div class="stat-card">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
      <div class="hint">${c.hint}</div>
    </div>`).join("");
}

function categoryCounts() {
  const counts = {};
  for (const w of STATE.raw) counts[w.type] = (counts[w.type] || 0) + 1;
  // Sort by count, descending
  return Object.entries(counts).sort((a,b) => b[1] - a[1]);
}

function renderCategoryNav() {
  const counts = categoryCounts();
  const nav = document.getElementById("category-nav");
  const all = `<button class="category-chip" role="tab" data-cat="All" aria-selected="${STATE.category === "All"}">All<span class="count">${STATE.raw.length}</span></button>`;
  const items = counts.map(([t, n]) => `
    <button class="category-chip" role="tab" data-cat="${t}" aria-selected="${STATE.category === t}">
      ${TYPE_LABELS[t] || t}<span class="count">${n}</span>
    </button>`).join("");
  nav.innerHTML = all + items;
  nav.onclick = e => {
    const btn = e.target.closest("[data-cat]");
    if (!btn) return;
    STATE.category = btn.dataset.cat;
    [...nav.querySelectorAll("[data-cat]")].forEach(b =>
      b.setAttribute("aria-selected", b.dataset.cat === STATE.category ? "true" : "false"));
    renderAll();
  };
}

function bindControls() {
  document.getElementById("range-select").onchange = e => {
    STATE.rangeDays = e.target.value; renderTrends();
  };
  document.getElementById("smooth-select").onchange = e => {
    STATE.smoothing = Number(e.target.value); renderTrends();
  };
  document.getElementById("search-input").oninput = e => {
    STATE.search = e.target.value.trim().toLowerCase();
    renderSessions();
  };
  document.getElementById("sort-select").onchange = e => {
    STATE.sortKey = e.target.value; renderSessions();
  };
  document.getElementById("detail-close").onclick = () => {
    STATE.selectedId = null; renderDetail(); renderSessions();
  };
  document.getElementById("compare-clear").onclick = () => {
    STATE.compareA = null; STATE.compareB = null;
    renderCompare(); renderSessions();
  };
}

/* ---------- Filtering ---------- */

function categoryWorkouts() {
  if (STATE.category === "All") return STATE.raw;
  return STATE.raw.filter(w => w.type === STATE.category);
}

function rangeFiltered(list) {
  if (STATE.rangeDays === "all") return list;
  const days = Number(STATE.rangeDays);
  const cutoff = Date.now() - days * 86400 * 1000;
  return list.filter(w => w._date.getTime() >= cutoff);
}

function searchFiltered(list) {
  if (!STATE.search) return list;
  const q = STATE.search;
  return list.filter(w => {
    if ((TYPE_LABELS[w.type] || w.type).toLowerCase().includes(q)) return true;
    if (fmtDate(w._date).includes(q)) return true;
    if (w.startDate?.toLowerCase().includes(q)) return true;
    return false;
  });
}

function sortSessions(list) {
  const arr = list.slice();
  switch (STATE.sortKey) {
    case "date-asc":     arr.sort((a,b) => a._date - b._date); break;
    case "duration-desc":arr.sort((a,b) => (b.duration||0) - (a.duration||0)); break;
    case "distance-desc":arr.sort((a,b) => (b.totalDistance||0) - (a.totalDistance||0)); break;
    case "energy-desc":  arr.sort((a,b) => (b.totalEnergyBurned||0) - (a.totalEnergyBurned||0)); break;
    case "hr-desc":      arr.sort((a,b) => (stat(b,"HeartRate","average")||0) - (stat(a,"HeartRate","average")||0)); break;
    default:             arr.sort((a,b) => b._date - a._date);
  }
  return arr;
}

/* ---------- Render ---------- */

function renderAll() {
  renderTrends();
  renderSessions();
  renderDetail();
  renderCompare();
}

function renderTrends() {
  const grid = document.getElementById("chart-grid");
  // Tear down previous charts to free canvas state
  Object.values(STATE.charts).flat().forEach(c => { try { c.destroy(); } catch(_){} });
  STATE.charts = {};

  const list = rangeFiltered(categoryWorkouts());
  const titleEl = document.getElementById("trends-title");
  const subEl   = document.getElementById("trends-sub");

  const catLabel = STATE.category === "All" ? "all sessions" : (TYPE_LABELS[STATE.category] || STATE.category);
  titleEl.textContent = `Adaptation trends — ${catLabel}`;
  subEl.textContent = list.length
    ? `${list.length} sessions plotted${STATE.smoothing>1 ? ` · ${STATE.smoothing}-session moving average` : ""}.`
    : "No sessions in the selected range.";

  if (!list.length) {
    grid.innerHTML = `<div class="chart-empty">No sessions to chart for this category and range.</div>`;
    return;
  }

  const sorted = list.slice().sort((a,b) => a._date - b._date);
  const labels = sorted.map(w => fmtDate(w._date));
  const metrics = STATE.category === "All"
    ? ALL_METRICS
    : (CATEGORY_METRICS[STATE.category] || ALL_METRICS);

  const tiles = [];
  STATE.charts.list = [];

  metrics.forEach((m, i) => {
    const raw = sorted.map(w => {
      const v = m.from(w);
      return typeof v === "number" && isFinite(v) ? v : null;
    });
    if (!raw.some(v => v != null)) return; // skip metrics with no data

    const smoothed = rolling(raw, STATE.smoothing);
    const valid = raw.filter(v => v != null);
    const first = valid[0];
    const last  = valid[valid.length - 1];
    let deltaHTML = "";
    if (valid.length >= 3 && first != null && last != null && first !== 0) {
      const pct = ((last - first) / Math.abs(first)) * 100;
      const direction = (pct >= 0) === !!m.betterHigher ? "up" : "down";
      const arrow = pct >= 0 ? "▲" : "▼";
      deltaHTML = `<span class="delta ${direction}">${arrow} ${fmtNum(Math.abs(pct), 1)}%</span>`;
    }

    const id = `chart-${m.key}-${i}`;
    tiles.push(`
      <div class="chart-tile">
        <h3>${m.label}</h3>
        <div class="chart-meta">
          <span>${m.unit ? `${m.unit}` : ""}${valid.length ? ` · latest ${fmtNum(last, m.key === "duration" || m.key === "energy" ? 0 : 2)}` : ""}</span>
          ${deltaHTML}
        </div>
        <canvas id="${id}"></canvas>
      </div>`);

    queueMicrotask(() => {
      const ctx = document.getElementById(id);
      if (!ctx) return;
      const chart = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [
            STATE.smoothing > 1 ? {
              label: m.label + " (raw)",
              data: raw,
              borderColor: "rgba(31, 78, 163, 0.18)",
              backgroundColor: "rgba(31, 78, 163, 0.05)",
              borderWidth: 1,
              pointRadius: 0,
              tension: 0.2,
              spanGaps: true,
              fill: false,
            } : null,
            {
              label: m.label,
              data: smoothed,
              borderColor: "#1f4ea3",
              backgroundColor: "rgba(31, 78, 163, 0.10)",
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.25,
              spanGaps: true,
              fill: true,
            }
          ].filter(Boolean),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: items => labels[items[0].dataIndex],
                label: item => `${m.label}: ${fmtNum(item.parsed.y, 2)} ${m.unit}`,
              }
            }
          },
          scales: {
            x: { ticks: { maxTicksLimit: 6, color: "#7b8290", font: { size: 10 } }, grid: { display: false } },
            y: { ticks: { color: "#7b8290", font: { size: 10 } }, grid: { color: "#eef0f4" } }
          }
        }
      });
      STATE.charts.list.push(chart);
    });
  });

  grid.innerHTML = tiles.join("") || `<div class="chart-empty">No chartable metrics for this category.</div>`;
}

function renderSessions() {
  const list = sortSessions(searchFiltered(rangeFiltered(categoryWorkouts())));
  const tbody = document.querySelector("#session-list tbody");
  const empty = document.getElementById("empty-msg");

  if (!list.length) {
    tbody.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = list.map(w => {
    const hr = stat(w, "HeartRate", "average");
    const dist = w.totalDistance;
    const distUnit = w.totalDistanceUnit || "";
    const energy = w.totalEnergyBurned;
    const mets = w.meta?.averageMETs;
    const cls = [
      STATE.selectedId === w._id ? "is-selected" : "",
      STATE.compareA === w._id ? "compare-a" : "",
      STATE.compareB === w._id ? "compare-b" : "",
    ].filter(Boolean).join(" ");
    return `
      <tr data-id="${w._id}" class="${cls}">
        <td>${fmtDate(w._date)}</td>
        <td class="type-cell">${TYPE_LABELS[w.type] || w.type}</td>
        <td>${fmtDuration(w.duration)}</td>
        <td>${dist != null ? `${fmtNum(dist, 2)} ${distUnit}` : "—"}</td>
        <td>${hr != null ? fmtInt(hr) : "—"}</td>
        <td>${energy != null ? `${fmtInt(energy)} kcal` : "—"}</td>
        <td>${mets != null ? fmtNum(mets, 1) : "—"}</td>
        <td class="compare-cell">
          <button class="compare-btn ${STATE.compareA === w._id ? "is-active a" : ""}" data-pick="A" data-id="${w._id}">A</button>
          <button class="compare-btn ${STATE.compareB === w._id ? "is-active b" : ""}" data-pick="B" data-id="${w._id}">B</button>
        </td>
      </tr>`;
  }).join("");

  tbody.onclick = e => {
    const btn = e.target.closest(".compare-btn");
    if (btn) {
      e.stopPropagation();
      const slot = btn.dataset.pick;
      const id = btn.dataset.id;
      if (slot === "A") {
        STATE.compareA = STATE.compareA === id ? null : id;
        if (STATE.compareB === id) STATE.compareB = null;
      } else {
        STATE.compareB = STATE.compareB === id ? null : id;
        if (STATE.compareA === id) STATE.compareA = null;
      }
      renderSessions(); renderCompare();
      return;
    }
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    STATE.selectedId = tr.dataset.id;
    renderSessions(); renderDetail();
    document.getElementById("detail-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
}

function findById(id) { return STATE.raw.find(w => w._id === id); }

function detailTiles(w) {
  const tiles = [];
  const push = (k, v, x = "") => { if (v !== "—" && v != null) tiles.push({ k, v, x }); };

  push("Type", TYPE_LABELS[w.type] || w.type);
  push("Started", fmtDateLong(w._date));
  push("Duration", fmtDuration(w.duration));
  if (w.totalDistance != null) push("Distance", `${fmtNum(w.totalDistance, 2)} ${w.totalDistanceUnit || ""}`);
  if (w.totalEnergyBurned != null) push("Active energy", `${fmtInt(w.totalEnergyBurned)} kcal`);
  if (w.meta?.averageMETs != null) push("Avg METs", fmtNum(w.meta.averageMETs, 2));

  const hrAvg = stat(w, "HeartRate", "average");
  const hrMin = stat(w, "HeartRate", "minimum");
  const hrMax = stat(w, "HeartRate", "maximum");
  if (hrAvg != null) push("Avg heart rate", `${fmtInt(hrAvg)} bpm`, hrMin != null ? `${fmtInt(hrMin)}–${fmtInt(hrMax)} range` : "");
  if (hrMax != null && hrAvg == null) push("Peak heart rate", `${fmtInt(hrMax)} bpm`);

  if (w.type === "Running") {
    const sp = stat(w, "RunningSpeed", "average");
    if (sp != null) push("Avg pace", fmtPace(60 / sp));
    const power = stat(w, "RunningPower", "average");
    if (power != null) push("Running power", `${fmtInt(power)} W`);
    const stride = stat(w, "RunningStrideLength", "average");
    if (stride != null) push("Stride length", `${fmtNum(stride, 2)} m`);
    const vert = stat(w, "RunningVerticalOscillation", "average");
    if (vert != null) push("Vertical oscillation", `${fmtNum(vert, 1)} cm`);
    const gct = stat(w, "RunningGroundContactTime", "average");
    if (gct != null) push("Ground contact", `${fmtInt(gct)} ms`);
  }
  if (w.type === "Cycling" || w.type === "Walking" || w.type === "Hiking") {
    const sp = avgSpeedKmh(w);
    if (sp != null) push("Avg speed", `${fmtNum(sp, 2)} km/h`);
  }
  const steps = stat(w, "StepCount", "sum");
  if (steps != null) push("Steps", fmtInt(steps));
  const strokes = stat(w, "SwimmingStrokeCount", "sum");
  if (strokes != null) push("Swim strokes", fmtInt(strokes));

  if (w.meta?.tempC != null) push("Weather", `${fmtNum(w.meta.tempC, 0)} °C`, w.meta.humidity != null ? `${fmtNum(w.meta.humidity,0)}% humidity` : "");
  push("Indoor", w.meta?.indoor ? "Yes" : "No");
  if (w.source) push("Source", w.source);

  return tiles;
}

function renderDetail() {
  const card = document.getElementById("detail-card");
  if (!STATE.selectedId) { card.hidden = true; return; }
  const w = findById(STATE.selectedId);
  if (!w) { card.hidden = true; return; }
  card.hidden = false;
  document.getElementById("detail-title").textContent =
    `${TYPE_LABELS[w.type] || w.type} · ${fmtDate(w._date)}`;
  document.getElementById("detail-sub").textContent = fmtDateLong(w._date);

  document.getElementById("detail-grid").innerHTML = detailTiles(w).map(t => `
    <div class="detail-tile">
      <div class="k">${t.k}</div>
      <div class="v">${t.v}</div>
      ${t.x ? `<div class="x">${t.x}</div>` : ""}
    </div>`).join("");
}

function renderCompare() {
  const card = document.getElementById("compare-card");
  const a = STATE.compareA ? findById(STATE.compareA) : null;
  const b = STATE.compareB ? findById(STATE.compareB) : null;
  if (!a && !b) { card.hidden = true; return; }
  card.hidden = false;

  document.getElementById("compare-a-title").textContent =
    a ? `${TYPE_LABELS[a.type] || a.type} · ${fmtDate(a._date)}` : "(none)";
  document.getElementById("compare-b-title").textContent =
    b ? `${TYPE_LABELS[b.type] || b.type} · ${fmtDate(b._date)}` : "(none)";

  // Build the union of metric rows from both selections so we never hide data
  // that's only present on one side.
  const metricSet = new Map();
  const addRows = (w) => {
    if (!w) return;
    detailTiles(w).forEach(t => {
      if (!metricSet.has(t.k)) metricSet.set(t.k, true);
    });
  };
  addRows(a); addRows(b);

  // Numeric metrics for delta arrows
  const numericMetrics = [
    { k: "Duration",         get: w => w.duration,                   unit: "min", betterHigher: true,  fmt: v => fmtDuration(v) },
    { k: "Distance",         get: w => w.totalDistance,              unit: "km",  betterHigher: true,  fmt: (v,w) => `${fmtNum(v,2)} ${w.totalDistanceUnit||""}` },
    { k: "Active energy",    get: w => w.totalEnergyBurned,          unit: "kcal",betterHigher: true,  fmt: v => `${fmtInt(v)} kcal` },
    { k: "Avg METs",         get: w => w.meta?.averageMETs,          unit: "",    betterHigher: true,  fmt: v => fmtNum(v,2) },
    { k: "Avg heart rate",   get: w => stat(w,"HeartRate","average"),unit: "bpm", betterHigher: false, fmt: v => `${fmtInt(v)} bpm` },
    { k: "Peak heart rate",  get: w => stat(w,"HeartRate","maximum"),unit: "bpm", betterHigher: false, fmt: v => `${fmtInt(v)} bpm` },
    { k: "Avg speed",        get: w => avgSpeedKmh(w),               unit: "km/h",betterHigher: true,  fmt: v => `${fmtNum(v,2)} km/h` },
    { k: "Avg pace",         get: w => paceMinPerKm(w),              unit: "min/km", betterHigher: false, fmt: v => fmtPace(v) },
    { k: "Running power",    get: w => stat(w,"RunningPower","average"), unit: "W", betterHigher: true, fmt: v => `${fmtInt(v)} W` },
    { k: "Stride length",    get: w => stat(w,"RunningStrideLength","average"), unit: "m", betterHigher: true, fmt: v => `${fmtNum(v,2)} m` },
    { k: "Vertical oscillation", get: w => stat(w,"RunningVerticalOscillation","average"), unit: "cm", betterHigher: false, fmt: v => `${fmtNum(v,1)} cm` },
    { k: "Ground contact",   get: w => stat(w,"RunningGroundContactTime","average"), unit: "ms", betterHigher: false, fmt: v => `${fmtInt(v)} ms` },
    { k: "Steps",            get: w => stat(w,"StepCount","sum"),    unit: "",    betterHigher: true,  fmt: v => fmtInt(v) },
  ];

  const rows = [];
  rows.push(`<tr><td class="metric">Date</td><td>${a ? fmtDateLong(a._date) : "—"}</td><td>${b ? fmtDateLong(b._date) : "—"}</td><td class="delta">—</td></tr>`);
  rows.push(`<tr><td class="metric">Type</td><td>${a ? (TYPE_LABELS[a.type]||a.type) : "—"}</td><td>${b ? (TYPE_LABELS[b.type]||b.type) : "—"}</td><td class="delta">—</td></tr>`);

  for (const m of numericMetrics) {
    const va = a ? m.get(a) : null;
    const vb = b ? m.get(b) : null;
    if (va == null && vb == null) continue;
    let deltaHTML = "—", deltaCls = "";
    if (va != null && vb != null && va !== 0) {
      const diff = vb - va;
      const pct = (diff / Math.abs(va)) * 100;
      const positive = diff >= 0;
      const better = (positive === !!m.betterHigher);
      deltaCls = better ? "up" : "down";
      const sign = positive ? "+" : "−";
      deltaHTML = `${sign}${fmtNum(Math.abs(pct), 1)}%`;
    }
    rows.push(`
      <tr>
        <td class="metric">${m.k}</td>
        <td>${va != null ? m.fmt(va, a) : "—"}</td>
        <td>${vb != null ? m.fmt(vb, b) : "—"}</td>
        <td class="delta ${deltaCls}">${deltaHTML}</td>
      </tr>`);
  }

  const table = document.getElementById("compare-table");
  table.innerHTML = `
    <thead>
      <tr>
        <th></th>
        <th></th>
        <th></th>
        <th>Δ B vs A</th>
      </tr>
    </thead>
    <tbody>${rows.join("")}</tbody>`;
  // Style the header row as muted
  table.querySelectorAll("thead th").forEach(th => {
    th.style.color = "var(--muted)";
    th.style.fontSize = "11px";
    th.style.textTransform = "uppercase";
    th.style.letterSpacing = "0.05em";
    th.style.fontWeight = "600";
    th.style.textAlign = "left";
    th.style.padding = "8px 12px";
    th.style.borderBottom = "1px solid var(--border)";
  });
}

/* ---------- Boot ---------- */

load().catch(err => {
  document.body.innerHTML = `
    <div style="padding:32px; font-family:system-ui;">
      <h2>Couldn't load workouts.json</h2>
      <p>${err.message}</p>
      <p>Run <code>python3 extract_workouts.py</code> in this folder, then serve it
        with a local web server (e.g. <code>python3 -m http.server</code>) and refresh.</p>
    </div>`;
});
