import './draft-note.css'

// "Unsaved draft restored" over a form that came back from useDraft, with a
// way to start fresh instead.
export default function DraftNote({ draft }) {
  if (!draft?.restoredAt) return null
  const when = new Date(draft.restoredAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return (
    <div className="draft-note mono" role="status">
      <span>↺ Picked up where you stopped — unsaved draft from {when}.</span>
      <button type="button" onClick={draft.discard}>Start fresh</button>
    </div>
  )
}
