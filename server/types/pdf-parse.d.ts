declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
    numpages?: number;
    info?: Record<string, unknown>;
    metadata?: unknown;
  }

  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;

  export default pdfParse;
}
