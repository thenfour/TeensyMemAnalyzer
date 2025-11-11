# Teensy Memory Explorer

Static analysis utilities for inspecting how embedded firmware uses memory, with current
configurations focused on **Teensy 4.x** targets.

---

## Terminology

Understanding how the analyzer names things helps when jumping between the CLI, configs, and
viewer panels.

- **Source artifacts (ELF/MAP)**
  - `Section`: Raw sections extracted from the ELF (e.g. `.text.code`, `.bss`). They know their
    virtual/load addresses but no higher-level context.
  - `Symbol`: Named ranges inside sections. Symbols inherit the region assigned to their parent
    section once analysis finishes.
- **Logical memory map (`config/*.json`)**
  - `Region`: A contiguous address range on the MCU (FLASH, ITCM, DTCM, DMAMEM, …). Regions describe
    start, size, and optional reserved sub-ranges that cannot be used by the linker.
  - `Reserved range`: A named carve-out inside a region that reduces its usable capacity (boot
    headers, trap words, etc.).
- **Runtime layout (also in the config)**
  - `Runtime bank`: A pool the firmware allocates from at runtime. Example: `ram1_itcm` in
    `config/teensy40.json` sources bytes from the `ITCM` region and represents the instructions that
    land in tightly-coupled RAM. Banks can override their capacity when the usable runtime pool is
    smaller than the raw region slice.
  - `Segment`: A bank entry that references a region (and optional start/size slice). Example: the
    `ram2_axi` bank has a single segment pointing at the `DMAMEM` region; other boards can split a
    region into multiple segments to constrain a bank to a subrange.
  - `Runtime group`: A higher-level rollup of banks that behave as a shared pool (e.g. `ram1`
    combines `ram1_itcm` and `ram1_dtcm`). Groups can expose a shared capacity hint so UI and reports
    cap the total instead of naively summing member banks.
- **Analysis output (`analysis.json`)**
  - `summaries.byRegion`: Usage per region after sections/symbols are mapped.
  - `summaries.runtimeBanks`: Usage per runtime bank, including contributor details.
  - `summaries.runtimeGroups`: Aggregated usage per runtime group, carrying the member bank IDs.
  - `reporting.teensySize`: Stored copy of the report config. The viewer uses shared-capacity hints
    here to mirror `teensy_size` totals (e.g. `ram1.sharedCapacityBytes = 524288` for Teensy 4.0).
- **Viewer cards**
  - *Regions*: Shows per-region usage and occupied address ranges straight from `byRegion` plus
    section-derived spans.
  - *Runtime Banks*: By default renders `runtimeGroups` so Flash/RAM1/RAM2 totals match
    `teensy_size`. If a target defines no groups, it falls back to the raw banks list.

---

## Key Capabilities
- Parse ELF (and optional MAP) files and map every section & symbol into logical memory regions.
- Summarize flash and RAM usage by region and category, including reserved ranges and free space.
- Emit a structured JSON model that other tooling or visualizations can consume.
- Provide a CLI with human-readable summaries, parity fields that match `teensy_size`, and top-symbol listings.
- Offer an experimental web viewer (React + Vite) for visual memory exploration.

---

## Quick Start
1. **Install prerequisites**
   - Node.js 18+ and Yarn 1.x.
   - Optionally, a local `arm-none-eabi-*` toolchain if you want source/addr2line lookups (pass its location via `--toolchain-dir`).
2. **Build once**
   ```powershell
   yarn install
   yarn build
   ```
3. **Analyze a firmware build**
   ```powershell
   node packages/cli/dist/index.js `
     --target teensy40 `
     --elf example/firmware.elf `
     --map example/firmware.map `
     --toolchain-dir "C:\Users\you\.platformio\packages\toolchain-gccarmnoneeabi-teensy\bin"
   ```
   Add `--json` for machine-readable output.
4. **Use the helper script (optional)**
   ```powershell
   .\example\run-cli.ps1       # text output
   .\example\run-cli.ps1 -Json  # JSON output
   ```

5. **Launch the viewer (optional)**
  ```powershell
  yarn workspace @teensy-mem-explorer/viewer dev
  ```
  This command now starts both the React frontend (default `http://localhost:5173`) and a local companion
  service on port `5317`. Open the browser URL, click *Load analysis JSON*, and select the analyzer output you
  want to explore. The companion panel will show connection status while we flesh out automated workflows.

### Viewer Workflow

1. Generate an analysis JSON file (e.g. `teensy-mem-explorer ... --json > analysis.json`).
2. Run `yarn workspace @teensy-mem-explorer/viewer dev` to start the frontend.
3. Visit the printed URL, upload `analysis.json`, and use the panels to inspect memory usage.

---

## CLI Output at a Glance
The CLI prints region totals, category breakdowns, top symbols, and a `Teensy-size fields:` block
that mirrors the canonical [`teensy_size`](https://github.com/PaulStoffregen/teensy_size) utility.

- **FLASH buckets** come straight from linker sections for parity: `code = .text.code + .text.itcm + .ARM.exidx`,
  `data = .text.progmem + .data`, `headers = .text.headers + .text.csf`. Free space subtracts both
  the reserved flash sectors defined in the memory map and those buckets from the 0x1F0000-byte
  Teensy 4.x flash budget.
- **RAM1 buckets** match `teensy_size` by combining ITCM and DTCM. The ITCM code total (including
  `.ARM.exidx`) is rounded up to 32 KiB blocks before subtracting `.data + .bss` to report "free
  for local variables". Padding is the difference between the rounded blocks and the raw code size.
- **RAM2** reports DMAMEM usage plus `free for malloc/new` from the region summary.

Alignment gaps inside a region surface under `Alignment padding` whenever the analyzer detects
non-alloc gaps between sections.

---

## Project Layout
- `packages/analyzer/` – TypeScript library that loads memory-map configs, parses ELF/MAP data, and 
  produces the analysis model.
- `packages/cli/` – CLI wrapper that prints summaries or the full JSON analysis.
- `config/` – Memory-map definitions (e.g. `teensy40.json`, `teensy41.json`).
- `example/` – Sample firmware, MAP, reference `teensy_size` output, and helper script.

The analyzer keeps the core platform-neutral; Teensy specifics live in config files and CLI formatting logic.


---

## Comparing with `teensy_size`

The example firmware under `example/firmware.elf` is the same binary referenced in the
`teensy_size` output copied into `example/readme.txt`. Running the CLI after building
(`node packages/cli/dist/index.js --target teensy41 --elf example/firmware.elf --map example/firmware.map  --json`)
produces totals that line up with the toolchain report once you map the categories:

- Flash totals match: `flashUsed` (475,136 B) equals `teensy_size`'s
  `code + data + headers` (390,840 + 75,120 + 9,172). The apparent mismatch in the
  "code" bucket is because the analyzer records FASTRUN blocks twice—runtime bytes in
  ITCM (`ramCode`) and their copy stored in flash as `flashInitImages`, while
  `teensy_size` folds those bytes into its `FLASH code` column.
- RAM1 differences are representational. `teensy_size` merges the ITCM and DTCM halves of
  the tightly-coupled memory and labels the unused 6,984 B as "padding". The analyzer keeps
  them as separate regions: ITCM reports zero padding because the executable sections are
  tightly packed, and the same 6,984 B simply shows up as `freeForDynamic` inside ITCM.
  DTCM retains the 49,088 B of variables that `teensy_size` attributes to RAM1.
- Non-ALLOC sections (debug info, object file metadata) never consume runtime memory but do
  appear in tooling. These bytes now surface under `summaries.fileOnly` so they stay visible
  without polluting the region totals that feed free-space estimates.

If a future firmware produces a real gap inside a region (for example alignment padding between
ALLOC sections), `paddingBytes` and `largestGapBytes` in each `RegionSummary` will become non-zero
and the CLI will print them under "Alignment padding" for that region.

### Teensy-size field parity

For quick spot checks we now emit a `Teensy-size fields:` block in the human-readable CLI output.
Those values are calculated to match the
[`teensy_size`](https://github.com/PaulStoffregen/teensy_size) utility byte-for-byte so you can
compare results without leaving the repo. A couple of nuances are worth calling out:

- `RAM1` combines ITCM and DTCM just like the reference tool. `code` is the sum of `.text.itcm`
  plus `.ARM.exidx`, and it is rounded up to 32 KiB blocks before computing padding and free space
  (`512 KiB total − rounded code − (.data + .bss)` equals "free for local variables").
- `FLASH` buckets pull directly from the linker sections: `code = .text.code + .text.itcm + .ARM.exidx`,
  `data = .text.progmem + .data`, and `headers = .text.headers + .text.csf`. The "free for files"
  figure starts from the configured flash capacity (region size minus truly vacant reserved sectors)
  and subtracts that total, matching the 0x1F0000 byte budget used by `teensy_size` on Teensy 4.x.
- `FLASH` free space excludes reserved ranges that are still empty (flexspi config, IVT, recovery
  sector). This mirrors how `teensy_size` reports "free for files" even though those sectors are
  unavailable to user code.

These rules live in the CLI presentation layer so the analyzer core stays platform-neutral. Any
board-specific quirks should continue to be captured via the memory-map config rather than
hard-coded logic.


---

## Development Notes
- `yarn build` runs `tsc -b` for both analyzer and CLI packages.
- `yarn run clean` removes generated `dist/` folders.
- When adjusting memory behavior for a board, update the config JSON and keep the CLI layer aligned with
  official tooling for sanity checks.

---

```

cls && yarn run build && yarn workspace @teensy-mem-explorer/viewer dev

cls && yarn run build && yarn workspace @teensy-mem-explorer/cli teensy-mem-explorer --target teensy40 --elf "C:\root\git\thenfour\TeensyMemAnalyzer\example\firmware.elf" --map "C:\root\git\thenfour\TeensyMemAnalyzer\example\firmware.map" --toolchain-dir "C:\Users\carl\.platformio\packages\toolchain-gccarmnoneeabi-teensy\bin"


```