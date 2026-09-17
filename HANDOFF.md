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

PR #14 zavedl date-native Calendar Foundation. PR #15/#17 vrátily motivační odpočty a jejich původní Dayframe vizuál. PR #18 zlepšil čitelnost Týdne, PR #19 opravil grab-point drag/drop, PR #20 sjednotil přesnou časovou geometrii a změnil oběd na měkkou preferenci. **PR #21 odstranil z produktu celý koncept zamykání bloků.**

Hlavní soubory:

| Soubor | Úloha |
| --- | --- |
| `web/app/dayframe-v2.tsx` | Aktivní UI, sdílený stav, week drag/snap, editor a hlavní views |
| `web/app/dayframe-v2.css` | Základní aktivní design a responsivita |
| `web/app/dayframe-countdowns.css` | Motivační odpočet dne a termínů |
| `web/app/week-calendar-polish.css` | Čitelnost time-gridu, přesná geometrie slotů a drop preview |
| `web/lib/dayframe-calendar.ts` | Schema 5, migrace, date-native plány, rutiny, planner, soft lunch preference a moveTask |
| `web/lib/dayframe-calendar.test.mjs` | Regresní testy kalendářového modelu |
| `web/lib/dayframe-countdown.ts` | Výpočet konce dne 00:30 a dní do milníků |
| `web/e2e/dayframe-calendar.spec.mjs` | Browser smoke včetně geometrie a reálného drag/drop scénáře |
| `web/lib/dayframe-smart-input.ts` | Volitelný deterministický smart input |
| `web/app/page.tsx` | Framework mount; musí načíst všechny aktivní CSS soubory |
| `web/preview/main.tsx` | Statický Vercel preview mount; musí načíst stejné CSS jako framework build |

Storage key zůstává `dayframe-v1`, formát je `schema: 5`.

## Produktové chování

### Dnes

`Dnes` je execution view. Má odpovědět hlavně na: kolik času zbývá do konce dne, jak blízko je nejbližší důležitý termín, co dělat teď, co následuje a zda plán vyžaduje rozhodnutí.

Nedokončený minulý blok se **nikdy automaticky nepřenáší**. Uživatel volí `Hotovo / Na zítra / Zrušit`.

### Motivační odpočty — core feature

Odpočty nejsou dekorace a nesmí se při zjednodušování odstranit nebo vizuálně degradovat.

- živý `HH:MM:SS` odpočet `Do konce dne`;
- hranice osobního dne je **00:30**;
- progress ruler 09 → 12 → 15 → 18 → 21 → 00:30;
- velký monospace hlavní čas;
- výrazný odpočet dní k nejbližšímu milníku;
- hodiny se aktualizují každou sekundu.

### Týden

Týden je hlavní plánovací plocha:

- Po–Ne jako skutečný časový grid;
- každý den používá skutečná date-native data;
- `+` v dni otevře přidání na konkrétní datum;
- kliknutí na blok otevře společný editor;
- drag & drop mezi dny/časy je podporovaný;
- oběd 13:00–14:00 je **měkká preference**: auto-planner ho obchází, ruční čas nebo drag/drop ho smí použít;
- `Přepočítat týden` optimalizuje pouze práci, která nemá ručně zvolený den/čas.

#### Geometrické invarianty

- stejné `MINUTE_HEIGHT` řídí hour lines, pozici i výšku task karet;
- 60min karta přesně vyplní interval mezi dvěma hodinovými čárami;
- výška karty je `duration × MINUTE_HEIGHT`, bez vizuálního minima;
- krátké bloky zmenšují množství textu, ne svoji časovou přesnost;
- `Čtení knihy` 22:40–23:00 musí být celé viditelné a zabírat skutečných 20 minut;
- hour labels se na desktopu neopakují sedmkrát.

#### Drag/drop po PR #21 — bez zamykání

- **Neexistuje už žádný uživatelský koncept `zamknutý/flexibilní`.**
- Nezobrazují se lock ikony, lock glyphy, `zamknuto` notice ani fixed/flex metadata.
- Blok při tažení zachovává přesné místo úchopu a snapuje po 15 minutách.
- Při kolizi se hledá pouze nejbližší validní slot do ±60 minut.
- Drop preview ukazuje přesný výsledný čas bez zámku.
- Ručně přesunutý blok si uchová zvolený den a čas, ale interně zůstává `mode: flexible`; ruční čas je reprezentovaný přes `requestedStart`, `dateLocked` a `autoScheduled: false`.
- Staré schema-5 bloky s `mode: fixed` se při migraci normalizují na lockless model bez ztráty zvoleného času.
- Editor už nemá přepínač režimu. Obsahuje jen `Začátek`; prázdná hodnota znamená, že Dayframe najde volný čas automaticky.
- Ručně zadaný nebo přetažený čas může použít oběd 13:00–14:00.

### Přidat úkol

Základ vyžaduje jen název. Rychlá ruční nastavení: den, délka, `Začít v`, priorita. Další podrobnosti jsou schované.

Smart input je pouze volitelné zrychlení. Ruční pole mají vždy přednost.

### Rutiny

Rutiny se materializují do reálných datovaných bloků. Např. `Čtení knihy` je denní rutina v 22:40. V Nastavení je lze aktivovat/deaktivovat nebo smazat; nová rutina vzniká přes Přidat úkol → Opakování.

### Focus

Focus zůstává záměrně jednoduchý: jeden aktivní úkol a 50min timer. Tmavý režim je vyhrazen focusu.

## Poslední ověřené změny

### PR #20 — exact week geometry + soft lunch
Merge: `c687032a99635e098768b653ee232b4d74307d37`.

- přesná time-grid geometrie;
- žádné 30px minimum tasku;
- auto-planner obchází oběd, ruční placement ho může použít;
- TypeScript, regresní testy, static preview build a Playwright PASS;
- Vercel deployment `success`.

### PR #21 — remove task locking
Merge: `fbb614f8e6de4095c1358a28ddaac99367a28c12`.

Změny:
- odstraněny lock ikony a fixed/flex vizuální režimy;
- odstraněny texty `zamknuto`, `Zamknutý čas`, `Flexibilní čas`;
- editor má jen volitelný `Začátek`;
- drag/drop už nevytváří `mode: fixed`, ale zachová ručně zvolený den/čas;
- schema-5 fixed stav se nedestruktivně normalizuje na lockless model;
- `Přepočítat týden` dál respektuje ručně zadaný den/čas;
- unit testy i Playwright byly přepsány tak, aby přímo ověřovaly absenci lock UI a zachování výsledného času po drag/drop.

Ověření PR #21: TypeScript PASS, regresní testy PASS, static preview build PASS, Playwright browser smoke PASS. Produkční Vercel deployment merge commitu `fbb614f8...` skončil `success`.

CI workflow `.github/workflows/preview-build.yml` automaticky spouští typecheck, regresní testy, build a browser smoke.

## Produktové principy

- Málo textu, vysoká čitelnost.
- **Motivační odpočty jsou core feature.**
- Týden nesmí být datově ani vizuálně přehuštěný.
- Časový grid musí být geometricky pravdivý.
- Oběd je preference pro auto-planner, ne tvrdý zákaz.
- Drag/drop musí být předvídatelný: držet grab point, snapovat po 15 min, neházet blok daleko při kolizi.
- **Nepoužívat koncept zamykání bloků.** Ručně zadaný den/čas se prostě respektuje.
- Smart input není povinný a ruční zadávání musí být vždy dostupné.
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
2. Pracuj primárně v `web/app/dayframe-v2.tsx`, `web/lib/dayframe-calendar.ts` a aktivních CSS souborech.
3. Zachovej migraci `dayframe-v1` a data uživatele.
4. Zachovej prominentní odpočet do 00:30 i odpočty k důležitým termínům.
5. U nového CSS zkontroluj import v `page.tsx` i `web/preview/main.tsx`.
6. Každou větší změnu pokryj unit testem nebo Playwright scénářem.
7. U drag/drop změn browser test musí ověřit skutečný drop a výsledný čas; **nevracet lock UI**.
8. U time-grid změn testuj bounding-box rozměry proti hour lines.
9. Po merge ověř Vercel status a až pak tvrdíš, že `https://dayframe2.vercel.app` obsahuje změnu.
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