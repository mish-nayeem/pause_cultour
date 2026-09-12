import { createContext, useContext, useEffect, useState } from 'react'

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

  function clearCart() {
    setItems([])
  }

  const count = items.reduce((sum, i) => sum + i.qty, 0)
  const subtotal = items.reduce((sum, i) => sum + i.qty * i.price, 0)

  return (
    <CartContext.Provider
      value={{ items, addItem, removeItem, updateQty, clearCart, count, subtotal }}
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
