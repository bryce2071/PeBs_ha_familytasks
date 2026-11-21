"""Laufzeit der Familienaufgaben: Daten, Aktionen, Benachrichtigungen, Erinnerungen und Zeitplan.

Entspricht dem Pyscript-Teil der früheren Fassung (Laden, Speichern, Dienste, Auslöser);
die reine Logik liegt unverändert in ``logik.py``.

Erinnerungen vor dem Termin gehen per App (Companion-App), WhatsApp (Dienst
``wa_bridge.send_message``, falls die WhatsApp-Bridge installiert ist) oder E-Mail (ein
wählbarer ``notify``-Dienst). Fehlt Nummer, Adresse oder Dienst, kommt die Erinnerung per App.
"""

from __future__ import annotations

import asyncio
import copy
import logging
from datetime import datetime
from typing import Any

from homeassistant.core import Context, Event, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_change
from homeassistant.util import dt as dt_util
from homeassistant.util import slugify

from . import logik as L
from . import speicher
from .const import (
    DATEINAME,
    EREIGNIS_KNOPF,
    ORDNER,
    SIGNAL_AKTUALISIERT,
    UHR_SICHERUNG,
    UHR_TAGESWECHSEL,
)

_LOGGER = logging.getLogger(__name__)

WARNUNG_DATEI = "Konnte nicht in die Datei schreiben – siehe Protokoll."


class FamilienaufgabenKern:
    """Hält die Daten im Speicher und erledigt alles, was die Karte und die Dienste brauchen."""

    def __init__(self, hass: HomeAssistant, link: str) -> None:
        self.hass = hass
        self.link = link or "/"
        self.ordner = hass.config.path(ORDNER)
        self.pfad = hass.config.path(ORDNER, DATEINAME)
        self.daten: dict[str, Any] = L._normalisieren({})
        self.kennzahlen: dict[str, Any] = {}
        self.namen_cache: dict[str, str] = {}
        self._schreiben = asyncio.Lock()
        self._abmelden: list = []

    # ------------------------------------------------------------------ Start/Stopp

    async def async_start(self) -> None:
        """Daten laden, Anzeige setzen, Zeitplan und Benachrichtigungsknopf anmelden."""
        await self._async_laden()
        if not self.daten["aufgaben"] and not self.daten["zaehler"]:
            await self.async_speichern()
        self.veroeffentlichen()
        jetzt = dt_util.now()
        if jetzt.strftime("%H:%M") > UHR_SICHERUNG:
            # Fiel die nächtliche Sicherung z. B. in einen Neustart, wird sie jetzt nachgeholt
            await self._async_sichern(jetzt.date().isoformat())
        self._abmelden.append(async_track_time_change(self.hass, self._async_takt, second=0))
        self._abmelden.append(self.hass.bus.async_listen(EREIGNIS_KNOPF, self._async_knopf))
        _LOGGER.info("Familienaufgaben: %d Aufgaben geladen", len(self.daten["aufgaben"]))

    async def async_stop(self) -> None:
        """Abmelden und auf einen laufenden Schreibvorgang warten."""
        for abmelden in self._abmelden:
            abmelden()
        self._abmelden.clear()
        async with self._schreiben:
            pass

    # ------------------------------------------------------------------ Laden/Speichern

    async def _async_laden(self) -> None:
        daten, fehler = await self.hass.async_add_executor_job(speicher.datei_lesen, self.pfad)
        if fehler:
            _LOGGER.error(
                "Familienaufgaben: %s ist nicht lesbar (%s) – nehme die letzte Sicherung", self.pfad, fehler
            )
            await self.hass.async_add_executor_job(
                speicher.datei_beiseite, self.pfad, dt_util.now().strftime("%Y%m%d-%H%M%S")
            )
            daten = await self.hass.async_add_executor_job(speicher.letzte_sicherung, self.ordner)
        self.daten = L._normalisieren(daten or {}, self._standard_melden())

    async def async_speichern(self) -> bool:
        """Schreibt den aktuellen Stand. Mehrere Aufrufe laufen nacheinander, der letzte gewinnt."""
        text = L._als_text(self.daten)
        async with self._schreiben:
            try:
                await self.hass.async_add_executor_job(speicher.datei_schreiben, self.pfad, text)
            except OSError as exc:
                _LOGGER.error("Familienaufgaben: Speichern fehlgeschlagen: %s", exc)
                return False
        return True

    async def _async_sichern(self, tag: str) -> None:
        try:
            await self.hass.async_add_executor_job(
                speicher.datei_sichern, self.ordner, self.pfad, tag, L.SICHERUNGEN
            )
        except OSError as exc:
            _LOGGER.warning("Familienaufgaben: Sicherung fehlgeschlagen: %s", exc)

    async def async_geaendert(self) -> bool:
        """Version hochzählen (die Karte lädt dann neu), speichern und Anzeige setzen."""
        self.daten["zaehler"] = int(self.daten.get("zaehler") or 0) + 1
        ok = await self.async_speichern()
        self.veroeffentlichen()
        return ok

    # ------------------------------------------------------------------ Personen

    def personen_ids(self) -> list[str]:
        """Alle Personen (person.*), sortiert."""
        return sorted(self.hass.states.async_entity_ids("person"))

    def namen(self) -> dict[str, str]:
        """Anzeigenamen der Personen."""
        namen = {}
        for person in self.hass.states.async_entity_ids("person"):
            zustand = self.hass.states.get(person)
            namen[person] = (zustand.attributes.get("friendly_name") if zustand else None) or person
        return namen

    def _standard_melden(self) -> dict[str, list[str]]:
        """Erste Zuordnung Person → Companion-App, abgeleitet aus den Geräte-Trackern der Personen.

        Wird nur genutzt, solange in den Daten noch keine Zuordnung steht; in der Karte änderbar.
        """
        ergebnis: dict[str, list[str]] = {}
        ent_reg = er.async_get(self.hass)
        dev_reg = dr.async_get(self.hass)
        for person in self.personen_ids():
            zustand = self.hass.states.get(person)
            tracker = (zustand.attributes.get("device_trackers") if zustand else None) or []
            dienste: list[str] = []
            for eintrag_id in tracker:
                kandidaten = ["mobile_app_" + str(eintrag_id).split(".", 1)[-1]]
                eintrag = ent_reg.async_get(eintrag_id)
                if eintrag and eintrag.device_id:
                    geraet = dev_reg.async_get(eintrag.device_id)
                    if geraet:
                        for name in (geraet.name, geraet.name_by_user):
                            if name:
                                kandidaten.append("mobile_app_" + slugify(name))
                for dienst in kandidaten:
                    if dienst not in dienste and self.hass.services.has_service("notify", dienst):
                        dienste.append(dienst)
                        break
            if dienste:
                ergebnis[person] = dienste
        return ergebnis

    def akteur_finden(self, context: Context | None, akteur: Any = None) -> str:
        """Wer handelt: angegebene Person, sonst die mit dem Benutzer verknüpfte, sonst „Wer bin ich?“."""
        gueltig = self.personen_ids()
        if akteur and str(akteur) in gueltig:
            return str(akteur)
        uid = context.user_id if context else None
        if uid:
            for person in gueltig:
                zustand = self.hass.states.get(person)
                if zustand and zustand.attributes.get("user_id") == uid:
                    return person
            gemerkt = (self.daten["einstellungen"].get("benutzer") or {}).get(uid)
            if gemerkt in gueltig:
                return gemerkt
        return ""

    # ------------------------------------------------------------------ Anzeige

    @callback
    def veroeffentlichen(self) -> None:
        """Kennzahlen neu berechnen und die Sensoren benachrichtigen."""
        jetzt = dt_util.now()
        self.namen_cache = self.namen()
        self.kennzahlen = L._kennzahlen(
            self.daten["aufgaben"], jetzt.date(), self.personen_ids(), self.namen_cache
        )
        self.kennzahlen["stand"] = jetzt.strftime("%d.%m. %H:%M")
        async_dispatcher_send(self.hass, SIGNAL_AKTUALISIERT)

    # ------------------------------------------------------------------ Benachrichtigungen

    async def _async_app_senden(
        self,
        person: str,
        titel: str,
        text: str,
        aid: str | None,
        knoepfe: list | None = None,
        tag: str | None = None,
    ) -> int:
        """Push an alle zugeordneten Handys der Person. Liefert die Zahl der angestoßenen Geräte."""
        if not str(person).startswith("person."):
            return 0
        einst = self.daten["einstellungen"]
        dienste = (einst.get("benachrichtigung") or {}).get(person) or []
        link = self.link + ("?aufgabe=" + aid if aid else "")
        anzahl = 0
        for dienst in dienste:
            daten: dict[str, Any] = {
                "clickAction": link,
                "url": link,
                "group": "familienaufgaben",
                "channel": "Familienaufgaben",
                "notification_icon": "mdi:clipboard-check-outline",
            }
            if tag:
                daten["tag"] = tag
            elif aid:
                daten["tag"] = "fa-" + aid
            if "uebernehmen" in (knoepfe or []) and aid:
                daten["actions"] = [
                    {"action": "FA_UEB_" + aid + "_" + person.split(".", 1)[1], "title": "Übernehmen"},
                    {"action": "URI", "title": "Öffnen", "uri": link},
                ]
            try:
                await self.hass.services.async_call(
                    "notify", dienst, {"title": titel, "message": text, "data": daten}, blocking=False
                )
                anzahl += 1
            except Exception as exc:  # noqa: BLE001 - fehlendes Handy darf nichts blockieren
                _LOGGER.warning("Familienaufgaben: Benachrichtigung über notify.%s ging nicht: %s", dienst, exc)
        return anzahl

    async def _async_an_person(
        self, person: str, titel: str, text: str, aid: str | None, knoepfe: list | None
    ) -> None:
        await self._async_app_senden(person, titel, text, aid, knoepfe)

    async def _async_erinnerung_ausliefern(self, aufgabe: dict, r: dict, jetzt: datetime) -> None:
        """Eine fällige Erinnerung an alle Empfänger über die gewählten Wege schicken."""
        einst = self.daten["einstellungen"]
        namen = self.namen()
        t = L._er_texte(aufgabe, jetzt, einst.get("uhrzeit_ohne_termin") or "08:00", namen)
        kontakte = einst.get("kontakte") or {}
        dienst = einst.get("email_dienst") or ""
        wa_bereit = self.hass.services.has_service("wa_bridge", "send_message")
        mail_bereit = bool(dienst) and self.hass.services.has_service("notify", dienst)
        wege = list(r.get("kanaele") or ["app"])
        tag = "fa-er-" + aufgabe["id"]
        bericht = []
        for person in L._er_empfaenger(aufgabe):
            kontakt = kontakte.get(person) or {}
            erreicht: list[str] = []
            fehlt: list[str] = []
            for weg in wege:
                if weg == "app":
                    if await self._async_app_senden(person, t["titel"], t["kurz"], aufgabe["id"], None, tag):
                        erreicht.append("App")
                    else:
                        fehlt.append("App")
                elif weg == "whatsapp":
                    if kontakt.get("whatsapp") and wa_bereit:
                        try:
                            await self.hass.services.async_call(
                                "wa_bridge",
                                "send_message",
                                {"number": kontakt["whatsapp"], "message": t["whatsapp"]},
                                blocking=False,
                            )
                            erreicht.append("WhatsApp")
                        except Exception as exc:  # noqa: BLE001
                            _LOGGER.warning("Familienaufgaben: WhatsApp an %s ging nicht: %s", person, exc)
                            fehlt.append("WhatsApp")
                    else:
                        fehlt.append("WhatsApp")
                elif weg == "email":
                    if kontakt.get("email") and mail_bereit:
                        try:
                            await self.hass.services.async_call(
                                "notify",
                                dienst,
                                {"title": t["betreff"], "message": t["email"], "target": [kontakt["email"]]},
                                blocking=False,
                            )
                            erreicht.append("E-Mail")
                        except Exception as exc:  # noqa: BLE001
                            _LOGGER.warning("Familienaufgaben: E-Mail an %s ging nicht: %s", person, exc)
                            fehlt.append("E-Mail")
                    else:
                        fehlt.append("E-Mail")
            if fehlt and "app" not in wege and person.startswith("person."):
                if await self._async_app_senden(person, t["titel"], t["kurz"], aufgabe["id"], None, tag):
                    erreicht.append("App statt " + "/".join(fehlt))
            bericht.append(L._pname(person, namen) + ": " + (", ".join(erreicht) or "nicht erreichbar"))
        _LOGGER.info(
            "Familienaufgaben: Erinnerung „%s“ (%s) → %s",
            aufgabe.get("titel"),
            L._er_beschreibung(r),
            "; ".join(bericht) or "niemand",
        )

    async def _async_erinnerungen_pruefen(self, jetzt: datetime) -> None:
        """Fällige Erinnerungen vor dem Termin verschicken (verpasste bis 30 Minuten nachholen)."""
        daten = self.daten
        std = daten["einstellungen"].get("uhrzeit_ohne_termin") or "08:00"
        jetzt_n = jetzt.replace(tzinfo=None, second=0, microsecond=0)
        faellig = L._er_faellig(daten["aufgaben"], jetzt_n, std, L.ER_NACHLAUF_MIN)
        if not faellig:
            return
        for aid, r, schluessel in faellig:
            aufgabe = self._finde(aid)
            if not aufgabe:
                continue
            gesendet = dict(aufgabe.get("gesendet") or {})
            gesendet[r["id"]] = {"fuer": schluessel, "am": L._iso(jetzt)}
            aufgabe["gesendet"] = gesendet
            try:
                await self._async_erinnerung_ausliefern(aufgabe, r, jetzt_n)
            except Exception as exc:  # noqa: BLE001 - eine Erinnerung darf die anderen nicht aufhalten
                _LOGGER.warning("Familienaufgaben: Erinnerung für „%s“ ging nicht: %s", aufgabe.get("titel"), exc)
        await self.async_geaendert()

    async def _async_senden(self, meldungen: list | None, akteur: str) -> None:
        einst = self.daten["einstellungen"]
        for meldung in meldungen or []:
            if meldung["art"] == "ersteller" and not einst.get("ersteller_melden", True):
                continue
            if meldung["art"] == "zugewiesen" and not einst.get("zugewiesene_melden", True):
                continue
            for person in meldung["an"]:
                if person and person != akteur and person.startswith("person."):
                    await self._async_an_person(
                        person, meldung["titel"], meldung["text"], meldung["aufgabe"], meldung.get("knoepfe")
                    )

    # ------------------------------------------------------------------ Hilfen

    def _finde(self, aid: str) -> dict | None:
        for aufgabe in self.daten["aufgaben"]:
            if aufgabe["id"] == aid:
                return aufgabe
        return None

    def _ersetzen(self, aufgabe: dict) -> None:
        liste = self.daten["aufgaben"]
        for i, alt in enumerate(liste):
            if alt["id"] == aufgabe["id"]:
                liste[i] = aufgabe
                return
        liste.append(aufgabe)

    def _externe_merken(self, aufgabe: dict) -> None:
        einst = self.daten["einstellungen"]
        externe = einst.get("externe") or []
        klein = [x.lower() for x in externe]
        for person in (aufgabe.get("fuer") or []) + (aufgabe.get("macher") or []):
            if person.startswith("extern:") and person[7:].lower() not in klein:
                externe.append(person[7:])
                klein.append(person[7:].lower())
        einst["externe"] = externe[:60]

    def _kat_ids(self) -> list[str]:
        return [k.get("id") for k in self.daten["einstellungen"].get("kategorien") or []]

    def _folge_entfernen(self, alt: dict, neu: dict) -> None:
        """Beim Wiederöffnen eine noch unberührte Folgeaufgabe der Serie entfernen."""
        nach = self._finde(alt["folge_id"])
        if nach and nach["status"] in ("neu", "planung") and len(nach.get("verlauf") or []) <= 1:
            self.daten["aufgaben"].remove(nach)
        neu["folge_id"] = None

    async def async_aktion_intern(self, aid: Any, aktion: str, params: dict, akteur: str) -> dict:
        """Übernehmen, abgeben, planen, starten, erledigen, wieder öffnen, Status, überspringen."""
        alt = self._finde(str(aid or ""))
        if not alt:
            return {"ok": False, "fehler": "Diese Aufgabe gibt es nicht mehr."}
        jetzt = dt_util.now()
        neu, folge, meldungen, fehler = L._aktion_anwenden(
            alt, aktion, params, akteur, jetzt, self.personen_ids(), self.namen()
        )
        if fehler:
            return {"ok": False, "fehler": fehler}
        if aktion == "wieder_oeffnen" and alt.get("folge_id"):
            self._folge_entfernen(alt, neu)
        self._ersetzen(neu)
        if folge:
            self._ersetzen(folge)
        ok = await self.async_geaendert()
        await self._async_senden(meldungen, akteur)
        aus: dict[str, Any] = {"ok": True, "aufgabe": neu, "folge": folge}
        if not ok:
            aus["warnung"] = WARNUNG_DATEI
        return aus

    # ------------------------------------------------------------------ Zeitplan und Knopf

    async def _async_takt(self, _jetzt: datetime) -> None:
        """Jede Minute: Tageswechsel, Erinnerungen, tägliche Übersicht, nächtliche Sicherung, Aufräumen."""
        daten = self.daten
        einst = daten["einstellungen"]
        jetzt = dt_util.now()
        hhmm = jetzt.strftime("%H:%M")
        heute = jetzt.date().isoformat()
        if hhmm == UHR_TAGESWECHSEL:
            self.veroeffentlichen()
        try:
            await self._async_erinnerungen_pruefen(jetzt)
        except Exception as exc:  # noqa: BLE001
            _LOGGER.warning("Familienaufgaben: Erinnerungsprüfung fehlgeschlagen: %s", exc)
        if einst.get("erinnerung") and hhmm == einst.get("erinnerung_zeit") and daten.get("erinnert") != heute:
            daten["erinnert"] = heute
            await self.async_speichern()
            await self._async_erinnern(False)
        if hhmm == UHR_SICHERUNG:
            await self._async_sichern(heute)
            bleiben, weg = L._aufraeumen(
                daten["aufgaben"], jetzt.date(), int(einst.get("erledigte_behalten_tage") or 90)
            )
            if weg:
                daten["aufgaben"] = bleiben
                _LOGGER.info("Familienaufgaben: %d alte erledigte Aufgaben entfernt", weg)
                await self.async_geaendert()

    async def _async_erinnern(self, probelauf: bool) -> dict[str, str]:
        texte = L._erinnerungsplan(self.daten["aufgaben"], dt_util.now().date())
        if not probelauf:
            for person, text in texte.items():
                await self._async_an_person(person, "Deine Aufgaben", text, None, [])
        return texte

    async def _async_knopf(self, event: Event) -> None:
        """Knopf „Übernehmen“ in der Benachrichtigung (Companion-App)."""
        aktion = str(event.data.get("action") or "")
        if not aktion.startswith("FA_"):
            return
        teile = aktion.split("_", 3)
        if len(teile) < 4:
            return
        person = "person." + teile[3]
        akteur = person if person in self.personen_ids() else self.akteur_finden(event.context)
        if teile[1] == "UEB":
            erg = await self.async_aktion_intern(teile[2], "uebernehmen", {}, akteur)
            if not erg.get("ok"):
                _LOGGER.warning(
                    "Familienaufgaben: Übernehmen aus der Benachrichtigung ging nicht: %s", erg.get("fehler")
                )

    # ------------------------------------------------------------------ Dienste

    async def async_dienst(self, name: str, daten: dict, context: Context | None) -> dict:
        """Führt einen Dienst aus (gleiche Antworten wie die Pyscript-Fassung)."""
        methode = getattr(self, "_dienst_" + name)
        return await methode(daten, context)

    async def _dienst_liste(self, _daten: dict, context: Context | None) -> dict:
        daten = self.daten
        einst = daten["einstellungen"]
        return copy.deepcopy(
            {
                "ok": True,
                "version": daten["zaehler"],
                "aufgaben": daten["aufgaben"],
                "papierkorb": [
                    {"id": a["id"], "titel": a["titel"], "geloescht": a.get("geloescht")}
                    for a in daten["papierkorb"]
                ][-10:],
                "einstellungen": {k: v for k, v in einst.items() if k != "benutzer"},
                "ich": self.akteur_finden(context),
                "heute": dt_util.now().date().isoformat(),
            }
        )

    async def _dienst_speichern(self, daten: dict, context: Context | None) -> dict:
        aufgabe = daten.get("aufgabe")
        if isinstance(aufgabe, dict):
            eingabe = dict(aufgabe)
        else:
            eingabe = {k: v for k, v in daten.items() if k not in ("aufgabe", "akteur")}
        wer = self.akteur_finden(context, daten.get("akteur"))
        jetzt = dt_util.now()
        alt = None
        aid = str(eingabe.get("id") or "")
        if aid:
            alt = self._finde(aid)
            if not alt:
                return {"ok": False, "fehler": "Diese Aufgabe gibt es nicht mehr – vielleicht gerade gelöscht."}
            neu, folge, meldungen, fehler = L._bearbeiten(
                alt, eingabe, wer, jetzt, self.personen_ids(), self._kat_ids(), self.namen()
            )
        else:
            folge = None
            neu, meldungen, fehler = L._erstellen(
                eingabe,
                wer,
                jetzt,
                self.personen_ids(),
                self._kat_ids(),
                self.namen(),
                self.daten["einstellungen"].get("erinnerungen_standard"),
            )
        if fehler:
            return {"ok": False, "fehler": fehler}
        if alt and alt.get("status") == "erledigt" and neu["status"] != "erledigt" and alt.get("folge_id"):
            self._folge_entfernen(alt, neu)
        self._ersetzen(neu)
        if folge:
            self._ersetzen(folge)
        self._externe_merken(neu)
        ok = await self.async_geaendert()
        await self._async_senden(meldungen, wer)
        aus: dict[str, Any] = {"ok": True, "aufgabe": neu, "folge": folge}
        if not ok:
            aus["warnung"] = WARNUNG_DATEI
        return copy.deepcopy(aus)

    async def _dienst_aktion(self, daten: dict, context: Context | None) -> dict:
        wer = self.akteur_finden(context, daten.get("akteur"))
        params = {
            "geplant": daten.get("geplant"),
            "zeit": daten.get("zeit"),
            "macher": daten.get("macher"),
            "status": daten.get("status"),
        }
        erg = await self.async_aktion_intern(daten.get("aufgabe_id"), str(daten.get("aktion") or ""), params, wer)
        return copy.deepcopy(erg)

    async def _dienst_loeschen(self, daten: dict, context: Context | None) -> dict:
        wer = self.akteur_finden(context, daten.get("akteur"))
        aufgabe = self._finde(str(daten.get("aufgabe_id") or ""))
        if not aufgabe:
            return {"ok": False, "fehler": "Diese Aufgabe gibt es nicht mehr."}
        self.daten["aufgaben"].remove(aufgabe)
        weg = copy.deepcopy(aufgabe)
        weg["geloescht"] = L._iso(dt_util.now())
        weg["geloescht_von"] = wer
        self.daten["papierkorb"] = ((self.daten.get("papierkorb") or []) + [weg])[-L.PAPIERKORB:]
        ok = await self.async_geaendert()
        await self._async_senden(L._loesch_meldungen(aufgabe, wer, self.namen()), wer)
        return {"ok": ok, "id": aufgabe["id"]}

    async def _dienst_wiederherstellen(self, daten: dict, context: Context | None) -> dict:
        wer = self.akteur_finden(context, daten.get("akteur"))
        aid = str(daten.get("aufgabe_id") or "")
        gefunden = None
        for eintrag in self.daten.get("papierkorb") or []:
            if eintrag["id"] == aid:
                gefunden = eintrag
        if not gefunden:
            return {"ok": False, "fehler": "Nicht mehr im Papierkorb."}
        self.daten["papierkorb"] = [x for x in self.daten["papierkorb"] if x["id"] != gefunden["id"]]
        aufgabe = copy.deepcopy(gefunden)
        aufgabe.pop("geloescht", None)
        aufgabe.pop("geloescht_von", None)
        aufgabe["verlauf"] = (aufgabe.get("verlauf") or []) + [L._eintrag(dt_util.now(), wer, "wiederhergestellt")]
        self._ersetzen(aufgabe)
        await self.async_geaendert()
        return copy.deepcopy({"ok": True, "aufgabe": aufgabe})

    async def _dienst_papierkorb_leeren(self, _daten: dict, _context: Context | None) -> dict:
        anzahl = len(self.daten.get("papierkorb") or [])
        self.daten["papierkorb"] = []
        await self.async_geaendert()
        return {"ok": True, "entfernt": anzahl}

    async def _dienst_einstellungen(self, daten: dict, _context: Context | None) -> dict:
        neu, fehler = L._einst_sauber(
            daten.get("einstellungen"), self.daten["einstellungen"], self.personen_ids(), self.namen()
        )
        if fehler:
            return {"ok": False, "fehler": fehler}
        kat_ids = [k["id"] for k in neu.get("kategorien") or []]
        for aufgabe in self.daten["aufgaben"]:
            if aufgabe.get("kategorie") and aufgabe["kategorie"] not in kat_ids:
                aufgabe["kategorie"] = ""
        self.daten["einstellungen"] = neu
        await self.async_geaendert()
        return copy.deepcopy({"ok": True, "einstellungen": {k: v for k, v in neu.items() if k != "benutzer"}})

    async def _dienst_ich_bin(self, daten: dict, context: Context | None) -> dict:
        uid = context.user_id if context else None
        if not uid:
            return {"ok": False, "fehler": "Kein angemeldeter Benutzer erkennbar."}
        benutzer = self.daten["einstellungen"].get("benutzer") or {}
        person = daten.get("person")
        if person and str(person) in self.personen_ids():
            benutzer[uid] = str(person)
        else:
            benutzer.pop(uid, None)
        self.daten["einstellungen"]["benutzer"] = benutzer
        await self.async_speichern()
        return {"ok": True, "ich": self.akteur_finden(context)}

    async def _dienst_erinnern(self, daten: dict, _context: Context | None) -> dict:
        probelauf = daten.get("probelauf", True)
        return {"ok": True, "texte": await self._async_erinnern(bool(probelauf))}

    async def _dienst_test(self, daten: dict, _context: Context | None) -> dict:
        """Testnachricht an eine Person über App, WhatsApp und E-Mail (soweit eingerichtet)."""
        person = str(daten.get("person") or "").strip()
        if not person:
            return {"ok": False, "fehler": "Bitte eine Person angeben."}
        if not person.startswith("person.") and not person.startswith("extern:"):
            person = "extern:" + person
        einst = self.daten["einstellungen"]
        namen = self.namen()
        gespeichert = (einst.get("kontakte") or {}).get(person) or {}
        text = "Test von Familienaufgaben für " + L._pname(person, namen) + " – so kommen deine Erinnerungen an."
        erg: dict[str, str] = {}
        if person.startswith("person."):
            dienste = (einst.get("benachrichtigung") or {}).get(person) or []
            if not dienste:
                erg["app"] = "kein Handy zugeordnet"
            else:
                fehl = []
                for dienst in dienste:
                    try:
                        await self.hass.services.async_call(
                            "notify",
                            dienst,
                            {
                                "title": "🧪 Familienaufgaben",
                                "message": text,
                                "data": {"group": "familienaufgaben", "channel": "Familienaufgaben"},
                            },
                            blocking=True,
                        )
                    except Exception as exc:  # noqa: BLE001
                        fehl.append(dienst.replace("mobile_app_", "") + ": " + str(exc))
                erg["app"] = "ok" if not fehl else "Fehler – " + "; ".join(fehl)
        else:
            erg["app"] = "nur mit Home Assistant"
        wa = L._wa_nummer(gespeichert.get("whatsapp") if daten.get("whatsapp") is None else daten.get("whatsapp"))
        if wa is None:
            erg["whatsapp"] = "Nummer stimmt nicht"
        elif not wa:
            erg["whatsapp"] = "keine Nummer"
        elif not self.hass.services.has_service("wa_bridge", "send_message"):
            erg["whatsapp"] = "WhatsApp-Bridge fehlt"
        else:
            try:
                await self.hass.services.async_call(
                    "wa_bridge", "send_message", {"number": wa, "message": "🧪 " + text}, blocking=True
                )
                erg["whatsapp"] = "ok"
            except Exception as exc:  # noqa: BLE001
                erg["whatsapp"] = "Fehler – " + str(exc)
        email = L._email_ok(gespeichert.get("email") if daten.get("email") is None else daten.get("email"))
        dienst = L._dienst_name(
            einst.get("email_dienst") if daten.get("email_dienst") is None else daten.get("email_dienst")
        )
        if email is None:
            erg["email"] = "Adresse stimmt nicht"
        elif not email:
            erg["email"] = "keine Adresse"
        elif not dienst:
            erg["email"] = "kein E-Mail-Dienst eingerichtet"
        elif not self.hass.services.has_service("notify", dienst):
            erg["email"] = "Dienst notify." + dienst + " fehlt"
        else:
            try:
                await self.hass.services.async_call(
                    "notify",
                    dienst,
                    {"title": "Test: Familienaufgaben", "message": text, "target": [email]},
                    blocking=True,
                )
                erg["email"] = "ok"
            except Exception as exc:  # noqa: BLE001
                erg["email"] = "Fehler – " + str(exc)
        return {"ok": True, "ergebnis": erg}
