import './pager.css'

// 1 2 3 4 … 14 15 16 — the first and last page always, a few around the current
// one, and a gap marker (null) wherever pages are skipped.
function pageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const wanted = new Set([1, total, current - 1, current, current + 1])
  if (current <= 3) [2, 3, 4].forEach((n) => wanted.add(n))
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((n) => wanted.add(n))

  const sorted = [...wanted].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const out = []
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(null)
    out.push(n)
  })
  return out
}

// Shared by the shop grid and the product page's "You may like" list. Renders
// nothing when there's only one page.
export default function Pager({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null

  return (
    <nav className="pager" aria-label="Pages">
      {page > 1 && (
        <button type="button" className="pager-btn wide" onClick={() => onChange(page - 1)}>
          Previous
        </button>
      )}

      {pageList(page, totalPages).map((n, i) =>
        n === null ? (
          <span key={`gap-${i}`} className="pager-gap" aria-hidden="true">…</span>
        ) : (
          <button
            type="button"
            key={n}
            className={`pager-btn ${n === page ? 'on' : ''}`}
            aria-current={n === page ? 'page' : undefined}
            aria-label={`Page ${n}`}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        )
      )}

      {page < totalPages && (
        <button type="button" className="pager-btn wide" onClick={() => onChange(page + 1)}>
          Next page
        </button>
      )}
    </nav>
  )
}
