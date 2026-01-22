# Pricing converter utilities

This folder contains one-off scripts for normalizing pricing exports used to feed algorithm work.

## `convertPricingNumbersToCsv.ts`

Converts a “Pricing for algo” export file (placed under `/data/`) into a clean CSV with **exact headers**:

`amount, technology, material_raw, material_canon, parts_count, margin_amount, margin_percent`

### Input assumptions

- The input file has a **single header row** followed by data rows.
- The input can be:
  - CSV (`,` delimited)
  - TSV (tab delimited)
  - A “copy/paste table” where columns are separated by **2+ spaces**
- **`parts_count` means number of parts**, not “quantity ordered” or “qty per part”.

### Normalization rules (as requested)

- **`material_canon`**: trimmed, take only the text before the first `|` (if present), collapse internal whitespace to single spaces.
- **`technology`**: trimmed + internal whitespace collapsed; optional synonym mapping lives in `TECHNOLOGY_SYNONYMS` in the script.
- **`margin_percent`**: derived as `margin_amount / amount` when both exist and `amount > 0` (otherwise left blank).
- Rows are preserved even if **`parts_count` is missing**.

### Usage

Put your source file at `data/pricing_for_algo.txt` (or any other path) and run:

```bash
npx tsx scripts/pricing/convertPricingNumbersToCsv.ts \
  --in data/pricing_for_algo.txt \
  --out data/pricing_for_algo.cleaned.csv
```

If auto-detection gets the delimiter wrong, force it:

```bash
npx tsx scripts/pricing/convertPricingNumbersToCsv.ts --delimiter tsv --in data/input.tsv --out data/out.csv
```

If the script can’t detect columns reliably (header names differ), override them:

```bash
npx tsx scripts/pricing/convertPricingNumbersToCsv.ts \
  --amountColumn "Amount" \
  --technologyColumn "Technologies" \
  --materialsColumn "Materials" \
  --partsCountColumn "Parts count" \
  --marginAmountColumn "Margin amount" \
  --in data/pricing_for_algo.txt \
  --out data/pricing_for_algo.cleaned.csv
```

## `buildPricingPriors.ts`

Builds compact pricing priors (p10/p50/p90) from the canonical CSV output of `convertPricingNumbersToCsv.ts`.

### Output

- Writes a deterministic JSON artifact to `/tmp/pricing_priors.json` by default.
- Optionally upserts into Supabase `public.pricing_priors` when service-role env vars exist.

### Usage

```bash
npx tsx scripts/pricing/buildPricingPriors.ts \
  --in data/pricing_for_algo.cleaned.csv \
  --out /tmp/pricing_priors.json
```

To force/disable upsert:

```bash
npx tsx scripts/pricing/buildPricingPriors.ts --upsert
npx tsx scripts/pricing/buildPricingPriors.ts --noUpsert
```

Supabase env vars (service role):

- `NEXT_PUBLIC_SUPABASE_URL` (preferred) or `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
