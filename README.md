# Teensy Memory Explorer

Static analysis utilities for inspecting how embedded firmware uses memory, with current
configurations focused on **Teensy 4.x** targets.

---

## Terminology

Understanding how the analyzer names things helps when jumping between the CLI, configs, and
viewer panels.

- `Section`: Raw sections extracted from the ELF (e.g. `.text.code`, `.bss`). They know their
  virtual/load addresses but no higher-level context.
- `Section category`: A reusable semantic label (e.g. `fastrun`, `flash_headers`) that groups one or
  more sections which should be handled the same way. Categories keep linker quirks out of the
  hardware descriptions and let reports talk in business terms.
- `Logical block`: A placement rule that binds a `sectionCategory` to a single `addressWindow`.
  Blocks can carry optional roles such as `load`, `exec`, or `runtime`, letting the same category
  appear in multiple windows (FASTRUN executes in ITCM but loads from flash).
- `Address window`: A contiguous physical range on the MCU (FLASH, ITCM, OCRAM, …). Windows describe
  *where* bytes land but intentionally omit synthetic size/start metadata—the ELF already carries
  the true addresses.
- `Hardware bank`: A capacity-tracked bucket that contains one or more windows. Banks mirror how the
  MCU markets its memories (RAM1 combines ITCM + DTCM) and expose rounding rules to match tooling
  like `teensy_size`.
- `Report tag`: A label attached to logical blocks so reports can aggregate without re-stating the
  mapping logic. Tag buckets in reports stay stable even when sections/categories evolve.

- **Source artifacts (ELF/MAP)**
  - `Symbol`: Named ranges inside sections. Symbols inherit the address window chosen for their
    parent category after analysis completes.
- **Logical memory map (`config/*.json`)**
  - `Design notes`: Optional free-form prose captured in each entity to document hardware trivia or
    policy decisions.
- **Analysis output (`analysis.json`)**
  - `summaries.byWindow`: Usage per address window (including dual-residency load/exec blocks).
  - `summaries.hardwareBanks`: Usage per hardware bank with rounding applied.
  - `reporting.teensySize`: Stored copy of the report config. The viewer and CLI reuse the same
    definitions to mirror `teensy_size` totals.
- **Viewer cards**
  - *Address windows*: Shows contiguous physical ranges plus the blocks that land in them.
  - *Hardware banks*: Mirrors the capacity buckets defined in the config so totals stay aligned with
    the CLI/`teensy_size` output.

---

## Design Rationale

A few principles guided the schema revamp:

- **Let the ELF tell us where bytes live.** Address windows no longer repeat `start`/`size` pairs—
  the analyzer trusts symbol addresses and surfaces gaps directly from the binary. The config focuses
  on intent, not duplicating linker math.
- **Model dual residency explicitly.** FASTRUN code and initialised data exist in flash *and* RAM.
  Using section categories plus logical blocks means we map the load image and execute image
  separately, keeping flash usage honest while still reporting RAM consumption.
- **Keep semantics reusable.** Section categories create a stable vocabulary (`flash_headers`,
  `ocram_data_init`, …) so adding a new section only requires assigning an existing category. Reports
  and viewer logic stay untouched.
- **Reflect the hardware hierarchy.** Address windows capture contiguous ranges (ITCM, DTCM, OCRAM),
  while hardware banks describe the marketing terms (RAM1, RAM2, FLASH) and aggregate capacity.
  Rounding rules live on banks because they are a property of the hardware pool, not individual
  sections.
- **Make reporting declarative.** Reports reference logical block IDs and tag buckets rather than
  repeating ELF section names. That keeps CLI parity fields and visualisations in sync even as the
  linker script evolves.

### Agent-Facing Implementation Principles

For future agent-driven edits (human or AI), keep these guardrails in mind:

- **Precision over guesses.** Prefer explicit matches and schema-validated fields; avoid silent
  inference when the ELF or config can state the fact directly.
- **Hardware-accurate modelling.** Treat datasheet boundaries as the source of truth. If the MCU is
  ambiguous, add design notes and require an explicit override instead of assuming.
- **Correctness first, then convenience.** Reject or error on unmapped sections rather than burying
  them in catch-alls. Reports should fail loudly when inputs drift.
- **Cleanliness over compatibility** Do not make compromises in architecture or code quality / brevety in the pursuit of keeping backwards compatibility with a design that is obsolete and to be discarded. Make correct clean code, and adjust downstream as necessary. Don't let downstream messiness bleed up into the core design.
- **Robustness via validation.** Lean on schema checks and targeted assertions so regressions are
  caught early. Document rounding rules and capacities so parity tests stay meaningful.
- **Avoid blanket fallbacks.** When a new section appears, force an explicit category assignment.
  Broad "other" buckets are reserved for intentional aggregation, not as safety nets.

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
The CLI prints window totals, category breakdowns, top symbols, and a `Teensy-size fields:` block
that mirrors the canonical [`teensy_size`](https://github.com/PaulStoffregen/teensy_size) utility.

- **FLASH buckets** draw from the section categories bound to flash-aligned blocks: `headers`
  captures the FASTBOOT structures, `code` includes pure flash code plus the load copy of FASTRUN,
  and `data` accounts for PROGMEM constants and RAM initialisation images.
- **RAM1 buckets** combine ITCM and DTCM automatically by referencing the RAM1 hardware bank. The
  configured rounding rule ensures FASTRUN code is rounded up to 32 KiB chunks before free space is
  computed, matching the legacy toolchain.
- **RAM2 / External RAM** follow the same pattern: totals come from the hardware bank definitions,
  and tag buckets decide how the CLI labels the bytes.

Alignment gaps inside an address window surface under `Alignment padding` whenever the analyzer
detects non-ALLOC gaps between sections.

---

## Project Layout
- `packages/analyzer/` – TypeScript library that loads memory-map configs, parses ELF/MAP data, and 
  produces the analysis model.
- `packages/cli/` – CLI wrapper that prints summaries or the full JSON analysis.
- `config/` – Memory-map definitions (e.g. `teensy40.json`, `teensy41.json`). Each file declares
  section categories, logical blocks, address windows, hardware banks, and tailored reports.
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