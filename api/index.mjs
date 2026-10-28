// Vercel-Funktion: alle Pfade (siehe vercel.json) laufen über den Plattform-Handler – einschließlich statischer
// Dateien, damit die Vorschau-Schranke auch Bilder und Skripte schützt.
import { vercelHandler } from '../server.mjs';

export default async function handler(req, res) {
  try {
    await vercelHandler(req, res);
  } catch (e) {
    console.error('Plattformstart fehlgeschlagen:', e?.message);
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('X-Robots-Tag', 'noindex');
      res.setHeader('Cache-Control', 'no-store');
      res.end('Die Plattform ist derzeit nicht verfügbar.');
    }
  }
}
