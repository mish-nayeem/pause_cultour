import { useEffect } from 'react'

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
