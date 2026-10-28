// Erzeugt den SYNTHETISCHEN Datenbestand im Speicher (keine Dateizugriffe) – genutzt von data/seed.mjs (lokal)
// und vom Bootstrap auf Vercel. Keine realen Personen, Flurstücke, Projekte oder Zahlen.
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/lib/auth.mjs';
import { makePdf } from '../src/lib/pdf.mjs';

export const DEMO_PASSWORD = 'Vorschau!Speicher-2026'; // nur lokale Entwicklungsvorschau, nie extern

export function buildSeed({ external = false } = {}) {
  const files = [];
  const T = '2026-10-28T09:00:00.000Z';
  const pw = hashPassword(DEMO_PASSWORD);
  const S = (s) => s; // Markierung: TOTP-Geheimnis (synthetisch)

  const users = [
    { id: 'u-admin', email: 'admin@demo.invalid', name: 'Dirk (Plattformadministration)', role: 'admin', mfa: true, totp: S('JBSWY3DPEHPK3PXPADMINAAAAAAAAAAA') },
    { id: 'u-pl', email: 'projektleitung@demo.invalid', name: 'Projektleitung (Demo)', role: 'projektleitung', mfa: true, totp: S('JBSWY3DPEHPK3PXPLEITUNGAAAAAAAAA'), projects: ['p-n01', 'p-n02'] },
    { id: 'u-markus', email: 'markus@demo.invalid', name: 'Markus (Vertriebskoordination Nord)', role: 'vertrieb_nord', mfa: true, totp: S('JBSWY3DPEHPK3PXPNORDAAAAAAAAAAAA') },
    { id: 'u-own-a', email: 'eigentuemer.a@demo.invalid', name: 'Eigentümer A (synthetisch)', role: 'eigentuemer', mfa: false, contactId: 'c-own-a' },
    { id: 'u-own-b', email: 'eigentuemer.b@demo.invalid', name: 'Eigentümerin B (synthetisch)', role: 'eigentuemer', mfa: false, contactId: 'c-own-b' },
    { id: 'u-inv-a', email: 'investor.a@demo.invalid', name: 'Investor A (synthetisch)', role: 'investor', mfa: true, totp: S('JBSWY3DPEHPK3PXPINVESTORAAAAAAAA') },
    { id: 'u-inv-b', email: 'investor.b@demo.invalid', name: 'Investor B (synthetisch)', role: 'investor', mfa: true, totp: S('JBSWY3DPEHPK3PXPINVESTORBBBBBBBB') },
    { id: 'u-kom', email: 'gemeinde@demo.invalid', name: 'Gemeinde Demo-Nord (synthetisch)', role: 'kommune', mfa: false, contactId: 'c-kom' },
    { id: 'u-tech', email: 'technik@demo.invalid', name: 'Technikpartner (synthetisch)', role: 'technik', mfa: false },
  ].map((u) => ({ active: true, pw, createdAt: T, ...u }));

  // Externer Vorschaumodus (tools/provision-preview.mjs): je Konto ein Zufallspasswort, MFA-Geheimnisse werden
  // erst bei der ersten Anmeldung vom Nutzer selbst eingerichtet. Zugangsdaten gehen nur in die Datei BESS_SEED_CREDS.
  const EXTERNAL = !!external;
  const creds = [];
  if (EXTERNAL) {
    const rename = { 'u-admin': 'dirk@bess-vorschau.invalid', 'u-markus': 'markus@bess-vorschau.invalid' };
    for (const u of users) {
      if (rename[u.id]) u.email = rename[u.id];
      const p = randomBytes(12).toString('base64url');
      u.pw = hashPassword(p);
      if (u.mfa) u.totp = null;
      creds.push({ id: u.id, name: u.name, role: u.role, email: u.email, password: p, mfa: u.mfa });
    }
  }

  const spvs = [
    { id: 'spv-n01', name: 'Speicherprojekt Nord 1 GmbH & Co. KG', legalStatus: 'geplant', note: 'Name vorläufig; Gründung erst nach Projektreife' },
    { id: 'spv-n02', name: 'Speicherprojekt Nord 2 GmbH & Co. KG', legalStatus: 'geplant', note: 'Name vorläufig' },
    { id: 'spv-s01', name: 'Speicherprojekt Süd 1 GmbH & Co. KG', legalStatus: 'geplant', note: 'Name vorläufig' },
  ];

  const econMeta = (stand) => ({ status: 'Arbeitsstand – nicht geprüft', source: 'Synthetisches Vorschau-Modell (keine reale Kalkulation)', stand,
    assumptions: ['Systempreise als Bandbreite angenommen, keine Herstellerangebote', 'Netzanschlusskosten/BKZ nicht bestätigt', 'Erlöse aus Arbitrage und Regelleistung als Szenario, keine Prognosezusage', 'Keine Steuer- und Finanzierungseffekte berücksichtigt'] });

  const projects = [
    { id: 'p-n01', code: 'DEMO-N01', name: 'Demo-Standort Nord A', region: 'nord', location: 'Musterkreis Nord (synthetisch)', spvId: 'spv-n01', phase: 3,
      gridStatus: 'Netzanschlussanfrage gestellt, Rückmeldung offen', permitStatus: 'Bauvoranfrage in Vorbereitung', contractStatus: 'Flächensicherung unterzeichnet',
      tech: { powerMW: 20, capacityMWh: 40, connection: '110-kV-Ebene, Umspannwerk in ca. 1,2 km (synthetisch)', areaHa: 2.5, variant: 'Planungsvariante V1 – nicht festgelegt' },
      econ: { capexMEUR: [12.5, 15.5], opexKEURa: [280, 360], meta: econMeta('2026-10-28') },
      risks: ['Netzanschlusszusage ausstehend', 'Bauplanungsrechtliche Einordnung mit Gemeinde abzustimmen', 'Zuwegung über Wirtschaftsweg zu prüfen'],
      ownerUpdates: [{ at: '2026-09-15T10:00:00.000Z', text: 'Flächensicherungsvertrag unterzeichnet. Vielen Dank für die Zusammenarbeit.' }, { at: '2026-10-20T10:00:00.000Z', text: 'Netzanschlussanfrage beim Netzbetreiber eingereicht. Eine Rückmeldung erwarten wir in einigen Wochen.' }],
      publicRelease: { state: 'nicht freigegeben' } },
    { id: 'p-n02', code: 'DEMO-N02', name: 'Demo-Standort Nord B', region: 'nord', location: 'Musterkreis Küste (synthetisch)', spvId: 'spv-n02', phase: 2,
      gridStatus: 'Vorprüfung Kapazität', permitStatus: 'nicht begonnen', contractStatus: 'Optionsvertrag in Verhandlung',
      tech: { powerMW: 10, capacityMWh: 20, connection: '20-kV-Mittelspannung, Varianten offen (synthetisch)', areaHa: 1.2, variant: 'Variantenvergleich 10 MW / 20 MWh und 10 MW / 40 MWh' },
      econ: { capexMEUR: [6.5, 9.0], opexKEURa: [150, 210], meta: econMeta('2026-10-21') },
      risks: ['Netzkapazität unklar', 'Vertragsabschluss offen'],
      ownerUpdates: [{ at: '2026-10-10T10:00:00.000Z', text: 'Vertragsentwurf zur Durchsicht bereitgestellt.' }],
      publicRelease: { state: 'nicht freigegeben' } },
    { id: 'p-s01', code: 'DEMO-S01', name: 'Demo-Standort Süd A', region: 'sued', location: 'Musterkreis Süd (synthetisch)', spvId: 'spv-s01', phase: 1,
      gridStatus: 'nicht begonnen', permitStatus: 'nicht begonnen', contractStatus: 'Erstkontakt',
      tech: { powerMW: null, capacityMWh: null, connection: 'offen', areaHa: null, variant: 'noch keine Auslegung' },
      econ: null, risks: ['Region Süd personell nicht besetzt'], ownerUpdates: [], publicRelease: { state: 'nicht freigegeben' } },
  ];

  const contacts = [
    { id: 'c-own-a', name: 'Eigentümer A (synthetisch)', kind: 'Grundstückseigentümer', email: 'eigentuemer.a@demo.invalid', phone: '+49 000 000001', projectIds: ['p-n01'], owner: 'u-markus', note: 'Ackerfläche, Teilfläche am Feldrand bevorzugt' },
    { id: 'c-own-b', name: 'Eigentümerin B (synthetisch)', kind: 'Grundstückseigentümer', email: 'eigentuemer.b@demo.invalid', phone: '+49 000 000002', projectIds: ['p-n02'], owner: 'u-markus', note: 'Wünscht Kaufoption zu prüfen' },
    { id: 'c-kom', name: 'Bauamt Gemeinde Demo-Nord (synthetisch)', kind: 'Kommune', email: 'gemeinde@demo.invalid', phone: '+49 000 000003', projectIds: ['p-n01'], owner: 'u-pl', note: '' },
    { id: 'c-s1', name: 'Eigentümer Süd (synthetisch)', kind: 'Grundstückseigentümer', email: 'sued@demo.invalid', phone: '', projectIds: ['p-s01'], owner: null, note: 'Erstkontakt per Formular' },
  ];

  const parcels = [
    { id: 'x-1', projectId: 'p-n01', ownerContactId: 'c-own-a', gemarkung: 'Demo-Gemarkung 1', flur: '3', flurstueck: '12/4', areaHa: 18.2, devAreaHa: 3.0, use: 'Acker', status: 'gesichert (Option)' },
    { id: 'x-2', projectId: 'p-n02', ownerContactId: 'c-own-b', gemarkung: 'Demo-Gemarkung 7', flur: '1', flurstueck: '88', areaHa: 9.6, devAreaHa: 1.5, use: 'Grünland', status: 'in Verhandlung' },
    { id: 'x-3', projectId: 'p-s01', ownerContactId: 'c-s1', gemarkung: 'Demo-Gemarkung Süd', flur: '–', flurstueck: '–', areaHa: null, devAreaHa: null, use: 'unbekannt', status: 'Erstkontakt' },
  ];

  const contracts = [
    { id: 'k-1', projectId: 'p-n01', parcelId: 'x-1', ownerContactId: 'c-own-a', type: 'Flächensicherungs- und Optionsvertrag', status: 'unterzeichnet', basis: 'Mustervertrag V0.2 (Entwurf)', signedAt: '2026-09-12',
      keyTerms: [['Optionslaufzeit', '24 Monate, zweimal 12 Monate verlängerbar'], ['Optionsvergütung', 'jährlich, gemäß § 6 (synthetischer Wert: 2.500 EUR/Jahr)'], ['Entwicklungsfläche', 'ca. 3,0 ha (Anlage 1)'], ['Variante A', 'Nutzung/Pacht 20 Jahre + 3 × 5 Jahre'], ['Variante B', 'Kaufoption nach Formel § 11'], ['Rückbau', 'Verpflichtung und Sicherheit vor Baubeginn']] },
    { id: 'k-2', projectId: 'p-n02', parcelId: 'x-2', ownerContactId: 'c-own-b', type: 'Flächensicherungs- und Optionsvertrag', status: 'Entwurf in Abstimmung', basis: 'Mustervertrag V0.2 (Entwurf)', signedAt: null,
      keyTerms: [['Optionslaufzeit', '24 Monate (Entwurf)'], ['Entwicklungsfläche', 'ca. 1,5 ha (Entwurf)'], ['Kaufoption', 'auf Wunsch der Eigentümerin zu prüfen']] },
  ];

  const docs = [];
  function doc(id, projectId, title, category, audience, opts = {}) {
    const file = `${id}.pdf`;
    const lines = opts.lines || [`Projekt: ${projects.find((p) => p.id === projectId).code}`, `Kategorie: ${category}`, `Zielgruppe: ${audience}`, 'Inhalt: Platzhalter fuer die Abnahmevorschau.', 'Dieses Dokument enthaelt keine realen Daten.'];
    const data = makePdf(title, lines);
    files.push({ name: file, data, mime: 'application/pdf' });
    docs.push({ id, projectId, title, category, audience, ownerContactId: opts.owner || null, status: opts.status || 'freigegeben',
      version: opts.version || '1.0', versions: [{ v: opts.version || '1.0', at: T, file }], file, mime: 'application/pdf', size: data.length,
      uploadedBy: opts.by || 'u-pl', at: T, source: opts.source || 'Synthetisch', stand: opts.stand || '2026-10-28' });
  }
  doc('d-n01-own-info', 'p-n01', 'Projektinformation für Eigentümer', 'Information', 'eigentuemer');
  doc('d-n01-own-a-vertrag', 'p-n01', 'Flächensicherungs- und Optionsvertrag (unterzeichnete Kopie)', 'Vertrag', 'eigentuemer', { owner: 'c-own-a', by: 'u-markus' });
  doc('d-n01-inv-teaser', 'p-n01', 'Projektübersicht und Teaser', 'Projektübersicht', 'investor');
  doc('d-n01-inv-fin', 'p-n01', 'Finanzmodell – Zusammenfassung', 'Wirtschaftlichkeit', 'investor', { version: '0.3' });
  doc('d-n01-inv-netz-entwurf', 'p-n01', 'Netzanschluss – Zwischenstand', 'Netzanschluss', 'investor', { status: 'entwurf' });
  doc('d-n01-fin-intern', 'p-n01', 'Interne Kalkulation (Vollmodell)', 'Wirtschaftlichkeit', 'intern_finanzen');
  doc('d-n01-kom-lageplan', 'p-n01', 'Lageplan – Vorentwurf', 'Planung', 'kommune');
  doc('d-n01-kom-brand', 'p-n01', 'Brandschutz – Vorkonzept', 'Gutachten', 'kommune');
  doc('d-n01-intern-notiz', 'p-n01', 'Gesprächsnotiz Eigentümer A', 'Akquise', 'intern', { by: 'u-markus' });
  doc('d-n02-own-b-vertrag', 'p-n02', 'Optionsvertrag – Entwurf zur Durchsicht', 'Vertrag', 'eigentuemer', { owner: 'c-own-b', by: 'u-markus', version: '0.2' });
  doc('d-n02-inv-teaser', 'p-n02', 'Projektübersicht Nord B', 'Projektübersicht', 'investor');
  doc('d-n02-tech-spec', 'p-n02', 'Technische Spezifikation – Anfrageentwurf', 'Technik', 'technik');
  doc('d-s01-intern', 'p-s01', 'Standortsteckbrief Süd A', 'Akquise', 'intern');

  const grants = [
    { id: 'g-1', userId: 'u-inv-a', projectId: 'p-n01', scope: 'investor', grantedBy: 'u-admin', at: T },
    { id: 'g-2', userId: 'u-inv-b', projectId: 'p-n02', scope: 'investor', grantedBy: 'u-admin', at: T },
    { id: 'g-3', userId: 'u-kom', projectId: 'p-n01', scope: 'kommune', grantedBy: 'u-admin', at: T },
    { id: 'g-4', userId: 'u-tech', projectId: 'p-n02', scope: 'technik', grantedBy: 'u-admin', at: T },
  ];

  const appointments = [
    { id: 'a-1', projectId: 'p-n01', audience: 'eigentuemer', ownerContactId: 'c-own-a', at: '2026-11-12T10:00:00.000Z', title: 'Begehung mit Vermessung', place: 'Hofstelle (synthetisch)' },
    { id: 'a-2', projectId: 'p-n02', audience: 'eigentuemer', ownerContactId: 'c-own-b', at: '2026-11-05T14:00:00.000Z', title: 'Besprechung Vertragsentwurf', place: 'telefonisch' },
    { id: 'a-3', projectId: 'p-n01', audience: 'kommune', at: '2026-11-19T09:00:00.000Z', title: 'Vorstellung im Bauausschuss (Vorabstimmung)', place: 'Amtsgebäude (synthetisch)' },
    { id: 'a-4', projectId: 'p-n01', audience: 'investor', at: '2026-11-26T13:00:00.000Z', title: 'Datenraum-Update Netzanschluss', place: 'Videokonferenz' },
  ];

  const tasks = [
    { id: 't-1', projectId: 'p-n01', title: 'Netzbetreiber: Rückmeldung zur Anschlussanfrage nachhalten', due: '2026-11-15', assignee: 'u-pl', status: 'offen' },
    { id: 't-2', projectId: 'p-n01', title: 'Bauvoranfrage: Lageplan und Fragenkatalog finalisieren', due: '2026-11-30', assignee: 'u-pl', status: 'offen' },
    { id: 't-3', projectId: 'p-n02', title: 'Vertragsentwurf mit Eigentümerin B besprechen', due: '2026-11-05', assignee: 'u-markus', status: 'offen' },
    { id: 't-4', projectId: 'p-s01', title: 'Erstbewertung Netzentfernung', due: '2026-12-10', assignee: null, status: 'offen' },
    { id: 't-5', projectId: 'p-n01', title: 'Optionsvergütung Jahr 1 anweisen', due: '2026-10-01', assignee: 'u-admin', status: 'erledigt' },
  ];

  const messages = [
    { id: 'm-1', threadKey: 'p-n01:u-own-a', projectId: 'p-n01', fromUserId: 'u-markus', text: 'Guten Tag, anbei finden Sie die unterzeichnete Vertragskopie im Bereich Dokumente. Für Fragen bin ich jederzeit erreichbar.', at: '2026-09-15T10:05:00.000Z' },
    { id: 'm-2', threadKey: 'p-n01:u-own-a', projectId: 'p-n01', fromUserId: 'u-own-a', text: 'Danke. Wann kommt der Vermesser?', at: '2026-10-22T08:10:00.000Z' },
    { id: 'm-3', threadKey: 'p-n02:u-inv-b', projectId: 'p-n02', fromUserId: 'u-inv-b', text: 'Gibt es schon eine Einschätzung zur Netzkapazität?', at: '2026-10-24T11:00:00.000Z' },
  ];

  const approvals = [
    { id: 'ap-1', kind: 'document_release', targetId: 'd-n01-inv-netz-entwurf', requestedBy: 'u-pl', at: '2026-10-27T15:00:00.000Z', state: 'offen', note: 'Zwischenstand für Investor A freigeben' },
  ];

  const db = { meta: { synthetic: true, createdAt: new Date().toISOString(), note: 'Synthetischer Vorschau-Datenbestand – keine realen Daten' },
    users, spvs, projects, contacts, parcels, contracts, documents: docs, grants, appointments, tasks, messages, approvals,
    inquiries: [], audit: [], downloads: [], uploads: [] };
  return { db, files, creds };
}
