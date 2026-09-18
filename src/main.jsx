import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { CartProvider } from './context/CartContext.jsx'
import Home from './pages/Home.jsx'
import Shop from './pages/Shop.jsx'
import Product from './pages/Product.jsx'
import Cart from './pages/Cart.jsx'
import Checkout from './pages/Checkout.jsx'
import OrderConfirmed from './pages/OrderConfirmed.jsx'
import Admin from './pages/Admin.jsx'
import Info from './pages/Info.jsx'
import About from './pages/About.jsx'
import Track from './pages/Track.jsx'
import { captureAttribution } from './lib/attribution.js'
import './styles/global.css'

captureAttribution()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <CartProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/product/:id" element={<Product />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/order-confirmed" element={<OrderConfirmed />} />
          <Route path="/admin" element={<Admin />} />

          {/* Static pages. Explicit paths rather than /info/:slug so the URLs
              read as real pages and are worth sharing. */}
          <Route path="/track" element={<Track />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Info slug="contact" />} />
          <Route path="/size-guide" element={<Info slug="size-guide" />} />
          <Route path="/delivery" element={<Info slug="delivery" />} />
          <Route path="/privacy" element={<Info slug="privacy" />} />
          <Route path="/terms" element={<Info slug="terms" />} />
          <Route path="/refunds" element={<Info slug="refunds" />} />
        </Routes>
      </CartProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
