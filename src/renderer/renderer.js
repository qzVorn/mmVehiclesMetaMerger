/* =========================================================================
   renderer.js - all UI behaviour. Talks to the engine only through the
   `merger` bridge exposed in preload.js.
   ====================================================================== */

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const el = {
    sourcePath:   $("#sourcePath"),
    pathDisplay:  $("#pathDisplay"),
    recentList:   $("#recentList"),
    statusPill:   $("#statusPill"),
    rings:        $("#rings"),
    log:          $("#log"),
    logCount:     $("#logCount"),
    opsGrid:      $("#opsGrid"),
    opsHint:      $("#opsHint"),
    tabs:         $("#tabs"),
    hero:         $(".hero"),
    heroOp:       $("#heroOp"),
    heroTicks:    $("#heroTicks"),
    heroBars:     $("#heroBars"),
    ringProgress: $("#ringProgress"),
    statStaged:   $("#statStaged"),
    statMerged:   $("#statMerged"),
    outputCards:  $("#outputCards"),
    dockLeft:     $("#dockLeft"),
    dockRight:    $("#dockRight"),
    dockPrimary:  $("#dockPrimary"),
    workspaceName:$("#workspaceName"),
    appVersion:   $("#appVersion"),
    modalScrim:   $("#modalScrim"),
    modalTitle:   $("#modalTitle"),
    modalBody:    $("#modalBody"),
    modalConfirm: $("#modalConfirm"),
    toasts:       $("#toasts")
};

const state = {
    operations: [],
    activeGroup: "merge",
    busy: false,
    baseDir: "",
    sourceDir: "",
    emergencyFlags: [],
    logLines: 0,
    recents: [],
    outputView: { level: "root", run: null },
    runs: [],
    unsorted: []
};

/* ---------------------------------------------------------------- meta -- */

const RING_META = [
    { key: "vehicles",        icon: "i-car",     label: "Vehicles" },
    { key: "carcols",         icon: "i-palette", label: "Carcols" },
    { key: "carvariations",   icon: "i-layers",  label: "Car Var" },
    { key: "handling",        icon: "i-gauge",   label: "Handling" },
    { key: "vehiclelayouts",  icon: "i-seat",    label: "Layouts" }
];

const OUTPUT_META = [
    { key: "vehicles",       label: "vehicles.meta" },
    { key: "carcols",        label: "carcols.meta" },
    { key: "carvariations",  label: "carvariations.meta" },
    { key: "handling",       label: "handling.meta" },
    { key: "vehiclelayouts", label: "vehiclelayouts.meta" },
    { key: "modelNames",     label: "model names" }
];

const OP_SUB = {
    1:  "vehicles_meta into output",
    2:  "carcols_meta into output",
    3:  "carvariations_meta into output",
    4:  "handling_meta into output",
    5:  "vehiclelayouts_meta into output",
    6:  "All five merges, in sequence",
    7:  "Recursive scan of the source folder",
    8:  "Recursive scan of the source folder",
    9:  "Recursive scan of the source folder",
    10: "Recursive scan of the source folder",
    11: "Recursive scan of the source folder",
    12: "All five imports, in sequence",
    13: "Import, merge, then stamp the flags",
    14: "Custom glob pattern, custom destination",
    15: "Writes output/exportedModelNames.txt",
    16: "Close the merger"
};

/* --------------------------------------------------------------- boot -- */

async function boot() {
    buildHeroDecor();

    const [info, ops, flags] = await Promise.all([
        merger.appInfo(),
        merger.listOperations(),
        merger.emergencyFlags()
    ]);

    state.baseDir = info.baseDir;
    state.operations = ops;
    state.emergencyFlags = flags;

    el.workspaceName.textContent = basename(info.baseDir) || info.baseDir;
    el.workspaceName.title = info.baseDir;
    el.appVersion.textContent = "v" + info.version;

    state.recents = readRecents();
    renderRecents();
    renderRings(null);
    renderOutputs();
    renderOps();

    buildDock();
    wireEvents();

    pushLog({ level: "info", text: `Workspace: ${info.baseDir}`, time: Date.now() });
    pushLog({ level: "muted", text: "Pick a source directory, then choose an operation.", time: Date.now() });

    await refreshStats();
}

/* ----------------------------------------------------------- decoration -- */

function buildHeroDecor() {
    // Tick ring around the hero, mirroring a dial face.
    const cx = 260, cy = 260, count = 72;
    let markup = "";
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        const major = i % 6 === 0;
        const outer = 226;
        const inner = major ? 212 : 219;
        const x1 = cx + Math.cos(angle) * inner;
        const y1 = cy + Math.sin(angle) * inner;
        const x2 = cx + Math.cos(angle) * outer;
        const y2 = cy + Math.sin(angle) * outer;
        markup += `<line class="hero-tick${major ? " major" : ""}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    }
    el.heroTicks.innerHTML = markup;

    // Decorative level bars to the right of the hero.
    const widths = [26, 40, 18, 52, 32, 44, 22];
    el.heroBars.innerHTML = widths.map((w) => `<i style="width:${w}px"></i>`).join("");
}

/* -------------------------------------------------------------- render -- */

function renderRings(stats) {
    el.rings.innerHTML = RING_META.map((meta) => {
        const count = stats ? (stats.staged[meta.key] || 0) : 0;
        // Ring fills relative to the busiest folder so the row reads as a set.
        const max = stats ? Math.max(1, ...Object.values(stats.staged)) : 1;
        const pct = count === 0 ? 0 : Math.max(0.12, count / max);
        const circumference = 2 * Math.PI * 20;
        const offset = circumference * (1 - pct);
        return `
        <div class="ring-stat" data-empty="${count === 0}" title="${count} staged ${meta.label} file(s)">
          <div class="ring-wrap">
            <svg viewBox="0 0 46 46">
              <circle class="ring-track" cx="23" cy="23" r="20"/>
              <circle class="ring-value" cx="23" cy="23" r="20"
                      stroke-dasharray="${circumference.toFixed(1)}"
                      stroke-dashoffset="${offset.toFixed(1)}"/>
            </svg>
            <span class="ring-icon"><svg class="ic ic-18"><use href="#${meta.icon}"/></svg></span>
          </div>
          <span class="ring-figure">${count}</span>
          <span class="ring-label">${meta.label}</span>
        </div>`;
    }).join("");
}

function fileCardsHtml(files) {
    return files.map((f) => `
        <button class="out-card" type="button"
                data-exists="${f.exists}"
                data-path="${escapeAttr(f.path || "")}"
                title="${f.exists ? "Reveal " + f.path : f.name + " was not produced by this run"}">
          <span class="out-doc"><span class="out-size">${f.exists ? formatSize(f.size) : "—"}</span></span>
          <span class="out-name">${f.name === "exportedModelNames.txt" ? "model names" : f.name}</span>
        </button>`).join("");
}

function timeAgo(iso) {
    if (!iso) return "";
    const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 90) return "just now";
    if (secs < 3600) return Math.round(secs / 60) + "m ago";
    if (secs < 86400) return Math.round(secs / 3600) + "h ago";
    if (secs < 172800) return "yesterday";
    return Math.round(secs / 86400) + "d ago";
}

function renderOutputs() {
    const head = $("#outputHead");

    // ---------- inside one run ----------
    if (state.outputView.level === "run") {
        const run = state.runs.find((r) => r.name === state.outputView.run);
        if (!run) { state.outputView = { level: "root", run: null }; return renderOutputs(); }

        head.innerHTML = `
            <button class="crumb-back" id="crumbBack" type="button" title="All outputs">
              <svg class="ic ic-16"><use href="#i-chevron"/></svg>
            </button>
            <h2 title="${escapeAttr(run.name)}">${escapeHtml(run.name)}</h2>
            <button class="ghost-btn icon-only" id="revealRun" type="button" title="Open this folder">
              <svg class="ic ic-16"><use href="#i-open"/></svg>
            </button>`;

        el.outputCards.innerHTML = fileCardsHtml(run.files);
        $("#crumbBack").addEventListener("click", () => {
            state.outputView = { level: "root", run: null };
            renderOutputs();
        });
        $("#revealRun").addEventListener("click", () => merger.openPath(run.path));
        wireFileCards();
        return;
    }

    // ---------- the list of runs ----------
    head.innerHTML = `
        <h2>Output</h2>
        <button class="ghost-btn icon-only" id="refreshStats" type="button" title="Refresh">
          <svg class="ic ic-16"><use href="#i-refresh"/></svg>
        </button>`;

    const looseCount = state.unsorted.filter((f) => f.exists).length;

    let html = state.runs.map((run) => `
        <button class="run-card" type="button" data-run="${escapeAttr(run.name)}" title="${escapeAttr(run.source || run.path)}">
          <span class="out-folder"><span class="out-size">${run.files.filter((f) => f.exists).length}</span></span>
          <span class="run-name">${escapeHtml(run.name)}</span>
          <span class="run-sub">${run.vehicles !== null ? run.vehicles + " vehicle" + (run.vehicles === 1 ? "" : "s") : "—"}${run.created ? " · " + timeAgo(run.created) : ""}</span>
          <span class="run-del" data-del="${escapeAttr(run.name)}" title="Delete this output folder">
            <svg class="ic ic-14"><use href="#i-broom"/></svg>
          </span>
        </button>`).join("");

    if (looseCount) {
        html += `
        <button class="run-card is-unsorted" type="button" data-run="__unsorted__" title="Files sitting loose in the output folder">
          <span class="out-folder"><span class="out-size">${looseCount}</span></span>
          <span class="run-name">Unsorted</span>
          <span class="run-sub">not filed under a pack</span>
        </button>`;
    }

    if (!html) html = `<div class="run-empty">No outputs yet.<br>Run an import and merge to create one.</div>`;

    el.outputCards.innerHTML = html;

    el.outputCards.querySelectorAll(".run-card").forEach((card) => {
        card.addEventListener("click", async (e) => {
            const del = e.target.closest("[data-del]");
            if (del) {
                e.stopPropagation();
                const name = del.dataset.del;
                const ok = await confirmDelete(name);
                if (!ok) return;
                await merger.deleteRun(name);
                toast("success", `Deleted "${name}".`);
                await refreshStats();
                return;
            }

            const name = card.dataset.run;
            if (name === "__unsorted__") {
                state.runs = state.runs.concat([{ name: "__unsorted__", path: state.baseDir + "/output", files: state.unsorted, vehicles: null, created: null, source: null }]);
                state.outputView = { level: "run", run: "__unsorted__" };
            } else {
                state.outputView = { level: "run", run: name };
            }
            renderOutputs();
        });
    });
}

function wireFileCards() {
    el.outputCards.querySelectorAll(".out-card").forEach((card) => {
        card.addEventListener("click", () => {
            if (card.dataset.exists !== "true") {
                toast("info", "That file was not produced by this run.");
                return;
            }
            merger.revealPath(card.dataset.path);
        });
    });
}

function confirmDelete(name) {
    return openModal("Delete output folder", `
        <p class="field-note">
          This permanently deletes <strong>output/${escapeHtml(name)}/</strong> and every file inside it.
          The source pack on your drive is not touched.
        </p>
    `, "Delete").then((v) => v === true);
}

function renderOps() {
    const ops = state.operations.filter((op) => op.group === state.activeGroup);

    const hints = {
        merge: "Merges whatever is staged in the working folders",
        import: "Copies matching files out of the source directory",
        tools: "Utilities"
    };
    el.opsHint.textContent = hints[state.activeGroup] || "";

    el.opsGrid.innerHTML = ops.map((op) => {
        const flagged = op.id === 13;
        const danger = op.id === 16;
        const tag = op.needs === "sourceDir" ? "Source" : op.needs === "query" ? "Query" : "";
        return `
        <button class="op-card${flagged ? " is-flagged" : ""}${danger ? " is-danger" : ""}" type="button" data-id="${op.id}">
          <span class="op-num">${op.id}</span>
          <span class="op-body">
            <span class="op-label">${op.label}</span>
            <span class="op-meta">
              <span class="op-sub">${OP_SUB[op.id] || ""}</span>
              ${tag ? `<span class="op-tag">${tag}</span>` : ""}
            </span>
          </span>
          <svg class="ic ic-16 op-arrow"><use href="#i-chevron"/></svg>
        </button>`;
    }).join("");

    el.opsGrid.querySelectorAll(".op-card").forEach((card) => {
        card.addEventListener("click", () => runOperation(Number(card.dataset.id)));
    });

    syncBusyUI();
}

function buildDock() {
    const left = [
        { id: 6,  icon: "i-merge",    tip: "Merge all (6)" },
        { id: 12, icon: "i-download", tip: "Import all (12)" },
        { id: 15, icon: "i-tag",      tip: "Extract model names (15)" }
    ];
    const right = [
        { action: "openOutput", icon: "i-open",  tip: "Open output folder" },
        { action: "clear",      icon: "i-broom", tip: "Clear staged files" },
        { id: 16, icon: "i-power", tip: "Exit (16)", danger: true }
    ];

    const build = (items) => items.map((item) => `
        <button class="dock-btn${item.danger ? " danger" : ""}" type="button"
                ${item.id ? `data-id="${item.id}"` : `data-action="${item.action}"`}>
          <svg class="ic ic-22"><use href="#${item.icon}"/></svg>
          <span class="tip">${item.tip}</span>
        </button>`).join("");

    el.dockLeft.innerHTML = build(left);
    el.dockRight.innerHTML = build(right);

    $$(".dock-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (btn.dataset.id) runOperation(Number(btn.dataset.id));
            else if (btn.dataset.action === "openOutput") merger.openPath(state.baseDir + "/output");
            else if (btn.dataset.action === "clear") clearStaging();
        });
    });
}

/* ---------------------------------------------------------------- runs -- */

async function runOperation(id) {
    if (state.busy) { toast("info", "An operation is already running."); return; }
    const op = state.operations.find((o) => o.id === id);
    if (!op) return;

    if (id === 16) { merger.close(); return; }

    let payload = {};

    if (op.needs === "sourceDir") {
        const dir = await ensureSourceDir();
        if (!dir) return;
        payload.sourceDir = dir;
        if (id === 13) {
            const suggested = await merger.deriveName(dir);
            const chosen = await confirmFlags(dir, suggested);
            if (!chosen) return;
            payload.flags = state.emergencyFlags;
            payload.folderName = chosen.folderName;
        }
    }

    if (op.needs === "query") {
        const values = await askQuery();
        if (!values) return;
        payload = values;
    }

    const result = await merger.run(id, payload);

    if (result.ok) {
        setStatus("done", "DONE");
        toast("success", `${op.label} finished.`);
    } else {
        setStatus("error", "ERROR");
        toast("error", result.error || "Operation failed.");
    }

    await refreshStats();
    setTimeout(() => { if (!state.busy) setStatus("ready", "READY"); }, 2600);
}

async function ensureSourceDir() {
    const typed = el.sourcePath.value.trim();
    if (typed) { rememberRecent(typed); return typed; }

    const picked = await merger.pickFolder("Select the folder to scan for .meta files");
    if (!picked) { toast("info", "No source directory selected."); return null; }
    setSourceDir(picked);
    return picked;
}

async function clearStaging() {
    if (state.busy) return;
    const removed = await merger.clearStaging();
    toast(removed ? "success" : "info", removed ? `Cleared ${removed} staged file(s).` : "Nothing was staged.");
    await refreshStats();
}

/* -------------------------------------------------------------- modals -- */

let modalResolve = null;
let lastFolderName = "";

function openModal(title, bodyHtml, confirmLabel) {
    el.modalTitle.textContent = title;
    el.modalBody.innerHTML = bodyHtml;
    el.modalConfirm.textContent = confirmLabel || "Run";
    el.modalScrim.hidden = false;
    const firstInput = el.modalBody.querySelector("input");
    if (firstInput) setTimeout(() => firstInput.focus(), 40);
    return new Promise((resolve) => { modalResolve = resolve; });
}

function closeModal(value) {
    el.modalScrim.hidden = true;
    if (modalResolve) { modalResolve(value); modalResolve = null; }
}

function confirmFlags(dir, suggested) {
    const rows = state.emergencyFlags.map((flag) => `
        <div class="flag-row">
          <svg class="ic ic-16"><use href="#i-shield"/></svg>
          <span>${flag}</span>
        </div>`).join("");

    return openModal("Import all + Emergency Flags", `
        <p class="field-note">
          Every vehicles.meta, carcols.meta, carvariations.meta, handling.meta and
          vehiclelayouts.meta under the source folder is imported and merged exactly
          as option 12 does. The merged <strong>output/vehicles.meta</strong> then has these
          flags appended to every vehicle. A flag a vehicle already carries is not written twice.
        </p>
        <div class="field">
          <label>Flags to apply</label>
          <div class="flag-list">${rows}</div>
        </div>
        <div class="field">
          <label>Source directory</label>
          <div class="path-display is-set" style="margin:0">${escapeHtml(dir)}</div>
        </div>
        <div class="field">
          <label>Save results into output folder</label>
          <input id="runFolder" type="text" value="${escapeAttr(suggested || "")}" placeholder="folder name" />
          <span class="field-note">Taken from the pack folder. Change it if you want a different name.</span>
        </div>
    `, "Import, merge & flag").then((v) => (v === true ? { folderName: lastFolderName } : null));
}

async function askQuery() {
    const value = await openModal("Import files by search query", `
        <div class="field">
          <label>Search in</label>
          <div class="field-row">
            <input id="qFrom" type="text" placeholder="C:\\resources\\vehicles" value="${escapeAttr(state.sourceDir)}" />
            <button class="ghost-btn" data-pick="qFrom" type="button">Browse</button>
          </div>
        </div>
        <div class="field">
          <label>Copy into</label>
          <div class="field-row">
            <input id="qTo" type="text" placeholder="Destination folder" />
            <button class="ghost-btn" data-pick="qTo" type="button">Browse</button>
          </div>
        </div>
        <div class="field">
          <label>Glob query</label>
          <input id="qQuery" type="text" placeholder="**/*.ytd" />
          <span class="field-note">Same syntax the CLI used, for example <code>**/carcols.meta</code> or <code>**/*.ytd</code>.</span>
        </div>
    `, "Import");

    if (value !== true) return null;
    return value;
}

/* ---------------------------------------------------------------- misc -- */

function setSourceDir(dir) {
    state.sourceDir = dir;
    el.sourcePath.value = dir;
    el.pathDisplay.textContent = dir;
    el.pathDisplay.classList.add("is-set");
    rememberRecent(dir);
}

function setStatus(stateName, text) {
    el.statusPill.dataset.state = stateName;
    el.statusPill.querySelector(".status-text").textContent = text;
}

function syncBusyUI() {
    $$(".op-card, .dock-btn").forEach((b) => { b.disabled = state.busy; });
    el.dockPrimary.disabled = state.busy;
}

let progressTimer = null;

function startProgress() {
    el.hero.classList.add("is-working");
    const circumference = 942;
    let t = 0;
    stopProgress(false);
    progressTimer = setInterval(() => {
        t = (t + 0.035) % 1;
        // Eased sweep so the ring reads as activity rather than real progress.
        const eased = 0.5 - Math.cos(t * Math.PI * 2) / 2;
        el.ringProgress.style.strokeDashoffset = String(circumference * (1 - eased * 0.92));
        el.heroBars.querySelectorAll("i").forEach((bar, i) => {
            const w = 18 + Math.abs(Math.sin(t * Math.PI * 2 + i * 0.8)) * 38;
            bar.style.width = w.toFixed(0) + "px";
        });
    }, 40);
}

function stopProgress(reset) {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    if (reset !== false) {
        el.hero.classList.remove("is-working");
        el.ringProgress.style.strokeDashoffset = "942";
        const widths = [26, 40, 18, 52, 32, 44, 22];
        el.heroBars.querySelectorAll("i").forEach((bar, i) => { bar.style.width = widths[i] + "px"; });
    }
}

async function refreshStats() {
    const stats = await merger.stats();
    const out = await merger.listRuns();
    state.runs = out.runs;
    state.unsorted = out.unsorted;

    renderRings(stats);
    renderOutputs();

    const staged = Object.values(stats.staged).reduce((a, b) => a + b, 0);
    countUp(el.statStaged, staged);
    const newest = state.runs.find((r) => typeof r.vehicles === "number");
    countUp(el.statMerged, newest ? newest.vehicles : (stats.mergedVehicleCount || 0));
}

function countUp(node, target) {
    const from = Number(node.textContent) || 0;
    if (from === target) { node.textContent = String(target); return; }
    const steps = 16;
    let i = 0;
    const timer = setInterval(() => {
        i++;
        const eased = 1 - Math.pow(1 - i / steps, 3);
        node.textContent = String(Math.round(from + (target - from) * eased));
        if (i >= steps) { clearInterval(timer); node.textContent = String(target); }
    }, 18);
}

function pushLog(line) {
    if (el.log.querySelector(".log-empty")) el.log.innerHTML = "";
    const div = document.createElement("div");
    div.className = "log-line";
    div.dataset.level = line.level || "plain";
    const time = new Date(line.time || Date.now());
    div.innerHTML = `<span class="log-time">${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}</span><span class="log-text"></span>`;
    div.querySelector(".log-text").textContent = line.text;
    el.log.appendChild(div);

    while (el.log.children.length > 600) el.log.removeChild(el.log.firstChild);
    el.log.scrollTop = el.log.scrollHeight;

    state.logLines++;
    el.logCount.textContent = String(state.logLines);
}

function toast(kind, message) {
    const icons = { success: "i-shield", error: "i-siren", info: "i-list" };
    const node = document.createElement("div");
    node.className = "toast";
    node.dataset.kind = kind;
    node.innerHTML = `<svg class="ic ic-18"><use href="#${icons[kind] || "i-list"}"/></svg><span></span>`;
    node.querySelector("span").textContent = message;
    el.toasts.appendChild(node);
    setTimeout(() => {
        node.classList.add("is-out");
        setTimeout(() => node.remove(), 260);
    }, 3800);
}

/* -------------------------------------------------------------- events -- */

function wireEvents() {
    el.tabs.addEventListener("click", (e) => {
        const tab = e.target.closest(".tab");
        if (!tab) return;
        $$(".tab").forEach((t) => t.classList.toggle("is-active", t === tab));
        state.activeGroup = tab.dataset.group;
        renderOps();
    });

    $("#browseTop").addEventListener("click", pickSource);
    $("#browseSide").addEventListener("click", pickSource);

    el.sourcePath.addEventListener("change", () => {
        const v = el.sourcePath.value.trim();
        if (v) setSourceDir(v);
    });

    $("#clearLog").addEventListener("click", () => {
        el.log.innerHTML = '<div class="log-empty">Log cleared.</div>';
        state.logLines = 0;
        el.logCount.textContent = "0";
    });

    $("#refreshStats").addEventListener("click", refreshStats);
    $("#btnClearTop").addEventListener("click", clearStaging);
    $("#btnOpenBase").addEventListener("click", () => merger.openPath(state.baseDir));
    el.dockPrimary.addEventListener("click", () => runOperation(13));

    $("#winMin").addEventListener("click", () => merger.minimize());
    $("#winMax").addEventListener("click", () => merger.toggleMaximize());
    $("#winClose").addEventListener("click", () => merger.close());

    $("#modalClose").addEventListener("click", () => closeModal(false));
    $("#modalCancel").addEventListener("click", () => closeModal(false));
    el.modalScrim.addEventListener("mousedown", (e) => { if (e.target === el.modalScrim) closeModal(false); });

    el.modalConfirm.addEventListener("click", () => {
        const runFolder = $("#runFolder");
        if (runFolder) lastFolderName = runFolder.value.trim() || runFolder.placeholder;

        const from  = $("#qFrom");
        const to    = $("#qTo");
        const query = $("#qQuery");
        if (from && to && query) {
            if (!from.value.trim() || !to.value.trim() || !query.value.trim()) {
                toast("error", "All three fields are required.");
                return;
            }
            closeModal({ sourceDir: from.value.trim(), destDir: to.value.trim(), query: query.value.trim() });
            return;
        }
        closeModal(true);
    });

    el.modalBody.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-pick]");
        if (!btn) return;
        const picked = await merger.pickFolder("Select folder");
        if (picked) $("#" + btn.dataset.pick).value = picked;
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !el.modalScrim.hidden) closeModal(false);
        if (e.key === "Enter" && !el.modalScrim.hidden) el.modalConfirm.click();
    });

    el.recentList.addEventListener("click", (e) => {
        const item = e.target.closest(".recent-item");
        if (item) setSourceDir(item.dataset.path);
    });

    merger.onLog(pushLog);

    merger.onFatal(({ message }) => {
        setStatus("error", "ERROR");
        toast("error", message);
    });

    merger.onBusy(({ busy, label }) => {
        state.busy = busy;
        syncBusyUI();
        if (busy) {
            setStatus("working", "WORKING");
            el.heroOp.textContent = label;
            startProgress();
        } else {
            stopProgress(true);
            el.heroOp.textContent = "Idle — no operation running";
        }
    });
}

async function pickSource() {
    const picked = await merger.pickFolder("Select the folder to scan for .meta files");
    if (picked) setSourceDir(picked);
}

/* ------------------------------------------------------------- recents -- */

function readRecents() {
    try { return JSON.parse(localStorage.getItem("mm.recents") || "[]"); }
    catch (e) { return []; }
}

function rememberRecent(dir) {
    state.recents = [dir].concat(state.recents.filter((d) => d !== dir)).slice(0, 4);
    try { localStorage.setItem("mm.recents", JSON.stringify(state.recents)); } catch (e) { /* ignore */ }
    renderRecents();
}

function renderRecents() {
    el.recentList.innerHTML = state.recents.map((dir) => `
        <button class="recent-item" type="button" data-path="${escapeAttr(dir)}" title="${escapeAttr(dir)}">
          <svg class="ic ic-14"><use href="#i-folder"/></svg>
          <span>${escapeHtml(dir)}</span>
        </button>`).join("");
}

/* --------------------------------------------------------------- utils -- */

function pad(n) { return String(n).padStart(2, "0"); }
function basename(p) { return String(p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop(); }

function formatSize(bytes) {
    if (!bytes) return "0";
    if (bytes < 1024) return bytes + "B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + "KB";
    return (bytes / 1024 / 1024).toFixed(1) + "MB";
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

boot();
