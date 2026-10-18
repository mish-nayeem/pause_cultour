// The small red dot in the corner of a product's photo in the admin: one of its
// sizes is down to its last piece (see starSizes in src/lib/stock.js).
// Hover or long-press shows which sizes.
export default function RestockStar({ sizes }) {
  if (!sizes?.length) return null
  const label = `Almost gone: ${sizes.join(', ')}`
  return (
    <span className="restock-star" title={label} aria-label={label} role="img" />
  )
}
