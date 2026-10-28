// Erzeugt einfache einseitige PDF-Dokumente für die synthetischen Vorschau-Unterlagen.
export function makePdf(title, lines, watermark = 'SYNTHETISCHES VORSCHAUDOKUMENT') {
  const escTxt = (s) => String(s).replace(/[\\()]/g, (c) => '\\' + c);
  let y = 780;
  const ops = ['BT /F1 18 Tf 56 ' + y + ' Td (' + escTxt(title) + ') Tj ET'];
  y -= 22;
  ops.push('BT /F1 9 Tf 0.6 0.25 0.1 rg 56 ' + y + ' Td (' + escTxt(watermark) + ') Tj ET');
  y -= 30;
  for (const l of lines) {
    ops.push('BT /F1 11 Tf 0 0 0 rg 56 ' + y + ' Td (' + escTxt(l) + ') Tj ET');
    y -= 17;
    if (y < 60) break;
  }
  ops.push('BT /F1 40 Tf 0.92 0.92 0.92 rg 1 0 0 1 120 300 Tm (VORSCHAU) Tj ET');
  const stream = Buffer.from(ops.join('\n'), 'latin1');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [];
  let len = parts[0].length;
  const push = (b) => { parts.push(b); len += b.length; };
  objs.forEach((o, i) => { offsets.push(len); push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')); });
  offsets.push(len);
  push(Buffer.from(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n`, 'latin1'));
  push(stream);
  push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
  const xref = len;
  let x = `xref\n0 6\n0000000000 65535 f \n`;
  for (const o of offsets) x += String(o).padStart(10, '0') + ' 00000 n \n';
  x += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(Buffer.from(x, 'latin1'));
  return Buffer.concat(parts);
}
