// Shared chrome for exported documents (episode + weekly summaries): one
// stylesheet, one shell, and the download / print-to-PDF actions — so every
// export looks identical and, crucially, prints a clean standalone document
// rather than the surrounding app page.

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Escape first, then promote **bold** markup to <strong> (mirrors the in-app renderer).
export function inline(s: string): string {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

export function sanitizeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
}

export function brandHeader(kicker: string): string {
  return `<div class="brand"><span class="mark"><b>✦</b> Munshot</span><span class="kicker">${esc(kicker)}</span></div>`
}

export function section(num: string, title: string, body: string): string {
  if (!body) return ''
  return `<section class="block"><h2><span class="num">${num}</span>${esc(title)}</h2>${body}</section>`
}

export function chips(items: string[]): string {
  if (!items.length) return ''
  return `<div class="chips">${items.map((i) => `<span class="chip">${esc(i)}</span>`).join('')}</div>`
}

const DOC_CSS = `
  :root {
    --ink: #0f172a; --muted: #475569; --faint: #64748b;
    --brand: #2563eb; --brand-soft: #eff5ff; --hair: #e7e9ee;
    --paper: #ffffff; --wash: #f6f7f9;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; background: var(--wash); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.65; font-size: 16px;
  }
  .page { max-width: 760px; margin: 0 auto; padding: 56px 28px 80px; }
  .sheet {
    background: var(--paper); border: 1px solid var(--hair); border-radius: 20px;
    padding: 52px 56px 56px; box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 12px 40px rgba(15,23,42,.06);
  }

  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 30px; }
  .mark { font-weight: 800; letter-spacing: -.02em; color: var(--ink); font-size: 16px; }
  .mark b { color: var(--brand); }
  .kicker {
    margin-left: auto; font-size: 11px; font-weight: 700; letter-spacing: .12em;
    text-transform: uppercase; color: var(--brand); background: var(--brand-soft);
    padding: 5px 10px; border-radius: 999px;
  }
  .show { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--faint); }
  h1 { margin: 0 0 14px; font-size: 30px; line-height: 1.18; letter-spacing: -.02em; font-weight: 800; }
  .meta { margin: 0 0 4px; font-size: 13px; color: var(--faint); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .meta .dot { color: #cbd5e1; font-style: normal; }
  .rule { height: 1px; background: var(--hair); border: 0; margin: 32px 0; }

  .block { margin: 34px 0 0; }
  h2 {
    display: flex; align-items: center; gap: 12px; margin: 0 0 16px;
    font-size: 13px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--muted);
  }
  .num {
    display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 8px;
    background: var(--brand-soft); color: var(--brand); font-size: 12px; font-weight: 800; letter-spacing: 0;
  }

  .prose p { margin: 0 0 14px; color: #1e293b; }
  .prose p:last-child { margin-bottom: 0; }
  .prose strong { font-weight: 700; color: var(--ink); }

  ol.takeaways { list-style: none; counter-reset: tk; margin: 0; padding: 0; }
  ol.takeaways li {
    counter-increment: tk; position: relative; padding: 16px 18px 16px 56px;
    border: 1px solid var(--hair); border-radius: 14px; margin-bottom: 10px; background: #fff;
  }
  ol.takeaways li::before {
    content: counter(tk, decimal-leading-zero); position: absolute; left: 16px; top: 16px;
    font-size: 13px; font-weight: 800; color: var(--brand);
  }
  .t-title { margin: 0 0 4px; font-weight: 700; font-size: 15px; }
  .t-detail { margin: 0; color: var(--muted); font-size: 14px; }

  .qa-item { padding: 16px 0; border-bottom: 1px solid var(--hair); }
  .qa-item:last-child { border-bottom: 0; padding-bottom: 0; }
  .q { margin: 0 0 8px; font-weight: 700; font-size: 15px; display: flex; gap: 10px; align-items: flex-start; }
  .q-badge {
    flex: none; width: 22px; height: 22px; border-radius: 6px; display: inline-grid; place-items: center;
    background: var(--brand); color: #fff; font-size: 12px; font-weight: 800; margin-top: 1px;
  }
  .a { margin: 0 0 0 32px; color: var(--muted); font-size: 14px; }

  .moment { padding: 16px 18px; border: 1px solid var(--hair); border-left: 3px solid var(--brand); border-radius: 12px; margin-bottom: 10px; }
  .m-head { display: flex; gap: 12px; align-items: baseline; margin-bottom: 6px; }
  .ts { flex: none; font-variant-numeric: tabular-nums; font-weight: 700; font-size: 12px; color: var(--brand); background: var(--brand-soft); padding: 3px 8px; border-radius: 6px; }
  .m-title { margin: 0; font-weight: 700; font-size: 15px; }
  .m-why { margin: 0; color: var(--muted); font-size: 14px; }

  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { font-size: 13px; font-weight: 600; color: var(--brand); background: var(--brand-soft); border: 1px solid #dbeafe; border-radius: 999px; padding: 5px 12px; }
  .subhead { margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }

  .quote { border-left: 3px solid var(--brand); background: var(--brand-soft); border-radius: 0 12px 12px 0; padding: 18px 20px; }
  .quote p { margin: 0 0 10px; font-size: 16px; font-style: italic; color: #1e293b; }
  .quote .who { font-style: normal; font-size: 13px; font-weight: 700; color: var(--ink); }
  .quote .role { font-style: normal; font-size: 12px; color: var(--faint); margin-left: 6px; }

  .callout { display: flex; gap: 11px; padding: 14px 16px; border: 1px solid var(--hair); border-radius: 12px; margin-bottom: 8px; color: var(--muted); font-size: 14px; }
  .callout::before { content: ''; flex: none; width: 6px; height: 6px; margin-top: 7px; border-radius: 999px; background: var(--brand); }

  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  @media (max-width: 560px) { .cols { grid-template-columns: 1fr; } }

  .srcs { list-style: none; margin: 0; padding: 0; }
  .srcs li { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--hair); font-size: 14px; }
  .srcs li:last-child { border-bottom: 0; }
  .srcs .src-show { color: var(--faint); font-size: 13px; white-space: nowrap; }

  footer { margin-top: 44px; padding-top: 20px; border-top: 1px solid var(--hair); font-size: 12px; color: var(--faint); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  footer b { color: var(--brand); }

  .actions { position: fixed; top: 20px; right: 20px; }
  .print-btn {
    font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; color: #fff; background: var(--brand);
    border: 0; border-radius: 10px; padding: 10px 16px; box-shadow: 0 6px 20px rgba(37,99,235,.35);
  }
  .print-btn:hover { background: #1d4ed8; }

  @media print {
    body { background: #fff; }
    .page { padding: 0; max-width: none; }
    .sheet { border: 0; border-radius: 0; box-shadow: none; padding: 0; }
    .actions { display: none; }
    .block, ol.takeaways li, .moment, .qa-item, .callout, .quote { break-inside: avoid; }
    h2 { break-after: avoid; }
  }
`

// Wrap a document body (everything inside .sheet) in the standalone HTML shell.
export function docShell(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>${DOC_CSS}</style>
</head>
<body>
  <div class="actions"><button class="print-btn" onclick="window.print()">Save as PDF</button></div>
  <div class="page"><div class="sheet">${inner}</div></div>
</body>
</html>`
}

// Hand a document to the user as a downloaded .html file (self-contained, prints to PDF).
export function downloadDoc(filename: string, html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// Print just the document (via a hidden iframe) so "Export PDF" yields a clean
// PDF of the structured document — not a print of the surrounding app page.
export function printDoc(html: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'
  document.body.appendChild(frame)

  const cleanup = () => {
    if (document.body.contains(frame)) frame.remove()
  }

  frame.onload = () => {
    const win = frame.contentWindow
    if (!win) return cleanup()
    win.onafterprint = cleanup
    // Let styles/layout settle before invoking the print dialog.
    setTimeout(() => {
      win.focus()
      win.print()
    }, 60)
    // Safety net if onafterprint never fires (some browsers).
    setTimeout(cleanup, 60_000)
  }

  const doc = frame.contentWindow?.document
  if (!doc) return cleanup()
  doc.open()
  doc.write(html)
  doc.close()
}
