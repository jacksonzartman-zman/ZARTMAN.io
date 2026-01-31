## Portal Visual Spec (A23)

Goal: make all portals feel like one product — **premium, calm, subtle**, with “fun but not childish” moments that make progress feel earned.

### Surfaces (cards/panels)
- **Base surface**: deep slate, slightly translucent; avoid pure black blocks.
- **Card**: `rounded-2xl`, thin border, soft shadow, no heavy glow.
- **Header/hero**: same material as cards, slightly more present (larger radius + deeper shadow), never louder color.

**Rules**
- **Borders**: quiet contrast (e.g. `border-slate-800/60`); on hover, brighten slightly (not white).
- **Shadows**: one-directional, soft; avoid neon or strong ambient bloom.
- **Background**: subtle lift on hover; keep readability high.

### Typography scale (portals)
- **Portal title (H1)**: `text-3xl sm:text-4xl`, `font-semibold`, tight leading.
- **Section title (H2)**: `text-base sm:text-lg`, `font-semibold`.
- **Row title / primary label**: `text-sm`, `font-semibold` (or medium when dense).
- **Meta / helper text**: `text-sm` in slate-400/500 range; never below `text-xs` unless purely decorative.

**Rules**
- Prefer **fewer weights** (regular + semibold). Avoid extra-bold.
- Use subdued color for secondary text; reserve pure white for top-level emphasis only.

### Spacing rhythm
- **Page padding**: container `px-4 sm:px-6 lg:px-8`, vertical `py-8 sm:py-10`.
- **Between major sections**: `space-y-8 sm:space-y-10`.
- **Between cards/blocks**: `space-y-7 sm:space-y-8`.
- **Card padding**: `p-6` (header may use `p-6 sm:p-7`).

**Rules**
- Keep a consistent vertical rhythm; don’t mix many different gap sizes on one page.
- Use whitespace to communicate hierarchy before adding new borders/dividers.

### Interaction (premium, calm, subtle)
- **Hover**: slightly lift border contrast + background; optional small shadow increase.
- **Active/pressed**: reduce shadow slightly; keep border stable (avoid “flash”).
- **Focus**: always visible but soft:
  - cards/panels: `focus-within` ring/border (quiet, non-glowy)
  - controls/links: `focus-visible:outline-*` (never harsh)
- **Motion**: keep transitions short and quiet; always respect reduced motion (`motion-reduce:*`).

### “Fun but not childish”
- No confetti, emojis, or “party” effects.
- Use **micro-affirmations** that feel earned:
  - “Saved”, “Up to date”, “All set”, “Ready to submit”, “Nice — one step closer”
- Celebrate progress through **clarity**:
  - show completion states, subtle checkmarks/icons, and stable layout (no jumpy animations).

### Implementation note (repo-local tokens)
- Prefer token-like Tailwind composition as shared class strings for **surfaces** and **rhythm**.
- Keep tokens small (2–3 for surfaces) and apply consistently across `PortalShell` + `PortalCard`.
