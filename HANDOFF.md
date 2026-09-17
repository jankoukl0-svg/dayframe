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

PR #14 (`feature/calendar-foundation-v2`) nahradil původní today/tomorrow/waiting model datovým modelem podle skutečného data. PR #15 vrátil motivační odpočty, které jsou produktově zásadní a nesmí se při dalším zjednodušování odstranit.

Hlavní soubory:

| Soubor | Úloha |
| --- | --- |
| `web/app/dayframe-v2.tsx` | Aktivní UI a sdílený aplikační stav |
| `web/app/dayframe-v2.css` | Aktivní design a responsivita |
| `web/app/dayframe-countdowns.css` | Motivační odpočet dne a termínů |
| `web/lib/dayframe-calendar.ts` | Schema 5, migrace, date-native plány, rutiny, planner, drag/drop logika |
| `web/lib/dayframe-calendar.test.mjs` | Regresní testy kalendářového modelu |
| `web/lib/dayframe-countdown.ts` | Výpočet konce dne 00:30 a dní do milníků |
| `web/lib/dayframe-countdown.test.mjs` | Regresní testy odpočtů včetně DST hran |
| `web/e2e/dayframe-calendar.spec.mjs` | Browser smoke test přes skutečné UI |
| `web/lib/dayframe-smart-input.ts` | Volitelný deterministický smart input |
| `web/app/page.tsx` | Mountuje pouze `DayframeV2` |
| `web/preview/main.tsx` | Statický Vercel/GitHub preview také mountuje pouze `DayframeV2` |

Staré DOM bridge komponenty (`dayframe-app`, starý week calendar, capture start/result bridge, missed-task bridge a jejich CSS workaroundy) byly z aktivní větve odstraněny. Nový Týden nepoužívá simulované DOM klikání ani technické `[[date:...]]` tokeny pro komunikaci mezi obrazovkami.

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

1. Kolik času ještě zbývá do konce dne.
2. Jak blízko je nejbližší důležitý termín.
3. Co dělat teď.
4. Co následuje.
5. Jestli plán potřebuje rozhodnutí.

Nedokončený minulý blok se **nikdy automaticky nepřenáší**. Uživatel volí `Hotovo / Na zítra / Zrušit`.

### Motivační odpočty — core feature

Odpočty nejsou dekorace. Jsou součástí hlavní motivace Dayframe a **nesmí se při zjednodušování UI odstranit**.

- Dnes nahoře zobrazuje živý `HH:MM:SS` odpočet `Do konce dne`.
- Hranice osobního dne je **00:30**. Po 00:30 se odpočet přepne na následující 00:30.
- Pod časem je vizuální progress ruler 09 → 12 → 15 → 18 → 21 → 00:30.
- Vedle je vždy nejbližší budoucí milník a počet zbývajících dní; kliknutí otevře Milníky.
- V obrazovce Milníky má každý termín vlastní počet zbývajících dní.
- Planner může práci plánovat jen v okně 10:00–22:30; to je jiné pravidlo než motivační konec dne 00:30.
- Hodiny v UI se aktualizují každou sekundu.

### Týden

Týden je hlavní plánovací plocha:

- Po–Ne jako skutečný časový grid;
- každý den používá skutečná date-native data;
- `+` v dni otevře přidání rovnou na tento den;
- kliknutí na blok otevře společný editor;
- editace/smazání nepoužívá DOM bridge;
- pevné bloky a flexibilní bloky jsou vizuálně i datově odlišné;
- oběd 13:00–14:00 je chráněný;
- drag & drop mezi dny/časy je podporovaný;
- ruční drag na konkrétní čas z úkolu udělá pevný blok;
- `Přepočítat týden` přeskládá pohyblivé flexibilní úkoly podle priority a termínů, aniž by hýbal pevnými/date-locked bloky.

### Přidat úkol

Základ vyžaduje jen název. Rychlá ruční nastavení jsou vidět jako kompaktní pole/chips: den, délka, `Začít v`, priorita. Další podrobnosti jsou schované: dokončit do, nejpozdější čas, oblast a opakování.

Smart input zůstává pouze volitelné zrychlení (`zeměpis 20 min`, `Matematika v 17:30 na 60 minut` atd.). Přesné ruční datum a start se ukládají jako datová pole, ne jako textové tokeny.

Když uživatel neurčí den, planner hledá místo přes celý následující týden a respektuje pracovní okno 10:00–22:30, oběd 13:00–14:00, existující bloky, přesný start, prioritu a due date/deadline.

### Rutiny

Původní hardcoded týdenní šablona byla převedena na opakovací rutiny. Např. `Čtení knihy` je denní rutina v 22:40. Rutiny se materializují do reálných datovaných bloků. V Nastavení je lze aktivovat/deaktivovat nebo smazat; nová rutina vzniká přes Přidat úkol → Opakování.

### Focus

Focus zůstává záměrně jednoduchý: jeden aktivní úkol a 50min timer. Tmavý režim je vyhrazen focusu.

## Poslední ověřené změny

### PR #14 — Calendar foundation

Merge: `6dcc57bc77e3f6e6691fa5af4cb6f92b172de2ab`.

Před merge prošlo:
- TypeScript — PASS;
- 28/28 Node regresních testů — PASS;
- statický preview build — PASS;
- Playwright Chromium browser smoke — PASS;
- Vercel preview — SUCCESS.

### PR #15 — restore countdowns

Merge: `9365d68335f80c2d9ddabb6198fa92b147bd5df1`.

Změny:
- obnoven živý odpočet do 00:30;
- obnoven odpočet k nejbližšímu milníku;
- počet dní přidán i ke každému milníku;
- přidány čisté helpery a testy pro 00:30 a DST;
- browser smoke nově ověřuje, že oba odpočty v Dnes skutečně renderují.

Ověření PR i následného `main` push workflow: TypeScript PASS, regresní testy PASS, build PASS, Playwright browser smoke PASS. Produkční Vercel deployment commitu `9365d683...` skončil `success`.

CI workflow `.github/workflows/preview-build.yml` spouští automaticky typecheck, regresní testy, build a browser smoke.

## Produktové principy

- Málo textu, vysoká čitelnost.
- **Motivační odpočty jsou core feature a musí zůstat prominentní.**
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
2. Pracuj primárně v `web/app/dayframe-v2.tsx` a `web/lib/dayframe-calendar.ts`.
3. Zachovej migraci `dayframe-v1` a data uživatele.
4. Zachovej prominentní odpočet do 00:30 i odpočty do důležitých termínů.
5. Každou větší změnu pokryj unit testem nebo Playwright scénářem.
6. Po merge ověř Vercel produkční status a až pak tvrdíš, že `https://dayframe2.vercel.app` obsahuje změnu.
7. Sites je oddělený a automaticky se neaktualizuje.

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
