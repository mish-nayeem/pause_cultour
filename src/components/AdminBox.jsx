import InfoTip from './InfoTip.jsx'
import './admin-box.css'

// One box of an admin page: a title with its ⓘ (how to use it), something
// on the right of the title if needed (a count, a link), then the content.
// Lay several out with <div className="ab-grid"> (two to a row on a PC,
// one on a phone); `wide` spans the whole row.
export default function AdminBox({ title, tip, side, wide = false, className = '', children }) {
  return (
    <section className={`ab-box ${wide ? 'wide' : ''} ${className}`}>
      <div className="ab-head">
        <span className="ab-title mono">{title}</span>
        {tip && <InfoTip>{tip}</InfoTip>}
        {side && <span className="ab-side mono">{side}</span>}
      </div>
      {children}
    </section>
  )
}
