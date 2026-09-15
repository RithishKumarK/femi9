import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useCart } from '../store/cart'
import { rupees } from '../data/products'
import { usePublicSettings } from '@/lib/use-public-settings'
import { Bag, Close, Whatsapp } from './Icons'

export function CartDrawer() {
  // Lines come straight from the server cart now — variant-aware and server-priced,
  // so there is no static PRODUCTS lookup that could miss a newly-created product.
  const { items, open, subtotal, count, closeCart, setQty, remove } = useCart()
  const { freeShipThreshold, whatsappNumber } = usePublicSettings()
  const isEmpty = items.length === 0
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const lastFocusedRef = useRef<HTMLElement | null>(null)

  // Basic focus handling: when the dialog opens, move focus into it (the close
  // control) so keyboard/AT users land on the drawer rather than being left
  // behind it; restore focus to the trigger when it closes.
  useEffect(() => {
    if (open) {
      lastFocusedRef.current = document.activeElement as HTMLElement | null
      closeBtnRef.current?.focus()
    } else if (lastFocusedRef.current) {
      lastFocusedRef.current.focus?.()
      lastFocusedRef.current = null
    }
  }, [open])

  // Escape to close, Tab contained inside the dialog, and a scroll lock that
  // actually holds on iOS.
  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeCart()
        return
      }
      // aria-modal="true" promises focus cannot leave the dialog; without this
      // Tab walked straight out into the storefront behind it.
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && panel.contains(active)

      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    // iOS Safari does not honour body{overflow:hidden} as a scroll lock: once
    // .drawer-body hits its scroll end the gesture chains through to the page
    // behind a full-screen drawer, and closing it leaves the shopper somewhere
    // else entirely. Only `position:fixed` holds there.
    //
    // Restricted to coarse pointers on purpose: that is where the bug is, and
    // it is also where Lenis is switched off (SmoothScroll bails on
    // `pointer: coarse`), so pinning the body cannot fight the smooth-scroll
    // loop. Desktop keeps the overflow lock it has always used.
    const body = document.body
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const scrollY = window.scrollY
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width }

    body.style.overflow = 'hidden'
    if (coarse) {
      body.style.position = 'fixed'
      body.style.top = `-${scrollY}px`
      body.style.width = '100%'
    }

    return () => {
      document.removeEventListener('keydown', onKey)
      body.style.overflow = ''
      if (coarse) {
        body.style.position = prev.position
        body.style.top = prev.top
        body.style.width = prev.width
        // Pinning the body scrolled the document to 0; put her back.
        window.scrollTo(0, scrollY)
      }
    }
  }, [open, closeCart])

  // WhatsApp is now the SECONDARY path; the message is built from server lines.
  function orderOnWhatsApp() {
    if (isEmpty) return
    let msg = 'Hi Femi9! I would like to order:\n'
    for (const it of items) {
      msg += `\n• ${it.name} - ${it.variantLabel} x${it.qty} (${rupees(it.lineTotal)})`
    }
    msg += `\n\nTotal: ${rupees(subtotal)}`
    window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const away = freeShipThreshold - subtotal
  // Progress toward free shipping, clamped so a threshold of 0 (or an overshoot)
  // cannot produce NaN / >100% widths.
  const shipPct = freeShipThreshold > 0 ? Math.min(100, Math.round((subtotal / freeShipThreshold) * 100)) : 100

  return (
    <>
      <div className={`overlay${open ? ' open' : ''}`} onClick={closeCart} />
      <aside
        ref={panelRef}
        className={`drawer${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Shopping bag"
        aria-hidden={!open}
        // aria-hidden alone leaves the closed drawer's ~10 controls in the tab
        // order — announced as nothing, and off-screen. `inert` removes focus
        // and the a11y tree together.
        inert={!open}
      >
        <div className="drawer-head">
          <div>
            <h3>Your bag</h3>
            <p>{isEmpty ? 'Nothing here yet' : `${count} ${count === 1 ? 'item' : 'items'}`}</p>
          </div>
          <button ref={closeBtnRef} className="drawer-close" onClick={closeCart} aria-label="Close bag">
            <Close />
          </button>
        </div>

        <div className="drawer-body">
          {isEmpty ? (
            <div className="cart-empty">
              <span className="cart-empty__icon">
                <Bag />
              </span>
              <h4>Your bag is empty</h4>
              <p>Comfort is one tap away.</p>
              <button
                className="btn btn-primary"
                onClick={() => {
                  closeCart()
                  window.location.assign('/shop')
                }}
              >
                Shop pads
              </button>
            </div>
          ) : (
            items.map((it) => (
              <div className="ci" key={it.variantId}>
                <div className="ci-img">
                  {/* `it.img` is an admin-uploaded URL resolved at request time,
                      so there is no OptImg manifest entry and no pre-built
                      ladder for it. width/height match the 66px painted box
                      (78px minus 6px padding each side) and the decode is
                      deferred — a merchant can upload a multi-MB phone photo. */}
                  <img
                    src={it.img}
                    alt={it.name}
                    width={66}
                    height={66}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div className="ci-info">
                  <div className="ci-top">
                    <b>{it.name}</b>
                    <span className="ci-price">{rupees(it.lineTotal)}</span>
                  </div>
                  <small>{it.variantLabel}</small>
                  <div className="ci-bottom">
                    <div className="qty">
                      <button onClick={() => setQty(it.variantId, it.qty - 1)} aria-label="Decrease quantity">
                        &minus;
                      </button>
                      <span>{it.qty}</span>
                      <button onClick={() => setQty(it.variantId, it.qty + 1)} aria-label="Increase quantity">
                        +
                      </button>
                    </div>
                    <button
                      className="ci-remove"
                      onClick={() => remove(it.variantId)}
                      aria-label={`Remove ${it.name} from bag`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {!isEmpty && (
          <div className="drawer-foot">
            <div className="ship-meter">
              <p className="ship-hint">
                {away > 0 ? (
                  <>
                    Add <b>{rupees(away)}</b> more for free shipping
                  </>
                ) : (
                  'You have unlocked free shipping'
                )}
              </p>
              <div className="ship-bar" role="presentation">
                <span style={{ width: `${shipPct}%` }} />
              </div>
            </div>
            <div className="row">
              <span>Subtotal</span>
              <span>{rupees(subtotal)}</span>
            </div>
            <div className="row shipping">
              <span>Shipping</span>
              <span>{away > 0 ? 'Calculated at checkout' : 'Free'}</span>
            </div>
            <div className="row total">
              <span>Total</span>
              <span>{rupees(subtotal)}</span>
            </div>
            <Link href="/checkout" className="btn btn-primary" onClick={closeCart}>
              Proceed to checkout
            </Link>
            <button className="btn btn-ghost" onClick={orderOnWhatsApp}>
              <Whatsapp />
              Order on WhatsApp
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
