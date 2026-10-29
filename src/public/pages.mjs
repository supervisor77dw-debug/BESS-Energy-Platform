import { html, raw } from '../lib/html.mjs';
import { brand, realDomain } from '../config.mjs';
import { page, illus, photo, band, picture } from './layout.mjs';
import { heroSvg } from '../../tools/illustrations.mjs';
import { publicProjects } from '../lib/policy.mjs';
import { formToken } from '../lib/http.mjs';

const HERO = heroSvg({ inline: true });

export const PHASES = [
  ['Standortidentifikation', 'Wir suchen Flächen in sinnvoller Entfernung zu Umspannwerken und leistungsfähigen Netzen und prüfen Lage, Zuwegung, Schutzgebiete und Nachbarschaft.'],
  ['Grundstückssicherung', 'Mit dem Eigentümer schließen wir einen Flächensicherungs- und Optionsvertrag. Er regelt Exklusivität, Optionsvergütung und die Bedingungen für eine spätere Nutzung oder einen Kauf.'],
  ['Netzanschlussprüfung', 'Wir stellen die Netzanschlussanfrage und klären mit dem Netzbetreiber Kapazität, Anschlusspunkt, Kosten einschließlich Baukostenzuschuss und Zeitplan.'],
  ['Genehmigungsplanung', 'Bauvoranfrage oder Bauantrag, Gutachten zu Schall, Boden, Natur und Brandschutz, Abstimmung mit Gemeinde und Behörden. Netzanschluss und Genehmigung laufen in der Regel parallel.'],
  ['Wirtschaftlichkeitsprüfung', 'Auslegung, Systempreise, Netzkosten und Vermarktungsszenarien werden zu einem prüfbaren Modell zusammengeführt – mit dokumentierten Annahmen.'],
  ['Finanzierung', 'Die Projektgesellschaft wird mit Eigen- und Fremdkapital ausgestattet. Investitionsentscheidung und Finanzierungsabschluss fallen erst, wenn Netzanschluss und Genehmigung gesichert sind.'],
  ['Bau', 'Tiefbau, Fundamente, Lieferung und Montage der Systeme, Netzanschluss und Prüfungen – ausgeführt von spezialisierten Partnern unter Koordination der Projektgesellschaft.'],
  ['Inbetriebnahme', 'Abnahmen, Prüfungen nach den Vorgaben des Netzbetreibers, Einweisung der Feuerwehr und Aufnahme des kommerziellen Betriebs.'],
  ['Betrieb', 'Fernüberwachung rund um die Uhr, Wartung, Vermarktung der Speicherleistung und regelmäßige Information der Beteiligten.'],
  ['Rückbau oder Repowering', 'Am Ende der Laufzeit wird die Anlage vollständig zurückgebaut oder – nach neuer Vereinbarung – modernisiert.'],
];

const ORG_LD = { '@context': 'https://schema.org', '@type': 'Organization', name: brand.name, ...(realDomain() ? { url: realDomain() } : {}), description: `${brand.claim}.` };

// ---------------- Startseite ----------------
export function home() {
  const heroPic = picture('hero', 'Visualisierung: Batteriespeicheranlage mit Containerreihen auf einer Schotterfläche zwischen Knicks, im Hintergrund ein Umspannwerk und Windenergieanlagen in norddeutscher Agrarlandschaft', { eager: true });
  const body = html`
<section class="hero${heroPic ? ' hero-photo' : ''}">
  <div class="hero-art">${heroPic || raw(HERO)}</div>
  <div class="wrap hero-copy">
    <h1>Batteriespeicher dort entwickeln, wo das Netz sie braucht.</h1>
    <p class="lead">${brand.name} ist eine Plattform für netzgekoppelte Batterie-Großspeicher in Deutschland. Wir sichern geeignete Flächen in Netznähe, führen Netzanschluss, Genehmigung und Finanzierung zusammen und realisieren jedes Projekt in einer eigenen Projektgesellschaft – mit qualifizierten Partnern für Bau und Betrieb.</p>
    <div class="hero-actions">
      <a class="btn btn-solid btn-lg" href="/grundstueckseigentuemer">Informationen für Eigentümer</a>
      <a class="btn btn-line btn-lg" href="/standortentwicklung">So entsteht ein Speicherprojekt</a>
    </div>
  </div>
  <p class="wrap hero-note small">${heroPic ? 'Visualisierung einer Beispielanlage. Sie zeigt keinen realen Standort.' : 'Beispielhafte Illustration. Sie zeigt keine gebaute Anlage.'}</p>
</section>

<section class="section chain-sec">
  <div class="wrap">
    <h2 class="h-section">Vom Feldrand bis zum Netzbetrieb</h2>
    <ol class="chain">
      <li><h3>Fläche sichern</h3><p>Optionsvertrag mit dem Eigentümer – fair vergütet, mit vorab festgelegten Bedingungen.</p></li>
      <li><h3>Netzanschluss klären</h3><p>Anfrage, Kapazität und Anschlusspunkt mit dem Netzbetreiber. Er bestimmt den Takt.</p></li>
      <li><h3>Genehmigen</h3><p>Gutachten zu Schall, Brandschutz, Boden und Natur; Abstimmung mit Gemeinde und Behörden.</p></li>
      <li><h3>Finanzieren</h3><p>Eigen- und Fremdkapital auf Ebene der Projektgesellschaft, erst bei gesicherten Grundlagen.</p></li>
      <li><h3>Realisieren</h3><p>Bau, Inbetriebnahme und Betrieb mit spezialisierten Partnern unter einheitlicher Steuerung.</p></li>
    </ol>
  </div>
</section>

<section class="band">
  <div class="wrap split">
    <div>
      <h2>Eine Plattform, eine Gesellschaft je Standort</h2>
      <p>${brand.name} ist die Dachplattform: Hier liegen Verfahren, Planung, Einkauf und Koordination. Entwickelt wird regional, mit Ansprechpartnern vor Ort. Jedes Speicherprojekt erhält bei Projektreife eine eigene Projektgesellschaft. So bleiben Verträge, Finanzierung und Haftung je Standort sauber getrennt.</p>
      <p><a class="link" href="/unternehmen">Mehr zum Entwicklungsmodell</a></p>
    </div>
    <dl class="facts">
      <div><dt>Wer trägt die Entwicklungskosten?</dt><dd>Der Projektentwickler – auch wenn ein Projekt nicht realisiert wird.</dd></div>
      <div><dt>Was erhält der Eigentümer?</dt><dd>Eine Optionsvergütung während der Entwicklung und bei Realisierung eine langfristige Nutzungsvergütung oder einen vorab geregelten Kaufpreis.</dd></div>
      <div><dt>Wie lange dauert die Entwicklung?</dt><dd>Meist mehrere Jahre. Netzanschluss und Genehmigung bestimmen den Zeitplan.</dd></div>
    </dl>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2 class="h-section">Warum Batteriespeicher gebraucht werden</h2>
    <div class="cols-3">
      <article><h3>Erneuerbare besser nutzen</h3><p>In windreichen oder sonnigen Stunden wird oft mehr Strom erzeugt als gebraucht oder abtransportiert werden kann. Speicher verschieben Energie in Stunden mit Bedarf und können Abregelungen verringern – wo Netzsituation und Betriebsweise es zulassen.</p></article>
      <article><h3>Netz stabil halten</h3><p>Batteriespeicher reagieren in Sekundenbruchteilen. Sie können Regelleistung bereitstellen, die Netzfrequenz stützen und kurzfristige Schwankungen ausgleichen.</p></article>
      <article><h3>Flexibilität schaffen</h3><p>Mit wachsendem Anteil von Wind- und Solarstrom braucht das Stromsystem regelbare Leistung. Speicher liefern sie ohne Brennstoff und ohne Emissionen am Standort. Den Netzausbau ersetzen sie nicht.</p></article>
    </div>
  </div>
</section>

<section class="section section-tint">
  <div class="wrap split split-media">
    ${photo('feld', 'Visualisierung: Blick über ein Getreidefeld auf eine Speicheranlage hinter einem Knick, links ein Umspannwerk', 'Der Knick am Feldrand bleibt erhalten und schirmt die Anlage ab.') || illus('luftbild-umspannwerk.svg', 'Draufsicht: Speicheranlage auf einer Ackerfläche, über ein Erdkabel mit dem nahen Umspannwerk verbunden', 'Kurze Wege zum Umspannwerk senken Kosten und Eingriffe.')}
    <div>
      <h2>Standorte nahe am Netz</h2>
      <p>Ein guter Speicherstandort liegt nahe einem Umspannwerk oder einer leistungsfähigen Leitung, ist gut erreichbar und fügt sich in die Landschaft ein. Wir prüfen jede Fläche einzeln – von der Netzkapazität bis zur Eingrünung.</p>
      <ul class="ticks">
        <li>Flächen von etwa einem bis mehreren Hektar, je nach Leistung und Speicherkapazität</li>
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
      <a class="aud" href="/grundstueckseigentuemer"><h3>Grundstückseigentümer</h3><p>Optionsvertrag, Vergütung ab der Entwicklungsphase, langfristige Nutzung oder Verkauf – nachvollziehbar erklärt.</p><span class="aud-go">Für Eigentümer</span></a>
      <a class="aud" href="/kommunen"><h3>Gemeinden und Kreise</h3><p>Frühe Abstimmung, Brand- und Schallschutz, Flächennutzung und Einbindung in die regionale Energieplanung.</p><span class="aud-go">Für Kommunen</span></a>
      <a class="aud" href="/investoren"><h3>Investoren und Banken</h3><p>Eigenständige Projektgesellschaften, dokumentierte Entwicklung, offen benannte Projektrisiken.</p><span class="aud-go">Für Investoren</span></a>
    </div>
  </div>
</section>

<section class="section section-ink">
  <div class="wrap split split-media">
    <div>
      <h2>Technik, die wir offenlegen</h2>
      <p>Batteriesysteme, Wechselrichter, Transformatoren, Brandschutz und Betriebsführung: Wir erklären, wie eine Anlage funktioniert, welche Sicherheitsvorkehrungen dazugehören und wo ihre Grenzen liegen.</p>
      <p><a class="link link-light" href="/technologie">Batteriespeicher und Technologie</a></p>
    </div>
    ${photo('modul', 'Visualisierung: Reihe modularer Batteriecontainer mit Wartungstüren, Klimageräten an der Stirnseite, Typschildern und bodengleichen Kabelkanalabdeckungen', 'Batteriecontainer mit Klimatisierung und Leistungselektronik. Herstellerneutrale Darstellung.', { cls: 'photo-dark' }) || illus('schnitt-batteriesystem.svg', 'Schnitt durch ein Batteriesystem mit Modulen, Batteriemanagement, Klimatisierung, Brandschutz, Wechselrichter und Transformator', 'Aufbau eines containerisierten Systems.', 'illus-dark')}
  </div>
</section>

<section class="cta-photo">
  ${picture('netz', '', { sizes: '100vw' })}
  <div class="wrap contact-cta">
    <div>
      <h2>Sie haben eine Fläche in Netznähe?</h2>
      <p>Schicken Sie uns ein paar Angaben. Wir melden uns persönlich und sagen Ihnen offen, ob eine Prüfung sinnvoll ist. Die Anfrage verpflichtet Sie zu nichts.</p>
    </div>
    <div class="cta-row"><a class="btn btn-solid btn-lg" href="/standort-anbieten">Fläche anbieten</a><a class="btn btn-line btn-lg" href="/kontakt">Ansprechpartner</a></div>
  </div>
</section>`;
  return page({ path: '/', title: 'Startseite', description: `${brand.name}: Projektentwicklung für Batterie-Großspeicher (BESS) in Deutschland – Flächensicherung, Netzanschluss, Genehmigung, Finanzierung und Realisierung in eigenständigen Projektgesellschaften.`, body, jsonld: ORG_LD });
}

// ---------------- Unternehmen & Netzwerk ----------------
export function unternehmen() {
  const partners = brand.confirmedPartners || [];
  const body = html`
<section class="page-head"><div class="wrap">
  <h1>Unternehmen und Netzwerk</h1>
  <p class="lead">${brand.name} ist eine Plattform für die Entwicklung netzgekoppelter Batteriespeicher. Sie verbindet regionale Projektentwicklung mit eigenständigen Projektgesellschaften und spezialisierten Partnern für Bau, Technik und Betrieb.</p>
</div></section>
${band('investor', 'Visualisierung: großflächige Speicheranlage mit beleuchteten Containerreihen in der Abenddämmerung, daneben ein Umspannwerk mit abgehender Freileitung', 'Großspeicher als langfristige Energieinfrastruktur. Beispielanlage, kein realer Standort.')}
<section class="section"><div class="wrap split">
  <div>
    <h2>Drei Ebenen, klare Zuständigkeiten</h2>
    <p><strong>Die Dachplattform</strong> legt Verfahren und Standards fest, plant, kauft ein und koordiniert alle Beteiligten.</p>
    <p><strong>Die regionale Projektentwicklung</strong> findet Standorte, spricht mit Eigentümern, Gemeinden und Netzbetreibern und führt das Projekt bis zur Baureife.</p>
    <p><strong>Die Projektgesellschaft</strong> wird für jeden Standort gegründet, sobald das Projekt die nötige Reife hat. Sie schließt die Verträge, wird finanziert und betreibt später die Anlage.</p>
    <p>Diese Trennung ist in der Infrastrukturfinanzierung üblich. Banken und Investoren können jedes Projekt für sich bewerten, und Risiken eines Standorts greifen nicht auf andere über.</p>
  </div>
  <figure class="diagram" aria-labelledby="org-cap">
    <div class="org">
      <div class="org-top"><strong>Plattform ${brand.name}</strong><span>Verfahren · Planung · Einkauf · Koordination</span></div>
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
    <article><h3>Projektentwicklung nach einheitlichem Verfahren</h3><p>Standortbewertung, Flächensicherung, Netzanschluss, Genehmigung und Wirtschaftlichkeit werden nach festen Prüfpunkten bearbeitet und dokumentiert.</p></article>
    <article><h3>Regionale Ansprechpartner</h3><p>Eigentümer und Gemeinden sprechen mit festen Personen aus ihrer Region. Die Koordination für Norddeutschland ist besetzt, Süddeutschland wird aufgebaut.</p></article>
    <article><h3>Realisierung mit Partnern</h3><p>Fachplanung, Gutachten, Lieferung, Bau, Wartung und Vermarktung übernehmen spezialisierte Unternehmen. Die Plattform wählt sie projektbezogen aus und steuert sie.</p></article>
    <article><h3>Langfristige Betriebsführung</h3><p>Ein Speicher ist auf rund zwanzig Jahre Betrieb ausgelegt; einzelne Komponenten werden in dieser Zeit erneuert. Überwachung, Wartung und die Information von Eigentümern und Gemeinden bleiben über die gesamte Laufzeit organisiert.</p></article>
  </div>
</div></section>
<section class="section"><div class="wrap split split-media">
  ${photo('betrieb', 'Visualisierung: Arbeitsplatz in einer Leitwarte mit drei Bildschirmen, die Ladezustand, Leistung und Sicherheitsmeldungen zeigen; durch das Fenster ist die Speicheranlage zu sehen', 'Überwachung aus der Leitwarte. Die Bildschirminhalte sind synthetisch.')}
  <div>
    <h2>Partner</h2>
    ${partners.length
      ? html`<ul class="partner-list">${partners.map((p) => html`<li><a href="${p.url}" rel="noopener">${p.name}</a> – ${p.role}</li>`)}</ul>`
      : html`<p>Wir arbeiten mit Fachplanern, Gutachtern, Herstellern, Bauunternehmen und Finanzierungspartnern zusammen. Namentlich nennen wir Partner erst, wenn die Zusammenarbeit vertraglich vereinbart ist und der Partner der Nennung zugestimmt hat.</p>`}
  </div>
</div></section>`;
  return page({ path: '/unternehmen', title: 'Unternehmen und Netzwerk', description: 'Entwicklungsmodell für Batterie-Großspeicher: Dachplattform, regionale Projektentwicklung, eigenständige Projektgesellschaften je Standort und Realisierung mit spezialisierten Partnern.', body });
}

// ---------------- Technologie ----------------
export function technologie() {
  const body = html`
<section class="page-head"><div class="wrap">
  <h1>Batteriespeicher und Technologie</h1>
  <p class="lead">Ein Batterie-Großspeicher besteht aus vielen Batteriemodulen, Leistungselektronik und einem Netzanschluss. Hier erklären wir, wie die Teile zusammenspielen, wie die Anlage sicher betrieben wird und wo ihre Grenzen liegen.</p>
</div></section>
${band('modul', 'Visualisierung: Gasse zwischen Batteriecontainern mit Wartungstüren, Klimageräten, Signalleuchten und bodengleichen Kabelkanalabdeckungen in der Wartungsgasse', 'Containerisierte Batteriesysteme mit Klimatisierung, Wartungszugang und Leistungselektronik. Herstellerneutrale Darstellung.')}
<section class="section"><div class="wrap">
  ${illus('energiefluss.svg', 'Schema: Wind und Photovoltaik speisen ins Netz, der Speicher lädt bei Überschuss und speist bei Bedarf ein; Verbraucher werden aus dem Netz versorgt', 'Stromflüsse zwischen Erzeugung, Netz, Verbrauch und Speicher.', 'illus-wide')}
</div></section>
<section class="section"><div class="wrap tech-grid">
  <article id="funktion"><h2>Funktionsweise</h2><p>Die Batteriezellen speichern elektrische Energie chemisch. In Großspeichern werden heute überwiegend Lithium-Eisenphosphat-Zellen (LFP) eingesetzt, weil sie thermisch stabiler und langlebiger sind als viele andere Zellchemien. Zellen werden zu Modulen, Module zu Racks und Racks zu Containern oder Außenschränken zusammengefasst.</p></article>
  <article id="laden"><h2>Laden und Entladen</h2><p>Der Speicher lädt, wenn Strom reichlich vorhanden oder günstig ist, und entlädt, wenn das Netz Leistung braucht. Leistung (Megawatt) und Energieinhalt (Megawattstunden) werden getrennt angegeben: Ein Speicher mit 20 MW und 40 MWh kann rechnerisch rund zwei Stunden mit voller Leistung einspeisen – vor Umwandlungsverlusten und innerhalb des nutzbaren Ladefensters.</p></article>
  <article id="netzanschluss"><h2>Netzanschluss</h2><p>Großspeicher werden in der Regel an die Mittel- oder Hochspannung angeschlossen, oft an einem Umspannwerk. Ob, wo und wann ein Anschluss möglich ist, entscheidet der Netzbetreiber nach einer Netzverträglichkeitsprüfung. Der Anschluss ist deshalb der wichtigste Meilenstein jeder Entwicklung.</p></article>
  <article id="wechselrichter"><h2>Wechselrichter und Transformatoren</h2><p>Batterien arbeiten mit Gleichstrom, das Netz mit Wechselstrom. Bidirektionale Wechselrichter (Power Conversion Systems, PCS) wandeln in beide Richtungen. Transformatoren heben die Spannung auf die Netzebene. Schalt- und Schutztechnik trennt die Anlage bei Störungen sicher vom Netz.</p></article>
  <article id="netzstabilitaet"><h2>Netzstabilisierung</h2><p>Speicher können Regelleistung bereitstellen, mit der die Netzfrequenz bei 50 Hertz gehalten wird, und Blindleistung zur Spannungshaltung liefern. Welche Dienste ein Speicher erbringt, hängt von Präqualifikation, Vermarktung und den Vorgaben des Netzbetreibers ab.</p></article>
  <article id="erneuerbare"><h2>Erneuerbare Energien</h2><p>In windreichen Regionen wie Schleswig-Holstein werden Anlagen regelmäßig abgeregelt, weil das Netz den Strom nicht abtransportieren kann. Ein Speicher kann diese Energie aufnehmen und zeitversetzt abgeben – wenn er auf der richtigen Seite des Engpasses steht und netzdienlich betrieben wird. Den Netzausbau ersetzt er nicht.</p></article>
  <article id="betrieb"><h2>Betriebsführung</h2><p>Ein Energiemanagementsystem steuert den Speicher nach Fahrplan und Marktsignalen. Eine Leitwarte überwacht Ladezustand, Temperaturen und Sicherheitstechnik rund um die Uhr und kann die Anlage aus der Ferne abschalten. Vor Ort ist im Normalbetrieb kein Personal nötig.</p></article>
  <article id="sicherheit"><h2>Sicherheit und Brandschutz</h2><p>Jede Anlage erhält ein eigenes Brandschutzkonzept, abgestimmt mit Bauaufsicht und Feuerwehr. Dazu gehören Zellüberwachung durch das Batteriemanagement, Gas- und Rauchdetektion, Druckentlastung der Gehäuse, Abstände oder Brandschutzwände zwischen Einheiten, Zufahrten und ein Löschwasserkonzept. Bewertet werden Prüfnachweise der Hersteller zum Brandverhalten, etwa Ergebnisse nach dem Prüfverfahren UL 9540A. Ein solcher Test beschreibt das Verhalten bei einem Zellbrand unter Laborbedingungen; er ist keine Zertifizierung der gesamten Anlage und ersetzt nicht das Brandschutzkonzept. Vor Inbetriebnahme wird die örtliche Feuerwehr eingewiesen.</p></article>
  <article id="schall"><h2>Schall</h2><p>Klimageräte, Wechselrichter und Transformatoren erzeugen Geräusche. Ein Schallgutachten weist nach, dass die Immissionsrichtwerte der TA Lärm an der nächsten Bebauung eingehalten werden – auch nachts. Wo nötig, helfen Abstand, Schallschutzwände oder leisere Komponenten.</p></article>
  <article id="wartung"><h2>Wartung und Rückbau</h2><p>Wiederkehrende Prüfungen, Austausch von Verschleißteilen und Software-Updates gehören zur Betriebsführung. Am Ende der Laufzeit werden Anlage, Fundamente und Leitungen zurückgebaut, Batterien gehen in die Verwertung. Die Rückbauverpflichtung wird vor Baubeginn vertraglich abgesichert.</p></article>
</div></section>
<section class="section section-tint"><div class="wrap split split-media">
  ${illus('schnitt-batteriesystem.svg', 'Schnitt durch ein Batteriesystem mit Racks, Batteriemanagement, Klimatisierung, Brandschutz, Wechselrichter und Transformator', 'Aufbau eines containerisierten Batteriesystems mit Leistungselektronik.')}
  <div><h2>Aus welchen Komponenten eine Anlage besteht</h2>
  <ul class="ticks"><li>Batteriesysteme in Containern oder Außenschränken</li><li>Wechselrichter (PCS) und Mittelspannungsstationen</li><li>Transformatoren und Übergabestation zum Netzbetreiber</li><li>Energiemanagement, Leittechnik und Kommunikation</li><li>Brandschutz-, Sicherheits- und Zugangstechnik</li><li>Einfriedung, Zufahrt, Kabeltrassen und Eingrünung</li></ul>
  <p class="small muted">Die konkrete Auslegung und Herstellerwahl erfolgt je Projekt nach technischer und wirtschaftlicher Prüfung.</p></div>
</div></section>
<section class="section"><div class="wrap split split-media">
  ${photo('netz', 'Visualisierung: Freiluft-Umspannwerk mit zwei Netztransformatoren mit Radiatoren, Ausdehnungsgefäß und Durchführungen, getrennt durch eine Brandschutzwand; dahinter Portale mit Isolatorketten und Rohrsammelschienen', 'Umspannwerk mit Netztransformatoren: Hier wird ein Großspeicher an das Hoch- oder Mittelspannungsnetz angeschlossen.')}
  <div><h2>Vom Speicher ins Netz</h2><p>Zwischen Batterie und Netz liegen mehrere Stufen: Wechselrichter, Mittelspannungstransformatoren in der Anlage, eine Kabeltrasse und die Übergabe an den Netzbetreiber – häufig in einem bestehenden Umspannwerk. Länge der Trasse und freie Kapazität am Anschlusspunkt bestimmen Kosten und Zeitplan maßgeblich.</p></div>
</div></section>
<section class="section section-tint"><div class="wrap split split-media">
  <div><h2>Überwachung rund um die Uhr</h2><p>Ladezustand, Leistung, Zelltemperaturen und Sicherheitsmeldungen laufen in einer Leitwarte zusammen. Bei Auffälligkeiten greift die Betriebsführung ein – bis zur Abschaltung aus der Ferne. Die Feuerwehr erhält Einsatzunterlagen und eine feste Kontaktstelle.</p></div>
  ${photo('betrieb', 'Visualisierung: Leitstand mit drei Bildschirmen, die Ladezustand, Leistung, Temperaturen und Ereignisse einer Speicheranlage zeigen; durch das Fenster ist die Anlage zu sehen', 'Leitstand mit Fernüberwachung. Synthetische Werte.')}
</div></section>`;
  return page({ path: '/technologie', title: 'Batteriespeicher und Technologie', description: 'Wie Batterie-Großspeicher funktionieren: Laden und Entladen, Netzanschluss, Wechselrichter, Transformatoren, Netzstabilisierung, Brandschutz, Schall, Betriebsführung, Wartung und Rückbau.', body });
}

// ---------------- Standortentwicklung ----------------
export function standortentwicklung() {
  const body = html`
<section class="page-head"><div class="wrap">
  <h1>Standortentwicklung</h1>
  <p class="lead">Vom ersten Blick auf die Karte bis zum laufenden Speicher vergehen meist mehrere Jahre. Jede Phase hat klare Prüfpunkte – und an jedem kann sich zeigen, dass ein Standort nicht geeignet ist.</p>
</div></section>
${band('planung', 'Visualisierung: Draufsicht auf eine Agrarfläche mit Knicks; eingezeichnet sind Entwicklungsfläche, geplante Betriebsfläche, Zufahrt und Kabeltrasse zum nahen Umspannwerk', 'Planungsschema auf einer Beispielfläche: Entwicklungsfläche, Betriebsfläche, Zufahrt und Kabeltrasse.')}
<section class="section"><div class="wrap">
  <ol class="phases">
    ${PHASES.map(([t, d], i) => html`<li class="phase"><span class="phase-n" aria-hidden="true">${i + 1}</span><div><h2 class="phase-t">${t}</h2><p>${d}</p></div></li>`)}
  </ol>
  <p class="small muted">Die Phasen überlappen. Netzanschluss, Genehmigung und Wirtschaftlichkeitsprüfung laufen in der Praxis weitgehend parallel.</p>
</div></section>
<section class="section section-tint"><div class="wrap split split-media">
  ${illus('gruendung-erschliessung.svg', 'Schnitt: Container auf Fundamenten über einer Schottertragschicht, Kabelkanal, Entwässerung, Zufahrt und Brandschutzabstand', 'Gründung und Erschließung werden je Standort geplant.')}
  <div><h2>Flächenschonend bauen – projektbezogen geplant</h2>
  <p>Wir begrenzen die befestigte Fläche auf das, was Statik, Brandschutz und Betrieb verlangen. Häufig stehen die Systeme auf Streifen- oder Punktfundamenten über einer wasserdurchlässigen Schottertragschicht.</p>
  <p>Wie hoch der Versiegelungsgrad tatsächlich ist, hängt vom Baugrund, der Entwässerung, den Zufahrten und den Brandschutzabständen ab. Das klären Gutachten und Fachplanung für jeden Standort einzeln.</p></div>
</div></section>
<section class="section"><div class="wrap split split-media">
  ${photo('feld', 'Visualisierung: Speicheranlage am Feldrand hinter einem bewachsenen Knick, im Vordergrund ein Getreidefeld', 'Einbindung in die Landschaft durch bestehende und neue Gehölzstreifen.')}
  <div><h2>Was eine Fläche geeignet macht</h2>
  <ul class="ticks"><li>Freie Netzkapazität am nahen Umspannwerk oder an einer Leitung</li><li>Kurze, genehmigungsfähige Kabeltrasse</li><li>Tragfähiger Baugrund und geregelte Entwässerung</li><li>Zufahrt für Schwertransporte und Feuerwehr</li><li>Ausreichender Abstand zu Wohnbebauung und Schutzgebieten</li><li>Planungsrechtliche Zulässigkeit – je nach Verfahren mit Einvernehmen oder Bauleitplanung der Gemeinde</li></ul></div>
</div></section>`;
  return page({ path: '/standortentwicklung', title: 'Standortentwicklung', description: 'Die zehn Phasen der BESS-Projektentwicklung: Standortidentifikation, Flächensicherung, Netzanschluss, Genehmigung, Wirtschaftlichkeit, Finanzierung, Bau, Inbetriebnahme, Betrieb und Rückbau.', body });
}

// ---------------- Für Grundstückseigentümer ----------------
const FAQ_OWNER = [
  ['Muss ich mich an Kosten beteiligen?', 'Nein. Planung, Netzanschluss, Gutachten, Genehmigung, Bau, Finanzierung, Versicherung und Rückbau trägt der Projektentwickler beziehungsweise die Projektgesellschaft. Auch die projektbedingten Notar- und Grundbuchkosten trägt grundsätzlich der Projektentwickler.'],
  ['Kann ich die Fläche während der Entwicklung weiter bewirtschaften?', 'Ja. Die landwirtschaftliche Nutzung läuft bis zum Beginn der Bauarbeiten weiter, soweit sie die Projektentwicklung nicht wesentlich beeinträchtigt. Untersuchungen wie Vermessung oder Bodengutachten werden mit Ihnen abgestimmt.'],
  ['Was passiert, wenn das Projekt scheitert?', 'Zeigt sich nach ernsthafter Prüfung, dass das Projekt technisch, rechtlich oder wirtschaftlich nicht realisierbar ist, kann der Projektentwickler den Vertrag mit vier Wochen Frist beenden. Die bis dahin fällig gewordene Optionsvergütung behalten Sie. Die Fläche steht Ihnen danach wieder uneingeschränkt zur Verfügung.'],
  ['Was bedeutet Exklusivität?', 'Während der Optionszeit schließen Sie für die Entwicklungsfläche keine Verträge mit Dritten über Batteriespeicher oder unmittelbar konkurrierende Energieinfrastruktur. Andere Nutzungen, etwa die Landwirtschaft, bleiben davon unberührt.'],
  ['Wer entscheidet zwischen Nutzung und Kauf?', 'Nach unserem Vertragsmodell wählt der Projektentwickler bei Projektreife die Variante. Die Bedingungen beider Varianten werden jedoch schon im Optionsvertrag festgelegt, sodass Sie vorab wissen, was Sie in jedem Fall erhalten. Auch nach Beginn einer Nutzung kann die Fläche später zu den vereinbarten Bedingungen gekauft werden.'],
  ['Wie viel Fläche wird gebraucht?', 'Das hängt von Leistung und Speicherkapazität ab. Häufig sind es ein bis wenige Hektar. Wir sichern zunächst eine etwas größere Entwicklungsfläche und legen die tatsächliche Betriebsfläche erst nach der Planung fest – mit Rücksicht auf Ihre verbleibende Bewirtschaftung.'],
  ['Wie hoch ist die Vergütung?', 'Das hängt vom Standort ab: Netzanschluss, Fläche, Zuwegung und Projektgröße. Wir nennen deshalb keine Pauschalbeträge, sondern machen nach einer ersten Prüfung ein konkretes Angebot, das im Vertrag festgeschrieben wird.'],
  ['Kann ich mein Grundstück später verkaufen oder vererben?', 'Ja. Die für den Speicher nötigen Rechte werden über Dienstbarkeiten im Grundbuch gesichert und gehen auf Erwerber oder Erben über – das ist Voraussetzung für die Finanzierung. Für die Projektfläche ist zusätzlich ein Vorkaufsrecht vorgesehen. Über einen geplanten Verkauf informieren Sie uns rechtzeitig. Nicht benötigte Grundstücksteile können Sie frei veräußern.'],
  ['Was passiert mit der Anlage nach dem Betrieb?', 'Sie wird vollständig zurückgebaut; Rückbaukosten tragen Sie nicht. Vor Baubeginn wird auf Grundlage einer fachgerechten Rückbaukostenermittlung eine angemessene Rückbausicherheit vereinbart.'],
  ['Soll ich den Vertrag prüfen lassen?', 'Ja, das empfehlen wir ausdrücklich. Nehmen Sie sich Zeit und lassen Sie den Vertrag von einer Person Ihres Vertrauens oder einem Rechtsanwalt prüfen. Teile wie die Kaufoption werden notariell beurkundet.'],
];

export function eigentuemer() {
  const body = html`
<section class="page-head page-head-owner"><div class="wrap split">
  <div>
    <h1>Ihre Fläche für einen Batteriespeicher</h1>
    <p class="lead">Wir suchen Flächen in der Nähe von Umspannwerken und leistungsfähigen Stromnetzen. Sie stellen den Standort zur Verfügung – wir tragen Planung, Kosten und Risiko der Entwicklung.</p>
    <div class="hero-actions"><a class="btn btn-solid btn-lg" href="/standort-anbieten">Fläche prüfen lassen</a><a class="btn btn-line btn-lg" href="#ablauf">Ablauf ansehen</a></div>
  </div>
  <aside class="pledge" aria-label="Unser Grundsatz">
    <p class="pledge-q">„Was Sie bei Erfolg erhalten, legen wir gemeinsam fest, bevor wir mit der Entwicklung beginnen – nicht erst, wenn das Projekt genehmigt ist.“</p>
  </aside>
</div></section>
${band('feld', 'Visualisierung: Blick über ein Getreidefeld auf eine Speicheranlage hinter einem Knick, links ein Umspannwerk', 'So kann eine Anlage am Feldrand aussehen. Größe und Anordnung ergeben sich aus der Planung.')}

<section class="section"><div class="wrap split">
  <div><h2>Warum geeignete Flächen gefragt sind</h2>
  <p>Batteriespeicher müssen dort stehen, wo das Netz sie aufnehmen kann – möglichst nah an einem Umspannwerk. Solche Flächen sind begrenzt. Liegt Ihr Grundstück in dieser Lage, hat es für die Energieversorgung einen besonderen Wert. An diesem Wert sollen Sie angemessen beteiligt werden.</p></div>
  <div><h2>Wie die Standortprüfung funktioniert</h2>
  <p>Zuerst schauen wir uns Lage, Größe, Zuwegung und die Entfernung zum Netz an. Ist das vielversprechend, besprechen wir mit Ihnen persönlich die Möglichkeiten. Die eigentliche Prüfung – Netzanschlussanfrage, Gutachten, Genehmigung – beginnt erst nach Abschluss eines Optionsvertrags, weil sie erhebliche Kosten verursacht.</p></div>
</div></section>

<section class="section section-tint"><div class="wrap split split-media">
  ${photo('hero', 'Visualisierung: Speicheranlage mit Containerreihen auf einer Schotterfläche, eingefasst von Knicks', 'Typische Anordnung: Containerreihen, Leistungselektronik, Zaun und Zufahrt.')}
  <div><h2>Was auf Ihrer Fläche entsteht</h2>
  <p>Ein Batteriespeicher ist im Kern eine große, fest installierte Batterie. Er nimmt Strom aus dem Netz auf, wenn viel Wind- oder Solarstrom da ist, und gibt ihn wieder ab, wenn er gebraucht wird.</p>
  <ul class="ticks">
    <li>Batteriecontainer oder -schränke, ähnlich groß wie Schiffscontainer, in Reihen auf einer befestigten Fläche</li>
    <li>Wechselrichter und Transformatoren sowie eine Übergabestation zum Netzbetreiber</li>
    <li>Zaun, Zufahrt für Wartung und Feuerwehr, Eingrünung zum Beispiel durch Knicks</li>
    <li>Im Betrieb ist kein Personal vor Ort. Die Anlage wird aus der Ferne überwacht, Fahrzeuge kommen nur zur Wartung.</li>
    <li>Die Anlage erzeugt Betriebsgeräusche, etwa durch Klimageräte. Ein Schallgutachten stellt sicher, dass die Richtwerte an der Nachbarschaft eingehalten werden.</li>
  </ul></div>
</div></section>

<section class="section"><div class="wrap">
  <h2 class="h-section">Vergütung in drei Phasen</h2>
  <ol class="owner-steps owner-pay">
    <li><h3>Während der Entwicklung</h3><p><strong>Optionsvergütung</strong>, jährlich, für die exklusive Reservierung der Fläche. Sie wird unabhängig vom späteren Projekterfolg gezahlt und nicht zurückgefordert. Bei Verlängerung der Optionszeit steigt sie.</p></li>
    <li><h3>Ab Baubeginn</h3><p>Bei langfristiger Nutzung eine <strong>Bauphasenvergütung</strong> bis zur Inbetriebnahme.</p></li>
    <li><h3>Ab Inbetriebnahme</h3><p>Entweder eine jährliche <strong>Nutzungsvergütung</strong> je Hektar Betriebsfläche mit Mindestbetrag und Anpassung an den Verbraucherpreisindex – oder ein <strong>Kaufpreis</strong> für die Betriebsfläche nach vorab vereinbarter Formel.</p></li>
  </ol>
  <div class="cols-2 pay-detail">
    <article><h3>Wovon die Höhe abhängt</h3>
      <ul class="ticks"><li>Verfügbare Netzanschlussleistung und Entfernung zum Umspannwerk</li><li>Größe und Zuschnitt der tatsächlich benötigten Fläche</li><li>Zuwegung, Baugrund und Genehmigungsaufwand</li><li>Leistung und Speicherkapazität des Projekts</li></ul></article>
    <article><h3>Wann Beträge verbindlich werden</h3>
      <p>Konkrete Beträge nennen wir nach einer ersten Prüfung Ihres Standorts im persönlichen Gespräch. Verbindlich werden sie erst mit dem unterzeichneten Vertrag. Über diese Website machen wir keine Preis- oder Pachtzusagen.</p></article>
  </div>
</div></section>

<section class="section section-tint" id="ablauf"><div class="wrap">
  <h2 class="h-section">So läuft die Zusammenarbeit</h2>
  <ol class="owner-steps">
    <li><h3>Optionsvertrag</h3><p>Sie reservieren eine Entwicklungsfläche exklusiv für uns, zunächst für 24 Monate. Wir können zweimal um je zwölf Monate verlängern. In dieser Zeit planen, messen, begutachten und beantragen wir – auf unsere Kosten.</p></li>
    <li><h3>Regelmäßige Information</h3><p>Auf Wunsch berichten wir Ihnen in angemessenen Abständen über wesentliche Fortschritte, etwa zur Netzanschlusszusage oder zum Genehmigungsverfahren.</p></li>
    <li><h3>Entscheidung über den Bau</h3><p>Erst wenn Netzanschluss, Genehmigung und Finanzierung stehen, entscheidet die Projektgesellschaft über den Bau. Ist ein Projekt nicht tragfähig, endet der Vertrag; fällige Vergütungen bleiben bei Ihnen.</p></li>
    <li><h3>Langfristige Nutzung oder Kauf</h3><p>Bei Realisierung wird die Betriebsfläche langfristig genutzt oder zu einem vorab geregelten Kaufpreis erworben. Die nötigen Rechte werden im Grundbuch gesichert.</p></li>
  </ol>
</div></section>

<section class="section"><div class="wrap">
  <h2 class="h-section">Nutzung oder Kauf – beide Wege im Vergleich</h2>
  <div class="compare">
    <article><h3>Langfristige Nutzung</h3><ul class="ticks"><li>Sie bleiben Eigentümer</li><li>Nutzung zunächst 20 Jahre ab Inbetriebnahme, mit drei Verlängerungsoptionen von je fünf Jahren</li><li>Vergütung je Hektar Betriebsfläche mit Mindestbetrag, angepasst an den Verbraucherpreisindex</li><li>Bauphasenvergütung bereits ab Baubeginn</li></ul></article>
    <article><h3>Verkauf der Betriebsfläche</h3><ul class="ticks"><li>Kaufpreisformel wird schon im Optionsvertrag festgelegt</li><li>Landwirtschaftlicher Referenzwert mit vereinbartem Faktor plus Standort- und Erfolgsprämie</li><li>Mindest- und Höchstpreis schaffen Planungssicherheit für beide Seiten</li><li>Nur die tatsächlich benötigte Fläche wird verkauft; Vermessungs-, Notar- und Grundbuchkosten trägt der Erwerber</li></ul></article>
  </div>
  <p class="note"><strong>Wer wählt?</strong> Nach unserem Vertragsmodell entscheidet der Projektentwickler bei Projektreife, welche Variante umgesetzt wird. Deshalb werden die Bedingungen beider Wege schon vorab festgeschrieben. Sie wissen vor Beginn der Entwicklung, was Sie in jedem Fall erhalten, und niemand verhandelt nach Jahren der Arbeit unter neuen Vorzeichen.</p>
</div></section>

<section class="section section-ink"><div class="wrap">
  <h2 class="h-section">Wer welches Risiko trägt</h2>
  <div class="risk-table" role="table" aria-label="Risikoverteilung zwischen Eigentümer und Projektentwickler">
    <div role="row" class="rt-head"><span role="columnheader">Phase</span><span role="columnheader">Projektentwickler / Projektgesellschaft</span><span role="columnheader">Eigentümer</span></div>
    <div role="row"><span role="rowheader">Entwicklung</span><span role="cell">Planung, Netzanschlussprüfung, Gutachten, Genehmigung – auch wenn das Projekt scheitert</span><span role="cell">Stellt die Fläche exklusiv bereit, erhält die Optionsvergütung</span></div>
    <div role="row"><span role="rowheader">Investition</span><span role="cell">Batteriesysteme, Technik, Bau, Netzanschluss, Finanzierung</span><span role="cell">Keine Kosten, kein Kapitaleinsatz</span></div>
    <div role="row"><span role="rowheader">Betrieb</span><span role="cell">Wartung, Versicherung, Überwachung, Vermarktung, Haftung für die Anlage</span><span role="cell">Erhält Nutzungsvergütung oder hat den Kaufpreis erhalten</span></div>
    <div role="row"><span role="rowheader">Laufzeitende</span><span role="cell">Vollständiger Rückbau, abgesichert vor Baubeginn</span><span role="cell">Keine Rückbaukosten</span></div>
  </div>
</div></section>

<section class="section"><div class="wrap narrow">
  <h2>Häufige Fragen</h2>
  <div class="faq">${FAQ_OWNER.map(([q, a]) => html`<details><summary>${q}</summary><p>${a}</p></details>`)}</div>
  <p class="small muted">Diese Seite gibt einen allgemeinen Überblick über unser Vertragsmodell (Arbeitsstand, Änderungen vorbehalten). Verbindlich ist allein der unterzeichnete Vertrag. Wir machen keine Preis- oder Pachtzusagen über diese Website.</p>
</div></section>

<section class="section section-tint"><div class="wrap contact-cta">
  <div><h2>Erste Einschätzung zu Ihrer Fläche</h2><p>Ein paar Angaben genügen. Flurstücksdaten und Unterlagen sind freiwillig.</p>
  ${(() => { const r = brand.regions.find((x) => x.id === 'nord'); return r?.contactName ? html`<p class="contact-person"><strong>Ihr Ansprechpartner in Norddeutschland:</strong> ${r.contactName}, ${r.contactRole}${r.phone ? html` · ${r.phone}` : ''}${r.email ? html` · <a href="mailto:${r.email}">${r.email}</a>` : ''}</p>` : ''; })()}</div>
  <div class="cta-row"><a class="btn btn-solid btn-lg" href="/standort-anbieten">Fläche anbieten</a><a class="btn btn-line btn-lg" href="/kontakt">Persönlich sprechen</a></div>
</div></section>`;
  const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ_OWNER.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
  return page({ path: '/grundstueckseigentuemer', title: 'Grundstück für Batteriespeicher verpachten', description: 'Batteriespeicher auf Ihrer Fläche: Optionsvertrag, Vergütung ab der Entwicklungsphase, langfristige Nutzung oder Verkauf, Rückbau abgesichert. Entwicklungskosten und Risiko trägt der Projektentwickler.', body, jsonld: faqLd });
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
  <p class="lead">Wir entwickeln Batteriespeicher in eigenständigen Projektgesellschaften – mit dokumentierten Entwicklungsschritten, offen benannten Projektrisiken und kontrolliertem Zugang zu Projektunterlagen.</p>
</div></section>
${band('investor', 'Visualisierung: großflächige Speicheranlage mit Containerreihen in der Abenddämmerung neben einem Umspannwerk mit Freileitung', 'Großspeicher als Infrastruktur-Asset. Beispielanlage, kein realer Standort.')}
<section class="section"><div class="wrap inv-grid">
  <article><h2>Strukturierte Projektentwicklung</h2><p>Standortsicherung, Netzanschluss und Genehmigung werden nach einem einheitlichen Verfahren mit definierten Prüfpunkten bearbeitet. Der Entwicklungsstand wird je Projekt mit Status, Quelle und Datum dokumentiert.</p></article>
  <article><h2>Eigenständige Projektgesellschaften</h2><p>Jeder Standort wird in einer eigenen Gesellschaft gebündelt. Flächenrechte, Netzanschlusszusage, Genehmigungen und Lieferverträge liegen dort, wo auch die Finanzierung ansetzt.</p></article>
  <article><h2>Netzanschluss als Werttreiber</h2><p>Gesicherte Netzanschlusskapazität ist heute einer der knappsten Faktoren für Speicherprojekte. Wir priorisieren Standorte, an denen ein Anschluss technisch und zeitlich realistisch ist.</p></article>
  <article><h2>Projektfinanzierung</h2><p>Die Finanzierung erfolgt auf Ebene der Projektgesellschaft mit Eigen- und Fremdkapital. Struktur und Zeitpunkt richten sich nach dem Reifegrad des einzelnen Projekts.</p></article>
  <article><h2>Erlösquellen</h2><p>Großspeicher erzielen Erlöse vor allem im Stromgroßhandel (zeitliche Verschiebung von Strommengen), in den Regelreservemärkten und – wo vergütet – mit Systemdienstleistungen. Die Mischung wird je Projekt geplant und kann sich über die Laufzeit ändern.</p></article>
  <article><h2>Technik und Betrieb</h2><p>Herstellerauswahl, Garantien, Leistungszusagen, Wartungsverträge und Betriebsführung werden projektbezogen ausgeschrieben und bewertet. Technische Partner nennen wir nach Vertragsschluss.</p></article>
</div></section>
<section class="section section-tint"><div class="wrap">
  <h2 class="h-section">Projektrisiken, die wir offen benennen</h2>
  <div class="cols-3 risks">
    <article><h3>Netzanschluss</h3><p>Zusage, Anschlusszeitpunkt, Baukostenzuschuss und mögliche Einschränkungen der Anschlussleistung bestimmen Zeitplan und Wirtschaftlichkeit.</p></article>
    <article><h3>Genehmigung</h3><p>Planungsrecht, Schall- und Brandschutzauflagen sowie naturschutzrechtliche Anforderungen können Projekte verzögern oder verhindern.</p></article>
    <article><h3>Regulierung</h3><p>Netzentgelte, Abgaben und Marktregeln für Speicher sind teils befristet geregelt und können sich ändern.</p></article>
    <article><h3>Erlöse</h3><p>Preisunterschiede im Großhandel und Regelreservepreise schwanken. Mit wachsender Speicherkapazität im Markt können Erlöse sinken.</p></article>
    <article><h3>Technik und Alterung</h3><p>Zellen altern mit Zyklen und Zeit. Garantien, Ersatzbeschaffung und nachträgliche Erweiterung des Energieinhalts werden je Projekt bewertet.</p></article>
    <article><h3>Bau und Lieferkette</h3><p>Lieferzeiten für Batteriesysteme und Transformatoren, Baukosten und Wechselkurse wirken auf Termine und Budget.</p></article>
  </div>
  <p class="small muted">Risiken werden je Projekt erfasst, bewertet und mit Status und Quelle dokumentiert – nicht pauschal.</p>
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
  return page({ path: '/investoren', title: 'Großbatteriespeicher Investition', description: 'BESS-Projektentwicklung für Investoren und Banken: eigenständige Projektgesellschaften, Netzanschluss als Werttreiber, Erlösquellen, offen benannte Projektrisiken und geschützter Datenraum.', body });
}

// ---------------- Kommunen ----------------
export function kommunen() {
  const body = html`
<section class="page-head"><div class="wrap">
  <h1>Batteriespeicher für Kommunen</h1>
  <p class="lead">Ein Batteriespeicher ist ein Baustein regionaler Energieinfrastruktur. Wir planen ihn so, dass er zur Gemeinde passt – und sprechen früh mit Verwaltung, Gemeindevertretung und Feuerwehr.</p>
</div></section>
${band('kommune', 'Visualisierung: Ortsrand mit Backsteinhäusern und Kirchturm, davor Felder mit Knicks; am Rand eine Speicheranlage und ein Umspannwerk, im Hintergrund Windenergieanlagen', 'Speicher am Ortsrand, abgeschirmt durch Knicks. Beispielhafte Gemeinde, kein realer Ort.')}
<section class="section"><div class="wrap tech-grid">
  <article><h2>Netzintegration</h2><p>Speicher nehmen Strom auf, wenn mehr erzeugt als verbraucht oder abtransportiert werden kann, und geben ihn später ab. Je nach Netzsituation und Betriebsweise können sie zur Verringerung von Abregelungen in der Region beitragen. Den Netzausbau ersetzen sie nicht.</p></article>
  <article><h2>Flächennutzung und Planungsrecht</h2><p>Wir stimmen Standort, Zufahrt und Eingrünung mit der Gemeinde ab und klären die planungsrechtliche Einordnung gemeinsam mit Bauaufsicht und Gemeinde – je nach Fall über das gemeindliche Einvernehmen oder eine Bauleitplanung. Eingriffe in Natur und Landschaft werden ausgeglichen.</p></article>
  <article><h2>Flächenschonende Anlagenkonzepte</h2><p>Kompakte Aufstellung, Schottertragschicht statt Vollversiegelung, wo der Baugrund es zulässt, und Erhalt bestehender Knicks und Gehölze. Nach dem Rückbau steht die Fläche wieder zur Verfügung.</p></article>
  <article><h2>Immissionsschutz</h2><p>Ein Schallgutachten weist die Einhaltung der Immissionsrichtwerte nach TA Lärm nach, auch zur Nachtzeit. Beleuchtung wird auf das sicherheitlich Nötige begrenzt. Baustellenverkehr und Schwertransporte stimmen wir mit der Gemeinde ab.</p></article>
  <article><h2>Brandschutz</h2><p>Für jede Anlage gibt es ein Brandschutzkonzept, das mit Bauaufsicht und Feuerwehr abgestimmt wird: Detektion, Abstände, Zufahrten, Löschwasser. Vor Inbetriebnahme weisen wir die örtliche Feuerwehr ein und stellen Einsatzunterlagen und eine ständig erreichbare Kontaktstelle bereit.</p></article>
  <article><h2>Kommunale Abstimmung</h2><p>Wir stellen Projekte im Ausschuss vor, beantworten Fragen der Anwohner und informieren regelmäßig über den Planungsstand – auf Wunsch über ein geschütztes Partnerportal.</p></article>
  <article class="span-2"><h2>Resilienz und Notstrom – was technisch möglich ist</h2><p>Ein üblicher netzgekoppelter Speicher schaltet sich bei einem Netzausfall ab und versorgt dann keine Gebäude. Eine Notstrom- oder Inselnetzversorgung, etwa für Feuerwehr, Wasserversorgung oder eine Notunterkunft, braucht zusätzliche Technik (netzbildende Wechselrichter, Schalt- und Schutzkonzept, abgegrenztes Versorgungsnetz) und die Zustimmung des Netzbetreibers. Ob das an einem Standort sinnvoll ist, prüfen wir gern gemeinsam – als eigenes Vorhaben, nicht als Standardleistung.</p></article>
</div></section>
<section class="section section-tint"><div class="wrap">
  ${illus('kommunale-infrastruktur.svg', 'Gemeinde mit Ortsnetz, Feuerwehr, Schule und einem Speicher am Ortsrand; gestrichelt dargestellt sind optionale Komponenten für eine Inselnetzversorgung', 'Netzgekoppelter Speicher; Notstromfähigkeit nur mit zusätzlicher Ausrüstung.', 'illus-wide')}
</div></section>
<section class="section"><div class="wrap contact-cta">
  <div><h2>Frühzeitig sprechen</h2><p>Sie möchten wissen, ob in Ihrer Gemeinde ein Speicherprojekt geprüft wird, oder haben einen Standortvorschlag? Wir kommen gern zu einem Gespräch.</p></div>
  <div class="cta-row"><a class="btn btn-solid btn-lg" href="/kontakt?anliegen=kommune">Kontakt für Kommunen</a></div>
</div></section>`;
  return page({ path: '/kommunen', title: 'Batterie-Großspeicher für Kommunen', description: 'Batteriespeicher als regionale Energieinfrastruktur: Netzintegration, Flächennutzung und Planungsrecht, Immissions- und Brandschutz, kommunale Abstimmung und der Unterschied zwischen Netzspeicher und Notstromversorgung.', body });
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
    : html`<div class="empty"><h2>Derzeit sind keine Projekte zur Veröffentlichung freigegeben.</h2><p>Wenn Sie als Eigentümer, Gemeinde oder Investor an einem Projekt beteiligt sind, finden Sie den aktuellen Stand im geschützten Portal.</p><p><a class="btn btn-line" href="/portal/login">Zum Portal</a> <a class="btn btn-solid" href="/standort-anbieten">Fläche anbieten</a></p></div>`}
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
<h2>Bildnachweis</h2><p>Alle Bilder sind eigene Darstellungen: Illustrationen und 3D-Visualisierungen von Beispielanlagen, erstellt für diese Website. Sie zeigen keine gebauten Anlagen und keine realen Standorte. Bildschirminhalte enthalten synthetische Werte.</p>
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
<h2>Hosting</h2><p>[Entwurf, PRÜFUNGSBEDÜRFTIG] Die Website wird bei Vercel Inc. (USA) betrieben; Rechenregion Frankfurt am Main. Dabei verarbeitet der Anbieter technisch notwendige Verbindungsdaten. Angaben zu Auftragsverarbeitungsvertrag, Datenübermittlung in Drittländer und Speicherdauer sind vor der Veröffentlichung zu ergänzen.</p>
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
