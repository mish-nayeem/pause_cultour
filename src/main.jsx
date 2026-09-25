import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { CartProvider } from './context/CartContext.jsx'
import Home from './pages/Home.jsx'
import Shop from './pages/Shop.jsx'
import Product from './pages/Product.jsx'
import Cart from './pages/Cart.jsx'
import Checkout from './pages/Checkout.jsx'
import OrderConfirmed from './pages/OrderConfirmed.jsx'
import Login from './pages/Login.jsx'
import Account from './pages/Account.jsx'
import ResetPassword from './pages/ResetPassword.jsx'
import Info from './pages/Info.jsx'
import About from './pages/About.jsx'
import Track from './pages/Track.jsx'
import PageViewTracker from './components/PageViewTracker.jsx'
import RecoveryRedirect from './components/RecoveryRedirect.jsx'
import SmoothScroll from './components/SmoothScroll.jsx'
import { captureAttribution } from './lib/attribution.js'
import { startSessionPolicy } from './lib/sessionPolicy.js'
import './styles/global.css'

// Lazy: Admin.jsx pulls in every product/order/marketing manager component
// and is by far the largest chunk of the app (1900+ lines), but only the
// signed-in admin ever opens it. Loading it eagerly meant every shopper's
// first page load — on a phone, often on 3G/4G — paid for code they'd never
// run. Split into its own chunk, it's only fetched the moment someone
// actually navigates to /admin.
const Admin = lazy(() => import('./pages/Admin.jsx'))

captureAttribution()
startSessionPolicy()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <CartProvider>
        <PageViewTracker />
        <SmoothScroll />
        <RecoveryRedirect />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/product/:id" element={<Product />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/order-confirmed" element={<OrderConfirmed />} />
          <Route
            path="/admin"
            element={
              <Suspense fallback={<div className="admin-chunk-loading mono">Loading admin…</div>}>
                <Admin />
              </Suspense>
            }
          />
          <Route path="/login" element={<Login />} />
          <Route path="/account" element={<Account />} />
          <Route path="/reset-password" element={<ResetPassword />} />

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
