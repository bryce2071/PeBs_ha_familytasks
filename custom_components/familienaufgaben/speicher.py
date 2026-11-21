"""Dateizugriffe der Familienaufgaben.

Alle Funktionen sind blockierend und laufen über ``hass.async_add_executor_job``.
Verhalten wie in der früheren Pyscript-Fassung: atomares Schreiben (erst ``.tmp``,
dann umbenennen), tägliche Sicherung ``sicherung-JJJJ-MM-TT.json`` und bei einer
unlesbaren Datei wird diese beiseitegelegt und die letzte Sicherung geladen.
"""

from __future__ import annotations

import json
import os
from typing import Any


def datei_lesen(pfad: str) -> tuple[Any, str | None]:
    """Liest die Datendatei. Liefert (daten, fehler); fehlt die Datei: (None, None)."""
    if not os.path.exists(pfad):
        return None, None
    try:
        with open(pfad, encoding="utf-8") as datei:
            return json.load(datei), None
    except Exception as exc:  # noqa: BLE001 - jede Art von defekter Datei abfangen
        return None, str(exc)


def datei_schreiben(pfad: str, text: str) -> bool:
    """Schreibt atomar: erst in eine temporäre Datei, dann umbenennen."""
    os.makedirs(os.path.dirname(pfad), exist_ok=True)
    tmp = pfad + ".tmp"
    with open(tmp, "w", encoding="utf-8") as datei:
        datei.write(text)
        datei.flush()
        os.fsync(datei.fileno())
    os.replace(tmp, pfad)
    return True


def datei_sichern(ordner: str, pfad: str, tag: str, behalten: int) -> int:
    """Legt die Tagessicherung an (einmal je Tag) und entfernt alte. Liefert die Zahl der entfernten."""
    if not os.path.exists(pfad):
        return 0
    ziel = os.path.join(ordner, "sicherung-" + tag + ".json")
    if not os.path.exists(ziel):
        with open(pfad, encoding="utf-8") as quelle, open(ziel, "w", encoding="utf-8") as kopie:
            kopie.write(quelle.read())
    alle = sorted(
        name for name in os.listdir(ordner) if name.startswith("sicherung-") and name.endswith(".json")
    )
    weg = 0
    while len(alle) > behalten:
        os.remove(os.path.join(ordner, alle.pop(0)))
        weg += 1
    return weg


def letzte_sicherung(ordner: str) -> Any:
    """Liefert den Inhalt der neuesten lesbaren Sicherung oder None."""
    if not os.path.isdir(ordner):
        return None
    alle = sorted(
        name for name in os.listdir(ordner) if name.startswith("sicherung-") and name.endswith(".json")
    )
    for name in reversed(alle):
        try:
            with open(os.path.join(ordner, name), encoding="utf-8") as datei:
                return json.load(datei)
        except Exception:  # noqa: BLE001 - defekte Sicherung überspringen
            continue
    return None


def datei_beiseite(pfad: str, zusatz: str) -> None:
    """Benennt eine unlesbare Datei um (``aufgaben.json.defekt-<zusatz>``)."""
    if os.path.exists(pfad):
        os.replace(pfad, pfad + ".defekt-" + zusatz)
