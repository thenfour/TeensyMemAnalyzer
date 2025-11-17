# Treemap components

The treemap cards share a single presentation component, `TreemapCardBase`, plus a set of small configuration modules that adapt the base to each data domain.

## Adding a new treemap card

1. Create a `TreemapCardConfig` implementation that maps your data domain to the base component expectations (`treemap/memoryTreemapConfig.tsx` and `treemap/scopeTreemapConfig.tsx` are good references).
2. Export a thin wrapper component that passes the shared props (`analysis`, `lastRunCompletedAt`, and optional filters) along with your config to `TreemapCardBase`.
3. Keep any domain-specific helpers inside the config file so the wrapper stays trivial and easy to understand.

This setup keeps layout/interaction logic centralized while allowing each treemap to customize color, detail rows, and empty-state copy on a per-domain basis.