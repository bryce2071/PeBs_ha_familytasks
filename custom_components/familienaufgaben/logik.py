"""Reine Logik der Familienaufgaben (ohne Home-Assistant-Abhängigkeiten).

Die Funktionen stammen 1:1 aus der früheren Pyscript-Fassung (pyscript/familienaufgaben.py),
damit sich Serien, Fristen, Status, Erinnerungen und Meldungstexte genau so verhalten wie vorher.
Änderungen: Die erste Zuordnung Person → Handy kommt als Parameter von außen
(``_normalisieren(d, standard_melden)``) statt fest im Code zu stehen, und die
Standard-Kategorien sind allgemein gehalten.
"""

from __future__ import annotations

import copy
import json
import uuid
from datetime import date, datetime, timedelta

PAPIERKORB = 20
VERLAUF_MAX = 40
SICHERUNGEN = 14

_STATUS = ["neu", "planung", "arbeit", "erledigt"]
_STATUS_NAME = {"neu": "Neu", "planung": "In Planung", "arbeit": "In Bearbeitung", "erledigt": "Erledigt"}
_WT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

_STANDARD_KATEGORIEN = [
    {"id": "haushalt", "name": "Haushalt", "icon": "mdi:broom", "farbe": "#3f7fe0"},
    {"id": "garten", "name": "Garten", "icon": "mdi:flower", "farbe": "#3a9a4a"},
    {"id": "auto", "name": "Auto", "icon": "mdi:car", "farbe": "#d64541"},
    {"id": "einkauf", "name": "Einkauf", "icon": "mdi:cart", "farbe": "#ef8a17"},
    {"id": "termine", "name": "Termine", "icon": "mdi:calendar-clock", "farbe": "#8e44ad"},
    {"id": "reparatur", "name": "Reparatur", "icon": "mdi:tools", "farbe": "#7b5a3c"},
    {"id": "freizeit", "name": "Freizeit", "icon": "mdi:television-classic", "farbe": "#16a085"},
]

# Erinnerungen vor dem Termin
_ER_EINHEITEN = ["minuten", "stunden", "tage", "wochen", "monate"]
_ER_TAGESART = ["tage", "wochen", "monate"]
_ER_KANAELE = ["app", "whatsapp", "email"]
_ER_KANAL_NAME = {"app": "App", "whatsapp": "WhatsApp", "email": "E-Mail"}
_ER_NAME = {
    "minuten": ("Minute", "Minuten"), "stunden": ("Stunde", "Stunden"), "tage": ("Tag", "Tage"),
    "wochen": ("Woche", "Wochen"), "monate": ("Monat", "Monate"),
}
ER_MAX = 10
ER_NACHLAUF_MIN = 30


# ---------------------------------------------------------------------------
# Reine Logik (nativ übersetzt – schnell und ohne Pyscript-Funktionen)
# ---------------------------------------------------------------------------

def _txt(s, n):
    return " ".join(str(s if s is not None else "").split())[:n]


def _notiz_txt(s, n):
    s = str(s if s is not None else "").replace("\r\n", "\n").replace("\r", "\n")
    aus = []
    leer = 0
    for z in s.split("\n"):
        z = z.rstrip()
        if not z.strip():
            leer += 1
            if leer > 1:
                continue
        else:
            leer = 0
        aus.append(z)
    return "\n".join(aus).strip()[:n]


def _dat(s):
    if s is None or s == "":
        return None
    if isinstance(s, datetime):
        return s.date()
    if isinstance(s, date):
        return s
    try:
        return date.fromisoformat(str(s).strip()[:10])
    except Exception:
        return None


def _dat_str(d):
    return d.isoformat() if d else None


def _zeit(s):
    if not s:
        return None
    try:
        teile = str(s).strip().split(":")
        h = int(teile[0])
        m = int(teile[1]) if len(teile) > 1 else 0
    except Exception:
        return None
    if 0 <= h <= 23 and 0 <= m <= 59:
        return "%02d:%02d" % (h, m)
    return None


def _iso(jetzt):
    return jetzt.isoformat(timespec="seconds")


def _neue_id():
    return uuid.uuid4().hex[:10]


def _slug(s):
    erlaubt = "abcdefghijklmnopqrstuvwxyz0123456789"
    s = str(s or "").lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    aus = ""
    for z in s:
        aus += z if z in erlaubt else "_"
    while "__" in aus:
        aus = aus.replace("__", "_")
    return aus.strip("_")[:30] or "k"


def _pname(p, namen):
    if not p:
        return "Jemand"
    if p.startswith("extern:"):
        return p[7:]
    if p in namen:
        return namen[p]
    return p.split(".", 1)[-1].replace("_", " ").title()


def _pnamen(liste, namen, ich=None):
    n = [("dich" if (ich and p == ich) else _pname(p, namen)) for p in liste]
    if not n:
        return ""
    if len(n) == 1:
        return n[0]
    return ", ".join(n[:-1]) + " und " + n[-1]


def _personen(werte, gueltig):
    """Liste aus person.* (die es gibt) und externen Namen (extern:Name), ohne Doppelte."""
    if werte is None:
        return []
    if isinstance(werte, str):
        werte = werte.split(",")
    if not isinstance(werte, (list, tuple)):
        return []
    aus = []
    klein = []
    for w in werte:
        if isinstance(w, dict):
            w = w.get("id") or w.get("name") or ""
        w = str(w).strip()
        if not w:
            continue
        if w.startswith("person."):
            if w not in gueltig:
                continue
            k = w
        else:
            name = _txt(w[7:] if w.startswith("extern:") else w, 40)
            if not name:
                continue
            k = "extern:" + name
        if k.lower() not in klein:
            aus.append(k)
            klein.append(k.lower())
    return aus[:12]


def _tags(werte):
    if werte is None:
        return []
    if isinstance(werte, str):
        werte = werte.split(",")
    if not isinstance(werte, (list, tuple)):
        return []
    aus = []
    klein = []
    for w in werte:
        t = _txt(w, 30).lstrip("#").strip()
        if t and t.lower() not in klein:
            aus.append(t)
            klein.append(t.lower())
    return aus[:10]


def _frist_rel(r):
    if not isinstance(r, dict):
        return None
    try:
        n = int(r.get("n"))
    except Exception:
        return None
    e = str(r.get("einheit") or "tage")
    if e not in ("tage", "wochen", "monate") or n < 1 or n > 365:
        return None
    return {"n": n, "einheit": e}


def _serie(s):
    if not isinstance(s, dict):
        return None
    e = str(s.get("einheit") or "")
    if e not in ("tage", "wochen", "monate", "jahre"):
        return None
    try:
        n = int(s.get("n") or 1)
    except Exception:
        n = 1
    n = max(1, min(99, n))
    wt = []
    if e == "wochen":
        for x in s.get("wochentage") or []:
            try:
                x = int(x)
            except Exception:
                continue
            if 0 <= x <= 6 and x not in wt:
                wt.append(x)
        wt.sort()
    return {
        "einheit": e,
        "n": n,
        "wochentage": wt,
        "basis": "erledigung" if s.get("basis") == "erledigung" else "plan",
        "ende": _dat_str(_dat(s.get("ende"))),
        "start": _dat_str(_dat(s.get("start"))),
    }


def _monatsletzter(j, m):
    if m == 12:
        return 31
    return (date(j, m + 1, 1) - timedelta(days=1)).day


def _plus(d, n, einheit, tag=None):
    if einheit == "wochen":
        return d + timedelta(days=7 * n)
    if einheit == "monate":
        m0 = d.month - 1 + n
        j = d.year + m0 // 12
        m = m0 % 12 + 1
        return date(j, m, min(tag or d.day, _monatsletzter(j, m)))
    if einheit == "jahre":
        j = d.year + n
        return date(j, d.month, min(tag or d.day, _monatsletzter(j, d.month)))
    return d + timedelta(days=n)


def _naechster(serie, ref):
    """Nächster Termin der Serie nach dem Datum ref (ref selbst zählt nicht)."""
    e = serie.get("einheit") or "tage"
    n = max(1, int(serie.get("n") or 1))
    start = _dat(serie.get("start")) or ref
    if e == "wochen" and serie.get("wochentage"):
        tage = [int(x) for x in serie["wochentage"]]
        montag0 = start - timedelta(days=start.weekday())
        d = ref + timedelta(days=1)
        for _ in range(7 * n + 8):
            if d.weekday() in tage:
                woche = ((d - timedelta(days=d.weekday())) - montag0).days // 7
                if woche % n == 0:
                    return d
            d = d + timedelta(days=1)
        return ref + timedelta(days=7 * n)
    if e in ("monate", "jahre"):
        tag = ref.day
        # Ankertag des Serienstarts behalten (z. B. 31.), wenn ref nur wegen Monatsende kürzer ist
        if start.day > ref.day and ref.day == _monatsletzter(ref.year, ref.month):
            tag = start.day
        return _plus(ref, n, e, tag)
    return _plus(ref, n, e)


def _folge_datum(serie, ref, heute, aufholen):
    """Nächster Termin; mit aufholen nie vor heute. None, wenn die Serie vorbei ist."""
    d = _naechster(serie, ref)
    if aufholen:
        i = 0
        while d < heute and i < 1000:
            d = _naechster(serie, d)
            i += 1
    ende = _dat(serie.get("ende"))
    if ende and d > ende:
        return None
    return d


def _tag_txt(d, heute, zeit=None):
    d = _dat(d)
    if not d:
        return ""
    if d == heute:
        s = "heute"
    elif d == heute + timedelta(days=1):
        s = "morgen"
    else:
        s = "%s %02d.%02d." % (_WT[d.weekday()], d.day, d.month)
        if d.year != heute.year:
            s += str(d.year)
    if zeit:
        s += " " + zeit + " Uhr"
    return s


def _zusatz(a, heute):
    t = []
    if a.get("geplant"):
        t.append(_tag_txt(a["geplant"], heute, a.get("zeit")))
    if a.get("frist"):
        t.append("bis " + _tag_txt(a["frist"], heute))
    return " · ".join(t)


def _serie_txt(s):
    if not s:
        return ""
    n = int(s.get("n") or 1)
    e = s.get("einheit")
    if e == "tage":
        t = "täglich" if n == 1 else "alle %d Tage" % n
    elif e == "wochen":
        t = "jede Woche" if n == 1 else "alle %d Wochen" % n
        if s.get("wochentage"):
            t += " (" + ", ".join(_WT[i] for i in s["wochentage"]) + ")"
    elif e == "monate":
        t = "jeden Monat" if n == 1 else "alle %d Monate" % n
    else:
        t = "jedes Jahr" if n == 1 else "alle %d Jahre" % n
    if s.get("basis") == "erledigung":
        t += " nach Erledigung"
    return t


def _eintrag(jetzt, wer, was):
    return {"z": _iso(jetzt), "wer": wer or "", "was": was}


def _meldung(an, art, titel, text, aid, knoepfe):
    return {"an": list(an), "art": art, "titel": titel, "text": text, "aufgabe": aid, "knoepfe": list(knoepfe or [])}


def _wa_nummer(s):
    """WhatsApp-Nummer → nur Ziffern mit Ländervorwahl (49…). "" = leer, None = ungültig."""
    s = str(s if s is not None else "").strip()
    if not s:
        return ""
    plus = s.startswith("+")
    ziffern = "".join(z for z in s if z.isdigit())
    if not ziffern:
        return None
    if not plus:
        if ziffern.startswith("00"):
            ziffern = ziffern[2:]
        elif ziffern.startswith("0"):
            ziffern = "49" + ziffern[1:]
    if len(ziffern) < 8 or len(ziffern) > 15:
        return None
    return ziffern


def _email_ok(s):
    """E-Mail-Adresse prüfen. "" = leer, None = ungültig."""
    s = str(s if s is not None else "").strip()
    if not s:
        return ""
    if len(s) > 120 or " " in s or s.count("@") != 1:
        return None
    lokal, dom = s.split("@")
    if not lokal or "." not in dom or dom.startswith(".") or dom.endswith(".") or ".." in dom:
        return None
    return s


def _dienst_name(s):
    s = str(s if s is not None else "").strip()
    if s.startswith("notify."):
        s = s[7:]
    if s and all(z.isalnum() or z == "_" for z in s):
        return s[:80]
    return ""


def _kontakte_sauber(werte, gueltig=None, namen=None):
    """{person.x | extern:Name: {whatsapp, email}} prüfen. Liefert (kontakte, fehler)."""
    aus = {}
    fehler = None
    if not isinstance(werte, dict):
        return aus, None
    for p, k in list(werte.items())[:80]:
        p = str(p)
        if p.startswith("person."):
            if gueltig is not None and p not in gueltig:
                continue
        elif p.startswith("extern:"):
            n = _txt(p[7:], 40)
            if not n:
                continue
            p = "extern:" + n
        else:
            continue
        if not isinstance(k, dict):
            continue
        wa = _wa_nummer(k.get("whatsapp"))
        em = _email_ok(k.get("email"))
        if wa is None:
            if not fehler:
                fehler = "Die WhatsApp-Nummer bei " + _pname(p, namen or {}) + " stimmt nicht (z. B. +49 171 1234567)."
            wa = ""
        if em is None:
            if not fehler:
                fehler = "Die E-Mail-Adresse bei " + _pname(p, namen or {}) + " stimmt nicht."
            em = ""
        if wa or em:
            aus[p] = {"whatsapp": wa, "email": em}
    return aus, fehler


def _erinnerung_sauber(r):
    if not isinstance(r, dict):
        return None
    e = str(r.get("einheit") or "")
    if e not in _ER_EINHEITEN:
        return None
    try:
        n = int(r.get("n"))
    except Exception:
        return None
    if n < 0 or n > (120 if e == "monate" else 999):
        return None
    kan = []
    werte = r.get("kanaele")
    if isinstance(werte, str):
        werte = werte.split(",")
    for k in werte or []:
        k = str(k).strip()
        if k in _ER_KANAELE and k not in kan:
            kan.append(k)
    if not kan:
        kan = ["app"]
    kan.sort(key=lambda k: _ER_KANAELE.index(k))
    rid = _txt(r.get("id"), 12)
    if rid and not all(z.isalnum() for z in rid):
        rid = ""
    return {
        "id": rid,
        "n": n,
        "einheit": e,
        "uhrzeit": _zeit(r.get("uhrzeit")) if e in _ER_TAGESART else None,
        "kanaele": kan,
    }


def _erinnerungen_sauber(liste):
    """Liste prüfen; gleiche Zeitpunkte werden zusammengelegt (Wege vereinigt)."""
    if not isinstance(liste, (list, tuple)):
        return []
    aus = []
    for r in liste[:30]:
        x = _erinnerung_sauber(r)
        if not x:
            continue
        gleich = None
        for y in aus:
            if (y["n"], y["einheit"], y["uhrzeit"]) == (x["n"], x["einheit"], x["uhrzeit"]):
                gleich = y
        if gleich:
            for k in x["kanaele"]:
                if k not in gleich["kanaele"]:
                    gleich["kanaele"].append(k)
            gleich["kanaele"].sort(key=lambda k: _ER_KANAELE.index(k))
            continue
        if len(aus) >= ER_MAX:
            break
        if not x["id"] or x["id"] in [y["id"] for y in aus]:
            x["id"] = _neue_id()[:6]
        aus.append(x)
    return aus


def _er_beschreibung(r):
    n = int(r.get("n") or 0)
    e = r.get("einheit") or "tage"
    if n == 0:
        t = "zum Termin" if e in ("minuten", "stunden") else "am Tag selbst"
    else:
        namen = _ER_NAME.get(e, ("", ""))
        t = "%d %s vorher" % (n, namen[0] if n == 1 else namen[1])
    if r.get("uhrzeit") and e in _ER_TAGESART:
        t += " um " + r["uhrzeit"]
    return t


def _bezug(a, std_zeit):
    """Bezugszeitpunkt (naiv, Ortszeit): Termin, sonst Frist. Liefert (zeitpunkt, art, mit_uhrzeit)."""
    d = _dat(a.get("geplant"))
    art = "termin"
    z = _zeit(a.get("zeit")) if d else None
    if not d:
        d = _dat(a.get("frist"))
        art = "frist"
        z = None
    if not d:
        return None, None, False
    hh, mm = (z or _zeit(std_zeit) or "08:00").split(":")
    return datetime(d.year, d.month, d.day, int(hh), int(mm)), art, bool(z)


def _er_zeitpunkt(a, r, std_zeit):
    ref, art, mit_uhr = _bezug(a, std_zeit)
    if not ref:
        return None
    n = int(r.get("n") or 0)
    e = r.get("einheit")
    if e == "minuten":
        return ref - timedelta(minutes=n)
    if e == "stunden":
        return ref - timedelta(hours=n)
    if e in _ER_TAGESART:
        if e == "monate":
            tag = _plus(ref.date(), -n, "monate")
        else:
            tag = ref.date() - timedelta(days=n * (7 if e == "wochen" else 1))
        uz = _zeit(r.get("uhrzeit"))
        if uz:
            hh, mm = uz.split(":")
            return datetime(tag.year, tag.month, tag.day, int(hh), int(mm))
        return datetime(tag.year, tag.month, tag.day, ref.hour, ref.minute)
    return None


def _er_schluessel(t):
    return t.strftime("%Y-%m-%dT%H:%M")


def _er_empfaenger(a):
    an = list(a.get("macher") or [])
    if not an:
        an = list(a.get("fuer") or [])
    if not an and a.get("erstellt_von"):
        an = [a["erstellt_von"]]
    return [p for p in an if str(p).startswith("person.") or str(p).startswith("extern:")]


def _er_faellig(aufgaben, jetzt, std_zeit, nachlauf_min):
    """Fällige, noch nicht gesendete Erinnerungen: Liste (aufgabe_id, erinnerung, schlüssel)."""
    aus = []
    fenster = timedelta(minutes=nachlauf_min)
    for a in aufgaben:
        if a.get("status") == "erledigt" or not a.get("erinnerungen"):
            continue
        ges = a.get("gesendet") or {}
        for r in a["erinnerungen"]:
            t = _er_zeitpunkt(a, r, std_zeit)
            if not t:
                continue
            k = _er_schluessel(t)
            g = ges.get(r.get("id"))
            if isinstance(g, dict) and g.get("fuer") == k:
                continue
            if t <= jetzt and jetzt - t <= fenster:
                aus.append((a["id"], r, k))
    return aus


def _rel_txt(ref, jetzt, mit_uhr):
    sek = (ref - jetzt).total_seconds()
    if sek < -60:
        return ""
    if mit_uhr and sek < 86400:
        m = int(round(sek / 60.0))
        if m <= 1:
            return "jetzt"
        if m < 60:
            return "in %d Min." % m
        h = m // 60
        rest = m % 60
        if rest == 0:
            return "in %d Std." % h
        if h >= 5:
            return "in %d Std." % int(round(m / 60.0))
        return "in %d Std. %d Min." % (h, rest)
    tage = (ref.date() - jetzt.date()).days
    if tage < 2:
        return ""
    if tage < 14:
        return "in %d Tagen" % tage
    if tage < 60:
        return "in %d Wochen" % (tage // 7)
    return "in %d Monaten" % (tage // 30)


def _er_texte(a, jetzt, std_zeit, namen):
    """Texte für App (kurz), WhatsApp/E-Mail (lang) und Betreff."""
    ref, art, mit_uhr = _bezug(a, std_zeit)
    heute = jetzt.date()
    titel = a.get("titel") or "Aufgabe"
    if art == "termin":
        wann = "Termin " + _tag_txt(a.get("geplant"), heute, a.get("zeit"))
    elif art == "frist":
        wann = "spätestens bis " + _tag_txt(a.get("frist"), heute)
    else:
        wann = ""
    rel = _rel_txt(ref, jetzt, mit_uhr) if ref else ""
    if rel:
        wann += " (" + rel + ")"
    kurz = "„" + titel + "“" + (" · " + wann if wann else "")
    zeilen = ["⏰ *Erinnerung:* " + titel]
    if wann:
        zeilen.append(wann[0].upper() + wann[1:])
    mach = a.get("macher") or []
    if mach:
        zeilen.append("Erledigt von: " + _pnamen(mach, namen))
    if a.get("notiz"):
        zeilen.append("Notiz: " + _txt(a["notiz"], 300))
    mail = [z.replace("*", "") for z in zeilen]
    return {
        "titel": "⏰ Erinnerung",
        "kurz": kurz,
        "whatsapp": "\n".join(zeilen),
        "email": "\n".join(mail) + "\n\n– Familienaufgaben",
        "betreff": "Erinnerung: " + titel + (" – " + wann if wann else ""),
    }


def _ansicht_sauber(a):
    """Standardansicht der Liste: kompakt/detailliert, Reihenfolge der Status, standardmäßig zugeklappte Status,
    Status mit Unterteilung nach geplantem Termin (Heute, Morgen, … Später)."""
    aus = {"kompakt": False, "reihenfolge": list(_STATUS), "zu": ["erledigt"], "termin": ["planung"]}
    if not isinstance(a, dict):
        return aus
    aus["kompakt"] = a.get("kompakt") is True
    r = []
    for s in a.get("reihenfolge") or []:
        if s in _STATUS and s not in r:
            r.append(s)
    for s in _STATUS:
        if s not in r:
            r.append(s)
    aus["reihenfolge"] = r
    if isinstance(a.get("zu"), list):
        aus["zu"] = [s for s in _STATUS if s in a["zu"]]
    if isinstance(a.get("termin"), list):
        aus["termin"] = [s for s in _STATUS if s in a["termin"] and s != "erledigt"]
    return aus


def _leere_aufgabe():
    return {
        "id": "", "titel": "", "notiz": "", "kategorie": "", "tags": [],
        "fuer": [], "macher": [], "status": "neu",
        "geplant": None, "zeit": None, "frist": None, "frist_rel": None,
        "serie": None, "serie_id": None, "folge_id": None,
        "erstellt": "", "erstellt_von": "", "geaendert": "", "geaendert_von": "",
        "erledigt_am": None, "erledigt_von": None, "verlauf": [],
        "erinnerungen": [], "gesendet": {},
    }


def _normalisieren(d, standard_melden=None):
    """Fehlende Schlüssel ergänzen, damit ältere oder von Hand geänderte Daten sicher laufen."""
    if not isinstance(d, dict):
        d = {}
    aus = {
        "schema": 1,
        "zaehler": int(d.get("zaehler") or 0),
        "aufgaben": [],
        "papierkorb": [],
        "einstellungen": {},
        "erinnert": str(d.get("erinnert") or ""),
    }
    for liste in ("aufgaben", "papierkorb"):
        for a in d.get(liste) or []:
            if not isinstance(a, dict) or not a.get("id"):
                continue
            b = _leere_aufgabe()
            b.update(a)
            if b["status"] not in _STATUS:
                b["status"] = "neu"
            for k in ("tags", "fuer", "macher", "verlauf", "erinnerungen"):
                if not isinstance(b.get(k), list):
                    b[k] = []
            if not isinstance(b.get("gesendet"), dict):
                b["gesendet"] = {}
            aus[liste].append(b)
    e = d.get("einstellungen") if isinstance(d.get("einstellungen"), dict) else {}
    aus["einstellungen"] = {
        "kategorien": e.get("kategorien") if isinstance(e.get("kategorien"), list) else copy.deepcopy(_STANDARD_KATEGORIEN),
        "externe": e.get("externe") if isinstance(e.get("externe"), list) else [],
        "benachrichtigung": e.get("benachrichtigung") if isinstance(e.get("benachrichtigung"), dict) else copy.deepcopy(standard_melden or {}),
        "benutzer": e.get("benutzer") if isinstance(e.get("benutzer"), dict) else {},
        "ersteller_melden": e.get("ersteller_melden", True) is not False,
        "zugewiesene_melden": e.get("zugewiesene_melden", True) is not False,
        "erinnerung": e.get("erinnerung") is True,
        "erinnerung_zeit": _zeit(e.get("erinnerung_zeit")) or "08:00",
        "erledigte_behalten_tage": int(e.get("erledigte_behalten_tage") or 90),
        "kontakte": _kontakte_sauber(e.get("kontakte"))[0],
        "erinnerungen_standard": _erinnerungen_sauber(e.get("erinnerungen_standard")),
        "uhrzeit_ohne_termin": _zeit(e.get("uhrzeit_ohne_termin")) or "08:00",
        "email_dienst": _dienst_name(e.get("email_dienst")),
        "ansicht": _ansicht_sauber(e.get("ansicht")),
    }
    return aus


def _eingabe(e, gueltig, kat_ids):
    """Felder aus Karte oder Dienst prüfen. Liefert (felder, fehler); nur übergebene Felder."""
    f = {}
    if "titel" in e:
        f["titel"] = _txt(e.get("titel"), 120)
    if "notiz" in e:
        f["notiz"] = _notiz_txt(e.get("notiz"), 2000)
    if "kategorie" in e:
        k = str(e.get("kategorie") or "")
        f["kategorie"] = k if k in kat_ids else ""
    if "tags" in e:
        f["tags"] = _tags(e.get("tags"))
    if "fuer" in e:
        f["fuer"] = _personen(e.get("fuer"), gueltig)
    if "macher" in e:
        f["macher"] = _personen(e.get("macher"), gueltig)
    if "status" in e and e.get("status"):
        s = str(e.get("status"))
        if s not in _STATUS:
            return None, "Unbekannter Status „" + s + "“."
        f["status"] = s
    if "geplant" in e:
        d = _dat(e.get("geplant"))
        if e.get("geplant") and not d:
            return None, "Das Datum für den Termin ist ungültig."
        f["geplant"] = _dat_str(d)
    if "zeit" in e:
        f["zeit"] = _zeit(e.get("zeit"))
    if "frist_modus" in e or "frist" in e or "frist_rel" in e:
        modus = e.get("frist_modus")
        if not modus:
            modus = "relativ" if e.get("frist_rel") else ("datum" if e.get("frist") else "keine")
        if modus == "datum":
            d = _dat(e.get("frist"))
            if not d:
                return None, "Bitte ein gültiges Datum bei „spätestens bis“ angeben."
            f["frist"] = _dat_str(d)
            f["frist_rel"] = None
        elif modus == "relativ":
            r = _frist_rel(e.get("frist_rel"))
            if not r:
                return None, "Bitte bei „spätestens in“ eine Zahl von 1 bis 365 angeben."
            f["frist_rel"] = r
        else:
            f["frist"] = None
            f["frist_rel"] = None
    if "serie" in e:
        if e.get("serie"):
            s = _serie(e.get("serie"))
            if not s:
                return None, "Die Wiederholung ist unvollständig."
            f["serie"] = s
        else:
            f["serie"] = None
    if "erinnerungen" in e:
        roh = e.get("erinnerungen") or []
        if not isinstance(roh, (list, tuple)):
            return None, "Die Erinnerungen sind ungültig."
        for r in roh:
            if not _erinnerung_sauber(r):
                return None, "Eine Erinnerung ist unvollständig (Zahl von 0 bis 999 und Einheit)."
        f["erinnerungen"] = _erinnerungen_sauber(roh)
    return f, None


def _erledigt_felder(alt, a, akteur, jetzt):
    if a["status"] == "erledigt" and (not alt or alt.get("status") != "erledigt"):
        a["erledigt_am"] = _iso(jetzt)
        a["erledigt_von"] = akteur or ""
    elif a["status"] != "erledigt":
        a["erledigt_am"] = None
        a["erledigt_von"] = None


def _folge(a, jetzt, akteur):
    """Nächste Aufgabe einer Serie nach „Erledigt“ (oder None, wenn die Serie endet)."""
    s = a["serie"]
    heute = jetzt.date()
    alt_g = _dat(a.get("geplant"))
    alt_f = _dat(a.get("frist"))
    if s.get("basis") == "erledigung":
        n = _folge_datum(s, heute, heute, False)
    else:
        n = _folge_datum(s, alt_g or alt_f or heute, heute, True)
    if not n:
        return None
    b = copy.deepcopy(a)
    b["id"] = _neue_id()
    b["status"] = "planung" if b.get("macher") else "neu"
    if alt_g:
        b["geplant"] = _dat_str(n)
        if alt_f:
            b["frist"] = _dat_str(n + (alt_f - alt_g))
    elif alt_f:
        b["frist"] = _dat_str(n)
    else:
        b["geplant"] = _dat_str(n)
    b["erstellt"] = _iso(jetzt)
    b["erstellt_von"] = a.get("erstellt_von") or ""
    b["geaendert"] = _iso(jetzt)
    b["geaendert_von"] = akteur or ""
    b["erledigt_am"] = None
    b["erledigt_von"] = None
    b["folge_id"] = None
    b["gesendet"] = {}
    b["serie_id"] = a.get("serie_id") or a["id"]
    b["verlauf"] = [_eintrag(jetzt, akteur, "Neu aus der Serie (" + _serie_txt(s) + ")")]
    return b


def _vergleich(alt, a, akteur, jetzt, namen, extra=None, extra_titel=None, still=()):
    """Unterschied alt → a: Verlaufseinträge anhängen und Meldungen zusammenstellen."""
    heute = jetzt.date()
    wer = _pname(akteur, namen)
    ersteller = a.get("erstellt_von") or ""
    eintraege = []
    teile = []
    titel = None
    meldungen = []
    v_m = alt.get("macher") or []
    n_m = a.get("macher") or []
    dazu = [p for p in n_m if p not in v_m]
    weg = [p for p in v_m if p not in n_m]
    uebernommen = False
    if dazu:
        if dazu == [akteur]:
            eintraege.append(wer + " übernimmt")
            teile.append("übernommen")
        else:
            eintraege.append("Ausführende: + " + _pnamen(dazu, namen))
            teile.append("eingeteilt: " + _pnamen(dazu, namen, ersteller))
        titel = "Aufgabe übernommen"
        uebernommen = True
        andere = [p for p in dazu if p.startswith("person.") and p != akteur and p != ersteller]
        if andere and a.get("status") != "erledigt":
            txt = wer + " hat dich für „" + a["titel"] + "“ eingeteilt"
            zus = _zusatz(a, heute)
            if zus:
                txt += " · " + zus
            meldungen.append(_meldung(andere, "zugewiesen", "Du bist eingeteilt", txt, a["id"], []))
    if weg:
        if weg == [akteur]:
            eintraege.append(wer + " gibt ab")
            teile.append("abgegeben")
        else:
            eintraege.append("Ausführende: − " + _pnamen(weg, namen))
            teile.append("nicht mehr eingeteilt: " + _pnamen(weg, namen, ersteller))
        titel = titel or "Aufgabe abgegeben"
    v_f = alt.get("fuer") or []
    n_f = a.get("fuer") or []
    if v_f != n_f:
        eintraege.append("Vorgesehen für: " + (_pnamen(n_f, namen) or "niemand"))
    neu_f = [p for p in n_f if p not in v_f and p.startswith("person.") and p != akteur and p not in n_m]
    if neu_f and a.get("status") != "erledigt":
        txt = wer + ": „" + a["titel"] + "“"
        zus = _zusatz(a, heute)
        if zus:
            txt += " · " + zus
        meldungen.append(_meldung(neu_f, "zugewiesen", "Neue Aufgabe für dich", txt, a["id"], ["uebernehmen"]))
    termin_neu = (alt.get("geplant"), alt.get("zeit")) != (a.get("geplant"), a.get("zeit"))
    if termin_neu:
        if a.get("geplant"):
            t = _tag_txt(a["geplant"], heute, a.get("zeit"))
            eintraege.append("Termin: " + t)
            if "termin" not in still:
                teile.append("Termin " + t)
                titel = titel or ("Termin geändert" if alt.get("geplant") else "Termin geplant")
        else:
            eintraege.append("Termin entfernt")
            if "termin" not in still:
                teile.append("Termin entfernt")
                titel = titel or "Termin geändert"
    if alt.get("frist") != a.get("frist"):
        eintraege.append("Spätestens bis: " + (_tag_txt(a["frist"], heute) if a.get("frist") else "keine Frist"))
    if alt.get("status") != a.get("status"):
        s = a.get("status")
        eintraege.append("Status: " + _STATUS_NAME.get(s, s))
        if "status" not in still:
            if s == "erledigt":
                teile.insert(0, "erledigt")
                titel = "Erledigt ✓"
            elif s == "arbeit":
                teile.append("angefangen")
                titel = titel or "In Bearbeitung"
            elif not (s == "planung" and alt.get("status") == "neu" and (uebernommen or termin_neu)):
                teile.append("Status: " + _STATUS_NAME.get(s, s))
                titel = titel or ("Wieder offen" if alt.get("status") == "erledigt" else "Status geändert")
    for k, n in (("titel", "Bezeichnung"), ("notiz", "Notiz"), ("kategorie", "Kategorie"),
                 ("tags", "Tags"), ("serie", "Wiederholung"), ("erinnerungen", "Erinnerungen")):
        if alt.get(k) != a.get(k):
            eintraege.append(n + " geändert")
    for x in extra or []:
        eintraege.append(x)
        teile.append(x)
    if extra_titel:
        titel = extra_titel
    verlauf = list(a.get("verlauf") or [])
    for t in eintraege:
        verlauf.append(_eintrag(jetzt, akteur, t))
    a["verlauf"] = verlauf[-VERLAUF_MAX:]
    if teile and titel and ersteller.startswith("person.") and ersteller != akteur:
        text = "„" + a["titel"] + "“ – " + wer + ": " + " · ".join(teile)
        meldungen.insert(0, _meldung([ersteller], "ersteller", titel, text, a["id"], []))
    return meldungen


def _serie_nach_erledigt(alt, a, jetzt, akteur, heute):
    """Bei „erledigt“ einer Serie die nächste Aufgabe anlegen. Liefert (folge, extra)."""
    if a["status"] != "erledigt" or alt.get("status") == "erledigt" or not a.get("serie") or a.get("folge_id"):
        return None, []
    folge = _folge(a, jetzt, akteur)
    if not folge:
        return None, ["Serie beendet"]
    a["folge_id"] = folge["id"]
    return folge, ["nächster Termin " + _zusatz(folge, heute)]


def _erstellen(e, akteur, jetzt, gueltig, kat_ids, namen, std_er=None):
    f, fehler = _eingabe(e, gueltig, kat_ids)
    if fehler:
        return None, [], fehler
    if not f.get("titel"):
        return None, [], "Bitte eine Bezeichnung eingeben."
    heute = jetzt.date()
    a = _leere_aufgabe()
    for k in ("titel", "notiz", "kategorie", "tags", "fuer", "macher", "geplant", "zeit", "frist", "frist_rel", "serie",
              "erinnerungen"):
        if k in f:
            a[k] = f[k]
    if "erinnerungen" not in f:
        a["erinnerungen"] = _erinnerungen_sauber(copy.deepcopy(std_er or []))
    a["id"] = _neue_id()
    a["status"] = f.get("status") or "neu"
    if not a["geplant"]:
        a["zeit"] = None
    if a["frist_rel"]:
        a["frist"] = _dat_str(_plus(heute, a["frist_rel"]["n"], a["frist_rel"]["einheit"]))
    if a["serie"]:
        a["serie_id"] = a["id"]
        if not a["serie"].get("start"):
            a["serie"]["start"] = a["geplant"] or a["frist"] or _dat_str(heute)
    a["erstellt"] = _iso(jetzt)
    a["erstellt_von"] = akteur or ""
    a["geaendert"] = _iso(jetzt)
    a["geaendert_von"] = akteur or ""
    if a["status"] == "neu" and a["macher"]:
        a["status"] = "planung"
    _erledigt_felder(None, a, akteur, jetzt)
    a["verlauf"] = [_eintrag(jetzt, akteur, "erstellt")]
    meldungen = []
    if a["status"] != "erledigt":
        zus = _zusatz(a, heute)
        wer = _pname(akteur, namen)
        m_an = [p for p in a["macher"] if p.startswith("person.") and p != akteur]
        f_an = [p for p in a["fuer"] if p.startswith("person.") and p != akteur and p not in a["macher"]]
        if f_an:
            txt = wer + ": „" + a["titel"] + "“" + (" · " + zus if zus else "")
            meldungen.append(_meldung(f_an, "zugewiesen", "Neue Aufgabe für dich", txt, a["id"], ["uebernehmen"]))
        if m_an:
            txt = wer + " hat dich für „" + a["titel"] + "“ eingeteilt" + (" · " + zus if zus else "")
            meldungen.append(_meldung(m_an, "zugewiesen", "Du bist eingeteilt", txt, a["id"], []))
    return a, meldungen, None


def _bearbeiten(alt, e, akteur, jetzt, gueltig, kat_ids, namen):
    f, fehler = _eingabe(e, gueltig, kat_ids)
    if fehler:
        return None, None, [], fehler
    if "titel" in f and not f["titel"]:
        return None, None, [], "Bitte eine Bezeichnung eingeben."
    heute = jetzt.date()
    a = copy.deepcopy(alt)
    for k in ("titel", "notiz", "kategorie", "tags", "fuer", "macher", "geplant", "zeit", "serie", "erinnerungen"):
        if k in f:
            a[k] = f[k]
    if "erinnerungen" in f:
        ids = [r["id"] for r in a["erinnerungen"]]
        a["gesendet"] = {k: v for k, v in (a.get("gesendet") or {}).items() if k in ids}
    if not a.get("geplant"):
        a["zeit"] = None
    if "frist_rel" in f:
        if f["frist_rel"]:
            if f["frist_rel"] != alt.get("frist_rel") or not alt.get("frist"):
                a["frist"] = _dat_str(_plus(heute, f["frist_rel"]["n"], f["frist_rel"]["einheit"]))
            a["frist_rel"] = f["frist_rel"]
        else:
            a["frist"] = f.get("frist")
            a["frist_rel"] = None
    if a.get("serie"):
        alte_serie = alt.get("serie") or {}
        vergleich_neu = dict(a["serie"], start=None)
        vergleich_alt = dict(alte_serie, start=None) if alte_serie else None
        if vergleich_neu != vergleich_alt or a.get("geplant") != alt.get("geplant") or not alte_serie.get("start"):
            a["serie"]["start"] = a.get("geplant") or a.get("frist") or _dat_str(heute)
        else:
            a["serie"]["start"] = alte_serie.get("start")
        if not a.get("serie_id"):
            a["serie_id"] = a["id"]
    status_explizit = "status" in f and f["status"] != alt.get("status")
    if "status" in f:
        a["status"] = f["status"]
    if not status_explizit:
        if a["status"] == "neu" and a.get("macher"):
            a["status"] = "planung"
        elif a["status"] in ("planung", "arbeit") and not a.get("macher") and alt.get("macher"):
            a["status"] = "neu"
    _erledigt_felder(alt, a, akteur, jetzt)
    folge, extra = _serie_nach_erledigt(alt, a, jetzt, akteur, heute)
    a["geaendert"] = _iso(jetzt)
    a["geaendert_von"] = akteur or ""
    meldungen = _vergleich(alt, a, akteur, jetzt, namen, extra)
    return a, folge, meldungen, None


def _aktion_anwenden(alt, aktion, p, akteur, jetzt, gueltig, namen):
    heute = jetzt.date()
    a = copy.deepcopy(alt)
    wer = _pname(akteur, namen)
    ist_person = bool(akteur) and akteur.startswith("person.")
    extra = []
    extra_titel = None
    still = ()
    if aktion == "uebernehmen":
        if not ist_person:
            return None, None, [], "Unklar, wer übernimmt – bitte oben in der Karte auswählen, wer du bist."
        if akteur not in a["macher"]:
            a["macher"] = a["macher"] + [akteur]
        if a["status"] == "neu":
            a["status"] = "planung"
    elif aktion == "abgeben":
        a["macher"] = [m for m in a["macher"] if m != akteur]
        if not a["macher"] and a["status"] in ("planung", "arbeit"):
            a["status"] = "neu"
    elif aktion == "planen":
        d = _dat(p.get("geplant"))
        if p.get("geplant") and not d:
            return None, None, [], "Das Datum ist ungültig."
        a["geplant"] = _dat_str(d)
        a["zeit"] = _zeit(p.get("zeit")) if d else None
        if p.get("macher") is not None:
            a["macher"] = _personen(p.get("macher"), gueltig)
        if a["status"] == "neu" and (a["geplant"] or a["macher"]):
            a["status"] = "planung"
        elif a["status"] in ("planung", "arbeit") and not a["macher"] and not a["geplant"]:
            a["status"] = "neu"
    elif aktion == "starten":
        a["status"] = "arbeit"
        if ist_person and not a["macher"]:
            a["macher"] = [akteur]
    elif aktion == "erledigen":
        a["status"] = "erledigt"
        if ist_person and not a["macher"]:
            a["macher"] = [akteur]
    elif aktion == "wieder_oeffnen":
        a["status"] = "planung" if a["macher"] else "neu"
    elif aktion == "status":
        s = str(p.get("status") or "")
        if s not in _STATUS:
            return None, None, [], "Unbekannter Status."
        a["status"] = s
    elif aktion == "ueberspringen":
        if not a.get("serie"):
            return None, None, [], "Überspringen geht nur bei wiederkehrenden Aufgaben."
        if a["status"] == "erledigt":
            return None, None, [], "Die Aufgabe ist schon erledigt."
        alt_g = _dat(a.get("geplant"))
        alt_f = _dat(a.get("frist"))
        ref = alt_g or alt_f or heute
        n = _folge_datum(a["serie"], ref, heute, True)
        if not n:
            a["status"] = "erledigt"
            extra = ["letzten Termin " + _tag_txt(ref, heute) + " übersprungen – Serie beendet"]
            extra_titel = "Serie beendet"
            still = ("status",)
        else:
            if alt_g:
                a["geplant"] = _dat_str(n)
                if alt_f:
                    a["frist"] = _dat_str(n + (alt_f - alt_g))
            elif alt_f:
                a["frist"] = _dat_str(n)
            else:
                a["geplant"] = _dat_str(n)
            if a["status"] == "arbeit":
                a["status"] = "planung" if a["macher"] else "neu"
            extra = ["Termin " + _tag_txt(ref, heute) + " übersprungen · nächster Termin " + _zusatz(a, heute)]
            extra_titel = "Termin übersprungen"
            still = ("termin", "status")
    else:
        return None, None, [], "Unbekannte Aktion „" + str(aktion) + "“."
    _erledigt_felder(alt, a, akteur, jetzt)
    folge, extra2 = _serie_nach_erledigt(alt, a, jetzt, akteur, heute)
    a["geaendert"] = _iso(jetzt)
    a["geaendert_von"] = akteur or ""
    meldungen = _vergleich(alt, a, akteur, jetzt, namen, extra + extra2, extra_titel, still)
    return a, folge, meldungen, None


def _loesch_meldungen(a, akteur, namen):
    ersteller = a.get("erstellt_von") or ""
    if not ersteller.startswith("person.") or ersteller == akteur:
        return []
    txt = _pname(akteur, namen) + " hat „" + a["titel"] + "“ gelöscht"
    if a.get("serie") and a.get("status") != "erledigt":
        txt += " (Serie beendet)"
    return [_meldung([ersteller], "ersteller", "Aufgabe gelöscht", txt, a["id"], [])]


def _einst_sauber(neu, alt, gueltig, namen=None):
    """Einstellungen aus der Karte prüfen und mit den bisherigen zusammenführen. Liefert (e, fehler)."""
    e = copy.deepcopy(alt)
    if not isinstance(neu, dict):
        return e, None
    if isinstance(neu.get("kategorien"), list):
        kats = []
        ids = []
        for k in neu["kategorien"][:40]:
            if not isinstance(k, dict):
                continue
            name = _txt(k.get("name"), 30)
            if not name:
                continue
            kid = _slug(k.get("id") or name)
            basis = kid
            i = 2
            while kid in ids:
                kid = basis + "_" + str(i)
                i += 1
            ids.append(kid)
            icon = _txt(k.get("icon"), 60) or "mdi:tag"
            if ":" not in icon:
                icon = "mdi:" + icon
            farbe = str(k.get("farbe") or "")
            if not (len(farbe) == 7 and farbe.startswith("#")):
                farbe = "#607d8b"
            kats.append({"id": kid, "name": name, "icon": icon, "farbe": farbe})
        e["kategorien"] = kats
    if isinstance(neu.get("externe"), list):
        ext = []
        for x in neu["externe"][:60]:
            n = _txt(str(x)[7:] if str(x).startswith("extern:") else x, 40)
            if n and n.lower() not in [y.lower() for y in ext]:
                ext.append(n)
        e["externe"] = ext
    if isinstance(neu.get("benachrichtigung"), dict):
        b = {}
        for p, dienste in neu["benachrichtigung"].items():
            if p not in gueltig or not isinstance(dienste, list):
                continue
            ok = []
            for d in dienste:
                d = str(d).replace("notify.", "")
                if d and all(z.isalnum() or z == "_" for z in d) and d not in ok:
                    ok.append(d)
            b[p] = ok
        e["benachrichtigung"] = b
    for k in ("ersteller_melden", "zugewiesene_melden", "erinnerung"):
        if k in neu:
            e[k] = bool(neu[k])
    if "erinnerung_zeit" in neu:
        e["erinnerung_zeit"] = _zeit(neu["erinnerung_zeit"]) or e.get("erinnerung_zeit") or "08:00"
    if "erledigte_behalten_tage" in neu:
        try:
            e["erledigte_behalten_tage"] = max(7, min(3650, int(neu["erledigte_behalten_tage"])))
        except Exception:
            pass
    if isinstance(neu.get("kontakte"), dict):
        k, fehler = _kontakte_sauber(neu["kontakte"], gueltig, namen)
        if fehler:
            return None, fehler
        ext = [x.lower() for x in e.get("externe") or []]
        e["kontakte"] = {p: v for p, v in k.items() if p.startswith("person.") or p[7:].lower() in ext}
    if isinstance(neu.get("erinnerungen_standard"), list):
        for r in neu["erinnerungen_standard"]:
            if not _erinnerung_sauber(r):
                return None, "Eine Standard-Erinnerung ist unvollständig (Zahl von 0 bis 999 und Einheit)."
        e["erinnerungen_standard"] = _erinnerungen_sauber(neu["erinnerungen_standard"])
    if "uhrzeit_ohne_termin" in neu:
        e["uhrzeit_ohne_termin"] = _zeit(neu["uhrzeit_ohne_termin"]) or e.get("uhrzeit_ohne_termin") or "08:00"
    if "email_dienst" in neu:
        e["email_dienst"] = _dienst_name(neu["email_dienst"])
    if "ansicht" in neu:
        e["ansicht"] = _ansicht_sauber(neu.get("ansicht"))
    return e, None


def _kennzahlen(aufgaben, heute, personen, namen):
    z = {"neu": 0, "planung": 0, "arbeit": 0, "erledigt": 0}
    ueber = 0
    heute_n = 0
    pro = {}
    for p in personen:
        pro[p] = {"offen": 0, "ueberfaellig": 0, "heute": 0, "aufgaben": []}
    offen_liste = []
    for a in aufgaben:
        s = a.get("status")
        z[s] = z.get(s, 0) + 1
        if s == "erledigt":
            continue
        f = _dat(a.get("frist"))
        g = _dat(a.get("geplant"))
        ist_ueber = bool(f and f < heute)
        ist_heute = bool((g and g == heute) or (f and f == heute))
        if ist_ueber:
            ueber += 1
        if ist_heute:
            heute_n += 1
        offen_liste.append(a)
        for p in set((a.get("macher") or []) + (a.get("fuer") or [])):
            if p in pro:
                pro[p]["offen"] += 1
                if ist_ueber:
                    pro[p]["ueberfaellig"] += 1
                if ist_heute:
                    pro[p]["heute"] += 1
                if len(pro[p]["aufgaben"]) < 25:
                    pro[p]["aufgaben"].append(a.get("titel"))
    offen_liste.sort(key=lambda a: (a.get("geplant") or a.get("frist") or "9999", a.get("erstellt") or ""))
    return {
        "offen": len(offen_liste), "zaehlung": z, "ueberfaellig": ueber, "heute": heute_n,
        "pro_person": pro, "naechste": [a.get("titel") for a in offen_liste[:10]],
    }


def _erinnerungsplan(aufgaben, heute):
    """Je Person: was heute ansteht und was überfällig ist (nur offene Aufgaben)."""
    plan = {}
    for a in aufgaben:
        if a.get("status") == "erledigt":
            continue
        g = _dat(a.get("geplant"))
        f = _dat(a.get("frist"))
        art = None
        if f and f < heute:
            art = "ueber"
        elif (g and g == heute) or (f and f == heute):
            art = "heute"
        elif g and g < heute:
            art = "verpasst"
        if not art:
            continue
        an = [p for p in (a.get("macher") or a.get("fuer") or []) if p.startswith("person.")]
        for p in an:
            eintrag = plan.setdefault(p, {"heute": [], "ueber": [], "verpasst": []})
            t = a.get("titel") or ""
            if art == "heute" and a.get("zeit") and g == heute:
                t += " (" + a["zeit"] + ")"
            eintrag[art].append(t)
    texte = {}
    for p, e in plan.items():
        t = []
        if e["heute"]:
            t.append("Heute: " + ", ".join(e["heute"]))
        if e["ueber"]:
            t.append("Überfällig: " + ", ".join(e["ueber"]))
        if e["verpasst"]:
            t.append("Termin verpasst: " + ", ".join(e["verpasst"]))
        texte[p] = " · ".join(t)
    return texte


def _aufraeumen(aufgaben, heute, tage):
    grenze = heute - timedelta(days=tage)
    bleiben = []
    weg = 0
    for a in aufgaben:
        if a.get("status") == "erledigt":
            d = _dat(a.get("erledigt_am")) or _dat(a.get("geaendert"))
            if d and d < grenze:
                weg += 1
                continue
        bleiben.append(a)
    return bleiben, weg


def _als_text(d):
    return json.dumps(d, ensure_ascii=False, indent=1)
