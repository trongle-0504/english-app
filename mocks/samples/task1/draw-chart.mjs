// Draws mocks/samples/task1/bar-001-chart.png: the made-up bar chart the Task 1 sample texts and fixtures describe.
// Run from the repo root: node mocks/samples/task1/draw-chart.mjs
import path from 'node:path'
import sharp from 'sharp'

const out = path.join(import.meta.dirname, 'bar-001-chart.png')
const cats = ['Social welfare', 'Health', 'Education', 'Environment', 'Wildlife', 'Arts']
const data = [[40, 45, 50], [30, 32, 35], [25, 28, 30], [15, 18, 22], [10, 12, 9], [5, 6, 4]]
const colors = ['#2563eb', '#16a34a', '#f59e0b']
const years = ['2012', '2013', '2014']
let bars = ''
cats.forEach((cat, i) => {
  data[i].forEach((v, j) => {
    const x = 100 + i * 135 + j * 34
    const h = v * 7
    bars += `<rect x="${x}" y="${470 - h}" width="30" height="${h}" fill="${colors[j]}"/><text x="${x + 15}" y="${464 - h}" font-size="12" text-anchor="middle" fill="#111">${v}</text>`
  })
  bars += `<text x="${100 + i * 135 + 49}" y="494" font-size="14" text-anchor="middle" fill="#111">${cat}</text>`
})
const grid = [0, 10, 20, 30, 40, 50]
  .map((v) => `<line x1="80" x2="900" y1="${470 - v * 7}" y2="${470 - v * 7}" stroke="#e5e7eb"/><text x="70" y="${474 - v * 7}" font-size="12" text-anchor="end" fill="#444">${v}</text>`)
  .join('')
const legend = years.map((y, j) => `<rect x="760" y="${70 + j * 24}" width="16" height="16" fill="${colors[j]}"/><text x="784" y="${83 + j * 24}" font-size="14" fill="#111">${y}</text>`).join('')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="940" height="540" font-family="Arial, sans-serif">
<rect width="100%" height="100%" fill="#fff"/>
<text x="470" y="36" font-size="20" font-weight="bold" text-anchor="middle" fill="#111">Company donations to six charities, 2012–2014</text>
<text x="20" y="270" font-size="13" fill="#444" transform="rotate(-90 20 270)" text-anchor="middle">$ thousand</text>
${grid}<line x1="80" x2="900" y1="470" y2="470" stroke="#333"/>${bars}${legend}</svg>`
await sharp(Buffer.from(svg)).png().toFile(out)
console.log(`wrote ${out}`)
