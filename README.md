# Familienaufgaben für Home Assistant

Gemeinsame Aufgaben- und Terminliste für die ganze Familie – direkt in Home Assistant.
Jedes Familienmitglied kann Aufgaben eintragen, übernehmen, planen und erledigen; wer etwas
angelegt hat, bekommt auf dem Handy Bescheid, wenn sich daran etwas tut.

*English: A shared family to-do and appointment list for Home Assistant (German user interface).*

## Funktionen

- **Aufgaben** mit Bezeichnung, Notiz, Kategorie, Tags, *vorgesehen für* (mehrere Personen, auch
  Externe wie „Oma“), *Ausführende*, geplantem Termin (Tag, optional Uhrzeit) und Frist
  (Datum oder „spätestens in X Tagen/Wochen/Monaten“).
- **Status** Neu → In Planung → In Bearbeitung → Erledigt; Übernehmen oder Planen setzt den
  Status automatisch.
- **Serien:** täglich, alle X Tage, wöchentlich (auch bestimmte Wochentage, alle 2 Wochen …),
  monatlich, jährlich – nach Plan oder ab Erledigung, mit „Termin überspringen“.
- **Liste** detailliert oder kompakt, gruppiert nach Status, Kategorie oder Person, Status-Gruppen
  auf Wunsch nach Termin unterteilt (Heute, Morgen, Diese Woche …), mit Filtern, Suche und
  Sortierung. Die Standardansicht gilt für alle Geräte oder nur für eines.
- **Papierkorb** (wiederherstellbar), erledigte Aufgaben werden nach 90 Tagen entfernt
  (einstellbar).
- **Benachrichtigungen** über die Home-Assistant-App: an den Ersteller bei Übernahme, Termin,
  Statuswechsel, Überspringen und Löschen; an Vorgesehene bei neuen Aufgaben – mit Knopf
  **Übernehmen** direkt in der Benachrichtigung. Optional eine tägliche Übersicht.
- **Benachrichtigen bei Ausführung:** je Aufgabe beliebig viele Personen, die eine Nachricht
  bekommen, wenn die Aufgabe erledigt und/oder begonnen wird – per App, Externe per WhatsApp oder
  E-Mail (wenn hinterlegt). Wer es selbst erledigt, bekommt keine; der Ersteller nicht doppelt.
- **Erinnerungen vor dem Termin** (ohne Termin: vor der Frist), je Aufgabe beliebig viele –
  per App, per WhatsApp (über die Integration
  [WhatsApp Bridge](https://github.com/raulpetruta/ha-wa-bridge), falls installiert) oder per
  E-Mail (über einen `notify`-Dienst). Fehlt Nummer, Adresse oder Dienst, kommt die Erinnerung
  per App; verpasste Erinnerungen (z. B. während eines Neustarts) werden bis 30 Minuten nachgeholt.
- **Eigene Seite in der Seitenleiste** („Aufgaben“) und eine Karte für eigene Dashboards.

## Installation

1. **Einstellungen → Marketplace → Über Link hinzufügen** und
   `https://github.com/bryce2071/PeBs_ha_familytasks` eintragen, dann **Familienaufgaben**
   installieren.
2. **Einstellungen → Geräte & Dienste → Integration hinzufügen → Familienaufgaben**.
3. Fertig: In der Seitenleiste erscheint **Aufgaben**.

Voraussetzung: Home Assistant 2025.1 oder neuer. Für Benachrichtigungen die
Home-Assistant-App auf den Handys.

## Einrichtung

- **Wer bin ich?** Personen mit verknüpftem Home-Assistant-Benutzer werden automatisch erkannt.
  Für alle anderen fragt die Karte beim ersten Öffnen, wer man ist (wird pro Gerät und für das
  Benutzerkonto gemerkt).
- **Benachrichtigungen:** Die Karte ordnet beim ersten Start jeder Person ihre Handys zu
  (aus den Geräte-Trackern der Person). In der Karte unter **Einstellungen** lässt sich das ändern,
  ebenso Kategorien, externe Personen, WhatsApp-Nummern und E-Mail-Adressen, Standard-Erinnerungen,
  die tägliche Übersicht, die Standardansicht und die Aufbewahrung. Ein Testknopf je Person zeigt,
  ob App, WhatsApp und E-Mail ankommen.
- **Optionen** der Integration (Zahnrad bei der Integration): Seitenleiste ein/aus, Name in der
  Seitenleiste und welche Seite ein Antippen der Benachrichtigung öffnet.

### Karte auf einem eigenen Dashboard

Die Karte wird automatisch geladen und steht in der Kartenauswahl („Familienaufgaben“):

```yaml
type: custom:familienaufgaben-karte
```

Am besten als Ansicht vom Typ *Panel*. Liegt die Karte auf einem eigenen Dashboard, in den
Optionen den Pfad dorthin als Ziel der Benachrichtigungen eintragen (z. B. `/mein-dashboard/aufgaben`).

## Sensoren

| Entität | Zustand | Attribute |
|---|---|---|
| `sensor.familienaufgaben` | offene Aufgaben | `neu`, `in_planung`, `in_bearbeitung`, `erledigt`, `ueberfaellig`, `heute`, `naechste`, `version` |
| `sensor.familienaufgaben_<person>` | offene Aufgaben der Person | `ueberfaellig`, `heute`, `aufgaben` |

Damit lassen sich Abzeichen, Automationen oder Sprachausgaben bauen, z. B. „Lena hat heute 2 Aufgaben“.

## Dienste

| Dienst | Zweck |
|---|---|
| `familienaufgaben.liste` | alle Aufgaben und Einstellungen (Antwort) |
| `familienaufgaben.speichern` | Aufgabe anlegen (ohne `id`) oder ändern (mit `id`) |
| `familienaufgaben.aktion` | `uebernehmen`, `abgeben`, `planen`, `starten`, `erledigen`, `wieder_oeffnen`, `status`, `ueberspringen` |
| `familienaufgaben.loeschen` / `wiederherstellen` / `papierkorb_leeren` | Papierkorb |
| `familienaufgaben.einstellungen` | Einstellungen ändern |
| `familienaufgaben.ich_bin` | angemeldeten Benutzer einer Person zuordnen |
| `familienaufgaben.erinnern` | tägliche Übersicht (Standard: nur Probelauf) |
| `familienaufgaben.test` | Testnachricht an eine Person über App, WhatsApp und E-Mail |

Beispiel – Aufgabe aus einer Automation anlegen:

```yaml
action: familienaufgaben.speichern
data:
  titel: Mülltonne rausstellen
  kategorie: haushalt
  fuer: [person.lena]
  geplant: "{{ now().date() }}"
```

## Daten und Sicherung

- Alles liegt in `/config/familienaufgaben/aufgaben.json` und ist damit in jedem
  Home-Assistant-Backup enthalten.
- Jede Nacht um 03:30 Uhr legt die Integration zusätzlich `sicherung-JJJJ-MM-TT.json` an
  (14 Tage). Ist die Datendatei einmal unlesbar, wird sie als `aufgaben.json.defekt-…`
  beiseitegelegt und die letzte Sicherung geladen.

## Umstieg von der Pyscript-Fassung

Wer Familienaufgaben vorher als Pyscript (`pyscript/familienaufgaben.py`) betrieben hat:

1. Die Datei `pyscript/familienaufgaben.py` entfernen oder umbenennen (z. B. in
   `familienaufgaben.py.alt`) – solange sie läuft, wartet die Integration.
2. Die alte Dashboard-Ressource `/local/familienaufgaben-karte.js` entfernen
   (Einstellungen → Dashboards → ⋮ → Ressourcen); die Integration bringt die Karte selbst mit.
3. Integration hinzufügen. Aufgaben, Einstellungen und Sicherungen werden übernommen, die
   Sensoren behalten ihre Namen, vorhandene Dashboards funktionieren weiter.

## Lizenz

MIT
