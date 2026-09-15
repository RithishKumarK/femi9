import './ProductMarquee.css'

/**
 * The strip under the hero: a lane of product highlights drifting left to
 * right, then a band of short lines about the pads drifting right to left.
 * Every claim here is one the page already makes (hero badges, the Why Femi9
 * benefits) — keep it that way when editing.
 */

type IconName = 'cloud' | 'shield' | 'air' | 'cotton' | 'sprout'

const HIGHLIGHTS: { label: string; icon: IconName }[] = [
  { label: 'Cotton-Soft Comfort', icon: 'cloud' },
  { label: 'Leak Protection', icon: 'shield' },
  { label: 'Breathable Design', icon: 'air' },
  { label: 'Certified Organic Cotton', icon: 'cotton' },
  { label: 'Biodegradable', icon: 'sprout' },
]

/** Five short labels are narrower than a wide screen, so each run lays them down twice. */
const HIGHLIGHT_REPEATS = 2

const PHRASES = [
  'Soft on skin, all day long',
  'Protection for heavier flow days',
  'Breathable, airy layers',
  'Certified organic cotton',
  'Freshness & odour control',
  'Made for everyday movement',
  'Rash-conscious comfort',
]

function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {name === 'cloud' && (
        <path d="M7 18h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.2 9.2 4.4 4.4 0 0 0 7 18Z" />
      )}
      {name === 'shield' && <path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6l7-3Z" />}
      {name === 'air' && (
        <>
          <path d="M3 8h11a3 3 0 1 0-3-3" />
          <path d="M3 12h16a3 3 0 1 1-3 3" />
          <path d="M3 16h8" />
        </>
      )}
      {name === 'cotton' && (
        <>
          <circle cx="9" cy="10" r="3.2" />
          <circle cx="15" cy="10" r="3.2" />
          <circle cx="12" cy="14.6" r="3.2" />
          <path d="M12 17.8V21" />
        </>
      )}
      {name === 'sprout' && (
        <>
          <path d="M12 21v-9" />
          <path d="M12 12c0-4-3-6.5-7-6.5 0 4 3 6.5 7 6.5Z" />
          <path d="M12 14.5c0-3.2 2.5-5.5 6.5-5.5 0 3.5-2.5 5.5-6.5 5.5Z" />
        </>
      )}
    </svg>
  )
}

export function ProductMarquee() {
  const highlightLoop = Array.from({ length: HIGHLIGHT_REPEATS }, () => HIGHLIGHTS).flat()

  return (
    <section className="fl-marquee" aria-label="Femi9 pad highlights">
      {/* Each lane holds two identical runs side by side and slides by exactly
          one run before looping, so the seam never shows. Only the first copy
          of anything is exposed to screen readers. */}
      <div className="fl-marquee__strip">
        <div className="fl-marquee__lane">
          <div className="fl-marquee__track fl-marquee__track--rightward">
            {[0, 1].map((copy) => (
              <ul key={copy} className="fl-marquee__highlights" aria-hidden={copy === 1 || undefined}>
                {highlightLoop.map((item, i) => (
                  <li key={`${item.label}-${i}`} aria-hidden={i >= HIGHLIGHTS.length || undefined}>
                    <Icon name={item.icon} />
                    {item.label}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </div>

      <div className="fl-marquee__band">
        <div className="fl-marquee__lane">
          <div className="fl-marquee__track">
            {[0, 1].map((copy) => (
              <ul key={copy} className="fl-marquee__phrases" aria-hidden={copy === 1 || undefined}>
                {PHRASES.map((phrase) => (
                  <li key={phrase}>{phrase}</li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
