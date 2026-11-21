"""Einrichtung und Optionen der Familienaufgaben."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback

from .const import DOMAIN, NAME, OPT_LINK, OPT_SEITENLEISTE, OPT_TITEL, STANDARD_LINK, STANDARD_TITEL


def _pyscript_aktiv(flow: ConfigFlow | OptionsFlow) -> bool:
    return flow.hass.services.has_service("pyscript", "familienaufgaben_liste")


def _optionen_sauber(eingabe: dict[str, Any]) -> dict[str, Any]:
    link = str(eingabe.get(OPT_LINK) or "").strip() or STANDARD_LINK
    if not link.startswith("/"):
        link = "/" + link
    return {
        OPT_SEITENLEISTE: bool(eingabe.get(OPT_SEITENLEISTE, True)),
        OPT_TITEL: str(eingabe.get(OPT_TITEL) or "").strip() or STANDARD_TITEL,
        OPT_LINK: link,
    }


class FamilienaufgabenConfigFlow(ConfigFlow, domain=DOMAIN):
    """Einrichtung: nur bestätigen – vorhandene Daten werden übernommen."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        errors: dict[str, str] = {}
        if _pyscript_aktiv(self):
            errors["base"] = "pyscript_aktiv"
        elif user_input is not None:
            return self.async_create_entry(
                title=NAME,
                data={},
                options=_optionen_sauber(
                    {OPT_SEITENLEISTE: True, OPT_TITEL: STANDARD_TITEL, OPT_LINK: STANDARD_LINK}
                ),
            )
        return self.async_show_form(step_id="user", data_schema=vol.Schema({}), errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return FamilienaufgabenOptionsFlow()


class FamilienaufgabenOptionsFlow(OptionsFlow):
    """Seitenleiste und Ziel der Benachrichtigungen."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=_optionen_sauber(user_input))
        aktuell = self.config_entry.options
        schema = vol.Schema(
            {
                vol.Required(OPT_SEITENLEISTE, default=aktuell.get(OPT_SEITENLEISTE, True)): bool,
                vol.Required(OPT_TITEL, default=aktuell.get(OPT_TITEL, STANDARD_TITEL)): str,
                vol.Required(OPT_LINK, default=aktuell.get(OPT_LINK, STANDARD_LINK)): str,
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
