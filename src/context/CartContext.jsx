import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { fetchCurrentPrices } from '../lib/products.js'

const CartContext = createContext(null)
const STORAGE_KEY = 'pause_cart'

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }, [items])

  // Each cart line is unique by product id + size
  function addItem(product, size, qty = 1) {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === product.id && i.size === size)
      if (existing) {
        return prev.map((i) =>
          i.id === product.id && i.size === size ? { ...i, qty: i.qty + qty } : i
        )
      }
      return [
        ...prev,
        {
          id: product.id,
          name: product.name,
          sku: product.sku,
          price: product.price,
          image: product.images[0],
          size,
          qty,
        },
      ]
    })
  }

  function removeItem(id, size) {
    setItems((prev) => prev.filter((i) => !(i.id === id && i.size === size)))
  }

  function updateQty(id, size, qty) {
    if (qty < 1) return
    setItems((prev) =>
      prev.map((i) => (i.id === id && i.size === size ? { ...i, qty } : i))
    )
  }

  // A cart can sit in the browser while a sale starts or ends; the cart and
  // checkout pages call this so the lines carry today's price, which is what
  // place_order will charge.
  const refreshPrices = useCallback(async () => {
    const ids = [...new Set(items.map((i) => i.id))]
    const prices = await fetchCurrentPrices(ids)
    if (!prices) return
    setItems((prev) => {
      const changed = prev.some((i) => prices[i.id] != null && prices[i.id] !== i.price)
      if (!changed) return prev
      return prev.map((i) => (prices[i.id] != null ? { ...i, price: prices[i.id] } : i))
    })
    // Only re-run when the set of products changes, not on every qty tap.
  }, [items.map((i) => i.id).join(',')])

  function clearCart() {
    setItems([])
  }

  const count = items.reduce((sum, i) => sum + i.qty, 0)
  const subtotal = items.reduce((sum, i) => sum + i.qty * i.price, 0)

  return (
    <CartContext.Provider
      value={{ items, addItem, removeItem, updateQty, clearCart, refreshPrices, count, subtotal }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
