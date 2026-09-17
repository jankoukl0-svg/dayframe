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

PR #14 (`feature/calendar-foundation-v2`) nahradil původní today/tomorrow/waiting model datovým modelem podle skutečného data. PR #15 vrátil motivační odpočty. PR #17 obnovil jejich původní vizuální hierarchii a opravil chybějící CSS import ve Vercel preview. PR #18 opravil přehuštěný a ořezaný týdenní kalendář. PR #19 opravil logiku drag/drop: blok už při tažení neskáče pod kurzorem, snapuje se předvídatelně a ruční drop explicitně zamyká čas. PR #20 sjednotil skutečnou časovou geometrii Týdne a změnil oběd na měkkou preferenci místo tvrdě zakázaného intervalu.

Hlavní soubory:

| Soubor | Úloha |
| --- | --- |
| `web/app/dayframe-v2.tsx` | Aktivní UI, sdílený aplikační stav, week drag/snap/lock interakce a přesná time-grid geometrie |
| `web/app/dayframe-v2.css` | Základní aktivní design a responsivita |
| `web/app/dayframe-countdowns.css` | Motivační odpočet dne a termínů; zachovává původní Dayframe vizuální hierarchii |
| `web/app/week-calendar-polish.css` | Čitelnost time-gridu, přesné sloty, adaptivní obsah karet, lock/drop preview |
| `web/lib/dayframe-calendar.ts` | Schema 5, migrace, date-native plány, rutiny, planner, soft lunch preference, validace a moveTask |
| `web/lib/dayframe-calendar.test.mjs` | Regresní testy kalendářového modelu včetně lunch preference |
| `web/lib/dayframe-countdown.ts` | Výpočet konce dne 00:30 a dní do milníků |
| `web/lib/dayframe-countdown.test.mjs` | Regresní testy odpočtů včetně DST hran |
| `web/e2e/dayframe-calendar.spec.mjs` | Browser smoke přes skutečné UI včetně geometrie slotů a reálného drag/drop lock scénáře |
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
- zamknuté a flexibilní bloky jsou vizuálně i datově odlišné;
- oběd 13:00–14:00 je **měkká preference**: auto-planner ho obchází, ale ruční čas nebo drag/drop ho smí použít;
- drag & drop mezi dny/časy je podporovaný;
- `Přepočítat týden` přeskládá pohyblivé flexibilní úkoly podle priority a termínů, aniž by hýbal zamknutými/date-locked bloky.

#### Týden — vizuální invarianty po PR #18 a #20

- Time-grid musí zůstat skutečný, ale čitelnost má přednost před zobrazováním každé metadata věty.
- Hour labels se nemají opakovat sedmkrát; v desktop gridu je viditelná jedna časová škála.
- **Geometrie musí být matematicky konzistentní:** stejné `MINUTE_HEIGHT` řídí hour lines, pozici i výšku task karet. 60min karta musí přesně vyplnit interval mezi dvěma hodinovými čárami.
- Výška karty je `duration × MINUTE_HEIGHT`; nesmí existovat vizuální minimum, které by krátký blok prodlužovalo do dalšího časového slotu.
- Krátké bloky zmenšují množství textu podle dostupné výšky, nikoli skutečnou časovou geometrii.
- Žádná task karta nesmí být vertikálně oříznutá svým `.df2-time-body`.
- Denní rutina `Čtení knihy` 22:40–23:00 musí být celá viditelná a zabírat skutečných 20 minut.
- Oběd je v gridu jen jemně vizuálně označený, nesmí překrývat ručně umístěnou kartu ani se chovat jako hard collision.
- `week-calendar-polish.css` musí být importovaný jak v `page.tsx`, tak v `web/preview/main.tsx`.

#### Týden — drag/drop a lock po PR #19/#20

- Blok při tažení zachovává přesné místo úchopu; kurzor už neurčuje automaticky horní hranu bloku.
- Návrh startu snapuje po 15 minutách.
- Pokud je přesný slot obsazený, Dayframe hledá pouze nejbližší volný slot do ±60 minut; blok nesmí bezdůvodně odletět na vzdálenou část dne.
- Během dragování je vidět ghost/drop preview s přesným časem, který se po puštění zamkne.
- Ruční drop vždy nastaví `mode: fixed`, `requestedStart`, `dateLocked: true` a `autoScheduled: false`; tím se blok stává zamknutým.
- Zamknutý blok má jemný lock glyph v kartě.
- Editor používá pojmy `Zamknutý čas` a `Flexibilní čas`; odemknutí se dělá změnou režimu v editoru.
- Pokud poblíž není validní slot kvůli skutečné kolizi s jiným taskem nebo hranici dne, drop se neprovede a původní blok zůstane na místě.
- Ruční drag může použít 13:00–14:00; lunch preference se aplikuje jen na automatické hledání slotu.

### Přidat úkol

Základ vyžaduje jen název. Rychlá ruční nastavení: den, délka, `Začít v`, priorita. Další podrobnosti jsou schované: dokončit do, nejpozdější čas, oblast a opakování.

Smart input zůstává pouze volitelné zrychlení (`zeměpis 20 min`, `Matematika v 17:30 na 60 minut` atd.). Přesné ruční datum a start jsou datová pole, ne textové tokeny.

Když uživatel neurčí den, planner hledá místo přes celý následující týden a respektuje pracovní okno 10:00–22:30, existující bloky, přesný start, prioritu a due date/deadline. Automatický planner preferenčně vynechává 13:00–14:00, ale explicitní ruční start může tento interval použít.

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
- date-native planner nebyl změněn;
- Playwright kontroluje, že všechny task karty zůstávají uvnitř denního body a jejich obsah není ořezaný.

Ověření PR #18: TypeScript PASS, regresní testy PASS, static preview build PASS, Playwright browser smoke PASS. Produkční Vercel deployment merge commitu `da6139db...` skončil `success`.

### PR #19 — logical drag locking
Merge: `08279d70f0a4cac110488ec00fbbf9476de300dd`.

Příčina: starý drop převáděl přímo `event.clientY` na nový začátek, takže blok při chycení uprostřed skočil tak, aby kurzor představoval jeho horní hranu. Působilo to jako nelogické „nalepování“.

Změny:
- drag si ukládá offset místa úchopu uvnitř bloku;
- drop start = kurzor mínus grab offset, následně 15min snap;
- při kolizi se hledá pouze blízký validní slot do ±60 min;
- live drop preview předem ukazuje čas, který bude zamknutý;
- ruční drop explicitně zamyká blok;
- fixed karty mají jemný lock glyph;
- editor používá `Zamknutý čas / Flexibilní čas`;
- Playwright reálně přetáhne `CFI / Excel`, kontroluje očekávaný snap na 18:00, lock glyph a fixed hodnotu editoru.

Ověření PR #19: TypeScript PASS, regresní testy PASS, static preview build PASS, Playwright browser smoke PASS. Produkční Vercel deployment merge commitu `08279d70...` skončil `success`.

### PR #20 — exact week geometry + soft lunch
Merge: `c687032a99635e098768b653ee232b4d74307d37`.

Příčina: time-grid měl skutečné pozice v násobcích 0.72 px/min, ale vizuální background grid používal střídavých 43/44 px a task karta měla minimum 30 px. To způsobovalo optické posuny a krátké bloky byly delší než jejich skutečný čas. Oběd byl zároveň implementovaný jako tvrdá kolize i pro ruční přesun.

Změny:
- hour lines jsou skutečné absolutně pozicované čáry ze stejné matematiky jako tasky;
- výška tasku a drop preview je přesně `duration × MINUTE_HEIGHT`, bez 30px minima;
- 60min task je v browser testu porovnán s přesnou vzdáleností mezi dvěma hodinovými čarami;
- krátké tasky zmenšují obsah místo toho, aby zvětšovaly kartu;
- `canPlaceAt` už oběd neblokuje;
- `findSlot` oběd nadále vynechává pouze při automatickém plánování;
- explicitní start, editor i drag/drop mohou plánovat 13:00–14:00;
- přidány regresní testy pro auto-avoid lunch i manual lunch placement.

Ověření PR #20: TypeScript PASS, **33/33** regresních testů PASS, static preview build PASS, Playwright browser smoke PASS. Produkční Vercel deployment merge commitu `c687032a...` skončil `success`.

CI workflow `.github/workflows/preview-build.yml` automaticky spouští typecheck, regresní testy, build a browser smoke.

## Produktové principy

- Málo textu, vysoká čitelnost.
- **Motivační odpočty jsou core feature, musí zůstat prominentní a v původním Dayframe vizuálním jazyku.**
- Týden nesmí být datově nebo vizuálně přehuštěný; zobrazovat jen informace potřebné pro plánování.
- Časový grid musí být geometricky pravdivý: vizuální velikost bloku odpovídá jeho skutečné délce.
- Oběd je preference pro auto-planner, nikoli tvrdý zákaz pro uživatele.
- Drag/drop musí být předvídatelný: držet grab point, snapovat po 15 min, neházet blok daleko při kolizi.
- Ručně položený blok je explicitně zamknutý, dokud ho uživatel neodemkne.
- Smart input není povinný.
- Ruční zadávání musí být vždy dostupné.
- Zamknutý blok Dayframe svévolně nepřesouvá.
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
7. U drag/drop změn browser test musí ověřit reálný drop, výsledný čas a locked/flexible stav.
8. U time-grid změn testuj skutečné bounding-box rozměry proti hour lines; vizuální minimum nesmí deformovat délku tasku.
9. Po merge ověř Vercel produkční status a až pak tvrdíš, že `https://dayframe2.vercel.app` obsahuje změnu.
10. Sites je oddělený a automaticky se neaktualizuje.

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
