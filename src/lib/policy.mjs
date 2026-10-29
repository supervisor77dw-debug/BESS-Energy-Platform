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

// Rollen eines Kontos: mehrere Rollen möglich (u.roles), u.role bleibt die Hauptrolle (Anzeige, Startbereich).
export const ROLE_ORDER = ['admin', 'projektleitung', 'vertrieb_nord', 'vertrieb_sued', 'investor', 'kommune', 'technik', 'eigentuemer'];
export const rolesOf = (u) => (u?.roles?.length ? u.roles : u?.role ? [u.role] : []).filter((r) => ROLES[r]);
export const hasRole = (u, r) => rolesOf(u).includes(r);
export const primaryRole = (roles) => ROLE_ORDER.find((r) => roles.includes(r)) || roles[0];
export const isInternal = (u) => rolesOf(u).some((r) => ROLES[r].internal);
export const isAdmin = (u) => hasRole(u, 'admin');
// Rollen, die je Projekt freigeschaltet werden (Zuordnung über db.grants mit scope = Rolle)
export const PROJECT_ROLES = ['projektleitung', 'vertrieb_nord', 'vertrieb_sued', 'investor', 'kommune', 'technik'];
const AUD = {
  admin: Object.keys(AUDIENCES), projektleitung: Object.keys(AUDIENCES),
  vertrieb_nord: ['eigentuemer', 'kommune', 'intern'], vertrieb_sued: ['eigentuemer', 'kommune', 'intern'],
  eigentuemer: ['eigentuemer'], investor: ['investor'], kommune: ['kommune'], technik: ['technik'],
};

// Projekte je Rolle – Grundlage aller Prüfungen. Jede Rolle gilt nur für die Projekte, für die sie gilt.
export function projectsByRole(u) {
  const db = getDb();
  const map = new Map();
  if (!u || !u.active) return map;
  const grantsOf = (scope) => db.grants.filter((g) => g.userId === u.id && g.scope === scope).map((g) => g.projectId);
  for (const r of rolesOf(u)) {
    let ids;
    switch (r) {
      case 'admin': ids = db.projects.map((p) => p.id); break;
      case 'projektleitung': ids = [...(u.projects || []), ...grantsOf(r)]; break;
      case 'vertrieb_nord':
      case 'vertrieb_sued': {
        // ohne Einzelzuordnung: alle Projekte der Region; mit Zuordnung: nur die zugeordneten Projekte der Region
        const region = db.projects.filter((p) => p.region === ROLES[r].region).map((p) => p.id);
        const assigned = grantsOf(r);
        ids = assigned.length ? region.filter((id) => assigned.includes(id)) : (u.regionAll === false ? [] : region);
        break;
      }
      case 'eigentuemer': ids = db.parcels.filter((x) => u.contactId && x.ownerContactId === u.contactId).map((x) => x.projectId); break;
      default: ids = grantsOf(r);
    }
    map.set(r, new Set(ids));
  }
  return map;
}
export function visibleProjectIds(u) {
  const all = new Set();
  for (const ids of projectsByRole(u).values()) for (const id of ids) all.add(id);
  return all;
}
// Projekte, die über eine interne Rolle sichtbar sind (für interne Bereiche wie Pipeline, Kontakte, Aufgaben)
export function internalProjectIds(u) {
  const out = new Set();
  for (const [r, ids] of projectsByRole(u)) if (ROLES[r].internal) for (const id of ids) out.add(id);
  return out;
}
export const rolesForProject = (u, projectId) => rolesFor(u, projectId);
const rolesFor = (u, projectId) => [...projectsByRole(u)].filter(([, ids]) => ids.has(projectId)).map(([r]) => r);

export function allowedAudiences(u, projectId) {
  const roles = projectId ? rolesFor(u, projectId) : rolesOf(u);
  return [...new Set(roles.flatMap((r) => AUD[r] || []))];
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
  // je Rolle prüfen, die für das Projekt des Dokuments gilt – keine Vermischung über Projekte hinweg
  for (const r of rolesFor(u, d.projectId)) {
    if (!(AUD[r] || []).includes(d.audience)) continue;
    if (ROLES[r].internal) return true;
    if (d.ownerContactId && d.ownerContactId !== u.contactId) continue;
    if (d.status === 'freigegeben' || d.uploadedBy === u.id) return true; // eigene Einreichungen bleiben für den Einreicher sichtbar
  }
  return false;
}
export function listDocuments(u, projectId) {
  return getDb().documents.filter((d) => (!projectId || d.projectId === projectId) && canSeeDocument(u, d));
}
export function getDocument(u, id) {
  const d = getDb().documents.find((x) => x.id === id);
  return canSeeDocument(u, d) ? d : null;
}

export function canSeeFinancials(u, p) {
  return !!p && rolesFor(u, p.id).some((r) => ['admin', 'projektleitung', 'investor'].includes(r));
}
export const canSeeTechnical = (u, p) => !!p && rolesFor(u, p.id).some((r) => r !== 'eigentuemer');

export function listParcels(u, projectId) {
  return getDb().parcels.filter((x) => (!projectId || x.projectId === projectId) && rolesFor(u, x.projectId).some((r) => ROLES[r].internal || (r === 'eigentuemer' && x.ownerContactId === u.contactId)));
}
export function listContracts(u) {
  return getDb().contracts.filter((c) => rolesFor(u, c.projectId).some((r) => ['admin', 'projektleitung', 'vertrieb_nord', 'vertrieb_sued'].includes(r) || (r === 'eigentuemer' && c.ownerContactId === u.contactId)));
}
export function listAppointments(u) {
  return getDb().appointments.filter((a) => rolesFor(u, a.projectId).some((r) => ROLES[r].internal || (a.audience === r && (!a.ownerContactId || a.ownerContactId === u.contactId))));
}
export function listContacts(u) {
  if (!isInternal(u)) return [];
  const ids = internalProjectIds(u);
  return getDb().contacts.filter((c) => isAdmin(u) || (c.projectIds || []).some((p) => ids.has(p)));
}
export function listTasks(u) {
  if (!isInternal(u)) return [];
  const ids = internalProjectIds(u);
  return getDb().tasks.filter((t) => ids.has(t.projectId));
}

// Nachrichten: ein Faden je (Projekt, externer Nutzer).
export function threadKey(projectId, externalUserId) { return `${projectId}:${externalUserId}`; }
export function listThreads(u) {
  const db = getDb();
  const ids = visibleProjectIds(u);
  const internal = internalProjectIds(u);
  const keys = new Set();
  for (const m of db.messages) {
    if (!ids.has(m.projectId)) continue;
    if (internal.has(m.projectId) || m.threadKey === threadKey(m.projectId, u.id)) keys.add(m.threadKey);
  }
  for (const pid of ids) if (!internal.has(pid)) keys.add(threadKey(pid, u.id));
  return [...keys].map((k) => {
    const [projectId, extId] = k.split(':');
    return { key: k, projectId, externalUserId: extId, messages: db.messages.filter((m) => m.threadKey === k) };
  });
}
export function canPostToThread(u, projectId, extUserId) {
  if (!visibleProjectIds(u).has(projectId)) return false;
  if (internalProjectIds(u).has(projectId) && extUserId !== u.id) return getDb().users.some((x) => x.id === extUserId && visibleProjectIds(x).has(projectId));
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
