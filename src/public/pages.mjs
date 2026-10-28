import { html, raw } from '../lib/html.mjs';
import { brand } from '../config.mjs';
import { page, illus } from './layout.mjs';
import { heroSvg } from '../../tools/illustrations.mjs';
import { publicProjects } from '../lib/policy.mjs';
import { formToken } from '../lib/http.mjs';

const HERO = heroSvg({ inline: true });

export const PHASES = [
  ['Standortidentifikation', 'Wir suchen Flächen in sinnvoller Entfernung zu Umspannwerken und leistungsfähigen Netzen und prüfen Lage, Zuwegung, Schutzgebiete und Nachbarschaft.'],
  ['Grundstückssicherung', 'Mit dem Eigentümer schließen wir einen Flächensicherungs- und Optionsvertrag. Er regelt Exklusivität, Optionsvergütung und die späteren Bedingungen.'],
  ['Netzanschlussprüfung', 'Wir stellen die Netzanschlussanfrage und klären mit dem Netzbetreiber Kapazität, Anschlusspunkt, Kosten und Zeitplan.'],
  ['Genehmigungsplanung', 'Bauvoranfrage oder Bauantrag, Gutachten zu Schall, Boden, Natur und Brandschutz, Abstimmung mit Gemeinde und Behörden.'],
  ['Wirtschaftlichkeitsprüfung', 'Auslegung, Systempreise, Netzkosten und Vermarktungsszenarien werden zu einem prüfbaren Modell zusammengeführt.'],
  ['Finanzierung', 'Die Projektgesellschaft wird mit Eigen- und Fremdkapital ausgestattet. Erst danach fällt die Investitionsentscheidung.'],
  ['Bau', 'Tiefbau, Fundamente, Lieferung und Montage der Systeme, Netzanschluss, Prüfungen. Der Eigentümer erhält eine Bauphasenvergütung.'],
  ['Inbetriebnahme', 'Abnahmen, Netzbetreiberprüfungen, Einweisung der Feuerwehr und Aufnahme des kommerziellen Betriebs.'],
  ['Betrieb', 'Fernüberwachung rund um die Uhr, Wartung, Vermarktung der Speicherleistung und regelmäßige Information der Beteiligten.'],
  ['Rückbau oder Repowering', 'Am Ende der Laufzeit wird die Anlage vollständig zurückgebaut oder – nach neuer Vereinbarung – modernisiert.'],
];

const ORG_LD = { '@context': 'https://schema.org', '@type': 'Organization', name: brand.name, url: brand.domain, description: `${brand.claim}.` };

// ---------------- Startseite ----------------
export function home() {
  const body = html`
<section class="hero">
  <div class="hero-art">${raw(HERO)}</div>
  <div class="wrap hero-copy">
    <h1>Wir entwickeln die Speicherinfrastruktur für ein leistungsfähiges Energiesystem.</h1>
    <p class="lead">Batterie-Großspeicher nehmen Strom auf, wenn Wind und Sonne mehr liefern, als gebraucht wird, und geben ihn wieder ab, wenn das Netz ihn braucht. Wir planen solche Anlagen an geeigneten Standorten – gemeinsam mit Grundstückseigentümern, Gemeinden und Netzbetreibern.</p>
    <div class="hero-actions">
      <a class="btn btn-solid btn-lg" href="/grundstueckseigentuemer">Informationen für Eigentümer</a>
      <a class="btn btn-line btn-lg" href="/standortentwicklung">So entsteht ein Speicherprojekt</a>
    </div>
  </div>
  <p class="wrap hero-note small">Beispielhafte Illustration. Sie zeigt keine gebaute Anlage.</p>
</section>

<section class="band">
  <div class="wrap split">
    <div>
      <h2>Ein Speicher pro Standort, eine Gesellschaft pro Projekt</h2>
      <p>Jedes Speicherprojekt wird von einer eigenen Projektgesellschaft getragen. So bleiben Verträge, Finanzierung und Haftung je Standort sauber getrennt. Die gemeinsame Plattform bündelt Erfahrung, Planung, Einkauf und Betriebsführung.</p>
      <p><a class="link" href="/unternehmen">Mehr zum Entwicklungsmodell</a></p>
    </div>
    <dl class="facts">
      <div><dt>Wer trägt die Entwicklungskosten?</dt><dd>Der Projektentwickler – auch wenn ein Projekt nicht realisiert wird.</dd></div>
      <div><dt>Was bleibt beim Eigentümer?</dt><dd>Das Grundstück, die Optionsvergütung und – bei Realisierung – eine langfristige Nutzungsvergütung oder ein vorab geregelter Kaufpreis.</dd></div>
      <div><dt>Wie lange dauert die Entwicklung?</dt><dd>Meist mehrere Jahre. Der Netzanschluss bestimmt den Takt.</dd></div>
    </dl>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2 class="h-section">Warum Batteriespeicher gebraucht werden</h2>
    <div class="cols-3">
      <article><h3>Erneuerbare besser nutzen</h3><p>An windreichen oder sonnigen Tagen wird Strom erzeugt, den das Netz nicht immer aufnehmen kann. Speicher verschieben diese Energie in Stunden mit Bedarf – statt Anlagen abzuregeln.</p></article>
      <article><h3>Netz stabil halten</h3><p>Batteriespeicher reagieren in Sekundenbruchteilen. Sie helfen, die Netzfrequenz zu halten und kurzfristige Schwankungen auszugleichen.</p></article>
      <article><h3>Flexibilität schaffen</h3><p>Mit wachsendem Anteil erneuerbarer Energien braucht das Stromsystem regelbare Leistung. Speicher liefern sie ohne Brennstoff und ohne Emissionen am Standort.</p></article>
    </div>
  </div>
</section>

<section class="section section-tint">
  <div class="wrap split split-media">
    ${illus('luftbild-umspannwerk.svg', 'Draufsicht: Speicheranlage auf einer Ackerfläche, über ein Erdkabel mit dem nahen Umspannwerk verbunden', 'Kurze Wege zum Umspannwerk senken Kosten und Eingriffe.')}
    <div>
      <h2>Standorte nahe am Netz</h2>
      <p>Ein guter Speicherstandort liegt nahe einem Umspannwerk oder einer leistungsfähigen Leitung, ist gut erreichbar und fügt sich in die Umgebung ein. Wir prüfen jede Fläche einzeln – von der Netzkapazität bis zur Eingrünung.</p>
      <ul class="ticks">
        <li>Flächen von etwa einem bis mehreren Hektar, je nach Leistung</li>
        <li>Lage im ländlichen Raum mit Zufahrt über befestigte Wege</li>
        <li>Abstand zu Wohnbebauung nach Schall- und Brandschutzanforderungen</li>
      </ul>
      <p><a class="link" href="/standortentwicklung">Wie wir Standorte prüfen</a></p>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2 class="h-section">Zusammenarbeit</h2>
    <div class="audience">
      <a class="aud" href="/grundstueckseigentuemer"><h3>Grundstückseigentümer</h3><p>Optionsvertrag, Vergütung ab der Entwicklungsphase, Pacht oder Verkauf – transparent erklärt.</p><span class="aud-go">Für Eigentümer</span></a>
      <a class="aud" href="/kommunen"><h3>Gemeinden und Kreise</h3><p>Frühe Abstimmung, Brand- und Schallschutz, Einbindung in die regionale Energieplanung.</p><span class="aud-go">Für Kommunen</span></a>
      <a class="aud" href="/investoren"><h3>Investoren und Banken</h3><p>Eigenständige Projektgesellschaften, strukturierte Entwicklung, geschützter Datenraum.</p><span class="aud-go">Für Investoren</span></a>
    </div>
  </div>
</section>

<section class="section section-ink">
  <div class="wrap split">
    <div>
      <h2>Technik, die wir erklären können</h2>
      <p>Batteriesysteme, Wechselrichter, Transformatoren, Brandschutz und Betriebsführung: Wir legen offen, wie eine Anlage funktioniert und welche Sicherheitsvorkehrungen dazugehören.</p>
      <p><a class="link link-light" href="/technologie">Batteriespeicher und Technologie</a></p>
    </div>
    ${illus('schnitt-batteriesystem.svg', 'Schnitt durch ein Batteriesystem mit Modulen, Batteriemanagement, Klimatisierung, Brandschutz, Wechselrichter und Transformator', 'Aufbau eines containerisierten Systems.', 'illus-dark')}
  </div>
</section>

<section class="section">
  <div class="wrap contact-cta">
    <div>
      <h2>Sie haben eine Fläche in Netznähe?</h2>
      <p>Schicken Sie uns ein paar Angaben. Wir melden uns persönlich und sagen Ihnen offen, ob eine Prüfung sinnvoll ist. Die Anfrage verpflichtet Sie zu nichts.</p>
    </div>
    <div class="cta-row"><a class="btn btn-solid btn-lg" href="/standort-anbieten">Fläche anbieten</a><a class="btn btn-line btn-lg" href="/kontakt">Ansprechpartner</a></div>
  </div>
</section>`;
  return page({ path: '/', title: 'Startseite', description: 'Projektentwicklung für Batterie-Großspeicher (BESS) in Deutschland: Standortentwicklung, Flächensicherung mit Grundstückseigentümern, Zusammenarbeit mit Kommunen und Investoren.', body, jsonld: ORG_LD });
}

// ---------------- Unternehmen & Netzwerk ----------------
export function unternehmen() {
  const partners = brand.confirmedPartners || [];
  const body = html`
<section class="page-head"><div class="wrap">
  <h1>Unternehmen und Netzwerk</h1>
  <p class="lead">Wir bauen eine Plattform für die Entwicklung, Finanzierung, Errichtung und den Betrieb netzgekoppelter Batteriespeicher auf – mit eigenständigen Projektgesellschaften und klaren Zuständigkeiten.</p>
</div></section>
<section class="section"><div class="wrap split">
  <div>
    <h2>Das Entwicklungsmodell</h2>
    <p>Die Plattform übernimmt die Standortsuche, die Projektentwicklung und die Koordination aller Beteiligten. Für jeden Standort wird eine eigene Projektgesellschaft gegründet, sobald das Projekt die nötige Reife hat. Sie schließt die Verträge, wird finanziert und betreibt später die Anlage.</p>
    <p>Diese Trennung ist in der Infrastrukturfinanzierung üblich. Sie sorgt dafür, dass Banken und Investoren jedes Projekt für sich bewerten können und dass Risiken eines Standorts nicht auf andere übergreifen.</p>
  </div>
  <figure class="diagram" aria-labelledby="org-cap">
    <div class="org">
      <div class="org-top"><strong>Plattform ${brand.name}</strong><span>Standortsuche · Entwicklung · Einkauf · Betriebsführung</span></div>
      <div class="org-line" aria-hidden="true"></div>
      <div class="org-row">
        <div class="org-spv"><strong>Projektgesellschaft A</strong><span>Standort A</span></div>
        <div class="org-spv"><strong>Projektgesellschaft B</strong><span>Standort B</span></div>
        <div class="org-spv org-spv-more"><strong>Weitere</strong><span>je Standort</span></div>
      </div>
    </div>
    <figcaption id="org-cap" class="small muted">Schema der Organisation. Projektgesellschaften werden erst bei Projektreife gegründet und sind bis dahin als „geplant“ geführt.</figcaption>
  </figure>
</div></section>
<section class="section section-tint"><div class="wrap">
  <h2 class="h-section">Was die Plattform leistet</h2>
  <div class="cols-2">
    <article><h3>Projektentwicklung aus einer Hand</h3><p>Standortbewertung, Flächensicherung, Netzanschluss, Genehmigung und Wirtschaftlichkeit werden nach einem einheitlichen Verfahren bearbeitet und dokumentiert.</p></article>
    <article><h3>Regionale Ansprechpartner</h3><p>Eigentümer und Gemeinden sprechen mit festen Personen aus ihrer Region. Die Koordination für Norddeutschland ist besetzt; Süddeutschland wird aufgebaut.</p></article>
    <article><h3>Kontrollierte Information</h3><p>Technische, wirtschaftliche und vertragliche Unterlagen stellen wir über ein geschütztes Portal bereit – jeweils nur für die Beteiligten, die sie betreffen.</p></article>
    <article><h3>Langfristige Betriebsführung</h3><p>Ein Speicher läuft zwanzig Jahre und länger. Überwachung, Wartung und die Kommunikation mit Eigentümern und Gemeinden bleiben über die gesamte Laufzeit organisiert.</p></article>
  </div>
</div></section>
<section class="section"><div class="wrap narrow">
  <h2>Partner</h2>
  ${partners.length
    ? html`<ul class="partner-list">${partners.map((p) => html`<li><a href="${p.url}" rel="noopener">${p.name}</a> – ${p.role}</li>`)}</ul>`
    : html`<p>Wir arbeiten mit Fachplanern, Gutachtern, Herstellern und Finanzierungspartnern zusammen. Namentlich nennen wir Partner hier erst, wenn die Zusammenarbeit vertraglich vereinbart ist und der Partner der Nennung zugestimmt hat.</p>`}
</div></section>`;
  return page({ path: '/unternehmen', title: 'Unternehmen und Netzwerk', description: 'Entwicklungsmodell für Batterie-Großspeicher: gemeinsame Plattform, eigenständige Projektgesellschaften je Standort, regionale Ansprechpartner.', body });
}

// ---------------- Technologie ----------------
export function technologie() {
  const body = html`
<section class="page-head"><div class="wrap">
  <h1>Batteriespeicher und Technologie</h1>
  <p class="lead">Ein Batterie-Großspeicher besteht aus vielen Batteriemodulen, Leistungselektronik und einem Netzanschluss. Hier erklären wir, wie die Teile zusammenspielen und wie die Anlage sicher betrieben wird.</p>
</div></section>
<section class="section"><div class="wrap">
  ${illus('energiefluss.svg', 'Schema: Wind und Photovoltaik speisen ins Netz, der Speicher lädt bei Überschuss und speist bei Bedarf ein; Verbraucher werden aus dem Netz versorgt', 'Stromflüsse zwischen Erzeugung, Netz, Verbrauch und Speicher.', 'illus-wide')}
</div></section>
<section class="section"><div class="wrap tech-grid">
  <article id="funktion"><h2>Funktionsweise</h2><p>Die Batteriezellen speichern elektrische Energie chemisch. In Großspeichern werden heute überwiegend Lithium-Eisenphosphat-Zellen (LFP) eingesetzt, weil sie thermisch stabil und langlebig sind. Zellen werden zu Modulen, Module zu Racks und Racks zu Containern oder Schränken zusammengefasst.</p></article>
  <article id="laden"><h2>Laden und Entladen</h2><p>Der Speicher lädt, wenn Strom im Überfluss vorhanden oder günstig ist, und entlädt, wenn das Netz Leistung braucht. Leistung (Megawatt) und Energieinhalt (Megawattstunden) werden getrennt angegeben: Ein Speicher mit 20 MW und 40 MWh kann zwei Stunden lang mit voller Leistung einspeisen.</p></article>
  <article id="netzanschluss"><h2>Netzanschluss</h2><p>Großspeicher werden in der Regel an die Mittel- oder Hochspannung angeschlossen, oft direkt an einem Umspannwerk. Ob und wann ein Anschluss möglich ist, entscheidet der Netzbetreiber nach einer Netzverträglichkeitsprüfung. Der Anschluss ist deshalb der wichtigste Meilenstein jeder Entwicklung.</p></article>
  <article id="wechselrichter"><h2>Wechselrichter und Transformatoren</h2><p>Batterien arbeiten mit Gleichstrom, das Netz mit Wechselstrom. Bidirektionale Wechselrichter (Power Conversion Systems, PCS) wandeln in beide Richtungen. Transformatoren heben die Spannung auf die Netzebene. Schalt- und Schutztechnik trennt die Anlage bei Störungen sicher vom Netz.</p></article>
  <article id="netzstabilitaet"><h2>Netzstabilisierung</h2><p>Speicher können Regelleistung bereitstellen, mit der die Netzfrequenz bei 50 Hertz gehalten wird, und Blindleistung zur Spannungshaltung liefern. Welche Dienste ein Speicher erbringt, hängt von Präqualifikation, Vermarktung und den Vorgaben des Netzbetreibers ab.</p></article>
  <article id="erneuerbare"><h2>Erneuerbare Energien</h2><p>In windreichen Regionen wie Schleswig-Holstein müssen Anlagen regelmäßig abgeregelt werden, weil das Netz den Strom nicht abtransportieren kann. Speicher können diese Energie aufnehmen und zeitversetzt abgeben. Sie ersetzen keinen Netzausbau, entlasten das System aber spürbar.</p></article>
  <article id="betrieb"><h2>Betriebsführung</h2><p>Ein Energiemanagementsystem steuert den Speicher nach Fahrplan und Marktsignalen. Eine Leitwarte überwacht Ladezustand, Temperaturen und Sicherheitstechnik rund um die Uhr und kann die Anlage aus der Ferne abschalten. Vor Ort ist im Normalbetrieb kein Personal nötig.</p></article>
  <article id="sicherheit"><h2>Sicherheit und Brandschutz</h2><p>Jede Anlage erhält ein eigenes Brandschutzkonzept, abgestimmt mit Bauaufsicht und Feuerwehr. Dazu gehören Zellüberwachung durch das Batteriemanagement, Gas- und Rauchdetektion, Abstände oder Brandschutzwände zwischen Einheiten, Zufahrten und Löschwasserkonzept sowie eine Einweisung der örtlichen Feuerwehr vor Inbetriebnahme.</p></article>
  <article id="schall"><h2>Schall</h2><p>Klimageräte, Wechselrichter und Transformatoren erzeugen Geräusche. Ein Schallgutachten weist nach, dass die Richtwerte der TA Lärm an der nächsten Bebauung eingehalten werden. Wo nötig, helfen Abstand, Schallschutzwände oder leisere Komponenten.</p></article>
  <article id="wartung"><h2>Wartung und Rückbau</h2><p>Wiederkehrende Prüfungen, Austausch von Verschleißteilen und Software-Updates gehören zur Betriebsführung. Am Ende der Laufzeit werden Anlage, Fundamente und Leitungen zurückgebaut, Batterien gehen in die Verwertung. Die Rückbauverpflichtung wird vor Baubeginn vertraglich abgesichert.</p></article>
</div></section>
<section class="section section-tint"><div class="wrap split split-media">
  ${illus('schnitt-batteriesystem.svg', 'Schnitt durch ein Batteriesystem mit Racks, Batteriemanagement, Klimatisierung, Brandschutz, Wechselrichter und Transformator', 'Aufbau eines containerisierten Batteriesystems mit Leistungselektronik.')}
  <div><h2>Aus welchen Komponenten eine Anlage besteht</h2>
  <ul class="ticks"><li>Batteriesysteme in Containern oder Außenschränken</li><li>Wechselrichter (PCS) und Mittelspannungsstationen</li><li>Transformatoren und Übergabestation zum Netzbetreiber</li><li>Energiemanagement, Leittechnik und Kommunikation</li><li>Brandschutz-, Sicherheits- und Zugangstechnik</li><li>Einfriedung, Zufahrt, Kabeltrassen und Eingrünung</li></ul>
  <p class="small muted">Die konkrete Auslegung und Herstellerwahl erfolgt je Projekt nach technischer und wirtschaftlicher Prüfung.</p></div>
</div></section>
<section class="section"><div class="wrap">${illus('monitoring.svg', 'Beispiel einer Leitstand-Oberfläche mit Ladezustand, Leistung, Temperaturen, Sicherheitsstatus und Ereignissen', 'Fernüberwachung: Ladezustand, Leistung, Temperaturen und Sicherheitsmeldungen. Synthetische Werte.', 'illus-wide')}</div></section>`;
  return page({ path: '/technologie', title: 'Batteriespeicher und Technologie', description: 'Wie Batterie-Großspeicher funktionieren: Laden und Entladen, Netzanschluss, Wechselrichter, Transformatoren, Netzstabilisierung, Brandschutz, Schall, Wartung und Rückbau.', body });
}

// ---------------- Standortentwicklung ----------------
export function standortentwicklung() {
  const body = html`
<section class="page-head"><div class="wrap">
  <h1>Standortentwicklung</h1>
  <p class="lead">Vom ersten Blick auf die Karte bis zum laufenden Speicher vergehen meist mehrere Jahre. Jede Phase hat klare Prüfpunkte – und an jedem kann sich zeigen, dass ein Standort nicht geeignet ist.</p>
</div></section>
<section class="section"><div class="wrap">
  <ol class="phases">
    ${PHASES.map(([t, d], i) => html`<li class="phase"><span class="phase-n" aria-hidden="true">${i + 1}</span><div><h2 class="phase-t">${t}</h2><p>${d}</p></div></li>`)}
  </ol>
</div></section>
<section class="section section-tint"><div class="wrap split split-media">
  ${illus('gruendung-erschliessung.svg', 'Schnitt: Container auf Fundamenten über einer Schottertragschicht, Kabelkanal, Entwässerung, Zufahrt und Brandschutzabstand', 'Gründung und Erschließung werden je Standort geplant.')}
  <div><h2>Flächenschonend bauen – projektbezogen geplant</h2>
  <p>Wir begrenzen die befestigte Fläche auf das, was Statik, Brandschutz und Betrieb verlangen. Häufig stehen die Systeme auf Streifen- oder Punktfundamenten über einer wasserdurchlässigen Schottertragschicht.</p>
  <p>Wie hoch der Versiegelungsgrad tatsächlich ist, hängt vom Baugrund, der Entwässerung, den Zufahrten und den Brandschutzabständen ab. Das klären Gutachten und Fachplanung für jeden Standort einzeln.</p></div>
</div></section>
<section class="section"><div class="wrap split split-media">
  ${illus('standort-perspektive.svg', 'Perspektive einer Speicheranlage hinter einer Wallhecke mit Zufahrt und Transformatoren', 'Einbindung in die Landschaft durch bestehende und neue Gehölzstreifen.')}
  <div><h2>Was eine Fläche geeignet macht</h2>
  <ul class="ticks"><li>Netzkapazität am nahen Umspannwerk oder an einer Leitung</li><li>Kurze, genehmigungsfähige Kabeltrasse</li><li>Tragfähiger Baugrund und geregelte Entwässerung</li><li>Zufahrt für Schwertransporte und Feuerwehr</li><li>Ausreichender Abstand zu Wohnbebauung und Schutzgebieten</li><li>Planungsrechtliche Zustimmung der Gemeinde</li></ul></div>
</div></section>`;
  return page({ path: '/standortentwicklung', title: 'Standortentwicklung', description: 'Die zehn Phasen der BESS-Projektentwicklung: Standortidentifikation, Flächensicherung, Netzanschluss, Genehmigung, Wirtschaftlichkeit, Finanzierung, Bau, Inbetriebnahme, Betrieb und Rückbau.', body });
}

// ---------------- Für Grundstückseigentümer ----------------
const FAQ_OWNER = [
  ['Muss ich mich an Kosten beteiligen?', 'Nein. Planung, Netzanschluss, Gutachten, Genehmigung, Bau, Finanzierung, Versicherung und Rückbau trägt der Projektentwickler beziehungsweise die Projektgesellschaft.'],
  ['Kann ich die Fläche während der Entwicklung weiter bewirtschaften?', 'In der Regel ja. Die landwirtschaftliche Nutzung läuft weiter, bis feststeht, dass gebaut wird, und die endgültige Betriebsfläche festgelegt ist.'],
  ['Was passiert, wenn das Projekt scheitert?', 'Dann endet die Option. Die bis dahin gezahlte Optionsvergütung behalten Sie. Die Entwicklungskosten trägt der Projektentwickler.'],
  ['Wie viel Fläche wird gebraucht?', 'Das hängt von Leistung und Speicherkapazität ab. Häufig sind es ein bis wenige Hektar. Wir sichern zunächst eine etwas größere Entwicklungsfläche und legen die tatsächliche Betriebsfläche erst nach der Planung fest.'],
  ['Wie hoch ist die Vergütung?', 'Das hängt vom Standort ab: Netzanschluss, Fläche, Zuwegung und Projektgröße. Wir nennen deshalb keine Pauschalbeträge, sondern machen nach einer ersten Prüfung ein konkretes Angebot, das im Vertrag festgeschrieben wird.'],
  ['Was passiert mit der Anlage nach dem Betrieb?', 'Sie wird vollständig zurückgebaut. Die Rückbauverpflichtung steht im Vertrag; vor Baubeginn wird eine Sicherheit gestellt, die sich an der tatsächlichen Projektgröße orientiert.'],
  ['Kann ich mein Grundstück später verkaufen oder vererben?', 'Ja. Die für den Speicher nötigen Rechte werden über Dienstbarkeiten im Grundbuch gesichert und gehen auf Erwerber oder Erben über. Das ist Voraussetzung für die Finanzierung.'],
  ['Soll ich den Vertrag prüfen lassen?', 'Ja, das empfehlen wir ausdrücklich. Nehmen Sie sich Zeit und lassen Sie den Vertrag von einer Person Ihres Vertrauens oder einem Rechtsanwalt prüfen.'],
];

export function eigentuemer() {
  const body = html`
<section class="page-head page-head-owner"><div class="wrap split">
  <div>
    <h1>Ihre Fläche für einen Batteriespeicher</h1>
    <p class="lead">Wir suchen Flächen in der Nähe von Umspannwerken und leistungsfähigen Stromnetzen. Sie stellen den Standort zur Verfügung – wir übernehmen Planung, Kosten und Risiko der Entwicklung.</p>
    <div class="hero-actions"><a class="btn btn-solid btn-lg" href="/standort-anbieten">Fläche prüfen lassen</a><a class="btn btn-line btn-lg" href="#ablauf">Ablauf ansehen</a></div>
  </div>
  <aside class="pledge" aria-label="Unser Grundsatz">
    <p class="pledge-q">„Wir wollen Ihnen die Fläche nicht billig wegnehmen. Wir wollen heute gemeinsam festlegen, was Sie bekommen, wenn wir auf eigenes Risiko daraus ein genehmigtes und finanzierbares Speicherprojekt entwickeln.“</p>
  </aside>
</div></section>

<section class="section"><div class="wrap split">
  <div><h2>Warum geeignete Flächen gefragt sind</h2>
  <p>Batteriespeicher müssen dort stehen, wo das Netz sie aufnehmen kann – möglichst nah an einem Umspannwerk. Solche Flächen sind begrenzt. Wenn Ihr Grundstück in dieser Lage liegt, hat es für die Energieversorgung einen besonderen Wert. An diesem Wert sollen Sie fair beteiligt werden.</p></div>
  <div><h2>Wie die Standortprüfung funktioniert</h2>
  <p>Zuerst schauen wir uns Lage, Größe, Zuwegung und die Entfernung zum Netz an. Ist das vielversprechend, besprechen wir mit Ihnen persönlich die Möglichkeiten. Die eigentliche Prüfung – Netzanschlussanfrage, Gutachten, Genehmigung – beginnt erst nach Abschluss eines Optionsvertrags, weil sie erhebliche Kosten verursacht.</p></div>
</div></section>

<section class="section section-tint"><div class="wrap split split-media">
  ${illus('standort-perspektive.svg', 'Speicheranlage hinter einer Wallhecke: mehrere Container in Reihen, Transformatoren, Zaun und Zufahrt', 'So kann eine Anlage am Feldrand aussehen. Größe und Anordnung ergeben sich aus der Planung.')}
  <div><h2>Was auf Ihrer Fläche entsteht</h2>
  <p>Ein Batteriespeicher ist im Kern eine große, fest installierte Batterie. Sie nimmt Strom aus dem Netz auf, wenn viel Wind- oder Solarstrom da ist, und gibt ihn wieder ab, wenn er gebraucht wird.</p>
  <ul class="ticks">
    <li>Batteriecontainer oder -schränke, ähnlich groß wie Schiffscontainer, in Reihen auf einer befestigten Fläche</li>
    <li>Wechselrichter und Transformatoren sowie eine Übergabestation zum Netzbetreiber</li>
    <li>Zaun, Zufahrt für Wartung und Feuerwehr, Eingrünung zum Beispiel durch Knicks</li>
    <li>Im Betrieb ist kein Personal vor Ort. Die Anlage wird aus der Ferne überwacht, Fahrzeuge kommen nur zur Wartung.</li>
    <li>Die Anlage erzeugt Betriebsgeräusche, etwa durch Klimageräte. Ein Schallgutachten stellt sicher, dass die Grenzwerte an der Nachbarschaft eingehalten werden.</li>
  </ul></div>
</div></section>

<section class="section"><div class="wrap">
  <h2 class="h-section">Ihre wirtschaftlichen Möglichkeiten</h2>
  <div class="cols-2">
    <article><h3>Bausteine der Vergütung</h3>
      <ul class="ticks"><li><strong>Optionsvergütung</strong> jährlich während der Entwicklung, auch wenn das Projekt später nicht gebaut wird</li><li><strong>Bauphasenvergütung</strong> ab Baubeginn</li><li><strong>Nutzungsvergütung</strong> jährlich ab Inbetriebnahme, mit Mindestbetrag und Wertsicherung – oder alternativ</li><li><strong>Kaufpreis</strong> für die Betriebsfläche nach vorab vereinbarter Formel, mit Standort- und Erfolgsprämie</li></ul></article>
    <article><h3>Wovon die Höhe abhängt</h3>
      <ul class="ticks"><li>Verfügbare Netzanschlussleistung und Entfernung zum Umspannwerk</li><li>Größe und Zuschnitt der tatsächlich benötigten Fläche</li><li>Zuwegung, Baugrund und Genehmigungsaufwand</li><li>Leistung und Speicherkapazität des Projekts</li></ul>
      <p>Konkrete Beträge nennen wir nach einer ersten Prüfung Ihres Standorts im persönlichen Gespräch. Sie werden erst mit dem unterzeichneten Vertrag verbindlich.</p></article>
  </div>
</div></section>

<section class="section section-tint" id="ablauf"><div class="wrap">
  <h2 class="h-section">So läuft die Zusammenarbeit</h2>
  <ol class="owner-steps">
    <li><h3>Optionsvertrag</h3><p>Sie reservieren eine Entwicklungsfläche exklusiv für uns, zunächst für 24 Monate mit Verlängerungsmöglichkeit. Wir dürfen in dieser Zeit planen, messen, Gutachten erstellen und Anträge stellen.</p></li>
    <li><h3>Vergütung schon in der Entwicklung</h3><p>Für die Reservierung erhalten Sie eine jährliche Optionsvergütung. Sie wird unabhängig vom späteren Projekterfolg gezahlt und nicht zurückgefordert.</p></li>
    <li><h3>Entscheidung über den Bau</h3><p>Erst wenn Netzanschluss, Genehmigung und Finanzierung stehen, entscheidet die Projektgesellschaft über den Bau. Ist ein Projekt nicht tragfähig, endet die Option.</p></li>
    <li><h3>Langfristige Pacht oder Verkauf</h3><p>Bei Realisierung wird die Betriebsfläche entweder langfristig genutzt – mit einer jährlichen, wertgesicherten Vergütung – oder zu einem bereits vorab nach einer Formel geregelten Kaufpreis erworben.</p></li>
  </ol>
</div></section>

<section class="section"><div class="wrap">
  <h2 class="h-section">Pacht oder Kauf – beide Wege im Vergleich</h2>
  <div class="compare">
    <article><h3>Langfristige Nutzung (Pacht)</h3><ul class="ticks"><li>Sie bleiben Eigentümer</li><li>Nutzung zunächst 20 Jahre ab Inbetriebnahme, mit Verlängerungsoptionen</li><li>Vergütung je Hektar Betriebsfläche mit Mindestbetrag, angepasst an den Verbraucherpreisindex</li><li>Bauphasenvergütung bereits ab Baubeginn</li></ul></article>
    <article><h3>Verkauf der Betriebsfläche</h3><ul class="ticks"><li>Kaufpreisformel wird schon im Optionsvertrag festgelegt</li><li>Landwirtschaftlicher Referenzwert plus Standort- und Erfolgsprämie</li><li>Mindest- und Höchstpreis schaffen Planungssicherheit für beide Seiten</li><li>Nur die tatsächlich benötigte Fläche wird verkauft</li></ul></article>
  </div>
  <p class="note">Warum wird der Preis so früh vereinbart? Damit beide Seiten Planungssicherheit haben. Sie wissen vor Beginn der Entwicklung, was Sie bei Erfolg erhalten, und niemand verhandelt nach Jahren der Arbeit unter neuen Vorzeichen.</p>
</div></section>

<section class="section section-ink"><div class="wrap split">
  <div><h2>Was der Projektentwickler trägt</h2>
  <p>Bis zur Baureife entstehen erhebliche Kosten für Planung, Netzanschluss, Gutachten, Genehmigungen, Rechtsberatung und Finanzierungsvorbereitung. Die Investition in die Anlage selbst liegt bei mehreren Millionen Euro. All das trägt der Projektentwickler beziehungsweise die Projektgesellschaft – nicht der Eigentümer.</p></div>
  <dl class="facts facts-light">
    <div><dt>Entwicklung</dt><dd>Planung, Netzanschlussprüfung, Gutachten, Genehmigung</dd></div>
    <div><dt>Investition</dt><dd>Batteriesysteme, Technik, Bau, Netzanschluss</dd></div>
    <div><dt>Betrieb</dt><dd>Wartung, Versicherung, Überwachung, Vermarktung</dd></div>
    <div><dt>Ende der Laufzeit</dt><dd>Rückbau, abgesichert vor Baubeginn</dd></div>
  </dl>
</div></section>

<section class="section"><div class="wrap narrow">
  <h2>Häufige Fragen</h2>
  <div class="faq">${FAQ_OWNER.map(([q, a]) => html`<details><summary>${q}</summary><p>${a}</p></details>`)}</div>
  <p class="small muted">Diese Seite gibt einen allgemeinen Überblick. Verbindlich ist allein der unterzeichnete Vertrag. Wir machen keine Preis- oder Pachtzusagen über diese Website.</p>
</div></section>

<section class="section section-tint"><div class="wrap contact-cta">
  <div><h2>Erste Einschätzung zu Ihrer Fläche</h2><p>Ein paar Angaben genügen. Flurstücksdaten und Unterlagen sind freiwillig.</p>
  ${(() => { const r = brand.regions.find((x) => x.id === 'nord'); return r?.contactName ? html`<p class="contact-person"><strong>Ihr Ansprechpartner in Norddeutschland:</strong> ${r.contactName}, ${r.contactRole}${r.phone ? html` · ${r.phone}` : ''}${r.email ? html` · <a href="mailto:${r.email}">${r.email}</a>` : ''}</p>` : ''; })()}</div>
  <div class="cta-row"><a class="btn btn-solid btn-lg" href="/standort-anbieten">Fläche anbieten</a><a class="btn btn-line btn-lg" href="/kontakt">Persönlich sprechen</a></div>
</div></section>`;
  const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ_OWNER.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
  return page({ path: '/grundstueckseigentuemer', title: 'Grundstück für Batteriespeicher verpachten', description: 'Batteriespeicher auf Ihrer Fläche: Optionsvertrag, Vergütung ab der Entwicklungsphase, langfristige Pacht oder Verkauf, Rückbau abgesichert. Entwicklungskosten trägt der Projektentwickler.', body, jsonld: faqLd });
}

// ---------------- Formular Fläche anbieten ----------------
export function standortAnbieten({ errors = {}, values = {} } = {}) {
  const v = (k) => values[k] || '';
  const err = (k) => errors[k] ? html`<p class="field-err" id="${k}-err">${errors[k]}</p>` : '';
  const inv = (k) => errors[k] ? raw(` aria-invalid="true" aria-describedby="${k}-err"`) : '';
  const body = html`
<section class="page-head"><div class="wrap narrow">
  <h1>Fläche anbieten</h1>
  <p class="lead">Wir prüfen, ob Ihre Fläche für einen Batteriespeicher in Frage kommt, und melden uns persönlich. Aus dieser Anfrage entsteht kein Angebot und keine Verpflichtung.</p>
</div></section>
<section class="section"><div class="wrap narrow">
  ${Object.keys(errors).length ? html`<div class="alert" role="alert">Bitte prüfen Sie die markierten Felder.</div>` : ''}
  <form class="form" method="post" action="/standort-anbieten" enctype="multipart/form-data" novalidate>
    <input type="hidden" name="_t" value="${formToken()}">
    <div class="hp" aria-hidden="true"><label>Firma <input name="firma" tabindex="-1" autocomplete="off"></label></div>
    <fieldset><legend>Kontakt</legend>
      <div class="field"><label for="name">Name</label><input id="name" name="name" autocomplete="name" required value="${v('name')}"${inv('name')}>${err('name')}</div>
      <div class="field-row">
        <div class="field"><label for="email">E-Mail</label><input id="email" name="email" type="email" autocomplete="email" value="${v('email')}"${inv('email')}>${err('email')}</div>
        <div class="field"><label for="phone">Telefon</label><input id="phone" name="phone" type="tel" autocomplete="tel" value="${v('phone')}"></div>
      </div>
      <p class="hint">Bitte geben Sie mindestens E-Mail oder Telefon an.</p>
    </fieldset>
    <fieldset><legend>Fläche</legend>
      <div class="field"><label for="lage">Lage (Gemeinde, Ortsteil oder Beschreibung)</label><input id="lage" name="lage" required value="${v('lage')}"${inv('lage')}>${err('lage')}</div>
      <div class="field"><label for="flurstueck">Gemarkung, Flur, Flurstück <span class="opt">freiwillig</span></label><input id="flurstueck" name="flurstueck" value="${v('flurstueck')}"></div>
      <div class="field-row">
        <div class="field"><label for="flaeche">Ungefähre Fläche in Hektar <span class="opt">freiwillig</span></label><input id="flaeche" name="flaeche" inputmode="decimal" value="${v('flaeche')}"></div>
        <div class="field"><label for="nutzung">Bisherige Nutzung</label><select id="nutzung" name="nutzung">${['Acker', 'Grünland', 'Brache', 'Gewerbefläche', 'Sonstiges'].map((o) => html`<option${v('nutzung') === o ? raw(' selected') : ''}>${o}</option>`)}</select></div>
      </div>
      <div class="field"><label for="umspannwerk">Nähe zu Umspannwerk oder Hochspannungsleitung</label><select id="umspannwerk" name="umspannwerk">${['Weiß ich nicht', 'unter 1 km', '1 bis 3 km', '3 bis 5 km', 'über 5 km'].map((o) => html`<option${v('umspannwerk') === o ? raw(' selected') : ''}>${o}</option>`)}</select></div>
      <div class="field"><label for="nachricht">Nachricht <span class="opt">freiwillig</span></label><textarea id="nachricht" name="nachricht" rows="4">${v('nachricht')}</textarea></div>
      <div class="field"><label for="datei">Unterlage, z. B. Lageplan <span class="opt">freiwillig, PDF/JPG/PNG bis 10 MB</span></label><input id="datei" name="datei" type="file" accept=".pdf,.jpg,.jpeg,.png">${err('datei')}</div>
    </fieldset>
    <div class="field check"><input id="dsgvo" name="dsgvo" type="checkbox" value="ja"${v('dsgvo') ? raw(' checked') : ''}${inv('dsgvo')}><label for="dsgvo">Ich bin einverstanden, dass meine Angaben zur Bearbeitung dieser Anfrage gespeichert werden. Hinweise in der <a href="/datenschutz">Datenschutzerklärung</a>.</label>${err('dsgvo')}</div>
    <button class="btn btn-solid btn-lg" type="submit">Anfrage senden</button>
  </form>
</div></section>`;
  return page({ path: '/standort-anbieten', title: 'Fläche für Batteriespeicher anbieten', description: 'Bieten Sie eine Fläche in Netznähe für einen Batterie-Großspeicher an. Wir prüfen die Eignung und melden uns persönlich – unverbindlich.', body });
}

// ---------------- Investoren ----------------
export function investoren() {
  const body = html`
<section class="page-head"><div class="wrap">
  <h1>Für Investoren und Finanzierungspartner</h1>
  <p class="lead">Wir entwickeln Batteriespeicher in eigenständigen Projektgesellschaften – mit dokumentierten Entwicklungsschritten, klarer Risikoverteilung und kontrolliertem Zugang zu Projektunterlagen.</p>
</div></section>
<section class="section"><div class="wrap inv-grid">
  <article><h2>Projektentwicklung</h2><p>Standortsicherung, Netzanschluss und Genehmigung werden nach einem einheitlichen Verfahren mit definierten Prüfpunkten bearbeitet. Der Entwicklungsstand jedes Projekts ist im Datenraum nachvollziehbar.</p></article>
  <article><h2>Eigenständige Projektgesellschaften</h2><p>Jeder Standort wird in einer eigenen Gesellschaft gebündelt. Flächenrechte, Netzanschlusszusage, Genehmigungen und Lieferverträge liegen dort, wo auch die Finanzierung ansetzt.</p></article>
  <article><h2>Netzanschluss als Werttreiber</h2><p>Gesicherte Netzanschlusskapazität ist im heutigen Markt der knappste Faktor. Wir priorisieren Standorte, an denen ein Anschluss technisch und zeitlich realistisch ist.</p></article>
  <article><h2>Projektfinanzierung</h2><p>Die Finanzierung erfolgt auf Ebene der Projektgesellschaft mit Eigen- und Fremdkapital. Struktur und Zeitpunkt richten sich nach dem Reifegrad des einzelnen Projekts.</p></article>
  <article><h2>Risikomanagement</h2><p>Netz-, Genehmigungs-, Technologie-, Markt- und Betriebsrisiken werden je Projekt erfasst, bewertet und mit Status und Quelle dokumentiert – nicht pauschal.</p></article>
  <article><h2>Technik und Betrieb</h2><p>Herstellerauswahl, Garantien, Wartungsverträge und Betriebsführung werden projektbezogen ausgeschrieben und bewertet. Technische Partner nennen wir nach Vertragsschluss.</p></article>
</div></section>
<section class="section section-ink"><div class="wrap split">
  <div><h2>Geschützter Datenraum</h2>
  <p>Projektunterlagen, Wirtschaftlichkeitsmodelle und Finanzierungsunterlagen stellen wir ausschließlich im geschützten Investorenportal bereit. Jeder Zugang ist auf die Projekte beschränkt, für die er ausdrücklich freigeschaltet wurde. Downloads werden protokolliert, Finanzkennzahlen tragen Status, Quelle, Stand und Annahmen.</p>
  <p><a class="btn btn-light" href="/portal/login">Zum Investorenportal</a></p></div>
  <dl class="facts facts-light"><div><dt>Zugang</dt><dd>nur nach Freischaltung, mit Zwei-Faktor-Anmeldung</dd></div><div><dt>Sichtbarkeit</dt><dd>je Projekt und Investor getrennt</dd></div><div><dt>Nachvollziehbarkeit</dt><dd>Versionen und Downloadprotokoll</dd></div></dl>
</div></section>
<section class="section"><div class="wrap narrow">
  <h2>Gespräch vereinbaren</h2>
  <p>Wir veröffentlichen auf dieser Website keine Renditen, Investitionskosten oder Standortdaten. Für einen Austausch zu Investitions- und Finanzierungsmöglichkeiten nehmen Sie bitte Kontakt auf.</p>
  <p><a class="btn btn-solid" href="/kontakt?anliegen=investition">Kontakt aufnehmen</a></p>
</div></section>`;
  return page({ path: '/investoren', title: 'Großbatteriespeicher Investition', description: 'BESS-Projektentwicklung für Investoren und Banken: eigenständige Projektgesellschaften, Netzanschluss als Werttreiber, Projektfinanzierung, Risikomanagement und geschützter Datenraum.', body });
}

// ---------------- Kommunen ----------------
export function kommunen() {
  const body = html`
<section class="page-head"><div class="wrap">
  <h1>Batteriespeicher für Kommunen</h1>
  <p class="lead">Ein Batteriespeicher ist ein Baustein regionaler Energieinfrastruktur. Wir planen ihn so, dass er zur Gemeinde passt – und sprechen früh mit Verwaltung, Gemeindevertretung und Feuerwehr.</p>
</div></section>
<section class="section"><div class="wrap">${illus('kommunale-infrastruktur.svg', 'Gemeinde mit Ortsnetz, Feuerwehr, Schule und einem Speicher am Ortsrand; gestrichelt dargestellt sind optionale Komponenten für eine Inselnetzversorgung', 'Netzgekoppelter Speicher; Notstromfähigkeit nur mit zusätzlicher Ausrüstung.', 'illus-wide')}</div></section>
<section class="section"><div class="wrap tech-grid">
  <article><h2>Integration erneuerbarer Energien</h2><p>Speicher nehmen Strom aus Wind- und Solaranlagen auf, wenn das Netz ihn nicht abtransportieren kann, und senken so Abregelungen in der Region.</p></article>
  <article><h2>Netzflexibilität</h2><p>Speicher stellen schnell regelbare Leistung bereit. Das unterstützt den Netzbetrieb, ersetzt aber nicht den Ausbau der Netze.</p></article>
  <article><h2>Standortentwicklung</h2><p>Wir stimmen Standort, Zufahrt und Eingrünung mit der Gemeinde ab und klären die planungsrechtliche Einordnung gemeinsam mit Bauaufsicht und Gemeinde.</p></article>
  <article><h2>Flächenschonende Anlagenkonzepte</h2><p>Kompakte Aufstellung, Schottertragschicht statt Vollversiegelung, wo der Baugrund es zulässt, und Erhalt bestehender Knicks und Gehölze.</p></article>
  <article><h2>Brandschutz</h2><p>Für jede Anlage gibt es ein Brandschutzkonzept, das mit Bauaufsicht und Feuerwehr abgestimmt wird. Vor Inbetriebnahme weisen wir die örtliche Feuerwehr ein und stellen Einsatzunterlagen bereit.</p></article>
  <article><h2>Lärmschutz</h2><p>Ein Schallgutachten weist die Einhaltung der Immissionsrichtwerte nach. Abstände, Aufstellung und Komponentenwahl richten sich danach.</p></article>
  <article><h2>Kommunale Abstimmung</h2><p>Wir stellen Projekte im Ausschuss vor, beantworten Fragen der Anwohner und informieren regelmäßig über den Planungsstand – auf Wunsch über ein geschütztes Partnerportal.</p></article>
  <article><h2>Resilienz und Notstrom</h2><p>Ein üblicher netzgekoppelter Speicher schaltet sich bei einem Netzausfall ab und versorgt dann keine Gebäude. Eine Notstrom- oder Inselnetzversorgung, etwa für Feuerwehr oder Notunterkunft, braucht zusätzliche Technik, ein eigenes Schutzkonzept und die Zustimmung des Netzbetreibers. Ob das an einem Standort sinnvoll ist, prüfen wir gern gemeinsam – als eigenes Vorhaben.</p></article>
</div></section>
<section class="section section-tint"><div class="wrap contact-cta">
  <div><h2>Frühzeitig sprechen</h2><p>Sie möchten wissen, ob in Ihrer Gemeinde ein Speicherprojekt geprüft wird, oder haben einen Standortvorschlag? Wir kommen gern zu einem Gespräch.</p></div>
  <div class="cta-row"><a class="btn btn-solid btn-lg" href="/kontakt?anliegen=kommune">Kontakt für Kommunen</a></div>
</div></section>`;
  return page({ path: '/kommunen', title: 'Batterie-Großspeicher für Kommunen', description: 'Batteriespeicher als regionale Energieinfrastruktur: Integration erneuerbarer Energien, Brand- und Lärmschutz, kommunale Abstimmung und Unterschied zwischen Netzspeicher und Notstromversorgung.', body });
}

// ---------------- Projekte ----------------
export function projekte() {
  const list = publicProjects();
  const body = html`
<section class="page-head"><div class="wrap">
  <h1>Projekte</h1>
  <p class="lead">Hier stellen wir Projekte vor, sobald die Beteiligten der Veröffentlichung zugestimmt haben. Standorte in früher Prüfung veröffentlichen wir zum Schutz von Eigentümern und Verhandlungen nicht.</p>
</div></section>
<section class="section"><div class="wrap">
  ${list.length
    ? html`<ul class="proj-list">${list.map((p) => html`<li><h2>${p.name}</h2><p class="muted">${p.region}</p><p>Projektphase ${p.phase}: ${PHASES[p.phase - 1]?.[0]}</p><p>${p.summary}</p></li>`)}</ul>`
    : html`<div class="empty"><h2>Derzeit sind keine Projekte zur Veröffentlichung freigegeben.</h2><p>Mehrere Standorte befinden sich in der Entwicklung. Wenn Sie als Eigentümer, Gemeinde oder Investor beteiligt sind, finden Sie den aktuellen Stand im geschützten Portal.</p><p><a class="btn btn-line" href="/portal/login">Zum Portal</a> <a class="btn btn-solid" href="/standort-anbieten">Fläche anbieten</a></p></div>`}
</div></section>`;
  return page({ path: '/projekte', title: 'Projekte', description: 'Öffentlich freigegebene Batteriespeicher-Projekte. Standorte in früher Entwicklung werden zum Schutz der Beteiligten nicht veröffentlicht.', body });
}

// ---------------- Kontakt ----------------
const ANLIEGEN = [['flaeche', 'Ich biete eine Fläche an'], ['eigentuemer', 'Frage als Grundstückseigentümer'], ['kommune', 'Anfrage einer Kommune'], ['investition', 'Investition und Finanzierung'], ['technik', 'Technische Partnerschaft'], ['sonstiges', 'Sonstiges']];
export function kontakt({ errors = {}, values = {}, anliegen } = {}) {
  const v = (k) => values[k] || '';
  const sel = values.anliegen || anliegen || 'eigentuemer';
  const err = (k) => errors[k] ? html`<p class="field-err" id="${k}-err">${errors[k]}</p>` : '';
  const inv = (k) => errors[k] ? raw(` aria-invalid="true" aria-describedby="${k}-err"`) : '';
  const body = html`
<section class="page-head"><div class="wrap">
  <h1>Kontakt</h1>
  <p class="lead">Wir antworten persönlich. Für Grundstücksfragen in Norddeutschland ist die regionale Koordination Ihr direkter Ansprechpartner.</p>
</div></section>
<section class="section"><div class="wrap split">
  <div>
    <h2>Regionale Ansprechpartner</h2>
    <ul class="people">${brand.regions.map((r) => html`<li><h3>${r.name}</h3><p class="muted small">${r.area}</p><p>${r.contactRole}${r.status === 'besetzt' ? html`<br><strong>${r.contactName}</strong>${r.phone ? html`<br>Telefon: ${r.phone}` : ''}${r.email ? html`<br>E-Mail: <a href="mailto:${r.email}">${r.email}</a>` : html`<br><span class="muted small">Erreichbar über das Kontaktformular oder die Zentrale</span>`}` : html`<br><em>Funktion im Aufbau – Anfragen bearbeitet die Zentrale</em>`}</p></li>`)}</ul>
    <h2>Zentrale</h2>
    <p>${brand.legal.operator}<br>${brand.legal.address.map((l) => html`${l}<br>`)}E-Mail: ${brand.contact.email}<br>Telefon: ${brand.contact.phone}</p>
  </div>
  <div>
    <h2>Nachricht senden</h2>
    ${Object.keys(errors).length ? html`<div class="alert" role="alert">Bitte prüfen Sie die markierten Felder.</div>` : ''}
    <form class="form" method="post" action="/kontakt" novalidate>
      <input type="hidden" name="_t" value="${formToken()}">
      <div class="hp" aria-hidden="true"><label>Firma <input name="firma" tabindex="-1" autocomplete="off"></label></div>
      <div class="field"><label for="anliegen">Anliegen</label><select id="anliegen" name="anliegen">${ANLIEGEN.map(([k, l]) => html`<option value="${k}"${sel === k ? raw(' selected') : ''}>${l}</option>`)}</select></div>
      <div class="field"><label for="name">Name</label><input id="name" name="name" autocomplete="name" value="${v('name')}"${inv('name')}>${err('name')}</div>
      <div class="field"><label for="org">Organisation <span class="opt">freiwillig</span></label><input id="org" name="org" autocomplete="organization" value="${v('org')}"></div>
      <div class="field-row"><div class="field"><label for="email">E-Mail</label><input id="email" name="email" type="email" autocomplete="email" value="${v('email')}"${inv('email')}>${err('email')}</div><div class="field"><label for="phone">Telefon <span class="opt">freiwillig</span></label><input id="phone" name="phone" type="tel" autocomplete="tel" value="${v('phone')}"></div></div>
      <div class="field"><label for="nachricht">Nachricht</label><textarea id="nachricht" name="nachricht" rows="5"${inv('nachricht')}>${v('nachricht')}</textarea>${err('nachricht')}</div>
      <div class="field check"><input id="dsgvo" name="dsgvo" type="checkbox" value="ja"${v('dsgvo') ? raw(' checked') : ''}${inv('dsgvo')}><label for="dsgvo">Ich bin einverstanden, dass meine Angaben zur Bearbeitung gespeichert werden. Hinweise in der <a href="/datenschutz">Datenschutzerklärung</a>.</label>${err('dsgvo')}</div>
      <button class="btn btn-solid btn-lg" type="submit">Nachricht senden</button>
    </form>
  </div>
</div></section>`;
  return page({ path: '/kontakt', title: 'Kontakt', description: 'Kontakt und regionale Ansprechpartner für Grundstückseigentümer, Kommunen, Investoren und technische Partner.', body });
}

export function danke(kind) {
  const body = html`<section class="page-head"><div class="wrap narrow">
  <h1>Vielen Dank – Ihre ${kind === 'flaeche' ? 'Anfrage' : 'Nachricht'} ist bei uns eingegangen.</h1>
  <p class="lead">Wir melden uns persönlich bei Ihnen, in der Regel innerhalb weniger Werktage. ${kind === 'flaeche' ? 'Aus der Anfrage entsteht kein Angebot und keine Verpflichtung.' : ''}</p>
  <p><a class="btn btn-line" href="/">Zur Startseite</a></p></div></section>`;
  return page({ path: '/danke', title: 'Vielen Dank', description: 'Bestätigung Ihrer Anfrage.', body });
}

export function impressum() {
  const body = html`<section class="page-head"><div class="wrap narrow"><h1>Impressum</h1><p class="draft">Entwurf – Angaben werden nach Festlegung des Rechtsträgers ergänzt und rechtlich geprüft.</p></div></section>
<section class="section"><div class="wrap narrow prose">
<h2>Angaben gemäß § 5 DDG</h2><p>${brand.legal.operator}<br>${brand.legal.address.map((l) => html`${l}<br>`)}</p>
<h2>Vertreten durch</h2><p>${brand.legal.representatives}</p>
<h2>Kontakt</h2><p>Telefon: ${brand.contact.phone}<br>E-Mail: ${brand.contact.email}</p>
<h2>Registereintrag</h2><p>${brand.legal.register}</p>
<h2>Umsatzsteuer-ID</h2><p>${brand.legal.vatId}</p>
<h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2><p>${brand.legal.responsible}</p>
<h2>Projektgesellschaften</h2><p>Die einzelnen Speicherprojekte werden von rechtlich eigenständigen Projektgesellschaften getragen. Deren Angaben werden genannt, sobald die Gesellschaften gegründet sind.</p>
<h2>Bildnachweis</h2><p>Alle Illustrationen sind eigene, beispielhafte Darstellungen. Sie zeigen keine gebauten Anlagen.</p>
</div></section>`;
  return page({ path: '/impressum', title: 'Impressum', description: 'Impressum', body });
}

export function datenschutz() {
  const body = html`<section class="page-head"><div class="wrap narrow"><h1>Datenschutzerklärung</h1><p class="draft">Entwurf – vor Veröffentlichung durch eine fachkundige Stelle zu prüfen und zu ergänzen.</p></div></section>
<section class="section"><div class="wrap narrow prose">
<h2>Verantwortlicher</h2><p>${brand.legal.operator}, ${brand.legal.address.join(', ')}, E-Mail: ${brand.contact.email}</p>
<h2>Welche Daten wir verarbeiten</h2><p>Beim Besuch der Website verarbeitet der Server technisch notwendige Verbindungsdaten. Wir setzen keine Analyse- oder Werbe-Cookies und binden keine externen Schriften, Karten oder Tracking-Dienste ein.</p>
<h2>Kontakt- und Flächenanfragen</h2><p>Angaben aus den Formularen (Name, Kontaktdaten, Angaben zur Fläche, freiwillige Unterlagen) verwenden wir ausschließlich zur Bearbeitung Ihrer Anfrage. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (vorvertragliche Maßnahmen) bzw. lit. a (Einwilligung). Wir erheben nur die Angaben, die für eine erste Einschätzung nötig sind; Flurstücksdaten und Unterlagen sind freiwillig.</p>
<h2>Speicherdauer</h2><p>[Löschfristen – noch festzulegen; Vorschlag: Anfragen ohne Folgekontakt nach 12 Monaten löschen.]</p>
<h2>Portal</h2><p>Für das geschützte Portal verwenden wir ein technisch notwendiges Sitzungs-Cookie. Zugriffe auf Dokumente werden zur Nachvollziehbarkeit protokolliert.</p>
<h2>Ihre Rechte</h2><p>Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch sowie das Recht auf Beschwerde bei einer Aufsichtsbehörde.</p>
</div></section>`;
  return page({ path: '/datenschutz', title: 'Datenschutz', description: 'Datenschutzerklärung', body });
}

export function notFound() {
  const body = html`<section class="page-head"><div class="wrap narrow"><h1>Diese Seite gibt es nicht.</h1><p class="lead">Vielleicht hilft Ihnen die Startseite oder der Kontakt weiter.</p><p><a class="btn btn-solid" href="/">Zur Startseite</a> <a class="btn btn-line" href="/kontakt">Kontakt</a></p></div></section>`;
  return page({ path: '/404', title: 'Seite nicht gefunden', description: '', body });
}

export const PUBLIC_ROUTES = {
  '/': home, '/unternehmen': unternehmen, '/technologie': technologie, '/standortentwicklung': standortentwicklung,
  '/grundstueckseigentuemer': eigentuemer, '/investoren': investoren, '/kommunen': kommunen, '/projekte': projekte,
  '/impressum': impressum, '/datenschutz': datenschutz,
};
