# Dayframe — začni tady

Aktualizováno: 16. 9. 2026.

## Kontext

Dayframe je osobní aplikace pro plánování a soustředění. Uživatel Jan chce krátké, konkrétní české UX: zadat úkol co nejrychleji a nechat aplikaci vyřešit plán, ale vždy mít možnost den, délku a čas nastavit ručně. Dlouhodobý cíl: Windows aplikace + později propojený iOS klient.

Repo: https://github.com/jankoukl0-svg/dayframe  
Výchozí větev: `main`  
Aktuální hlavní commit po přípravě Vercel preview: `08dccd743adcc13d8f33b2e36c451a2446397466`  
Soukromý Sites náhled: https://dayframe-focus.honza-koukl1.chatgpt.site

**GitHub → Sites není automaticky zapojené. Commit neznamená nasazení.** Work musí změny z `web/` přenést do existujícího Sites projektu a publikovat. Neměnit identitu Site v `web/.openai/hosting.json`. Sites project ID: `appgprj_6aa9d908ba108191965d2abe4da24cf3`.

## Vercel preview

Cíl: mít jeden stálý vývojový odkaz, který se po každém pushi do `main` automaticky aktualizuje. V `web/vercel.json` je připraven build `pnpm preview:build`, output `preview-dist` a install `pnpm install --frozen-lockfile`. GitHub Actions už stejný statický preview build ověřuje přes `.github/workflows/preview-build.yml`.

Vercel plugin v ChatGPT je připojený a přímý deploy funguje, ale projekt zatím není Git-linked na repo. Uživatel musí jednorázově ve Vercelu importovat existující repo `jankoukl0-svg/dayframe` a nastavit Root Directory na `web`. Potom se mají změny z `main` nasazovat automaticky. Až je projekt vytvořený, zapiš sem jeho stálou URL a ověř první build.

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
| `web/vercel.json` | Konfigurace statického Vercel preview buildu |

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

Smart input rozpoznává mimo jiné `Matematika v 17:30 na 60 minut`, `Matika 17:30 45 min`, `CFI zítra od 16 na hodinu`, `Angličtina od 18 do 19:30` a `matika 40 min od 17:00`. Konkrétní čas je začátek úkolu, ne deadline. Při exact-start zadání vznikne pevný blok; pokud se do požadovaného času nevejde, zůstane čekat.

Ruční podrobnosti mají přes `web/app/capture-start-control.tsx` volitelné pole `Začít v`. Smart input je deterministický parser, ne obecné AI/NLP.

## Důležité předchozí změny

- PR #1: méně duplicitního textu; merge `b22ae165130c7409a98dd52194f53218bb7af446`.
- PR #2: zastaven automatický stale-task carryover; merge `c1beae33087c9f92784a7a29b3648087ff8b1f87`.
- PR #3: smart input + missed-task actions; merge `861c04e5bb36fafc5a6d3745507cbe300f597aec`.
- PR #4: kompatibilita čekajících úkolů; merge `d1b195881357d5700ad7ac3f265d28f3ce501a34`.
- PR #5: exact start-time input + ruční `Začít v`; merge `80c35d771378c28ebdbe2b630c3a54569a8568c4`.
- PR #6: regresní test přesně pro `matika 40 min od 17:00`; merge `9f004f9b2063815e268a456d48112c33c964049d`.
- `web/vercel.json`: příprava automatického Vercel preview buildu; commit `08dccd743adcc13d8f33b2e36c451a2446397466`.

## Testování a rizika

Před PR #5 prošla plánovací sada po opravě PR #4 jako 11/11 PASS. Exact-start parser scénáře byly ověřeny samostatně. Kompletní browser/E2E ověření ručního pole `Začít v` stále není provedeno. Vercel Git-linked build zatím také není ověřen, dokud uživatel projekt jednorázově neimportuje.

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
6. Po zprovoznění Git-linked Vercel preview má každý push do `main` automaticky vytvořit novou viditelnou verzi; uživatel má používat jeden stálý Vercel odkaz a jen refreshovat.

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
