/**
 * Document text extraction for PDFs, DOCX, and other formats
 * Used by chat upload endpoint to extract readable text from documents
 * so the AI can analyze document contents directly.
 */

import pdfParse from 'pdf-parse'
import mammoth from 'mammoth'

/**
 * Extract text from a document buffer
 * @param {Buffer} buffer - Document file buffer
 * @param {string} mimeType - MIME type of the document
 * @param {string} filename - Original filename (for extension fallback)
 * @returns {Promise<{text: string, metadata?: object}>}
 */
export async function extractDocumentText(buffer, mimeType, filename) {
  const ext = filename.split('.').pop()?.toLowerCase()
  
  try {
    // PDF extraction
    if (mimeType === 'application/pdf' || ext === 'pdf') {
      const data = await pdfParse(buffer)
      return {
        text: data.text,
        metadata: {
          pages: data.numpages,
          info: data.info,
        }
      }
    }
    
    // DOCX extraction
    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === 'docx'
    ) {
      const result = await mammoth.extractRawText({ buffer })
      return {
        text: result.value,
        metadata: {
          messages: result.messages,
        }
      }
    }
    
    // DOC (legacy Word) - mammoth can handle some .doc files
    if (mimeType === 'application/msword' || ext === 'doc') {
      try {
        const result = await mammoth.extractRawText({ buffer })
        return {
          text: result.value,
          metadata: {
            messages: result.messages,
            legacy: true,
          }
        }
      } catch (err) {
        return {
          text: `[Could not extract text from legacy .doc file: ${err.message}]`,
          metadata: { error: err.message }
        }
      }
    }
    
    // RTF - try as plain text (basic support)
    if (mimeType === 'application/rtf' || mimeType === 'text/rtf' || ext === 'rtf') {
      const text = buffer.toString('utf-8')
      // Strip RTF control codes (basic cleanup)
      const cleaned = text
        .replace(/\\[a-z]+\d*\s?/g, ' ') // Remove RTF commands
        .replace(/[{}]/g, '') // Remove braces
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim()
      return {
        text: cleaned,
        metadata: { format: 'rtf', basic_extraction: true }
      }
    }
    
    // Excel, PowerPoint, etc. - not yet supported
    if (
      ext === 'xlsx' || ext === 'xls' ||
      ext === 'pptx' || ext === 'ppt' ||
      ext === 'odt' || ext === 'ods' || ext === 'odp'
    ) {
      return {
        text: `[${ext.toUpperCase()} file uploaded: ${filename}. Text extraction for this format is not yet supported. The file has been saved to the project.]`,
        metadata: { unsupported_format: ext }
      }
    }
    
    // Unknown format
    return {
      text: `[Document uploaded: ${filename}. Format not recognized for text extraction.]`,
      metadata: { unknown_format: true }
    }
    
  } catch (err) {
    console.error('[DocumentExtractor] Extraction failed:', err)
    return {
      text: `[Document uploaded: ${filename}. Text extraction failed: ${err.message}]`,
      metadata: { error: err.message }
    }
  }
}

/**
 * Check if a file type supports text extraction
 * @param {string} mimeType
 * @param {string} filename
 * @returns {boolean}
 */
export function supportsTextExtraction(mimeType, filename) {
  const ext = filename.split('.').pop()?.toLowerCase()
  const supportedExts = ['pdf', 'docx', 'doc', 'rtf']
  const supportedMimes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/rtf',
    'text/rtf',
  ]
  
  return supportedExts.includes(ext) || supportedMimes.includes(mimeType)
}
