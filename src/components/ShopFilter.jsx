import { useEffect, useState } from 'react'
import { InDock } from './BottomDock.jsx'
import './shop-filter.css'

// Sizes in the order a shopper reads them, with the spelled-out names on the
// buttons. Anything not listed (a waist size, "FREE") keeps its own label
// and goes after these, in the order the catalog first uses it.
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL']
const SIZE_NAMES = {
  XXS: '2X-SMALL',
  XS: 'X-SMALL',
  S: 'SMALL',
  M: 'MEDIUM',
  L: 'LARGE',
  XL: 'X-LARGE',
  XXL: '2X-LARGE',
  '2XL': '2X-LARGE',
  XXXL: '3X-LARGE',
  '3XL': '3X-LARGE',
}

export function sortSizes(sizes) {
  const rank = (s) => {
    const i = SIZE_ORDER.indexOf(String(s).toUpperCase())
    return i === -1 ? SIZE_ORDER.length : i
  }
  return [...sizes].sort((a, b) => rank(a) - rank(b))
}

function sizeLabel(size) {
  return SIZE_NAMES[String(size).toUpperCase()] || String(size).toUpperCase()
}

// The floating FILTER pill at the bottom of the shop, and the panel it opens.
// Changes apply as they're tapped — there's no "apply" step to forget.
export default function ShopFilter({ sizes, hideSoldOut, size, onChange }) {
  const [open, setOpen] = useState(false)
  const activeCount = (hideSoldOut ? 1 : 0) + (size ? 1 : 0)

  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      {open && (
        <div className="sf-back" onClick={() => setOpen(false)}>
          <div
            className="sf-panel"
            role="dialog"
            aria-label="Filter products"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sf-group">
              <div className="sf-label">SOLD OUT</div>
              <div className="sf-options">
                <button
                  className={!hideSoldOut ? 'on' : ''}
                  onClick={() => onChange({ hideSoldOut: false, size })}
                >
                  SHOW
                </button>
                <button
                  className={hideSoldOut ? 'on' : ''}
                  onClick={() => onChange({ hideSoldOut: true, size })}
                >
                  HIDE
                </button>
              </div>
            </div>

            {sizes.length > 0 && (
              <div className="sf-group">
                <div className="sf-label">SIZE</div>
                <div className="sf-options">
                  <button className={!size ? 'on' : ''} onClick={() => onChange({ hideSoldOut, size: '' })}>
                    ALL
                  </button>
                  {sizes.map((s) => (
                    <button
                      key={s}
                      className={size === s ? 'on' : ''}
                      onClick={() => onChange({ hideSoldOut, size: s })}
                    >
                      {sizeLabel(s)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button className="sf-close" onClick={() => setOpen(false)}>CLOSE</button>
        </div>
      )}

      {!open && (
        <InDock>
          <button
            className="sf-pill"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
          >
            FILTER{activeCount > 0 ? ` · ${activeCount}` : ''}
          </button>
        </InDock>
      )}
    </>
  )
}
