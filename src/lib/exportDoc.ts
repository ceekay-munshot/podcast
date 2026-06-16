// Word (.doc) export — Word-compatible HTML with real @page margins, so the
// download opens directly in Word / Pages / Google Docs with clean, well-spaced
// formatting. No HTML file, no print dialog, no iframe — which sidesteps the
// missing-margins and PDF-embedding issues of the old print path.
//
// Word's HTML engine has no flexbox/grid/CSS-counters, so every layout here uses
// tables, inline, or plain blocks, and all numbering is literal text.

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
  return `<table class="brand" role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td class="mark"><span class="logo">&#10022;</span> Munshot</td>
      <td class="kicker-cell"><span class="kicker">${esc(kicker)}</span></td>
    </tr></table>`
}

export function section(num: string, title: string, body: string): string {
  if (!body) return ''
  return `<div class="block"><p class="h2"><span class="num">${num}</span>&nbsp;&nbsp;${esc(title)}</p>${body}</div>`
}

export function chips(items: string[]): string {
  if (!items.length) return ''
  return `<p class="chips">${items.map((i) => `<span class="chip">${esc(i)}</span>`).join(' ')}</p>`
}

const DOC_CSS = `
  @page WordSection1 { size: A4; margin: 2cm 2.2cm 2.4cm 2.2cm; }
  div.WordSection1 { page: WordSection1; }

  body {
    font-family: Calibri, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 11pt; line-height: 1.5; color: #1e293b;
  }
  p { margin: 0 0 9pt; }
  strong, b { font-weight: 700; color: #0f172a; }
  a { color: #2563eb; text-decoration: none; }

  table.brand { width: 100%; margin-bottom: 16pt; }
  .brand .mark { font-size: 13pt; font-weight: 800; color: #0f172a; }
  .brand .logo { color: #2563eb; }
  .brand .kicker-cell { text-align: right; }
  .kicker {
    font-size: 8pt; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
    color: #2563eb; background: #eff5ff; padding: 4pt 9pt;
  }

  .show { margin: 0 0 4pt; font-size: 10pt; font-weight: 700; color: #64748b; }
  h1 { margin: 0 0 8pt; font-size: 23pt; line-height: 1.15; font-weight: 800; color: #0f172a; }
  .meta { margin: 0; font-size: 9.5pt; color: #64748b; }
  .meta .dot { color: #cbd5e1; font-style: normal; padding: 0 5pt; }
  .rule { border: 0; border-top: 1px solid #e7e9ee; margin: 16pt 0 4pt; }

  .block { margin-top: 22pt; }
  .h2 {
    margin: 0 0 11pt; font-size: 10pt; font-weight: 800; letter-spacing: 1.2px;
    text-transform: uppercase; color: #475569;
  }
  .num { color: #2563eb; font-weight: 800; }

  .prose p { margin: 0 0 11pt; }

  .tk { border: 1px solid #e7e9ee; padding: 11pt 13pt; margin-bottom: 8pt; }
  .t-title { margin: 0 0 3pt; font-size: 11.5pt; font-weight: 700; color: #0f172a; }
  .t-num { color: #2563eb; font-weight: 800; font-size: 9.5pt; }
  .t-detail { margin: 0; font-size: 10.5pt; color: #475569; }

  .qa-item { padding: 11pt 0; border-bottom: 1px solid #e7e9ee; }
  .q { margin: 0 0 5pt; font-size: 11.5pt; font-weight: 700; color: #0f172a; }
  .qb { background: #2563eb; color: #ffffff; font-weight: 800; font-size: 9pt; padding: 1pt 6pt; }
  .a { margin: 0 0 0 6pt; font-size: 10.5pt; color: #475569; }

  .moment { border: 1px solid #e7e9ee; border-left: 3px solid #2563eb; padding: 11pt 13pt; margin-bottom: 8pt; }
  .m-title { margin: 0 0 3pt; font-size: 11.5pt; font-weight: 700; color: #0f172a; }
  .ts { color: #2563eb; background: #eff5ff; font-weight: 700; font-size: 9pt; padding: 1pt 6pt; }
  .m-why { margin: 0; font-size: 10.5pt; color: #475569; }

  .chips { margin: 0; line-height: 2.1; }
  .chip { font-size: 9.5pt; font-weight: 600; color: #2563eb; background: #eff5ff; border: 1px solid #dbeafe; padding: 2pt 9pt; white-space: nowrap; }
  .subhead { margin: 0 0 6pt; font-size: 8.5pt; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: #64748b; }

  .show-block { margin: 0 0 16pt; }
  .show-head { margin: 18pt 0 9pt; font-size: 13pt; font-weight: 800; color: #0f172a; }
  .show-head .show-count { font-size: 9.5pt; font-weight: 600; color: #64748b; }
  .show-block .subhead { margin-top: 11pt; }

  .idea { border: 1px solid #e7e9ee; border-left: 3px solid #2563eb; padding: 10pt 13pt; margin-bottom: 7pt; }
  .idea-title { margin: 0 0 3pt; font-size: 11.5pt; font-weight: 700; color: #0f172a; }
  .idea-kind { font-size: 8pt; font-weight: 800; letter-spacing: .5px; text-transform: uppercase; color: #2563eb; background: #eff5ff; padding: 1pt 5pt; margin-right: 5pt; }
  .idea-who { margin: 0 0 4pt; font-size: 9.5pt; color: #64748b; }
  .thesis { margin: 4pt 0 0; padding-left: 16pt; }
  .thesis li { font-size: 10pt; color: #475569; margin: 0 0 2pt; }

  .tlist { margin: 0 0 4pt; padding-left: 16pt; }
  .tlist li { font-size: 10.5pt; color: #475569; margin: 0 0 3pt; }

  .quote { border-left: 3px solid #2563eb; background: #eff5ff; padding: 13pt 15pt; }
  .quote .qt { margin: 0 0 5pt; font-size: 12.5pt; font-weight: 700; color: #0f172a; }
  .quote .ql { margin: 0 0 7pt; font-size: 12pt; font-style: italic; color: #1e293b; }
  .quote .who { margin: 0; font-size: 10pt; font-weight: 700; color: #0f172a; }
  .quote .role { font-weight: 400; color: #64748b; }

  .callout { border: 1px solid #e7e9ee; border-left: 3px solid #94a3b8; padding: 10pt 13pt; margin-bottom: 7pt; font-size: 10.5pt; color: #475569; }

  table.cols { width: 100%; }
  table.cols td { vertical-align: top; width: 50%; padding-right: 14pt; }

  table.srcs { width: 100%; }
  table.srcs td { padding: 7pt 0; border-bottom: 1px solid #e7e9ee; font-size: 10.5pt; vertical-align: top; }
  table.srcs .src-show { text-align: right; color: #64748b; font-size: 9.5pt; white-space: nowrap; }

  table.foot { width: 100%; margin-top: 26pt; border-top: 1px solid #e7e9ee; }
  table.foot td { padding-top: 11pt; font-size: 8.5pt; color: #94a3b8; }
  table.foot .foot-r { text-align: right; }
  table.foot b { color: #2563eb; }
`

// Two-cell footer used by every document.
export function docFooter(left: string, right: string): string {
  return `<table class="foot" role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td>${left}</td>
      <td class="foot-r">${esc(right)}</td>
    </tr></table>`
}

// Wrap a document body in the Word-compatible HTML shell.
export function wordShell(title: string, inner: string): string {
  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<meta name="ProgId" content="Word.Document" />
<title>${esc(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>${DOC_CSS}</style>
</head>
<body><div class="WordSection1">${inner}</div></body>
</html>`
}

// Download a Word document directly. A leading BOM helps Word detect UTF-8.
export function downloadWord(filename: string, html: string): void {
  const name = filename.endsWith('.doc') ? filename : `${filename}.doc`
  const blob = new Blob(['﻿', html], { type: 'application/msword' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
