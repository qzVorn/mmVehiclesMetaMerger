/*
 * main.js - Electron main process.
 *
 * This file is pure plumbing. Every operation below simply calls the matching
 * function in src/core.js, which holds the original app.js logic unchanged.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const core = require("./core");

const APP_TITLE = "mmVehiclesMetaMerger";

let mainWindow = null;
let busy = false;

/* -------------------------------------------------------------------------
 * Working directory
 *
 * Packaged, the app lives inside app.asar, so the folder the user actually
 * keeps their meta files in is the folder holding the .exe. In development it
 * is the repository root.
 * ---------------------------------------------------------------------- */
function resolveBaseDir() {
    if (app.isPackaged) {
        // PORTABLE_EXECUTABLE_DIR is set by electron-builder's portable target.
        return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath("exe"));
    }
    return path.resolve(__dirname, "..");
}

function send(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1180,
        minHeight: 740,
        show: false,
        frame: false,
        backgroundColor: "#070a14",
        title: APP_TITLE,
        icon: path.join(__dirname, "renderer", "assets", "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

    mainWindow.once("ready-to-show", () => mainWindow.show());

    mainWindow.on("maximize", () => send("window:state", { maximized: true }));
    mainWindow.on("unmaximize", () => send("window:state", { maximized: false }));
    mainWindow.on("closed", () => { mainWindow = null; });

    // Never let the renderer navigate away or spawn windows.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
    });
}

app.whenReady().then(() => {
    core.setBaseDir(resolveBaseDir());
    core.ensureWorkspace();

    core.bus.on("log", (line) => send("engine:log", line));
    core.bus.on("fatal", (message) => send("engine:fatal", { message }));

    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => app.quit());

/* -------------------------------------------------------------------------
 * Operation registry
 *
 * `needs` declares what the renderer must collect before the operation runs:
 *   "sourceDir" - a folder to scan for meta files
 *   "query"     - source folder, destination folder and a glob query
 * ---------------------------------------------------------------------- */

async function mergeAll() {
    await core.VehiclesMetaProcedure();
    await core.CarcolsMetaProcedure();
    await core.CarvariationsMetaProcedure();
    await core.HandlingMetaProcedure();
    await core.VehicleLayoutsMetaProcedure();
}

async function importAll(dir) {
    await core.ImportVehiclesMetaFromDir(dir).catch((e) => send("engine:log", { level: "error", text: String(e), time: Date.now() }));
    await core.ImportCarcolsMetaFromDir(dir).catch((e) => send("engine:log", { level: "error", text: String(e), time: Date.now() }));
    await core.ImportCarvariationsMetaFromDir(dir).catch((e) => send("engine:log", { level: "error", text: String(e), time: Date.now() }));
    await core.ImportHandlingMetaFromDir(dir).catch((e) => send("engine:log", { level: "error", text: String(e), time: Date.now() }));
    await core.ImportVehicleLayoutsMetaFromDir(dir).catch((e) => send("engine:log", { level: "error", text: String(e), time: Date.now() }));
}

// The import functions copy asynchronously via fs.copyFile without waiting for
// the callbacks, so give the copies a moment to land before merging them.
function settle(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms || 400));
}

const OPERATIONS = {
    1:  { group: "merge",  label: "Merge vehicles.meta",              run: () => core.VehiclesMetaProcedure() },
    2:  { group: "merge",  label: "Merge carcols.meta",               run: () => core.CarcolsMetaProcedure() },
    3:  { group: "merge",  label: "Merge carvariations.meta",         run: () => core.CarvariationsMetaProcedure() },
    4:  { group: "merge",  label: "Merge handling.meta",              run: () => core.HandlingMetaProcedure() },
    5:  { group: "merge",  label: "Merge vehiclelayouts.meta",        run: () => core.VehicleLayoutsMetaProcedure() },
    6:  { group: "merge",  label: "Merge all of the above",           run: () => mergeAll() },

    7:  { group: "import", label: "Import all vehicles.meta",         needs: "sourceDir", run: (p) => core.ImportVehiclesMetaFromDir(p.sourceDir) },
    8:  { group: "import", label: "Import all carcols.meta",          needs: "sourceDir", run: (p) => core.ImportCarcolsMetaFromDir(p.sourceDir) },
    9:  { group: "import", label: "Import all carvariations.meta",    needs: "sourceDir", run: (p) => core.ImportCarvariationsMetaFromDir(p.sourceDir) },
    10: { group: "import", label: "Import all handling.meta",         needs: "sourceDir", run: (p) => core.ImportHandlingMetaFromDir(p.sourceDir) },
    11: { group: "import", label: "Import all vehiclelayouts.meta",   needs: "sourceDir", run: (p) => core.ImportVehicleLayoutsMetaFromDir(p.sourceDir) },
    12: { group: "import", label: "Import all of the above",          needs: "sourceDir", run: (p) => importAll(p.sourceDir) },

    // NEW - option 13
    13: {
        group: "import",
        label: "Import all + Emergency Flags",
        needs: "sourceDir",
        run: async (p) => {
            await importAll(p.sourceDir);
            await settle(600);
            await mergeAll();
            await settle(200);
            return core.ApplyEmergencyFlags(p.flags && p.flags.length ? p.flags : core.EMERGENCY_FLAGS);
        }
    },

    14: { group: "import", label: "Import files by search query",     needs: "query", run: (p) => core.ImportFilesByQuery(p.sourceDir, p.destDir, p.query) },
    15: { group: "tools",  label: "Extract model names",              run: () => core.ExtractModelNamesFromVehiclesMeta() },
    16: { group: "tools",  label: "Exit",                             run: () => { app.quit(); } }
};

/* -------------------------------------------------------------------------
 * IPC
 * ---------------------------------------------------------------------- */

ipcMain.handle("ops:list", () => {
    return Object.keys(OPERATIONS).map((id) => ({
        id: Number(id),
        group: OPERATIONS[id].group,
        label: OPERATIONS[id].label,
        needs: OPERATIONS[id].needs || null
    }));
});

ipcMain.handle("ops:run", async (event, { id, payload }) => {
    const op = OPERATIONS[id];
    if (!op) return { ok: false, error: `Unknown operation ${id}` };
    if (busy) return { ok: false, error: "Another operation is already running." };

    busy = true;
    send("engine:busy", { busy: true, id, label: op.label });

    try {
        core.ensureWorkspace();
        const result = await op.run(payload || {});
        return { ok: true, result: result === undefined ? null : result };
    } catch (e) {
        const message = e && e.message ? e.message : String(e);
        send("engine:log", { level: "error", text: message, time: Date.now() });
        return { ok: false, error: message };
    } finally {
        busy = false;
        send("engine:busy", { busy: false, id, label: op.label });
    }
});

ipcMain.handle("ops:emergencyFlags", () => core.EMERGENCY_FLAGS);

ipcMain.handle("stats:read", () => core.workspaceStats());

ipcMain.handle("workspace:clear", () => {
    core.ensureWorkspace();
    return core.clearStagingFolders();
});

ipcMain.handle("dialog:pickFolder", async (event, { title }) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: title || "Select folder",
        properties: ["openDirectory"]
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
});

ipcMain.handle("shell:openPath", async (event, target) => {
    if (!target) return false;
    if (!fs.existsSync(target)) return false;
    await shell.openPath(target);
    return true;
});

ipcMain.handle("shell:revealPath", (event, target) => {
    if (!target || !fs.existsSync(target)) return false;
    shell.showItemInFolder(target);
    return true;
});

ipcMain.handle("file:preview", (event, target) => {
    try {
        const raw = fs.readFileSync(target, "utf8");
        return raw.length > 200000 ? raw.slice(0, 200000) + "\n\n... (truncated)" : raw;
    } catch (e) {
        return null;
    }
});

const PKG = require("../package.json");

ipcMain.handle("app:info", () => ({
    version: PKG.version,
    baseDir: core.getDir(),
    platform: process.platform,
    electron: process.versions.electron,
    node: process.versions.node
}));

ipcMain.on("window:minimize", () => mainWindow && mainWindow.minimize());
ipcMain.on("window:toggleMaximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
});
ipcMain.on("window:close", () => mainWindow && mainWindow.close());
