/**
 * Key Benefits content packs — the six-point infographic that wraps the product
 * shot on the PDP.
 *
 * The copy is NOT invented here: it is the "Femi9 Product Benefit Content Packs"
 * section of PRODUCT_BENEFITS_PROMPTS.md, transcribed verbatim and keyed by the
 * same product ids the catalog uses (`src/data/products.ts`). That document was
 * already written to a fixed shape — three benefits down the left, three down
 * the right, a centrepiece pack shot between them — which is exactly the layout
 * the section renders, so keeping the two in sync is a copy edit, not a port.
 *
 * Why a module and not the database: `ProductFeature` rows are free-form
 * title/body pairs the admin console can publish in any number. This section
 * only reads well at exactly six (three per side, mirrored), and every entry
 * needs an icon pair the console has no field for. `KeyBenefits` therefore
 * prefers this pack and falls back to the DB features when a product has no
 * pack — see `resolveBenefits` there.
 */

/** Icon keys resolved by `BenefitIcons.tsx`. Each benefit renders a PAIR. */
export type BenefitIconKey =
  | 'length'
  | 'wings'
  | 'anion'
  | 'cotton'
  | 'layers'
  | 'toxinFree'
  | 'coverage'
  | 'freshness'
  | 'channels'
  | 'soft'
  | 'airflow'
  | 'shield'
  | 'moon'
  | 'trial'
  | 'seal'
  | 'pouch'
  | 'rashFree'
  | 'absorb'
  | 'wash'
  | 'weave'
  | 'degrees360'
  | 'odour'
  | 'feather'
  | 'sparkle'
  | 'adhesive'

export interface ProductBenefit {
  title: string
  body: string
  /** Two overlapping circular badges, mirroring the reference layout. */
  icons: [BenefitIconKey, BenefitIconKey]
}

export interface BenefitPack {
  /** Left column, top to bottom. */
  left: ProductBenefit[]
  /** Right column, top to bottom. */
  right: ProductBenefit[]
}

export const PRODUCT_BENEFITS: Record<string, BenefitPack> = {
  // ── 330mm Double Wings · heavy flow overnight ──────────────────────────────
  p330dw: {
    left: [
      {
        title: '330mm Extra Length',
        body: 'Extended rear coverage locks in heavy flow overnight.',
        icons: ['length', 'shield'],
      },
      {
        title: 'Double Wing Security',
        body: 'Dual side wings anchor firmly to eliminate side shifting.',
        icons: ['wings', 'adhesive'],
      },
      {
        title: 'Anion Comfort Strip',
        body: 'Plant-based active anion strip neutralizes odor and calms cramps.',
        icons: ['anion', 'freshness'],
      },
    ],
    right: [
      {
        title: '100% Organic Cotton',
        body: 'Breathable top sheet keeps skin rash-free and comfortably dry.',
        icons: ['cotton', 'soft'],
      },
      {
        title: '9-Layer Leak-Lock Core',
        body: 'Ultra-absorbent core locks in heavy flow instantly without wetness.',
        icons: ['layers', 'absorb'],
      },
      {
        title: 'Zero Toxin Assurance',
        body: 'Free from chlorine bleach, synthetic dyes, and artificial fragrances.',
        icons: ['toxinFree', 'seal'],
      },
    ],
  },

  // ── 290mm Large · regular flow everyday ────────────────────────────────────
  p290l9: {
    left: [
      {
        title: '290mm Large Coverage',
        body: 'Thoughtfully sized for active regular-flow days and movement.',
        icons: ['coverage', 'length'],
      },
      {
        title: 'Anion Freshness Chip',
        body: 'Embedded anion chip maintains intimate hygiene and freshness.',
        icons: ['anion', 'sparkle'],
      },
      {
        title: 'Multi-Layer Core',
        body: 'High-capacity fluid channels draw wetness deep inside quickly.',
        icons: ['channels', 'absorb'],
      },
    ],
    right: [
      {
        title: 'Soft Cottony Feel',
        body: 'Gentle rash-conscious top sheet prevents friction and chafing.',
        icons: ['soft', 'cotton'],
      },
      {
        title: 'Continuous Airflow',
        body: 'Micro-perforated layers promote continuous ventilation all day long.',
        icons: ['airflow', 'freshness'],
      },
      {
        title: 'Secure Standard Wings',
        body: 'Flexible side wings lock pad snugly in place during daily activity.',
        icons: ['wings', 'adhesive'],
      },
    ],
  },

  // ── 330mm Centre Wings · heavy flow night, wide back ───────────────────────
  p330cw: {
    left: [
      {
        title: 'Extra Wide Back Panel',
        body: 'Fan-shaped rear design provides maximum sleep leak protection.',
        icons: ['coverage', 'shield'],
      },
      {
        title: 'Central Wing Anchor',
        body: 'Centrally placed wings deliver balanced tension and zero bunching.',
        icons: ['wings', 'adhesive'],
      },
      {
        title: 'Anion Anti-Odor Tech',
        body: 'Natural active anion strip neutralizes menstrual odors naturally.',
        icons: ['anion', 'odour'],
      },
    ],
    right: [
      {
        title: 'Rash-Conscious Layer',
        body: 'Unbleached organic cotton top sheet protects sensitive intimate skin.',
        icons: ['cotton', 'rashFree'],
      },
      {
        title: 'Heavy Night Capacity',
        body: 'Deep absorbing channels hold high volume flow through long nights.',
        icons: ['moon', 'absorb'],
      },
      {
        title: 'Chemical & Bleach Free',
        body: 'Crafted without chlorine, synthetic scents, or harsh chemicals.',
        icons: ['toxinFree', 'seal'],
      },
    ],
  },

  // ── 290mm Starter · 3-pad trial ────────────────────────────────────────────
  p290l3: {
    left: [
      {
        title: '3-Pad Trial Pack',
        body: 'Low-commitment starter pack to experience Femi9 organic care.',
        icons: ['trial', 'pouch'],
      },
      {
        title: 'Full Premium Quality',
        body: 'Same 100% organic cotton top sheet as full-size packs.',
        icons: ['seal', 'cotton'],
      },
      {
        title: 'Anion Energy Strip',
        body: 'Built-in anion chip eases period discomfort and maintains hygiene.',
        icons: ['anion', 'sparkle'],
      },
    ],
    right: [
      {
        title: 'Travel & Bag Friendly',
        body: 'Compact 3-pad pouch fits discreetly into purses, totes, or school bags.',
        icons: ['pouch', 'trial'],
      },
      {
        title: 'Rash-Free Guarantee',
        body: 'Breathable toxin-free layers ensure complete freedom from itching.',
        icons: ['rashFree', 'shield'],
      },
      {
        title: 'Instant Leak-Guard',
        body: 'High-density absorbent core locks fluid instantly for confidence.',
        icons: ['absorb', 'layers'],
      },
    ],
  },

  // ── Reusable organic cotton period panties ─────────────────────────────────
  ppanty: {
    left: [
      {
        title: '4-Layer Leak-Proof Core',
        body: 'Quad-layer protection holds up to 2 full pads without bulk.',
        icons: ['layers', 'absorb'],
      },
      {
        title: '40+ Wash Longevity',
        body: 'Durable eco-friendly fabric designed for over 40 cold washes.',
        icons: ['wash', 'seal'],
      },
      {
        title: 'Organic Cotton Fabric',
        body: 'Ultra-soft breathable organic cotton feels just like daily underwear.',
        icons: ['weave', 'cotton'],
      },
    ],
    right: [
      {
        title: '360° Leak-Proof Shield',
        body: 'Extended front-to-back leak barrier protects during sleep & sports.',
        icons: ['degrees360', 'shield'],
      },
      {
        title: 'Odor & Bacteria Guard',
        body: 'Moisture-wicking lining inhibits microbial growth and eliminates odor.',
        icons: ['odour', 'freshness'],
      },
      {
        title: 'Easy Care Routine',
        body: 'Simple cold water rinse and machine wash formula for easy reuse.',
        icons: ['wash', 'airflow'],
      },
    ],
  },

  // ── 180mm Mini panty liners ────────────────────────────────────────────────
  p180m9: {
    left: [
      {
        title: 'Ultra-Thin Comfort',
        body: 'Feather-light 1mm profile for an invisible, weightless feel.',
        icons: ['feather', 'soft'],
      },
      {
        title: 'All-Day Freshness',
        body: 'Absorbs daily discharge and keeps intimate area fresh all day.',
        icons: ['sparkle', 'freshness'],
      },
      {
        title: 'Breathable Backsheet',
        body: 'Micro-porous backing lets skin breathe to prevent moisture trap.',
        icons: ['airflow', 'coverage'],
      },
    ],
    right: [
      {
        title: 'Organic Cotton Touch',
        body: 'Ultra-soft hypoallergenic surface safe for daily sensitive skin.',
        icons: ['cotton', 'rashFree'],
      },
      {
        title: 'Natural Odor Control',
        body: 'Plant-based strip neutralizes subtle odors without chemicals.',
        icons: ['odour', 'toxinFree'],
      },
      {
        title: 'Stays Firmly in Place',
        body: 'Full-length adhesive strip keeps liner flat with zero bunching.',
        icons: ['adhesive', 'seal'],
      },
    ],
  },
}

/**
 * Icon pairs handed to DB-authored features, which carry no icon field. Cycled
 * positionally so a product without a pack still gets a varied, non-repeating
 * badge sequence rather than the same emblem six times.
 */
const FALLBACK_ICON_PAIRS: [BenefitIconKey, BenefitIconKey][] = [
  ['cotton', 'soft'],
  ['absorb', 'layers'],
  ['anion', 'freshness'],
  ['airflow', 'coverage'],
  ['shield', 'rashFree'],
  ['toxinFree', 'seal'],
]

/**
 * The benefit pack for a product, or one synthesised from its DB features.
 *
 * Returns null when neither source has anything to show, so the caller can drop
 * the whole section instead of rendering an empty frame around a lone photo.
 */
export function resolveBenefits(
  productId: string,
  features: { title: string; body: string }[],
): BenefitPack | null {
  const pack = PRODUCT_BENEFITS[productId]
  if (pack) return pack

  if (!features.length) return null

  // Split the console's features down the middle so the two columns stay
  // balanced; an odd count leaves the extra entry on the left, which reads
  // better than a right column that starts lower than its neighbour.
  const withIcons: ProductBenefit[] = features.slice(0, 6).map((f, i) => ({
    title: f.title,
    body: f.body,
    icons: FALLBACK_ICON_PAIRS[i % FALLBACK_ICON_PAIRS.length],
  }))
  const half = Math.ceil(withIcons.length / 2)
  return { left: withIcons.slice(0, half), right: withIcons.slice(half) }
}
