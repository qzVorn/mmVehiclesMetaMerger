# mmVehiclesMetaMerger
 Tool made to easily merge multiple GTA5 vehicle meta files.

Original tool by [mmleczek](https://github.com/mmleczek) — this is a fork that adds a desktop
interface and one new operation. The merging engine itself is unchanged.

# Showcase
Go to [Youtube video](https://youtu.be/YJn6Eea5Zrs).

# Download
Click [here](https://github.com/mmleczek/mmVehiclesMetaMerger/releases) to go to the releases page and download it.

---

# What this fork adds

### 1. A desktop interface

The tool no longer runs as a console menu. `npm run build:win` produces a Windows
application with the same sixteen operations laid out as a proper interface:

* live counts of what is staged in each working folder
* the source directory picked with a folder browser instead of a typed path
* every operation on a card, grouped into Merge / Import / Tools
* the merged output files listed on the right, click to reveal them in Explorer
* the console output the CLI printed, streamed into an activity log with the same colours
* a dock with one-click access to the operations you run most

Drop the `.exe` anywhere; it creates `vehicles_meta/`, `carcols_meta/`,
`carvariations_meta/`, `handling_meta/`, `vehiclelayouts_meta/` and `output/`
next to itself, exactly like the console version did.

### 2. Option 13 — Import all + Emergency Flags

A new operation that does what option 12 does, then merges, then appends these flags
to every vehicle in the merged `output/vehicles.meta`:

```
FLAG_LAW_ENFORCEMENT
FLAG_EMERGENCY_SERVICE
FLAG_REPORT_CRIME_IF_STANDING_ON
```

A flag a vehicle already carries is never written twice, and flags the vehicle already
had are kept. Empty `<flags />` and `<flags></flags>` elements are filled in. Nothing in
the file outside the `<flags>` elements is touched.

The old options 13, 14 and 15 shifted up to 14, 15 and 16.

| # | Operation | | # | Operation |
|---|---|---|---|---|
| 1 | Merge vehicles.meta | | 9 | Import all carvariations.meta from directory |
| 2 | Merge carcols.meta | | 10 | Import all handling.meta from directory |
| 3 | Merge carvariations.meta | | 11 | Import all vehiclelayouts.meta from directory |
| 4 | Merge handling.meta | | 12 | Import all of the above from directory |
| 5 | Merge vehiclelayouts.meta | | **13** | **Import all of the above + emergency flags** |
| 6 | Merge all of the above | | 14 | Import other files from directory by search query |
| 7 | Import all vehicles.meta from directory | | 15 | Extract model names from vehicles.meta files |
| 8 | Import all carcols.meta from directory | | 16 | Exit |

### 3. Named output folders

Every merge lands in its own folder named after the pack you pointed it at, instead of
overwriting the same six files at the root of `output/`.

```
D:\packs\alhosn_debage\data   ->   output\alhosn_debage\
```

The name is worked out from the source path: container folders like `data`, `stream` and
`dlc` are skipped, and a pack nested inside a folder of its own name collapses to one. The
suggested name is editable before the run starts. Run the same pack twice and the second is
filed as `alhosn_debage (2)` — nothing is ever overwritten.

The Output panel is a scrollable list of those folders, newest first, each showing the pack
name, the vehicle count and how long ago it ran. Click one to see the meta files inside it,
`< back` to return. Folders can be deleted from the list.

Each folder also carries a small `_run.json` recording the source path, the timestamp, the
vehicle count and which files the run produced.

**This also fixes cross-pack contamination.** The five working folders were only ever added
to, so merging pack B straight after pack A quietly mixed A's cars into B's output. Each
import now clears its working folder first, so a run only ever contains the pack you gave it.

---

# Building

```bash
npm install
npm start           # run the desktop app in development
npm run build:win   # portable .exe + installer, into dist/
npm test            # end-to-end check of the merge + flag pipeline
npm run cli         # the original console menu, untouched
```

# Layout

| Path | What it is |
|---|---|
| `app.js` | The original console program. Untouched. |
| `src/core.js` | The merge / import engine. Every function is copied byte-for-byte out of `app.js`; only the `console` and `readline` seams are swapped so a window can drive them. |
| `src/main.js` | Electron main process. Plumbing only — each operation calls straight into `core.js`. |
| `src/preload.js` | The bridge between the interface and Node. |
| `src/renderer/` | The interface. |
| `test/verify.js` | Builds a fake resource tree and asserts the merge, the flag pass and the output folders behave. |

# License (custom one)
You are allowed to edit this program, just do it as a GitHub fork. If you want to add new features, feel free to PR them.
Please, do not claim my work as yours, put link to my GitHub profile in readme file.
