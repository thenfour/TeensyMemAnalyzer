# Teensy Memory Explorer

A toolkit for **static analysis and visualization of memory usage** in embedded firmware builds, with an initial focus on **Teensy 4.x** devices.

This document is written to brief an implementation agent. It describes the intent, architecture, and expected outputs, without prescribing every file or line of code.

---

## 1. Context & Intent

Teensy-class MCUs (especially Teensy 4.x) have a non-trivial memory architecture:

- Multiple distinct regions (FLASH, ITCM, DTCM, DMAMEM/OCRAM, EXTMEM, etc.).
- Code that may execute directly from flash or be copied into fast RAM at startup (e.g. `FASTRUN`).
- `.data` sections with initialization images stored in flash and copied to RAM.
- `.bss` and other zero-initialized runtime-only regions.
- Dedicated RAM for DMA buffers and other special uses.

Developers currently rely on scattered tools (`arm-none-eabi-size`, `objdump`, `nm`, `addr2line`, reading `.map` files) to answer questions like:

- Which functions or objects are consuming critical memory regions (e.g. FASTRUN / ITCM, DMAMEM)?
- How much RAM is left for heap and stack after static allocations?
- How much flash is code vs read-only data vs init images?
- Where does a given symbol live (address, section, region, source file/line)?

The goal of this project is to provide a cohesive toolchain that:

1. Performs **precise static analysis** of a given firmware build.
2. Produces a **structured model** of memory usage (regions, sections, symbols, summaries).
3. Can be consumed by one or more **interactive frontends** (e.g. treemaps, tables, search UIs).
4. Is initially tailored for Teensy 4.x, but designed to be extendable to other MCUs via configuration.

---

## 2. High-Level Goals

The system should enable at least the following capabilities:

1. **Static Memory Breakdown**
   - Parse ELF (and optionally MAP) files from a build.
   - Understand the target’s memory map using a configurable description.
   - Attribute every section and symbol to:
     - A concrete address range.
     - A logical region (FLASH, DTCM, DMAMEM, etc.).
     - A semantic category (code, rodata, data, bss, dma, etc.).

2. **Granular Symbol-Level Accounting**
   - Enumerate all code and data symbols (not just “top N”):
     - Mangled and demangled names.
     - Addresses (VMA) and sizes.
     - Owning section and region.
   - Provide enough detail so every byte of relevant sections can be explained or grouped.

3. **Region & Category Summaries**
   - For each region:
     - Total size.
     - Statically used bytes by category.
     - Configurable reserved segments.
     - Derived “free for dynamic use” (heap/stack) estimate.
   - For flash:
     - Distinguish:
       - Directly executed code.
       - Read-only data.
       - Init images for `.data` and any fast code run from RAM.

4. **Developer Queries to Support**
   The model must easily answer questions such as:
   - How much memory is used by code vs variables?
   - How much memory is available at runtime in each region for heap and stack?
   - How much `FLASHMEM` is used, and how much of that is consumed by init images for `.data` / `FASTRUN`?
   - Which symbols are the largest consumers in FASTRUN, DMAMEM, etc.?
   - For a given symbol: where is it, how big is it, which source file/line does it map to?
   - (Future) Which structs incur the most padding / wasted space?

5. **Visualization-Ready**
   - Expose a clean, rich data model that can drive:
     - Treemaps (e.g. Region → Section → Symbol).
     - Tables and hierarchical explorers.
     - Heatmaps or other visual metaphors.
   - Frontends should be separate from analysis; they consume the analysis result via a defined interface.

---

## 3. Design: Memory Map Configuration

The memory layout must be **configurable**, not hardcoded.

A memory map config (likely JSON or similar) should define:

- A list of regions, e.g. for Teensy 4.x:
  - `FLASH`  (QSPI flash)
  - `ITCM`   (tightly coupled instruction RAM for fast code)
  - `DTCM`   (tightly coupled data RAM)
  - `DMAMEM` / OCRAM (DMA-capable RAM)
  - `EXTMEM` (optional external RAM)
- For each region:
  - `id` (stable identifier, e.g. `"FLASH"`)
  - `name` (human label)
  - `kind` (e.g. `"flash"`, `"code_ram"`, `"data_ram"`, `"dma_ram"`, `"ext_ram"`, `"other"`)
  - `start` (base address)
  - `size` (bytes)
  - Optional `reserved` subranges:
    - Named ranges (e.g. vector table, system areas, fixed stack windows) that should be subtracted from “available for dynamic use”.

The analyzer will:

- Use ELF/MAP data plus this config to assign:
  - Each section to a region based on its VMA.
  - Each symbol to a section and region based on its address.
- Support specialized behavior:
  - Sections where VMA and LMA differ:
    - e.g. `.data` stored in flash and copied into RAM.
    - e.g. fast code sections stored in flash but executed from ITCM.
  - These “copy” sections should be modeled so they contribute to:
    - Flash usage (init images at LMA).
    - RAM usage (runtime location at VMA).

---

## 4. Design: Static Analysis Output Model

The analyzer should produce a **single, structured in-memory model**. JSON export is allowed for tooling, but the primary interface is an API over this model.

Below is a conceptual outline of that model in TypeScript-like notation (for guidance; implementation details left to the coding agent).

### 4.1 Top-Level Structure

    interface Analysis {
      target: TargetInfo;
      build: BuildInfo;
      regions: Region[];
      sections: Section[];
      symbols: Symbol[];
      summaries: Summaries;
    }

### 4.2 Target & Build

    interface TargetInfo {
      name: string;          // e.g. "Teensy 4.1"
      addressModel: "flat";  // can be extended later
      pointerSize: number;   // e.g. 4
    }

    interface BuildInfo {
      elfPath: string;
      mapPath?: string;
      buildId?: string;      // git hash or user-provided ID
      timestamp?: string;
    }

### 4.3 Regions

    type RegionKind =
      | "flash"
      | "code_ram"
      | "data_ram"
      | "dma_ram"
      | "ext_ram"
      | "other";

    interface Region {
      id: string;            // stable identifier, e.g. "FLASH"
      name: string;          // human label
      kind: RegionKind;
      start: number;         // inclusive
      size: number;          // in bytes
      reserved?: RegionReserve[];
    }

    interface RegionReserve {
      name: string;
      start: number;
      size: number;
    }

### 4.4 Sections (VMA/LMA and Categories)

Sections represent ELF sections enriched with semantic meaning and load/exec mapping.

    type SectionCategory =
      | "code"
      | "code_fast"
      | "rodata"
      | "data_init"
      | "bss"
      | "dma"
      | "other";

    interface Section {
      id: string;
      name: string;            // e.g. ".text", ".data", ".bss", ".fastrun", ".dmabss"

      vmaStart: number;        // runtime address
      size: number;

      execRegionId?: string;   // region containing VMA

      // For sections whose contents are copied from flash at startup:
      lmaStart?: number;       // load address in flash
      loadRegionId?: string;   // region containing the LMA
      isCopySection?: boolean; // true if VMA != LMA

      category: SectionCategory;

      flags: {
        alloc: boolean;
        exec: boolean;
        write: boolean;
        tls?: boolean;
      };
    }

Key requirements:

- `.data` and FASTRUN-like sections should be represented as consuming:
  - Flash space at LMA (init image).
  - RAM space at VMA (runtime).
- `.bss` should be RAM-only, zero-init.
- DMAMEM/EXTMEM specifics should map via config/addresses.

### 4.5 Symbols

Every relevant symbol is represented explicitly.

    type SymbolKind = "func" | "object" | "section" | "file" | "other";

    interface Symbol {
      id: string;

      nameMangled: string;
      name: string;             // demangled (human-readable)

      kind: SymbolKind;

      addr: number;             // VMA
      size: number;             // 0 allowed; tools should handle

      sectionId?: string;
      regionId?: string;        // derived via regions

      isWeak?: boolean;
      isStatic?: boolean;
      isTls?: boolean;

      source?: SourceLocation;  // optional (DWARF / addr2line integration)

      // Optional: hierarchy tokens for visualization (e.g. namespaces/classes)
      logicalPath?: string[];
    }

    interface SourceLocation {
      file: string;
      line: number;
    }

Requirements:

- Demangling should be applied so `name` is pleasant to read and search.
- The model should support looking up any symbol by name or address and showing:
  - Its memory footprint.
  - Where it resides.
  - Where it originated (file/line, when available).

### 4.6 Summaries

Precomputed summaries for fast answers and UI rendering.

    interface Summaries {
      totals: TotalsSummary;
      byRegion: RegionSummary[];
      byCategory: CategorySummary[];
    }

    interface TotalsSummary {
      flashUsed: number;          // all flash usage
      flashCode: number;          // executable code in flash
      flashConst: number;         // rodata etc.
      flashInitImages: number;    // .data / fast code init images

      ramUsed: number;            // aggregate over all RAM regions
      ramCode: number;            // code in ITCM/other RAM
      ramDataInit: number;        // initialized data in RAM
      ramBss: number;             // zero-init data
      ramDma: number;             // DMA-specific regions
    }

    interface RegionSummary {
      regionId: string;
      size: number;
      usedStatic: number;         // sum of statically allocated bytes
      usedByCategory: Partial<Record<SectionCategory, number>>;
      reserved: number;           // bytes reserved
      freeForDynamic: number;     // size - usedStatic - reserved
    }

    interface CategorySummary {
      category: SectionCategory;
      bytes: number;
    }

These summaries should make it trivial to answer:
- “How full is each region?”
- “What’s consuming my FASTRUN?”
- “How much is left for heap/stack?”

---

## 5. Future / Eventual Intentions

The initial deliverable is the **static analysis core** plus a minimal interface (e.g. CLI) to inspect results.

Eventually, the following are expected:

1. **Treemap Visualizers**
   - Visual hierarchy:
     - Region → Section → (Optionally File/Namespace) → Symbol.
   - Rectangle size proportional to symbol size.
   - Color or grouping by category (code, data, bss, dma, etc.).

2. **Interactive Frontend(s)**
   - Likely implemented in React, consuming the analysis model:
     - Region usage overview.
     - Filterable/sortable symbol tables.
     - “Jump to symbol” and “where is this in memory?” interactions.
     - Optional integration with `addr2line` for source resolution on demand.
   - Possibly packaged as:
     - A desktop app (Electron/Tauri).
     - Or a dev-time web tool.

3. **Advanced Features (Phase 2+)**
   - Build-to-build diffing:
     - See how memory usage changes over time.
   - Padding / struct layout analysis:
     - Identify structs with large internal gaps.
   - Integration with runtime data:
     - E.g. import measured stack/heap high-water marks and overlay them onto static regions.

These advanced features rely on the robustness and clarity of the initial analysis model and are out of scope for the first implementation pass, but should be kept in mind when designing APIs.

---

## 6. Tech Stack & Justification

**Core Analyzer**

- Language: **TypeScript** (Node.js)
- Reasons:
  - Strong typing for complex models.
  - Easy integration with JSON, CLIs, and web/desktop frontends.
  - Good fit for rapid iteration and distribution across platforms.
  - Straightforward to call external toolchain utilities (`arm-none-eabi-*`) where needed.

**Frontend(s)**

- **React** for visualization and UI.
- Reasons:
  - Well-suited to rich, interactive, hierarchical UIs.
  - Ecosystem support for charts, treemaps, tables.
  - Code reuse between web and Electron/Tauri builds.

**Package manager**

Yarn is preferred.

**IDE**

VS Code shall be used as the primary dev tool, with additional support as needed via cmd.

**External Tools**

- Use existing `arm-none-eabi-*` tools where practical:
  - `nm`, `objdump`, `size`, `addr2line`, `c++filt` for:
    - Symbol extraction
    - Demangling
    - Source mapping
- The core should be structured so these are pluggable:
  - Can later be replaced or complemented by direct ELF/DWARF parsing.

**Note:** Platform independence is nice to have, but **Windows** is a primary environment. Node/TS/React keeps this straightforward.

---

## 7. Project Layout & Dev Workflow (Intended)

This is a suggested high-level structure. The coding agent should implement within this outline, but specifics of each file/module are intentionally left open.

- `packages/analyzer/`
  - Node/TypeScript library.
  - Responsibilities:
    - Load memory map configuration.
    - Parse ELF (and, if needed, MAP).
    - Build `Analysis` model (regions, sections, symbols, summaries).
    - Provide programmatic API for other packages.
    - Optionally provide JSON export helpers.

- `packages/cli/`
  - Thin CLI wrapper around `analyzer`.
  - Example capabilities:
    - Print region summaries.
    - Dump full analysis to JSON.
    - Query for largest symbols in a given region/section.
  - Intended for:
    - Local developer use.
    - CI integration.

- `packages/ui/` (or `apps/ui/`)
  - React-based frontend (web or Electron/Tauri shell).
  - Responsibilities:
    - Load or receive an `Analysis` result.
    - Provide visual exploration:
      - Region usage bars.
      - Tables and trees for sections/symbols.
      - Treemap or other visualizations (eventually).
    - Invoke backend/CLI or libraries as appropriate.

- `config/`
  - Memory map configs per target, e.g.:
    - `teensy41.json`
    - Potential other MCU configs later.

- `docs/`
  - Additional design notes, usage guides, examples.
  - This `README` can be expanded/mirrored here.

**Dev Workflow (Intended):**

1. Developer builds firmware (e.g. via PlatformIO/Teensy).
2. Developer runs CLI:
   - `teensy-mem-explorer analyze path/to/firmware.elf --target teensy41`
3. CLI:
   - Uses `analyzer` to parse ELF/MAP and memory map config.
   - Outputs summary to console and/or writes JSON.
4. UI:
   - Loads the generated analysis (directly via library or via JSON).
   - Presents interactive visualization and search.

The implementation agent should:

- Start with the `analyzer` package and memory map config.
- Ensure the `Analysis` model is complete and coherent.
- Expose stable APIs that frontends and tools can rely on.
- Defer advanced features (diffing, padding analysis, runtime overlay) until the core is solid.

---
