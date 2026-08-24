/*
 * verify.js - end-to-end check of the engine in src/core.js.
 *
 * Builds a fake resource tree, runs the exact sequence the new option 13 runs
 * (import all -> merge all -> apply emergency flags) and asserts:
 *
 *   - every vehicle from every source file survives the merge
 *   - all three emergency flags end up on every vehicle
 *   - a flag a vehicle already had is never written twice
 *   - flags the vehicle already had are preserved
 *   - empty <flags /> and <flags></flags> forms are handled
 *   - the other four merged files are still produced
 *
 * Run with:  npm test
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const core = require("../src/core");

let failures = 0;
function check(name, condition, detail) {
    if (condition) {
        console.log(`  PASS  ${name}`);
    } else {
        failures++;
        console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`);
    }
}

function vehiclesMeta(entries) {
    const items = entries.map((e) => `      <Item>
        <modelName>${e.model}</modelName>
        <txdName>${e.model}</txdName>
        <handlingId>${e.model.toUpperCase()}</handlingId>
        <gameName>${e.model.toUpperCase()}</gameName>
        <vehicleMakeName>TEST</vehicleMakeName>
        <type>VEHICLE_TYPE_CAR</type>
        <plateType>VPT_FRONT_AND_BACK_PLATES</plateType>
        <vehicleClass>VC_SEDAN</vehicleClass>
${e.flags}
        <dirtLevelMin value="0.000000"/>
        <dirtLevelMax value="0.450000"/>
      </Item>`).join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<CVehicleModelInfo__InitDataList>
  <residentTxd>vehshare</residentTxd>
  <residentAnims/>
  <InitDatas>
${items}
  </InitDatas>
  <txdRelationships>
    <Item>
      <parent>vehicles_${entries[0].model}_interior</parent>
      <child>${entries[0].model}</child>
    </Item>
  </txdRelationships>
</CVehicleModelInfo__InitDataList>`;
}

const CARCOLS = `<?xml version="1.0" encoding="UTF-8"?>
<CVehicleModelInfoVarGlobal>
  <Kits>
    <Item>
      <kitName>0_default_modkit</kitName>
      <id value="0"/>
    </Item>
  </Kits>
  <Lights/>
  <Sirens>
    <Item>
      <id value="200"/>
      <name>test_siren</name>
    </Item>
  </Sirens>
</CVehicleModelInfoVarGlobal>`;

const CARVARIATIONS = `<?xml version="1.0" encoding="UTF-8"?>
<CVehicleModelInfoVariation>
  <variationData>
    <Item>
      <modelName>testcar</modelName>
      <colors><Item><indices content="char_array"><Item value="0"/></indices></Item></colors>
    </Item>
  </variationData>
</CVehicleModelInfoVariation>`;

const HANDLING = `<?xml version="1.0" encoding="UTF-8"?>
<CHandlingDataMgr>
  <HandlingData>
    <Item type="CHandlingData">
      <handlingName>TESTCAR</handlingName>
      <fMass value="1800.000000"/>
    </Item>
  </HandlingData>
</CHandlingDataMgr>`;

const LAYOUTS = `<?xml version="1.0" encoding="UTF-8"?>
<CVehicleMetadataMgr>
  <VehicleLayoutInfos>
    <Item type="CVehicleLayoutInfo">
      <Name>LAYOUT_TEST</Name>
    </Item>
  </VehicleLayoutInfos>
</CVehicleMetadataMgr>`;

/* ------------------------------------------------------------------ */

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mmvmm-"));
    const workspace = path.join(root, "workspace");
    const resources = path.join(root, "resources");

    fs.mkdirSync(workspace, { recursive: true });

    // Three separate "resources", each nested a couple of folders deep, the way
    // a real FiveM / DLC pack tree looks.
    const packs = {
        "police/stream": vehiclesMeta([
            { model: "polvic", flags: "        <flags>FLAG_HAS_LIVERY FLAG_EXTRAS_STRONG</flags>" },
            { model: "polstang", flags: "        <flags>FLAG_LAW_ENFORCEMENT FLAG_HAS_LIVERY</flags>" }
        ]),
        "fire/data": vehiclesMeta([
            { model: "firetruk2", flags: "        <flags />" },
            { model: "ambulance2", flags: "        <flags></flags>" }
        ]),
        "civ/pack/data": vehiclesMeta([
            { model: "sultanrs2", flags: "        <flags>FLAG_SPORTS\n          FLAG_RICH_CAR</flags>" },
            { model: "unmarked", flags: "        <flags>FLAG_LAW_ENFORCEMENT FLAG_EMERGENCY_SERVICE FLAG_REPORT_CRIME_IF_STANDING_ON</flags>" }
        ])
    };

    Object.keys(packs).forEach((rel) => {
        const dir = path.join(resources, rel);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "vehicles.meta"), packs[rel]);
        fs.writeFileSync(path.join(dir, "carcols.meta"), CARCOLS);
        fs.writeFileSync(path.join(dir, "carvariations.meta"), CARVARIATIONS);
        fs.writeFileSync(path.join(dir, "handling.meta"), HANDLING);
        fs.writeFileSync(path.join(dir, "vehiclelayouts.meta"), LAYOUTS);
    });

    core.setBaseDir(workspace);
    core.ensureWorkspace();

    const quiet = [];
    core.bus.on("log", (line) => quiet.push(line));

    console.log("\nStep 1 - import everything from the source tree");
    await core.ImportVehiclesMetaFromDir(resources);
    await core.ImportCarcolsMetaFromDir(resources);
    await core.ImportCarvariationsMetaFromDir(resources);
    await core.ImportHandlingMetaFromDir(resources);
    await core.ImportVehicleLayoutsMetaFromDir(resources);
    await new Promise((r) => setTimeout(r, 700));

    const stagedBefore = core.workspaceStats();
    check("all 3 vehicles.meta files imported", stagedBefore.staged.vehicles === 3, `got ${stagedBefore.staged.vehicles}`);
    check("all 3 carcols.meta files imported", stagedBefore.staged.carcols === 3, `got ${stagedBefore.staged.carcols}`);
    check("all 3 handling.meta files imported", stagedBefore.staged.handling === 3, `got ${stagedBefore.staged.handling}`);

    console.log("\nStep 2 - merge everything");
    await core.VehiclesMetaProcedure();
    await core.CarcolsMetaProcedure();
    await core.CarvariationsMetaProcedure();
    await core.HandlingMetaProcedure();
    await core.VehicleLayoutsMetaProcedure();
    await new Promise((r) => setTimeout(r, 300));

    const outDir = path.join(workspace, "output");
    ["vehicles.meta", "carcols.meta", "carvariations.meta", "handling.meta", "vehiclelayouts.meta"].forEach((f) => {
        check(`output/${f} written`, fs.existsSync(path.join(outDir, f)));
    });

    const mergedBefore = fs.readFileSync(path.join(outDir, "vehicles.meta"), "utf8");
    const modelsBefore = (mergedBefore.match(/<modelName>([^<]*)<\/modelName>/g) || []);
    check("all 6 vehicles survived the merge", modelsBefore.length === 6, `got ${modelsBefore.length}: ${modelsBefore.join(", ")}`);
    check("merge produced exactly one <InitDatas> block", (mergedBefore.match(/<InitDatas>/g) || []).length === 1);
    check("merge produced exactly one </InitDatas> block", (mergedBefore.match(/<\/InitDatas>/g) || []).length === 1);

    console.log("\nStep 3 - apply the emergency flags");
    const report = await core.ApplyEmergencyFlags(core.EMERGENCY_FLAGS);
    const merged = fs.readFileSync(path.join(outDir, "vehicles.meta"), "utf8");

    const flagBlocks = merged.match(/<flags>([^<]*)<\/flags>/g) || [];
    check("one flags block per vehicle", flagBlocks.length === 6, `got ${flagBlocks.length}`);

    let allHaveAll = true;
    let noDuplicates = true;
    flagBlocks.forEach((block) => {
        const body = block.replace(/<\/?flags>/g, "");
        const tokens = body.split(/\s+/).filter(Boolean);
        core.EMERGENCY_FLAGS.forEach((f) => {
            if (tokens.indexOf(f) === -1) allHaveAll = false;
            if (tokens.filter((t) => t === f).length > 1) noDuplicates = false;
        });
    });

    check("every vehicle carries all three emergency flags", allHaveAll, flagBlocks.join("\n        "));
    check("no emergency flag written twice on any vehicle", noDuplicates, flagBlocks.join("\n        "));

    check("pre-existing flags preserved (FLAG_HAS_LIVERY)", /FLAG_HAS_LIVERY/.test(merged));
    check("pre-existing flags preserved (FLAG_EXTRAS_STRONG)", /FLAG_EXTRAS_STRONG/.test(merged));
    check("pre-existing flags preserved (FLAG_SPORTS)", /FLAG_SPORTS/.test(merged));
    check("pre-existing flags preserved (FLAG_RICH_CAR)", /FLAG_RICH_CAR/.test(merged));

    check("empty <flags /> was filled in", !/<flags\s*\/>/.test(merged), "a self-closing flags element is still empty");
    check("vehicle that already had all three was left alone", report.alreadyComplete === 1, `alreadyComplete=${report.alreadyComplete}`);
    check("five vehicles were updated", report.updated === 5, `updated=${report.updated}`);
    check("14 flags written in total", report.flagsWritten === 14, `flagsWritten=${report.flagsWritten} (2+1+3+3+3+2 expected)`);

    // Everything outside the flags elements must be untouched.
    const stripFlags = (s) => s.replace(/[ \t]*<flags(\s[^>]*?)?(\/>|>[\s\S]*?<\/flags>)/g, "<FLAGS/>");
    check("nothing outside <flags> changed", stripFlags(mergedBefore) === stripFlags(merged),
        "the flag pass altered content it should not have touched");

    const modelsAfter = merged.match(/<modelName>([^<]*)<\/modelName>/g) || [];
    check("model list unchanged by the flag pass", modelsAfter.join() === modelsBefore.join());

    console.log("\nStep 4 - model name extraction");
    await core.ExtractModelNamesFromVehiclesMeta();
    await new Promise((r) => setTimeout(r, 200));
    const names = fs.readFileSync(path.join(outDir, "exportedModelNames.txt"), "utf8").trim().split("\n");

    // NOTE: this asserts the CURRENT upstream behaviour, not ideal behaviour.
    // ExtractModelNamesVehicleMetas() only ever reads obj.Item[0], so it exports
    // the FIRST vehicle out of each staged file and silently drops the rest.
    // With 3 files holding 2 vehicles each that is 3 names, not 6. This is a
    // pre-existing bug in app.js and has deliberately been left untouched.
    check("exports one model name per staged file (upstream behaviour)", names.length === 3, names.join(", "));

    // ------------------------------------------------------------------
    // Regression tests for the 2.0.1 fix.
    //
    // Before 2.0.1 a single bad vehicles.meta anywhere in the batch made
    // MergeVehicleMetas throw. The throw was swallowed upstream, so
    // output/vehicles.meta was never rewritten and the user was left looking at
    // the previous run's file. handling.meta was unaffected because it already
    // had the guard, which is exactly how the bug was reported.
    // ------------------------------------------------------------------
    console.log("\nStep 5 - one bad file must not kill the whole merge");

    const GOOD = (m) => `<?xml version="1.0" encoding="UTF-8"?>
<CVehicleModelInfo__InitDataList>
  <residentTxd>vehshare</residentTxd>
  <InitDatas>
    <Item><modelName>${m}</modelName><flags>FLAG_HAS_LIVERY</flags></Item>
  </InitDatas>
</CVehicleModelInfo__InitDataList>`;

    const BAD = {
        "no <InitDatas> block": `<?xml version="1.0" encoding="UTF-8"?>\n<CVehicleModelInfo__InitDataList>\n  <residentTxd>vehshare</residentTxd>\n</CVehicleModelInfo__InitDataList>`,
        "wrong root element": `<?xml version="1.0" encoding="UTF-8"?>\n<CVehicleModelInfoVarGlobal>\n  <Kits><Item><kitName>x</kitName></Item></Kits>\n</CVehicleModelInfoVarGlobal>`,
        "invalid XML (unescaped &)": `<?xml version="1.0" encoding="UTF-8"?>\n<CVehicleModelInfo__InitDataList>\n  <InitDatas><Item><modelName>a&b</modelName></Item></InitDatas>\n</CVehicleModelInfo__InitDataList>`,
        "empty file": ""
    };

    for (const label of Object.keys(BAD)) {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), "mmvmm-bad-"));
        core.setBaseDir(ws);
        core.ensureWorkspace();

        fs.writeFileSync(path.join(ws, "vehicles_meta", "vehicles0.meta"), GOOD("good_a"));
        fs.writeFileSync(path.join(ws, "vehicles_meta", "vehicles1.meta"), BAD[label]);
        fs.writeFileSync(path.join(ws, "vehicles_meta", "vehicles2.meta"), GOOD("good_c"));

        await core.VehiclesMetaProcedure();
        await new Promise((r) => setTimeout(r, 250));

        const out = path.join(ws, "output", "vehicles.meta");
        const written = fs.existsSync(out);
        const count = written ? (fs.readFileSync(out, "utf8").match(/<modelName>/g) || []).length : -1;

        check(`bad file "${label}" - output still written`, written, "output/vehicles.meta was not written at all");
        check(`bad file "${label}" - both good vehicles merged`, count === 2, `expected 2 vehicles, got ${count}`);
    }

    // The first file being the bad one is the nastier case: `o` is seeded from
    // files[0], so a bad file there used to throw before the loop even started.
    {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), "mmvmm-bad0-"));
        core.setBaseDir(ws);
        core.ensureWorkspace();
        fs.writeFileSync(path.join(ws, "vehicles_meta", "vehicles0.meta"), BAD["wrong root element"]);
        fs.writeFileSync(path.join(ws, "vehicles_meta", "vehicles1.meta"), GOOD("good_a"));
        fs.writeFileSync(path.join(ws, "vehicles_meta", "vehicles2.meta"), GOOD("good_c"));

        await core.VehiclesMetaProcedure();
        await new Promise((r) => setTimeout(r, 250));

        const out = path.join(ws, "output", "vehicles.meta");
        const count = fs.existsSync(out) ? (fs.readFileSync(out, "utf8").match(/<modelName>/g) || []).length : -1;
        check("bad file is the FIRST one - both good vehicles still merged", count === 2, `expected 2 vehicles, got ${count}`);
    }

    // Restore the main workspace for the summary below.
    core.setBaseDir(workspace);

    console.log("\nMerged output/vehicles.meta flags:");
    flagBlocks.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));

    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
    console.log(`Workspace kept at: ${workspace}\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error("verify.js crashed:", e);
    process.exit(1);
});
