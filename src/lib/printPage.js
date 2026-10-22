import reportCss from '../components/investor-report.css?raw'

// A report printed on a page of its own: a new tab holding only the report
// (A4, 12 mm margins, the report's own styles — nothing of the admin's
// layout, which could crop it), with the print dialog opened once the
// fonts are in and a Save as PDF button left on screen for another go.
// Returns false when the browser blocked the new tab.

const PAGE_CSS = `
@page { size: A4; margin: 12mm; }
html, body { margin: 0; background: #fff; }
body { font-family: 'Inter', sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ir-paper { max-width: none !important; min-width: 0 !important; width: auto !important; box-shadow: none !important; border-radius: 0 !important; padding: 0 !important; }
.ir-tools { font-family: 'Inter', sans-serif; display: flex; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap; padding: 14px 16px; background: #111; color: #fff; font-size: 13px; position: sticky; top: 0; z-index: 2; }
.ir-tools button { background: #2a4dff; color: #fff; border: 0; border-radius: 999px; padding: 10px 18px; font: inherit; font-weight: 700; cursor: pointer; }
@media screen {
  body { background: #ececea; }
  .ir-sheet { max-width: 794px; margin: 16px auto; background: #fff; padding: 12mm; box-sizing: border-box; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
}
@media screen and (max-width: 600px) {
  .ir-sheet { margin: 0; padding: 16px; }
  .ir-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .ir-cols { grid-template-columns: 1fr !important; }
}
@media print {
  .ir-tools { display: none !important; }
  .ir-sheet { padding: 0; margin: 0; }
  .ir-head, .ir-note, .ir-kpis, .ir-kpi, .ir-block, .ir-cols { break-inside: avoid; page-break-inside: avoid; }
  .ir-orders, .ir-long { break-inside: auto; page-break-inside: auto; }
  .ir-table tr { break-inside: avoid; page-break-inside: avoid; }
  .ir-table thead { display: table-header-group; }
  .ir-label { break-after: avoid; page-break-after: avoid; }
}
`

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function openPrintPage({ title, html }) {
  const w = html ? window.open('', '_blank') : null
  if (!w) return false

  const fonts = [...document.querySelectorAll('link[rel="stylesheet"][href*="fonts.googleapis"]')]
    .map((l) => `<link rel="stylesheet" href="${l.href}">`)
    .join('')
  w.document.open()
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>${fonts}
<style>${reportCss}${PAGE_CSS}</style></head>
<body><div class="ir-tools"><span>Press the button, then choose “Save as PDF”.</span><button type="button" onclick="window.print()">Save as PDF</button></div>
<div class="ir-sheet">${html}</div></body></html>`)
  w.document.close()

  // Print once the fonts are in, so the PDF isn't set in a fallback face.
  let fired = false
  const go = () => {
    if (fired) return
    fired = true
    w.focus()
    w.print()
  }
  const ready = () => (w.document.fonts?.ready || Promise.resolve()).then(() => setTimeout(go, 200))
  if (w.document.readyState === 'complete') ready()
  else w.addEventListener('load', ready)
  setTimeout(go, 3000)
  return true
}
