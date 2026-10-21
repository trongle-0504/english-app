// A report (src/features/report) written as a PDF file with pdfmake — plain JavaScript: no browser and no other program
// is started. The font comes from the machine and is embedded (subset) in the PDF: Arial from Windows' Fonts folder
// (also seen from WSL), else DejaVu Sans on Linux; both have every Vietnamese letter. REPORT_PDF_FONT_DIR can point to
// a folder with arial.ttf, arialbd.ttf, ariali.ttf and arialbi.ttf instead. Arial has no ✓: such marks use Segoe UI Symbol
// (Windows) or DejaVu Sans.
import { existsSync } from 'node:fs'
import path from 'node:path'
import pdfmake from 'pdfmake'
import type { ReportDoc } from '../src/features/report/model.ts'
import { pdfDefinition } from '../src/features/report/to-pdf.ts'
import { ApiError } from './api.ts'

type Faces = { normal: string; bold: string; italics: string; bolditalics: string }

/** The font files to embed, or null when none is found. */
function faces(): Faces | null {
  const arialIn = (dir: string): Faces => ({
    normal: path.join(dir, 'arial.ttf'),
    bold: path.join(dir, 'arialbd.ttf'),
    italics: path.join(dir, 'ariali.ttf'),
    bolditalics: path.join(dir, 'arialbi.ttf'),
  })
  const dejavu = '/usr/share/fonts/truetype/dejavu'
  const candidates: Faces[] = [
    ...(process.env.REPORT_PDF_FONT_DIR ? [arialIn(process.env.REPORT_PDF_FONT_DIR)] : []),
    arialIn('/mnt/c/Windows/Fonts'),
    arialIn('C:\\Windows\\Fonts'),
    // DejaVu Sans has no italic file here: italics fall back to the upright faces.
    {
      normal: path.join(dejavu, 'DejaVuSans.ttf'),
      bold: path.join(dejavu, 'DejaVuSans-Bold.ttf'),
      italics: path.join(dejavu, 'DejaVuSans.ttf'),
      bolditalics: path.join(dejavu, 'DejaVuSans-Bold.ttf'),
    },
  ]
  return candidates.find((f) => Object.values(f).every((file) => existsSync(file))) ?? null
}

/** A font with ✓ and the like (Arial has none): Segoe UI Symbol on Windows, else DejaVu Sans. */
const symbolFile = () =>
  [
    ...(process.env.REPORT_PDF_FONT_DIR ? [path.join(process.env.REPORT_PDF_FONT_DIR, 'seguisym.ttf')] : []),
    '/mnt/c/Windows/Fonts/seguisym.ttf',
    'C:\\Windows\\Fonts\\seguisym.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ].find((f) => existsSync(f))

/** The report as PDF bytes. */
export async function reportPdf(doc: ReportDoc): Promise<Buffer> {
  const files = faces()
  if (!files) throw new ApiError(503, 'Không tìm thấy font để tạo PDF (Arial của Windows hoặc DejaVu Sans). Đặt REPORT_PDF_FONT_DIR tới thư mục có arial.ttf.')
  const symbols = symbolFile()
  const fontFiles = new Set([...Object.values(files), ...(symbols ? [symbols] : [])])
  pdfmake.setFonts({ Report: files, ...(symbols ? { Symbols: { normal: symbols, bold: symbols, italics: symbols, bolditalics: symbols } } : {}) })
  // Only the font files may be read, and nothing is downloaded.
  pdfmake.setLocalAccessPolicy((file: string) => fontFiles.has(file))
  pdfmake.setUrlAccessPolicy(() => false)
  return pdfmake.createPdf(pdfDefinition(doc, 'Report', symbols ? 'Symbols' : undefined)).getBuffer()
}
