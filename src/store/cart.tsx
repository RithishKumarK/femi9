'use client'

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react'

/**
 * Cart store — a thin client mirror of the server-side cart.
 *
 * The cart is VARIANT-AWARE and SERVER-PRICED: every line, its price and the
 * subtotal come from /api/cart (backed by Postgres + a guest cookie). We keep no
 * pricing logic here, so a product created in the admin after launch works the
 * same as the original five — the old static PRODUCTS lookup could only price the
 * hard-coded catalog and silently broke on anything else.
 */

/** One line as returned by the cart service (mirrors CartItemDTO). */
export interface CartLine {
  variantId: string
  productSlug: string
  name: string
  variantLabel: string
  unitPrice: number
  qty: number
  lineTotal: number
  img: string
}

/** The full cart payload every /api/cart endpoint returns. */
interface CartResponse {
  items: CartLine[]
  subtotal: number
  count: number
}

interface State {
  items: CartLine[]
  subtotal: number
  count: number
  open: boolean
  toast: { msg: string; id: number } | null
}

type Action =
  | { type: 'SET_CART'; cart: CartResponse }
  | { type: 'OPEN' }
  | { type: 'CLOSE' }
  | { type: 'TOAST'; msg: string }

const INITIAL: State = { items: [], subtotal: 0, count: 0, open: false, toast: null }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_CART':
      // Server response is authoritative for items / subtotal / count.
      return { ...state, items: action.cart.items, subtotal: action.cart.subtotal, count: action.cart.count }
    case 'OPEN':
      return { ...state, open: true }
    case 'CLOSE':
      return { ...state, open: false }
    case 'TOAST':
      // Bump the id so the Toast effect re-fires even on a repeated message.
      return { ...state, toast: { msg: action.msg, id: (state.toast?.id ?? 0) + 1 } }
    default:
      return state
  }
}

/** Same-origin fetch; cookies ride along automatically, so no credentials opts. */
async function cartFetch(input: string, init?: RequestInit): Promise<CartResponse> {
  const res = await fetch(input, init)
  if (!res.ok) throw new Error(`cart request failed: ${res.status}`)
  return (await res.json()) as CartResponse
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

interface CartApi {
  items: CartLine[]
  count: number
  subtotal: number
  open: boolean
  toast: State['toast']
  add: (variantId: string, qty?: number) => Promise<void>
  setQty: (variantId: string, qty: number) => Promise<void>
  remove: (variantId: string) => Promise<void>
  refresh: () => Promise<void>
  openCart: () => void
  closeCart: () => void
  notify: (msg: string) => void
}

const CartContext = createContext<CartApi | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL)

  const refresh = useCallback(async () => {
    try {
      dispatch({ type: 'SET_CART', cart: await cartFetch('/api/cart') })
    } catch (err) {
      // A failed load must never blank the UI — log and keep whatever we have.
      console.error('[cart] refresh failed', err)
    }
  }, [])

  // Hydrate from the server (guest cookie) on first mount so the cart survives reloads.
  useEffect(() => {
    void refresh()
  }, [refresh])

  const add = useCallback(async (variantId: string, qty = 1) => {
    // Open immediately so a slow cart request cannot make a successful click
    // look unresponsive. The server response remains authoritative for lines
    // and pricing when it arrives.
    dispatch({ type: 'OPEN' })
    try {
      const cart = await cartFetch('/api/cart', jsonInit('POST', { variantId, qty }))
      dispatch({ type: 'SET_CART', cart })
      const line = cart.items.find((i) => i.variantId === variantId)
      dispatch({ type: 'TOAST', msg: `${line?.name ?? 'Item'} added to bag` })
    } catch (err) {
      console.error('[cart] add failed', err)
      dispatch({ type: 'TOAST', msg: 'Sorry, could not add that to your bag' })
    }
  }, [])

  const setQty = useCallback(async (variantId: string, qty: number) => {
    try {
      // qty <= 0 is the API's "remove this line" signal.
      const cart = await cartFetch(`/api/cart/items/${encodeURIComponent(variantId)}`, jsonInit('PATCH', { qty }))
      dispatch({ type: 'SET_CART', cart })
    } catch (err) {
      // The quantity stepper and the trash control used to fail in total
      // silence: the request 500s or the network drops, the line keeps its old
      // number, and the shopper is left pressing a button that looks broken.
      // Toast it and re-read the server cart so the UI stops disagreeing with
      // what is actually stored.
      console.error('[cart] setQty failed', err)
      dispatch({ type: 'TOAST', msg: 'Sorry, could not update that quantity' })
      void refresh()
    }
  }, [refresh])

  const remove = useCallback(async (variantId: string) => {
    try {
      const cart = await cartFetch(`/api/cart/items/${encodeURIComponent(variantId)}`, { method: 'DELETE' })
      dispatch({ type: 'SET_CART', cart })
    } catch (err) {
      console.error('[cart] remove failed', err)
      dispatch({ type: 'TOAST', msg: 'Sorry, could not remove that item' })
      void refresh()
    }
  }, [refresh])

  const openCart = useCallback(() => dispatch({ type: 'OPEN' }), [])
  const closeCart = useCallback(() => dispatch({ type: 'CLOSE' }), [])
  const notify = useCallback((msg: string) => dispatch({ type: 'TOAST', msg }), [])

  const value = useMemo<CartApi>(
    () => ({
      items: state.items,
      count: state.count,
      subtotal: state.subtotal,
      open: state.open,
      toast: state.toast,
      add,
      setQty,
      remove,
      refresh,
      openCart,
      closeCart,
      notify,
    }),
    [state.items, state.count, state.subtotal, state.open, state.toast, add, setQty, remove, refresh, openCart, closeCart, notify],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCart(): CartApi {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
