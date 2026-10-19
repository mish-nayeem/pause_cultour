import './focus-picker.css'

// Which part of the photo stays in frame when the screen crops it.
const FOCUS = [
  ['top', '↑', 'Top'],
  ['left', '←', 'Left'],
  ['center', '●', 'Middle'],
  ['right', '→', 'Right'],
  ['bottom', '↓', 'Bottom'],
]

// One row of arrows with the current choice named above it. Saved as the
// photo's focus, which the site uses as its object-position.
export default function FocusPicker({ value, disabled = false, onChange }) {
  const cur = value || 'center'
  const name = (FOCUS.find(([k]) => k === cur) || FOCUS[2])[2]
  return (
    <>
      <div className="focus-pick-label mono">KEEP IN FRAME · {name.toUpperCase()}</div>
      <div className="focus-pick mono" role="radiogroup" aria-label="Keep in frame">
        {FOCUS.map(([k, icon, label]) => (
          <button key={k} type="button" role="radio" title={label} aria-label={label} aria-checked={cur === k} className={cur === k ? 'on' : ''} disabled={disabled} onClick={() => onChange(k)}>
            {icon}
          </button>
        ))}
      </div>
    </>
  )
}
