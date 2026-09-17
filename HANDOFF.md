# Dayframe — začni tady

Aktualizováno: 17. 9. 2026.

## Kontext

Dayframe je osobní aplikace pro plánování a soustředění. Uživatel Jan chce krátké, konkrétní české UX: zadat úkol co nejrychleji a nechat aplikaci vyřešit plán, ale vždy mít možnost den, délku a čas nastavit ručně. Dlouhodobý cíl: Windows aplikace + později propojený iOS klient.

Repo: https://github.com/jankoukl0-svg/dayframe  
Výchozí větev: `main`  
Aktuální hlavní funkční commit: `a4146008441fb0f465c1636ca9ccad8f1f98580e`  
Vývojový Vercel preview: https://dayframe2.vercel.app  
Soukromý Sites náhled: https://dayframe-focus.honza-koukl1.chatgpt.site

**GitHub → Vercel je zapojené.** Projekt `dayframe2` čte `jankoukl0-svg/dayframe`, Root Directory je `web` a push do `main` automaticky spouští nový deployment na stálém odkazu `https://dayframe2.vercel.app`.

**GitHub → Sites automaticky zapojené není.** Sites zůstává oddělený starší náhled; Work musí změny z `web/` přenést do existujícího Sites projektu a publikovat. Neměnit identitu Site v `web/.openai/hosting.json`. Sites project ID: `appgprj_6aa9d908ba108191965d2abe4da24cf3`.

## Kde se pracuje

| Soubor | Význam |
| --- | --- |
| `web/app/dayframe-app.tsx` | Hlavní obrazovky, stav, lokální ukládání |
| `web/app/week-calendar.tsx` | Týdenní kalendář a navigační vstup `Týden` |
| `web/app/week-calendar.css` | Layout/responzivita týdenního kalendáře |
| `web/app/week-calendar-fix.css` | Starší ochranný override pro kolizi `.fixed`; po PR #12 už není hlavní řešení |
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
- Týdenní pohled má být rychlý přehled, ne přeplácaná kopie Google Calendar.
- Úkoly v každém dni týdenního pohledu musí být vždy řazené chronologicky podle začátku.

## Aktuální chování

`Přidat úkol` používá výchozích 45 minut, hledá volné místo dnes a případně zítra, chrání oběd 13–14 a bez explicitního času nepřesouvá existující bloky.

Smart input rozpoznává mimo jiné `Matematika v 17:30 na 60 minut`, `Matika 17:30 45 min`, `CFI zítra od 16 na hodinu`, `Angličtina od 18 do 19:30` a `matika 40 min od 17:00`. Konkrétní čas je začátek úkolu, ne deadline. Při exact-start zadání vznikne pevný blok; pokud se do požadovaného času nevejde, zůstane čekat.

Ruční podrobnosti mají přes `web/app/capture-start-control.tsx` volitelné pole `Začít v`. Smart input je deterministický parser, ne obecné AI/NLP.

Týdenní kalendář je dostupný přes novou položku `Týden` (klávesa `W`). Zobrazuje Po–Ne, zvýrazní dnešek, ukazuje skutečný uložený plán pro dnešek a zítřek a pro ostatní dny zatím zobrazuje existující týdenní šablonu. Lze přepnout předchozí/další týden a vrátit se na tento týden. Na mobilu je týden horizontálně posuvný. Úkoly v každém dni se před vykreslením řadí podle začátku, při shodě podle konce. Pevné bloky už nepoužívají generickou CSS třídu `fixed`; používají `week-task-fixed`, aby nemohly kolidovat s Tailwind utility `.fixed`. Tato první verze je přehledová; úpravy úkolů přímo v týdenním kalendáři ještě nejsou zapojené.

## Důležité předchozí změny

- PR #1: méně duplicitního textu; merge `b22ae165130c7409a98dd52194f53218bb7af446`.
- PR #2: zastaven automatický stale-task carryover; merge `c1beae33087c9f92784a7a29b3648087ff8b1f87`.
- PR #3: smart input + missed-task actions; merge `861c04e5bb36fafc5a6d3745507cbe300f597aec`.
- PR #4: kompatibilita čekajících úkolů; merge `d1b195881357d5700ad7ac3f265d28f3ce501a34`.
- PR #5: exact start-time input + ruční `Začít v`; merge `80c35d771378c28ebdbe2b630c3a54569a8568c4`.
- PR #6: regresní test přesně pro `matika 40 min od 17:00`; merge `9f004f9b2063815e268a456d48112c33c964049d`.
- `web/vercel.json`: příprava automatického Vercel preview buildu; následně byl projekt `dayframe2` správně propojen s repem a rootem `web`.
- PR #9: týdenní kalendář; squash merge `131d8c89e7884f8f150d18213c5601aef89e15fd`.
- PR #10: chronologické řazení úkolů v týdenním kalendáři; squash merge `cd509b758577743f4c5a486825a5cf153d0e6d3f`.
- PR #11: první pokus o opravu překrývání pevných bloků pomocí scoped CSS override; squash merge `1061900d8855bc1ba14ea004e7d7155460ec41a0`. Vizuálně problém nevyřešil spolehlivě.
- PR #12: definitivní odstranění kolize — karty už vůbec nepoužívají třídu `fixed`, ale `week-task-fixed`; squash merge `a4146008441fb0f465c1636ca9ccad8f1f98580e`.

## Testování a rizika

GitHub Actions `Check web preview` pro PR #12 prošel úspěšně a Vercel preview deployment pro jeho head měl stav `success` před merge. Produkční Vercel deployment merge commitu `a4146008441fb0f465c1636ca9ccad8f1f98580e` měl rovněž stav `success`.

Kompletní browser/E2E sada stále není zapojená. Týdenní kalendář byl ověřen buildem; vizuální kontrola na `https://dayframe2.vercel.app` je důležitá zejména po změnách layoutu. Před PR #12 uživatel doložil screenshotem, že PR #11 problém nepřekrývání nevyřešil; PR #12 proto odstranil samotný konfliktní název třídy místo dalšího CSS override.

Data zůstávají v `localStorage` pod `dayframe-v1`, schema 4. Týdenní kalendář nepřidává migraci ani nový storage schema. Uložená data existují nativně jen pro dnešek a zítřek; vzdálenější dny v týdenním pohledu jsou zatím šablona, nikoli samostatně uložené denní plány.

## Co hotové není

- Plnohodnotné ukládání a editace libovolného dne v týdnu; scheduler stále nativně plánuje jen dnes/zítra.
- Kliknutí/drag-and-drop úkolů přímo v týdenním kalendáři.
- Cloud účet a synchronizace zařízení.
- Propojení nového webu s Tauri a automatické aktualizace Windows aplikace.
- iOS klient.
- Skutečné blokování/čtení rušivých Windows/iOS aplikací; webový hlídač je demo.
- Dlouhodobé plánování a automatický rozpad cílů.
- Obecné NLP/AI odhadování délky.
- Některé starší prvky Nastavení, milníků a týdenních statistik jsou stále ilustrativní nebo nedokončené.

## Jak pokračovat

1. Vždy načti aktuální `main` a zapiš výchozí SHA.
2. Pracuj hlavně ve `web/`; bez zadání nepřepisuj starší Windows projekt.
3. Dělej nejmenší smysluplné změny a zachovej data i design.
4. Rozlišuj NAVRŽENO / UPRAVENO / OTESTOVÁNO / NASAZENO.
5. Po každé práci aktualizuj tento handoff.
6. Každý push do `main` má přes Git integraci automaticky vytvořit novou verzi na `https://dayframe2.vercel.app`; uživatel má používat tento jeden stálý odkaz a refreshovat.

Pro testy z `web/`: `node --test lib/dayframe-planning.test.mjs lib/dayframe-smart-input.test.mjs`. Kontrola typů: `node node_modules/typescript/bin/tsc --noEmit`. Statický preview build: `pnpm preview:build`.

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
