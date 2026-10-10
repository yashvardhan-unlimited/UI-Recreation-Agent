# Preset: Dark technical

## Theme
A precise instrument panel: dark, quiet and exact. Information density is a feature; every number and label is real and aligned.

## Color
- bg #0d0f12, fg #e7e9ec, muted #9aa1ab, surface #161a1f, line #262c33.
- accent #f2b33d (signal amber), for the primary action, live values and focus rings only.
- No glow, no neon gradients, no glass. Contrast comes from type weight and spacing.

## Typography
- Display: a geometric or grotesque sans (e.g. Space Grotesk, Inter Tight). Body: a neutral sans (e.g. Inter) with a monospace for data (e.g. JetBrains Mono).
- Headings medium weight, text-4xl/md:text-6xl, tracking-tight.
- Labels uppercase, text-xs, tracking-widest, muted. Numbers tabular.

## Components
- Spec tables with hairline borders (border-line) instead of feature cards.
- Code or command snippets in surface blocks with a copy button.
- Status rows: label left, value right, aligned on a baseline grid.
- Buttons: solid accent with dark text; secondary is an outline in line color.

## Layout
- Dense 12-column grid, max-w-6xl, left-aligned.
- Section headers sit in a narrow left column with content to the right on desktop; stacked on mobile.
- Tight vertical rhythm: py-16 to py-20.

## Motion
- Lively but restrained: Stagger for table rows, Counter for one key metric, Marquee for a changelog strip.

## Do / Don't
- Do show real structure: tables, diagrams, sequences.
- Don't fake dashboards, invent statistics or decorate with grid backgrounds.
