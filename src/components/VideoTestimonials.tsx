'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  VIDEO_TESTIMONIALS,
  testimonialsForProduct,
  type VideoTestimonial,
} from '../data/videoTestimonials'
import '../styles/video-testimonials.css'

/**
 * "Real Stories" — a centre-focused rail of customer clips.
 *
 * One clip plays at a time, in the middle of the rail, AT FULL LENGTH. When it
 * ends the rail advances to the next one on its own. The previous version cut
 * every clip off after three seconds on a timer, which showed the first breath
 * of six stories and the whole of none of them.
 *
 * There are only ever a handful of clips, so the rail is built as an ENDLESS
 * ROLL rather than a row with two ends: the list is laid down several times over
 * and the roll folds back onto an identical card whenever it would run off the
 * side. Six stories on a finite row means the last one is watched with half a
 * screen of white beside it and the wrap back to the first one rewinds the
 * entire rail in front of her. Folding costs nothing visually — the track
 * repeats every `count` cards, so the two positions are the same pixels — and it
 * means the roll simply keeps turning, first clip following last, for as long as
 * she watches. See `foldSlot` below for the mechanics.
 *
 * The rules that keep an auto-playing rail from being hostile:
 * • It does nothing until the section is actually on screen. Playing clips for
 *   a section nobody has scrolled to would download several MB of video — her
 *   data — to animate pixels out of view.
 * • Sound is off until she asks for it. Autoplay with audio is both blocked by
 *   every browser and rude; a click is what turns it on (and a click is also
 *   the one gesture browsers accept as consent for it).
 * • Only the current and next clip are allowed to preload. `preload="none"`
 *   everywhere else means the rail costs one poster per card until it starts.
 * • Reduced motion means it waits: nothing plays or advances until she picks a
 *   clip. This is a moving carousel that also plays video, which is squarely
 *   what that preference is about.
 * • A hidden tab stops it, so it is not burning battery in the background.
 *
 * Nothing is captioned. The cards are the section — a name under every one of
 * them turns a wall of faces into a row of labelled exhibits, and the clips
 * introduce their own speakers anyway. The name is still carried in the a11y
 * tree: it is what every control on the card is labelled with.
 */

interface Props {
  /** Scope to one product's clips. Omit for every clip (the landing rail). */
  productId?: string
  /** Pass null where the host section already has its own heading. */
  heading?: string | null
  subhead?: string | null
  /** Extra class on the <section>, for host-page overrides. */
  className?: string
}

/**
 * How many cards have to sit either side of the one playing for the rail to look
 * full to both screen edges.
 *
 * These shoulders are what the rail is padded WITH. The alternative — a
 * `50vw - card/2` lead-in of empty space, which is how the rail used to reach
 * the middle — is a half-screen of white the moment the rail sits anywhere near
 * either end of its track, which is where it starts and where a hand swipe can
 * leave it. Real cards there cost nothing extra: every copy shares its
 * original's poster and `preload="none"`, so twelve cards is still six images.
 *
 * Five is what covers the widest case the card sizes in video-testimonials.css
 * can resolve to. A card is at most 400px wide on a 20px gap, so five reach
 * 2100px + the active card's own 200px half — clear of the 1920px half-screen
 * of a 3840px display, and far clear of it at every width below.
 */
const SIDE_CARDS = 5

/** Pointer travel before a press on the rail counts as a drag rather than a tap. */
const DRAG_SLOP = 8
/** Fraction of a card width a slow drag must cover to move on to the next story. */
const SWIPE_DISTANCE = 0.18
/** px/ms: a release faster than this moves on however short the drag was. */
const FLICK_VELOCITY = 0.35
/** Horizontal wheel travel (a trackpad swipe) that moves one card. */
const WHEEL_DISTANCE = 40

/**
 * A layout effect that does not warn on the server.
 *
 * The fold has to be written to `scrollLeft` in the same frame that React moves
 * the active card, or the browser paints one frame of the rail sitting at the
 * old offset with the new card highlighted a screen away — a visible flinch at
 * exactly the moment the roll is meant to be seamless.
 */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l10-6.4a1 1 0 0 0 0-1.7l-10-6.4A1 1 0 0 0 8 5.6Z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="7" y="5" width="3.6" height="14" rx="1.2" />
      <rect x="13.4" y="5" width="3.6" height="14" rx="1.2" />
    </svg>
  )
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 9.5v5a1 1 0 0 0 1 1h3l3.8 3.2a.8.8 0 0 0 1.3-.6V5.9a.8.8 0 0 0-1.3-.6L8 8.5H5a1 1 0 0 0-1 1Z" />
      {muted ? (
        <path
          d="m16.2 9.3 4.5 5.4M20.7 9.3l-4.5 5.4"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          fill="none"
        />
      ) : (
        <path
          d="M16.4 8.6a4.6 4.6 0 0 1 0 6.8M18.9 6.4a8 8 0 0 1 0 11.2"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </svg>
  )
}

function Clip({
  clip,
  index,
  isActive,
  playing,
  muted,
  preload,
  register,
  onSelect,
  onToggle,
  onToggleSound,
  onEnded,
}: {
  clip: VideoTestimonial
  index: number
  isActive: boolean
  playing: boolean
  muted: boolean
  preload: 'none' | 'metadata' | 'auto'
  register: (i: number, el: HTMLVideoElement | null) => void
  onSelect: (i: number) => void
  onToggle: () => void
  onToggleSound: () => void
  onEnded: (i: number) => void
}) {
  /** The progress fill. Written to directly on every timeupdate — routing that
   *  through state would re-render the whole rail four times a second. */
  const barRef = useRef<HTMLElement>(null)

  return (
    <li className={`vt-card${isActive ? ' is-active' : ''}`}>
      <div className="vt-frame">
        <video
          ref={(el) => register(index, el)}
          className="vt-video"
          src={clip.src}
          poster={clip.poster}
          playsInline
          preload={preload}
          onEnded={() => onEnded(index)}
          onTimeUpdate={(e) => {
            if (!isActive) return
            const v = e.currentTarget
            const bar = barRef.current
            if (bar && v.duration) bar.style.transform = `scaleX(${v.currentTime / v.duration})`
          }}
          // Decorative in the a11y tree: the buttons over it are the labelled
          // controls and the name below is the text alternative.
          aria-hidden="true"
          tabIndex={-1}
        />

        <button
          type="button"
          className="vt-hit"
          onClick={() => (isActive ? onToggle() : onSelect(index))}
          aria-label={
            isActive
              ? playing
                ? `Pause ${clip.name}'s story`
                : `Play ${clip.name}'s story`
              : `Play ${clip.name}'s story with sound`
          }
        />

        {!isActive && (
          <span className="vt-badge" aria-hidden="true">
            <PlayIcon />
          </span>
        )}

        {isActive && (
          <>
            <button
              type="button"
              className="vt-ctl vt-ctl--transport"
              onClick={onToggle}
              aria-label={playing ? 'Pause this story' : 'Play this story'}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              type="button"
              className="vt-ctl vt-ctl--sound"
              onClick={onToggleSound}
              aria-label={muted ? 'Unmute this story' : 'Mute this story'}
              aria-pressed={!muted}
            >
              <SoundIcon muted={muted} />
            </button>
            <span className="vt-progress" aria-hidden="true">
              <i ref={barRef} />
            </span>
          </>
        )}
      </div>

    </li>
  )
}

export function VideoTestimonials({
  productId,
  heading = 'Real Stories',
  subhead = 'Customers on what changed after they switched.',
  className,
}: Props) {
  const clips = productId ? testimonialsForProduct(productId) : VIDEO_TESTIMONIALS
  const count = clips.length

  /**
   * The track: one run of the clip list with `SIDE_CARDS` of wrap-around either
   * side of it, so `track[i]` and `track[i + count]` are always the same clip.
   *
   * That is the whole trick. The playing card only ever occupies the middle band
   * — positions `SIDE_CARDS` to `SIDE_CARDS + count - 1`, one per clip — and the
   * shoulders exist so the band's outermost cards still have a full rail of
   * faces beside them, and so a swipe that runs past the band meets more clips
   * rather than the end of the rail. Six clips cost sixteen cards, all sharing
   * six posters and all but two at `preload="none"`.
   */
  const total = count < 2 ? count : count + 2 * SIDE_CARDS
  const track = Array.from({ length: total }, (_, i) => clips[i % count])

  /**
   * Fold a position back into that band, onto the identical card `count` places
   * away. Because the two positions show the same clip with the same neighbours,
   * a rail teleported between them is pixel-for-pixel unchanged — which is what
   * lets the roll pass the last story and land on the first without a rewind.
   * Pure, and used both to move the roll and to decide what to preload.
   */
  const foldSlot = useCallback(
    (slot: number) => {
      if (count < 2) return 0
      let i = slot
      while (i < SIDE_CARDS) i += count
      while (i > total - 1 - SIDE_CARDS) i -= count
      return i
    },
    [count, total],
  )

  const railRef = useRef<HTMLUListElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const videos = useRef<(HTMLVideoElement | null)[]>([])
  /** The press in progress on the rail. A ref: a drag writes scrollLeft on every
   *  pointermove, and state would re-render the whole rail each time. */
  const drag = useRef<{
    id: number
    x: number
    y: number
    left: number
    lastX: number
    lastT: number
    velocity: number
    moved: boolean
  } | null>(null)
  /** A drag ends with a click on whichever card it was released over; swallow it. */
  const swallowClickUntil = useRef(0)

  /**
   * Start in the MIDDLE of the track, not at the front.
   *
   * The rail centres whatever is playing, and a card at the front of the track
   * can only be centred by leaving half a screen of nothing to the left of it —
   * the section would open on a lone card in a gutter. Starting halfway in means
   * the band is full of faces on both sides from the first paint, which is the
   * shape of the design. Same value on the server and the client, so hydration
   * agrees.
   *
   * `from` rides along with the index: it is the slot the move aimed at before
   * folding, so the scroll effect can tell a fold from a plain step and still
   * glide across the seam.
   */
  const [pos, setPos] = useState(() => {
    const index = count < 2 ? 0 : SIDE_CARDS + Math.floor(count / 2)
    return { index, from: index }
  })
  const active = pos.index
  const [inView, setInView] = useState(false)
  /** What the visitor wants: whether the active clip should be running. */
  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState(true)

  const register = useCallback((i: number, el: HTMLVideoElement | null) => {
    videos.current[i] = el
  }, [])

  // Reduced motion: hold everything until she picks a clip. Applied in an
  // effect rather than in the initial state so the server and the first client
  // render agree — the transport icon depends on this.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(false)
  }, [])

  // Only run while the section is genuinely on screen. Not unobserved after the
  // first hit, unlike a reveal animation: scrolling away has to STOP it.
  useEffect(() => {
    const node = sectionRef.current
    if (!node) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.3 })
    io.observe(node)
    return () => io.disconnect()
  }, [])

  // Everything that is not the active clip is stopped and rewound, so coming
  // back to one starts the story from the top rather than mid-sentence.
  useEffect(() => {
    videos.current.forEach((v, i) => {
      if (!v || i === active) return
      v.pause()
      v.currentTime = 0
    })
  }, [active])

  // Drive the active clip. Deliberately does NOT depend on `muted`: toggling
  // sound must not restart playback, so the mute handler sets it on the element
  // directly and this only applies the current value when it (re)starts one.
  useEffect(() => {
    const v = videos.current[active]
    if (!v) return
    v.muted = muted
    if (inView && playing) {
      void v.play().catch(() => {
        // No gesture is in flight here — this is the rail moving on by itself —
        // so a browser that has not granted unmuted autoplay will refuse. Drop
        // the sound rather than the story and try once more; if that fails too
        // (data-saver, battery-saver) the poster simply stays.
        if (!v.muted) {
          v.muted = true
          setMuted(true)
          void v.play().catch(() => {})
        }
      })
    } else {
      v.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, inView, playing])

  // Scroll the ACTIVE card to the middle of the rail. Scrolls the rail itself
  // rather than calling scrollIntoView, which would also scroll the page
  // vertically and yank the visitor around while she is reading something else
  // on the way past.
  //
  // Deliberately NOT gated on `inView`, unlike the playback effect below it.
  // Gating it meant the rail held scrollLeft 0 until the section crossed the
  // observer's threshold, and at 0 the whole left half of the rail is the
  // lead-in — the section was read as a band of white with a few cards pushed
  // off to the right, which is exactly what it is not meant to look like.
  // Taking the opening position on mount costs one scrollLeft write and no
  // bytes: nothing plays and nothing is fetched until `inView` flips.
  //
  // Only the very first move is instant: that is the rail taking up its opening
  // position, not advancing. Every later move glides, a fold included. A fold
  // first shifts the rail by exactly the distance from the slot it aimed at to
  // that slot's identical twin, which changes no pixels, and glides from there.
  // So the step from the last story to the first looks like any other, and a
  // swipe released mid-drag carries on from where the finger let go.
  const settled = useRef(false)
  useIsoLayoutEffect(() => {
    const rail = railRef.current
    const card = rail?.children[active] as HTMLElement | undefined
    if (!rail || !card) return
    const twin = rail.children[pos.from] as HTMLElement | undefined
    if (settled.current && twin && twin !== card) {
      rail.scrollLeft += card.offsetLeft - twin.offsetLeft
    }
    const target = card.offsetLeft + card.offsetWidth / 2 - rail.clientWidth / 2
    rail.scrollTo({ left: Math.max(0, target), behavior: settled.current ? 'smooth' : 'auto' })
    settled.current = true
  }, [pos, active])

  // A background tab should not be decoding video. `playing` is left alone, so
  // coming back resumes whichever clip was current.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) videos.current.forEach((v) => v?.pause())
      else if (playing && inView) void videos.current[active]?.play().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [active, playing, inView])

  /**
   * Move the roll `steps` cards; 0 settles it back onto the current one. Never
   * runs out of track: it folds instead. The shoulders are SIDE_CARDS deep, so
   * that is as far as one move can reach and still aim at a real card.
   */
  const go = useCallback(
    (steps: number) =>
      setPos(({ index }) => {
        const from = index + Math.max(-SIDE_CARDS, Math.min(SIDE_CARDS, steps))
        return { index: foldSlot(from), from }
      }),
    [foldSlot],
  )

  /**
   * Picking a clip. The click is a user gesture, so this is the one moment the
   * browser will let sound start — hence `play()` here, imperatively, rather
   * than leaving it to the effect above, whose call happens a tick later and
   * can fall outside the gesture window.
   *
   * Takes a track position, which for a card near the edge of the visible band
   * can belong to a neighbouring copy; folding it keeps the roll's invariant
   * without changing what she sees.
   */
  const select = useCallback(
    (slot: number) => {
      const i = foldSlot(slot)
      const v = videos.current[i]
      setPos({ index: i, from: slot })
      setPlaying(true)
      setMuted(false)
      if (!v) return
      v.muted = false
      v.currentTime = 0
      void v.play().catch(() => {
        // Refused even with a gesture (some mobile data-saver modes). Fall back
        // to muted so the click still does something visible.
        v.muted = true
        setMuted(true)
        void v.play().catch(() => {})
      })
    },
    [foldSlot],
  )

  /** Play/pause the clip already in the middle. */
  const toggle = useCallback(() => setPlaying((p) => !p), [])

  const toggleSound = useCallback(() => {
    setMuted((m) => {
      const next = !m
      const v = videos.current[active]
      if (v) v.muted = next
      return next
    })
  }, [active])

  /**
   * A clip that has run its course hands the rail to the next story — and after
   * the last story that is the first one again, because `go` folds rather than
   * stopping. A rail of one clip has nowhere to hand off to, so it replays.
   */
  const handleEnded = useCallback(
    (i: number) => {
      // A clip ending under a finger mid-drag must not yank the rail away from it.
      if (i !== active || drag.current?.moved) return
      if (count < 2) {
        const v = videos.current[i]
        if (v) {
          v.currentTime = 0
          void v.play().catch(() => {})
        }
        return
      }
      go(1)
    },
    [active, count, go],
  )

  // With the script running, the swipe handling below replaces native horizontal
  // scrolling (see `.vt-rail--swipe`); without it the rail stays a plain snap
  // scroller. Switched on after mount so server and client markup agree.
  const [swipeable, setSwipeable] = useState(false)
  useEffect(() => setSwipeable(true), [])

  const onPointerDown = (e: ReactPointerEvent<HTMLUListElement>) => {
    const rail = railRef.current
    if (!rail || count < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      left: rail.scrollLeft,
      lastX: e.clientX,
      lastT: e.timeStamp,
      velocity: 0,
      moved: false,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLUListElement>) => {
    const d = drag.current
    const rail = railRef.current
    if (!d || !rail || e.pointerId !== d.id) return
    const dx = e.clientX - d.x
    if (!d.moved) {
      const dy = e.clientY - d.y
      // Mostly vertical: that is the page being scrolled past the rail.
      if (Math.abs(dy) > DRAG_SLOP && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null
        return
      }
      if (Math.abs(dx) < DRAG_SLOP) return
      d.moved = true
      // Captured only once it is a drag: capturing a plain tap would retarget
      // its click away from the card's buttons.
      rail.setPointerCapture(e.pointerId)
      rail.classList.add('is-dragging')
    }
    const dt = e.timeStamp - d.lastT
    if (dt > 0) d.velocity = (e.clientX - d.lastX) / dt
    d.lastX = e.clientX
    d.lastT = e.timeStamp
    rail.scrollLeft = d.left - dx
  }

  const onPointerEnd = (e: ReactPointerEvent<HTMLUListElement>) => {
    const d = drag.current
    const rail = railRef.current
    if (!d || e.pointerId !== d.id) return
    drag.current = null
    if (!d.moved || !rail) return
    rail.classList.remove('is-dragging')
    swallowClickUntil.current = e.timeStamp + 400

    const card = rail.children[active] as HTMLElement | undefined
    const gap = parseFloat(getComputedStyle(rail).columnGap) || 0
    const step = card ? card.offsetWidth + gap : rail.clientWidth
    const dx = d.lastX - d.x
    // A finger that paused before lifting is not a flick, however fast it moved earlier.
    const velocity = e.timeStamp - d.lastT > 100 ? 0 : d.velocity
    let steps = Math.round(-dx / step)
    if (steps === 0 && (Math.abs(dx) > step * SWIPE_DISTANCE || Math.abs(velocity) > FLICK_VELOCITY)) {
      steps = dx < 0 ? 1 : -1
    }
    go(steps)
    if (steps !== 0) setPlaying(true)
  }

  const onClickCapture = (e: ReactMouseEvent<HTMLUListElement>) => {
    if (e.timeStamp < swallowClickUntil.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // A two-finger trackpad swipe moves one card per gesture. Its momentum keeps
  // sending wheel events after the fingers lift, so the rail stays locked until
  // they go quiet.
  useEffect(() => {
    const rail = railRef.current
    if (!rail || count < 2) return
    let travel = 0
    let locked = false
    let quiet = 0
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
      e.preventDefault()
      window.clearTimeout(quiet)
      quiet = window.setTimeout(() => {
        locked = false
        travel = 0
      }, 180)
      if (locked) return
      travel += e.deltaX
      if (Math.abs(travel) < WHEEL_DISTANCE) return
      locked = true
      go(travel > 0 ? 1 : -1)
      setPlaying(true)
    }
    rail.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      rail.removeEventListener('wheel', onWheel)
      window.clearTimeout(quiet)
    }
  }, [count, go])

  if (count === 0) return null

  /**
   * The clip that plays next, folded the same way the roll itself will fold —
   * so at the seam between last story and first it is the card the roll actually
   * lands on that has been warmed up, not the one at the end of the track that
   * nobody ever reaches.
   */
  const upcoming = foldSlot(active + 1)

  return (
    <section
      className={`vt-section${className ? ` ${className}` : ''}`}
      aria-labelledby={heading ? 'vt-heading' : undefined}
      aria-label={heading ? undefined : 'Customer video stories'}
      ref={sectionRef}
    >
      {heading && (
        <h2 className="vt-heading" id="vt-heading">
          {heading}
        </h2>
      )}
      {subhead && <p className="vt-sub">{subhead}</p>}

      {/* `vt-rail--roll` swaps the half-screen lead-in for a plain gutter. It is
          only correct when the track HAS shoulders to fill that space with —
          a single-clip rail (a product page with one story) has none, so it
          keeps the padding and is centred by it. */}
      <ul
        className={`vt-rail${count > 1 ? ' vt-rail--roll' : ''}${swipeable && count > 1 ? ' vt-rail--swipe' : ''}`}
        ref={railRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
      >
        {track.map((clip, i) => (
          <Clip
            key={`${clip.id}-${i}`}
            clip={clip}
            index={i}
            isActive={i === active}
            playing={playing}
            muted={muted}
            register={register}
            onSelect={select}
            onToggle={toggle}
            onToggleSound={toggleSound}
            onEnded={handleEnded}
            // Current and next only. Everything else stays at `none`, so the
            // rail costs one poster per card until it actually starts — and the
            // copies share those posters, so repeating the list costs no extra
            // requests either.
            preload={inView && (i === active || i === upcoming) ? 'auto' : 'none'}
          />
        ))}
      </ul>

      <div className="vt-controls">
        <button type="button" className="vt-arrow" aria-label="Previous story" onClick={() => go(-1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 5 8 12l7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* No dots. A row of them is a progress meter — "six stories, you are on
            the fourth" — and this rail has no fourth of six: it turns for as long
            as she watches. Counting the clips out under an endless roll invites
            her to sit and wait for the set to finish. The arrows still let her
            move by hand, and every card is its own jump-to control. */}

        <button type="button" className="vt-arrow" aria-label="Next story" onClick={() => go(1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </section>
  )
}
