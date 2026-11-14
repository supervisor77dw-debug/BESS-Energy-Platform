// Providerneutraler E-Mail-Versand (AW-STROMKAI-20261031-CONSOLIDATION-ACQUISITION-020) – vorbereitet, NICHT aktiv.
// Grundsatz: Es entsteht nie der Eindruck eines Versands, der nicht stattgefunden hat. Jede Portalbenachrichtigung erzeugt
// einen Outbox-Eintrag mit ehrlichem Status:
//   nicht_eingerichtet – kein freigegebener Versandweg; es wurde keine E-Mail versandt (Endstatus, wird nie nachträglich versandt)
//   wartend            – Versandweg aktiv, Versuch steht aus
//   versandt           – Transport hat den Empfang bestätigt
//   fehler             – Versuch fehlgeschlagen (Fehlertext, Versuche, nächster Versuch); nach MAX_VERSUCHE endgültig
// Konfiguration ausschließlich über Umgebungsvariablen (keine Werte im Code, keine erfundenen Absender):
//   BESS_MAIL_AKTIV=1, BESS_SMTP_HOST, BESS_SMTP_PORT, BESS_SMTP_USER, BESS_SMTP_PASS (geheim), BESS_MAIL_FROM
// Ein Transport (z. B. SMTP über Synology MailPlus) wird später über registriereTransport() angebunden; bis dahin ist der
// Versandweg nie aktiv, auch wenn Variablen gesetzt sind.
import { randomBytes } from 'node:crypto';

export const MAX_VERSUCHE = 3;
let transport = null; // async ({ an, betreff, text, von }) => { messageId }

export function registriereTransport(fn) { transport = fn; }
export function mailKonfig(env = process.env) {
  const k = { aktivGesetzt: env.BESS_MAIL_AKTIV === '1', host: env.BESS_SMTP_HOST || '', port: Number(env.BESS_SMTP_PORT || 0) || null, user: env.BESS_SMTP_USER || '', passGesetzt: !!env.BESS_SMTP_PASS, von: env.BESS_MAIL_FROM || '' };
  const fehlend = [!k.aktivGesetzt && 'BESS_MAIL_AKTIV', !k.host && 'BESS_SMTP_HOST', !k.von && 'BESS_MAIL_FROM', !transport && 'Transport (nicht implementiert/freigegeben)'].filter(Boolean);
  return { ...k, aktiv: fehlend.length === 0, fehlend };
}
export const STATUS_TEXT = {
  nicht_eingerichtet: 'Keine E-Mail versandt – Versandweg nicht eingerichtet',
  wartend: 'E-Mail wartet auf Versand',
  versandt: 'E-Mail versandt',
  fehler: 'E-Mail-Versand fehlgeschlagen',
};

// Outbox-Eintrag zu einer Benachrichtigung (je Benachrichtigung höchstens einer)
export function inOutbox(db, n) {
  db.outbox ??= [];
  if (db.outbox.some((o) => o.benachrichtigungId === n.id)) return null;
  const k = mailKonfig();
  const o = { id: `ob-${randomBytes(6).toString('hex')}`, benachrichtigungId: n.id, kanal: 'email', empfaengerId: n.userId, betreff: n.text.slice(0, 140), erstelltAm: n.at,
    status: k.aktiv ? 'wartend' : 'nicht_eingerichtet', versuche: 0, letzterFehler: k.aktiv ? null : `Nicht eingerichtet: ${k.fehlend.join(', ')}`, naechsterVersuch: k.aktiv ? n.at : null };
  db.outbox.push(o);
  return o;
}

// Versandlauf: nur wartende Einträge, nur mit aktivem Versandweg; Empfängeradresse aus dem Benutzerkonto, nie geraten.
export async function outboxVerarbeiten(db, jetzt = new Date()) {
  const k = mailKonfig();
  if (!k.aktiv) return { verarbeitet: 0, grund: 'nicht_eingerichtet' };
  let n = 0;
  for (const o of (db.outbox || []).filter((x) => (x.status === 'wartend' || (x.status === 'fehler' && x.versuche < MAX_VERSUCHE)) && (!x.naechsterVersuch || x.naechsterVersuch <= jetzt.toISOString()))) {
    const u = db.users.find((x) => x.id === o.empfaengerId && x.active);
    o.versuche += 1; n += 1;
    if (!u?.email) { o.status = 'fehler'; o.letzterFehler = 'Empfänger ohne E-Mail-Adresse oder gesperrt'; o.versuche = MAX_VERSUCHE; continue; }
    try {
      const r = await transport({ an: u.email, von: k.von, betreff: o.betreff, text: o.betreff });
      o.status = 'versandt'; o.versandtAm = new Date().toISOString(); o.messageId = r?.messageId || null; o.letzterFehler = null;
    } catch (e) {
      o.status = 'fehler'; o.letzterFehler = String(e?.message || e).slice(0, 300);
      o.naechsterVersuch = new Date(jetzt.getTime() + 2 ** o.versuche * 5 * 60000).toISOString();
    }
  }
  return { verarbeitet: n };
}
