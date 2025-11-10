# Teensy Memory Explorer

Static analysis utilities for inspecting how embedded firmware uses memory, with current
configurations focused on **Teensy 4.x** targets.

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

## Development Notes
- `yarn build` runs `tsc -b` for both analyzer and CLI packages.
- `yarn run clean` removes generated `dist/` folders.
- When adjusting memory behavior for a board, update the config JSON and keep the CLI layer aligned with
  official tooling for sanity checks.

---

```

cls && yarn run build && yarn workspace @teensy-mem-explorer/viewer dev

```