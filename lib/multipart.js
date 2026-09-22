/**
 * lib/multipart.js — Lightweight, zero-dependency multipart/form-data parser for Node.js.
 */

export function parseMultipart(buffer, contentTypeHeader) {
  const match = (contentTypeHeader || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    throw new Error('Missing or invalid boundary in Content-Type header');
  }
  const boundary = match[1] || match[2];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const endBoundaryBuffer = Buffer.from(`--${boundary}--`);

  const files = [];
  const fields = {};

  let start = buffer.indexOf(boundaryBuffer);
  if (start === -1) return { fields, files };

  while (start !== -1) {
    start += boundaryBuffer.length;
    // If ending boundary
    if (buffer.slice(start, start + 2).toString() === '--') break;
    // Skip CRLF
    if (buffer.slice(start, start + 2).toString() === '\r\n') start += 2;

    const nextBoundary = buffer.indexOf(boundaryBuffer, start);
    if (nextBoundary === -1) break;

    // The part content is between start and nextBoundary - 2 (to trim trailing CRLF)
    const partEnd = nextBoundary - 2 >= start ? nextBoundary - 2 : nextBoundary;
    const partBuffer = buffer.slice(start, partEnd);

    // Split headers and body at \r\n\r\n
    const headerEnd = partBuffer.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerString = partBuffer.slice(0, headerEnd).toString('utf-8');
      const body = partBuffer.slice(headerEnd + 4);

      // Parse headers
      const headers = {};
      for (const line of headerString.split('\r\n')) {
        const colon = line.indexOf(':');
        if (colon !== -1) {
          headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
        }
      }

      const disposition = headers['content-disposition'] || '';
      const nameMatch = disposition.match(/name="([^"]+)"/i);
      const filenameMatch = disposition.match(/filename="([^"]+)"/i);

      const fieldName = nameMatch ? nameMatch[1] : '';
      const filename = filenameMatch ? filenameMatch[1] : null;

      if (filename) {
        files.push({
          fieldName,
          filename,
          contentType: headers['content-type'] || 'application/octet-stream',
          data: body
        });
      } else if (fieldName) {
        fields[fieldName] = body.toString('utf-8');
      }
    }

    start = nextBoundary;
  }

  return { fields, files };
}
