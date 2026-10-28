// Zentrale Zugriffskontrolle. Jede Datenabfrage der Portale läuft über diese Funktionen;
// Views erhalten nie ungefilterte Sammlungen. Ein nicht sichtbares Objekt wird wie ein
// nicht existierendes behandelt (404), damit IDs nicht ausgespäht werden können.
import { getDb } from './store.mjs';

export const ROLES = {
  admin:          { label: 'Plattformadministration', internal: true },
  projektleitung: { label: 'Projektleitung', internal: true },
  vertrieb_nord:  { label: 'Vertriebskoordination Nord', internal: true, region: 'nord' },
  vertrieb_sued:  { label: 'Vertriebskoordination Süd', internal: true, region: 'sued' },
  eigentuemer:    { label: 'Grundstückseigentümer', internal: false },
  investor:       { label: 'Investor', internal: false },
  kommune:        { label: 'Kommunaler Partner', internal: false },
  technik:        { label: 'Technischer Partner', internal: false },
};

export const AUDIENCES = {
  eigentuemer: 'Eigentümer',
  investor: 'Investoren-Datenraum',
  kommune: 'Kommune',
  technik: 'Technik',
  intern: 'Intern',
  intern_finanzen: 'Intern – Finanzen',
};

export const isInternal = (u) => !!ROLES[u?.role]?.internal;
export const isAdmin = (u) => u?.role === 'admin';

export function visibleProjectIds(u) {
  const db = getDb();
  if (!u || !u.active) return new Set();
  switch (u.role) {
    case 'admin': return new Set(db.projects.map((p) => p.id));
    case 'projektleitung': return new Set(u.projects || []);
    case 'vertrieb_nord':
    case 'vertrieb_sued': return new Set(db.projects.filter((p) => p.region === ROLES[u.role].region).map((p) => p.id));
    case 'eigentuemer': return new Set(db.parcels.filter((x) => x.ownerContactId === u.contactId).map((x) => x.projectId));
    case 'investor':
    case 'kommune':
    case 'technik': return new Set(db.grants.filter((g) => g.userId === u.id && g.scope === u.role).map((g) => g.projectId));
    default: return new Set();
  }
}

export function allowedAudiences(u) {
  switch (u?.role) {
    case 'admin':
    case 'projektleitung': return Object.keys(AUDIENCES);
    case 'vertrieb_nord':
    case 'vertrieb_sued': return ['eigentuemer', 'kommune', 'intern'];
    case 'eigentuemer': return ['eigentuemer'];
    case 'investor': return ['investor'];
    case 'kommune': return ['kommune'];
    case 'technik': return ['technik'];
    default: return [];
  }
}

export function listProjects(u) {
  const ids = visibleProjectIds(u);
  return getDb().projects.filter((p) => ids.has(p.id));
}
export function getProject(u, id) {
  return visibleProjectIds(u).has(id) ? getDb().projects.find((p) => p.id === id) || null : null;
}

export function canSeeDocument(u, d) {
  if (!u || !d) return false;
  if (!visibleProjectIds(u).has(d.projectId)) return false;
  if (!allowedAudiences(u).includes(d.audience)) return false;
  if (isInternal(u)) return true;
  if (d.ownerContactId && d.ownerContactId !== u.contactId) return false;
  if (d.status === 'freigegeben') return true;
  return d.uploadedBy === u.id; // eigene Einreichungen bleiben für den Einreicher sichtbar
}
export function listDocuments(u, projectId) {
  return getDb().documents.filter((d) => (!projectId || d.projectId === projectId) && canSeeDocument(u, d));
}
export function getDocument(u, id) {
  const d = getDb().documents.find((x) => x.id === id);
  return canSeeDocument(u, d) ? d : null;
}

export function canSeeFinancials(u, p) {
  if (!p || !visibleProjectIds(u).has(p.id)) return false;
  return u.role === 'admin' || u.role === 'projektleitung' || u.role === 'investor';
}
export const canSeeTechnical = (u, p) => !!p && visibleProjectIds(u).has(p.id) && u.role !== 'eigentuemer';

export function listParcels(u, projectId) {
  const ids = visibleProjectIds(u);
  return getDb().parcels.filter((x) => ids.has(x.projectId) && (!projectId || x.projectId === projectId)
    && (isInternal(u) || (u.role === 'eigentuemer' && x.ownerContactId === u.contactId)));
}
export function listContracts(u) {
  const ids = visibleProjectIds(u);
  return getDb().contracts.filter((c) => ids.has(c.projectId)
    && (u.role === 'admin' || u.role === 'projektleitung' || u.role?.startsWith('vertrieb_') || (u.role === 'eigentuemer' && c.ownerContactId === u.contactId)));
}
export function listAppointments(u) {
  const ids = visibleProjectIds(u);
  return getDb().appointments.filter((a) => ids.has(a.projectId)
    && (isInternal(u) || (a.audience === u.role && (!a.ownerContactId || a.ownerContactId === u.contactId))));
}
export function listContacts(u) {
  if (!isInternal(u)) return [];
  const ids = visibleProjectIds(u);
  return getDb().contacts.filter((c) => u.role === 'admin' || (c.projectIds || []).some((p) => ids.has(p)));
}
export function listTasks(u) {
  if (!isInternal(u)) return [];
  const ids = visibleProjectIds(u);
  return getDb().tasks.filter((t) => ids.has(t.projectId));
}

// Nachrichten: ein Faden je (Projekt, externer Nutzer).
export function threadKey(projectId, externalUserId) { return `${projectId}:${externalUserId}`; }
export function listThreads(u) {
  const db = getDb();
  const ids = visibleProjectIds(u);
  const keys = new Set();
  for (const m of db.messages) {
    if (!ids.has(m.projectId)) continue;
    if (isInternal(u) || m.threadKey === threadKey(m.projectId, u.id)) keys.add(m.threadKey);
  }
  if (!isInternal(u)) for (const pid of ids) keys.add(threadKey(pid, u.id));
  return [...keys].map((k) => {
    const [projectId, extId] = k.split(':');
    return { key: k, projectId, externalUserId: extId, messages: db.messages.filter((m) => m.threadKey === k) };
  });
}
export function canPostToThread(u, projectId, extUserId) {
  if (!visibleProjectIds(u).has(projectId)) return false;
  if (isInternal(u)) return getDb().users.some((x) => x.id === extUserId && visibleProjectIds(x).has(projectId));
  return extUserId === u.id;
}

export const canRequestApproval = (u) => isInternal(u);
export const canDecideApproval = (u, a) => isAdmin(u) && a.state === 'offen' && a.requestedBy !== u.id;

// Öffentliche Sicht: nur ausdrücklich freigegebene Projekte und nur die dafür freigegebenen Felder.
export function publicProjects() {
  return getDb().projects.filter((p) => p.publicRelease?.state === 'freigegeben').map((p) => ({
    code: p.code, name: p.publicRelease.publicName || p.name, region: p.publicRelease.publicRegion || '', phase: p.phase,
    summary: p.publicRelease.summary || '',
  }));
}
