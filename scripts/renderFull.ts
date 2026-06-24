// Throwaway harness: render the full weekly + a sample episode report to PDFs on
// disk so every page can be eyeballed for layout issues.
import { writeFileSync } from 'node:fs'
import { jsPDF } from 'jspdf'
import { Painter, renderBlocks, weeklyBlocks, episodeBlocks } from '../src/lib/pdfRender'
import { EPISODES, PODCASTS, WEEKLY } from '../src/lib/mock-data'

const episodeById = (id: string) => EPISODES.find((e) => e.id === id)
const podcastById = (id: string) => PODCASTS.find((p) => p.id === id)

function emit(blocks: any[], path: string) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: false })
  renderBlocks(new Painter(doc), blocks)
  writeFileSync(path, Buffer.from(doc.output('arraybuffer')))
  console.log('wrote', path)
}

emit(weeklyBlocks(WEEKLY, episodeById, podcastById), 'scripts/full-weekly.pdf')
const allin = EPISODES.find((e) => e.id === 'ep-allin-e184')!
emit(episodeBlocks(allin, podcastById(allin.podcastId)), 'scripts/full-episode.pdf')
