/*
 * preload.js - the only bridge between the renderer and Node.
 * Context isolation is on and node integration is off, so the UI can only
 * reach the handful of calls exposed here.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("merger", {
    // operations
    listOperations: () => ipcRenderer.invoke("ops:list"),
    run: (id, payload) => ipcRenderer.invoke("ops:run", { id, payload }),
    emergencyFlags: () => ipcRenderer.invoke("ops:emergencyFlags"),

    // workspace
    stats: () => ipcRenderer.invoke("stats:read"),

    // named output folders
    listRuns: () => ipcRenderer.invoke("runs:list"),
    deleteRun: (name) => ipcRenderer.invoke("runs:delete", name),
    deriveName: (sourceDir) => ipcRenderer.invoke("runs:deriveName", sourceDir),
    activeProject: () => ipcRenderer.invoke("runs:active"),
    clearStaging: () => ipcRenderer.invoke("workspace:clear"),
    appInfo: () => ipcRenderer.invoke("app:info"),

    // shell / dialogs
    pickFolder: (title) => ipcRenderer.invoke("dialog:pickFolder", { title }),
    openPath: (target) => ipcRenderer.invoke("shell:openPath", target),
    revealPath: (target) => ipcRenderer.invoke("shell:revealPath", target),
    preview: (target) => ipcRenderer.invoke("file:preview", target),

    // window chrome
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggleMaximize"),
    close: () => ipcRenderer.send("window:close"),

    // events
    onLog: (cb) => ipcRenderer.on("engine:log", (_e, line) => cb(line)),
    onFatal: (cb) => ipcRenderer.on("engine:fatal", (_e, payload) => cb(payload)),
    onBusy: (cb) => ipcRenderer.on("engine:busy", (_e, payload) => cb(payload)),
    onWindowState: (cb) => ipcRenderer.on("window:state", (_e, payload) => cb(payload)),
    onProject: (cb) => ipcRenderer.on("engine:project", (_e, payload) => cb(payload))
});
