import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'

// A one-time job, shown only while photos are still on Cloudinary: copies
// them into Supabase Storage and repoints the products, hero slides and
// about blocks at the copies (edge function migrate-images-to-storage). It
// works a batch at a time, so this keeps calling until nothing is left;
// a photo that can't be copied is listed and left where it was.
async function call(body) {
  const { data, error } = await supabase.functions.invoke('migrate-images-to-storage', { body })
  if (error) {
    let detail = error.message
    try {
      const b = await error.context?.json()
      if (b?.error) detail = b.error
    } catch {
      // Not JSON — the generic message is all there is.
    }
    throw new Error(detail)
  }
  return data
}

export default function ImageMigration({ onDone }) {
  const [remaining, setRemaining] = useState(null)
  const [running, setRunning] = useState(false)
  const [moved, setMoved] = useState(0)
  const [failed, setFailed] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    // Not deployed yet, or nothing to do — either way, nothing to show.
    call({ dryRun: true })
      .then((d) => setRemaining(d?.remaining ?? 0))
      .catch(() => setRemaining(0))
  }, [])

  async function run() {
    setRunning(true)
    setError('')
    const failedUrls = []

    try {
      for (;;) {
        const d = await call({ skip: failedUrls })
        setMoved((n) => n + d.moved)
        failedUrls.push(...d.failed.map((f) => f.url))
        setFailed((prev) => [...prev, ...d.failed])
        setRemaining(d.remaining)
        if (d.left === 0) break
      }
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  if (!remaining && moved === 0) return null

  return (
    <div className="panel-note mono" style={{ marginBottom: '14px', lineHeight: 1.7 }}>
      {remaining > 0 ? (
        <>
          {remaining} photo{remaining === 1 ? '' : 's'} still on Cloudinary.{' '}
          <button className="add-product mono" onClick={run} disabled={running} style={{ marginLeft: '8px' }}>
            {running ? `Moving… ${moved} done` : 'Move images to Supabase'}
          </button>
        </>
      ) : (
        <>All photos are on Supabase now — {moved} moved. Cloudinary is no longer used.</>
      )}

      {failed.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          Couldn't copy {failed.length} (left on Cloudinary, still showing):
          {failed.map((f) => (
            <div key={f.url} style={{ wordBreak: 'break-all', opacity: 0.75 }}>
              {f.url} — {f.reason}
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ marginTop: '8px', color: 'var(--signal)' }}>{error}</div>}
    </div>
  )
}
