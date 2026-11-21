"""Konstanten der Integration Familienaufgaben."""

from __future__ import annotations

DOMAIN = "familienaufgaben"
NAME = "Familienaufgaben"
VERSION = "1.4.0"

# Daten: <config>/familienaufgaben/aufgaben.json (wie in der früheren Pyscript-Fassung)
ORDNER = "familienaufgaben"
DATEINAME = "aufgaben.json"

# Anzeige
SENSOR_GESAMT = "sensor.familienaufgaben"
SENSOR_PERSON_PRAEFIX = "sensor.familienaufgaben_"
SIGNAL_AKTUALISIERT = f"{DOMAIN}_aktualisiert"

# Karte und Seitenleiste
STATIC_URL = "/familienaufgaben_dateien"
KARTE_DATEI = "familienaufgaben-karte.js"
KARTE_URL = f"{STATIC_URL}/{KARTE_DATEI}?v={VERSION}"
PANEL_PFAD = "familienaufgaben"
PANEL_ELEMENT = "familienaufgaben-panel"

# Optionen
OPT_SEITENLEISTE = "seitenleiste"
OPT_TITEL = "titel"
OPT_LINK = "link"
STANDARD_TITEL = "Aufgaben"
STANDARD_LINK = f"/{PANEL_PFAD}"

# Dienste
DIENSTE = (
    "liste",
    "speichern",
    "aktion",
    "loeschen",
    "wiederherstellen",
    "papierkorb_leeren",
    "einstellungen",
    "ich_bin",
    "erinnern",
    "test",
)

# Ereignis der Companion-App (Knopf „Übernehmen“ in der Benachrichtigung)
EREIGNIS_KNOPF = "mobile_app_notification_action"

# Uhrzeiten
UHR_SICHERUNG = "03:30"
UHR_TAGESWECHSEL = "00:01"
