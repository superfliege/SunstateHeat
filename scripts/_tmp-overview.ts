// Erzeugt die HTML-Übersicht (Viertel-DNA, Gangs, Ereignisse) aus den Daten. Wegwerf-Skript.
import { writeFileSync } from 'node:fs';
import { STREET_EVENTS } from '../shared/src/content/events';
import { GANG_PROFILES, POLICE, gangRelation } from '../shared/src/factions';
import { GANG_IDS } from '../shared/src/gangs';
import { DISTRICT_DNA, DISTRICT_IDS } from '../shared/src/world/districts';
import { DAY_PART_NAMES } from '../shared/src/npc/population';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const out = process.argv[2];
const dName = (id: string) => id === 'anywhere' ? 'Überall' : DISTRICT_DNA[id as keyof typeof DISTRICT_DNA].name;
const relLabel: Record<string, string> = { feud: 'Feindschaft', rivalry: 'Rivalität', shaky_peace: 'Wackeliger Frieden', business: 'Geschäftsbeziehung', alliance: 'Bündnis' };
const styleLabel: Record<string, string> = { say: 'Sprechen', shout: 'Rufen', whisper: 'Flüstern', think: 'Denken', gang: 'Gang-Slang', symbol: 'Symbol', sfx: 'Geräusch' };

const meter = (label: string, v: number, cls: string) => `<div class="meter"><span>${label}</span><div class="bar"><i class="${cls}" style="width:${v}%"></i></div><b>${v}</b></div>`;

let districts = '';
for (const id of DISTRICT_IDS) {
  const d = DISTRICT_DNA[id];
  const gangChip = d.homeGang ? `<span class="chip" style="--c:${hex(GANG_PROFILES[d.homeGang].presence.colors[0])}">Heimrevier: ${GANG_PROFILES[d.homeGang].name}</span>` : '';
  const contested = (d.contestedBy ?? []).map((g) => `<span class="chip ghost" style="--c:${hex(GANG_PROFILES[g].presence.colors[0])}">${GANG_PROFILES[g].name}</span>`).join('');
  districts += `<article class="dist" id="v-${id}">
  <header><div class="swatches">${d.look.palette.map((c) => `<i style="background:${hex(c)}"></i>`).join('')}</div>
  <h3>${esc(d.name)}</h3><p class="motto">„${esc(d.motto.replace(/\.$/, ''))}“</p>
  <p class="phil">${esc(d.philosophy)}</p>
  <div class="vals">${d.values.map((v) => `<span>${esc(v)}</span>`).join('')}</div></header>
  <div class="grid2">
   <div><h4>Stimmung (Start)</h4>${meter('Sicherheit', d.mood.safety, 'safe')}${meter('Wohlstand', d.mood.wealth, 'rich')}${meter('Gang-Präsenz', d.mood.gang, 'gang')}
   <div class="chips">${gangChip}${contested ? `<span class="lbl">mischen mit:</span>${contested}` : ''}</div>
   <h4>Bewohner</h4><ul class="res">${d.residents.map((r) => `<li><b>${esc(r.name)}</b> <span class="w">${r.weight}</span><br><span class="att">${esc(r.attitude)}</span></li>`).join('')}</ul></div>
   <div><h4>Alltag & Orte</h4><p>${esc(d.activities.join(' · '))}</p><p class="places">${d.hangouts.map(esc).join(' · ')}</p>
   <h4>Sorgen</h4><p>${esc(d.worries.join(' · '))}</p>
   <h4>Gesprächsstoff</h4><ul class="topics">${Object.entries(d.topics).map(([k, v]) => `<li><code>${k}</code> ${esc(v)}</li>`).join('')}</ul>
   <h4>Look & Klang</h4><dl>
    <dt>Graffiti</dt><dd>${esc(d.look.graffiti)}</dd><dt>Plakate</dt><dd>${d.look.posters.map(esc).join('<br>')}</dd>
    <dt>Läden</dt><dd>${esc(d.look.shops.join(', '))}</dd><dt>Musik</dt><dd>${esc(d.look.windowMusic)}</dd>
    <dt>Fahrzeuge</dt><dd>${esc(d.look.vehicles.join(', '))}</dd><dt>Tiere</dt><dd>${esc(d.look.pets.join(', '))}</dd>
    <dt>Kleidung</dt><dd>${esc(d.look.clothing)}</dd><dt>Geräusche</dt><dd>${esc(d.sound.ambience.join(', '))}</dd></dl>
    ${d.calendar?.length ? `<h4>Kalender</h4>${d.calendar.map((c) => `<p><b>${esc(c.name)}</b> – ${esc(c.days)}, ${DAY_PART_NAMES[c.part]}: ${esc(c.desc)}</p>`).join('')}` : ''}
   </div></div>
  <h4>So klingt das Viertel</h4><div class="bubbles">${d.sampleLines.map((l) => `<q class="b say">${esc(l)}</q>`).join('')}</div>
  <p class="map">Karte: ${esc([...d.mapDistricts, ...(d.mapZones ?? []).map((z) => 'Zone ' + z)].join(', '))}</p>
 </article>`;
}

let gangs = '';
for (const g of GANG_IDS) {
  const p = GANG_PROFILES[g];
  const c = hex(p.presence.colors[0]);
  const person = (n: typeof p.hierarchy.boss, boss = false) => `<div class="person${boss ? ' boss' : ''}"><div class="role">${esc(n.role)}</div><h5>${esc(n.name)}${n.nick ? ` <span>„${esc(n.nick)}“</span>` : ''}</h5><p>${esc(n.personality)}</p><p class="quirk"><b>Marotte:</b> ${esc(n.quirk)}</p><p class="quirk"><b>Look:</b> ${esc(n.look)} · <b>Ort:</b> ${esc(n.haunt)}</p><q class="b gang">${esc(n.catchphrase)}</q></div>`;
  gangs += `<article class="gangcard" id="g-${g}" style="--g:${c};--g2:${hex(p.presence.colors[1])}">
  <header><div class="tag">${esc(p.presence.tag.letters[0])}</div><div><h3>${esc(p.name)}</h3><p class="motto">„${esc(p.motto.replace(/\.$/, ''))}“</p></div></header>
  <p class="phil"><b>Selbstbild:</b> ${esc(p.selfImage)}</p><p class="phil">${esc(p.philosophy)}</p>
  <div class="vals">${p.values.map((v) => `<span>${esc(v)}</span>`).join('')}</div>
  <p class="small"><b>Verachten:</b> ${esc(p.despise.join(' · '))}</p>
  <p class="small"><b>Revier:</b> ${p.turf.map(dName).join(', ')} · <b>will mehr von:</b> ${p.ambitions.map(dName).join(', ')}</p>
  <h4>Hierarchie</h4><div class="people">${person(p.hierarchy.boss, true)}${p.hierarchy.lieutenants.map((l) => person(l)).join('')}</div>
  <dl class="ranks"><dt>Mitglieder</dt><dd>${esc(p.hierarchy.members)}</dd><dt>Anwärter</dt><dd>${esc(p.hierarchy.prospects)}</dd><dt>Sympathisanten</dt><dd>${esc(p.hierarchy.sympathizers)}</dd></dl>
  <div class="grid2"><div><h4>Sprache</h4><p><b>Gruß:</b> ${p.slang.greetings.map((s) => `„${esc(s)}“`).join(' ')}</p><p><b>Abschied:</b> ${p.slang.farewells.map((s) => `„${esc(s)}“`).join(' ')}</p>
  <ul class="topics">${Object.entries(p.slang.expressions).map(([k, v]) => `<li><b>${esc(k)}</b> = ${esc(v)}</li>`).join('')}</ul>
  <h4>Spitznamen für Rivalen</h4><ul class="topics">${Object.entries(p.slang.rivalNicknames).map(([k, v]) => `<li><b>${k === 'police' ? 'Polizei' : GANG_PROFILES[k as keyof typeof GANG_PROFILES].name}:</b> ${v!.map(esc).join(', ')}</li>`).join('')}</ul></div>
  <div><h4>Spott über andere Viertel</h4><ul class="topics">${Object.entries(p.slang.districtMockery).map(([k, v]) => `<li><b>${dName(k)}:</b> ${esc(v!)}</li>`).join('')}</ul>
  <h4>Präsenz im Revier</h4><dl><dt>Kleidung</dt><dd>${esc(p.presence.clothing)}</dd><dt>Fahrzeuge</dt><dd>${esc(p.presence.vehicles.join(', '))}</dd><dt>Musik</dt><dd>${esc(p.presence.music)}</dd><dt>Tag</dt><dd>${esc(p.presence.tag.desc)} (${p.presence.tag.letters.join(' / ')})</dd><dt>Treffpunkte</dt><dd>${p.presence.hangouts.map((h) => esc(h.name)).join(', ')}</dd><dt>Streife</dt><dd>${esc(p.presence.patrol)}</dd></dl></div></div>
  <h4>Gang-Alltag</h4><div class="scen">${p.scenarios.map((s) => `<div><b>${esc(s.name)}</b><p>${esc(s.flavor)}</p>${s.lines.map((l) => `<q class="b gang">${esc(l)}</q>`).join('')}</div>`).join('')}</div>
  <h4>Reaktion auf den Spieler</h4><div class="rep">${(['archenemy', 'hostile', 'neutral', 'friendly', 'trusted'] as const).map((k) => `<div class="r-${k}"><span>${{ archenemy: 'Erzfeind', hostile: 'Feindlich', neutral: 'Neutral', friendly: 'Freundlich', trusted: 'Vertraut' }[k]}</span>${p.toPlayer[k].map((l) => `<q class="b ${k === 'archenemy' || k === 'hostile' ? 'shout' : 'gang'}">${esc(l)}</q>`).join('')}</div>`).join('')}</div>
 </article>`;
}

// Beziehungsmatrix
let matrix = '<table class="matrix"><thead><tr><th></th>' + GANG_IDS.map((g) => `<th style="--g:${hex(GANG_PROFILES[g].presence.colors[0])}">${GANG_PROFILES[g].name}</th>`).join('') + '<th>Polizei</th></tr></thead><tbody>';
for (const a of GANG_IDS) {
  matrix += `<tr><th style="--g:${hex(GANG_PROFILES[a].presence.colors[0])}">${GANG_PROFILES[a].name}</th>`;
  for (const b of GANG_IDS) {
    if (a === b) { matrix += '<td class="self">—</td>'; continue; }
    const r = gangRelation(a, b)!;
    matrix += `<td class="rel ${r.kind}" title="${esc(GANG_PROFILES[a].relations[b]!.note)}"><b>${relLabel[r.kind]}</b><span>${r.value}</span></td>`;
  }
  const pr = POLICE.relations[a]!;
  matrix += `<td class="rel ${pr.kind}" title="${esc(pr.note)}"><b>${relLabel[pr.kind]}</b><span>${pr.value}</span></td></tr>`;
}
matrix += '</tbody></table>';

const police = `<article class="police"><h3>${esc(POLICE.name)}</h3><p class="motto">„${esc(POLICE.motto.replace(/\.$/, ''))}“</p><p class="phil">${esc(POLICE.selfImage)}</p>
<div class="people">${[POLICE.chief, ...POLICE.officers].map((n) => `<div class="person"><div class="role">${esc(n.role)}</div><h5>${esc(n.name)}</h5><p>${esc(n.personality)}</p><q class="b say">${esc(n.catchphrase)}</q></div>`).join('')}</div>
<h4>Präsenz pro Viertel (Start)</h4><div class="pgrid">${Object.entries(POLICE.presence).map(([k, v]) => meter(dName(k), v!, 'cop')).join('')}</div></article>`;

// Ereignisse
let events = '';
let lastD = '';
for (const e of STREET_EVENTS) {
  if (e.district !== lastD) { events += `<h3 class="evd">${dName(e.district)}</h3>`; lastD = e.district; }
  const when = [e.when.parts?.map((p) => DAY_PART_NAMES[p]).join('/'), e.when.weather?.join('/'), e.when.weekend ? 'Wochenende' : '', e.when.traffic ? 'Stau' : '', e.when.gangInfluence ? `Gang-Einfluss ≥ ${e.when.gangInfluence.min}` : '', e.when.mood?.safety?.min != null ? `Sicherheit ≥ ${e.when.mood.safety.min}` : ''].filter(Boolean).join(' · ');
  const lines = e.phases.flatMap((p) => p.lines ?? []).slice(0, 4);
  events += `<details class="ev"><summary><span class="eid">${e.id}</span><span class="et">${esc(e.title)}</span><span class="es ${e.size}">${e.size === 'big' ? 'groß' : 'klein'}</span><span class="ew">${esc(when || 'jederzeit')}</span></summary>
  <div class="evb"><p class="small"><b>Rollen:</b> ${e.roles.map((r) => esc(r.label)).join(', ')}</p>
  <p class="small"><b>Ablauf:</b> ${e.phases.map((p) => `${p.id} (${p.dur[0]}–${p.dur[1]} s)`).join(' → ')} · <b>Gewicht</b> ${e.weight} · <b>Abklingzeit</b> ${e.cooldown} Spielmin.</p>
  <div class="bubbles">${lines.map((l) => `<q class="b ${l.style}" data-who="${esc(e.roles.find((r) => r.id === l.role)?.label ?? l.role)}">${esc(l.text)}</q>`).join('')}</div>
  ${e.interventions.length ? `<p class="small"><b>Eingreifen:</b></p><ul class="topics">${e.interventions.map((i) => { const o = e.outcomes[i.outcome]; const r = [o.money ? `+${o.money} $` : '', o.xp ? `+${o.xp} XP` : '', o.health ? `Gesundheit ${o.health === 'full' ? 'voll' : '+' + o.health}` : '', ...(o.rep ?? []).map((x) => `${x.gang === 'event_gang' ? 'Gang' : GANG_PROFILES[x.gang].name} ${x.delta > 0 ? '+' : ''}${x.delta}`), o.wanted ? `Fahndung ${o.wanted}` : '', o.fame ? `Bekanntheit +${o.fame}` : '', o.worldFlag ? 'dauerhafte Weltänderung' : ''].filter(Boolean).join(', '); return `<li>${esc(i.label)} → <b>${esc(o.label)}</b>${r ? ` <span class="rw">${esc(r)}</span>` : ''}</li>`; }).join('')}</ul>` : '<p class="small"><b>Eingreifen:</b> keins – nur zuschauen.</p>'}
  <p class="rumor"><b>Gerücht:</b> ${esc(e.rumor.text)}${e.radio ? `<br><b>Palmara Talk 740:</b> ${esc(e.radio)}` : ''}</p></div></details>`;
}

const totalLines = STREET_EVENTS.reduce((n, e) => n + e.phases.reduce((m, p) => m + (p.lines?.length ?? 0), 0), 0);
const html = `<title>Palmara Gesellschaftsdossier</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shrikhand&family=Karla:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>
/* Layout: Reisebroschüre trifft Akte – eine Spalte, Viertel als Postkarten, Gangs in ihren Farben */
:root{--bg:#fbf4ea;--paper:#fffaf3;--ink:#173a40;--muted:#5d7377;--line:#e5d8c6;--accent:#e2457a;--sea:#118f8a;--chip:#f3e6d4;
--display:'Shrikhand','Georgia',serif;--body:'Karla',system-ui,sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1a24;--paper:#16242f;--ink:#e9efe9;--muted:#9fb3b6;--line:#2a3b48;--accent:#ff5c9a;--sea:#3fd1c6;--chip:#1f3240;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0f1a24;--paper:#16242f;--ink:#e9efe9;--muted:#9fb3b6;--line:#2a3b48;--accent:#ff5c9a;--sea:#3fd1c6;--chip:#1f3240;color-scheme:dark}
body{background:var(--bg);color:var(--ink);font:16px/1.55 var(--body);padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:0 64px}
.wrap{max-width:1040px;margin:0 auto}
h1,h2,h3{text-wrap:balance}
h1{font:400 clamp(2.2rem,6vw,3.6rem)/1.05 var(--display);color:var(--accent);margin:40px 0 8px}
.lede{max-width:65ch;color:var(--muted)}
nav{position:sticky;top:env(safe-area-inset-top,0px);background:var(--bg);z-index:5;display:flex;gap:6px;flex-wrap:wrap;padding-block:12px;border-bottom:1px solid var(--line)}
body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:10;background:var(--bg)}
nav a{font:600 13px var(--mono);letter-spacing:.04em;text-transform:uppercase;color:var(--ink);text-decoration:none;padding:6px 10px;border:1px solid var(--line);border-radius:999px}
nav a:hover,nav a:focus-visible{border-color:var(--accent);color:var(--accent);outline:none}
h2{font:400 2rem var(--display);color:var(--sea);margin:48px 0 4px}
h2+p{color:var(--muted);margin-top:0;max-width:65ch}
h3{font:700 1.6rem var(--body);margin:0}
h4{font:600 12px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:18px 0 6px}
.motto{font:400 1.25rem var(--display);color:var(--accent);margin:2px 0 8px}
.phil{max-width:70ch;margin:6px 0}
.small{font-size:14px;margin:6px 0}
.vals{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.vals span{background:var(--chip);border-radius:4px;padding:2px 8px;font-size:14px;font-weight:600}
.dist,.gangcard,.police{background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:22px;margin:18px 0}
.swatches{display:flex;gap:4px;margin-bottom:10px}.swatches i{width:28px;height:8px;border-radius:2px}
.grid2{display:grid;grid-template-columns:1fr 1.3fr;gap:28px}.grid2>*{min-width:0}
@media (max-width:760px){.grid2{grid-template-columns:1fr}}
.meter{display:grid;grid-template-columns:7.5em 1fr 2.2em;align-items:center;gap:8px;font-size:14px;font-variant-numeric:tabular-nums}
.meter .bar{height:8px;background:var(--chip);border-radius:4px;overflow:hidden}.meter i{display:block;height:100%}
.meter b{text-align:right}
i.safe{background:var(--sea)}i.rich{background:#d9a227}i.gang{background:var(--accent)}i.cop{background:#4c6fd1}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px}.lbl{font-size:13px;color:var(--muted)}
.chip{font-size:13px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--c);color:#fff}
.chip.ghost{background:transparent;color:var(--ink);border:2px solid var(--c)}
ul{padding-left:18px;margin:4px 0}.res li,.topics li{margin:4px 0;font-size:14px}
.res .w{font:12px var(--mono);color:var(--muted)}.att{color:var(--muted)}
.places{font-size:14px;color:var(--sea);font-weight:600}
code{font:12px var(--mono);background:var(--chip);padding:1px 5px;border-radius:3px}
dl{display:grid;grid-template-columns:7em 1fr;gap:4px 10px;font-size:14px;margin:0}dt{color:var(--muted);font-weight:600}dd{margin:0}
.map{font:12px var(--mono);color:var(--muted);margin:14px 0 0}
.bubbles{display:flex;flex-wrap:wrap;gap:10px}
q.b{quotes:none;display:inline-block;position:relative;background:#fff;color:#1b1b1b;border:2px solid #1b1b1b;border-radius:14px;padding:6px 12px;font-size:14px;font-weight:600;max-width:34ch;margin:4px 0 10px}
q.b::after{content:"";position:absolute;left:18px;bottom:-9px;width:12px;height:12px;background:inherit;border-right:2px solid #1b1b1b;border-bottom:2px solid #1b1b1b;transform:rotate(45deg) skew(10deg,10deg)}
q.b[data-who]::before{content:attr(data-who);display:block;font:600 10px var(--mono);text-transform:uppercase;letter-spacing:.05em;color:#6a6a6a}
q.shout{border-radius:4px;border-width:3px;background:#fff6a8;font-weight:700;text-transform:uppercase;letter-spacing:.02em}
q.whisper{border-style:dashed;background:#f2f2f2;font-weight:400;font-style:italic}
q.think{border-radius:999px;background:#eef6ff}q.think::after{border-radius:50%;width:9px;height:9px;transform:none;border:2px solid #1b1b1b}
q.gang{background:var(--g,var(--accent));color:#fff;border-color:#1b1b1b}
q.sfx{background:#ffd23f;font-weight:800;border-radius:3px;transform:rotate(-2deg)}
q.symbol{background:#ffe3ef}
.gangcard{border-top:8px solid var(--g)}
.gangcard header{display:flex;gap:16px;align-items:center}
.tag{flex:none;width:64px;height:64px;border-radius:50%;display:grid;place-items:center;font:400 1.1rem var(--display);background:var(--g);color:#fff;box-shadow:inset 0 0 0 4px var(--g2)}
.gangcard .motto{color:var(--g)}
.people{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}
.person{border:1px solid var(--line);border-radius:6px;padding:12px;min-width:0}
.person.boss{border:2px solid var(--g,var(--accent))}
.person .role{font:600 11px var(--mono);text-transform:uppercase;color:var(--muted);letter-spacing:.06em}
.person h5{margin:2px 0 6px;font-size:1.1rem}.person h5 span{color:var(--muted);font-weight:600}
.person p{font-size:14px;margin:4px 0}.quirk{color:var(--muted)}
.ranks{margin-top:12px;grid-template-columns:9.5em 1fr}
.scen{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.scen>div{min-width:0}.scen p{font-size:14px;margin:2px 0 6px;color:var(--muted)}
.rep{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.rep>div{min-width:0}.rep span{display:block;font:600 11px var(--mono);text-transform:uppercase;letter-spacing:.06em}
.r-archenemy span{color:#c0392b}.r-hostile span{color:#e67e22}.r-neutral span{color:var(--muted)}.r-friendly span{color:#27ae60}.r-trusted span{color:var(--sea)}
.tablewrap{overflow-x:auto}
.matrix{border-collapse:collapse;font-size:14px;min-width:640px}
.matrix th,.matrix td{border:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}
.matrix thead th,.matrix tbody th{border-top:4px solid var(--g,var(--line))}
.matrix td b{display:block}.matrix td span{font:12px var(--mono);color:var(--muted)}
.rel.feud{background:color-mix(in srgb,#c0392b 18%,transparent)}.rel.rivalry{background:color-mix(in srgb,#e67e22 16%,transparent)}
.rel.shaky_peace{background:color-mix(in srgb,#d9a227 14%,transparent)}.rel.business{background:color-mix(in srgb,#118f8a 16%,transparent)}
.self{color:var(--muted);text-align:center}
.pgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:4px 24px}
.evd{font:400 1.4rem var(--display);color:var(--sea);margin:28px 0 6px}
.ev{border:1px solid var(--line);background:var(--paper);border-radius:6px;margin:8px 0}
.ev summary{cursor:pointer;display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;padding:10px 14px}
.ev summary:focus-visible{outline:2px solid var(--accent)}
.eid{font:600 13px var(--mono);color:var(--accent)}.et{font-weight:700}
.es{font:600 11px var(--mono);text-transform:uppercase;padding:1px 6px;border-radius:3px;background:var(--chip)}.es.big{background:var(--accent);color:#fff}
.ew{font-size:13px;color:var(--muted);margin-left:auto}
.evb{padding:0 14px 14px}.rw{font:12px var(--mono);color:var(--sea)}
.rumor{font-size:14px;border-left:3px solid var(--accent);padding-left:10px;margin:10px 0 0}
.legend{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start}
.stats{font:13px var(--mono);color:var(--muted)}
</style>
<div class="wrap">
<h1>Palmara Gesellschaftsdossier</h1>
<p class="lede">Viertel-DNA, Gang-Profile und die 45 Straßenereignisse – so wie sie jetzt als Daten im Spiel liegen. Zum Prüfen von Philosophien, Stimmen und Beispielzeilen, bevor Gesprächssystem und Fraktions-KI darauf aufbauen.</p>
<p class="stats">${DISTRICT_IDS.length} Viertel · ${GANG_IDS.length} Gangs + Polizei · ${STREET_EVENTS.length} Ereignisse · ${totalLines} Ereignis-Sprechblasen</p>
<nav><a href="#viertel">Viertel</a><a href="#gangs">Gangs</a><a href="#beziehungen">Beziehungen</a><a href="#polizei">Polizei</a><a href="#ereignisse">Ereignisse</a><a href="#blasen">Sprechblasen</a></nav>
<h2 id="viertel">Viertel-DNA</h2><p>Jedes Viertel: Motto, Werte, Bewohner mit Gewichtung, Alltag, Sorgen, Gesprächsthemen, Look und Klang, Startstimmung.</p>
${districts}
<h2 id="gangs">Gangs</h2><p>Philosophie, Hierarchie mit benannten Figuren, eigene Sprache, Präsenz im Revier, Alltag und Reaktion auf den Spieler je Rufstufe.</p>
${gangs}
<h2 id="beziehungen">Beziehungen</h2><p>Startwerte von −100 (Krieg) bis +100 (Bündnis). Sie verschieben sich später durch die Fraktions-KI und Spieleraktionen. Fahre über eine Zelle für die Begründung.</p>
<div class="tablewrap">${matrix}</div>
<h2 id="polizei">Polizei</h2>${police}
<h2 id="ereignisse">Straßenereignisse</h2><p>E01–E45, gruppiert nach Viertel. Aufklappen zeigt Rollen, Ablauf, Beispiel-Sprechblasen, Eingriffe mit Belohnung und das erzeugte Gerücht.</p>
${events}
<h2 id="blasen">Sprechblasen-Typen</h2><p>Vorschau der Stile, die das Gesprächssystem später im Spiel zeichnet.</p>
<div class="legend">${(['say', 'shout', 'whisper', 'think', 'gang', 'symbol', 'sfx'] as const).map((s) => `<q class="b ${s}" data-who="${styleLabel[s]}">${{ say: 'Schöner Tag, was?', shout: 'NICHT DIE CHILI-CHEESE!', whisper: 'Leise… mach auf.', think: 'Nur ein Balken Empfang…', gang: 'Bleib strahlend, Darling.', symbol: '♥', sfx: 'PLATSCH!' }[s]}</q>`).join('')}</div>
</div>`;
writeFileSync(out, html);
console.log('ok', html.length);
