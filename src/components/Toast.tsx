import { useEffect, useState } from 'react'
import { useCart } from '../store/cart'
import { Check } from './Icons'

export function Toast() {
  const { toast } = useCart()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!toast) return
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 2200)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <div className={`toast${visible ? ' show' : ''}`}>
      <Check />
      <span>{toast?.msg}</span>
    </div>
  )
}
