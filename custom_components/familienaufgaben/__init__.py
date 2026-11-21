"""Familienaufgaben – gemeinsame Aufgaben- und Terminliste für die ganze Familie.

Aufbau
- Daten: <config>/familienaufgaben/aufgaben.json (Aufgaben, Einstellungen, Papierkorb),
  tägliche Sicherung sicherung-JJJJ-MM-TT.json (14 Tage).
- Anzeige: sensor.familienaufgaben und je Person sensor.familienaufgaben_<person>.
- Karte: custom:familienaufgaben-karte (wird automatisch geladen), optional eigener Eintrag
  in der Seitenleiste.
- Dienste: familienaufgaben.liste, speichern, aktion, loeschen, wiederherstellen,
  papierkorb_leeren, einstellungen, ich_bin, erinnern.
"""

from __future__ import annotations

import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import ConfigEntryNotReady, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import (
    DIENSTE,
    DOMAIN,
    KARTE_URL,
    OPT_LINK,
    OPT_SEITENLEISTE,
    OPT_TITEL,
    PANEL_ELEMENT,
    PANEL_PFAD,
    STANDARD_LINK,
    STANDARD_TITEL,
    STATIC_URL,
)
from .kern import FamilienaufgabenKern

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

# Die Karte schickt ganze Aufgaben-Objekte; geprüft wird in der Logik selbst.
_DIENST_SCHEMA = vol.Schema({}, extra=vol.ALLOW_EXTRA)

type FamilienaufgabenConfigEntry = ConfigEntry[FamilienaufgabenKern]


def pyscript_fassung_aktiv(hass: HomeAssistant) -> bool:
    """True, solange die frühere Pyscript-Fassung (pyscript/familienaufgaben.py) läuft."""
    return hass.services.has_service("pyscript", "familienaufgaben_liste")


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Dienste einmalig anmelden (sie greifen auf den geladenen Eintrag zu)."""

    async def _ausfuehren(call: ServiceCall) -> ServiceResponse:
        kern: FamilienaufgabenKern | None = None
        for eintrag in hass.config_entries.async_entries(DOMAIN):
            if eintrag.state is ConfigEntryState.LOADED:
                kern = eintrag.runtime_data
        if kern is None:
            raise ServiceValidationError("Familienaufgaben ist nicht eingerichtet oder noch nicht geladen.")
        return await kern.async_dienst(call.service, dict(call.data), call.context)

    for name in DIENSTE:
        hass.services.async_register(
            DOMAIN,
            name,
            _ausfuehren,
            schema=_DIENST_SCHEMA,
            supports_response=SupportsResponse.ONLY if name == "liste" else SupportsResponse.OPTIONAL,
        )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: FamilienaufgabenConfigEntry) -> bool:
    """Daten laden, Karte bereitstellen, Sensoren anlegen."""
    if pyscript_fassung_aktiv(hass):
        raise ConfigEntryNotReady(
            "Die Pyscript-Fassung (pyscript/familienaufgaben.py) läuft noch – bitte zuerst entfernen."
        )
    kern = FamilienaufgabenKern(hass, entry.options.get(OPT_LINK, STANDARD_LINK))
    await kern.async_start()
    entry.runtime_data = kern
    await _frontend_anmelden(hass, entry)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_optionen_geaendert))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: FamilienaufgabenConfigEntry) -> bool:
    """Entladen (z. B. nach geänderten Optionen)."""
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        await entry.runtime_data.async_stop()
        _frontend_abmelden(hass)
    return ok


async def _optionen_geaendert(hass: HomeAssistant, entry: FamilienaufgabenConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def _frontend_anmelden(hass: HomeAssistant, entry: FamilienaufgabenConfigEntry) -> None:
    """Karte ausliefern, auf allen Dashboards laden und optional die Seitenleiste ergänzen."""
    merker = hass.data.setdefault(DOMAIN, {})
    if not merker.get("statisch"):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(Path(__file__).parent / "frontend"), True)]
        )
        merker["statisch"] = True
    frontend.add_extra_js_url(hass, KARTE_URL)
    merker["karte"] = True
    if entry.options.get(OPT_SEITENLEISTE, True):
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_PFAD,
            webcomponent_name=PANEL_ELEMENT,
            sidebar_title=entry.options.get(OPT_TITEL) or STANDARD_TITEL,
            sidebar_icon="mdi:clipboard-check-multiple-outline",
            module_url=KARTE_URL,
            embed_iframe=False,
            require_admin=False,
        )
        merker["panel"] = True


def _frontend_abmelden(hass: HomeAssistant) -> None:
    merker = hass.data.setdefault(DOMAIN, {})
    if merker.pop("panel", False):
        frontend.async_remove_panel(hass, PANEL_PFAD)
    if merker.pop("karte", False):
        frontend.remove_extra_js_url(hass, KARTE_URL)
