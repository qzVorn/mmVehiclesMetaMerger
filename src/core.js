/*
 * core.js - mmVehiclesMetaMerger merge / import engine.
 *
 * ---------------------------------------------------------------------------
 * IMPORTANT FOR ANYONE READING THIS DIFF
 * ---------------------------------------------------------------------------
 * Everything between the two "VERBATIM FROM app.js" markers below is copied
 * byte-for-byte out of the original app.js. No parsing, merging, de-duplication
 * or import logic has been altered in any way.
 *
 * Only the three *interaction* seams the original CLI relied on are swapped,
 * because a window cannot read from stdin or print ANSI colours to a terminal:
 *
 *   console   ->  a module-local shim. It still forwards to the real console,
 *                 and it additionally emits every line on `bus` so the GUI can
 *                 render it in the activity log. The ANSI colour the original
 *                 code attached via `colors` (.red / .green / .cyan / .magenta)
 *                 is parsed back out and becomes the log level, so the GUI
 *                 colours match the CLI exactly.
 *
 *   rli       ->  a module-local shim. The original called rli.question() in
 *                 exactly one place (inside GetFiles) to hold the terminal open
 *                 after a malformed .meta file and then process.exit(0). The
 *                 shim reports that same message through `bus` instead of
 *                 killing the application.
 *
 *   getDir()  ->  honours an explicit base directory when the host sets one.
 *                 Electron runs from inside app.asar, so require.main.path is
 *                 not the folder the user's meta files live in. When no base
 *                 directory is set it behaves exactly like the original.
 *
 * The one genuinely new piece of logic lives at the bottom of the file, below
 * the "NEW BEHAVIOUR" marker: ApplyEmergencyFlags(), which backs the new
 * option 13.
 */

const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");
const colors = require("colors");
const glob = require("glob");
const { EventEmitter } = require("events");

const parser = new xml2js.Parser();

/** Every log line and lifecycle event the engine produces is emitted here. */
const bus = new EventEmitter();

/* -------------------------------------------------------------------------
 * Interaction shims
 * ---------------------------------------------------------------------- */

const realConsole = global.console;

// `colors` writes SGR escape codes into the string. Map them back to a log
// level so the GUI can colour each line the same way the terminal did.
const ANSI_LEVEL = {
    "31": "error",
    "32": "success",
    "33": "warn",
    "34": "info",
    "35": "import",
    "36": "info",
    "90": "muted"
};

const ANSI_PATTERN = new RegExp("\\[(\\d+)m", "g");

function formatArg(arg) {
    if (arg instanceof Error) return arg.stack || arg.message;
    if (typeof arg === "string") return arg;
    try {
        return JSON.stringify(arg, null, 2);
    } catch (e) {
        return String(arg);
    }
}

function classify(raw) {
    const text = String(raw);
    const match = text.match(new RegExp("\\[(\\d+)m"));
    return {
        level: (match && ANSI_LEVEL[match[1]]) || "plain",
        text: text.replace(ANSI_PATTERN, "")
    };
}

function emitLine(level, text) {
    bus.emit("log", { level: level, text: text, time: Date.now() });
}

// Shadows the global `console` for every function in this module.
const console = {
    log: function () {
        const joined = Array.prototype.slice.call(arguments).map(formatArg).join(" ");
        const parsed = classify(joined);
        realConsole.log(joined);
        emitLine(parsed.level, parsed.text);
    },
    error: function () {
        const joined = Array.prototype.slice.call(arguments).map(formatArg).join(" ");
        const parsed = classify(joined);
        realConsole.error(joined);
        emitLine("error", parsed.text);
    },
    warn: function () {
        const joined = Array.prototype.slice.call(arguments).map(formatArg).join(" ");
        const parsed = classify(joined);
        realConsole.warn(joined);
        emitLine("warn", parsed.text);
    }
};

// Stands in for the readline interface. The original used it in one spot to
// pause the terminal and exit; here the message is surfaced in the GUI instead.
const rli = {
    question: function (prompt) {
        const parsed = classify(prompt);
        const message = parsed.text.replace("Press ENTER to exit.", "").trim();
        emitLine("error", message);
        bus.emit("fatal", message);
    },
    close: function () {}
};

/* -------------------------------------------------------------------------
 * Working directory
 * ---------------------------------------------------------------------- */

let baseDir = null;

/** Point the engine at the folder that holds vehicles_meta/, output/ etc. */
function setBaseDir(dir) {
    baseDir = dir || null;
}

function getDir() {
    if (baseDir) return baseDir;
    if (process.pkg) {
        return path.resolve(process.execPath + "/..");
    } else {
        return path.join(require.main ? require.main.path : process.cwd());
    }
}

/** The mkdir block the original ran inside ProgramStart(), unchanged. */
function ensureWorkspace() {
    if (!fs.existsSync(`${getDir()}/vehicles_meta`)) fs.mkdirSync(`${getDir()}/vehicles_meta`, { recursive: true });
    if (!fs.existsSync(`${getDir()}/carcols_meta`)) fs.mkdirSync(`${getDir()}/carcols_meta`, { recursive: true });
    if (!fs.existsSync(`${getDir()}/carvariations_meta`)) fs.mkdirSync(`${getDir()}/carvariations_meta`, { recursive: true });
    if (!fs.existsSync(`${getDir()}/handling_meta`)) fs.mkdirSync(`${getDir()}/handling_meta`, { recursive: true });
    if (!fs.existsSync(`${getDir()}/vehiclelayouts_meta`)) fs.mkdirSync(`${getDir()}/vehiclelayouts_meta`, { recursive: true });
    if (!fs.existsSync(`${getDir()}/output`)) fs.mkdirSync(`${getDir()}/output`, { recursive: true });
}

/* =========================================================================
 * ===================== VERBATIM FROM app.js - BEGIN ======================
 * Lines 131-657 and 667-811 of app.js, copied unmodified.
 * ====================================================================== */

function ExtractModelNamesFromVehiclesMeta() {
    let e = new Promise(function(resolve, reject) {
        console.log("Extracting model names from vehicles.meta files...".cyan);
        GetFiles(`${getDir()}/vehicles_meta`, function(files) {
            ExtractModelNamesVehicleMetas(files);
            resolve();
        });
    });
    return e;
}

function VehiclesMetaProcedure() {
    let e = new Promise(function(resolve, reject) {
        console.log("Merging all vehicles.meta files...".cyan);
        GetFiles(`${getDir()}/vehicles_meta`, function(files) {
            MergeVehicleMetas(files);
            resolve();
        });
    });
    return e;
}

function CarcolsMetaProcedure() {
    let e = new Promise(function(resolve, reject) {
        console.log("Merging all carcols.meta files...".cyan);
        GetFiles(`${getDir()}/carcols_meta`, function(files) {
            MergeCarcolsMetas(files);
            resolve();
        });
    });
    return e;
}

function CarvariationsMetaProcedure() {
    let e = new Promise(function(resolve, reject) {
        console.log("Merging all carvariations.meta files...".cyan);
        GetFiles(`${getDir()}/carvariations_meta`, function(files) {
            MergeCarvariationsMetas(files);
            resolve();
        });
    });
    return e;
}

function HandlingMetaProcedure() {
    let e = new Promise(function(resolve, reject) {
        console.log("Merging all handling.meta files...".cyan);
        GetFiles(`${getDir()}/handling_meta`, function(files) {
            MergeHandlingMetas(files);
            resolve();
        });
    });
    return e;
}

function VehicleLayoutsMetaProcedure() {
    let e = new Promise(function(resolve, reject) {
        console.log("Merging all vehiclelayouts.meta files...".cyan);
        GetFiles(`${getDir()}/vehiclelayouts_meta`, function(files) {
            MergeVehicleLayoutsMetas(files);
            resolve();
        });
    });
    return e;
}

function ParseXML(data) {
    let e = new Promise(function(resolve, reject) {
        parser.parseString(data, function (err, result) {
            if (err) reject(err);
            else resolve(result);
        });
    });

    return e;
}

/*
 * FIXED in 2.0.1.
 *
 * Previously this aborted the whole merge if a single file failed: the callback
 * only fired once EVERY file had parsed, so one malformed .meta meant the merge
 * never ran and the previous output file was silently left in place. The
 * readFile() call was also unguarded, so an unreadable entry rejected the whole
 * async callback and stopped the loop partway.
 *
 * Now each file is attempted independently. Bad ones are named, logged to
 * errors.txt and skipped; whatever parsed successfully is still merged.
 */
function GetFiles(path, cb) {
    let files_to_merge = [];
    let skipped = [];

    fs.readdir(path, async (err, files) => {
        if (err) {
            console.error(err);
            cb([]);
            return;
        }

        if (!files.length) {
            console.log(`There were not any files in given path: ${path}`.yellow)
            cb([]);
            return;
        }

        fs.writeFileSync(`${getDir()}/errors.txt`, "");

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                const data = await fs.promises.readFile(`${path}/${file}`);
                const result = await ParseXML(data);
                // Remember where this document came from so the merge step can
                // name the offending file rather than guessing. Non-enumerable,
                // so it never reaches the XML builder.
                Object.defineProperty(result, "__source", { value: file, enumerable: false });
                files_to_merge.push(result);
            } catch (e) {
                skipped.push(file);
                console.log(`Skipping ${file} - it could not be read or parsed.`.red);
                console.error(e);
                fs.appendFileSync(`${getDir()}/errors.txt`, `Could not read or parse ${file}\n${e}\n\n`);
            }
        };

        if (skipped.length) {
            console.log(`Skipped ${skipped.length} unreadable file(s): ${skipped.join(", ")}`.yellow);
        }

        cb(files_to_merge);
    });
}

/*
 * NEW in 2.0.1. Drops any parsed document whose root element is not the one the
 * merge function expects. A single stray file (a carcols.meta saved as
 * vehicles.meta, a stub with no data, an unrelated XML) used to throw a
 * TypeError deep inside the merge, which was swallowed by the catch above and
 * left the output file unwritten with no clear reason why.
 */
function documentsWithRoot(files, rootName) {
    let usable = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file && file[rootName] != undefined) usable.push(file);
        else console.log(`Skipping ${(file && file.__source) || "a file"} - it is not a <${rootName}> document.`.yellow);
    }

    return usable;
}

function ExtractModelNamesVehicleMetas(files) {
    files = documentsWithRoot(files, "CVehicleModelInfo__InitDataList");   // FIXED in 2.0.1

    if (files.length > 0) {
        let modelNames = "";

        for (let i = 0; i < files.length; i++) {
            // FIXED in 2.0.2 - guard, matching every other function here.
            if (files[i].CVehicleModelInfo__InitDataList.InitDatas == undefined) continue;

            for (let j = 0; j < files[i].CVehicleModelInfo__InitDataList.InitDatas.length; j++) {
                if (typeof files[i].CVehicleModelInfo__InitDataList.InitDatas[j] == "object") {
                    let obj = files[i].CVehicleModelInfo__InitDataList.InitDatas[j];

                    // FIXED in 2.0.2 - this used to read obj.Item[0] only, so a
                    // vehicles.meta holding several vehicles exported just the
                    // first one and silently dropped the rest. Walk every Item.
                    if (obj.Item == undefined) continue;

                    for (let k = 0; k < obj.Item.length; k++) {
                        const item = obj.Item[k];
                        if (item && item.modelName && item.modelName[0])
                            modelNames += `${item.modelName[0]}\n`;
                    }
                }
            }
        }

        fs.writeFileSync(`${getDir()}/output/exportedModelNames.txt`, modelNames);
        console.log(`Extracting model names from vehicles.meta files done! ${modelNames.split("\n").filter((n) => n.length).length} model name(s) from ${files.length} file(s).`.green);
    }
}

function MergeVehicleMetas(files) {
    files = documentsWithRoot(files, "CVehicleModelInfo__InitDataList");   // FIXED in 2.0.1

    if (files.length > 0) {
        let o = JSON.parse(JSON.stringify(files[0]));

        if (o.CVehicleModelInfo__InitDataList.InitDatas == undefined || o.CVehicleModelInfo__InitDataList.InitDatas == "") o.CVehicleModelInfo__InitDataList.InitDatas = [];
        if (o.CVehicleModelInfo__InitDataList.txdRelationships == undefined || o.CVehicleModelInfo__InitDataList.txdRelationships == "") o.CVehicleModelInfo__InitDataList.txdRelationships = [];
    
        for (let i = 1; i < files.length; i++) {
            // FIXED in 2.0.1 - this guard was missing here and present in every
            // other merge function, which is why vehicles.meta was the only one
            // that failed to merge.
            if (files[i].CVehicleModelInfo__InitDataList.InitDatas != undefined) {
                for (let j = 0; j < files[i].CVehicleModelInfo__InitDataList.InitDatas.length; j++) {
                    if (typeof files[i].CVehicleModelInfo__InitDataList.InitDatas[j] == "object") 
                        o.CVehicleModelInfo__InitDataList.InitDatas.push(files[i].CVehicleModelInfo__InitDataList.InitDatas[j]);
                }
            }
    
            if (files[i].CVehicleModelInfo__InitDataList.txdRelationships) {
                for (let j = 0; j < files[i].CVehicleModelInfo__InitDataList.txdRelationships.length; j++) {
                    if (typeof files[i].CVehicleModelInfo__InitDataList.txdRelationships[j] == "object") 
                        o.CVehicleModelInfo__InitDataList.txdRelationships.push(files[i].CVehicleModelInfo__InitDataList.txdRelationships[j]);
                }
            }
        }
    
        if (o.CVehicleModelInfo__InitDataList.InitDatas.length == 0) o.CVehicleModelInfo__InitDataList.InitDatas.push({});
        if (o.CVehicleModelInfo__InitDataList.txdRelationships.length == 0) o.CVehicleModelInfo__InitDataList.txdRelationships.push({});

        let builder = new xml2js.Builder();
        let xml = builder.buildObject(o).toString();
    
        xml = removeDuplicated("InitDatas", xml)
        xml = removeDuplicated("txdRelationships", xml)
    
        fs.writeFileSync(`${getDir()}/output/vehicles.meta`, xml);
        console.log(`Merging all vehicles.meta files done! ${(xml.match(/<modelName>/g) || []).length} vehicle(s) from ${files.length} file(s).`.green);
    }
}

function MergeCarcolsMetas(files) {
    files = documentsWithRoot(files, "CVehicleModelInfoVarGlobal");   // FIXED in 2.0.1

    if (files.length > 0) {
        let o = JSON.parse(JSON.stringify(files[0]));

        if (o.CVehicleModelInfoVarGlobal.Kits == undefined || o.CVehicleModelInfoVarGlobal.Kits == "") o.CVehicleModelInfoVarGlobal.Kits = [];
        if (o.CVehicleModelInfoVarGlobal.Lights == undefined || o.CVehicleModelInfoVarGlobal.Lights == "") o.CVehicleModelInfoVarGlobal.Lights = [];
        if (o.CVehicleModelInfoVarGlobal.Sirens == undefined || o.CVehicleModelInfoVarGlobal.Sirens == "") o.CVehicleModelInfoVarGlobal.Sirens = [];

        for (let i = 1; i < files.length; i++) {
            if (files[i].CVehicleModelInfoVarGlobal.Kits != undefined) {
                for (let j = 0; j < files[i].CVehicleModelInfoVarGlobal.Kits.length; j++) {
                    if (typeof files[i].CVehicleModelInfoVarGlobal.Kits[j] == "object") 
                        o.CVehicleModelInfoVarGlobal.Kits.push(files[i].CVehicleModelInfoVarGlobal.Kits[j]);
                }
            }

            if (files[i].CVehicleModelInfoVarGlobal.Lights != undefined) {
                for (let j = 0; j < files[i].CVehicleModelInfoVarGlobal.Lights.length; j++) {
                    if (typeof files[i].CVehicleModelInfoVarGlobal.Lights[j] == "object") 
                        o.CVehicleModelInfoVarGlobal.Lights.push(files[i].CVehicleModelInfoVarGlobal.Lights[j]);
                }
            }

            if (files[i].CVehicleModelInfoVarGlobal.Sirens != undefined) {
                for (let j = 0; j < files[i].CVehicleModelInfoVarGlobal.Sirens.length; j++) {
                    if (typeof files[i].CVehicleModelInfoVarGlobal.Sirens[j] == "object") 
                        o.CVehicleModelInfoVarGlobal.Sirens.push(files[i].CVehicleModelInfoVarGlobal.Sirens[j]);
                }
            }
        }

        if (o.CVehicleModelInfoVarGlobal.Kits.length == 0) o.CVehicleModelInfoVarGlobal.Kits.push({});
        if (o.CVehicleModelInfoVarGlobal.Lights.length == 0) o.CVehicleModelInfoVarGlobal.Lights.push({});
        if (o.CVehicleModelInfoVarGlobal.Sirens.length == 0) o.CVehicleModelInfoVarGlobal.Sirens.push({});

        let builder = new xml2js.Builder();
        let xml = builder.buildObject(o).toString();

        if (o.CVehicleModelInfoVarGlobal.Kits.length > 1) xml = removeDuplicated("Kits", xml);
        if (o.CVehicleModelInfoVarGlobal.Lights.length > 1) xml = removeDuplicated("Lights", xml);
        if (o.CVehicleModelInfoVarGlobal.Sirens.length > 1) xml = removeDuplicated("Sirens", xml);

        fs.writeFileSync(`${getDir()}/output/carcols.meta`, xml);
        console.log("Merging all carcols.meta files done!".green);
    }
}

function MergeCarvariationsMetas(files) {
    files = documentsWithRoot(files, "CVehicleModelInfoVariation");   // FIXED in 2.0.1

    if (files.length > 0) {
        let o = JSON.parse(JSON.stringify(files[0]));

        if (o.CVehicleModelInfoVariation.variationData == undefined || o.CVehicleModelInfoVariation.variationData == "") o.CVehicleModelInfoVariation.variationData = [];

        for (let i = 1; i < files.length; i++) {
            if (files[i].CVehicleModelInfoVariation.variationData != undefined) {
                for (let j = 0; j < files[i].CVehicleModelInfoVariation.variationData.length; j++) {
                    if (typeof files[i].CVehicleModelInfoVariation.variationData[j] == "object")
                        o.CVehicleModelInfoVariation.variationData.push(files[i].CVehicleModelInfoVariation.variationData[j]);
                }
            }
        }
        
        if (o.CVehicleModelInfoVariation.variationData.length == 0) o.CVehicleModelInfoVariation.variationData.push({});

        let builder = new xml2js.Builder();
        let xml = builder.buildObject(o).toString();

        xml = removeDuplicated("variationData", xml);
        fs.writeFileSync(`${getDir()}/output/carvariations.meta`, xml);
        console.log("Merging all carvariations.meta files done!".green);
    }
}

function MergeHandlingMetas(files) {
    files = documentsWithRoot(files, "CHandlingDataMgr");   // FIXED in 2.0.1

    if (files.length > 0) {
        let o = JSON.parse(JSON.stringify(files[0]));

        if (o.CHandlingDataMgr.HandlingData == undefined || o.CHandlingDataMgr.HandlingData == "") o.CHandlingDataMgr.HandlingData = [];

        for (let i = 1; i < files.length; i++) {
            if (files[i].CHandlingDataMgr.HandlingData != undefined) {
                for (let j = 0; j < files[i].CHandlingDataMgr.HandlingData.length; j++) {
                    if (typeof files[i].CHandlingDataMgr.HandlingData[j] == "object") 
                        o.CHandlingDataMgr.HandlingData.push(files[i].CHandlingDataMgr.HandlingData[j]);
                }
            }
        }

        if (o.CHandlingDataMgr.HandlingData.length == 0) o.CHandlingDataMgr.HandlingData.push({});

        let builder = new xml2js.Builder();
        let xml = builder.buildObject(o).toString();

        xml = removeDuplicated("HandlingData", xml);
        fs.writeFileSync(`${getDir()}/output/handling.meta`, xml);
        console.log("Merging all handling.meta files done!".green);
    }
}

function MergeVehicleLayoutsMetas(files) {
    files = documentsWithRoot(files, "CVehicleMetadataMgr");   // FIXED in 2.0.1

    if (files.length > 0) {
        let o = JSON.parse(JSON.stringify(files[0]));

        if (o.CVehicleMetadataMgr.AnimRateSets == undefined || o.CVehicleMetadataMgr.AnimRateSets == "") o.CVehicleMetadataMgr.AnimRateSets = [];
        if (o.CVehicleMetadataMgr.ClipSetMaps == undefined || o.CVehicleMetadataMgr.ClipSetMaps == "") o.CVehicleMetadataMgr.ClipSetMaps = [];
        if (o.CVehicleMetadataMgr.VehicleCoverBoundOffsetInfos == undefined || o.CVehicleMetadataMgr.VehicleCoverBoundOffsetInfos == "") o.CVehicleMetadataMgr.VehicleCoverBoundOffsetInfos = [];
        if (o.CVehicleMetadataMgr.BicycleInfos == undefined || o.CVehicleMetadataMgr.BicycleInfos == "") o.CVehicleMetadataMgr.BicycleInfos = [];
        if (o.CVehicleMetadataMgr.POVTuningInfos == undefined || o.CVehicleMetadataMgr.POVTuningInfos == "") o.CVehicleMetadataMgr.POVTuningInfos = [];
        if (o.CVehicleMetadataMgr.EntryAnimVariations == undefined || o.CVehicleMetadataMgr.EntryAnimVariations == "") o.CVehicleMetadataMgr.EntryAnimVariations = [];
        if (o.CVehicleMetadataMgr.VehicleExtraPointsInfos == undefined || o.CVehicleMetadataMgr.VehicleExtraPointsInfos == "") o.CVehicleMetadataMgr.VehicleExtraPointsInfos = [];
        if (o.CVehicleMetadataMgr.DrivebyWeaponGroups == undefined || o.CVehicleMetadataMgr.DrivebyWeaponGroups == "") o.CVehicleMetadataMgr.DrivebyWeaponGroups = [];
        if (o.CVehicleMetadataMgr.VehicleDriveByAnimInfos == undefined || o.CVehicleMetadataMgr.VehicleDriveByAnimInfos == "") o.CVehicleMetadataMgr.VehicleDriveByAnimInfos = [];
        if (o.CVehicleMetadataMgr.VehicleDriveByInfos == undefined || o.CVehicleMetadataMgr.VehicleDriveByInfos == "") o.CVehicleMetadataMgr.VehicleDriveByInfos = [];
        if (o.CVehicleMetadataMgr.VehicleSeatInfos == undefined || o.CVehicleMetadataMgr.VehicleSeatInfos == "") o.CVehicleMetadataMgr.VehicleSeatInfos = [];
        if (o.CVehicleMetadataMgr.VehicleSeatAnimInfos == undefined || o.CVehicleMetadataMgr.VehicleSeatAnimInfos == "") o.CVehicleMetadataMgr.VehicleSeatAnimInfos = [];
        if (o.CVehicleMetadataMgr.VehicleEntryPointInfos == undefined || o.CVehicleMetadataMgr.VehicleEntryPointInfos == "") o.CVehicleMetadataMgr.VehicleEntryPointInfos = [];
        if (o.CVehicleMetadataMgr.VehicleEntryPointAnimInfos == undefined || o.CVehicleMetadataMgr.VehicleEntryPointAnimInfos == "") o.CVehicleMetadataMgr.VehicleEntryPointAnimInfos = [];
        if (o.CVehicleMetadataMgr.VehicleExplosionInfos == undefined || o.CVehicleMetadataMgr.VehicleExplosionInfos == "") o.CVehicleMetadataMgr.VehicleExplosionInfos = [];
        if (o.CVehicleMetadataMgr.VehicleLayoutInfos == undefined || o.CVehicleMetadataMgr.VehicleLayoutInfos == "") o.CVehicleMetadataMgr.VehicleLayoutInfos = [];
        if (o.CVehicleMetadataMgr.VehicleScenarioLayoutInfos == undefined || o.CVehicleMetadataMgr.VehicleScenarioLayoutInfos == "") o.CVehicleMetadataMgr.VehicleScenarioLayoutInfos = [];
        if (o.CVehicleMetadataMgr.SeatOverrideAnimInfos == undefined || o.CVehicleMetadataMgr.SeatOverrideAnimInfos == "") o.CVehicleMetadataMgr.SeatOverrideAnimInfos = [];
        if (o.CVehicleMetadataMgr.InVehicleOverrideInfos == undefined || o.CVehicleMetadataMgr.InVehicleOverrideInfos == "") o.CVehicleMetadataMgr.InVehicleOverrideInfos = [];
        if (o.CVehicleMetadataMgr.FirstPersonDriveByLookAroundData == undefined || o.CVehicleMetadataMgr.FirstPersonDriveByLookAroundData == "") o.CVehicleMetadataMgr.FirstPersonDriveByLookAroundData = [];

        for (let i = 1; i < files.length; i++) {
            if (files[i].CVehicleMetadataMgr.AnimRateSets != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.AnimRateSets.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.AnimRateSets[j] == "object") 
                        o.CVehicleMetadataMgr.AnimRateSets.push(files[i].CVehicleMetadataMgr.AnimRateSets[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.ClipSetMaps != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.ClipSetMaps.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.ClipSetMaps[j] == "object") 
                        o.CVehicleMetadataMgr.ClipSetMaps.push(files[i].CVehicleMetadataMgr.ClipSetMaps[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.VehicleCoverBoundOffsetInfos != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.VehicleCoverBoundOffsetInfos.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.VehicleCoverBoundOffsetInfos[j] == "object")
                        o.CVehicleMetadataMgr.VehicleCoverBoundOffsetInfos.push(files[i].CVehicleMetadataMgr.VehicleCoverBoundOffsetInfos[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.BicycleInfos != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.BicycleInfos.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.BicycleInfos[j] == "object")
                        o.CVehicleMetadataMgr.BicycleInfos.push(files[i].CVehicleMetadataMgr.BicycleInfos[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.POVTuningInfos != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.POVTuningInfos.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.POVTuningInfos[j] == "object")
                        o.CVehicleMetadataMgr.POVTuningInfos.push(files[i].CVehicleMetadataMgr.POVTuningInfos[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.EntryAnimVariations != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.EntryAnimVariations.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.EntryAnimVariations[j] == "object")
                        o.CVehicleMetadataMgr.EntryAnimVariations.push(files[i].CVehicleMetadataMgr.EntryAnimVariations[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.VehicleExtraPointsInfos != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.VehicleExtraPointsInfos.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.VehicleExtraPointsInfos[j] == "object")
                        o.CVehicleMetadataMgr.VehicleExtraPointsInfos.push(files[i].CVehicleMetadataMgr.VehicleExtraPointsInfos[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.DrivebyWeaponGroups != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.DrivebyWeaponGroups.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.DrivebyWeaponGroups[j] == "object")
                        o.CVehicleMetadataMgr.DrivebyWeaponGroups.push(files[i].CVehicleMetadataMgr.DrivebyWeaponGroups[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.VehicleDriveByAnimInfos != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.VehicleDriveByAnimInfos.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.VehicleDriveByAnimInfos[j] == "object")
                        o.CVehicleMetadataMgr.VehicleDriveByAnimInfos.push(files[i].CVehicleMetadataMgr.VehicleDriveByAnimInfos[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.VehicleDriveByInfos != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.VehicleDriveByInfos.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.VehicleDriveByInfos[j] == "object")
                        o.CVehicleMetadataMgr.VehicleDriveByInfos.push(files[i].CVehicleMetadataMgr.VehicleDriveByInfos[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.VehicleSeatInfos != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.VehicleSeatInfos.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.VehicleSeatInfos[j] == "object")
                        o.CVehicleMetadataMgr.VehicleSeatInfos.push(files[i].CVehicleMetadataMgr.VehicleSeatInfos[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.VehicleSeatAnimInfos != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.VehicleSeatAnimInfos.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.VehicleSeatAnimInfos[j] == "object")
                        o.CVehicleMetadataMgr.VehicleSeatAnimInfos.push(files[i].CVehicleMetadataMgr.VehicleSeatAnimInfos[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.VehicleEntryPointInfos != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.VehicleEntryPointInfos.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.VehicleEntryPointInfos[j] == "object")
                        o.CVehicleMetadataMgr.VehicleEntryPointInfos.push(files[i].CVehicleMetadataMgr.VehicleEntryPointInfos[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.VehicleEntryPointAnimInfos != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.VehicleEntryPointAnimInfos.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.VehicleEntryPointAnimInfos[j] == "object")
                        o.CVehicleMetadataMgr.VehicleEntryPointAnimInfos.push(files[i].CVehicleMetadataMgr.VehicleEntryPointAnimInfos[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.VehicleExplosionInfos != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.VehicleExplosionInfos.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.VehicleExplosionInfos[j] == "object")
                        o.CVehicleMetadataMgr.VehicleExplosionInfos.push(files[i].CVehicleMetadataMgr.VehicleExplosionInfos[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.VehicleLayoutInfos != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.VehicleLayoutInfos.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.VehicleLayoutInfos[j] == "object")
                        o.CVehicleMetadataMgr.VehicleLayoutInfos.push(files[i].CVehicleMetadataMgr.VehicleLayoutInfos[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.VehicleScenarioLayoutInfos != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.VehicleScenarioLayoutInfos.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.VehicleScenarioLayoutInfos[j] == "object")
                        o.CVehicleMetadataMgr.VehicleScenarioLayoutInfos.push(files[i].CVehicleMetadataMgr.VehicleScenarioLayoutInfos[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.SeatOverrideAnimInfos != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.SeatOverrideAnimInfos.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.SeatOverrideAnimInfos[j] == "object")
                        o.CVehicleMetadataMgr.SeatOverrideAnimInfos.push(files[i].CVehicleMetadataMgr.SeatOverrideAnimInfos[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.InVehicleOverrideInfos != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.InVehicleOverrideInfos.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.InVehicleOverrideInfos[j] == "object")
                        o.CVehicleMetadataMgr.InVehicleOverrideInfos.push(files[i].CVehicleMetadataMgr.InVehicleOverrideInfos[j]);
                }
            }

            if (files[i].CVehicleMetadataMgr.FirstPersonDriveByLookAroundData != undefined) {
                for (let j = 0; j < files[i].CVehicleMetadataMgr.FirstPersonDriveByLookAroundData.length; j++) {
                    if (typeof files[i].CVehicleMetadataMgr.FirstPersonDriveByLookAroundData[j] == "object")
                        o.CVehicleMetadataMgr.FirstPersonDriveByLookAroundData.push(files[i].CVehicleMetadataMgr.FirstPersonDriveByLookAroundData[j]);
                }
            }
        }

        if (o.CVehicleMetadataMgr.AnimRateSets.length == 0) o.CVehicleMetadataMgr.AnimRateSets.push({});
        if (o.CVehicleMetadataMgr.ClipSetMaps.length == 0) o.CVehicleMetadataMgr.ClipSetMaps.push({});
        if (o.CVehicleMetadataMgr.VehicleCoverBoundOffsetInfos.length == 0) o.CVehicleMetadataMgr.VehicleCoverBoundOffsetInfos.push({});
        if (o.CVehicleMetadataMgr.BicycleInfos.length == 0) o.CVehicleMetadataMgr.BicycleInfos.push({});
        if (o.CVehicleMetadataMgr.POVTuningInfos.length == 0) o.CVehicleMetadataMgr.POVTuningInfos.push({});
        if (o.CVehicleMetadataMgr.EntryAnimVariations.length == 0) o.CVehicleMetadataMgr.EntryAnimVariations.push({});
        if (o.CVehicleMetadataMgr.VehicleExtraPointsInfos.length == 0) o.CVehicleMetadataMgr.VehicleExtraPointsInfos.push({});
        if (o.CVehicleMetadataMgr.DrivebyWeaponGroups.length == 0) o.CVehicleMetadataMgr.DrivebyWeaponGroups.push({});
        if (o.CVehicleMetadataMgr.VehicleDriveByAnimInfos.length == 0) o.CVehicleMetadataMgr.VehicleDriveByAnimInfos.push({});
        if (o.CVehicleMetadataMgr.VehicleDriveByInfos.length == 0) o.CVehicleMetadataMgr.VehicleDriveByInfos.push({});
        if (o.CVehicleMetadataMgr.VehicleSeatInfos.length == 0) o.CVehicleMetadataMgr.VehicleSeatInfos.push({});
        if (o.CVehicleMetadataMgr.VehicleSeatAnimInfos.length == 0) o.CVehicleMetadataMgr.VehicleSeatAnimInfos.push({});
        if (o.CVehicleMetadataMgr.VehicleEntryPointInfos.length == 0) o.CVehicleMetadataMgr.VehicleEntryPointInfos.push({});
        if (o.CVehicleMetadataMgr.VehicleEntryPointAnimInfos.length == 0) o.CVehicleMetadataMgr.VehicleEntryPointAnimInfos.push({});
        if (o.CVehicleMetadataMgr.VehicleExplosionInfos.length == 0) o.CVehicleMetadataMgr.VehicleExplosionInfos.push({});
        if (o.CVehicleMetadataMgr.VehicleLayoutInfos.length == 0) o.CVehicleMetadataMgr.VehicleLayoutInfos.push({});
        if (o.CVehicleMetadataMgr.VehicleScenarioLayoutInfos.length == 0) o.CVehicleMetadataMgr.VehicleScenarioLayoutInfos.push({});
        if (o.CVehicleMetadataMgr.SeatOverrideAnimInfos.length == 0) o.CVehicleMetadataMgr.SeatOverrideAnimInfos.push({});
        if (o.CVehicleMetadataMgr.InVehicleOverrideInfos.length == 0) o.CVehicleMetadataMgr.InVehicleOverrideInfos.push({});
        if (o.CVehicleMetadataMgr.FirstPersonDriveByLookAroundData.length == 0) o.CVehicleMetadataMgr.FirstPersonDriveByLookAroundData.push({});

        let builder = new xml2js.Builder();
        let xml = builder.buildObject(o).toString();

        if (o.CVehicleMetadataMgr.AnimRateSets.length > 0) xml = removeDuplicated("AnimRateSets", xml);
        if (o.CVehicleMetadataMgr.ClipSetMaps.length > 0) xml = removeDuplicated("ClipSetMaps", xml);
        if (o.CVehicleMetadataMgr.VehicleCoverBoundOffsetInfos.length > 0) xml = removeDuplicated("VehicleCoverBoundOffsetInfos", xml);
        if (o.CVehicleMetadataMgr.BicycleInfos.length > 0) xml = removeDuplicated("BicycleInfos", xml);
        if (o.CVehicleMetadataMgr.POVTuningInfos.length > 0) xml = removeDuplicated("POVTuningInfos", xml);
        if (o.CVehicleMetadataMgr.EntryAnimVariations.length > 0) xml = removeDuplicated("EntryAnimVariations", xml);
        if (o.CVehicleMetadataMgr.VehicleExtraPointsInfos.length > 0) xml = removeDuplicated("VehicleExtraPointsInfos", xml);
        if (o.CVehicleMetadataMgr.DrivebyWeaponGroups.length > 0) xml = removeDuplicated("DrivebyWeaponGroups", xml);
        if (o.CVehicleMetadataMgr.VehicleDriveByAnimInfos.length > 0) xml = removeDuplicated("VehicleDriveByAnimInfos", xml);
        if (o.CVehicleMetadataMgr.VehicleDriveByInfos.length > 0) xml = removeDuplicated("VehicleDriveByInfos", xml);
        if (o.CVehicleMetadataMgr.VehicleSeatInfos.length > 0) xml = removeDuplicated("VehicleSeatInfos", xml);
        if (o.CVehicleMetadataMgr.VehicleSeatAnimInfos.length > 0) xml = removeDuplicated("VehicleSeatAnimInfos", xml);
        if (o.CVehicleMetadataMgr.VehicleEntryPointInfos.length > 0) xml = removeDuplicated("VehicleEntryPointInfos", xml);
        if (o.CVehicleMetadataMgr.VehicleEntryPointAnimInfos.length > 0) xml = removeDuplicated("VehicleEntryPointAnimInfos", xml);
        if (o.CVehicleMetadataMgr.VehicleExplosionInfos.length > 0) xml = removeDuplicated("VehicleExplosionInfos", xml);
        if (o.CVehicleMetadataMgr.VehicleLayoutInfos.length > 0) xml = removeDuplicated("VehicleLayoutInfos", xml);
        if (o.CVehicleMetadataMgr.VehicleScenarioLayoutInfos.length > 0) xml = removeDuplicated("VehicleScenarioLayoutInfos", xml);
        if (o.CVehicleMetadataMgr.SeatOverrideAnimInfos.length > 0) xml = removeDuplicated("SeatOverrideAnimInfos", xml);
        if (o.CVehicleMetadataMgr.InVehicleOverrideInfos.length > 0) xml = removeDuplicated("InVehicleOverrideInfos", xml);
        if (o.CVehicleMetadataMgr.FirstPersonDriveByLookAroundData.length > 0) xml = removeDuplicated("FirstPersonDriveByLookAroundData", xml);

        fs.writeFileSync(`${getDir()}/output/vehiclelayouts.meta`, xml);
        console.log("Merging all vehiclelayouts.meta files done!".green);
    }
}

function removeDuplicated(name, text) {
    let to_del = [];
    let lines = text.split(/\r?\n/);

    let firstInitData = false;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`<${name}>`)) {
            if (!firstInitData) firstInitData = true;
            else to_del.push(i);
        }
    }

    firstInitData = false;

    for (let i = lines.length-1; i > 0; i--) {
        if (lines[i].includes(`</${name}>`)) {
            if (!firstInitData) firstInitData = true;
            else to_del.push(i);
        }
    }

    to_del.sort((a, b) => { return b - a });

    for (let i = 0; i < to_del.length; i++) { lines.splice(to_del[i], 1); }

    let x = "";
    for (let i = 0; i < lines.length; i++) { x += `${lines[i].replace("&#xD;", "").replace(` standalone="yes"`, "")}\n`; }

    return x
}

function IsEveryObjectTrue(key_val) {
    let _return = true;

    for (var key of Object.keys(key_val)) {
        if (key_val[key] == false) _return = false;
    }

    return _return;
}

function ImportVehiclesMetaFromDir(directory) {
    let e = new Promise(function(resolve, reject) {
        console.log("Importing all vehicles.meta files...".magenta);
        fs.access(directory, (err) => {
            if (err) reject("Directory does not exist!".red);
            else {
                glob("**/vehicles.meta", { cwd: directory } , function (er, files) {
                    if (er) reject(`Error occured during search for a files: ${er}`.red);
                    for (let i = 0; i < files.length; i++) {
                        fs.copyFile(path.join(directory, files[i]), `${getDir()}/vehicles_meta/vehicles${i}.meta`, (err) => {
                            if (err) console.log(`Error occured during coping file:\nFrom: ${path.join(directory, files[i])}\nTo: ${`${getDir()}/vehicles_meta/vehicles${i}.meta`}`.red);
                        });
                    }
                    console.log("Importing all vehicles.meta files done!".magenta);
                    resolve();
                });
            }
        });
    });
    return e;
}

function ImportCarcolsMetaFromDir(directory) {
    let e = new Promise(function(resolve, reject) {
        console.log("Importing all carcols.meta files...".magenta);
        fs.access(directory, (err) => {
            if (err) reject("Directory does not exist!".red);
            else {
                glob("**/carcols.meta", { cwd: directory } , function (er, files) {
                    if (er) reject(`Error occured during search for a files: ${er}`.red);
                    for (let i = 0; i < files.length; i++) {
                        fs.copyFile(path.join(directory, files[i]), `${getDir()}/carcols_meta/carcols${i}.meta`, (err) => {
                            if (err) console.log(`Error occured during coping file:\nFrom: ${path.join(directory, files[i])}\nTo: ${`${getDir()}/carcols_meta/carcols${i}.meta`}`.red);
                        });
                    }
                    console.log("Importing all carcols.meta files done!".magenta);
                    resolve();
                });
            }
        });
    });
    return e;
}

function ImportCarvariationsMetaFromDir(directory) {
    let e = new Promise(function(resolve, reject) {
        console.log("Importing all carvariations.meta files...".magenta);
        fs.access(directory, (err) => {
            if (err) reject("Directory does not exist!".red);
            else {
                glob("**/carvariations.meta", { cwd: directory } , function (er, files) {
                    if (er) reject(`Error occured during search for a files: ${er}`.red);
                    for (let i = 0; i < files.length; i++) {
                        fs.copyFile(path.join(directory, files[i]), `${getDir()}/carvariations_meta/carvariations${i}.meta`, (err) => {
                            if (err) console.log(`Error occured during coping file:\nFrom: ${path.join(directory, files[i])}\nTo: ${`${getDir()}/carvariations_meta/carvariations${i}.meta`}`.red);
                        });
                    }
                    console.log("Importing all carvariations.meta files done!".magenta);
                    resolve();
                });
            }
        });
    });
    return e;
}

function ImportHandlingMetaFromDir(directory) {
    let e = new Promise(function(resolve, reject) {
        console.log("Importing all handling.meta files...".magenta);
        fs.access(directory, (err) => {
            if (err) reject("Directory does not exist!".red);
            else {
                glob("**/handling.meta", { cwd: directory } , function (er, files) {
                    if (er) reject(`Error occured during search for a files: ${er}`.red);
                    for (let i = 0; i < files.length; i++) {
                        fs.copyFile(path.join(directory, files[i]), `${getDir()}/handling_meta/handling${i}.meta`, (err) => {
                            if (err) console.log(`Error occured during coping file:\nFrom: ${path.join(directory, files[i])}\nTo: ${`${getDir()}/handling_meta/handling${i}.meta`}`.red);
                        });
                    }
                    console.log("Importing all handling.meta files done!".magenta);
                    resolve();
                });
            }
        });
    });
    return e;
}

function ImportVehicleLayoutsMetaFromDir(directory) {
    let e = new Promise(function(resolve, reject) {
        console.log("Importing all vehiclelayouts.meta files...".magenta);
        fs.access(directory, (err) => {
            if (err) reject("Directory does not exist!".red);
            else {
                glob("**/vehiclelayouts.meta", { cwd: directory } , function (er, files) {
                    if (er) reject(`Error occured during search for a files: ${er}`.red);
                    for (let i = 0; i < files.length; i++) {
                        fs.copyFile(path.join(directory, files[i]), `${getDir()}/vehiclelayouts_meta/vehiclelayouts${i}.meta`, (err) => {
                            if (err) console.log(`Error occured during coping file:\nFrom: ${path.join(directory, files[i])}\nTo: ${`${getDir()}/vehiclelayouts_meta/vehiclelayouts${i}.meta`}`.red);
                        });
                    }
                    console.log("Importing all vehiclelayouts.meta files done!".magenta);
                    resolve();
                });
            }
        });
    });
    return e;
}

function ImportFileByQueryFromDir() {
    let e = new Promise(function(resolve, reject) {
        rli.question("Path to directory: ", (path_) => {
            fs.access(path_, (err) => {
                if (err) reject("Directory does not exist!".red);
                else {
                    rli.question("Path to directory where to save files: ", (path_2) => {
                        fs.access(path_2, (err2) => {
                            if (err2) reject("Directory does not exist!".red);
                            else {
                                rli.question("Search query: ", (query) => {
                                    glob(query, { cwd: path_ } , function (er, files) {
                                        if (er) reject(`Error occured during search for a files: ${er}`.red);
                                        for (let i = 0; i < files.length; i++) {
                                            let file_path = path.join(path_, files[i]);
                                            let file_name = path.parse(file_path).name;
                                            let file_ext = path.parse(file_path).ext;
                                            let to_path = path.join(path_2, `${file_name}${file_ext}`);
                                            fs.copyFile(file_path, to_path, (err3) => {
                                                if (err3) console.log(`Error occured during coping file:\nFrom: ${file_path}\nTo: ${to_path}`.red);
                                            });
                                        }
                                        console.log(`Importing all files by query: ${query} done!`.magenta);
                                        resolve();
                                    });
                                });
                            }
                        });
                    });
                }
            });
        });
    });
    return e;
}

/* =========================================================================
 * ====================== VERBATIM FROM app.js - END =======================
 * ====================================================================== */


/* =========================================================================
 * ============================ NEW BEHAVIOUR ==============================
 * Backs the new option 13: "Import all of the above + apply emergency flags".
 * Nothing above this line was changed to make it work.
 * ====================================================================== */

/** The three flags option 13 stamps into every vehicle. */
const EMERGENCY_FLAGS = [
    "FLAG_LAW_ENFORCEMENT",
    "FLAG_EMERGENCY_SERVICE",
    "FLAG_REPORT_CRIME_IF_STANDING_ON"
];

function tokenizeFlags(raw) {
    return String(raw || "")
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
}

/**
 * Reads the merged output/vehicles.meta and appends the emergency flags to
 * every vehicle's <flags> element, skipping any flag a vehicle already has.
 *
 * The stamping is done on the raw text rather than by re-serialising the XML,
 * so the merged file the engine above produced is preserved byte-for-byte
 * apart from the <flags> lines themselves.
 */
function ApplyEmergencyFlags(flagsToAdd) {
    const flags = (flagsToAdd && flagsToAdd.length ? flagsToAdd : EMERGENCY_FLAGS).slice();

    return new Promise(function (resolve, reject) {
        const target = `${getDir()}/output/vehicles.meta`;

        if (!fs.existsSync(target)) {
            reject("No merged vehicles.meta found in the output folder - run the merge first.".red);
            return;
        }

        console.log(`Applying emergency flags to output/vehicles.meta...`.cyan);
        console.log(`Flags: ${flags.join(", ")}`.cyan);

        let xml;
        try {
            xml = fs.readFileSync(target, "utf8");
        } catch (e) {
            reject(`Could not read ${target}: ${e.message}`.red);
            return;
        }

        // Model names, in document order, purely so the log can name vehicles.
        const modelNames = [];
        const modelPattern = /<modelName>([^<]*)<\/modelName>/g;
        let modelMatch;
        while ((modelMatch = modelPattern.exec(xml)) !== null) {
            modelNames.push({ name: modelMatch[1].trim(), at: modelMatch.index });
        }

        function modelNameBefore(offset) {
            let found = null;
            for (let i = 0; i < modelNames.length; i++) {
                if (modelNames[i].at < offset) found = modelNames[i].name;
                else break;
            }
            return found || "(unnamed)";
        }

        const report = {
            vehicles: 0,
            updated: 0,
            alreadyComplete: 0,
            flagsWritten: 0,
            skipped: 0,
            details: []
        };

        const flagsPattern = /([ \t]*)<flags(\s[^>]*?)?(\/>|>([\s\S]*?)<\/flags>)/g;

        const stamped = xml.replace(flagsPattern, function (match, indent, attrs, tail, body, offset) {
            attrs = attrs || "";
            const valueAttr = attrs.match(/value\s*=\s*"([^"]*)"/i);
            const rawExisting = valueAttr ? valueAttr[1] : (body || "");
            const existing = tokenizeFlags(rawExisting);

            // Guard: only touch elements that hold vehicle flags (or nothing at
            // all). Anything else in the document is left exactly as it was.
            const isVehicleFlags = existing.every((t) => t.indexOf("FLAG_") === 0);
            if (!isVehicleFlags) {
                report.skipped++;
                return match;
            }

            report.vehicles++;
            const model = modelNameBefore(offset);
            const missing = flags.filter((f) => existing.indexOf(f) === -1);

            if (missing.length === 0) {
                report.alreadyComplete++;
                report.details.push({ model: model, added: [], status: "already had all three" });
                return match;
            }

            const merged = existing.concat(missing);
            report.updated++;
            report.flagsWritten += missing.length;
            report.details.push({ model: model, added: missing, status: "updated" });

            if (valueAttr) {
                const rebuiltAttrs = attrs.replace(/value\s*=\s*"[^"]*"/i, `value="${merged.join(" ")}"`);
                return `${indent}<flags${rebuiltAttrs} />`;
            }

            return `${indent}<flags>${merged.join(" ")}</flags>`;
        });

        try {
            fs.writeFileSync(target, stamped);
        } catch (e) {
            reject(`Could not write ${target}: ${e.message}`.red);
            return;
        }

        if (modelNames.length && modelNames.length !== report.vehicles) {
            console.log(
                `Note: found ${modelNames.length} model names but ${report.vehicles} flag blocks.`.yellow
            );
        }

        for (let i = 0; i < report.details.length; i++) {
            const d = report.details[i];
            if (d.added.length) console.log(`  ${d.model}: +${d.added.join(" +")}`.green);
        }

        if (report.skipped) {
            console.log(`Left ${report.skipped} non-vehicle flag element(s) untouched.`.yellow);
        }

        console.log(
            `Emergency flags done! ${report.updated} vehicle(s) updated, ${report.alreadyComplete} already complete, ${report.flagsWritten} flag(s) written.`.green
        );

        resolve(report);
    });
}

/**
 * Same glob-and-copy body as ImportFileByQueryFromDir, but taking its three
 * values as arguments instead of prompting stdin for them.
 */
function ImportFilesByQuery(fromDirectory, toDirectory, query) {
    let e = new Promise(function (resolve, reject) {
        fs.access(fromDirectory, (err) => {
            if (err) reject("Directory does not exist!".red);
            else {
                fs.access(toDirectory, (err2) => {
                    if (err2) reject("Directory does not exist!".red);
                    else {
                        glob(query, { cwd: fromDirectory }, function (er, files) {
                            if (er) reject(`Error occured during search for a files: ${er}`.red);
                            for (let i = 0; i < files.length; i++) {
                                let file_path = path.join(fromDirectory, files[i]);
                                let file_name = path.parse(file_path).name;
                                let file_ext = path.parse(file_path).ext;
                                let to_path = path.join(toDirectory, `${file_name}${file_ext}`);
                                fs.copyFile(file_path, to_path, (err3) => {
                                    if (err3) console.log(`Error occured during coping file:\nFrom: ${file_path}\nTo: ${to_path}`.red);
                                });
                            }
                            console.log(`Importing all files by query: ${query} done!`.magenta);
                            resolve(files.length);
                        });
                    }
                });
            }
        });
    });
    return e;
}

/** Counts of what is currently staged in each working folder. */
function workspaceStats() {
    const folders = {
        vehicles: "vehicles_meta",
        carcols: "carcols_meta",
        carvariations: "carvariations_meta",
        handling: "handling_meta",
        vehiclelayouts: "vehiclelayouts_meta"
    };
    const stats = { base: getDir(), staged: {}, output: {} };

    Object.keys(folders).forEach((key) => {
        const dir = `${getDir()}/${folders[key]}`;
        try {
            stats.staged[key] = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".meta")).length;
        } catch (e) {
            stats.staged[key] = 0;
        }
    });

    const outputs = {
        vehicles: "vehicles.meta",
        carcols: "carcols.meta",
        carvariations: "carvariations.meta",
        handling: "handling.meta",
        vehiclelayouts: "vehiclelayouts.meta",
        modelNames: "exportedModelNames.txt"
    };

    Object.keys(outputs).forEach((key) => {
        const file = `${getDir()}/output/${outputs[key]}`;
        try {
            const s = fs.statSync(file);
            stats.output[key] = { exists: true, size: s.size, modified: s.mtimeMs, path: file };
        } catch (e) {
            stats.output[key] = { exists: false, size: 0, modified: 0, path: file };
        }
    });

    // How many vehicles ended up in the merged file, for the hero readout.
    try {
        const xml = fs.readFileSync(`${getDir()}/output/vehicles.meta`, "utf8");
        stats.mergedVehicleCount = (xml.match(/<modelName>/g) || []).length;
    } catch (e) {
        stats.mergedVehicleCount = 0;
    }

    return stats;
}

/** Empties the five staging folders so the next import starts clean. */
function clearStagingFolders() {
    const folders = ["vehicles_meta", "carcols_meta", "carvariations_meta", "handling_meta", "vehiclelayouts_meta"];
    let removed = 0;
    folders.forEach((folder) => {
        const dir = `${getDir()}/${folder}`;
        try {
            fs.readdirSync(dir).forEach((f) => {
                if (f.toLowerCase().endsWith(".meta")) {
                    fs.unlinkSync(path.join(dir, f));
                    removed++;
                }
            });
        } catch (e) { /* folder missing is fine, ensureWorkspace recreates it */ }
    });
    console.log(`Cleared ${removed} staged .meta file(s).`.yellow);
    return removed;
}

module.exports = {
    bus,
    setBaseDir,
    getDir,
    ensureWorkspace,
    workspaceStats,
    clearStagingFolders,

    // merge procedures (1 - 6)
    VehiclesMetaProcedure,
    CarcolsMetaProcedure,
    CarvariationsMetaProcedure,
    HandlingMetaProcedure,
    VehicleLayoutsMetaProcedure,

    // directory imports (7 - 12)
    ImportVehiclesMetaFromDir,
    ImportCarcolsMetaFromDir,
    ImportCarvariationsMetaFromDir,
    ImportHandlingMetaFromDir,
    ImportVehicleLayoutsMetaFromDir,

    // new option 13
    ApplyEmergencyFlags,
    EMERGENCY_FLAGS,

    // 14 - 15
    ImportFilesByQuery,
    ExtractModelNamesFromVehiclesMeta
};
