import { useNavigate } from 'react-router-dom'
import { imgUrl } from '../lib/images.js'
import { colourSiblings } from '../lib/products.js'
import './colour-swatches.css'

const SHOW = 5

// Under a card's name: a small round photo of each colour the piece comes
// in, so a shopper scrolling the grid sees it's not only the one shown.
// Tapping a colour opens that colour's page. Nothing for a one-colour piece.
export default function ColourSwatches({ product, all }) {
  const navigate = useNavigate()
  const colours = colourSiblings(product, all)
  if (colours.length < 2) return null

  const shown = colours.slice(0, SHOW)
  const more = colours.length - shown.length

  function open(e, c) {
    // The card around this is a link to the shown colour; this goes to the
    // colour tapped instead.
    e.preventDefault()
    e.stopPropagation()
    navigate(`/product/${c.id}`)
  }

  return (
    <span className="cswatches" aria-label={`${colours.length} colours`}>
      {shown.map((c) => (
        <span
          key={c.id}
          role="link"
          tabIndex={0}
          title={c.variant}
          aria-label={c.variant}
          className={`cswatch ${c.id === product.id ? 'on' : ''}`}
          onClick={(e) => open(e, c)}
          onKeyDown={(e) => { if (e.key === 'Enter') open(e, c) }}
        >
          {c.images?.[0] && <img src={imgUrl(c.images[0], { w: 80, h: 80 })} alt="" loading="lazy" />}
        </span>
      ))}
      {more > 0 && <span className="cswatch-more mono">+{more}</span>}
      <span className="cswatch-count mono">{colours.length} colours</span>
    </span>
  )
}
