import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { fetchHeroVideo, saveSetting } from '../lib/siteSettings.js'
import AdminBox from './AdminBox.jsx'
import InfoTip from './InfoTip.jsx'

const DEVICES = [
  { key: 'pc', label: 'PC', shape: 'Landscape 16:9 — 1920 × 1080', ratio: '16 / 9' },
  { key: 'mobile', label: 'Phone', shape: 'Portrait 9:16 — 1080 × 1920', ratio: '9 / 16' },
]

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`

// Admin → Website → Homepage → Hero video. A looping, silent video in place
// of the hero photos — one for PCs and one for phones. Upload a file (to the
// `videos` bucket, supabase-migration-hero-video.sql) or paste a link.
export default function HeroVideoManager() {
  const [video, setVideo] = useState({ pc: null, mobile: null })
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState({})
  const [links, setLinks] = useState({ pc: '', mobile: '' })

  useEffect(() => { fetchHeroVideo().then(({ video }) => setVideo(video)) }, [])

  async function save(next, device, msg) {
    const { error } = await saveSetting('hero_video', next)
    if (error) return setNote({ [device]: "Couldn't save — has supabase-migration-site-settings.sql been run?" })
    setVideo(next)
    setNote({ [device]: msg })
  }

  async function upload(device, file) {
    if (!/^video\/(mp4|webm|quicktime)$/.test(file.type)) return setNote({ [device]: 'Pick an MP4 (best), WebM or MOV video.' })
    if (file.size > 50 * 1048576) return setNote({ [device]: `That's ${mb(file.size)} — the limit is 50 MB. Shorten or compress it first.` })
    setBusy(device)
    setNote({ [device]: `Uploading ${mb(file.size)}…` })
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
    const path = `hero/${device}-${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('videos').upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false })
    if (error) {
      setBusy('')
      return setNote({ [device]: /bucket|not found/i.test(error.message) ? 'Run supabase-migration-hero-video.sql in Supabase first.' : `Couldn't upload: ${error.message}` })
    }
    const url = supabase.storage.from('videos').getPublicUrl(path).data.publicUrl
    await save({ ...video, [device]: { url } }, device, file.size > 8 * 1048576 ? `Live — but ${mb(file.size)} is heavy for a phone; 3–8 MB is better.` : 'Live on the homepage now.')
    setBusy('')
  }

  return (
    <AdminBox
      wide
      title="HERO VIDEO"
      tip={
        <>
          <p>A looping, silent video at the top of the homepage instead of the photos. One for PCs, one for phones — a screen without its own uses the other's. Remove both to go back to the photos.</p>
          <p><b>Make it light:</b> 5–15 seconds, no sound, MP4, 3–8 MB. Every visitor downloads it, and the free Supabase plan has 5 GB of downloads a month for the whole site.</p>
          <p>While it loads (and for visitors who've asked their phone for less motion) the first hero photo shows instead.</p>
        </>
      }
    >
      <div className="hv-grid">
        {DEVICES.map((d) => {
          const v = video[d.key]
          return (
            <div className="hv-card" key={d.key}>
              <div className="hv-head mono">
                FOR {d.label.toUpperCase()}
                <InfoTip>{d.shape}. {d.key === 'mobile' ? 'Shot upright on a phone works best.' : 'A wide shot; the middle stays in frame on any screen.'}</InfoTip>
              </div>
              <div className="hv-frame" style={{ aspectRatio: d.ratio }}>
                {v ? <video src={v.url} muted loop autoPlay playsInline /> : <span className="mono">No video — photos show</span>}
              </div>
              <div className="hv-actions">
                <label className={`ab-btn ${busy ? 'disabled' : ''}`}>
                  {busy === d.key ? 'Uploading…' : v ? 'Replace video' : '+ Upload video'}
                  <input type="file" accept="video/mp4,video/webm,video/quicktime" hidden disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(d.key, f) }} />
                </label>
                {v && <button type="button" className="ab-btn ghost" disabled={!!busy} onClick={() => save({ ...video, [d.key]: null }, d.key, 'Removed — photos show again.')}>Remove</button>}
              </div>
              <div className="hv-link">
                <input className="ab-input" value={links[d.key]} onChange={(e) => setLinks({ ...links, [d.key]: e.target.value })} placeholder="…or paste a video link (https://…mp4)" />
                <button type="button" className="ab-btn ghost" disabled={!/^https:\/\/\S+$/.test(links[d.key].trim())} onClick={() => { save({ ...video, [d.key]: { url: links[d.key].trim() } }, d.key, 'Live on the homepage now.'); setLinks({ ...links, [d.key]: '' }) }}>Use link</button>
              </div>
              {note[d.key] && <div className="ab-note mono">{note[d.key]}</div>}
            </div>
          )
        })}
      </div>
    </AdminBox>
  )
}
