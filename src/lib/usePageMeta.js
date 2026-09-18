import { useEffect } from 'react'
import { cld } from './cloudinary.js'
import { isAllSoldOut } from './stock.js'

const SUFFIX = 'PAUSE'
const BASE_DESC =
  "Streetwear released in small drops, cut and sewn in Dhaka. Cash on delivery across Bangladesh."

// Sets the browser tab title and the meta description per page.
//
// Worth knowing what this does and doesn't cover: Google runs JavaScript, so
// these titles do reach search results. Facebook, WhatsApp and Messenger do
// not — their crawlers read the raw HTML only, so link previews always use the
// static tags in index.html. Giving a product its own share preview would need
// server-side rendering, which this setup doesn't do.
export default function usePageMeta(title, description) {
  useEffect(() => {
    document.title = title ? `${title} — ${SUFFIX}` : `${SUFFIX} — Streetwear, cut and sewn in Dhaka`

    const tag = document.querySelector('meta[name="description"]')
    if (tag) tag.setAttribute('content', description || BASE_DESC)
  }, [title, description])
}

// Drops a JSON-LD <script> onto a product page describing it as a
// schema.org Product — Google runs the page's JavaScript before indexing, so
// this reaches search results (and can earn a price/availability rich
// result) even though the page is otherwise rendered client-side. Facebook's
// and WhatsApp's crawlers don't run JS at all, so this doesn't touch what
// they show — that's handled server-side, in middleware.js.
export function useProductSchema(product) {
  useEffect(() => {
    if (!product) return

    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description: product.description,
      sku: product.sku,
      image: (product.images || []).map((img) => cld(img, { w: 1200 })),
      brand: { '@type': 'Brand', name: 'PAUSE' },
      offers: {
        '@type': 'Offer',
        url: `${window.location.origin}/product/${product.id}`,
        priceCurrency: 'BDT',
        price: product.price,
        availability: isAllSoldOut(product)
          ? 'https://schema.org/OutOfStock'
          : 'https://schema.org/InStock',
      },
    })
    document.head.appendChild(script)

    return () => script.remove()
  }, [product])
}
