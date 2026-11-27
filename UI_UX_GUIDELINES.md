# UI/UX-Richtlinie der Baustellen-App

> **Für Entwickler und KI-Assistenten:** Dies ist die gemeinsame Referenz für Änderungen an der Benutzeroberfläche. Vor UI-Arbeiten lesen und bestehende Komponenten, Farben und Interaktionen wiederverwenden. Keine neue visuelle Sprache einführen, wenn die Änderung mit den hier beschriebenen Mustern umgesetzt werden kann.

## 1. Produkt und Nutzererlebnis

Die Baustellen-App ist eine Arbeitsoberfläche für die Verwaltung von Projekten, Baustellen, Dateien und Aufmaßdaten. Die Oberfläche soll:

- wichtige Baustelleninformationen schnell erfassbar machen;
- bei dichten Datenlisten kompakt bleiben, ohne Bedienelemente unauffindbar zu machen;
- auf Maus, Tastatur und schmalen Bildschirmen bedienbar sein;
- destruktive Aktionen erkennbar machen und nicht versehentlich auslösen;
- überwiegend Deutsch verwenden und Fachbegriffe aus dem vorhandenen Produkt beibehalten.

Texte kurz und handlungsorientiert formulieren: „Speichern“, „Ordner anlegen“, „Schließen“. Fehler klar benennen und nicht als Erfolg darstellen.

## 2. Aufbau der Anwendung

Die Hauptansicht verwendet die Karte als Vollbild-Arbeitsfläche. Die Navigation und Projektdetails liegen in einer darüberliegenden, ein- und ausblendbaren Seitenleiste. Bereiche mit umfangreichen Daten wie „Aufmaß“, „Abrechnung“ und „Dateien“ nutzen bei breitem Layout mehr Platz.

```text
+------------------------------------------------------+
|                                                      |
|             Karte / Arbeitsfläche                   |
|                                                      |
|  +---------------------------------------------+     |
|  | Kopfzeile, Navigation und Projektdetails     |     |
|  |                                               |     |
|  | Aktiver Bereich: Allgemein / Dateien / ...   |     |
|  |                                               |     |
|  +---------------------------------------------+     |
|  [Seitenleiste ein-/ausblenden]                       |
+------------------------------------------------------+
```

Wichtige Layoutregeln:

- Die Karte bleibt die Fläche im Hintergrund; Seitenleisten und Dialoge liegen klar darüber.
- Die Seitenleiste besitzt einen eigenen Scrollbereich. Kopfzeilen und dauerhaft benötigte Navigation sollen nicht unbeabsichtigt mitscrollen.
- Datei-, Projekt- und Einstellungslisten sollen ihre Inhalte in der vorhandenen Seitenleisten- bzw. Dialogstruktur zeigen; keine konkurrierenden Vollbildbereiche ergänzen.
- Dialoge benötigen einen klaren Titel, einen eindeutigen Abschluss und bei Bedarf eine verständliche Abbruchmöglichkeit.

## 3. Farben und Oberflächen

Die App hat eine helle Hauptarbeitsfläche und dunkle Einstellungs-/Adminbereiche. Diese Kontexte nicht unbedacht vermischen.

| Zweck | Vorhandene Farbe(n) | Verwendung |
| --- | --- | --- |
| Haupt-Hintergrund | `#f3f4f6` | Grundfläche der App |
| Haupttext | `#1f2937`, `#1e293b` | Lesetext und Überschriften |
| Karten/Flächen | `#ffffff`, `#f9fafb` | Seitenleiste, Dateizeilen, Projektkarten |
| Helle Trennlinien | `#e5e7eb`, `#e2e8f0`, `#cbd5e1` | Rahmen und dezente Abgrenzungen |
| Primäre Aktion | `#2563eb`, Hover `#1d4ed8` | Allgemeine primäre Buttons |
| Kontext-Akzent | `#0284c7`, `#38bdf8` | Fokusrahmen, Dateiaktionen und bestimmte Tabs |
| Neutrales Hover | `#f1f5f9` | Dezente Hervorhebung ohne unnötige Farbfläche |
| Erfolg | `#16a34a`, `#dcfce7` | Erfolgszustände |
| Warnung | `#d97706`, `#fef3c7` | Warnungen |
| Fehler/destruktiv | `#dc2626`, `#fee2e2` | Fehler und Löschen |
| Dunkle Einstellungsflächen | `#0f172a`, `#111827`, `#1e293b` | Einstellungs- und Adminbereiche |
| Text auf dunklen Flächen | `#e2e8f0`, sekundär `#94a3b8` | Beschriftungen und Hilfstexte |

**Wichtig:** Im Bestand gibt es mehrere Blautöne und lokale Ausnahmen. Für eine Änderung immer die nächstliegende bestehende Komponente als Referenz nehmen. Kein globales Überschreiben von Farben, wenn nur ein bestimmter Bereich geändert werden soll. Neutrale Bedienelemente sollen beim Hover nicht ohne Grund vollflächig blau werden.

## 4. Typografie, Abstände und Formen

- Standardschrift: `Arial, Helvetica, sans-serif`.
- Fließtext ist gut lesbar und knapp. Kompakte Listen verwenden kleinere Schriftgrößen (häufig 11–13 px); Hilfstexte sind zurückhaltend, aber lesbar.
- Abstände folgen überwiegend einem kompakten Raster aus etwa 4, 6, 8, 10, 12 und 16 px. Gleichartige Elemente mit gleichen Abständen ausrichten.
- Bestehende Rundungen unterscheiden sich nach Kontext: allgemeine Felder meist `10px`, Dateiaktionen/Zeilen meist `8px`, Dialoge/Karten etwa `14–16px`, Badges und kompakte Datei-Picker pillenförmig (`999px`), dichte Adminfelder teils `6px`.
- Neue Bedienelemente sollen die Rundung ihrer direkten Nachbarn übernehmen. Nicht für jedes Element eine neue Rundung erfinden.
- Schatten sparsam einsetzen, vor allem zur Abgrenzung schwebender Seitenleisten, Dialoge und Datei-Vorschauen.

## 5. Komponenten und Muster

### Buttons

- Primäre Aktion: vorhandene blaue Button-Variante.
- Sekundäre Aktion: neutral oder dunkler/slatefarben, nicht mit der Primäraktion verwechselbar.
- Destruktive Aktion: Rot, mit klarer Bezeichnung und gegebenenfalls Bestätigung.
- Icon-Buttons kompakt und quadratisch halten; `title` und ein passendes `aria-label` ergänzen.
- Hover-, Fokus-, Aktiv- und Disabled-Zustände explizit berücksichtigen. Globale Button-Regeln können lokale Komponenten beeinflussen; bei Bedarf lokale Regeln wie `.component-button:hover` setzen.

### Eingaben und Dropdowns

- Beschriftung und Eingabe eindeutig zusammenführen; Platzhalter ersetzen keine zugängliche Beschriftung.
- Größen und Rundungen an den jeweiligen Kontext anpassen: große Formfelder nicht mit kompakten Tabellen-/Listen-Pickern gleichsetzen.
- Native HTML-`select`-Felder sind für einfache Auswahlmöglichkeiten bevorzugt. Ihr geöffnetes Optionsmenü wird teilweise vom Browser/Betriebssystem gezeichnet; CSS kann dessen Rundungen und Farben nicht zuverlässig steuern. Nur wenn das geöffnete Menü zwingend individuell gestaltet werden muss, ein eigenes barrierearmes Listenfeld erwägen.
- Bei einem eigenen Dropdown Tastatursteuerung, Fokusführung, Escape, Auswahlzustand und Screenreader-Semantik mit umsetzen.

### Projekt- und Dateizeilen

Eine Dateizeile soll Name und Aktionen klar trennen. Der Dateiname darf bei Platzmangel gekürzt werden, ohne Aktionen oder Sicherheitsinformationen zu verdrängen.

```text
[Dateityp]  Dateiname.pdf                 [Stufe 2] [Ordner v] [Aktionen]
```

- Weiße Zeile, feiner neutraler Rahmen und abgerundete Ecken.
- Hover dezent über Rahmen/Schatten oder neutralen Hintergrund anzeigen.
- Sicherheitsstufen als kompakte farbige Kennzeichnung; Ordnerauswahl als kompakter Picker.
- Lange Dateinamen mit Ellipsis kürzen; vollständigen Namen weiterhin zugänglich machen.
- Gruppenüberschriften von Dateiordnern sind interaktive Auf-/Zuklapp-Schaltflächen. Der Zustand muss visuell und mit `aria-expanded` erkennbar sein.

### Karten, Badges und Status

- Projektkarten verwenden eine helle, leicht abgesetzte Fläche und einen dezenten Rahmen.
- Statusfarben sind semantisch: Rot für offen/problematisch, Grün für abgeschlossen, Gelb/Orange für Warnungen. Farbe nicht als einziges Unterscheidungsmerkmal verwenden; Status zusätzlich beschriften.
- Badges sind kompakt und pillenförmig, mit ausreichendem Kontrast.

### Dialoge, Toasts und Adminbereiche

- Dialoge von der Arbeitsfläche deutlich abheben, aber nicht mit unnötigen Dekorationen überladen.
- Toasts sollen Erfolg, Warnung oder Fehler eindeutig signalisieren und wichtige Inhalte nicht verdecken.
- Einstellungs- und Adminbereiche nutzen derzeit häufig dunkle Flächen mit hellen Texten. Neue Inhalte in diesem Bereich müssen den Kontrast und die vorhandene dunkle Farbpalette beibehalten.

## 6. Interaktion und Barrierefreiheit

- Alle interaktiven Elemente müssen per Tastatur erreichbar sein und einen sichtbaren `:focus-visible`-Zustand besitzen.
- Semantische Elemente passend verwenden: `<button>` für Aktionen, `<a>` für Navigation, `<select>` für einfache Auswahl.
- Für Icon-only-Controls `aria-label` oder einen zugänglichen Namen ergänzen.
- Auf-/Zuklapp-Controls mit `aria-expanded` ausstatten und den Inhalt sinnvoll gruppieren.
- Fokusrahmen nicht entfernen, außer ein gleichwertiger sichtbarer Ersatz ist vorhanden.
- Disabled-Zustände müssen visuell erkennbar sein; Aktionen im Disabled-Zustand dürfen keine Wirkung haben.
- Bei Fehlern den Fehlertext sichtbar darstellen und vorhandenes Toast-/Dialog-Verhalten wiederverwenden.
- Hover ist eine Ergänzung, niemals die einzige Rückmeldung: Touchgeräte und Tastaturnutzung haben keinen verlässlichen Hover.

## 7. Responsive Verhalten

Die App ist eine Desktop-/Kartenanwendung, muss aber auch auf schmalen Fenstern nutzbar bleiben.

- Vorhandene Breakpoints in `src/styles.css` und Komponentendateien prüfen, statt neue Breakpoints ohne Grund einzuführen. Im Bestand kommen unter anderem 1100, 820, 700, 600 und 460 px vor.
- Auf schmalen Breiten mehrspaltige Admin-/Formularzeilen stapeln und horizontales Überlaufen vermeiden.
- Wichtige Aktionen und Informationen nicht nur über Hover erreichbar machen.
- Für breite Dateibereiche darf die Seitenleiste wachsen; bei kleinen Displays müssen Inhalte weiterhin scrollen und bedienbar bleiben.
- Lange Namen, E-Mail-Adressen und Pfade umbrechen oder kontrolliert kürzen.

## 8. Implementierungsregeln

1. Vor dem Ändern `src/styles.css` sowie die Styles der betroffenen Komponente lesen.
2. Vorhandene Komponenten, Klassen, Farben und Statusmeldungen wiederverwenden.
3. Styles möglichst in der passenden CSS-Datei ergänzen. Globale Regeln nur ändern, wenn die Änderung tatsächlich appweit gelten soll.
4. Bei globalen Button-/Input-Regeln die resultierenden Hover-, Fokus- und Disabled-Stile der betroffenen Komponente kontrollieren.
5. Keine Inline-Styles für neue wiederverwendbare Komponenten einführen, wenn ein Klassenstil besser passt. Bestehende Inline-Styles nicht ohne Zusammenhang umschreiben.
6. Keine Abhängigkeit für reine CSS-Anpassungen hinzufügen.
7. Geänderte UI mindestens mit `npm run build` prüfen; bei Verhaltensänderungen zusätzlich relevante Tests ausführen.
8. Änderungen am Dark Mode und an Browser-nativen Controls nach Möglichkeit in den tatsächlich unterstützten Laufzeitumgebungen prüfen.

## 9. Visuelle Prüfliste

Vor Abschluss einer UI-Änderung prüfen:

- Passt die Änderung zu ähnlichen Komponenten im selben Bereich?
- Stimmen Kontrast, Textgröße, Abstände und Rundungen?
- Sind Hover, Fokus, Aktiv, Disabled, Fehler und Ladezustand berücksichtigt?
- Ist die Bedienung mit Tastatur und Touch möglich?
- Bleibt das Layout bei schmaler Breite nutzbar?
- Wurde vermieden, dass eine lokale Änderung globale Bedienelemente verändert?
- Bleibt der dunkle bzw. helle Kontext der jeweiligen Ansicht konsistent?

## 10. Kurzer Auftrag für KI-Assistenten

> Lies zuerst `UI_UX_GUIDELINES.md` und die Styles der betroffenen Komponente. Passe nur den angefragten Bereich an, verwende vorhandene UI-Muster und ändere keine globalen Styles ohne ausdrücklichen Grund. Berücksichtige responsive Layouts, Tastaturbedienung und sichtbare Fokuszustände. Prüfe die Änderung mit dem passenden Build oder Test.

## Quellen im Repository

- Hauptstyles und Layout: [`src/styles.css`](./src/styles.css)
- Datei-Vorschau: [`src/FileViewer.css`](./src/FileViewer.css)
- Benutzerverwaltung: [`src/UserAdminPanel.css`](./src/UserAdminPanel.css)
- React-Ansichten und Interaktionen: [`src/App.jsx`](./src/App.jsx)
