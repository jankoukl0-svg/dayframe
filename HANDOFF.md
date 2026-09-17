# Dayframe — začni tady

Aktualizováno: 17. 9. 2026.

## Kontext

Dayframe je osobní plánovací a focus aplikace. UX má být krátké, klidné a praktické: uživatel může napsat jen název úkolu, Dayframe navrhne čas, ale den, délku, prioritu a konkrétní začátek lze vždy nastavit ručně.

Repo: `jankoukl0-svg/dayframe`  
Výchozí větev: `main`  
Vývojový Vercel: https://dayframe2.vercel.app  
Sites náhled: https://dayframe-focus.honza-koukl1.chatgpt.site — **není automaticky napojený na GitHub**.

GitHub → Vercel je zapojené. Projekt `dayframe2` používá Root Directory `web` a push do `main` automaticky deployuje stálý URL výše.

## Aktuální architektura — Calendar Foundation

PR #14 (`feature/calendar-foundation-v2`) nahradil původní today/tomorrow/waiting model datovým modelem podle skutečného data. PR #15 vrátil motivační odpočty. PR #17 obnovil jejich původní vizuální hierarchii a opravil chybějící CSS import ve Vercel preview. PR #18 opravil přehuštěný a ořezaný týdenní kalendář.

Hlavní soubory:

| Soubor | Úloha |
| --- | --- |
| `web/app/dayframe-v2.tsx` | Aktivní UI a sdílený aplikační stav |
| `web/app/dayframe-v2.css` | Základní aktivní design a responsivita |
| `web/app/dayframe-countdowns.css` | Motivační odpočet dne a termínů; zachovává původní Dayframe vizuální hierarchii |
| `web/app/week-calendar-polish.css` | Čitelnost skutečného týdenního time-gridu, clipping, adaptivní obsah karet |
| `web/lib/dayframe-calendar.ts` | Schema 5, migrace, date-native plány, rutiny, planner, drag/drop logika |
| `web/lib/dayframe-calendar.test.mjs` | Regresní testy kalendářového modelu |
| `web/lib/dayframe-countdown.ts` | Výpočet konce dne 00:30 a dní do milníků |
| `web/lib/dayframe-countdown.test.mjs` | Regresní testy odpočtů včetně DST hran |
| `web/e2e/dayframe-calendar.spec.mjs` | Browser smoke přes skutečné UI včetně vizuálních invariantů |
| `web/lib/dayframe-smart-input.ts` | Volitelný deterministický smart input |
| `web/app/page.tsx` | Framework mount; musí načíst všechny aktivní CSS soubory |
| `web/preview/main.tsx` | Statický Vercel preview mount; musí explicitně načíst stejné CSS jako framework build |

Staré DOM bridge komponenty (`dayframe-app`, starý week calendar, capture start/result bridge, missed-task bridge a jejich CSS workaroundy) byly z aktivní větve odstraněny. Nový Týden nepoužívá simulované DOM klikání ani technické `[[date:...]]` tokeny.

## Data a migrace

Storage key zůstává `dayframe-v1`, nový formát je `schema: 5`.

- `plans[YYYY-MM-DD]` obsahuje skutečné úkoly konkrétního dne;
- `routines` jsou samostatné opakovací definice;
- `backlog` drží práci, kterou se nepodařilo umístit;
- `routineSkips` chrání uživatelské výjimky z rutin;
- schema 4 se při prvním načtení nedestruktivně migruje do schema 5;
- staré technické date/start tokeny se při migraci vyčistí z názvů.

## Produktové chování

### Dnes

`Dnes` je execution view, ne druhý kalendář. Primárně odpovídá na:

1. Kolik času zbývá do konce osobního dne.
2. Jak blízko je nejbližší důležitý termín.
3. Co dělat teď.
4. Co následuje.
5. Jestli plán potřebuje rozhodnutí.

Nedokončený minulý blok se **nikdy automaticky nepřenáší**. Uživatel volí `Hotovo / Na zítra / Zrušit`.

### Motivační odpočty — core feature

Odpočty nejsou dekorace. Jsou součást hlavní motivace Dayframe a **nesmí se při zjednodušování UI odstranit ani vizuálně degradovat na generické dashboard karty**.

- Dnes nahoře je živý `HH:MM:SS` odpočet `Do konce dne`.
- Hranice osobního dne je **00:30**; planner má oddělené pracovní okno 10:00–22:30.
- Pod časem je tenký progress ruler 09 → 12 → 15 → 18 → 21 → 00:30 s cihlovým akcentem.
- Hlavní čas má být velký monospace údaj jako v původním Dayframe.
- Nejbližší budoucí milník má výrazný velký počet zbývajících dní; kliknutí otevře Milníky.
- V Milnících má každý termín vlastní počet zbývajících dní.
- Hodiny v UI se aktualizují každou sekundu.
- `web/preview/main.tsx` musí explicitně importovat `dayframe-countdowns.css`.

### Týden

Týden je hlavní plánovací plocha:

- Po–Ne jako skutečný časový grid;
- každý den používá skutečná date-native data;
- `+` v dni otevře přidání rovnou na tento den;
- kliknutí na blok otevře společný editor;
- pevné a flexibilní bloky jsou vizuálně i datově odlišné;
- oběd 13:00–14:00 je chráněný;
- drag & drop mezi dny/časy je podporovaný;
- ruční drag na konkrétní čas z úkolu udělá pevný blok;
- `Přepočítat týden` přeskládá pohyblivé flexibilní úkoly podle priority a termínů, aniž by hýbal pevnými/date-locked bloky.

#### Týden — vizuální invarianty po PR #18

- Time-grid musí zůstat skutečný, ale čitelnost má přednost před zobrazováním každé metadata věty.
- Hour labels se nemají opakovat sedmkrát; v desktop gridu je viditelná jedna časová škála.
- Krátké bloky zobrazují jen tolik obsahu, kolik se do nich skutečně vejde; režim fixed/flex se pozná hlavně z borderu.
- Žádná task karta nesmí být vertikálně oříznutá svým `.df2-time-body`.
- Denní rutina `Čtení knihy` 22:40–23:00 musí být celá viditelná, přestože planner jinou práci automaticky neplánuje po 22:30.
- `week-calendar-polish.css` musí být importovaný jak v `page.tsx`, tak v `web/preview/main.tsx`.

### Přidat úkol

Základ vyžaduje jen název. Rychlá ruční nastavení: den, délka, `Začít v`, priorita. Další podrobnosti jsou schované: dokončit do, nejpozdější čas, oblast a opakování.

Smart input zůstává pouze volitelné zrychlení (`zeměpis 20 min`, `Matematika v 17:30 na 60 minut` atd.). Přesné ruční datum a start jsou datová pole, ne textové tokeny.

Když uživatel neurčí den, planner hledá místo přes celý následující týden a respektuje pracovní okno 10:00–22:30, oběd, existující bloky, přesný start, prioritu a due date/deadline.

### Rutiny

Původní hardcoded týdenní šablona byla převedena na opakovací rutiny. Např. `Čtení knihy` je denní rutina v 22:40. Rutiny se materializují do reálných datovaných bloků. V Nastavení je lze aktivovat/deaktivovat nebo smazat; nová rutina vzniká přes Přidat úkol → Opakování.

### Focus

Focus zůstává záměrně jednoduchý: jeden aktivní úkol a 50min timer. Tmavý režim je vyhrazen focusu.

## Poslední ověřené změny

### PR #14 — Calendar foundation
Merge: `6dcc57bc77e3f6e6691fa5af4cb6f92b172de2ab`.

- date-native schema 5;
- skutečný interaktivní týden;
- rutiny, week planner, drag/drop;
- TypeScript, regresní testy, build a Playwright prošly.

### PR #15 — restore countdowns
Merge: `9365d68335f80c2d9ddabb6198fa92b147bd5df1`.

- obnoven živý odpočet do 00:30;
- obnoven odpočet k nejbližšímu milníku;
- odpočty dní v Milnících;
- helpery + regresní testy pro 00:30 a DST.

### PR #17 — restore original countdown visual
Merge: `66827c5f586eee0dd5f8732aaabe74c794818e78`.

- Vercel preview začal skutečně načítat countdown stylesheet;
- odpočet dne používá původní Dayframe hierarchii: transparentní plocha, velký monospace čas, menší cihlové sekundy, 2px ruler;
- browser smoke kontroluje i computed CSS, ne jen text.

### PR #18 — week calendar readability and clipping
Merge: `da6139db1bdeb6885c323ef3dd1132e85a9ca1ef`.

Příčina: week grid byl příliš hustý; 60min bloky měly jen ~43 px výšky, metadata se řezala a pevná výška 562 px vždy ořízla rutinu 22:40–23:00.

Změny:
- širší a klidnější týdenní grid;
- pouze jedna viditelná sada hodinových labelů místo sedmi;
- adaptivní obsah task karet podle jejich výšky;
- metadata fixed/flex nejsou opakována v každé malé kartě, režim je rozlišitelný borderem;
- `.df2-time-body` má dost prostoru i pro celý blok 22:40–23:00;
- date-native planner ani drag/drop časová matematika nebyly změněny;
- Playwright kontroluje, že všechny task karty zůstávají uvnitř denního body a jejich obsah není ořezaný.

Ověření PR #18: TypeScript PASS, regresní testy PASS, static preview build PASS, Playwright browser smoke PASS. Produkční Vercel deployment merge commitu `da6139db...` skončil `success`.

CI workflow `.github/workflows/preview-build.yml` automaticky spouští typecheck, regresní testy, build a browser smoke.

## Produktové principy

- Málo textu, vysoká čitelnost.
- **Motivační odpočty jsou core feature, musí zůstat prominentní a v původním Dayframe vizuálním jazyku.**
- Týden nesmí být datově nebo vizuálně přehuštěný; zobrazovat jen informace potřebné pro plánování.
- Smart input není povinný.
- Ruční zadávání musí být vždy dostupné.
- Pevný blok Dayframe svévolně nepřesouvá.
- Flexibilní práce se může optimalizovat.
- Nedokončené úkoly nesnowballují automaticky.
- Týden = plánování, Dnes = vykonávání.
- GitHub `main` je source of truth.

## Co stále není hotové

- Cloud účet/synchronizace mezi zařízeními.
- Windows Tauri integrace a systémové blokování rušivých aplikací.
- iOS klient.
- Obecný LLM/NLP planner; smart input je deterministický.

## Jak pokračovat

1. Vždy načti aktuální `main` před editací.
2. Pracuj primárně v `web/app/dayframe-v2.tsx`, `web/lib/dayframe-calendar.ts` a příslušných aktivních CSS souborech.
3. Zachovej migraci `dayframe-v1` a data uživatele.
4. Zachovej prominentní odpočet do 00:30 i odpočty do důležitých termínů a jejich původní vizuální hierarchii.
5. U nového CSS vždy zkontroluj import jak v `page.tsx`, tak v `web/preview/main.tsx`.
6. Každou větší změnu pokryj unit testem nebo Playwright scénářem; u vizuálně zásadních prvků kontroluj computed style / bounding boxes, ne jen přítomnost textu.
7. Po merge ověř Vercel produkční status a až pak tvrdíš, že `https://dayframe2.vercel.app` obsahuje změnu.
8. Sites je oddělený a automaticky se neaktualizuje.

### Handoff zpět do Work

```text
DAYFRAME — ZPĚTNÉ PŘEDÁNÍ
Repo: jankoukl0-svg/dayframe
Větev / PR:
Výchozí SHA → výsledný SHA:
Co uživatel schválil:
Co se skutečně změnilo a v jakých souborech:
Co zůstalo jen návrhem:
Změny dat a migrace:
Testy: PASS / FAIL / NEPROVEDENO + přesný rozsah:
Nasazení: ANO / NE + důkaz, pokud ano:
Známé chyby a rizika:
Co má Work zhodnotit nebo dodělat:
Jeden doporučený další krok:
```
