## Strict build guard checklist (prevent Vercel-only TS failures)

This repo can “look green” locally/CI if you only run unit tests, but still fail on Vercel because `next build` runs a stricter TypeScript + Next.js compile pipeline.

Use this checklist whenever you:
- Touch types used by Next.js routes/pages/components
- Add/modify union types (status enums, variants, etc.)
- Add loaders and pipe their results into React components

### Required commands

Run these from repo root:
- `npm ci`
- `npx tsc --noEmit`
- `npm run build`

`npm run build` is non-negotiable for PR readiness.

### Guardrail 1: Never leave “empty arrays” untyped if they’ll be replaced later

If you initialize an array as `[]` and later assign it from an awaited loader result, TypeScript can infer `never[]` (or otherwise over-narrow types) in ways that only surface under `next build`.

Do this:
- Prefer declaring with a type:
  - `let rows: AdminOpsInboxRow[] = [];`
  - `const items: Array<Item> = [];`
- Or type the initializer:
  - `const rows = [] as AdminOpsInboxRow[];`

Avoid this when the variable is later assigned:
- `let rows = []; // fragile (can become never[])`

### Guardrail 2: Union changes must update every map/record indexed by that union

When you add a new union member (for example a new destination status), you must update:
- Any `Record<ThatUnion, ...>` maps (labels, colors, ordering, grouping, etc.)
- Any switch statements intended to be exhaustive
- Any “status count” buckets displayed in UI

Prefer making the compiler enforce exhaustiveness:
- Use `satisfies Record<Union, T>` for maps so missing keys are a type error.
- For “optional” maps, consider whether they should be `Partial<Record<Union, ...>>` or truly exhaustive.

### Guardrail 3: Proactive grep for status maps

Before you push, search for places that must be updated when statuses change:
- `Record<DestinationStatus,`
- `DestinationStatusCounts`
- `statusCounts` / `status-count` buckets
- Any `Record<...Status, ...>` where the union is used as an index

If a map is meant to cover *all* union values, use:
- `... satisfies Record<Union, ValueType>`

### Guardrail 4: Treat `npm run build` as the source of truth

If `npm run build` fails in CI/Vercel, fix the TypeScript errors even if:
- `npm test` passes
- `npx tsc --noEmit` passes locally

`next build` can typecheck route/page boundaries differently and can surface inference issues that don’t appear elsewhere.
