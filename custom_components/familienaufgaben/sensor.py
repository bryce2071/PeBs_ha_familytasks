"""Sensoren der Familienaufgaben.

- ``sensor.familienaufgaben``: Zustand = offene Aufgaben; Attribut ``version`` zählt jede Änderung
  hoch (daran erkennt die Karte, dass sie neu laden muss).
- ``sensor.familienaufgaben_<person>``: offene Aufgaben, bei denen die Person vorgesehen oder
  eingeteilt ist – für Abzeichen und Automationen.

Die Entitäts-IDs sind dieselben wie in der früheren Pyscript-Fassung.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, NAME, SENSOR_GESAMT, SENSOR_PERSON_PRAEFIX, SIGNAL_AKTUALISIERT, VERSION
from .kern import FamilienaufgabenKern


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Sensoren anlegen; neue Personen bekommen ihren Sensor automatisch dazu."""
    kern: FamilienaufgabenKern = entry.runtime_data
    reg = er.async_get(hass)
    vorhanden: set[str] = set()

    def _id_freimachen(entity_id: str) -> None:
        # Zustände der früheren Pyscript-Fassung haben keinen Registry-Eintrag. Ohne Aufräumen
        # bekäme die neue Entität sonst eine andere ID (…_2).
        if reg.async_get(entity_id) is None and hass.states.get(entity_id) is not None:
            hass.states.async_remove(entity_id)

    def _personen_sensoren() -> list[SensorEntity]:
        neu: list[SensorEntity] = []
        for person in kern.personen_ids():
            if person in vorhanden:
                continue
            vorhanden.add(person)
            eintrag = reg.async_get(person)
            kennung = (eintrag.unique_id if eintrag and eintrag.unique_id else person).replace(".", "_")
            _id_freimachen(SENSOR_PERSON_PRAEFIX + person.split(".", 1)[1])
            neu.append(PersonenSensor(kern, entry, person, kennung))
        return neu

    _id_freimachen(SENSOR_GESAMT)
    async_add_entities([GesamtSensor(kern, entry), *_personen_sensoren()])

    @callback
    def _neue_personen() -> None:
        dazu = _personen_sensoren()
        if dazu:
            async_add_entities(dazu)

    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_AKTUALISIERT, _neue_personen))


class _Basis(SensorEntity):
    """Gemeinsame Grundlage: kein Abfragen, Aktualisierung über das Signal des Kerns."""

    _attr_should_poll = False
    _attr_has_entity_name = True

    def __init__(self, kern: FamilienaufgabenKern, entry: ConfigEntry) -> None:
        self._kern = kern
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=NAME,
            manufacturer=NAME,
            entry_type=DeviceEntryType.SERVICE,
            sw_version=VERSION,
        )

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_AKTUALISIERT, self.async_write_ha_state)
        )

    @callback
    def async_entity_id_changed(self, old_entity_id: str) -> None:
        """Nichts hängt an der eigenen Entitäts-ID – Umbenennen geht ohne Neuanlage (ab HA 2026.11)."""


class GesamtSensor(_Basis):
    """Alle offenen Aufgaben."""

    _attr_icon = "mdi:clipboard-check-multiple-outline"
    _attr_name = None  # Hauptsensor des Geräts „Familienaufgaben“ → heißt wie das Gerät
    _unrecorded_attributes = frozenset({"naechste", "stand", "version"})

    def __init__(self, kern: FamilienaufgabenKern, entry: ConfigEntry) -> None:
        super().__init__(kern, entry)
        self.entity_id = SENSOR_GESAMT
        self._attr_unique_id = f"{entry.entry_id}_gesamt"

    @property
    def native_value(self) -> int:
        return int(self._kern.kennzahlen.get("offen", 0))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        k = self._kern.kennzahlen
        z = k.get("zaehlung") or {}
        return {
            "version": self._kern.daten.get("zaehler"),
            "neu": z.get("neu", 0),
            "in_planung": z.get("planung", 0),
            "in_bearbeitung": z.get("arbeit", 0),
            "erledigt": z.get("erledigt", 0),
            "ueberfaellig": k.get("ueberfaellig", 0),
            "heute": k.get("heute", 0),
            "naechste": k.get("naechste", []),
            "stand": k.get("stand"),
        }


class PersonenSensor(_Basis):
    """Offene Aufgaben einer Person (vorgesehen oder eingeteilt)."""

    _attr_icon = "mdi:account-check-outline"
    _unrecorded_attributes = frozenset({"aufgaben"})

    def __init__(self, kern: FamilienaufgabenKern, entry: ConfigEntry, person: str, kennung: str) -> None:
        super().__init__(kern, entry)
        self._person = person
        self.entity_id = SENSOR_PERSON_PRAEFIX + person.split(".", 1)[1]
        self._attr_unique_id = f"{entry.entry_id}_person_{kennung}"

    @property
    def name(self) -> str:
        # Mit dem Gerätenamen davor: „Familienaufgaben Lena“
        return self._kern.namen_cache.get(self._person, self._person)

    @property
    def available(self) -> bool:
        return self.hass.states.get(self._person) is not None

    def _werte(self) -> dict[str, Any]:
        return (self._kern.kennzahlen.get("pro_person") or {}).get(self._person) or {
            "offen": 0,
            "ueberfaellig": 0,
            "heute": 0,
            "aufgaben": [],
        }

    @property
    def native_value(self) -> int:
        return int(self._werte().get("offen", 0))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        w = self._werte()
        return {
            "person": self._person,
            "ueberfaellig": w.get("ueberfaellig", 0),
            "heute": w.get("heute", 0),
            "aufgaben": w.get("aufgaben", []),
        }
