'use client'

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link } from '@/lib/router-compat'
import { OptImg } from '@/components/OptImg'
import '../styles/about-founders.css'

const ASSET = '/assets/figma-home/'

function Flower({ light = false }: { light?: boolean }) {
  return (
    <span className={`fl-flower${light ? ' fl-flower--light' : ''}`} aria-hidden="true">
      <img src={`${ASSET}about-imgGroup.svg`} alt="" width={16} height={16} loading="lazy" decoding="async" />
    </span>
  )
}

function Reveal({
  children,
  className,
  id,
}: {
  children: ReactNode
  className: string
  id?: string
}) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      setVisible(true)
      return
    }

    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [id])

  return (
    <section
      ref={ref}
      className={className}
      id={id}
      data-visible={visible ? 'true' : undefined}
      onMouseEnter={() => setVisible(true)}
      onFocusCapture={() => setVisible(true)}
    >
      {children}
    </section>
  )
}

/**
 * `card` picks the card's place in the stage (about-founders.css): the founder
 * in the middle on a dark plate, the two co-founders overlapping her from
 * either side.
 */
const FOUNDERS = [
  { base: 'figma-home/about-founder', label: 'FOUNDERS', card: 'founder', name: 'Dr. Gomathi V' },
  { base: 'figma-home/about-man', label: 'CO-FOUNDERS', card: 'vignesh', name: 'Vignesh Shivan' },
  { base: 'figma-home/about-woman', label: 'CO-FOUNDERS', card: 'nayanthara', name: 'Nayanthara' },
] as const

export function AboutScreen() {
  return (
    <main className="figma-landing" id="top">
      <Reveal className="f9-about" id="about">
        <div className="f9-about__layout">
          <div className="f9-about__copy">
            <p className="fl-kicker">About Us <Flower /></p>
            <h2 className="f9-about__title">Built By A Doctor. Backed By Women. Made For Every Body.</h2>
            <p className="f9-about__text">Femi9 Began With A Simple Belief: Period Care Should Be Safe, Honest And Genuinely Comfortable. Today It Is Also A Movement That Puts Income And Dignity Into Women&apos;s Hands.</p>
            <p className="f9-about__text">Femi9 Began With A Simple Belief: Period Care Should Be Safe, Honest And Genuinely Comfortable. Today It Is Also A Movement That Puts Income And Dignity Into Women&apos;s Hands.</p>
            <Link className="fl-btn fl-btn--outline" to="/periods-wall">Know More</Link>
          </div>

          {/* `role="group"`: aria-label on a bare div is discarded, because ARIA
              forbids naming a generic element — VoiceOver and TalkBack both
              dropped this label. */}
          <div className="f9-about__stage" role="group" aria-label="Femi9 founders">
            {FOUNDERS.map((person, index) => (
              <figure className={`f9-about__card f9-about__card--${person.card}`} key={person.card}>
                <span className="f9-about__face">
                  {/* The name is in the alt: all three used to read "Femi9
                      founder", so a screen reader got the same label 3x. */}
                  <OptImg
                    base={person.base}
                    sizes="(max-width: 620px) 42vw, (max-width: 900px) 280px, 360px"
                    alt={`Femi9 founder ${person.name}`}
                    priority={index === 0}
                    className="f9-about__photo"
                  />
                </span>
                {/* A direct child of <figure>: a pill hanging off the card's edge. */}
                <figcaption className="f9-about__caption">
                  <span className="f9-about__name">{person.name}</span>
                  <span className="f9-about__role">{person.label}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </Reveal>
    </main>
  )
}
