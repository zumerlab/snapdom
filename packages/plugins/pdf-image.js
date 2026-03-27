/**
 * pdfImage - Official SnapDOM Plugin
 * Exports the capture as a PNG embedded in a downloadable PDF.
 *
 * @param {Object} [options]
 * @param {string} [options.orientation='portrait'] - 'portrait' | 'landscape'
 * @param {number} [options.quality=0.92] - JPEG quality (0-1)
 * @param {string} [options.filename='capture.pdf'] - Download filename
 * @returns {Object} SnapDOM plugin
 */
export function pdfImage(options = {}) {
  const {
    orientation = 'portrait',
    quality = 0.92,
    filename = 'capture.pdf',
  } = options;

  return {
    name: 'pdf-image',

    defineExports() {
      return {
        pdfImage: async (ctx) => {
          const img = new Image();
          img.src = ctx.export.url;
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

          const isLandscape = orientation === 'landscape';
          const pageW = isLandscape ? 841.89 : 595.28; // A4 in points
          const pageH = isLandscape ? 595.28 : 841.89;
          const margin = 40;
          const maxW = pageW - margin * 2;
          const maxH = pageH - margin * 2;
          const scale = Math.min(maxW / img.width, maxH / img.height, 1);
          const w = img.width * scale;
          const h = img.height * scale;
          const x = (pageW - w) / 2;
          const y = (pageH - h) / 2;

          // Get image as JPEG data
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          canvas.getContext('2d').drawImage(img, 0, 0);
          const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
          const jpegBase64 = jpegDataUrl.split(',')[1];
          const jpegBytes = atob(jpegBase64);
          const jpegLen = jpegBytes.length;

          const enc = new TextEncoder();
          const realOffsets = [];

          // Obj 1-3
          let textPart = '%PDF-1.4\n';
          realOffsets.push(textPart.length);
          textPart += '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
          realOffsets.push(textPart.length);
          textPart += '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
          realOffsets.push(textPart.length);
          textPart += `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 5 0 R /Resources << /XObject << /Img 4 0 R >> >> >>\nendobj\n`;

          // Obj 4 — image with binary JPEG stream
          realOffsets.push(textPart.length);
          const imgHeader = `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegLen} >>\nstream\n`;

          const imgHeaderBytes = enc.encode(imgHeader);
          const preImgBytes = enc.encode(textPart);

          const jpegBuf = new Uint8Array(jpegLen);
          for (let i = 0; i < jpegLen; i++) jpegBuf[i] = jpegBytes.charCodeAt(i);

          const afterImg = '\nendstream\nendobj\n';
          const afterImgBytes = enc.encode(afterImg);

          // Obj 5 — content stream
          const contentStr = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Img Do Q`;
          const obj5 = `5 0 obj\n<< /Length ${contentStr.length} >>\nstream\n${contentStr}\nendstream\nendobj\n`;
          const obj5Bytes = enc.encode(obj5);

          realOffsets.push(preImgBytes.length + imgHeaderBytes.length + jpegLen + afterImgBytes.length);

          // xref table
          const xrefOffset = preImgBytes.length + imgHeaderBytes.length + jpegLen + afterImgBytes.length + obj5Bytes.length;
          let xref = 'xref\n0 6\n0000000000 65535 f \n';
          for (let i = 0; i < 5; i++) {
            xref += `${String(realOffsets[i]).padStart(10, '0')} 00000 n \n`;
          }
          xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
          const xrefBytes = enc.encode(xref);

          // Combine all parts
          const totalLen = preImgBytes.length + imgHeaderBytes.length + jpegLen + afterImgBytes.length + obj5Bytes.length + xrefBytes.length;
          const pdfBuf = new Uint8Array(totalLen);
          let pos = 0;
          pdfBuf.set(preImgBytes, pos); pos += preImgBytes.length;
          pdfBuf.set(imgHeaderBytes, pos); pos += imgHeaderBytes.length;
          pdfBuf.set(jpegBuf, pos); pos += jpegLen;
          pdfBuf.set(afterImgBytes, pos); pos += afterImgBytes.length;
          pdfBuf.set(obj5Bytes, pos); pos += obj5Bytes.length;
          pdfBuf.set(xrefBytes, pos);

          const blob = new Blob([pdfBuf], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          return url;
        }
      };
    }
  };
}
