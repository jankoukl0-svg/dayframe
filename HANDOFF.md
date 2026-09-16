# Dayframe — začni tady

Aktualizováno: 16. 9. 2026.

## Kontext

Dayframe je osobní aplikace pro plánování a soustředění. Uživatel Jan chce krátké, konkrétní české UX: zadat úkol co nejrychleji a nechat aplikaci vyřešit plán, ale vždy mít možnost den, délku a čas nastavit ručně. Dlouhodobý cíl: Windows aplikace + později propojený iOS klient.

Repo: https://github.com/jankoukl0-svg/dayframe  
Výchozí větev: `main`  
Aktuální hlavní commit po poslední funkční změně: `80c35d771378c28ebdbe2b630c3a54569a8568c4`  
Soukromý Sites náhled: https://dayframe-focus.honza-koukl1.chatgpt.site

**GitHub → Sites není automaticky zapojené. Commit neznamená nasazení.** Work musí změny z `web/` přenést do existujícího Sites projektu a publikovat. Neměnit identitu Site v `web/.openai/hosting.json`. Sites project ID: `appgprj_6aa9d908ba108191965d2abe4da24cf3`.

## Kde se pracuje

| Soubor | Význam |
| --- | --- |
| `web/app/dayframe-app.tsx` | Hlavní obrazovky, stav, lokální ukládání |
| `web/lib/dayframe-planning.ts` | Automatické hledání času |
| `web/lib/dayframe-smart-input.ts` | Volitelný parser údajů napsaných do názvu |
| `web/app/capture-start-control.tsx` | Ruční volitelné pole `Začít v` před přidáním úkolu |
| `web/app/missed-task-actions.tsx` | Hotovo / Přesunout na zítra / Zrušit u zmeškaných úkolů |
| `web/app/compact-copy.css` | Redukce duplicitního textu + malé UX doplňky |
| `web/lib/dayframe-planning.test.mjs` | Regresní testy plánování |
| `web/lib/dayframe-smart-input.test.mjs` | Testy podporovaných smart-input vzorů |

## Schválené produktové principy

- Zachovat klidný světlý design, jemné linky a cihlový akcent. Tmavý režim jen pro soustředění.
- Málo textu. Nevysvětlovat stejnou věc na více místech.
- Základní přidání úkolu vyžaduje pouze název.
- Smart input je **volitelné zrychlení**, ne povinný způsob zadání.
- Den, délka, deadline, priorita a konkrétní začátek musí jít nastavit i ručně.
- Ruční volba má přednost před údajem napsaným v názvu.
- Nedokončené úkoly z minulého dne se nesmí automaticky nabalovat do dalšího dne.
- U zmeškaného úkolu má uživatel explicitní volbu `Hotovo / Přesunout na zítra / Zrušit`.

## Aktuální chování

`Přidat úkol` používá výchozích 45 minut, hledá volné místo dnes a případně zítra, chrání oběd 13–14 a bez explicitního času nepřesouvá existující bloky.

Smart input nyní rozpoznává mimo jiné:

- `Matematika v 17:30 na 60 minut`
- `Matika 17:30 45 min`
- `CFI zítra od 16 na hodinu`
- `Angličtina od 18 do 19:30`
- `Ekonomie dnes do 18:00 důležité`

Konkrétní čas typu `v 17:30`, `od 17:30` nebo samotné `17:30` je **začátek úkolu**, ne deadline. Při exact-start zadání vznikne pevný blok. Pokud se přesně do požadovaného času nevejde, nesmí se potichu přesunout jinam; zůstane čekat.

Ruční podrobnosti mají nově přes `web/app/capture-start-control.tsx` volitelné pole `Začít v`. Prázdné pole znamená, že Dayframe čas najde automaticky. Ruční přesný začátek má přednost před časem napsaným v názvu.

Smart input je deterministický parser, ne obecné AI/NLP. Samotný titul bez údajů dál používá standardní formulář a výchozí hodnoty.

## Důležité předchozí změny

- PR #1: méně duplicitního textu; merge `b22ae165130c7409a98dd52194f53218bb7af446`.
- PR #2: zastaven automatický stale-task carryover; merge `c1beae33087c9f92784a7a29b3648087ff8b1f87`.
- PR #3: smart input + missed-task actions; merge `861c04e5bb36fafc5a6d3745507cbe300f597aec`.
- PR #4: kompatibilita čekajících úkolů; merge `d1b195881357d5700ad7ac3f265d28f3ce501a34`.
- PR #5: oprava exact start-time inputu + ruční `Začít v`; squash merge `80c35d771378c28ebdbe2b630c3a54569a8568c4`.

## Testování a rizika

Před PR #5 prošla plánovací sada po opravě PR #4 jako 11/11 PASS. V kole PR #5 byly přidány další regresní testy pro exact-start a samostatný smart-input test soubor. Reprezentativní parser scénáře (`v 17:30 na 60 minut`, bare `17:30 45 min`, `od 16 na hodinu`, interval `od 18 do 19:30`, ruční override token) byly ověřeny lokálním Node harness a vracely očekávané hodnoty.

**V tomto kole nebyl spuštěn kompletní webový TypeScript check, produkční build ani browser/E2E test ručního pole `Začít v`.** GitHub neměl připojené CI statusy. Work má před publikováním zkontrolovat celý diff, spustit testy/typecheck/build a ručně ověřit submit ručního exact-start pole v prohlížeči.

Data zůstávají v `localStorage` pod `dayframe-v1`, schema 4. Pole `requestedStart` je volitelné v čekajícím úkolu; není nutná destruktivní migrace.

## Co hotové není

- Cloud účet a synchronizace zařízení.
- Propojení nového webu s Tauri a automatické aktualizace Windows aplikace.
- iOS klient.
- Skutečné blokování/čtení rušivých Windows/iOS aplikací; webový hlídač je demo.
- Dlouhodobé plánování nad horizont dnes/zítra a automatický rozpad cílů.
- Obecné NLP/AI odhadování délky.
- Některé starší prvky Nastavení, milníků a týdenních statistik jsou stále ilustrativní nebo nedokončené.

## Jak pokračovat

1. Vždy načti aktuální `main` a zapiš výchozí SHA.
2. Pracuj hlavně ve `web/`; bez zadání nepřepisuj starší Windows projekt.
3. Dělej nejmenší smysluplné změny a zachovej data i design.
4. Rozlišuj NAVRŽENO / UPRAVENO / OTESTOVÁNO / NASAZENO.
5. Po každé práci aktualizuj tento handoff.

Pro testy z `web/`: `node --test lib/dayframe-planning.test.mjs lib/dayframe-smart-input.test.mjs`. Kontrola typů: `node node_modules/typescript/bin/tsc --noEmit`. Produkční build spusť přes existující skript v `web/package.json`.

### Až uživatel řekne „handoff zpět do Work“

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
