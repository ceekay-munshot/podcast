// Throwaway harness: render the section head + drop-cap lead exactly as the
// Holcim Overview did, to a PDF on disk, so we can eyeball the drop cap.
import { writeFileSync } from 'node:fs'
import { jsPDF } from 'jspdf'
import { Painter, renderBlocks, type Block } from '../src/lib/pdfRender'

const HOLCIM =
  "Holcim has successfully transitioned over one third of its sales to eco-friendly concrete and cement products, reflecting strong demand for sustainable construction materials and driving margin improvement through innovation. The company targets **CHF 200 million** in savings by 2028 through AI-driven operational efficiencies, illustrating a concrete application of technology to reduce costs and enhance competitiveness in a highly fragmented materials industry. Additionally, Holcim's strategic spin-off of its North American business sharpens its focus on Europe and Latin America—regions poised for growth."

const SECOND =
  "A second paragraph follows the lead to confirm spacing between stacked paragraphs still reads cleanly and the drop cap only governs the first one."

const blocks: Block[] = [
  { k: 'section', num: '01', title: 'Overview' },
  { k: 'lead', paras: [HOLCIM, SECOND] },
]

const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: false })
renderBlocks(new Painter(doc), blocks)
writeFileSync(process.argv[2] || 'scripts/lead.pdf', Buffer.from(doc.output('arraybuffer')))
console.log('wrote', process.argv[2] || 'scripts/lead.pdf')
