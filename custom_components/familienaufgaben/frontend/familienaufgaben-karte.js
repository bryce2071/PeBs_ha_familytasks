/*
 * Familienaufgaben-Karte (custom:familienaufgaben-karte)
 * Gemeinsame Aufgaben- und Terminliste für die Familie.
 * Daten und Logik: Integration „Familienaufgaben“ (Dienste familienaufgaben.*); läuft auch noch
 * mit der früheren Pyscript-Fassung (Dienste pyscript.familienaufgaben_*).
 * Anzeige-Sensor: sensor.familienaufgaben (Attribut version → Karte lädt neu).
 */
const FA_VERSION = "1.5.0";

const STATUS = [
  { id: "neu", name: "Neu", icon: "mdi:inbox-arrow-down", farbe: "#2b8be6" },
  { id: "planung", name: "In Planung", icon: "mdi:calendar-account", farbe: "#e39b00" },
  { id: "arbeit", name: "In Bearbeitung", icon: "mdi:progress-wrench", farbe: "#8e5bd8" },
  { id: "erledigt", name: "Erledigt", icon: "mdi:check-circle", farbe: "#2e9d57" },
];
const STATUS_MAP = Object.fromEntries(STATUS.map((s) => [s.id, s]));
const SORTIERUNG = [
  ["faellig", "Nächster Termin / Frist"],
  ["erstellt_neu", "Erstellt – neueste zuerst"],
  ["erstellt_alt", "Erstellt – älteste zuerst"],
  ["geplant", "Geplanter Tag"],
  ["frist", "Frist (spätestens)"],
  ["geaendert", "Zuletzt geändert"],
  ["titel", "Bezeichnung A–Z"],
];
const GRUPPEN = [
  ["status", "Status"],
  ["kategorie", "Kategorie"],
  ["person", "Person"],
  ["keine", "Keine"],
];
const WT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const EINHEIT = {
  tage: ["Tag", "Tage", "Tagen"],
  wochen: ["Woche", "Wochen", "Wochen"],
  monate: ["Monat", "Monate", "Monaten"],
  jahre: ["Jahr", "Jahre", "Jahren"],
};
const ER_EINHEIT = {
  minuten: ["Minute", "Minuten"],
  stunden: ["Stunde", "Stunden"],
  tage: ["Tag", "Tage"],
  wochen: ["Woche", "Wochen"],
  monate: ["Monat", "Monate"],
};
const ER_TAGESART = ["tage", "wochen", "monate"];
const ER_KANAL = [
  { id: "app", name: "App", icon: "mdi:cellphone" },
  { id: "whatsapp", name: "WhatsApp", icon: "mdi:whatsapp" },
  { id: "email", name: "E-Mail", icon: "mdi:email-outline" },
];
const ER_KANAL_MAP = Object.fromEntries(ER_KANAL.map((k) => [k.id, k]));
const ER_VORLAGEN = [[15, "minuten"], [1, "stunden"], [1, "tage"], [1, "wochen"]];
// notify-Dienste, die keine E-Mail verschicken
const ER_KEIN_MAIL = ["notify", "send_message", "persistent_notification", "whatsapp"];
const ICONS = [
  "mdi:broom", "mdi:vacuum", "mdi:washing-machine", "mdi:dishwasher", "mdi:silverware-fork-knife",
  "mdi:trash-can-outline", "mdi:flower", "mdi:pool", "mdi:car", "mdi:car-wrench", "mdi:cart",
  "mdi:calendar-clock", "mdi:doctor", "mdi:tools", "mdi:hammer-wrench", "mdi:television-classic",
  "mdi:movie-open", "mdi:gamepad-variant", "mdi:fish", "mdi:paw", "mdi:school", "mdi:briefcase",
  "mdi:cash", "mdi:file-document-outline", "mdi:gift-outline", "mdi:party-popper", "mdi:airplane",
  "mdi:bike", "mdi:dumbbell", "mdi:home-roof", "mdi:lightbulb-outline", "mdi:phone", "mdi:tag-outline",
];
const UI_KEY = "familienaufgaben-karte-v1";
const UI_STANDARD = {
  person: "alle", kategorie: "", tag: "", sort: "faellig", gruppe: "status",
  erledigte: true, ich: "",
};
// Standardansicht beim Öffnen: Darstellung, Reihenfolge der Status, zugeklappte Status, nach Termin unterteilte Status
function ansichtSauber(a) {
  const ids = STATUS.map((s) => s.id);
  const aus = { kompakt: false, reihenfolge: [...ids], zu: ["erledigt"], termin: ["planung"] };
  if (!a || typeof a !== "object") return aus;
  aus.kompakt = a.kompakt === true;
  const r = [];
  for (const s of Array.isArray(a.reihenfolge) ? a.reihenfolge : []) if (ids.includes(s) && !r.includes(s)) r.push(s);
  for (const s of ids) if (!r.includes(s)) r.push(s);
  aus.reihenfolge = r;
  if (Array.isArray(a.zu)) aus.zu = ids.filter((s) => a.zu.includes(s));
  if (Array.isArray(a.termin)) aus.termin = ids.filter((s) => s !== "erledigt" && a.termin.includes(s));
  return aus;
}

// ------------------------------------------------------------------ Hilfen
const esc = (s) =>
  String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
const zwei = (n) => String(n).padStart(2, "0");
const datStr = (d) => `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
const heuteStr = () => datStr(new Date());

function parseDat(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function plusTage(s, n) {
  const d = parseDat(s);
  d.setDate(d.getDate() + n);
  return datStr(d);
}
function plusEinheit(s, n, einheit) {
  const d = parseDat(s);
  if (einheit === "wochen") d.setDate(d.getDate() + 7 * n);
  else if (einheit === "monate") {
    const tag = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(tag, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  } else d.setDate(d.getDate() + n);
  return datStr(d);
}
function tageBis(s, heute) {
  const a = parseDat(s);
  const b = parseDat(heute);
  if (!a || !b) return null;
  return Math.round((a - b) / 86400000);
}
function wochentag(s) {
  const d = parseDat(s);
  return d ? (d.getDay() + 6) % 7 : null;
}
function naechsterWochentag(heute, wt) {
  const d = parseDat(heute);
  const diff = (wt - ((d.getDay() + 6) % 7) + 7) % 7;
  d.setDate(d.getDate() + diff);
  return datStr(d);
}
function fmtTag(s, heute, kurz = false) {
  const d = parseDat(s);
  if (!d) return "";
  const diff = tageBis(s, heute);
  if (!kurz) {
    if (diff === 0) return "heute";
    if (diff === 1) return "morgen";
    if (diff === -1) return "gestern";
  }
  let t = `${WT[(d.getDay() + 6) % 7]} ${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}.`;
  if (d.getFullYear() !== parseDat(heute).getFullYear()) t += d.getFullYear();
  return t;
}
function fmtZeitpunkt(iso, heute) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const uhr = `${zwei(d.getHours())}:${zwei(d.getMinutes())}`;
  const diff = tageBis(datStr(d), heute);
  if (diff === 0) return `heute ${uhr}`;
  if (diff === -1) return `gestern ${uhr}`;
  let t = `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}.`;
  if (d.getFullYear() !== parseDat(heute).getFullYear()) t += d.getFullYear();
  return `${t} ${uhr}`;
}
function serieText(s) {
  if (!s) return "";
  const n = Number(s.n) || 1;
  let t;
  if (s.einheit === "tage") t = n === 1 ? "täglich" : `alle ${n} Tage`;
  else if (s.einheit === "wochen") {
    t = n === 1 ? "jede Woche" : `alle ${n} Wochen`;
    if (s.wochentage && s.wochentage.length) t += ` (${s.wochentage.map((i) => WT[i]).join(", ")})`;
  } else if (s.einheit === "monate") t = n === 1 ? "jeden Monat" : `alle ${n} Monate`;
  else t = n === 1 ? "jedes Jahr" : `alle ${n} Jahre`;
  if (s.basis === "erledigung") t += " nach Erledigung";
  return t;
}
function fristRelText(r) {
  if (!r) return "";
  const e = EINHEIT[r.einheit] || EINHEIT.tage;
  return `spätestens in ${r.n} ${r.n === 1 ? e[0] : e[2]}`;
}
// Unterteilung nach geplantem Termin: Woche Mo–So, jedes Fach endet an seinem „bis“-Tag
const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
function terminFaecher(heute) {
  const h = parseDat(heute);
  const sonntag = plusTage(heute, 6 - ((h.getDay() + 6) % 7));
  const monat = (i) => new Date(h.getFullYear(), h.getMonth() + i, 1);
  const ende = (i) => datStr(new Date(h.getFullYear(), h.getMonth() + i + 1, 0));
  const tag = (n) => fmtTag(plusTage(heute, n), heute, true);
  return [
    { id: "verpasst", name: "Verpasst", bis: plusTage(heute, -1), kl: "verpasst", icon: "mdi:calendar-alert" },
    { id: "heute", name: "Heute", zusatz: tag(0), bis: heute, kl: "heute", icon: "mdi:calendar-today" },
    { id: "morgen", name: "Morgen", zusatz: tag(1), bis: plusTage(heute, 1), icon: "mdi:calendar-arrow-right" },
    { id: "uebermorgen", name: "Übermorgen", zusatz: tag(2), bis: plusTage(heute, 2), icon: "mdi:calendar-arrow-right" },
    { id: "woche", name: "Diese Woche", bis: sonntag, icon: "mdi:calendar-week" },
    { id: "naechste_woche", name: "Nächste Woche", bis: plusTage(sonntag, 7), icon: "mdi:calendar-week-begin" },
    { id: "monat", name: "Diesen Monat", zusatz: MONATE[monat(0).getMonth()], bis: ende(0), icon: "mdi:calendar-month" },
    { id: "naechster_monat", name: "Nächsten Monat", zusatz: MONATE[monat(1).getMonth()], bis: ende(1), icon: "mdi:calendar-month-outline" },
    { id: "spaeter", name: "Später", bis: "9999-12-31", icon: "mdi:calendar-clock" },
  ];
}
function terminGruppen(liste, heute, praefix) {
  const faecher = [...terminFaecher(heute), { id: "ohne", name: "Ohne Termin", kl: "ohne", icon: "mdi:calendar-blank-outline" }];
  const inhalt = Object.fromEntries(faecher.map((f) => [f.id, []]));
  for (const a of liste) {
    const f = a.geplant ? faecher.find((x) => x.bis && a.geplant <= x.bis) : null;
    inhalt[f ? f.id : "ohne"].push(a);
  }
  return faecher
    .filter((f) => inhalt[f.id].length)
    .map((f) => ({ key: `${praefix}|${f.id}`, name: f.name, zusatz: f.zusatz || "", kl: f.kl || "", icon: f.icon, aufgaben: inhalt[f.id] }));
}
function erText(r) {
  const n = Number(r.n) || 0;
  const e = ER_EINHEIT[r.einheit] ? r.einheit : "tage";
  let t;
  if (n === 0) t = e === "minuten" || e === "stunden" ? "zum Termin" : "am Tag selbst";
  else t = `${n} ${n === 1 ? ER_EINHEIT[e][0] : ER_EINHEIT[e][1]} vorher`;
  if (r.uhrzeit && ER_TAGESART.includes(e)) t += ` um ${r.uhrzeit}`;
  return t;
}
function erKanaeleText(r) {
  return (r.kanaele || []).map((k) => (ER_KANAL_MAP[k] || { name: k }).name).join(", ");
}
function uhrTeile(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s || ""));
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  return h <= 23 && mi <= 59 ? [h, mi] : null;
}
// Bezugszeitpunkt: Termin (mit Uhrzeit), sonst Frist; ohne Uhrzeit gilt die Uhrzeit aus den Einstellungen
function erBezug(a, std) {
  let tag = a.geplant || null;
  let uhr = a.geplant ? uhrTeile(a.zeit) : null;
  let art = "termin";
  if (!tag) {
    tag = a.frist || null;
    uhr = null;
    art = "frist";
  }
  const d = parseDat(tag);
  if (!d) return null;
  const [h, m] = uhr || uhrTeile(std) || [8, 0];
  d.setHours(h, m, 0, 0);
  return { dt: d, art, mitUhr: !!uhr };
}
function erZeit(a, r, std) {
  const b = erBezug(a, std);
  if (!b) return null;
  const n = Math.max(0, parseInt(r.n, 10) || 0);
  const t = new Date(b.dt.getTime());
  if (r.einheit === "minuten") t.setMinutes(t.getMinutes() - n);
  else if (r.einheit === "stunden") t.setHours(t.getHours() - n);
  else {
    if (r.einheit === "monate") {
      const tag = t.getDate();
      t.setDate(1);
      t.setMonth(t.getMonth() - n);
      t.setDate(Math.min(tag, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
    } else t.setDate(t.getDate() - n * (r.einheit === "wochen" ? 7 : 1));
    const u = uhrTeile(r.uhrzeit);
    if (u) t.setHours(u[0], u[1], 0, 0);
  }
  return t;
}
const erSchluessel = (t) => `${datStr(t)}T${zwei(t.getHours())}:${zwei(t.getMinutes())}`;
const fmtDatumZeit = (t, heute) => `${fmtTag(datStr(t), heute)} ${zwei(t.getHours())}:${zwei(t.getMinutes())}`;
const erId = () => Math.random().toString(36).slice(2, 8).padEnd(6, "0");
function erKopie(liste, neueIds = false) {
  return (liste || []).map((r) => ({
    id: neueIds || !r.id ? erId() : r.id,
    n: r.n === undefined || r.n === null ? 1 : r.n,
    einheit: ER_EINHEIT[r.einheit] ? r.einheit : "tage",
    uhrzeit: r.uhrzeit || "",
    kanaele: [...(r.kanaele && r.kanaele.length ? r.kanaele : ["app"])],
  }));
}
function erBereinigt(liste) {
  const aus = [];
  for (const r of liste || []) {
    const max = r.einheit === "monate" ? 120 : 999;
    const n = parseInt(r.n, 10);
    if (String(r.n === undefined || r.n === null ? "" : r.n).trim() === "" || !(n >= 0 && n <= max))
      return { fehler: `Bei den Erinnerungen bitte eine Zahl von 0 bis ${max} eintragen.` };
    if (!r.kanaele || !r.kanaele.length) return { fehler: "Bei jeder Erinnerung mindestens einen Weg wählen." };
    aus.push({ id: r.id, n, einheit: r.einheit, uhrzeit: ER_TAGESART.includes(r.einheit) && r.uhrzeit ? r.uhrzeit : null, kanaele: [...r.kanaele] });
  }
  return { liste: aus };
}
function farbeAus(text) {
  let h = 0;
  for (const z of String(text)) h = (h * 31 + z.charCodeAt(0)) % 360;
  return `hsl(${h}, 45%, 48%)`;
}
function mitAlpha(farbe, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(farbe || "");
  if (!m) return `rgba(127,127,127,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function nullZuletzt(x, y) {
  if (x === y) return 0;
  if (x === null || x === undefined) return 1;
  if (y === null || y === undefined) return -1;
  return cmpStr(x, y);
}
const terminSchluessel = (a) => (a.geplant ? `${a.geplant}T${a.zeit || "99:99"}` : null);
function faelligSchluessel(a) {
  const t = [terminSchluessel(a), a.frist ? `${a.frist}T99:99` : null].filter(Boolean).sort();
  return t[0] || null;
}
function sortiere(liste, art) {
  const neuZuerst = (a, b) => cmpStr(b.erstellt || "", a.erstellt || "");
  const fns = {
    faellig: (a, b) => nullZuletzt(faelligSchluessel(a), faelligSchluessel(b)) || neuZuerst(a, b),
    erstellt_neu: neuZuerst,
    erstellt_alt: (a, b) => cmpStr(a.erstellt || "", b.erstellt || ""),
    geplant: (a, b) => nullZuletzt(terminSchluessel(a), terminSchluessel(b)) || nullZuletzt(a.frist, b.frist) || neuZuerst(a, b),
    frist: (a, b) => nullZuletzt(a.frist, b.frist) || nullZuletzt(terminSchluessel(a), terminSchluessel(b)) || neuZuerst(a, b),
    geaendert: (a, b) => cmpStr(b.geaendert || "", a.geaendert || ""),
    titel: (a, b) => (a.titel || "").localeCompare(b.titel || "", "de", { sensitivity: "base" }) || neuZuerst(a, b),
  };
  return [...liste].sort(fns[art] || fns.faellig);
}
function ladeUi() {
  let ui;
  try {
    ui = Object.assign({}, UI_STANDARD, JSON.parse(localStorage.getItem(UI_KEY) || "{}"));
  } catch (e) {
    ui = Object.assign({}, UI_STANDARD);
  }
  for (const k of ["person", "kategorie", "tag", "sort", "gruppe", "ich"]) if (typeof ui[k] !== "string") ui[k] = UI_STANDARD[k];
  if (!ui.person) ui.person = "alle";
  delete ui.zu; // früher: zugeklappte Gruppen pro Gerät – jetzt Standardansicht
  if (ui.ansicht && typeof ui.ansicht === "object") ui.ansicht = ansichtSauber(ui.ansicht);
  else delete ui.ansicht;
  ui.erledigte = ui.erledigte !== false;
  return ui;
}
function speichereUi(ui) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch (e) {
    /* privat/gesperrt – egal */
  }
}

// ------------------------------------------------------------------ Aussehen
const CSS_BASIS = `
  :host { display: block; }
  * { box-sizing: border-box; }
  ha-icon { --mdc-icon-size: 18px; flex: none; }
  button { font: inherit; color: inherit; }
  .icon-btn { border: none; background: none; width: 36px; height: 36px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
    color: var(--secondary-text-color); }
  .icon-btn:hover { background: var(--secondary-background-color); }
  .icon-btn ha-icon { --mdc-icon-size: 22px; }
  .icon-btn:disabled { opacity: .3; cursor: default; background: none; }
  .primaer { border: none; background: var(--primary-color); color: var(--text-primary-color, #fff);
    border-radius: 18px; padding: 0 14px 0 10px; height: 36px; display: inline-flex; align-items: center;
    gap: 4px; font-weight: 500; cursor: pointer; white-space: nowrap; }
  .primaer:disabled { opacity: .5; cursor: default; }
  .sekundaer { border: 1px solid var(--divider-color); background: var(--card-background-color, #fff);
    border-radius: 18px; padding: 0 12px; height: 34px; display: inline-flex; align-items: center; gap: 6px;
    cursor: pointer; white-space: nowrap; }
  .sekundaer:hover { background: var(--secondary-background-color); }
  .sekundaer.gefahr { color: var(--error-color, #db4437); border-color: color-mix(in srgb, var(--error-color, #db4437) 40%, transparent); }
  .chip { display: inline-flex; align-items: center; gap: 4px; border-radius: 12px; padding: 2px 8px;
    font-size: 12.5px; line-height: 18px; background: var(--secondary-background-color);
    color: var(--primary-text-color); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .chip ha-icon { --mdc-icon-size: 14px; opacity: .8; }
  .chip.ueber { background: color-mix(in srgb, var(--error-color, #db4437) 16%, transparent); color: var(--error-color, #db4437); font-weight: 500; }
  .chip.bald { background: color-mix(in srgb, var(--warning-color, #ffa600) 20%, transparent); }
  .chip.verpasst { background: color-mix(in srgb, var(--warning-color, #ffa600) 20%, transparent); }
  .chip.macher { background: color-mix(in srgb, var(--primary-color) 13%, transparent); }
  .chip.tag { background: none; border: 1px solid var(--divider-color); color: var(--secondary-text-color); }
  .chip.er { white-space: normal; overflow: visible; line-height: 17px; padding-top: 3px; padding-bottom: 3px; }
  .chip.er.ok { background: color-mix(in srgb, var(--success-color, #2e9d57) 15%, transparent); }
  .chip .er-wege { display: inline-flex; gap: 1px; margin-left: 3px; }
  .av { border-radius: 50%; object-fit: cover; flex: none; display: inline-block; vertical-align: middle; }
  .av.ini { display: inline-flex; align-items: center; justify-content: center; color: #fff; background: var(--c);
    font-weight: 600; letter-spacing: .3px; }
  .av.ini.ext { background: none; color: var(--c); border: 1.5px solid var(--c); }
  .avs { display: inline-flex; align-items: center; }
  .avs .av + .av { margin-left: -5px; box-shadow: 0 0 0 1.5px var(--card-background-color, #fff); }
`;

const CSS_KARTE = `
  :host { max-width: 980px; margin: 0 auto; }
  ha-card { overflow: hidden; }
  .kopf { padding: 12px 12px 4px 16px; }
  .titelzeile { display: flex; align-items: center; gap: 8px; }
  .titelzeile > ha-icon { --mdc-icon-size: 24px; color: var(--primary-color); }
  .titel { font-size: 20px; font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ich { border: 1px solid var(--divider-color); background: none; border-radius: 16px; height: 32px;
    padding: 0 10px 0 4px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px;
    color: var(--secondary-text-color); max-width: 45%; }
  .ich span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ich.unbekannt { color: var(--error-color, #db4437); border-color: currentColor; padding-left: 10px; }
  .zahlen { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 2px; }
  .zahl { font-size: 12.5px; border-radius: 10px; padding: 1px 8px; background: var(--secondary-background-color); color: var(--secondary-text-color); }
  .zahl b { color: var(--primary-text-color); font-weight: 600; }
  .zahl.rot { background: color-mix(in srgb, var(--error-color, #db4437) 15%, transparent); color: var(--error-color, #db4437); }
  .zahl.rot b { color: inherit; }
  .werkzeug { padding: 6px 12px 4px; display: flex; flex-direction: column; gap: 8px; }
  .suchzeile { display: flex; gap: 8px; align-items: center; }
  .suche { flex: 1; display: flex; align-items: center; gap: 6px; height: 36px; border-radius: 18px; padding: 0 12px;
    background: var(--secondary-background-color); min-width: 0; }
  .suche ha-icon { color: var(--secondary-text-color); }
  .suche input { flex: 1; min-width: 0; border: none; outline: none; background: none; font: inherit; color: var(--primary-text-color); font-size: 14px; }
  .chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 1px 0 2px; -webkit-overflow-scrolling: touch; }
  .chips::-webkit-scrollbar { display: none; }
  .fchip { flex: none; border: 1px solid var(--divider-color); background: none; border-radius: 16px; height: 30px;
    padding: 0 10px; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; font-size: 13px; color: var(--primary-text-color); }
  .fchip.mitbild { padding-left: 4px; }
  .fchip.an { background: color-mix(in srgb, var(--primary-color) 16%, transparent); border-color: var(--primary-color); color: var(--primary-color); font-weight: 500; }
  .fchip .zahl-klein { font-size: 11px; opacity: .7; }
  .trenner { flex: none; width: 1px; background: var(--divider-color); margin: 4px 2px; }
  .steuer { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 13px; color: var(--secondary-text-color); }
  .steuer label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  .steuer select { font: inherit; font-size: 13px; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 8px; padding: 4px 6px; max-width: 190px; }
  .filterknopf { flex: none; height: 36px; border: 1px solid var(--divider-color); background: none; border-radius: 18px; padding: 0 8px 0 10px;
    display: inline-flex; align-items: center; gap: 4px; cursor: pointer; font-size: 13.5px; color: var(--primary-text-color); }
  .filterknopf:hover { background: var(--secondary-background-color); }
  .filterknopf.aktiv { border-color: var(--primary-color); color: var(--primary-color); }
  .filterknopf ha-icon { --mdc-icon-size: 19px; }
  .filterknopf .fk-pfeil { --mdc-icon-size: 17px; transition: transform .15s; }
  .filterknopf.offen .fk-pfeil { transform: rotate(180deg); }
  .fk-zahl { min-width: 18px; height: 18px; border-radius: 9px; background: var(--primary-color); color: var(--text-primary-color, #fff);
    font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; padding: 0 4px; box-sizing: border-box; }
  .fk-zahl[hidden] { display: none; }
  .filterbereich { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; border-radius: 12px;
    background: color-mix(in srgb, var(--secondary-background-color) 70%, transparent); }
  .filterbereich[hidden], .filterinfo[hidden] { display: none; }
  .filterinfo { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--primary-color); margin-top: -2px; }
  .filterinfo > ha-icon { --mdc-icon-size: 16px; flex: none; }
  .fi-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fi-weg { flex: none; border: none; background: none; color: inherit; width: 26px; height: 26px; border-radius: 13px; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center; padding: 0; }
  .fi-weg:hover { background: var(--secondary-background-color); }
  .fi-weg ha-icon { --mdc-icon-size: 16px; }
  .ansicht { display: flex; align-items: center; gap: 6px 10px; flex-wrap: wrap; }
  .paar { display: inline-flex; align-items: center; gap: 5px; flex: none; }
  .p-lab { font-size: 12.5px; color: var(--secondary-text-color); }
  .seg2 { display: inline-flex; border: 1px solid var(--divider-color); border-radius: 15px; overflow: hidden; }
  .seg2 button { border: none; background: none; height: 28px; padding: 0 10px 0 8px; display: inline-flex; align-items: center; gap: 3px;
    cursor: pointer; font-size: 12.5px; color: var(--primary-text-color); }
  .seg2 button + button { border-left: 1px solid var(--divider-color); }
  .seg2 button:hover { background: var(--secondary-background-color); }
  .seg2 .si { display: inline-flex; }
  .seg2 ha-icon { --mdc-icon-size: 15px; color: var(--secondary-text-color); }
  .umschalter { display: inline-flex; border: 1px solid var(--divider-color); border-radius: 15px; overflow: hidden; flex: none; }
  .ums { border: none; background: none; height: 28px; padding: 0 10px 0 8px; display: inline-flex; align-items: center; gap: 4px;
    cursor: pointer; font-size: 12.5px; color: var(--secondary-text-color); }
  .ums + .ums { border-left: 1px solid var(--divider-color); }
  .ums.an { background: color-mix(in srgb, var(--primary-color) 16%, transparent); color: var(--primary-color); font-weight: 600; }
  .mini { border: 1px solid var(--divider-color); background: none; border-radius: 15px; height: 30px; padding: 0 10px 0 7px;
    display: inline-flex; align-items: center; gap: 4px; cursor: pointer; font-size: 12.5px; color: var(--secondary-text-color); flex: none; }
  .mini:hover, .ums:not(.an):hover { background: var(--secondary-background-color); }
  .ums ha-icon, .mini ha-icon { --mdc-icon-size: 17px; }
  .hinweis:empty { display: none; }
  .hinweis { margin: 6px 12px 0; padding: 10px 12px; border-radius: 10px; font-size: 14px;
    background: color-mix(in srgb, var(--primary-color) 10%, transparent); }
  .hinweis.fehler { background: color-mix(in srgb, var(--error-color, #db4437) 12%, transparent); }
  .hinweis .knoepfe { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .liste { padding: 6px 8px 12px; }
  div.gruppe { margin-top: 6px; }
  .g-kopf { display: flex; align-items: center; gap: 8px; padding: 8px 8px 6px; cursor: pointer; user-select: none;
    font-size: 14.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: var(--primary-text-color); }
  .g-kopf .punkt { width: 10px; height: 10px; border-radius: 50%; background: var(--g); flex: none; }
  .g-kopf ha-icon.g-icon { color: var(--g); }
  .g-kopf .anz { background: var(--secondary-background-color); border-radius: 10px; padding: 0 7px; font-size: 12px; letter-spacing: 0; }
  .g-kopf .pfeil { margin-left: auto; transition: transform .15s; }
  .gruppe.zu .pfeil { transform: rotate(-90deg); }
  .gruppe.zu .g-inhalt { display: none; }
  div.gruppe:not(.unter) + div.gruppe:not(.unter) { margin-top: 12px; }
  .unterliste { margin: 2px 0 0 14px; padding: 0 0 2px 10px; border-left: 2px solid color-mix(in srgb, var(--g) 45%, transparent); }
  div.gruppe.unter { margin-top: 4px; }
  div.gruppe.unter + div.gruppe.unter { margin-top: 14px; }
  .u-kopf { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; padding: 6px 10px; border-radius: 9px; cursor: pointer; user-select: none;
    font-size: 13.5px; font-weight: 600; color: var(--primary-text-color);
    background: color-mix(in srgb, var(--secondary-background-color) 75%, transparent); }
  .u-kopf .u-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); flex: none; }
  .u-kopf .u-zusatz { font-weight: 400; color: var(--secondary-text-color); }
  .u-kopf .anz { background: var(--card-background-color, #fff); border-radius: 10px; padding: 0 7px; font-size: 11.5px; font-weight: 600; }
  .u-kopf .pfeil { margin-left: auto; transition: transform .15s; --mdc-icon-size: 18px; color: var(--secondary-text-color); }
  .u-kopf.heute { color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 13%, transparent); }
  .u-kopf.heute .u-icon, .u-kopf.heute .u-zusatz, .u-kopf.heute .pfeil { color: var(--primary-color); }
  .u-kopf.verpasst { color: var(--error-color, #db4437); background: color-mix(in srgb, var(--error-color, #db4437) 11%, transparent); }
  .u-kopf.verpasst .u-icon, .u-kopf.verpasst .pfeil { color: var(--error-color, #db4437); }
  .gruppe.unter.zu .u-kopf { margin-bottom: 0; }
  div.gruppe.unter > .g-inhalt { padding-left: 18px; }
  .leer { padding: 28px 12px; text-align: center; color: var(--secondary-text-color); font-size: 14px; }
  .leer ha-icon { --mdc-icon-size: 40px; display: block; margin: 0 auto 8px; opacity: .5; }
  .aufgabe { margin: 6px 0; border-radius: 12px; background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-left: 4px solid var(--s); overflow: hidden; transition: box-shadow .2s; }
  .aufgabe.blink { box-shadow: 0 0 0 3px var(--primary-color); }
  .aufgabe.s-erledigt .a-titel { text-decoration: line-through; color: var(--secondary-text-color); }
  .a-kopf { display: flex; gap: 10px; padding: 10px 12px 10px 10px; cursor: pointer; align-items: flex-start; }
  .a-icon { width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex: none; margin-top: 1px; }
  .a-icon ha-icon { --mdc-icon-size: 20px; }
  .a-haupt { flex: 1; min-width: 0; }
  .a-titel { font-size: 15px; font-weight: 500; line-height: 20px; word-break: break-word; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .a-titel ha-icon { --mdc-icon-size: 15px; color: var(--secondary-text-color); }
  .a-meta { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
  .a-fuss { font-size: 11.5px; color: var(--secondary-text-color); margin-top: 5px; }
  .spill { display: inline-flex; align-items: center; gap: 3px; border-radius: 10px; padding: 1px 7px; font-size: 11.5px;
    font-weight: 600; color: var(--s); background: color-mix(in srgb, var(--s) 14%, transparent); }
  .a-details { padding: 0 12px 12px 54px; font-size: 13.5px; }
  .aufgabe.kompakt { margin: 3px 0; border-radius: 10px; }
  .a-zeile { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 10px 4px 8px; cursor: pointer; }
  .z-icon { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .z-icon ha-icon { --mdc-icon-size: 19px; }
  .z-titel { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 500; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .aufgabe.s-erledigt .z-titel { text-decoration: line-through; color: var(--secondary-text-color); font-weight: 400; }
  .z-zeichen { display: inline-flex; gap: 2px; flex: none; color: var(--secondary-text-color); }
  .z-zeichen ha-icon { --mdc-icon-size: 14px; }
  .z-status { display: inline-flex; flex: none; color: var(--s); }
  .z-status ha-icon { --mdc-icon-size: 16px; }
  .z-datum { flex: none; font-size: 12.5px; line-height: 18px; color: var(--secondary-text-color); white-space: nowrap; border-radius: 9px; }
  .z-datum.heute { color: var(--primary-color); font-weight: 600; }
  .z-datum.bald, .z-datum.verpasst { background: color-mix(in srgb, var(--warning-color, #ffa600) 22%, transparent); color: var(--primary-text-color); padding: 1px 7px; }
  .z-datum.ueber { background: color-mix(in srgb, var(--error-color, #db4437) 16%, transparent); color: var(--error-color, #db4437); font-weight: 600; padding: 1px 7px; }
  .z-avs { display: inline-flex; flex: none; }
  .z-avs.vorgesehen { opacity: .55; }
  .aufgabe.kompakt .a-details { padding: 4px 12px 12px 40px; }
  .notiz { white-space: pre-wrap; word-break: break-word; background: var(--secondary-background-color); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
  .zeilen { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; align-items: center; }
  .zeilen .l { color: var(--secondary-text-color); font-size: 12.5px; }
  .zeilen .w { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; min-width: 0; }
  .pers { display: inline-flex; align-items: center; gap: 4px; margin-right: 6px; }
  .mb-wann { font-size: 12.5px; color: var(--secondary-text-color); margin-left: 2px; white-space: nowrap; }
  .a-knoepfe { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .verlauf { margin-top: 10px; font-size: 12.5px; color: var(--secondary-text-color); }
  .verlauf summary { cursor: pointer; }
  .verlauf ul { margin: 6px 0 0; padding-left: 16px; }
  .verlauf li { margin: 2px 0; }
  .fuss { padding: 0 16px 10px; font-size: 11px; color: var(--secondary-text-color); opacity: .7; text-align: right; }
  @media (max-width: 480px) {
    .a-details, .aufgabe.kompakt .a-details { padding-left: 12px; }
    .titel { font-size: 18px; }
    .ums span { display: none; }
    .seg2 .si { display: none; }
    .seg2 button { padding: 0 9px; }
    .ansicht { gap: 6px 8px; }
    .mini span { display: none; }
    .mini { padding: 0 7px; }
    .ums { padding: 0 9px; }
    .z-zeichen { display: none; }
    .unterliste { margin-left: 8px; padding-left: 7px; }
    div.gruppe.unter > .g-inhalt { padding-left: 10px; }
  }
`;

const CSS_EBENE = `
  :host { font-family: var(--ha-font-family-body, Roboto, Noto, sans-serif); color: var(--primary-text-color); }
  .hinter { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 1000; }
  .dlg { position: fixed; z-index: 1001; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: min(560px, calc(100vw - 24px)); max-height: min(88vh, 900px); display: flex; flex-direction: column;
    background: var(--card-background-color, var(--primary-background-color, #fff)); border-radius: 18px;
    box-shadow: 0 12px 40px rgba(0,0,0,.35); overflow: hidden; }
  .dlg[hidden], .hinter[hidden], .toast[hidden] { display: none; }
  @media (max-width: 600px) {
    .dlg { left: 0; right: 0; top: auto; bottom: 0; transform: none; width: 100vw; max-height: 92vh; border-radius: 18px 18px 0 0; }
  }
  .d-kopf { display: flex; align-items: center; gap: 8px; padding: 12px 8px 8px 18px; border-bottom: 1px solid var(--divider-color); }
  .d-titel { flex: 1; font-size: 18px; font-weight: 500; }
  .d-inhalt { padding: 10px 18px 16px; overflow-y: auto; flex: 1; -webkit-overflow-scrolling: touch; }
  .d-fuss { display: flex; gap: 8px; padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--divider-color); align-items: center; flex-wrap: wrap; }
  .d-fuss .platz { flex: 1; }
  .feld { margin-top: 14px; }
  .feld > .lab { font-size: 12.5px; font-weight: 600; color: var(--secondary-text-color); margin-bottom: 6px; display: flex; gap: 6px; align-items: center; }
  .feld > .lab .opt { font-weight: 400; opacity: .8; }
  .hilfe { font-size: 12px; color: var(--secondary-text-color); margin-top: 5px; }
  input[type=text], input[type=search], input[type=date], input[type=time], input[type=number], input[type=tel], input[type=email], textarea, select {
    font: inherit; font-size: 15px; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 10px; padding: 8px 10px; outline: none; max-width: 100%; }
  input:focus, textarea:focus, select:focus { border-color: var(--primary-color); box-shadow: 0 0 0 1px var(--primary-color); }
  input.gross { width: 100%; font-size: 16px; padding: 10px 12px; }
  textarea { width: 100%; min-height: 70px; resize: vertical; }
  input[type=number] { width: 72px; }
  .reihe { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .seg { display: inline-flex; flex-wrap: wrap; gap: 6px; }
  .seg button { border: 1px solid var(--divider-color); background: none; border-radius: 16px; padding: 6px 12px; cursor: pointer; font-size: 13.5px; }
  .seg button.an { background: color-mix(in srgb, var(--primary-color) 16%, transparent); border-color: var(--primary-color); color: var(--primary-color); font-weight: 600; }
  .pchips { display: flex; flex-wrap: wrap; gap: 6px; }
  .pchip { border: 1px solid var(--divider-color); background: none; border-radius: 18px; height: 34px; padding: 0 10px 0 5px;
    display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 14px; }
  .pchip.an { background: color-mix(in srgb, var(--primary-color) 16%, transparent); border-color: var(--primary-color); color: var(--primary-color); font-weight: 500; }
  .pchip.plus { padding-left: 10px; color: var(--secondary-text-color); border-style: dashed; }
  .pchip.kat { padding-left: 8px; }
  .pchip.kat.an { background: var(--kb); border-color: var(--k); color: var(--k); }
  .pchip ha-icon { --mdc-icon-size: 18px; }
  .neu-extern { display: inline-flex; gap: 6px; align-items: center; }
  .neu-extern input { width: 160px; padding: 6px 10px; }
  .klein { border: none; background: var(--primary-color); color: var(--text-primary-color, #fff); border-radius: 14px; height: 30px; padding: 0 12px; cursor: pointer; font-size: 13px; }
  .schnelltage { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .schnelltage button { border: 1px solid var(--divider-color); background: none; border-radius: 14px; height: 28px; padding: 0 10px; cursor: pointer; font-size: 12.5px; }
  .wtage { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
  .wtage button { width: 38px; height: 34px; border-radius: 10px; border: 1px solid var(--divider-color); background: none; cursor: pointer; font-size: 13px; }
  .wtage button.an { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); font-weight: 600; }
  .tagchips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
  .tagchip { display: inline-flex; align-items: center; gap: 2px; border: 1px solid var(--divider-color); border-radius: 14px; padding: 2px 4px 2px 10px; font-size: 13px; }
  .tagchip button { border: none; background: none; cursor: pointer; width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: var(--secondary-text-color); }
  .tagchip button ha-icon { --mdc-icon-size: 15px; }
  .vorschau { font-size: 12.5px; color: var(--primary-color); margin-top: 6px; }
  .d-fehler:empty { display: none; }
  .d-fehler { margin-top: 12px; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, var(--error-color, #db4437) 14%, transparent); color: var(--error-color, #db4437); font-size: 14px; }
  .abschnitt { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--divider-color); }
  .abschnitt:first-child { margin-top: 4px; padding-top: 0; border-top: none; }
  .abschnitt h3 { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
  .schalter { display: flex; align-items: center; gap: 8px; margin: 6px 0; cursor: pointer; font-size: 14px; }
  .schalter input { width: 18px; height: 18px; accent-color: var(--primary-color); }
  .geraete-box { margin-top: 6px; }
  .geraete-box summary { cursor: pointer; font-size: 14px; color: var(--primary-color); padding: 4px 0; }
  .geraete { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: start; margin-top: 8px; }
  .geraete .wer { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; padding-top: 2px; }
  .geraete .liste-g { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; }
  .geraete label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  .katzeile { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
  .katzeile input[type=text] { flex: 1; min-width: 0; padding: 6px 10px; }
  .katzeile input[type=color] { width: 36px; height: 34px; border: 1px solid var(--divider-color); border-radius: 8px; padding: 2px; background: none; }
  .kicon { width: 36px; height: 34px; border-radius: 8px; border: 1px solid var(--divider-color); background: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
  .iconraster { display: grid; grid-template-columns: repeat(auto-fill, minmax(38px, 1fr)); gap: 4px; padding: 8px; border: 1px dashed var(--divider-color); border-radius: 10px; margin: 4px 0 8px; }
  .iconraster button { height: 36px; border-radius: 8px; border: 1px solid transparent; background: none; cursor: pointer; }
  .iconraster button:hover, .iconraster button.an { border-color: var(--primary-color); }
  .iconraster input { grid-column: 1 / -1; }
  .erinn-liste { display: flex; flex-direction: column; gap: 8px; }
  .erinn { border: 1px solid var(--divider-color); border-radius: 12px; padding: 8px 6px 8px 10px; }
  .erinn .reihe { gap: 6px; }
  .erinn input[type=number] { width: 64px; padding: 7px 8px; }
  .erinn input[type=time] { padding: 7px 8px; }
  .erinn select { padding: 7px 8px; }
  .erinn .platz { flex: 1; }
  .erinn .icon-btn { width: 32px; height: 32px; }
  .er-glocke { color: var(--secondary-text-color); }
  .kchips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .kchip { border: 1px solid var(--divider-color); background: none; border-radius: 14px; height: 28px; padding: 0 10px 0 7px;
    display: inline-flex; align-items: center; gap: 4px; cursor: pointer; font-size: 12.5px; color: var(--secondary-text-color); }
  .kchip ha-icon { --mdc-icon-size: 16px; }
  .kchip.an { background: color-mix(in srgb, var(--primary-color) 16%, transparent); border-color: var(--primary-color); color: var(--primary-color); font-weight: 600; }
  .er-vorschau { font-size: 12.5px; color: var(--primary-color); margin-top: 6px; }
  .er-info .hilfe { display: flex; align-items: flex-start; gap: 4px; }
  .hilfe.warn { color: var(--warning-color, #c77700); }
  .hilfe.warn ha-icon { --mdc-icon-size: 15px; margin-top: 1px; }
  .abschnitt h4 { margin: 16px 0 6px; font-size: 13.5px; font-weight: 600; color: var(--secondary-text-color); }
  .weg { display: flex; gap: 8px; align-items: flex-start; margin: 8px 0; font-size: 14px; }
  .weg > ha-icon { margin-top: 2px; color: var(--secondary-text-color); }
  .weg > div { flex: 1; min-width: 0; }
  .weg select { padding: 5px 8px; font-size: 14px; margin-left: 4px; }
  .kontakte { display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
  .kontakt .wer { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 500; margin-bottom: 4px; }
  .kfelder { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .kfelder input { flex: 1 1 150px; min-width: 0; padding: 6px 10px; font-size: 14px; }
  .feldzeile { display: flex; align-items: center; gap: 6px 10px; flex-wrap: wrap; margin: 8px 0; font-size: 14px; }
  .feldzeile .fz-l { min-width: 92px; font-size: 13px; color: var(--secondary-text-color); }
  .lab2 { font-size: 13px; color: var(--secondary-text-color); margin: 14px 0 6px; }
  .stliste { display: flex; flex-direction: column; gap: 4px; }
  .stzeile { border: 1px solid var(--divider-color); border-left: 4px solid var(--s); border-radius: 10px; padding: 2px 6px 6px 8px; }
  .st-oben { display: flex; align-items: center; gap: 2px; }
  .st-unten { display: flex; flex-wrap: wrap; gap: 4px 16px; padding-left: 18px; }
  .st-nr { width: 18px; flex: none; font-size: 12px; color: var(--secondary-text-color); }
  .st-name { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 500; }
  .st-name ha-icon { color: var(--s); }
  .stzeile .icon-btn { width: 34px; height: 34px; }
  .stzeile .icon-btn ha-icon { --mdc-icon-size: 19px; }
  .st-wahl { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; white-space: nowrap; min-height: 26px; }
  .st-wahl input { width: 17px; height: 17px; margin: 0; accent-color: var(--primary-color); }
  .papier { display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 14px; }
  .papier span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toast { position: fixed; z-index: 1002; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
    background: #323232; color: #fff; border-radius: 10px; padding: 10px 12px 10px 16px; display: flex; align-items: center; gap: 12px;
    box-shadow: 0 6px 20px rgba(0,0,0,.35); font-size: 14px; max-width: calc(100vw - 24px); }
  .toast.oben { top: calc(16px + env(safe-area-inset-top, 0px)); bottom: auto; }
  .toast button { border: none; background: none; color: #8ab4f8; font-weight: 600; cursor: pointer; text-transform: uppercase; font-size: 13px; padding: 4px; }
`;

// ------------------------------------------------------------------ Karte
class FamilienaufgabenKarte extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._ui = ladeUi();
    this._daten = null;
    this._version = undefined;
    this._suche = "";
    this._auf = new Set();
    this._zu = new Set();
    this._kompakt = false;
    this._ansichtBereit = false;
    this._filterOffen = false;
    this._fokusId = null;
    this._dlg = null;
    this._onLoc = () => this._linkPruefen();
  }

  setConfig(config) {
    this._config = Object.assign({ titel: "Familienaufgaben", entity: "sensor.familienaufgaben" }, config || {});
    if (this._gebaut) this._zeichnen();
  }

  static getStubConfig() {
    return {};
  }

  getCardSize() {
    return 10;
  }

  getGridOptions() {
    return { columns: "full", min_columns: 6 };
  }

  connectedCallback() {
    window.addEventListener("location-changed", this._onLoc);
    window.addEventListener("popstate", this._onLoc);
  }

  disconnectedCallback() {
    window.removeEventListener("location-changed", this._onLoc);
    window.removeEventListener("popstate", this._onLoc);
    this._dlgSchliessen();
    if (this._host) {
      this._host.remove();
      this._host = null;
    }
  }

  set hass(hass) {
    const erstes = !this._hass;
    this._hass = hass;
    if (!this._config) this.setConfig({});
    if (erstes) this._aufbauen();
    const st = hass.states[this._config.entity] || this._sensorSuchen(hass);
    if (!st) {
      if (this._version !== null) {
        this._version = null;
        this._fehler = `Der Sensor ${this._config.entity} fehlt – ist die Integration „Familienaufgaben“ eingerichtet?`;
        this._zeichnen();
      }
      return;
    }
    const v = st.attributes.version;
    if (v !== this._version) {
      this._version = v;
      this._laden();
    }
  }

  get hass() {
    return this._hass;
  }

  // Rückfall: Sensor der Integration auch unter einer anderen Entitäts-ID finden
  _sensorSuchen(hass) {
    const id = Object.keys(hass.states).find((e) => {
      const a = e.startsWith("sensor.familienaufgaben") && hass.states[e].attributes;
      return a && "version" in a && "in_planung" in a;
    });
    return id ? hass.states[id] : null;
  }

  // ---------------------------------------------------------------- Daten
  async _dienst(name, daten) {
    // Integration (familienaufgaben.*) bevorzugt, sonst die frühere Pyscript-Fassung
    const integration = !!(this._hass.services && this._hass.services.familienaufgaben);
    const r = await this._hass.callWS({
      type: "call_service",
      domain: integration ? "familienaufgaben" : "pyscript",
      service: integration ? name : `familienaufgaben_${name}`,
      service_data: daten || {},
      return_response: true,
    });
    return (r && r.response) || {};
  }

  async _laden() {
    if (this._laedt) {
      this._nochmal = true;
      return;
    }
    this._laedt = true;
    try {
      const d = await this._dienst("liste", {});
      if (!d.ok) throw new Error(d.fehler || "keine Antwort");
      this._daten = d;
      this._fehler = null;
      if (!this._ansichtBereit) {
        this._ansichtBereit = true;
        this._ansichtAnwenden();
      }
    } catch (e) {
      this._fehler = `Die Aufgaben konnten nicht geladen werden (${(e && (e.message || e.code)) || e}).`;
    }
    this._laedt = false;
    this._zeichnen();
    if (!this._linkGeprueft && this._daten) {
      this._linkGeprueft = true;
      this._linkPruefen();
    }
    if (this._nochmal) {
      this._nochmal = false;
      this._laden();
    }
  }

  _aufgaben() {
    return (this._daten && this._daten.aufgaben) || [];
  }

  _einst() {
    return (this._daten && this._daten.einstellungen) || { kategorien: [], externe: [], benachrichtigung: {} };
  }

  _finde(id) {
    return this._aufgaben().find((a) => a.id === id) || null;
  }

  _lokalErsetzen(a) {
    if (!a || !this._daten) return;
    const l = this._daten.aufgaben;
    const i = l.findIndex((x) => x.id === a.id);
    if (i >= 0) l[i] = a;
    else l.push(a);
  }

  _personen() {
    const st = this._hass ? this._hass.states : {};
    return Object.keys(st)
      .filter((e) => e.startsWith("person."))
      .sort((a, b) => this._pname(a).localeCompare(this._pname(b), "de"));
  }

  _pname(id) {
    if (!id) return "Jemand";
    if (id.startsWith("extern:")) return id.slice(7);
    const st = this._hass && this._hass.states[id];
    return (st && st.attributes.friendly_name) || id.split(".").pop();
  }

  _pnamen(liste) {
    return (liste || []).map((p) => this._pname(p)).join(", ");
  }

  get _ich() {
    const personen = this._personen();
    if (this._ui.ich && personen.includes(this._ui.ich)) return this._ui.ich;
    if (this._daten && this._daten.ich && personen.includes(this._daten.ich)) return this._daten.ich;
    const uid = this._hass && this._hass.user && this._hass.user.id;
    return personen.find((p) => this._hass.states[p].attributes.user_id === uid) || "";
  }

  _kat(id) {
    return (this._einst().kategorien || []).find((k) => k.id === id) || null;
  }

  _avatar(id, px = 20) {
    if (id && id.startsWith("person.")) {
      const st = this._hass.states[id];
      const bild = st && st.attributes.entity_picture;
      if (bild) return `<img class="av" style="width:${px}px;height:${px}px" src="${esc(bild)}" alt="" loading="lazy">`;
    }
    const name = this._pname(id);
    const ini = name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const ext = id && id.startsWith("extern:");
    return `<span class="av ini ${ext ? "ext" : ""}" style="width:${px}px;height:${px}px;font-size:${Math.max(9, Math.round(px * 0.42))}px;--c:${farbeAus(name)}">${esc(ini || "?")}</span>`;
  }

  _avatare(liste, px = 18) {
    return `<span class="avs">${(liste || []).slice(0, 4).map((p) => this._avatar(p, px)).join("")}</span>`;
  }

  _uiSpeichern() {
    speichereUi(this._ui);
  }

  // Standardansicht: eigene dieses Geräts, sonst die gemeinsame aus den Einstellungen
  _ansicht() {
    return ansichtSauber(this._ui.ansicht || this._einst().ansicht);
  }

  _ansichtAnwenden() {
    const a = this._ansicht();
    this._kompakt = a.kompakt;
    this._zu = new Set(a.zu.map((s) => `status:${s}`));
    this._auf.clear();
    this._fokusId = null;
  }

  _weichtAb() {
    if (!this._ansichtBereit) return false;
    const a = this._ansicht();
    if (this._kompakt !== a.kompakt || this._auf.size || this._fokusId) return true;
    const zu = a.zu.map((s) => `status:${s}`);
    return zu.length !== this._zu.size || zu.some((k) => !this._zu.has(k));
  }

  // ---------------------------------------------------------------- Aufbau
  _aufbauen() {
    const r = this.shadowRoot;
    r.innerHTML = `
      <style>${CSS_BASIS}${CSS_KARTE}</style>
      <ha-card>
        <div class="kopf">
          <div class="titelzeile">
            <ha-icon icon="mdi:clipboard-check-multiple-outline"></ha-icon>
            <div class="titel"></div>
            <button class="ich" data-a="ich" title="Wer bist du?"></button>
            <button class="icon-btn" data-a="einstellungen" title="Einstellungen"><ha-icon icon="mdi:cog-outline"></ha-icon></button>
          </div>
          <div class="zahlen"></div>
        </div>
        <div class="werkzeug">
          <div class="suchzeile">
            <div class="suche"><ha-icon icon="mdi:magnify"></ha-icon><input type="search" placeholder="Suchen …" aria-label="Suchen"></div>
            <button class="filterknopf" data-a="filter-auf" aria-expanded="false" aria-controls="filterbereich" title="Filter, Sortierung und Gruppierung">
              <ha-icon icon="mdi:filter-variant"></ha-icon><span class="fk-text">Filter</span><span class="fk-zahl" hidden></span><ha-icon class="fk-pfeil" icon="mdi:chevron-down"></ha-icon>
            </button>
            <button class="primaer" data-a="neu"><ha-icon icon="mdi:plus"></ha-icon><span>Neu</span></button>
          </div>
          <div class="filterbereich" id="filterbereich" hidden>
            <div class="chips personen" aria-label="Personen"></div>
            <div class="chips kategorien" aria-label="Kategorien und Tags"></div>
            <div class="steuer">
              <label>Sortieren <select class="sort">${SORTIERUNG.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></label>
              <label>Gruppieren <select class="gruppe">${GRUPPEN.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></label>
              <label><input type="checkbox" class="erl"> Erledigte zeigen</label>
            </div>
          </div>
          <div class="filterinfo" hidden></div>
          <div class="ansicht"></div>
        </div>
        <div class="hinweis"></div>
        <div class="liste"></div>
        <div class="fuss"></div>
      </ha-card>`;
    r.addEventListener("click", (e) => this._klick(e));
    r.querySelector(".suche input").addEventListener("input", (e) => {
      this._suche = e.target.value;
      this._zeichneListe();
    });
    r.querySelector(".sort").addEventListener("change", (e) => {
      this._ui.sort = e.target.value;
      this._uiSpeichern();
      this._zeichneListe();
    });
    r.querySelector("select.gruppe").addEventListener("change", (e) => {
      this._ui.gruppe = e.target.value;
      this._uiSpeichern();
      this._zeichneListe();
    });
    r.querySelector(".erl").addEventListener("change", (e) => {
      this._ui.erledigte = e.target.checked;
      this._uiSpeichern();
      this._zeichneFilterInfo();
      this._zeichneListe();
    });
    this._gebaut = true;
    this._zeichnen();
  }

  // ---------------------------------------------------------------- Zeichnen
  _zeichnen() {
    if (!this._gebaut || !this._hass) return;
    const r = this.shadowRoot;
    r.querySelector(".titel").textContent = this._config.titel || "Familienaufgaben";
    const ich = this._ich;
    const ichBtn = r.querySelector(".ich");
    ichBtn.classList.toggle("unbekannt", !ich);
    ichBtn.innerHTML = ich ? `${this._avatar(ich, 24)}<span>${esc(this._pname(ich))}</span>` : `<span>Wer bist du?</span>`;
    r.querySelector(".sort").value = this._ui.sort;
    r.querySelector("select.gruppe").value = this._ui.gruppe;
    r.querySelector(".erl").checked = !!this._ui.erledigte;
    const sucheFeld = r.querySelector(".suche input");
    if (sucheFeld.value !== this._suche) sucheFeld.value = this._suche;
    this._zeichneZahlen();
    this._zeichneChips();
    this._zeichneHinweis();
    this._zeichneListe();
    r.querySelector(".fuss").textContent = `Familienaufgaben ${FA_VERSION}`;
  }

  _zeichneZahlen() {
    const heute = heuteStr();
    const alle = this._aufgaben();
    const z = { neu: 0, planung: 0, arbeit: 0 };
    let ueber = 0;
    let heuteN = 0;
    for (const a of alle) {
      if (a.status === "erledigt") continue;
      z[a.status] = (z[a.status] || 0) + 1;
      if (a.frist && a.frist < heute) ueber++;
      if (a.geplant === heute || a.frist === heute) heuteN++;
    }
    const offen = z.neu + z.planung + z.arbeit;
    const t = [`<span class="zahl"><b>${offen}</b> offen</span>`];
    for (const s of STATUS.slice(0, 3)) if (z[s.id]) t.push(`<span class="zahl"><b>${z[s.id]}</b> ${s.name.toLowerCase()}</span>`);
    if (heuteN) t.push(`<span class="zahl"><b>${heuteN}</b> heute</span>`);
    if (ueber) t.push(`<span class="zahl rot"><b>${ueber}</b> überfällig</span>`);
    this.shadowRoot.querySelector(".zahlen").innerHTML = this._daten ? t.join("") : "";
  }

  _zeichneChips() {
    const r = this.shadowRoot;
    const reiheP = r.querySelector(".personen");
    const reiheK = r.querySelector(".kategorien");
    const scrollP = reiheP.scrollLeft;
    const scrollK = reiheK.scrollLeft;
    const ich = this._ich;
    const ui = this._ui;
    const alle = this._aufgaben().filter((a) => a.status !== "erledigt");
    const anzahl = (fn) => alle.filter(fn).length;
    const chip = (wert, inhalt, extraKlasse = "", titel = "") =>
      `<button class="fchip ${ui.person === wert ? "an" : ""} ${extraKlasse}" data-a="fperson" data-w="${esc(wert)}" title="${esc(titel)}">${inhalt}</button>`;
    const p = [chip("alle", "Alle")];
    if (ich) {
      p.push(chip("meine", `Meine <span class="zahl-klein">${anzahl((a) => [...a.fuer, ...a.macher].includes(ich))}</span>`));
      p.push(chip("von_mir", "Von mir erstellt"));
    }
    p.push(chip("niemand", `Ohne Person <span class="zahl-klein">${anzahl((a) => !a.fuer.length && !a.macher.length)}</span>`));
    p.push(`<span class="trenner"></span>`);
    for (const id of this._personen()) {
      p.push(chip(id, `${this._avatar(id, 22)}${esc(this._pname(id))} <span class="zahl-klein">${anzahl((a) => [...a.fuer, ...a.macher].includes(id))}</span>`, "mitbild"));
    }
    const ext = new Set();
    for (const a of alle) for (const x of [...a.fuer, ...a.macher]) if (x.startsWith("extern:")) ext.add(x);
    if (ui.person.startsWith("extern:")) ext.add(ui.person);
    for (const id of [...ext].sort()) p.push(chip(id, `${this._avatar(id, 22)}${esc(this._pname(id))}`, "mitbild"));
    reiheP.innerHTML = p.join("");

    const k = [`<button class="fchip ${!ui.kategorie ? "an" : ""}" data-a="fkat" data-w="">Alle Kategorien</button>`];
    for (const kat of this._einst().kategorien || []) {
      const an = ui.kategorie === kat.id;
      const stil = an ? `style="background:${mitAlpha(kat.farbe, 0.16)};border-color:${kat.farbe};color:${kat.farbe}"` : "";
      k.push(`<button class="fchip ${an ? "an" : ""}" data-a="fkat" data-w="${esc(kat.id)}" ${stil}><ha-icon icon="${esc(kat.icon)}" style="color:${esc(kat.farbe)}"></ha-icon>${esc(kat.name)}</button>`);
    }
    k.push(`<button class="fchip ${ui.kategorie === "_ohne" ? "an" : ""}" data-a="fkat" data-w="_ohne">Ohne Kategorie</button>`);
    const tags = new Map();
    for (const a of this._aufgaben()) for (const t of a.tags || []) if (!tags.has(t.toLowerCase())) tags.set(t.toLowerCase(), t);
    if (ui.tag && !tags.has(ui.tag.toLowerCase())) tags.set(ui.tag.toLowerCase(), ui.tag);
    if (tags.size) {
      k.push(`<span class="trenner"></span>`);
      for (const t of [...tags.values()].sort((a, b) => a.localeCompare(b, "de"))) {
        const an = ui.tag && ui.tag.toLowerCase() === t.toLowerCase();
        k.push(`<button class="fchip ${an ? "an" : ""}" data-a="ftag" data-w="${esc(t)}">#${esc(t)}</button>`);
      }
    }
    reiheK.innerHTML = k.join("");
    reiheP.scrollLeft = scrollP;
    reiheK.scrollLeft = scrollK;
    this._zeichneFilterInfo();
  }

  // Aktive Filter: Zahl am Filterknopf, bei zugeklapptem Bereich eine Zeile mit Zurücksetzen
  _aktiveFilter() {
    const ui = this._ui;
    const aus = [];
    const pn = { meine: "Meine", von_mir: "Von mir erstellt", niemand: "Ohne Person" };
    if (ui.person && ui.person !== "alle") aus.push(pn[ui.person] || this._pname(ui.person));
    if (ui.kategorie) aus.push(ui.kategorie === "_ohne" ? "Ohne Kategorie" : (this._kat(ui.kategorie) || {}).name || ui.kategorie);
    if (ui.tag) aus.push(`#${ui.tag}`);
    if (!ui.erledigte) aus.push("ohne Erledigte");
    return aus;
  }

  _zeichneFilterInfo() {
    const r = this.shadowRoot;
    const knopf = r.querySelector(".filterknopf");
    if (!knopf) return;
    const f = this._aktiveFilter();
    const offen = !!this._filterOffen;
    r.querySelector(".filterbereich").hidden = !offen;
    knopf.classList.toggle("offen", offen);
    knopf.classList.toggle("aktiv", f.length > 0);
    knopf.setAttribute("aria-expanded", String(offen));
    const zahl = knopf.querySelector(".fk-zahl");
    zahl.hidden = !f.length;
    zahl.textContent = f.length ? String(f.length) : "";
    const info = r.querySelector(".filterinfo");
    info.hidden = offen || !f.length;
    info.innerHTML = f.length
      ? `<ha-icon icon="mdi:filter"></ha-icon><span class="fi-text">${f.map(esc).join(" · ")}</span><button class="fi-weg" data-a="filter-weg" title="Filter zurücksetzen" aria-label="Filter zurücksetzen"><ha-icon icon="mdi:close"></ha-icon></button>`
      : "";
  }

  _zeichneHinweis() {
    const h = this.shadowRoot.querySelector(".hinweis");
    h.classList.remove("fehler");
    if (this._fehler) {
      h.classList.add("fehler");
      h.innerHTML = `${esc(this._fehler)}<div class="knoepfe"><button class="sekundaer" data-a="neuladen"><ha-icon icon="mdi:refresh"></ha-icon>Neu laden</button></div>`;
      return;
    }
    if (this._daten && !this._ich) {
      h.innerHTML = `<b>Wer bist du?</b> Damit „Übernehmen“ und die Benachrichtigungen stimmen, wähle einmal aus:
        <div class="knoepfe">${this._personen().map((p) => `<button class="sekundaer" data-a="ich-setzen" data-w="${esc(p)}">${this._avatar(p, 22)}${esc(this._pname(p))}</button>`).join("")}</div>`;
      return;
    }
    h.innerHTML = "";
  }

  _passt(a, suche) {
    const ui = this._ui;
    const ich = this._ich;
    const leute = [...(a.fuer || []), ...(a.macher || [])];
    const pf = ui.person || "alle";
    if (pf === "meine" && !leute.includes(ich)) return false;
    if (pf === "von_mir" && a.erstellt_von !== ich) return false;
    if (pf === "niemand" && leute.length) return false;
    if (!["alle", "meine", "von_mir", "niemand"].includes(pf) && !leute.includes(pf)) return false;
    if (ui.kategorie === "_ohne" && a.kategorie) return false;
    if (ui.kategorie && ui.kategorie !== "_ohne" && a.kategorie !== ui.kategorie) return false;
    if (ui.tag && !(a.tags || []).some((t) => t.toLowerCase() === ui.tag.toLowerCase())) return false;
    if (!ui.erledigte && a.status === "erledigt") return false;
    if (suche) {
      const kat = this._kat(a.kategorie);
      const heu = [a.titel, a.notiz, ...(a.tags || []), kat ? kat.name : "", ...leute.map((p) => this._pname(p))]
        .join(" ")
        .toLowerCase();
      if (!suche.split(/\s+/).filter(Boolean).every((w) => heu.includes(w))) return false;
    }
    return true;
  }

  _gruppen(liste) {
    const art = this._ui.gruppe;
    const sortiert = sortiere(liste, this._ui.sort);
    if (art === "keine") return [{ key: "alle", name: "", farbe: "", aufgaben: sortiert }];
    if (art === "kategorie") {
      const g = [];
      for (const k of this._einst().kategorien || []) {
        const a = sortiert.filter((x) => x.kategorie === k.id);
        if (a.length) g.push({ key: `kat:${k.id}`, name: k.name, farbe: k.farbe, icon: k.icon, aufgaben: a });
      }
      const ohne = sortiert.filter((x) => !this._kat(x.kategorie));
      if (ohne.length) g.push({ key: "kat:_ohne", name: "Ohne Kategorie", farbe: "#9e9e9e", aufgaben: ohne });
      return g;
    }
    if (art === "person") {
      const g = new Map();
      const niemand = [];
      for (const a of sortiert) {
        const zust = a.macher && a.macher.length ? a.macher : a.fuer || [];
        if (!zust.length) niemand.push(a);
        for (const p of zust) {
          if (!g.has(p)) g.set(p, []);
          g.get(p).push(a);
        }
      }
      const reihenfolge = [...this._personen(), ...[...g.keys()].filter((p) => p.startsWith("extern:")).sort()];
      const aus = [];
      for (const p of reihenfolge) if (g.has(p)) aus.push({ key: `p:${p}`, name: this._pname(p), person: p, aufgaben: g.get(p) });
      if (niemand.length) aus.push({ key: "p:_niemand", name: "Noch niemand", farbe: "#9e9e9e", aufgaben: niemand });
      return aus;
    }
    const aus = [];
    const ans = this._ansicht();
    const heute = heuteStr();
    for (const s of ans.reihenfolge.map((id) => STATUS_MAP[id])) {
      let a = sortiert.filter((x) => x.status === s.id);
      if (s.id === "erledigt") a = [...a].sort((x, y) => cmpStr(y.erledigt_am || "", x.erledigt_am || ""));
      if (!a.length) continue;
      const g = { key: `status:${s.id}`, name: s.name, farbe: s.farbe, icon: s.icon, aufgaben: a };
      if (ans.termin.includes(s.id)) g.unter = terminGruppen(a, heute, g.key);
      aus.push(g);
    }
    return aus;
  }

  _sichtbar() {
    const suche = this._suche.trim().toLowerCase();
    return this._aufgaben().filter((a) => this._passt(a, suche) || a.id === this._fokusId);
  }

  _zeichneAnsicht() {
    const el = this.shadowRoot.querySelector(".ansicht");
    if (!el) return;
    const k = this._kompakt;
    el.innerHTML = `
      <div class="umschalter" role="group" aria-label="Darstellung">
        <button class="ums ${k ? "" : "an"}" data-a="darstellung" data-w="detail" title="Detailliert" aria-pressed="${!k}"><ha-icon icon="mdi:view-agenda-outline"></ha-icon><span>Detailliert</span></button>
        <button class="ums ${k ? "an" : ""}" data-a="darstellung" data-w="kompakt" title="Kompakt – eine Zeile pro Aufgabe" aria-pressed="${k}"><ha-icon icon="mdi:view-headline"></ha-icon><span>Kompakt</span></button>
      </div>
      ${this._ui.gruppe !== "keine" ? `<span class="paar" role="group" aria-label="Gruppen">
        <span class="p-lab">Gruppen</span><span class="seg2">
          <button data-a="gruppen-auf" title="Alle Gruppen aufklappen"><span class="si"><ha-icon icon="mdi:unfold-more-horizontal"></ha-icon></span>auf</button><button data-a="gruppen-zu" title="Alle Gruppen zuklappen"><span class="si"><ha-icon icon="mdi:unfold-less-horizontal"></ha-icon></span>zu</button>
        </span></span>` : ""}
      <span class="paar" role="group" aria-label="Details">
        <span class="p-lab">Details</span><span class="seg2">
          <button data-a="details-auf" title="Details aller Aufgaben aufklappen"><span class="si"><ha-icon icon="mdi:arrow-expand-vertical"></ha-icon></span>auf</button><button data-a="details-zu" title="Details aller Aufgaben zuklappen"><span class="si"><ha-icon icon="mdi:arrow-collapse-vertical"></ha-icon></span>zu</button>
        </span></span>
      ${this._weichtAb() ? `<button class="mini" data-a="ansicht-standard" title="Zurück zur Standardansicht"><ha-icon icon="mdi:restore"></ha-icon><span>Standard</span></button>` : ""}`;
  }

  _zeichneListe() {
    if (!this._gebaut) return;
    this._zeichneAnsicht();
    const el = this.shadowRoot.querySelector(".liste");
    if (!this._daten) {
      el.innerHTML = this._fehler ? "" : `<div class="leer"><ha-icon icon="mdi:timer-sand"></ha-icon>Lade Aufgaben …</div>`;
      return;
    }
    const sichtbar = this._sichtbar();
    if (!sichtbar.length) {
      const gefiltert = this._aufgaben().length > 0;
      el.innerHTML = `<div class="leer"><ha-icon icon="${gefiltert ? "mdi:filter-off-outline" : "mdi:clipboard-text-outline"}"></ha-icon>${
        gefiltert ? "Keine Aufgaben für diese Auswahl." : "Noch keine Aufgaben – tippe auf „Neu“."
      }${gefiltert ? `<div style="margin-top:10px"><button class="sekundaer" data-a="filter-weg">Filter zurücksetzen</button></div>` : ""}</div>`;
      return;
    }
    const heute = heuteStr();
    const eintrag = this._kompakt ? (a) => this._zeileHtml(a, heute) : (a) => this._aufgabeHtml(a, heute);
    const html = this._gruppen(sichtbar)
      .map((g) => {
        const zu = this._zu.has(g.key) && !(this._fokusId && g.aufgaben.some((a) => a.id === this._fokusId));
        const kopf = g.name
          ? `<div class="g-kopf" data-a="gruppe" data-w="${esc(g.key)}">
              ${g.person ? this._avatar(g.person, 20) : g.icon ? `<ha-icon class="g-icon" icon="${esc(g.icon)}"></ha-icon>` : `<span class="punkt"></span>`}
              <span>${esc(g.name)}</span><span class="anz">${g.aufgaben.length}</span>
              <ha-icon class="pfeil" icon="mdi:chevron-down"></ha-icon></div>`
          : "";
        const inhalt = g.unter
          ? `<div class="unterliste">${g.unter
              .map((u) => {
                const uzu = this._zu.has(u.key) && !(this._fokusId && u.aufgaben.some((a) => a.id === this._fokusId));
                return `<div class="gruppe unter ${uzu ? "zu" : ""}">
                  <div class="u-kopf ${u.kl}" data-a="gruppe" data-w="${esc(u.key)}"><ha-icon class="u-icon" icon="${u.icon}"></ha-icon><span class="u-name">${esc(u.name)}</span>${u.zusatz ? `<span class="u-zusatz">${esc(u.zusatz)}</span>` : ""}<span class="anz">${u.aufgaben.length}</span><ha-icon class="pfeil" icon="mdi:chevron-down"></ha-icon></div>
                  <div class="g-inhalt">${u.aufgaben.map(eintrag).join("")}</div></div>`;
              })
              .join("")}</div>`
          : g.aufgaben.map(eintrag).join("");
        return `<div class="gruppe ${zu ? "zu" : ""}" style="--g:${g.farbe || "var(--primary-color)"}">${kopf}<div class="g-inhalt">${inhalt}</div></div>`;
      })
      .join("");
    el.innerHTML = html;
  }

  _terminChips(a, heute) {
    const c = [];
    const offen = a.status !== "erledigt";
    if (a.geplant) {
      const d = tageBis(a.geplant, heute);
      const kl = offen && d < 0 ? "verpasst" : "";
      c.push(`<span class="chip ${kl}" title="Geplanter Termin"><ha-icon icon="mdi:calendar"></ha-icon>${esc(fmtTag(a.geplant, heute))}${a.zeit ? ` ${esc(a.zeit)}` : ""}</span>`);
    }
    if (a.frist) {
      const d = tageBis(a.frist, heute);
      let kl = "";
      let txt = `bis ${fmtTag(a.frist, heute)}`;
      if (offen && d < 0) {
        kl = "ueber";
        txt = `überfällig seit ${-d} ${-d === 1 ? "Tag" : "Tagen"}`;
      } else if (offen && d <= 2) kl = "bald";
      c.push(`<span class="chip ${kl}" title="Spätestens bis ${esc(fmtTag(a.frist, heute, true))}"><ha-icon icon="mdi:flag-outline"></ha-icon>${esc(txt)}</span>`);
    }
    return c.join("");
  }

  _aufgabeHtml(a, heute) {
    const s = STATUS_MAP[a.status] || STATUS[0];
    const kat = this._kat(a.kategorie);
    const farbe = kat ? kat.farbe : "#8a8a8a";
    const icon = kat ? kat.icon : "mdi:checkbox-blank-circle-outline";
    const auf = this._auf.has(a.id) || a.id === this._fokusId;
    const meta = [];
    const ers = a.status !== "erledigt" ? a.erinnerungen || [] : [];
    if (this._ui.gruppe !== "status") meta.push(`<span class="spill"><ha-icon icon="${s.icon}"></ha-icon>${s.name}</span>`);
    meta.push(this._terminChips(a, heute));
    const fuer = a.fuer || [];
    const mach = a.macher || [];
    const gleich = fuer.length > 0 && fuer.length === mach.length && fuer.every((x) => mach.includes(x));
    if (fuer.length && !gleich) meta.push(`<span class="chip" title="Vorgesehen für">${this._avatare(fuer, 16)}${esc(this._pnamen(fuer))}</span>`);
    if (mach.length) meta.push(`<span class="chip macher" title="Wird erledigt von"><ha-icon icon="mdi:hand-back-right-outline"></ha-icon>${this._avatare(mach, 16)}${esc(this._pnamen(mach))}</span>`);
    else if (a.status !== "erledigt" && a.status !== "neu") meta.push(`<span class="chip" title="Noch niemand hat übernommen"><ha-icon icon="mdi:account-question-outline"></ha-icon>noch niemand</span>`);
    for (const t of a.tags || []) meta.push(`<span class="chip tag">#${esc(t)}</span>`);
    const fuss = a.status === "erledigt" && a.erledigt_am
      ? `Erledigt ${esc(fmtZeitpunkt(a.erledigt_am, heute))}${a.erledigt_von ? ` von ${esc(this._pname(a.erledigt_von))}` : ""}`
      : `Erstellt ${esc(fmtZeitpunkt(a.erstellt, heute))}${a.erstellt_von ? ` von ${esc(this._pname(a.erstellt_von))}` : ""}`;
    return `
      <div class="aufgabe s-${a.status} ${a.id === this._blinkId ? "blink" : ""}" data-id="${esc(a.id)}" style="--s:${s.farbe}">
        <div class="a-kopf" data-a="auf" data-id="${esc(a.id)}">
          <div class="a-icon" style="background:${mitAlpha(farbe, 0.15)};color:${esc(farbe)}"><ha-icon icon="${esc(icon)}"></ha-icon></div>
          <div class="a-haupt">
            <div class="a-titel">${esc(a.titel)}${a.serie ? `<ha-icon icon="mdi:repeat" title="${esc(serieText(a.serie))}"></ha-icon>` : ""}${a.notiz ? `<ha-icon icon="mdi:note-text-outline" title="Notiz"></ha-icon>` : ""}${ers.length ? `<ha-icon icon="mdi:bell-outline" title="${esc(`Erinnerung: ${ers.map(erText).join(", ")}`)}"></ha-icon>` : ""}</div>
            <div class="a-meta">${meta.join("")}</div>
            <div class="a-fuss">${fuss}</div>
          </div>
        </div>
        ${auf ? this._detailsHtml(a, heute) : ""}
      </div>`;
  }

  // Eine Zeile pro Aufgabe: Symbol, Bezeichnung, wichtigstes Datum, Personen
  _zeileDatum(a, heute) {
    if (a.status === "erledigt") {
      const t = a.erledigt_am ? new Date(a.erledigt_am) : null;
      if (!t || isNaN(t)) return null;
      return { text: `✓ ${fmtTag(datStr(t), heute)}`, kl: "", titel: `Erledigt ${fmtZeitpunkt(a.erledigt_am, heute)}${a.erledigt_von ? ` von ${this._pname(a.erledigt_von)}` : ""}` };
    }
    const fd = a.frist ? tageBis(a.frist, heute) : null;
    if (fd !== null && fd < 0)
      return { text: `${-fd} ${fd === -1 ? "Tag" : "Tage"} überfällig`, kl: "ueber", titel: `Spätestens bis ${fmtTag(a.frist, heute, true)}` };
    if (a.geplant) {
      const gd = tageBis(a.geplant, heute);
      return {
        text: `${fmtTag(a.geplant, heute)}${a.zeit ? ` ${a.zeit}` : ""}`,
        kl: gd < 0 ? "verpasst" : gd === 0 ? "heute" : "",
        titel: `Termin ${fmtTag(a.geplant, heute, true)}${a.zeit ? `, ${a.zeit} Uhr` : ""}${a.frist ? ` · spätestens ${fmtTag(a.frist, heute, true)}` : ""}`,
      };
    }
    if (a.frist) return { text: `bis ${fmtTag(a.frist, heute)}`, kl: fd <= 2 ? "bald" : "", titel: `Spätestens bis ${fmtTag(a.frist, heute, true)}` };
    return null;
  }

  _zeileHtml(a, heute) {
    const s = STATUS_MAP[a.status] || STATUS[0];
    const kat = this._kat(a.kategorie);
    const farbe = kat ? kat.farbe : "#8a8a8a";
    const icon = kat ? kat.icon : "mdi:checkbox-blank-circle-outline";
    const auf = this._auf.has(a.id) || a.id === this._fokusId;
    const ers = a.status !== "erledigt" ? a.erinnerungen || [] : [];
    const zeichen = [];
    if (a.serie) zeichen.push(`<ha-icon icon="mdi:repeat" title="${esc(serieText(a.serie))}"></ha-icon>`);
    if (a.notiz) zeichen.push(`<ha-icon icon="mdi:note-text-outline" title="Notiz"></ha-icon>`);
    if (ers.length) zeichen.push(`<ha-icon icon="mdi:bell-outline" title="${esc(`Erinnerung: ${ers.map(erText).join(", ")}`)}"></ha-icon>`);
    const d = this._zeileDatum(a, heute);
    const mach = a.macher || [];
    const leute = mach.length ? mach : a.fuer || [];
    const leuteTitel = `${mach.length ? "Erledigt von" : "Vorgesehen für"}: ${this._pnamen(leute)}`;
    return `
      <div class="aufgabe kompakt s-${a.status} ${a.id === this._blinkId ? "blink" : ""}" data-id="${esc(a.id)}" style="--s:${s.farbe}">
        <div class="a-zeile" data-a="auf" data-id="${esc(a.id)}">
          <span class="z-icon" style="color:${esc(farbe)}" title="${esc(kat ? kat.name : "Ohne Kategorie")}"><ha-icon icon="${esc(icon)}"></ha-icon></span>
          <span class="z-titel" title="${esc(a.titel)}">${esc(a.titel)}</span>
          ${zeichen.length ? `<span class="z-zeichen">${zeichen.join("")}</span>` : ""}
          ${this._ui.gruppe !== "status" ? `<span class="z-status" title="${esc(s.name)}"><ha-icon icon="${s.icon}"></ha-icon></span>` : ""}
          ${d ? `<span class="z-datum ${d.kl}" title="${esc(d.titel)}">${esc(d.text)}</span>` : ""}
          ${leute.length ? `<span class="z-avs ${mach.length ? "" : "vorgesehen"}" title="${esc(leuteTitel)}">${this._avatare(leute.slice(0, 3), 22)}</span>` : ""}
        </div>
        ${auf ? this._detailsHtml(a, heute) : ""}
      </div>`;
  }

  _personenHtml(liste, leer) {
    if (!liste || !liste.length) return `<span style="color:var(--secondary-text-color)">${leer}</span>`;
    return liste.map((p) => `<span class="pers">${this._avatar(p, 20)}${esc(this._pname(p))}</span>`).join("");
  }

  _detailsHtml(a, heute) {
    const ich = this._ich;
    const kat = this._kat(a.kategorie);
    const zeilen = [];
    const z = (l, w) => zeilen.push(`<div class="l">${l}</div><div class="w">${w}</div>`);
    z("Vorgesehen für", this._personenHtml(a.fuer, "alle / niemand bestimmtes"));
    z("Ausführende", this._personenHtml(a.macher, "noch niemand"));
    if (a.status === "erledigt" && a.erledigt_am) z("Erledigt", esc(`${fmtZeitpunkt(a.erledigt_am, heute)}${a.erledigt_von ? ` von ${this._pname(a.erledigt_von)}` : ""}`));
    z("Termin", a.geplant ? esc(`${fmtTag(a.geplant, heute, true)}${a.zeit ? `, ${a.zeit} Uhr` : ""}`) : "–");
    z("Spätestens", a.frist ? esc(`${fmtTag(a.frist, heute, true)}${a.frist_rel ? ` (${fristRelText(a.frist_rel)})` : ""}`) : "–");
    if (a.serie) z("Wiederholung", esc(serieText(a.serie) + (a.serie.ende ? `, bis ${fmtTag(a.serie.ende, heute, true)}` : "")));
    if ((a.erinnerungen || []).length) z("Erinnerungen", this._erDetailsHtml(a, heute));
    if ((a.melden_an || []).length) {
      const bei = a.melden_bei && a.melden_bei.length ? a.melden_bei : ["erledigt"];
      const wann = bei.includes("arbeit") && bei.includes("erledigt") ? "wenn begonnen und wenn erledigt" : bei.includes("arbeit") ? "wenn begonnen" : "wenn erledigt";
      z("Benachrichtigen", `${this._personenHtml(a.melden_an, "")}<span class="mb-wann">${wann}</span>`);
    }
    z("Kategorie", kat ? `<span class="chip"><ha-icon icon="${esc(kat.icon)}" style="color:${esc(kat.farbe)}"></ha-icon>${esc(kat.name)}</span>` : "–");
    z("Status", `<span class="spill" style="--s:${STATUS_MAP[a.status].farbe}">${STATUS_MAP[a.status].name}</span>`);
    z("Erstellt", esc(`${fmtZeitpunkt(a.erstellt, heute)}${a.erstellt_von ? ` von ${this._pname(a.erstellt_von)}` : ""}`));
    if (a.geaendert && a.geaendert !== a.erstellt) z("Geändert", esc(`${fmtZeitpunkt(a.geaendert, heute)}${a.geaendert_von ? ` von ${this._pname(a.geaendert_von)}` : ""}`));
    const k = [];
    const btn = (aktion, icon, text, klasse = "") =>
      k.push(`<button class="sekundaer ${klasse}" data-a="${aktion}" data-id="${esc(a.id)}"><ha-icon icon="${icon}"></ha-icon>${text}</button>`);
    const offen = a.status !== "erledigt";
    if (offen && ich && !(a.macher || []).includes(ich)) btn("uebernehmen", "mdi:hand-back-right-outline", "Übernehmen");
    if (offen && ich && (a.macher || []).includes(ich)) btn("abgeben", "mdi:account-remove-outline", "Abgeben");
    if (offen) btn("planen", "mdi:calendar-edit", a.geplant ? "Termin ändern" : "Termin planen");
    if (offen && a.status !== "arbeit") btn("starten", "mdi:play-circle-outline", "Starten");
    if (offen) btn("erledigen", "mdi:check-bold", "Erledigt");
    if (offen && a.serie) btn("ueberspringen", "mdi:skip-next-outline", "Termin überspringen");
    if (!offen) btn("wieder_oeffnen", "mdi:undo-variant", "Wieder öffnen");
    btn("bearbeiten", "mdi:pencil-outline", "Bearbeiten");
    btn("loeschen", "mdi:delete-outline", "Löschen", "gefahr");
    const verlauf = [...(a.verlauf || [])].reverse();
    const v = verlauf.length
      ? `<details class="verlauf"><summary>Verlauf (${verlauf.length})</summary><ul>${verlauf
          .slice(0, 25)
          .map((e) => `<li>${esc(fmtZeitpunkt(e.z, heute))} · ${e.wer ? `${esc(this._pname(e.wer))}: ` : ""}${esc(e.was)}</li>`)
          .join("")}</ul></details>`
      : "";
    return `<div class="a-details">
      ${a.notiz ? `<div class="notiz">${esc(a.notiz)}</div>` : ""}
      <div class="zeilen">${zeilen.join("")}</div>
      <div class="a-knoepfe">${k.join("")}</div>
      ${v}
    </div>`;
  }

  _erDetailsHtml(a, heute) {
    const std = this._einst().uhrzeit_ohne_termin || "08:00";
    const jetzt = Date.now();
    return a.erinnerungen
      .map((r) => {
        const t = erZeit(a, r, std);
        const g = (a.gesendet || {})[r.id];
        let zust = "";
        let ok = false;
        if (!t) zust = "braucht Termin oder Frist";
        else if (g && g.fuer === erSchluessel(t)) {
          zust = `gesendet ${fmtZeitpunkt(g.am, heute)}`;
          ok = true;
        } else if (a.status === "erledigt") zust = "";
        else if (t.getTime() < jetzt - 60000) zust = `${fmtDatumZeit(t, heute)} – vorbei`;
        else zust = fmtDatumZeit(t, heute);
        const wege = (r.kanaele || []).map((k) => `<ha-icon icon="${(ER_KANAL_MAP[k] || {}).icon || "mdi:bell-outline"}"></ha-icon>`).join("");
        return `<span class="chip er ${ok ? "ok" : ""}" title="${esc(`${erText(r)} · ${erKanaeleText(r)}`)}"><ha-icon icon="${ok ? "mdi:bell-check-outline" : "mdi:bell-outline"}"></ha-icon>${esc(erText(r))}${zust ? ` · ${esc(zust)}` : ""}<span class="er-wege">${wege}</span></span>`;
      })
      .join("");
  }

  // ---------------------------------------------------------------- Bedienung
  async _klick(e) {
    const el = e.target.closest("[data-a]");
    if (!el || !this.shadowRoot.contains(el)) return;
    const a = el.dataset.a;
    const id = el.dataset.id;
    const w = el.dataset.w;
    if (el.tagName === "BUTTON" || a !== "auf") e.stopPropagation();
    switch (a) {
      case "auf": {
        if (e.target.closest("button, a, summary, details")) return;
        const offen = this._auf.has(id) || this._fokusId === id;
        if (this._fokusId === id) this._fokusId = null;
        if (offen) this._auf.delete(id);
        else this._auf.add(id);
        this._zeichneListe();
        break;
      }
      case "gruppe": {
        const g = el.closest(".gruppe");
        const offen = g ? !g.classList.contains("zu") : !this._zu.has(w);
        if (offen) {
          this._zu.add(w);
          // eine per Link geöffnete Aufgabe hält ihre Gruppe sonst offen
          if (this._fokusId && g && g.querySelector(`.aufgabe[data-id="${CSS.escape(this._fokusId)}"]`)) this._fokusId = null;
        } else this._zu.delete(w);
        this._zeichneListe();
        break;
      }
      case "darstellung":
        this._kompakt = w === "kompakt";
        this._zeichneListe();
        break;
      case "filter-auf":
        this._filterOffen = !this._filterOffen;
        this._zeichneFilterInfo();
        break;
      case "gruppen-auf":
        this._zu.clear();
        this._zeichneListe();
        break;
      case "gruppen-zu":
        for (const g of this._gruppen(this._sichtbar())) if (g.name) this._zu.add(g.key);
        this._fokusId = null;
        this._zeichneListe();
        break;
      case "details-auf":
        this._auf = new Set(this._sichtbar().map((x) => x.id));
        this._zeichneListe();
        break;
      case "details-zu":
        this._auf.clear();
        this._fokusId = null;
        this._zeichneListe();
        break;
      case "ansicht-standard":
        this._ansichtAnwenden();
        this._zeichneListe();
        break;
      case "fperson":
        this._ui.person = w;
        this._uiSpeichern();
        this._zeichneChips();
        this._zeichneListe();
        break;
      case "fkat":
        this._ui.kategorie = w;
        this._uiSpeichern();
        this._zeichneChips();
        this._zeichneListe();
        break;
      case "ftag":
        this._ui.tag = this._ui.tag && this._ui.tag.toLowerCase() === w.toLowerCase() ? "" : w;
        this._uiSpeichern();
        this._zeichneChips();
        this._zeichneListe();
        break;
      case "filter-weg":
        Object.assign(this._ui, { person: "alle", kategorie: "", tag: "", erledigte: true });
        this._suche = "";
        this._uiSpeichern();
        this._zeichnen();
        break;
      case "neuladen":
        this._laden();
        break;
      case "neu":
        this._formOeffnen(null);
        break;
      case "bearbeiten":
        this._formOeffnen(this._finde(id));
        break;
      case "planen":
        this._planOeffnen(this._finde(id));
        break;
      case "einstellungen":
        this._einstOeffnen();
        break;
      case "ich":
        this._ichOeffnen();
        break;
      case "ich-setzen":
        await this._ichSetzen(w);
        break;
      case "loeschen":
        this._loeschenFragen(this._finde(id));
        break;
      case "uebernehmen":
      case "abgeben":
      case "starten":
      case "erledigen":
      case "wieder_oeffnen":
      case "ueberspringen":
        await this._aktion(id, a);
        break;
      default:
        break;
    }
  }

  async _aktion(id, aktion, extra = {}) {
    const vorher = this._finde(id);
    if (!vorher) return null;
    if ((aktion === "uebernehmen" || aktion === "abgeben") && !this._ich) {
      this._ichOeffnen();
      return null;
    }
    try {
      const r = await this._dienst("aktion", Object.assign({ aufgabe_id: id, aktion, akteur: this._ich || undefined }, extra));
      if (!r.ok) {
        this._toast(r.fehler || "Das ging leider nicht.");
        return null;
      }
      this._lokalErsetzen(r.aufgabe);
      if (r.folge) this._lokalErsetzen(r.folge);
      if (aktion === "wieder_oeffnen" && vorher.folge_id && !r.aufgabe.folge_id && this._daten) {
        this._daten.aufgaben = this._daten.aufgaben.filter((x) => x.id !== vorher.folge_id || (x.verlauf || []).length > 1);
      }
      this._zeichnen();
      const heute = heuteStr();
      if (aktion === "uebernehmen") {
        if (!r.aufgabe.geplant) this._toast("Übernommen.", "Termin planen", () => this._planOeffnen(this._finde(id)));
        else this._toast("Übernommen.");
      } else if (aktion === "erledigen") {
        const t = r.folge ? `Erledigt ✓ – nächster Termin ${fmtTag(r.folge.geplant || r.folge.frist, heute)}` : "Erledigt ✓";
        this._toast(t, "Rückgängig", () => this._aktion(id, "wieder_oeffnen"));
      } else if (aktion === "ueberspringen") {
        this._toast(`Übersprungen – nächster Termin ${fmtTag(r.aufgabe.geplant || r.aufgabe.frist, heute)}`);
      } else if (aktion === "abgeben") {
        this._toast("Abgegeben.");
      } else if (aktion === "starten") {
        this._toast("Los geht's – Status „In Bearbeitung“.");
      }
      if (r.warnung) this._toast(r.warnung);
      return r;
    } catch (err) {
      this._toast(`Fehler: ${(err && (err.message || err.code)) || err}`);
      return null;
    }
  }

  _linkPruefen() {
    let id = null;
    try {
      id = new URLSearchParams(window.location.search).get("aufgabe");
    } catch (e) {
      id = null;
    }
    if (!id) this._linkZuletzt = null;
    if (!id || !this._daten || id === this._linkZuletzt) return;
    const a = this._finde(id);
    if (!a) return;
    this._linkZuletzt = id;
    this._fokusId = id;
    this._blinkId = id;
    if (a.status === "erledigt" && !this._ui.erledigte) this._ui.erledigte = true;
    // aufklappen und die Gruppe(n) öffnen – bleibt so, wenn man die Aufgabe danach wieder zuklappt
    this._auf.add(id);
    for (const g of this._gruppen(this._sichtbar())) {
      for (const x of [g, ...(g.unter || [])]) if (x.aufgaben.some((y) => y.id === id)) this._zu.delete(x.key);
    }
    this._zeichnen();
    requestAnimationFrame(() => {
      const el = this.shadowRoot.querySelector(`.aufgabe[data-id="${CSS.escape(id)}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    setTimeout(() => {
      this._blinkId = null;
      const el = this.shadowRoot.querySelector(".aufgabe.blink");
      if (el) el.classList.remove("blink");
    }, 2500);
  }

  // ---------------------------------------------------------------- Ebene (Dialoge, Hinweise)
  _ebene() {
    if (!this._host) {
      this._host = document.createElement("div");
      this._host.className = "familienaufgaben-ebene";
      const root = this._host.attachShadow({ mode: "open" });
      root.innerHTML = `<style>${CSS_BASIS}${CSS_EBENE}</style>
        <div class="hinter" hidden></div>
        <div class="dlg" hidden role="dialog" aria-modal="true"></div>
        <div class="toast" hidden></div>`;
      root.addEventListener("click", (e) => this._dKlick(e));
      root.addEventListener("input", (e) => this._dEingabe(e));
      root.addEventListener("change", (e) => this._dAenderung(e));
      root.addEventListener("keydown", (e) => this._dTaste(e));
      document.body.appendChild(this._host);
    }
    return this._host.shadowRoot;
  }

  _toast(text, knopf, fn) {
    const r = this._ebene();
    const t = r.querySelector(".toast");
    t.innerHTML = `<span>${esc(text)}</span>${knopf ? `<button data-d="toast">${esc(knopf)}</button>` : ""}`;
    t.classList.toggle("oben", !!this._dlg);
    t.hidden = false;
    this._toastFn = fn || null;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      t.hidden = true;
      this._toastFn = null;
    }, knopf ? 6500 : 3500);
  }

  _dlgOeffnen(art) {
    const r = this._ebene();
    this._dlg = art;
    this._dlgFehler = "";
    r.querySelector(".toast").hidden = true;
    this._dlgZeichnen(true);
    r.querySelector(".hinter").hidden = false;
    r.querySelector(".dlg").hidden = false;
    this._overflowVorher = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setTimeout(() => {
      const f = r.querySelector(".dlg [autofocus]");
      if (f && window.matchMedia("(min-width: 601px)").matches) f.focus();
    }, 50);
  }

  _dlgSchliessen() {
    if (!this._host || !this._dlg) return;
    const r = this._host.shadowRoot;
    this._dlg = null;
    r.querySelector(".hinter").hidden = true;
    const d = r.querySelector(".dlg");
    d.hidden = true;
    d.innerHTML = "";
    document.body.style.overflow = this._overflowVorher || "";
  }

  _dlgZeichnen(neu = false) {
    const r = this._ebene();
    const d = r.querySelector(".dlg");
    const alt = d.querySelector(".d-inhalt");
    const scroll = alt && !neu ? alt.scrollTop : 0;
    let html = "";
    if (this._dlg === "aufgabe") html = this._formHtml();
    else if (this._dlg === "plan") html = this._planHtml();
    else if (this._dlg === "einst") html = this._einstHtml();
    else if (this._dlg === "ich") html = this._ichHtml();
    else if (this._dlg === "loeschen") html = this._loeschenHtml();
    d.innerHTML = html;
    const inhalt = d.querySelector(".d-inhalt");
    if (inhalt) inhalt.scrollTop = scroll;
  }

  _dlgRahmen(titel, inhalt, fuss) {
    return `<div class="d-kopf"><div class="d-titel">${esc(titel)}</div><button class="icon-btn" data-d="zu" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="d-inhalt">${inhalt}<div class="d-fehler">${esc(this._dlgFehler || "")}</div></div>
      <div class="d-fuss">${fuss}</div>`;
  }

  _fehlerZeigen(text) {
    this._dlgFehler = text;
    const el = this._ebene().querySelector(".d-fehler");
    if (el) {
      el.textContent = text;
      el.scrollIntoView({ block: "nearest" });
    }
  }

  _dKlick(e) {
    const r = this._ebene();
    if (e.target === r.querySelector(".hinter")) {
      this._dlgSchliessen();
      return;
    }
    const el = e.target.closest("[data-d]");
    if (!el) return;
    const d = el.dataset.d;
    if (d === "toast") {
      const fn = this._toastFn;
      r.querySelector(".toast").hidden = true;
      this._toastFn = null;
      if (fn) fn();
      return;
    }
    if (d === "zu") {
      this._dlgSchliessen();
      return;
    }
    if (d.startsWith("er-")) {
      this._erKlick(el, d);
      return;
    }
    if (this._dlg === "aufgabe") this._formKlick(el, d);
    else if (this._dlg === "plan") this._planKlick(el, d);
    else if (this._dlg === "einst") this._einstKlick(el, d);
    else if (this._dlg === "ich") this._ichKlick(el, d);
    else if (this._dlg === "loeschen") this._loeschenKlick(el, d);
  }

  _dEingabe(e) {
    const f = e.target.dataset.f;
    if (!f) return;
    const ziel = this._dlg === "aufgabe" ? this._form : this._dlg === "plan" ? this._plan : this._dlg === "einst" ? this._ef : null;
    if (!ziel) return;
    if (e.target.type === "checkbox") return;
    if (f.startsWith("kat:")) {
      const [, i, feld] = f.split(":");
      ziel.kategorien[+i][feld] = e.target.value;
      if (feld === "icon") {
        const btn = this._ebene().querySelector(`[data-d="kat-icon"][data-i="${i}"] ha-icon`);
        if (btn) btn.setAttribute("icon", e.target.value);
      }
      return;
    }
    if (this._feldSetzen(f, e.target.value)) {
      if (f.startsWith("er:")) this._erVorschauAktualisieren();
      return;
    }
    ziel[f] = e.target.value;
    if (this._dlg === "aufgabe" && ["frist_n", "frist_einheit", "serie_n", "geplant", "zeit", "frist"].includes(f)) this._formVorschau();
  }

  _dAenderung(e) {
    const f = e.target.dataset.f;
    if (!f) return;
    const ziel = this._dlg === "aufgabe" ? this._form : this._dlg === "plan" ? this._plan : this._dlg === "einst" ? this._ef : null;
    if (!ziel) return;
    if (e.target.type === "checkbox") {
      if (f.startsWith("melden:")) {
        const [, person, dienst] = f.split(":");
        const l = new Set(ziel.benachrichtigung[person] || []);
        if (e.target.checked) l.add(dienst);
        else l.delete(dienst);
        ziel.benachrichtigung[person] = [...l];
      } else if (f.startsWith("ansicht_zu:") || f.startsWith("ansicht_termin:")) {
        const av = this._efAnsicht();
        const [feld, id] = f.replace("ansicht_", "").split(":");
        const l = new Set(av[feld]);
        if (e.target.checked) l.add(id);
        else l.delete(id);
        av[feld] = STATUS.map((s) => s.id).filter((s) => l.has(s));
      } else ziel[f] = e.target.checked;
      if (this._dlg === "einst") this._dlgZeichnen();
      return;
    }
    if (f.startsWith("kat:")) return;
    if (this._feldSetzen(f, e.target.value)) {
      if (/^ers?:\d+:einheit$/.test(f)) this._dlgZeichnen();
      else if (f.startsWith("er:")) this._erVorschauAktualisieren();
      return;
    }
    ziel[f] = e.target.value;
    if (e.target.dataset.neu === "1") this._dlgZeichnen();
    else if (this._dlg === "aufgabe") this._formVorschau();
  }

  _dTaste(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      this._dlgSchliessen();
      return;
    }
    if (e.key !== "Enter" || e.target.tagName === "TEXTAREA" || e.target.tagName === "BUTTON") return;
    const f = e.target.dataset.f;
    if (f === "tagEingabe") {
      e.preventDefault();
      this._tagDazu();
      return;
    }
    if (f === "externName") {
      e.preventDefault();
      this._externDazu();
      return;
    }
    if (f === "neuExtern") {
      e.preventDefault();
      this._einstKlick(null, "ext-dazu");
      return;
    }
    if (this._dlg === "aufgabe" && f === "titel") {
      e.preventDefault();
      this._formSpeichern();
    }
  }

  // ---------------------------------------------------------------- Aufgabe anlegen / bearbeiten
  _formOeffnen(a) {
    const ui = this._ui;
    const heute = heuteStr();
    if (a) {
      this._form = {
        id: a.id,
        titel: a.titel || "",
        notiz: a.notiz || "",
        kategorie: a.kategorie || "",
        tags: [...(a.tags || [])],
        fuer: [...(a.fuer || [])],
        macher: [...(a.macher || [])],
        melden_an: [...(a.melden_an || [])],
        melden_bei: a.melden_bei && a.melden_bei.length ? [...a.melden_bei] : ["erledigt"],
        status: a.status,
        geplant: a.geplant || "",
        zeit: a.zeit || "",
        frist_modus: a.frist_rel ? "relativ" : a.frist ? "datum" : "keine",
        frist: a.frist || "",
        frist_n: a.frist_rel ? a.frist_rel.n : 1,
        frist_einheit: a.frist_rel ? a.frist_rel.einheit : "wochen",
        serie_an: !!a.serie,
        serie_einheit: a.serie ? a.serie.einheit : "wochen",
        serie_n: a.serie ? a.serie.n : 1,
        serie_wt: a.serie ? [...(a.serie.wochentage || [])] : [],
        serie_basis: a.serie ? a.serie.basis : "plan",
        serie_ende: (a.serie && a.serie.ende) || "",
        frist_alt: a.frist || "",
        frist_rel_alt: a.frist_rel ? `${a.frist_rel.n}:${a.frist_rel.einheit}` : "",
        erinnerungen: erKopie(a.erinnerungen),
      };
    } else {
      const fuer = ui.person && (ui.person.startsWith("person.") || ui.person.startsWith("extern:")) ? [ui.person] : [];
      this._form = {
        id: null, titel: "", notiz: "",
        kategorie: ui.kategorie && ui.kategorie !== "_ohne" ? ui.kategorie : "",
        tags: ui.tag ? [ui.tag] : [], fuer, macher: [], melden_an: [], melden_bei: ["erledigt"], status: "neu",
        geplant: "", zeit: "", frist_modus: "keine", frist: plusTage(heute, 7), frist_n: 1, frist_einheit: "wochen",
        serie_an: false, serie_einheit: "wochen", serie_n: 1, serie_wt: [], serie_basis: "plan", serie_ende: "",
        erinnerungen: erKopie(this._einst().erinnerungen_standard, true),
      };
    }
    this._form.tagEingabe = "";
    this._form.externName = "";
    this._form.externFeld = null;
    this._dlgOeffnen("aufgabe");
  }

  _pickerHtml(feld) {
    const auswahl = this._form[feld];
    const ext = new Set((this._einst().externe || []).map((n) => `extern:${n}`));
    for (const x of [...this._form.fuer, ...this._form.macher, ...(this._form.melden_an || [])]) if (x.startsWith("extern:")) ext.add(x);
    const ids = [...this._personen(), ...[...ext].sort((a, b) => a.localeCompare(b, "de"))];
    const chips = ids
      .map((id) => {
        const an = auswahl.includes(id);
        return `<button type="button" class="pchip ${an ? "an" : ""}" data-d="person" data-feld="${feld}" data-id="${esc(id)}">${this._avatar(id, 24)}<span>${esc(this._pname(id))}</span>${an ? '<ha-icon icon="mdi:check"></ha-icon>' : ""}</button>`;
      })
      .join("");
    const neu =
      this._form.externFeld === feld
        ? `<span class="neu-extern"><input type="text" data-f="externName" value="${esc(this._form.externName)}" placeholder="Name, z. B. Oma" maxlength="40"><button type="button" class="klein" data-d="extern-ok">Dazu</button></span>`
        : `<button type="button" class="pchip plus" data-d="extern-neu" data-feld="${feld}"><ha-icon icon="mdi:account-plus-outline"></ha-icon><span>Andere …</span></button>`;
    return `<div class="pchips">${chips}${neu}</div>`;
  }

  _schnelltageHtml(feld) {
    const heute = heuteStr();
    const t = [
      ["Heute", heute],
      ["Morgen", plusTage(heute, 1)],
      ["Sa", naechsterWochentag(heute, 5)],
      ["So", naechsterWochentag(heute, 6)],
      ["Mo", naechsterWochentag(plusTage(heute, 1), 0)],
      ["+1 Woche", plusTage(heute, 7)],
    ];
    return `<div class="schnelltage">${t.map(([n, d]) => `<button type="button" data-d="tag" data-feld="${feld}" data-w="${d}">${n}</button>`).join("")}${
      (feld === "geplant" ? this._form && this._form.geplant : this._plan && this._plan.geplant) ? `<button type="button" data-d="tag" data-feld="${feld}" data-w="">✕ kein Termin</button>` : ""
    }</div>`;
  }

  _fristVorschauText() {
    const f = this._form;
    const heute = heuteStr();
    const n = parseInt(f.frist_n, 10);
    if (!(n >= 1 && n <= 365)) return "Bitte 1 bis 365";
    if (f.id && f.frist_rel_alt === `${n}:${f.frist_einheit}` && f.frist_alt) return `→ spätestens ${fmtTag(f.frist_alt, heute, true)}`;
    return `→ spätestens ${fmtTag(plusEinheit(heute, n, f.frist_einheit), heute, true)}`;
  }

  _formVorschau() {
    const r = this._ebene();
    const fv = r.querySelector(".vorschau.frist");
    if (fv) fv.textContent = this._fristVorschauText();
    const sv = r.querySelector(".vorschau.serie");
    if (sv) sv.textContent = `↻ ${serieText(this._formSerie())}`;
    this._erVorschauAktualisieren();
  }

  _formSerie() {
    const f = this._form;
    return {
      einheit: f.serie_einheit,
      n: Math.max(1, Math.min(99, parseInt(f.serie_n, 10) || 1)),
      wochentage: f.serie_einheit === "wochen" ? [...f.serie_wt].sort() : [],
      basis: f.serie_basis,
      ende: f.serie_ende || null,
    };
  }

  _formHtml() {
    const f = this._form;
    const heute = heuteStr();
    const kats = this._einst().kategorien || [];
    const katChips = kats
      .map((k) => {
        const an = f.kategorie === k.id;
        return `<button type="button" class="pchip kat ${an ? "an" : ""}" data-d="kat" data-id="${esc(k.id)}" style="--k:${esc(k.farbe)};--kb:${mitAlpha(k.farbe, 0.16)}"><ha-icon icon="${esc(k.icon)}" style="color:${esc(k.farbe)}"></ha-icon><span>${esc(k.name)}</span></button>`;
      })
      .join("");
    const seg = (feld, werte) =>
      `<div class="seg">${werte.map(([w, n]) => `<button type="button" class="${String(f[feld]) === String(w) ? "an" : ""}" data-d="seg" data-feld="${feld}" data-w="${w}">${n}</button>`).join("")}</div>`;
    const alleTags = new Map();
    for (const a of this._aufgaben()) for (const t of a.tags || []) alleTags.set(t.toLowerCase(), t);
    const serieWahl = f.serie_an ? f.serie_einheit : "nie";
    let fristTeil = "";
    if (f.frist_modus === "datum") fristTeil = `<div class="reihe" style="margin-top:8px"><input type="date" data-f="frist" value="${esc(f.frist)}"></div>`;
    else if (f.frist_modus === "relativ")
      fristTeil = `<div class="reihe" style="margin-top:8px">spätestens in <input type="number" min="1" max="365" data-f="frist_n" value="${esc(f.frist_n)}">
        <select data-f="frist_einheit">${["tage", "wochen", "monate"].map((e) => `<option value="${e}" ${f.frist_einheit === e ? "selected" : ""}>${EINHEIT[e][2]}</option>`).join("")}</select></div>
        <div class="vorschau frist">${esc(this._fristVorschauText())}</div>`;
    let serieTeil = "";
    if (f.serie_an) {
      serieTeil = `<div class="reihe" style="margin-top:8px">alle <input type="number" min="1" max="99" data-f="serie_n" value="${esc(f.serie_n)}">
          <select data-f="serie_einheit" data-neu="1">${["tage", "wochen", "monate", "jahre"].map((e) => `<option value="${e}" ${f.serie_einheit === e ? "selected" : ""}>${EINHEIT[e][1]}</option>`).join("")}</select></div>
        ${f.serie_einheit === "wochen" ? `<div class="wtage">${WT.map((t, i) => `<button type="button" class="${f.serie_wt.includes(i) ? "an" : ""}" data-d="wt" data-w="${i}">${t}</button>`).join("")}</div>
          <div class="hilfe">Ohne Auswahl: im Abstand ab dem Termin.</div>` : ""}
        <div class="reihe" style="margin-top:10px">Nächster Termin ${seg("serie_basis", [["plan", "nach Plan"], ["erledigung", "ab Erledigung"]])}</div>
        <div class="reihe" style="margin-top:10px">Endet am <input type="date" data-f="serie_ende" value="${esc(f.serie_ende)}"><span class="hilfe" style="margin:0">(optional)</span></div>
        <div class="vorschau serie">↻ ${esc(serieText(this._formSerie()))}</div>`;
    }
    const inhalt = `
      <div class="feld" style="margin-top:4px">
        <div class="lab">Was ist zu tun?</div>
        <input class="gross" type="text" data-f="titel" value="${esc(f.titel)}" placeholder="z. B. Staubsaugen, TÜV Astra, Serie schauen" maxlength="120" autofocus>
      </div>
      <div class="feld"><div class="lab">Kategorie</div><div class="pchips">${katChips}</div></div>
      <div class="feld"><div class="lab">Vorgesehen für <span class="opt">(mehrere möglich, leer = für alle offen)</span></div>${this._pickerHtml("fuer")}</div>
      <div class="feld"><div class="lab">Wird erledigt von <span class="opt">(wer übernimmt – mehrere möglich)</span></div>${this._pickerHtml("macher")}</div>
      <div class="feld"><div class="lab">Geplanter Termin <span class="opt">(Tag, Uhrzeit optional)</span></div>
        <div class="reihe"><input type="date" data-f="geplant" value="${esc(f.geplant)}" data-neu="1"><input type="time" data-f="zeit" value="${esc(f.zeit)}" ${f.geplant ? "" : "disabled"}></div>
        ${this._schnelltageHtml("geplant")}
      </div>
      <div class="feld"><div class="lab">Spätestens</div>
        ${seg("frist_modus", [["keine", "Keine Frist"], ["datum", "Bis Datum"], ["relativ", "In … Tagen/Wochen"]])}
        ${fristTeil}
      </div>
      <div class="feld"><div class="lab">Erinnerungen <span class="opt">(vor dem Termin – ohne Termin vor der Frist)</span></div>
        ${this._erEditorHtml(f.erinnerungen, "er", true)}
        <div class="er-info">${this._erInfoHtml()}</div>
      </div>
      <div class="feld"><div class="lab">Benachrichtigen bei Ausführung <span class="opt">(mehrere möglich)</span></div>
        ${this._pickerHtml("melden_an")}
        ${f.melden_an.length ? `<div class="reihe" style="margin-top:8px">wenn <div class="seg">${[["erledigt", "erledigt"], ["arbeit", "begonnen"]]
          .map(([w, n]) => `<button type="button" class="${f.melden_bei.includes(w) ? "an" : ""}" data-d="melden-bei" data-w="${w}" aria-pressed="${f.melden_bei.includes(w)}">${n}</button>`)
          .join("")}</div></div>
        <div class="hilfe">Bekommt eine Nachricht aufs Handy (Externe per WhatsApp oder E-Mail, wenn in den Einstellungen hinterlegt). Wer die Aufgabe selbst erledigt oder beginnt, bekommt keine.</div>` : ""}
      </div>
      <div class="feld"><div class="lab">Wiederholen</div>
        <div class="seg">${[["nie", "Nie"], ["tage", "Täglich"], ["wochen", "Wöchentlich"], ["monate", "Monatlich"], ["jahre", "Jährlich"]]
          .map(([w, n]) => `<button type="button" class="${serieWahl === w ? "an" : ""}" data-d="serie" data-w="${w}">${n}</button>`)
          .join("")}</div>
        ${serieTeil}
      </div>
      <div class="feld"><div class="lab">Tags <span class="opt">(z. B. TÜV, Wohnzimmer)</span></div>
        <div class="tagchips">${f.tags.map((t, i) => `<span class="tagchip">#${esc(t)}<button type="button" data-d="tag-weg" data-i="${i}" title="Entfernen"><ha-icon icon="mdi:close"></ha-icon></button></span>`).join("")}</div>
        <div class="reihe"><input type="text" list="fa-tags" data-f="tagEingabe" value="${esc(f.tagEingabe)}" placeholder="Tag eingeben" maxlength="30" style="flex:1;min-width:140px">
          <button type="button" class="sekundaer" data-d="tag-dazu"><ha-icon icon="mdi:plus"></ha-icon>Dazu</button></div>
        <datalist id="fa-tags">${[...alleTags.values()].map((t) => `<option value="${esc(t)}"></option>`).join("")}</datalist>
      </div>
      <div class="feld"><div class="lab">Notiz</div><textarea data-f="notiz" maxlength="2000" placeholder="Details, Telefonnummer, Ort …">${esc(f.notiz)}</textarea></div>
      ${f.id ? `<div class="feld"><div class="lab">Status</div>${seg("status", STATUS.map((s) => [s.id, s.name]))}</div>` : ""}`;
    const fuss = `${f.id ? `<button class="sekundaer gefahr" data-d="loeschen"><ha-icon icon="mdi:delete-outline"></ha-icon>Löschen</button>` : ""}
      <span class="platz"></span>
      <button class="sekundaer" data-d="zu">Abbrechen</button>
      <button class="primaer" data-d="speichern"><ha-icon icon="mdi:content-save-outline"></ha-icon>Speichern</button>`;
    return this._dlgRahmen(f.id ? "Aufgabe bearbeiten" : "Neue Aufgabe", inhalt, fuss);
  }

  _tagDazu() {
    const f = this._form;
    const teile = String(f.tagEingabe || "").split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
    for (const t of teile) if (!f.tags.some((x) => x.toLowerCase() === t.toLowerCase()) && f.tags.length < 10) f.tags.push(t.slice(0, 30));
    f.tagEingabe = "";
    this._dlgZeichnen();
    const el = this._ebene().querySelector('[data-f="tagEingabe"]');
    if (el) el.focus();
  }

  _externDazu() {
    const f = this._form;
    const name = String(f.externName || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (name && f.externFeld) {
      const id = `extern:${name}`;
      const vorhanden = [...this._personen(), ...f.fuer, ...f.macher, ...(f.melden_an || []), ...(this._einst().externe || []).map((n) => `extern:${n}`)]
        .find((x) => this._pname(x).toLowerCase() === name.toLowerCase());
      const wahl = vorhanden || id;
      if (!f[f.externFeld].includes(wahl)) f[f.externFeld].push(wahl);
    }
    f.externName = "";
    f.externFeld = null;
    this._dlgZeichnen();
  }

  _formKlick(el, d) {
    const f = this._form;
    switch (d) {
      case "kat":
        f.kategorie = f.kategorie === el.dataset.id ? "" : el.dataset.id;
        break;
      case "person": {
        const l = f[el.dataset.feld];
        const id = el.dataset.id;
        const i = l.indexOf(id);
        if (i >= 0) l.splice(i, 1);
        else l.push(id);
        break;
      }
      case "extern-neu":
        f.externFeld = el.dataset.feld;
        f.externName = "";
        this._dlgZeichnen();
        setTimeout(() => {
          const x = this._ebene().querySelector('[data-f="externName"]');
          if (x) x.focus();
        }, 0);
        return;
      case "extern-ok":
        this._externDazu();
        return;
      case "melden-bei": {
        const w = el.dataset.w;
        const i = f.melden_bei.indexOf(w);
        if (i >= 0) {
          if (f.melden_bei.length > 1) f.melden_bei.splice(i, 1);
        } else f.melden_bei.push(w);
        break;
      }
      case "tag":
        f.geplant = el.dataset.w;
        if (!f.geplant) f.zeit = "";
        break;
      case "seg":
        f[el.dataset.feld] = el.dataset.w;
        if (el.dataset.feld === "frist_modus" && el.dataset.w === "datum" && !f.frist) f.frist = plusTage(heuteStr(), 7);
        break;
      case "serie": {
        const w = el.dataset.w;
        if (w === "nie") f.serie_an = false;
        else {
          const war = f.serie_an ? f.serie_einheit : null;
          f.serie_an = true;
          f.serie_einheit = w;
          if (war !== w) {
            f.serie_n = 1;
            f.serie_wt = w === "wochen" && f.geplant ? [wochentag(f.geplant)] : [];
          }
        }
        break;
      }
      case "wt": {
        const i = +el.dataset.w;
        const p = f.serie_wt.indexOf(i);
        if (p >= 0) f.serie_wt.splice(p, 1);
        else f.serie_wt.push(i);
        break;
      }
      case "tag-dazu":
        this._tagDazu();
        return;
      case "tag-weg":
        f.tags.splice(+el.dataset.i, 1);
        break;
      case "loeschen": {
        const a = this._finde(f.id);
        this._dlgSchliessen();
        this._loeschenFragen(a);
        return;
      }
      case "speichern":
        this._formSpeichern();
        return;
      default:
        return;
    }
    this._dlgZeichnen();
  }

  async _formSpeichern() {
    const f = this._form;
    if (f.tagEingabe && f.tagEingabe.trim()) this._tagDazu();
    if (f.externName && f.externName.trim() && f.externFeld) this._externDazu();
    const titel = String(f.titel || "").trim();
    if (!titel) return this._fehlerZeigen("Bitte eintragen, was zu tun ist.");
    if (f.frist_modus === "datum" && !parseDat(f.frist)) return this._fehlerZeigen("Bitte ein Datum bei „Bis Datum“ wählen.");
    const n = parseInt(f.frist_n, 10);
    if (f.frist_modus === "relativ" && !(n >= 1 && n <= 365)) return this._fehlerZeigen("Bei „spätestens in“ bitte eine Zahl von 1 bis 365.");
    if (f.serie_an && !f.geplant && f.frist_modus === "keine")
      return this._fehlerZeigen("Für eine Wiederholung bitte einen Termin oder eine Frist angeben – davon wird weitergezählt.");
    const er = erBereinigt(f.erinnerungen);
    if (er.fehler) return this._fehlerZeigen(er.fehler);
    const p = {
      titel,
      notiz: f.notiz,
      kategorie: f.kategorie || "",
      tags: f.tags,
      fuer: f.fuer,
      macher: f.macher,
      melden_an: f.melden_an,
      melden_bei: f.melden_bei,
      geplant: f.geplant || null,
      zeit: f.geplant ? f.zeit || null : null,
      frist_modus: f.frist_modus,
      serie: f.serie_an ? this._formSerie() : null,
      erinnerungen: er.liste,
    };
    if (f.frist_modus === "datum") p.frist = f.frist;
    if (f.frist_modus === "relativ") p.frist_rel = { n, einheit: f.frist_einheit };
    if (f.id) {
      p.id = f.id;
      p.status = f.status;
    }
    const knopf = this._ebene().querySelector('[data-d="speichern"]');
    if (knopf) knopf.disabled = true;
    try {
      const r = await this._dienst("speichern", { aufgabe: p, akteur: this._ich || undefined });
      if (!r.ok) {
        if (knopf) knopf.disabled = false;
        return this._fehlerZeigen(r.fehler || "Speichern ging nicht.");
      }
      this._lokalErsetzen(r.aufgabe);
      if (r.folge) this._lokalErsetzen(r.folge);
      this._dlgSchliessen();
      if (!f.id) this._auf.delete(r.aufgabe.id);
      this._zeichnen();
      this._toast(f.id ? "Gespeichert." : "Aufgabe angelegt.");
      if (r.warnung) this._toast(r.warnung);
    } catch (e) {
      if (knopf) knopf.disabled = false;
      this._fehlerZeigen(`Fehler: ${(e && (e.message || e.code)) || e}`);
    }
    return null;
  }

  // ---------------------------------------------------------------- Erinnerungen
  _erListe(p) {
    if (p === "er") return this._form ? this._form.erinnerungen : null;
    if (p === "ers") return this._ef ? this._ef.erinnerungen_standard : null;
    return null;
  }

  _erEditorHtml(liste, p, vorschau) {
    const zeilen = (liste || [])
      .map((r, i) => {
        const tagesart = ER_TAGESART.includes(r.einheit);
        const opts = Object.keys(ER_EINHEIT).map((e) => `<option value="${e}" ${r.einheit === e ? "selected" : ""}>${ER_EINHEIT[e][1]}</option>`).join("");
        const kan = ER_KANAL.map((k) => {
          const an = r.kanaele.includes(k.id);
          return `<button type="button" class="kchip ${an ? "an" : ""}" data-d="er-kanal" data-p="${p}" data-i="${i}" data-w="${k.id}" aria-pressed="${an}"><ha-icon icon="${k.icon}"></ha-icon><span>${k.name}</span></button>`;
        }).join("");
        return `<div class="erinn">
          <div class="reihe">
            <ha-icon class="er-glocke" icon="mdi:bell-outline"></ha-icon>
            <input type="number" min="0" max="999" inputmode="numeric" data-f="${p}:${i}:n" value="${esc(r.n)}" aria-label="Wie viele">
            <select data-f="${p}:${i}:einheit" aria-label="Einheit">${opts}</select>
            <span>vorher</span>
            ${tagesart ? `<span>um</span><input type="time" data-f="${p}:${i}:uhrzeit" value="${esc(r.uhrzeit || "")}" title="Leer = Uhrzeit des Termins" aria-label="Uhrzeit">` : ""}
            <span class="platz"></span>
            <button type="button" class="icon-btn" data-d="er-weg" data-p="${p}" data-i="${i}" title="Erinnerung entfernen" aria-label="Erinnerung entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button>
          </div>
          <div class="kchips">${kan}</div>
          ${vorschau ? `<div class="er-vorschau" data-erv="${i}">${esc(this._erVorschauText(r))}</div>` : ""}
        </div>`;
      })
      .join("");
    const vorlagen = ER_VORLAGEN.map(([n, e]) => `<button type="button" data-d="er-dazu" data-p="${p}" data-w="${n}:${e}">+ ${n} ${n === 1 ? ER_EINHEIT[e][0] : ER_EINHEIT[e][1]}</button>`).join("");
    return `<div class="erinn-liste">${zeilen || '<div class="hilfe" style="margin:0 0 2px">Noch keine Erinnerung.</div>'}</div>
      <div class="schnelltage">${vorlagen}<button type="button" data-d="er-dazu" data-p="${p}" data-w="">+ Eigene</button></div>`;
  }

  _erFormAufgabe() {
    const f = this._form;
    let frist = null;
    if (f.frist_modus === "datum") frist = f.frist || null;
    else if (f.frist_modus === "relativ") {
      const n = parseInt(f.frist_n, 10);
      if (n >= 1 && n <= 365)
        frist = f.id && f.frist_rel_alt === `${n}:${f.frist_einheit}` && f.frist_alt ? f.frist_alt : plusEinheit(heuteStr(), n, f.frist_einheit);
    }
    return { geplant: f.geplant || null, zeit: f.geplant ? f.zeit || null : null, frist };
  }

  _erVorschauText(r) {
    const t = erZeit(this._erFormAufgabe(), r, this._einst().uhrzeit_ohne_termin || "08:00");
    if (!t) return "→ wirkt, sobald ein Termin oder eine Frist eingetragen ist";
    const heute = heuteStr();
    const alt = this._form.id ? this._finde(this._form.id) : null;
    const g = alt && alt.gesendet ? alt.gesendet[r.id] : null;
    if (g && g.fuer === erSchluessel(t)) return `✓ gesendet ${fmtZeitpunkt(g.am, heute)}`;
    if (t.getTime() < Date.now() - 60000) return `→ ${fmtDatumZeit(t, heute)} – liegt in der Vergangenheit`;
    return `→ ${fmtDatumZeit(t, heute)}`;
  }

  _waBereit() {
    const s = this._hass && this._hass.services;
    return !!(s && s.wa_bridge && s.wa_bridge.send_message);
  }

  _mailBereit(dienst) {
    const s = this._hass && this._hass.services;
    return !!(dienst && s && s.notify && s.notify[dienst]);
  }

  _kanalBereit(p, w, e = this._einst()) {
    const k = (e.kontakte || {})[p] || {};
    if (w === "app") return p.startsWith("person.") && ((e.benachrichtigung || {})[p] || []).length > 0;
    if (w === "whatsapp") return !!k.whatsapp && this._waBereit();
    if (w === "email") return !!k.email && this._mailBereit(e.email_dienst);
    return false;
  }

  _kanalFehltText(p, w, e = this._einst()) {
    const k = (e.kontakte || {})[p] || {};
    if (w === "app") return p.startsWith("person.") ? "kein Handy für die App zugeordnet" : "keine App";
    if (w === "whatsapp") return !this._waBereit() ? "WhatsApp-Bridge fehlt" : k.whatsapp ? "WhatsApp geht nicht" : "keine WhatsApp-Nummer";
    if (w === "email") return !this._mailBereit(e.email_dienst) ? "kein E-Mail-Dienst eingerichtet" : "keine E-Mail-Adresse";
    return w;
  }

  _erInfoHtml() {
    const f = this._form;
    const liste = (f && f.erinnerungen) || [];
    if (!liste.length) return "";
    let an = f.macher.length ? f.macher : f.fuer;
    let zusatz = "";
    if (!an.length) {
      const ersteller = f.id ? (this._finde(f.id) || {}).erstellt_von : this._ich;
      an = ersteller ? [ersteller] : [];
      zusatz = " (noch niemand eingeteilt – deshalb an den Ersteller)";
    }
    if (!an.length) return '<div class="hilfe warn"><ha-icon icon="mdi:alert-outline"></ha-icon>Geht an niemanden – bitte festlegen, wer es erledigt.</div>';
    const wege = [...new Set(liste.flatMap((r) => r.kanaele))];
    const probleme = [];
    for (const p of an) {
      const fehlt = wege.filter((w) => !this._kanalBereit(p, w));
      if (!fehlt.length) continue;
      const ersatz = !fehlt.includes("app") && this._kanalBereit(p, "app");
      probleme.push(`${this._pname(p)}: ${fehlt.map((w) => this._kanalFehltText(p, w)).join(", ")}${ersatz ? " – kommt dann per App" : ""}`);
    }
    return `<div class="hilfe">Geht an ${esc(this._pnamen(an))}${esc(zusatz)}</div>${probleme
      .map((t) => `<div class="hilfe warn"><ha-icon icon="mdi:alert-outline"></ha-icon><span>${esc(t)}</span></div>`)
      .join("")}`;
  }

  _erVorschauAktualisieren() {
    if (this._dlg !== "aufgabe" || !this._form) return;
    const r = this._ebene();
    (this._form.erinnerungen || []).forEach((x, i) => {
      const el = r.querySelector(`[data-erv="${i}"]`);
      if (el) el.textContent = this._erVorschauText(x);
    });
    const info = r.querySelector(".er-info");
    if (info) info.innerHTML = this._erInfoHtml();
  }

  _erKlick(el, d) {
    const p = el.dataset.p;
    const liste = this._erListe(p);
    if (!liste) return;
    const i = +el.dataset.i;
    let fokus = null;
    if (d === "er-dazu") {
      const [n, e] = (el.dataset.w || "1:tage").split(":");
      const vorher = liste[liste.length - 1];
      liste.push({ id: erId(), n: parseInt(n, 10) || 1, einheit: ER_EINHEIT[e] ? e : "tage", uhrzeit: "", kanaele: vorher ? [...vorher.kanaele] : ["app"] });
      if (!el.dataset.w) fokus = `[data-f="${p}:${liste.length - 1}:n"]`;
    } else if (d === "er-weg") {
      liste.splice(i, 1);
    } else if (d === "er-kanal") {
      const r = liste[i];
      if (!r) return;
      const w = el.dataset.w;
      const k = r.kanaele.indexOf(w);
      if (k >= 0) {
        if (r.kanaele.length === 1) {
          this._toast("Mindestens ein Weg muss gewählt bleiben.");
          return;
        }
        r.kanaele.splice(k, 1);
      } else r.kanaele.push(w);
      r.kanaele.sort((x, y) => ER_KANAL.findIndex((q) => q.id === x) - ER_KANAL.findIndex((q) => q.id === y));
    } else return;
    this._dlgZeichnen();
    if (fokus)
      setTimeout(() => {
        const x = this._ebene().querySelector(fokus);
        if (x) {
          x.focus();
          x.select();
        }
      }, 0);
  }

  _feldSetzen(f, wert) {
    let m = /^(ers?):(\d+):(n|einheit|uhrzeit)$/.exec(f);
    if (m) {
      const liste = this._erListe(m[1]);
      const r = liste && liste[+m[2]];
      if (r) r[m[3]] = wert;
      return true;
    }
    m = /^kontakt:(\d+):(whatsapp|email)$/.exec(f);
    if (m) {
      const e = this._ef;
      const id = e && (e._kontaktIds || [])[+m[1]];
      if (id) {
        const k = e.kontakte[id] || (e.kontakte[id] = { whatsapp: "", email: "" });
        k[m[2]] = wert;
      }
      return true;
    }
    return false;
  }

  async _kontaktTest(i, el) {
    const e = this._ef;
    const id = (e._kontaktIds || [])[i];
    if (!id) return;
    const k = e.kontakte[id] || {};
    el.disabled = true;
    try {
      const r = await this._dienst("test", { person: id, whatsapp: k.whatsapp || "", email: k.email || "", email_dienst: e.email_dienst || "" });
      if (!r.ok) this._toast(r.fehler || "Der Test ging nicht.");
      else {
        const t = Object.entries(r.ergebnis || {})
          .map(([w, s]) => `${(ER_KANAL_MAP[w] || { name: w }).name} ${s === "ok" ? "✓" : `– ${s}`}`)
          .join(" · ");
        this._toast(`Test an ${this._pname(id)}: ${t}`);
      }
    } catch (err) {
      this._toast(`Fehler: ${(err && (err.message || err.code)) || err}`);
    }
    el.disabled = false;
  }

  // ---------------------------------------------------------------- Termin planen
  _planOeffnen(a) {
    if (!a) return;
    const ich = this._ich;
    this._plan = {
      id: a.id,
      titel: a.titel,
      geplant: a.geplant || "",
      zeit: a.zeit || "",
      macher: a.macher && a.macher.length ? [...a.macher] : ich ? [ich] : [],
      serie: !!a.serie,
      hatte: !!a.geplant,
    };
    this._dlgOeffnen("plan");
  }

  _planHtml() {
    const p = this._plan;
    const ext = new Set((this._einst().externe || []).map((n) => `extern:${n}`));
    for (const x of p.macher) if (x.startsWith("extern:")) ext.add(x);
    const ids = [...this._personen(), ...[...ext].sort()];
    const chips = ids
      .map((id) => {
        const an = p.macher.includes(id);
        return `<button type="button" class="pchip ${an ? "an" : ""}" data-d="person" data-id="${esc(id)}">${this._avatar(id, 24)}<span>${esc(this._pname(id))}</span>${an ? '<ha-icon icon="mdi:check"></ha-icon>' : ""}</button>`;
      })
      .join("");
    const inhalt = `
      <div style="font-weight:500;margin-top:4px">${esc(p.titel)}</div>
      <div class="feld"><div class="lab">Tag</div>
        <div class="reihe"><input type="date" data-f="geplant" value="${esc(p.geplant)}" data-neu="1"><input type="time" data-f="zeit" value="${esc(p.zeit)}" ${p.geplant ? "" : "disabled"}></div>
        ${this._schnelltageHtml("plan")}
        ${p.serie ? `<div class="hilfe">Gilt für diesen Termin der Serie.</div>` : ""}
      </div>
      <div class="feld"><div class="lab">Wer macht es?</div><div class="pchips">${chips}</div></div>`;
    const fuss = `<span class="platz"></span><button class="sekundaer" data-d="zu">Abbrechen</button>
      <button class="primaer" data-d="speichern"><ha-icon icon="mdi:calendar-check"></ha-icon>Speichern</button>`;
    return this._dlgRahmen(p.hatte ? "Termin ändern" : "Termin planen", inhalt, fuss);
  }

  async _planKlick(el, d) {
    const p = this._plan;
    if (d === "tag") {
      p.geplant = el.dataset.w;
      if (!p.geplant) p.zeit = "";
      this._dlgZeichnen();
      return;
    }
    if (d === "person") {
      const i = p.macher.indexOf(el.dataset.id);
      if (i >= 0) p.macher.splice(i, 1);
      else p.macher.push(el.dataset.id);
      this._dlgZeichnen();
      return;
    }
    if (d === "speichern") {
      el.disabled = true;
      const r = await this._aktion(p.id, "planen", { geplant: p.geplant || "", zeit: p.geplant ? p.zeit || "" : "", macher: p.macher });
      if (r) {
        this._dlgSchliessen();
        this._toast(p.geplant ? `Termin: ${fmtTag(p.geplant, heuteStr())}${p.geplant && p.zeit ? ` ${p.zeit}` : ""}` : "Termin entfernt.");
      } else el.disabled = false;
    }
  }

  // ---------------------------------------------------------------- Löschen
  _loeschenFragen(a) {
    if (!a) return;
    this._loeschA = a;
    this._dlgOeffnen("loeschen");
  }

  _loeschenHtml() {
    const a = this._loeschA;
    const inhalt = `<p style="margin:8px 0 0">„${esc(a.titel)}“ wirklich löschen?</p>
      ${a.serie && a.status !== "erledigt" ? `<p class="hilfe">Das ist eine wiederkehrende Aufgabe – die Serie endet damit.</p>` : ""}
      <p class="hilfe">Gelöschte Aufgaben lassen sich unter Einstellungen → Papierkorb wiederherstellen.</p>`;
    const fuss = `<span class="platz"></span><button class="sekundaer" data-d="zu">Abbrechen</button>
      <button class="primaer" data-d="ja" style="background:var(--error-color,#db4437)"><ha-icon icon="mdi:delete-outline"></ha-icon>Löschen</button>`;
    return this._dlgRahmen("Aufgabe löschen", inhalt, fuss);
  }

  async _loeschenKlick(el, d) {
    if (d !== "ja") return;
    const a = this._loeschA;
    el.disabled = true;
    try {
      const r = await this._dienst("loeschen", { aufgabe_id: a.id, akteur: this._ich || undefined });
      this._dlgSchliessen();
      if (!r.ok && r.fehler) {
        this._toast(r.fehler);
        return;
      }
      if (this._daten) this._daten.aufgaben = this._daten.aufgaben.filter((x) => x.id !== a.id);
      this._zeichnen();
      this._toast(`„${a.titel}“ gelöscht.`, "Rückgängig", () => this._wiederherstellen(a.id));
    } catch (e) {
      el.disabled = false;
      this._fehlerZeigen(`Fehler: ${(e && (e.message || e.code)) || e}`);
    }
  }

  async _wiederherstellen(id) {
    try {
      const r = await this._dienst("wiederherstellen", { aufgabe_id: id, akteur: this._ich || undefined });
      if (!r.ok) {
        this._toast(r.fehler || "Wiederherstellen ging nicht.");
        return false;
      }
      this._lokalErsetzen(r.aufgabe);
      this._zeichnen();
      this._toast("Wiederhergestellt.");
      return true;
    } catch (e) {
      this._toast(`Fehler: ${(e && (e.message || e.code)) || e}`);
      return false;
    }
  }

  // ---------------------------------------------------------------- Wer bin ich
  _ichOeffnen() {
    this._dlgOeffnen("ich");
  }

  _ichHtml() {
    const ich = this._ich;
    const knoepfe = this._personen()
      .map((p) => `<button type="button" class="pchip ${p === ich ? "an" : ""}" data-d="wahl" data-id="${esc(p)}">${this._avatar(p, 26)}<span>${esc(this._pname(p))}</span></button>`)
      .join("");
    const inhalt = `<p style="margin:6px 0 10px">Wer benutzt gerade dieses Gerät? Danach richten sich „Übernehmen“, „Meine“ und wer benachrichtigt wird.</p>
      <div class="pchips">${knoepfe}</div>
      ${this._ui.ich ? `<p class="hilfe" style="margin-top:12px"><button type="button" class="sekundaer" data-d="auto"><ha-icon icon="mdi:account-sync-outline"></ha-icon>Automatisch nach Benutzerkonto</button></p>` : ""}`;
    return this._dlgRahmen("Wer bist du?", inhalt, `<span class="platz"></span><button class="sekundaer" data-d="zu">Schließen</button>`);
  }

  async _ichKlick(el, d) {
    if (d === "wahl") {
      await this._ichSetzen(el.dataset.id);
      this._dlgSchliessen();
    } else if (d === "auto") {
      this._ui.ich = "";
      this._uiSpeichern();
      this._dlgSchliessen();
      this._zeichnen();
    }
  }

  async _ichSetzen(p) {
    this._ui.ich = p;
    this._uiSpeichern();
    this._zeichnen();
    const st = this._hass.states[p];
    const verknuepft = st && st.attributes.user_id === (this._hass.user && this._hass.user.id);
    if (!verknuepft) {
      try {
        await this._dienst("ich_bin", { person: p });
      } catch (e) {
        /* nur Komfort */
      }
    }
  }

  // ---------------------------------------------------------------- Einstellungen
  _einstOeffnen() {
    const e = JSON.parse(JSON.stringify(this._einst()));
    this._ef = {
      kategorien: e.kategorien || [],
      externe: e.externe || [],
      benachrichtigung: e.benachrichtigung || {},
      ersteller_melden: e.ersteller_melden !== false,
      zugewiesene_melden: e.zugewiesene_melden !== false,
      erinnerung: !!e.erinnerung,
      erinnerung_zeit: e.erinnerung_zeit || "08:00",
      erledigte_behalten_tage: e.erledigte_behalten_tage || 90,
      kontakte: e.kontakte || {},
      erinnerungen_standard: erKopie(e.erinnerungen_standard),
      uhrzeit_ohne_termin: e.uhrzeit_ohne_termin || "08:00",
      email_dienst: e.email_dienst || "",
      ansicht_bereich: this._ui.ansicht ? "geraet" : "alle",
      ansicht_alle: ansichtSauber(e.ansicht),
      ansicht_geraet: ansichtSauber(this._ui.ansicht || e.ansicht),
      neuExtern: "",
      iconOffen: null,
    };
    this._dlgOeffnen("einst");
  }

  _efAnsicht() {
    const e = this._ef;
    return e.ansicht_bereich === "geraet" ? e.ansicht_geraet : e.ansicht_alle;
  }

  _ansichtEinstHtml() {
    const e = this._ef;
    const av = this._efAnsicht();
    const seg = (d, wert, opts) =>
      `<div class="seg">${opts.map(([w, n]) => `<button type="button" class="${wert === w ? "an" : ""}" data-d="${d}" data-w="${w}" aria-pressed="${wert === w}">${n}</button>`).join("")}</div>`;
    const letzte = av.reihenfolge.length - 1;
    const reihen = av.reihenfolge
      .map((id, i) => {
        const s = STATUS_MAP[id];
        return `<div class="stzeile" style="--s:${s.farbe}">
          <div class="st-oben">
            <span class="st-nr">${i + 1}.</span>
            <span class="st-name"><ha-icon icon="${s.icon}"></ha-icon>${s.name}</span>
            <button type="button" class="icon-btn" data-d="st-hoch" data-i="${i}" ${i === 0 ? "disabled" : ""} title="Nach oben" aria-label="${s.name} nach oben"><ha-icon icon="mdi:arrow-up"></ha-icon></button>
            <button type="button" class="icon-btn" data-d="st-runter" data-i="${i}" ${i === letzte ? "disabled" : ""} title="Nach unten" aria-label="${s.name} nach unten"><ha-icon icon="mdi:arrow-down"></ha-icon></button>
          </div>
          <div class="st-unten">
            <label class="st-wahl"><input type="checkbox" data-f="ansicht_zu:${id}" ${av.zu.includes(id) ? "checked" : ""}>zugeklappt</label>
            ${id !== "erledigt" ? `<label class="st-wahl"><input type="checkbox" data-f="ansicht_termin:${id}" ${av.termin.includes(id) ? "checked" : ""}>nach Termin unterteilen</label>` : ""}
          </div>
        </div>`;
      })
      .join("");
    return `<div class="abschnitt"><h3>Ansicht</h3>
        <div class="hilfe" style="margin:0 0 4px">So sieht die Liste beim Öffnen aus. Über der Liste lässt sich jederzeit umschalten und alles auf- oder zuklappen.</div>
        <div class="feldzeile"><span class="fz-l">Gilt für</span>${seg("ans-bereich", e.ansicht_bereich, [["alle", "Alle Geräte"], ["geraet", "Nur dieses Gerät"]])}</div>
        <div class="feldzeile"><span class="fz-l">Darstellung</span>${seg("ans-kompakt", av.kompakt ? "1" : "0", [["0", "Detailliert"], ["1", "Kompakt (1 Zeile)"]])}</div>
        <div class="lab2">Reihenfolge der Status – der erste steht ganz oben (bei „Gruppieren: Status“)</div>
        <div class="stliste">${reihen}</div>
        <div class="hilfe">Zugeklappte Status zeigen nur die Überschrift mit der Anzahl – antippen klappt sie auf. „Nach Termin unterteilen“ ordnet nach dem geplanten Tag: Verpasst, Heute, Morgen, Übermorgen, Diese Woche, Nächste Woche, Diesen Monat, Nächsten Monat, Später, Ohne Termin.</div>
        ${e.ansicht_bereich === "geraet" ? '<div class="hilfe">Gilt nur auf diesem Gerät. Mit „Alle Geräte“ nutzt es wieder die gemeinsame Einstellung.</div>' : ""}
      </div>`;
  }

  _einstHtml() {
    const e = this._ef;
    const dienste = Object.keys((this._hass.services && this._hass.services.notify) || {})
      .filter((d) => d.startsWith("mobile_app_"))
      .sort();
    const geraete = this._personen()
      .map((p) => {
        const an = e.benachrichtigung[p] || [];
        const extra = an.filter((d) => !dienste.includes(d));
        return `<div class="wer">${this._avatar(p, 22)}${esc(this._pname(p))}</div>
          <div class="liste-g">${[...dienste, ...extra]
            .map((d) => `<label><input type="checkbox" data-f="melden:${esc(p)}:${esc(d)}" ${an.includes(d) ? "checked" : ""}>${esc(d.replace("mobile_app_", ""))}${dienste.includes(d) ? "" : " (fehlt)"}</label>`)
            .join("") || "<span>keine Handys mit Companion-App</span>"}</div>`;
      })
      .join("");
    const kats = e.kategorien
      .map(
        (k, i) => `<div class="katzeile">
          <button type="button" class="kicon" data-d="kat-icon" data-i="${i}" title="Symbol wählen"><ha-icon icon="${esc(k.icon)}" style="color:${esc(k.farbe)}"></ha-icon></button>
          <input type="text" data-f="kat:${i}:name" value="${esc(k.name)}" maxlength="30">
          <input type="color" data-f="kat:${i}:farbe" value="${esc(k.farbe)}">
          <button type="button" class="icon-btn" data-d="kat-weg" data-i="${i}" title="Kategorie entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button>
        </div>${e.iconOffen === i ? `<div class="iconraster">${ICONS.map((ic) => `<button type="button" class="${ic === k.icon ? "an" : ""}" data-d="icon-wahl" data-i="${i}" data-w="${ic}"><ha-icon icon="${ic}"></ha-icon></button>`).join("")}
          <input type="text" data-f="kat:${i}:icon" value="${esc(k.icon)}" placeholder="mdi:…"></div>` : ""}`
      )
      .join("");
    const mailDienste = Object.keys((this._hass.services && this._hass.services.notify) || {})
      .filter((d) => !d.startsWith("mobile_app_") && !ER_KEIN_MAIL.includes(d))
      .sort();
    if (e.email_dienst && !mailDienste.includes(e.email_dienst)) mailDienste.push(e.email_dienst);
    const ids = [...this._personen(), ...e.externe.map((n) => `extern:${n}`)];
    e._kontaktIds = ids;
    const kontakte = ids
      .map((id, i) => {
        const k = e.kontakte[id] || {};
        const wa = k.whatsapp && /^\d+$/.test(k.whatsapp) ? `+${k.whatsapp}` : k.whatsapp || "";
        return `<div class="kontakt">
          <div class="wer">${this._avatar(id, 22)}${esc(this._pname(id))}</div>
          <div class="kfelder">
            <input type="tel" data-f="kontakt:${i}:whatsapp" value="${esc(wa)}" placeholder="WhatsApp-Nummer (+49 …)" autocomplete="off">
            <input type="email" data-f="kontakt:${i}:email" value="${esc(k.email || "")}" placeholder="E-Mail-Adresse" autocomplete="off">
            <button type="button" class="sekundaer" data-d="kontakt-test" data-i="${i}" title="Testnachricht über App, WhatsApp und E-Mail"><ha-icon icon="mdi:send-check-outline"></ha-icon>Test</button>
          </div>
        </div>`;
      })
      .join("");
    const papier = ((this._daten && this._daten.papierkorb) || []).slice().reverse();
    const heute = heuteStr();
    const inhalt = `
      <div class="abschnitt"><h3>Dieses Gerät</h3>
        <div class="reihe">Ich bin: <button type="button" class="sekundaer" data-d="ich">${this._ich ? `${this._avatar(this._ich, 22)}${esc(this._pname(this._ich))}` : "auswählen"}</button></div>
      </div>
      ${this._ansichtEinstHtml()}
      <div class="abschnitt"><h3>Benachrichtigungen</h3>
        <label class="schalter"><input type="checkbox" data-f="ersteller_melden" ${e.ersteller_melden ? "checked" : ""}>Ersteller bei Übernahme, Termin, Status, Überspringen und Löschen</label>
        <label class="schalter"><input type="checkbox" data-f="zugewiesene_melden" ${e.zugewiesene_melden ? "checked" : ""}>Vorgesehene und Eingeteilte bei neuen Aufgaben (mit Knopf „Übernehmen“)</label>
        <label class="schalter"><input type="checkbox" data-f="erinnerung" ${e.erinnerung ? "checked" : ""}>Tägliche Erinnerung an heutige und überfällige Aufgaben</label>
        ${e.erinnerung ? `<div class="reihe" style="margin-left:26px">um <input type="time" data-f="erinnerung_zeit" value="${esc(e.erinnerung_zeit)}"> Uhr</div>` : ""}
        <h4>Erinnerungen vor dem Termin</h4>
        <div class="hilfe" style="margin:0 0 8px">Stellst du bei jeder Aufgabe ein – beliebig viele, jede mit eigenem Weg. Neue Aufgaben bekommen diese Vorgabe:</div>
        ${this._erEditorHtml(e.erinnerungen_standard, "ers", false)}
        <div class="reihe" style="margin-top:10px">Termine ohne Uhrzeit zählen ab <input type="time" data-f="uhrzeit_ohne_termin" value="${esc(e.uhrzeit_ohne_termin)}"> Uhr</div>
        <div class="hilfe">Erinnerungen gehen an die Ausführenden, sonst an die Vorgesehenen, sonst an den Ersteller. Ohne Termin zählt die Frist. Fehlt eine Nummer oder Adresse, kommt die Erinnerung per App.</div>
        <h4>Wege</h4>
        <div class="weg"><ha-icon icon="mdi:cellphone"></ha-icon><div><b>App</b>
          <div class="hilfe" style="margin-top:2px">${esc(this._personen().map((p) => `${this._pname(p)} → ${(e.benachrichtigung[p] || []).map((d) => d.replace("mobile_app_", "")).join(", ") || "–"}`).join(" · "))}</div>
          <details class="geraete-box" ${e.geraeteOffen ? "open" : ""}><summary data-d="geraete-auf">Geräte zuordnen</summary><div class="geraete">${geraete}</div></details></div></div>
        <div class="weg"><ha-icon icon="mdi:whatsapp"></ha-icon><div><b>WhatsApp</b>
          <div class="hilfe" style="margin-top:2px">${this._waBereit() ? "über die WhatsApp-Bridge – Absender ist das dort verbundene WhatsApp-Konto" : "WhatsApp-Bridge nicht gefunden – WhatsApp-Erinnerungen kommen per App"}</div></div></div>
        <div class="weg"><ha-icon icon="mdi:email-outline"></ha-icon><div><b>E-Mail</b> über
          <select data-f="email_dienst"><option value="">– keinen –</option>${mailDienste.map((d) => `<option value="${esc(d)}" ${e.email_dienst === d ? "selected" : ""}>notify.${esc(d)}</option>`).join("")}</select>
          ${mailDienste.length ? "" : '<div class="hilfe">In Home Assistant ist noch kein E-Mail-Versand eingerichtet (z. B. SMTP). Bis dahin kommen E-Mail-Erinnerungen per App.</div>'}</div></div>
        <details class="geraete-box" ${e.kontakteOffen ? "open" : ""}><summary data-d="kontakte-auf">WhatsApp-Nummern und E-Mail-Adressen</summary><div class="kontakte">${kontakte}</div></details>
      </div>
      <div class="abschnitt"><h3>Kategorien</h3>${kats}
        <button type="button" class="sekundaer" data-d="kat-dazu"><ha-icon icon="mdi:plus"></ha-icon>Kategorie</button>
      </div>
      <div class="abschnitt"><h3>Weitere Personen</h3>
        <div class="hilfe" style="margin-top:0">Für Leute ohne Home Assistant, z. B. Oma oder Handwerker.</div>
        <div class="tagchips" style="margin-top:8px">${e.externe.map((n, i) => `<span class="tagchip">${esc(n)}<button type="button" data-d="ext-weg" data-i="${i}" title="Entfernen"><ha-icon icon="mdi:close"></ha-icon></button></span>`).join("") || '<span class="hilfe" style="margin:0">noch keine</span>'}</div>
        <div class="reihe"><input type="text" data-f="neuExtern" value="${esc(e.neuExtern)}" placeholder="Name" maxlength="40"><button type="button" class="sekundaer" data-d="ext-dazu"><ha-icon icon="mdi:plus"></ha-icon>Dazu</button></div>
      </div>
      <div class="abschnitt"><h3>Aufbewahrung</h3>
        <div class="reihe">Erledigte Aufgaben nach <input type="number" min="7" max="3650" data-f="erledigte_behalten_tage" value="${esc(e.erledigte_behalten_tage)}"> Tagen entfernen</div>
      </div>
      <div class="abschnitt"><h3>Papierkorb</h3>
        ${papier.length ? `<div class="reihe" style="margin-bottom:6px"><button type="button" class="sekundaer gefahr" data-d="papier-leeren"><ha-icon icon="mdi:delete-sweep-outline"></ha-icon>Papierkorb leeren</button></div>` : ""}
        ${papier.length ? papier.map((p) => `<div class="papier"><span>${esc(p.titel)} <span class="hilfe">· ${esc(fmtZeitpunkt(p.geloescht, heute))}</span></span><button type="button" class="sekundaer" data-d="zurueck" data-id="${esc(p.id)}"><ha-icon icon="mdi:restore"></ha-icon>Zurück</button></div>`).join("") : '<div class="hilfe" style="margin:0">leer</div>'}
      </div>`;
    const fuss = `<span class="platz"></span><button class="sekundaer" data-d="zu">Abbrechen</button>
      <button class="primaer" data-d="speichern"><ha-icon icon="mdi:content-save-outline"></ha-icon>Speichern</button>`;
    return this._dlgRahmen("Einstellungen", inhalt, fuss);
  }

  async _einstKlick(el, d) {
    const e = this._ef;
    switch (d) {
      case "ich":
        this._dlgSchliessen();
        this._ichOeffnen();
        return;
      case "geraete-auf":
        e.geraeteOffen = !e.geraeteOffen;
        return;
      case "kontakte-auf":
        e.kontakteOffen = !e.kontakteOffen;
        return;
      case "ans-bereich":
        e.ansicht_bereich = el.dataset.w === "geraet" ? "geraet" : "alle";
        break;
      case "ans-kompakt":
        this._efAnsicht().kompakt = el.dataset.w === "1";
        break;
      case "st-hoch":
      case "st-runter": {
        const r = this._efAnsicht().reihenfolge;
        const i = +el.dataset.i;
        const j = d === "st-hoch" ? i - 1 : i + 1;
        if (j < 0 || j >= r.length) return;
        [r[i], r[j]] = [r[j], r[i]];
        break;
      }
      case "kontakt-test":
        await this._kontaktTest(+el.dataset.i, el);
        return;
      case "kat-icon": {
        const i = +el.dataset.i;
        e.iconOffen = e.iconOffen === i ? null : i;
        break;
      }
      case "icon-wahl":
        e.kategorien[+el.dataset.i].icon = el.dataset.w;
        e.iconOffen = null;
        break;
      case "kat-weg":
        e.kategorien.splice(+el.dataset.i, 1);
        e.iconOffen = null;
        break;
      case "kat-dazu":
        e.kategorien.push({ id: "", name: "Neue Kategorie", icon: "mdi:tag-outline", farbe: "#607d8b" });
        e.iconOffen = e.kategorien.length - 1;
        break;
      case "ext-weg":
        e.externe.splice(+el.dataset.i, 1);
        break;
      case "ext-dazu": {
        const n = String(e.neuExtern || "").trim().replace(/\s+/g, " ").slice(0, 40);
        if (n && !e.externe.some((x) => x.toLowerCase() === n.toLowerCase())) e.externe.push(n);
        e.neuExtern = "";
        break;
      }
      case "papier-leeren": {
        el.disabled = true;
        try {
          const r = await this._dienst("papierkorb_leeren", {});
          if (r.ok && this._daten) this._daten.papierkorb = [];
        } catch (err) {
          this._fehlerZeigen(`Fehler: ${(err && (err.message || err.code)) || err}`);
        }
        break;
      }
      case "zurueck": {
        el.disabled = true;
        const ok = await this._wiederherstellen(el.dataset.id);
        if (ok && this._daten) this._daten.papierkorb = (this._daten.papierkorb || []).filter((p) => p.id !== el.dataset.id);
        break;
      }
      case "speichern": {
        if (e.neuExtern && e.neuExtern.trim()) {
          const n = e.neuExtern.trim().slice(0, 40);
          if (!e.externe.some((x) => x.toLowerCase() === n.toLowerCase())) e.externe.push(n);
        }
        const ers = erBereinigt(e.erinnerungen_standard);
        if (ers.fehler) {
          this._fehlerZeigen(ers.fehler);
          return;
        }
        el.disabled = true;
        try {
          const r = await this._dienst("einstellungen", {
            einstellungen: {
              kategorien: e.kategorien.filter((k) => String(k.name || "").trim()),
              externe: e.externe,
              benachrichtigung: e.benachrichtigung,
              ersteller_melden: e.ersteller_melden,
              zugewiesene_melden: e.zugewiesene_melden,
              erinnerung: e.erinnerung,
              erinnerung_zeit: e.erinnerung_zeit,
              erledigte_behalten_tage: parseInt(e.erledigte_behalten_tage, 10) || 90,
              kontakte: e.kontakte,
              erinnerungen_standard: ers.liste,
              uhrzeit_ohne_termin: e.uhrzeit_ohne_termin || "08:00",
              email_dienst: e.email_dienst || "",
              ...(e.ansicht_bereich === "alle" ? { ansicht: ansichtSauber(e.ansicht_alle) } : {}),
            },
          });
          if (!r.ok) {
            el.disabled = false;
            this._fehlerZeigen(r.fehler || "Speichern ging nicht.");
            return;
          }
          const ansichtVorher = JSON.stringify(this._ansicht());
          if (this._daten) this._daten.einstellungen = r.einstellungen;
          if (e.ansicht_bereich === "geraet") this._ui.ansicht = ansichtSauber(e.ansicht_geraet);
          else delete this._ui.ansicht;
          this._uiSpeichern();
          if (JSON.stringify(this._ansicht()) !== ansichtVorher) this._ansichtAnwenden();
          this._dlgSchliessen();
          this._zeichnen();
          this._toast("Einstellungen gespeichert.");
        } catch (err) {
          el.disabled = false;
          this._fehlerZeigen(`Fehler: ${(err && (err.message || err.code)) || err}`);
        }
        return;
      }
      default:
        return;
    }
    this._dlgZeichnen();
  }
}

if (!customElements.get("familienaufgaben-karte")) {
  customElements.define("familienaufgaben-karte", FamilienaufgabenKarte);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "familienaufgaben-karte",
    name: "Familienaufgaben",
    description: "Gemeinsame Aufgaben- und Terminliste der Familie (Integration Familienaufgaben).",
    preview: false,
  });
  console.info(`%c FAMILIENAUFGABEN %c ${FA_VERSION} `, "background:#2b8be6;color:#fff;border-radius:3px 0 0 3px", "background:#555;color:#fff;border-radius:0 3px 3px 0");
}

// ------------------------------------------------------------------ Seitenleiste
// Eigene Seite „Aufgaben“ (von der Integration angemeldet): Kopfzeile mit Menüknopf + Karte.
class FamilienaufgabenPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    this._zeichnen();
  }

  get hass() {
    return this._hass;
  }

  set narrow(narrow) {
    this._narrow = narrow;
    this._zeichnen();
  }

  set panel(panel) {
    this._panel = panel;
    this._zeichnen();
  }

  set route(route) {
    this._route = route;
  }

  _zeichnen() {
    if (!this._hass) return;
    if (!this._karte) {
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: block; min-height: 100%; background: var(--primary-background-color); }
          .kopf {
            position: sticky; top: 0; z-index: 2;
            display: flex; align-items: center; gap: 4px;
            height: var(--header-height, 56px); padding: 0 16px 0 4px; box-sizing: border-box;
            background: var(--app-header-background-color, var(--primary-color));
            color: var(--app-header-text-color, var(--text-primary-color, #fff));
            border-bottom: var(--app-header-border-bottom, none);
            padding-top: env(safe-area-inset-top);
          }
          .kopf button {
            display: flex; align-items: center; justify-content: center;
            width: 48px; height: 48px; border: 0; border-radius: 50%;
            background: none; color: inherit; cursor: pointer;
          }
          .kopf button[hidden] { display: none; }
          .titel { font-size: 20px; font-weight: 400; margin-left: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .inhalt { max-width: 1200px; margin: 0 auto; padding: 8px; box-sizing: border-box; }
        </style>
        <div class="kopf">
          <button class="menue" title="Menü" aria-label="Menü"><ha-icon icon="mdi:menu"></ha-icon></button>
          <div class="titel"></div>
        </div>
        <div class="inhalt"></div>`;
      this.shadowRoot.querySelector(".menue").addEventListener("click", () => {
        this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
      });
      const karte = document.createElement("familienaufgaben-karte");
      const cfg = (this._panel && this._panel.config && this._panel.config.karte) || {};
      karte.setConfig(cfg);
      this.shadowRoot.querySelector(".inhalt").appendChild(karte);
      this._karte = karte;
    }
    const menue = this.shadowRoot.querySelector(".menue");
    menue.hidden = !(this._narrow || this._hass.dockedSidebar === "always_hidden");
    const titel = (this._panel && this._panel.title) || "Aufgaben";
    this.shadowRoot.querySelector(".titel").textContent = titel;
    this._karte.hass = this._hass;
  }
}

if (!customElements.get("familienaufgaben-panel")) {
  customElements.define("familienaufgaben-panel", FamilienaufgabenPanel);
}
