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

PR #14 (`feature/calendar-foundation-v2`) nahrazuje původní today/tomorrow/waiting model datovým modelem podle skutečného data.

Hlavní soubory:

| Soubor | Úloha |
| --- | --- |
| `web/app/dayframe-v2.tsx` | Aktivní UI a sdílený aplikační stav |
| `web/app/dayframe-v2.css` | Aktivní design a responsivita |
| `web/lib/dayframe-calendar.ts` | Schema 5, migrace, date-native plány, rutiny, planner, drag/drop logika |
| `web/lib/dayframe-calendar.test.mjs` | Regresní testy nového kalendářového modelu |
| `web/e2e/dayframe-calendar.spec.mjs` | Browser smoke test přes skutečné UI |
| `web/lib/dayframe-smart-input.ts` | Volitelný deterministický smart input |
| `web/app/page.tsx` | Mountuje pouze `DayframeV2` |
| `web/preview/main.tsx` | Statický Vercel/GitHub preview také mountuje pouze `DayframeV2` |

Staré DOM bridge komponenty (`dayframe-app`, starý week calendar, capture start/result bridge, missed-task bridge a jejich CSS workaroundy) byly z aktivní větve odstraněny. Nový Týden nepoužívá simulované DOM klikání ani technické `[[date:...]]` tokeny pro komunikaci mezi obrazovkami.

## Data a migrace

Storage key zůstává `dayframe-v1`, ale nový formát je `schema: 5`.

Základ:

- `plans[YYYY-MM-DD]` obsahuje skutečné úkoly konkrétního dne;
- `routines` jsou samostatné opakovací definice;
- `backlog` drží práci, kterou se nepodařilo umístit;
- `routineSkips` chrání uživatelské výjimky z rutin;
- schema 4 se při prvním načtení nedestruktivně migruje do schema 5;
- staré technické date/start tokeny se při migraci vyčistí z názvů.

## Produktové chování

### Dnes

`Dnes` je execution view, ne druhý kalendář. Primárně odpovídá na:

1. Co dělat teď.
2. Co následuje.
3. Jestli plán potřebuje rozhodnutí.

Nedokončený minulý blok se **nikdy automaticky nepřenáší**. Uživatel volí `Hotovo / Na zítra / Zrušit`.

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
- `Přepočítat týden` umí přeskládat pohyblivé flexibilní úkoly podle priority a termínů, aniž by hýbal pevnými/date-locked bloky.

### Přidat úkol

Základ vyžaduje jen název. Rychlá ruční nastavení jsou vidět jako kompaktní pole/chips:

- den;
- délka;
- `Začít v`;
- priorita.

Další podrobnosti jsou schované: dokončit do, nejpozdější čas, oblast a opakování.

Smart input zůstává pouze volitelné zrychlení (`zeměpis 20 min`, `Matematika v 17:30 na 60 minut` atd.). Přesné ruční datum a start se ukládají jako datová pole, ne jako textové tokeny.

Když uživatel neurčí den, planner hledá místo přes celý následující týden. Respektuje:

- pracovní okno 10:00–22:30;
- oběd 13:00–14:00;
- existující bloky;
- přesný start;
- prioritu;
- due date/deadline.

### Rutiny

Původní hardcoded týdenní šablona byla převedena na opakovací rutiny. Např. `Čtení knihy` je denní rutina v 22:40. Rutiny se materializují do reálných datovaných bloků, takže budoucí týden už není read-only maketa.

Uživatel může v Nastavení rutiny aktivovat/deaktivovat nebo smazat a novou rutinu založit přes Přidat úkol → Opakování.

### Focus

Focus zůstává záměrně jednoduchý: jeden aktivní úkol a 50min timer. Tmavý režim je vyhrazen focusu.

## Testování PR #14

Poslední ověřený PR head před merge prošel:

- `pnpm exec tsc --noEmit` — PASS;
- 28/28 Node regresních testů — PASS;
- `pnpm preview:build` — PASS;
- Playwright Chromium browser smoke — PASS (1/1): otevře Týden, vybere budoucí den, přidá `Zeměpis 20 min`, ověří že se nikde neukáže `[[...]]`, vrátí se do týdne a otevře úkol v editoru;
- Vercel PR preview — SUCCESS.

CI workflow `.github/workflows/preview-build.yml` nyní typecheck, regresní testy, build a browser smoke spouští automaticky.

## Produktové principy

- Málo textu, vysoká čitelnost.
- Smart input není povinný.
- Ruční zadávání musí být vždy dostupné.
- Pevný blok Dayframe svévolně nepřesouvá.
- Flexibilní práce se může optimalizovat.
- Nedokončené úkoly nesnowballují automaticky.
- Týden = plánování, Dnes = vykonávání.
- GitHub `main` je source of truth.

## Co stále není cílem tohoto PR

- Cloud účet/synchronizace mezi zařízeními.
- Windows Tauri integrace a systémové blokování rušivých aplikací.
- iOS klient.
- Obecný LLM/NLP planner; smart input je deterministický.

## Jak pokračovat

1. Vždy načti aktuální `main` před editací.
2. Pracuj primárně v `web/app/dayframe-v2.tsx` a `web/lib/dayframe-calendar.ts`.
3. Zachovej migraci `dayframe-v1` a data uživatele.
4. Každou větší změnu pokryj unit testem nebo Playwright scénářem.
5. Po merge ověř Vercel produkční status a až pak tvrdíš, že `https://dayframe2.vercel.app` obsahuje změnu.
6. Sites je oddělený a automaticky se neaktualizuje.

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
