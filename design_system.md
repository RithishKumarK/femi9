# Femi9 Design System

Welcome to the **Femi9 Design System** (Lavender Edition). This document defines the visual foundation, core design tokens, typography scale, color palette, component specifications, motion guidelines, and layout patterns across the Femi9 platform.

---

## 1. Brand Philosophy & Aesthetic Identity

Femi9 combines organic period care with medical-grade trust and modern, elevated aesthetics.

- **Primary Vibe:** Soft lavender surfaces, deep plum background depth, and vibrant golden-yellow primary actions.
- **Core Principles:**
  - **Tactile Warmth:** Surfaces sit slightly off-white (`#FDFCFA` / `#FBF9FF`), avoiding harsh `#FFFFFF` backgrounds where possible.
  - **Locked Primary Action:** Every primary Call-To-Action (CTA) uses the signature Femi9 Golden Yellow (`#F0C14E`), creating an unmistakable visual hierarchy.
  - **Subtle Elevation:** Soft, warm shadows (`0 8px 24px rgba(61,44,92,0.06)`) and pill-shaped interactive controls.
  - **Dynamic Micro-Interactions:** Fast, snappy spring easing (`cubic-bezier(.16, 1, .3, 1)`) with strict accessibility fallbacks for reduced motion.

---

## 2. Color Palette & Token System

### 2.1 CSS Variables (`base.css` & `app.css`)

```css
:root {
  /* Surfaces (Soft Lavender & Warm Off-White) */
  --cream:        #FBF9FF;   /* App body background */
  --cream-2:      #F2ECFB;   /* Secondary container background */
  --surface:      #FDFCFA;   /* Card / Panel surface (elevated warm white) */
  --butter:       #FBEFC8;   /* Highlight badge background */
  --butter-soft:  #FCF6E1;   /* Soft input/icon tint */
  --sage-tint:    #EDE7F9;   /* Repurposed -> Soft lavender tint */
  --lilac-tint:   #F2ECF9;   /* Subdued section tint */

  /* Primary Accent (Locked CTA Color) */
  --yellow:       #F0C14E;   /* Signature primary CTA background */
  --yellow-deep:  #D8A22F;   /* Primary CTA hover & active state */

  /* Supporting Brand Colors */
  --sage:         #B79BD8;   /* Soft lavender-purple */
  --lilac:        #C9AEE4;   /* Light lilac accent */
  --forest:       #3A2158;   /* Deep plum (Sidebar, dark panels, buttons) */
  --forest-2:     #563184;   /* Secondary deep plum accent */
  --fl-purple:    #4A4286;   /* Landing section background */
  --fl-deep:      #272355;   /* Dark hero container */

  /* Typography & Ink Tokens */
  --navy:         #34204E;   /* Primary headings, heavy text */
  --ink:          #4B3E63;   /* Default body text color */
  --muted:        #877D9E;   /* Subtitles, secondary text, metadata */
  --line:         rgba(52,32,78,.13);  /* Divider lines */
  --line-soft:    rgba(52,32,78,.07);  /* Subtle borders */

  /* Shape & Shadow Scale */
  --r-card:       16px;
  --r-img:        16px;
  --panel-r:      16px;
  --tile-r:       18px;
  --r-chip:       999px;

  --shadow-sm:    0 8px 24px rgba(61,44,92,0.06);
  --shadow:       0 8px 24px rgba(61,44,92,0.06);
  --shadow-yel:   0 20px 44px -20px rgba(216,162,47,.5);

  --maxw:         1200px;
  --ease:         cubic-bezier(.16,1,.3,1);
}
```

### 2.2 Functional & Status Badges

| Status | Background | Text Color | Usage Context |
| :--- | :--- | :--- | :--- |
| **Available / Active** | `#EFEBFF` | `#5B3FDA` | Active subscriptions, available rewards |
| **Success / Claimed** | `#E1F0E7` | `#3D8B5C` | Completed orders, claimed offers, upward metrics |
| **Warning / Expired** | `#FBF0DA` | `#B8863A` | Expiring points, pending verification |
| **Danger / Cancelled** | `#F5EBEB` | `#A54646` | Cancelled subscriptions, downward metrics |

---

## 3. Typography Scale & Fonts

Femi9 uses a deliberate typography pairing: **Urbanist** for primary web interfaces, **Instrument Sans** for landing headlines, and **Fraunces** for editorial/serif dashboard highlights.

### 3.1 Font Families
- **Primary Interface:** `"Urbanist"`, `system-ui`, `-apple-system`, `sans-serif`
- **Display Headlines:** `"Instrument Sans"`, `sans-serif`
- **Editorial Accent:** `"Fraunces"`, `Georgia`, `serif`
- **Body Alternative:** `"Inter"`, `sans-serif`
- **Monospace:** `ui-monospace`, `"SF Mono"`, `Menlo`, `monospace` (Codes, URLs, metrics)

### 3.2 Type Hierarchy Table

| Element | Class / Spec | Size | Weight | Line Height | Letter Spacing |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Hero Display 1** | `.fl-hero h1` | `58px` – `62px` (Mobile `42px`) | 600 | 1.06 | `-0.01em` |
| **Section Title** | `h2`, `.fl-heading h2` | `44px` – `48px` (Mobile `33px`–`38px`) | 500 / 600 | 1.12 | `-0.02em` |
| **Card / Subsection** | `h3`, `.panel-head h3` | `20px` – `25px` | 500 / 600 | 1.15 - 1.25 | `-0.01em` |
| **Eyebrow / Kicker** | `.eyebrow`, `.fl-kicker` | `0.72rem` (`12px` - `14px`) | 500 / 600 | 1.0 | `.18em` Uppercase |
| **Body Lead** | `.cyc-lead`, `.fl-hero p` | `18px` – `20px` | 300 / 400 | 1.4 - 1.65 | Normal |
| **Body Default** | `body`, `p` | `clamp(15px, 1.05vw, 17px)` | 400 | 1.55 | Normal |
| **Caption / Hint** | `.hint`, `.sub` | `12px` – `14px` | 400 | 1.4 | Normal |

---

## 4. Components & Pattern Library

### 4.1 Buttons (`.btn` & `.fl-btn`)

Buttons use full pill rounded corners (`border-radius: 999px` or `35px`).

- **Primary Button (`.btn-primary`, `.fl-btn--gold`)**
  - Background: `var(--yellow)` (`#F0C14E`)
  - Color: `var(--navy)` (`#34204E`)
  - Hover: Background `var(--yellow-deep)` (`#D8A22F`), `transform: translateY(-2px)`
  - Shadow: `0 20px 44px -20px rgba(216,162,47,.5)`

- **Dark Plum Button (`.btn-dark`)**
  - Background: `var(--forest)` (`#3A2158`)
  - Color: `#FFF9EA`
  - Hover: Background `#2A1746`, `transform: translateY(-2px)`

- **Ghost / Outline Button (`.btn-ghost`, `.fl-btn--outline`)**
  - Background: `transparent`
  - Border: `1.5px solid var(--line)`
  - Color: `var(--navy)`

- **Contextual Variants:** `.btn-on-forest`, `.btn-on-yellow` for inverted background sections.

```html
<button class="btn btn-primary">
  <span>Shop Organic Care</span>
  <svg>...</svg>
</button>
```

---

### 4.2 Eyebrow Accent (`.eyebrow`)

Eyebrows establish context at the top of sections, featuring a small preceding golden bar (`22px` wide, `2px` high).

```css
.eyebrow {
  display: inline-flex; align-items: center; gap: .5em;
  font-size: .72rem; font-weight: 500; letter-spacing: .18em; text-transform: uppercase;
  color: var(--forest-2);
}
.eyebrow::before {
  content: ""; width: 22px; height: 2px; background: var(--yellow); border-radius: 2px;
}
```

---

### 4.3 Dashboard Panels & Stat Tiles (`.panel`, `.stat-tile`)

Panels organize user data, cycle tracking tools, and store controls into clean rounded containers.

- **Panel (`.panel`):** Background `var(--surface)`, border `1px solid var(--line-soft)`, radius `var(--panel-r)` (`16px`/`20px`), padding `clamp(16px, 2vw, 22px)`.
- **Stat Tile (`.stat-tile`):** Surface tile with icon box (`var(--butter-soft)` background), tabular bold value display, and trend delta indicators (`.delta.up` green, `.delta.down` red).
- **Segmented Control (`.seg`):** Pill-shaped toggle container in `--cream-2` with active state background on `--surface` elevated by `--shadow-sm`.

---

### 4.4 Cycle Tracker Component (`.cyc-panel`, `.cyc-card`)

Interactive period cycle calculator & logger.

- **Background Container:** Soft lavender glow with subtle vector overlays.
- **Controls:** Custom date pickers (`.cyc-date`), round step increment buttons (`.cyc-step-btn` with `#E3DCFF` background), and single-click submit actions.
- **Glassmorphism Touch:** Card uses `background: #ffffffcf` with `backdrop-filter: blur(8px)`.

---

### 4.5 Bento Grids & Feature Cards (`.fl-why__grid`, `.fl-benefit`)

Multi-column layouts with rounded benefit cards (`border-radius: 24px`) displaying custom organic illustrations and soft gradient backgrounds (`#14121d33`).

---

## 5. Layout Grid & Responsive Breakpoints

### 5.1 Container Widths & Padding
- **Default Shell (`.wrap`):** Max width `1200px`, padding `clamp(18px, 4vw, 40px)`.
- **Wide Landing Shell (`.fl-shell`):** Max width `1512px`, padding-inline `80px` (desktop), `48px` (tablet), `28px` (mobile).
- **Dashboard Grid (`.dash-grid`):** 12-column CSS Grid (`grid-template-columns: repeat(12, 1fr)`).

### 5.2 Breakpoints

| Breakpoint Name | Media Query | Layout Adjustments |
| :--- | :--- | :--- |
| **Desktop Large** | `> 1180px` | Full multi-column bento grids, sticky sidebars, side-by-side hero layouts. |
| **Desktop / Tablet** | `900px - 1180px` | Scaled hero copy (58% width), 3-column footer grid, compressed side margins. |
| **Tablet Small** | `620px - 900px` | 2-column benefit grid, mobile navigation overlay menu (`.fl-nav__mobile`), stacked hero. |
| **Mobile Small** | `< 620px` | 1-column layout, compact headers (`42px` title), horizontal touch-scroll card carousels. |

---

## 6. Motion & Animation Standards

### 6.1 Easing & Transitions
- **Standard Easing:** `cubic-bezier(.16, 1, .3, 1)` (spring-like snappy finish).
- **Standard Transition Durations:** `.25s` for hover states, `.6s`–`.8s` for scroll reveals, `1.2s` for complex hero reveals.

### 6.2 Reveal on Scroll (`.reveal`)

```css
.reveal {
  opacity: 0;
  transform: translateY(28px);
  transition: opacity .8s var(--ease), transform .8s var(--ease);
}
.reveal.in { opacity: 1; transform: none; }

/* Stagger Delays */
.reveal.d1 { transition-delay: .08s; }
.reveal.d2 { transition-delay: .16s; }
.reveal.d3 { transition-delay: .24s; }
.reveal.d4 { transition-delay: .32s; }
```

### 6.3 Accessibility & Reduced Motion

All micro-animations strictly respect `prefers-reduced-motion: reduce`:

```css
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .reveal { opacity: 1; transform: none; transition: none; }
  * { animation: none !important; }
}
```

---

## 7. File Structure Reference

Key files defining the design system in `femi9-next`:

- [`src/styles/base.css`](file:///c:/Users/mohan/Downloads/femi9/femi9-next/src/styles/base.css) - Global CSS variables, typography reset, `.btn` styles, `.reveal` animations.
- [`src/styles/app.css`](file:///c:/Users/mohan/Downloads/femi9/femi9-next/src/styles/app.css) - App shell, sidebar, topbar, dashboard 12-column grid, stat tiles, segmented controls.
- [`src/styles/figma-landing.css`](file:///c:/Users/mohan/Downloads/femi9/femi9-next/src/styles/figma-landing.css) - Landing page components, hero scenes, bento grids, founder cards, testimonials track.
- [`src/styles/thara.css`](file:///c:/Users/mohan/Downloads/femi9/femi9-next/src/styles/thara.css) - Customer portal styling, serif headers (`Fraunces`), tables, credit/debit badge pills.
- [`src/components/AppIcons.tsx`](file:///c:/Users/mohan/Downloads/femi9/femi9-next/src/components/AppIcons.tsx) & [`src/components/Icons.tsx`](file:///c:/Users/mohan/Downloads/femi9/femi9-next/src/components/Icons.tsx) - Standardized SVG icon set.
