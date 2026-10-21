// pdfmake 0.3 ships no types: the part server/report-pdf.ts uses.
declare module 'pdfmake' {
  interface OutputDocument {
    getBuffer(): Promise<Buffer>
  }
  interface PdfMake {
    setFonts(fonts: Record<string, { normal: string; bold: string; italics: string; bolditalics: string }>): void
    setLocalAccessPolicy(callback: (path: string) => boolean): void
    setUrlAccessPolicy(callback: (url: string) => boolean): void
    createPdf(docDefinition: object): OutputDocument
  }
  const pdfmake: PdfMake
  export default pdfmake
}
