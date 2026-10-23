# Dayframe — aktuální předání pro nové chaty

**Snapshot ověřen 23. 10. 2026.** Tento dokument slouží jako předávací kontext, **nikoli jako neměnný důkaz aktuálního stavu**. Na začátku každého nového vývojového úkolu znovu ověř GitHub `main`, poslední commity, otevřené PR a produkční deployment. Nezastavuj se u níže uvedeného historického SHA.

- Repo: https://github.com/jankoukl0-svg/dayframe
- Produkce: https://dayframe2.vercel.app
- Zdroj pravdy: větev `main`; aktivní produkt v `web/`.
- Povinná pravidla: [AGENTS.md](AGENTS.md) a [docs/DEVELOPMENT_PROTOCOL.md](docs/DEVELOPMENT_PROTOCOL.md).
- Poslední potvrzený produktový merge **před vytvořením tohoto dokumentačního PR**: `c80757ef8a53a14686988fef62e7c18f8df6ced2`, [PR #265](https://github.com/jankoukl0-svg/dayframe/pull/265), 22. 10. 2026.
- Produkční Vercel `dayframe2.vercel.app` byl při kontrole 23. 10. navázán na READY deployment `dpl_BrQuVgE5tbDZRW5nuY8mh9SZdamK` se stejným SHA. Toto je **snapshot, ne záruka budoucího stavu**. Po dalším mergi znovu ověř alias, deployment a živý smoke.
- Při aktualizaci tohoto souboru změň datum, přesné SHA, nasazení, změny a otevřená rizika; nepřepisuj ověřenou historii jako současnost.

## Co je naposledy implementováno

### Týden, cestování a Jarvis

- [PR #251](https://github.com/jankoukl0-svg/dayframe/pull/251): zvolitelné skutečné alternativy Google MHD; upřednostnění jednodušší kombinace linek a volitelná samostatná kontrola pouze metra. Výsledky závisí na tom, co skutečně vrátí Google; nevymýšlet spojení, které provider nepotvrdil.
- [PR #250](https://github.com/jankoukl0-svg/dayframe/pull/250): hledání parkovišť přes OpenStreetMap/Overpass, orientační srovnání podle dostupných dat; nevymýšlet aktuální obsazenost ani cenu.
- [PR #253–255](https://github.com/jankoukl0-svg/dayframe/pull/255): rezervování cestovních bloků před aktivitami a volitelné zpáteční cesty, včetně varianty „pouze cesta domů“, a přímých tras bez přestupů. Cestovní blok je časově svázán s aktivitou.
- [PR #256](https://github.com/jankoukl0-svg/dayframe/pull/256): kompaktnější text cestovních bloků v Týdnu.
- [PR #263](https://github.com/jankoukl0-svg/dayframe/pull/263): navázané cestovní bloky po dokončení aktivity vizuálně zešednou.
- [PR #264](https://github.com/jankoukl0-svg/dayframe/pull/264): při cestě mimo viditelný časový rozsah zobrazit konkrétně „Vyjeď v HH:MM“ místo obecného upozornění.
- [PR #265](https://github.com/jankoukl0-svg/dayframe/pull/265): shodná geometrie časové osy všech sedmi dnů i při odlišných úkolech bez času nebo oznámeních odjezdu; E2E desktop/mobil.
- Google Routes je chráněn atomickými Upstash limity **50 požadavků / UTC den a 1 000 / UTC měsíc**. Neodstraňovat limiter, nepřidávat automatická placená volání. Podrobnosti: [web/docs/google-routes.md](web/docs/google-routes.md). Uložení manuálního času pro plánování zůstává oddělené od dočasného Google odhadu.

### Čtení

- [PR #257](https://github.com/jankoukl0-svg/dayframe/pull/257): zapisování poslední přečtené stránky, výpočet nového přírůstku.
- [PR #258](https://github.com/jankoukl0-svg/dayframe/pull/258): několik současně rozečtených knih s vlastními stránkami a se zachováním historie.
- [PR #259](https://github.com/jankoukl0-svg/dayframe/pull/259): přesouvání čtení také do běžného dne, nejen večer.
- [PR #260–261](https://github.com/jankoukl0-svg/dayframe/pull/261): funkční výběr nalezené knihy a čitelný náhled.
- [PR #262](https://github.com/jankoukl0-svg/dayframe/pull/262): všechny rozečtené knihy jako rovnocenné plnohodnotné karty, žádná vizuální priorita.

### Další existující sekce

- Hygiena, úklid, zdraví a suplementy; Gym a tréninková historie; Dnes, Týden, Jarvis, cestování, Čtení a Focus. Před úpravou konkrétní sekce prozkoumat **aktuální** kód, testy a relevantní merged PR. Nepředpokládat, že popis z 18. září odpovídá jejich dnešní podobě.
- Neodstraňovat uživatelská data ani měnit existující storage key/schema bez explicitně navržené zpětně kompatibilní migrace.
- Neměnit UX, rutiny, motivační odpočty ani kalendářové invarianty nad rámec schváleného zadání.

## Otevřené PR nejsou automaticky backlog k mergi

Při kontrole 23. 10. zůstávají otevřené historické PR, např. [#185](https://github.com/jankoukl0-svg/dayframe/pull/185) (Gym týdenní plán), [#171](https://github.com/jankoukl0-svg/dayframe/pull/171) (suplementy) a [#165](https://github.com/jankoukl0-svg/dayframe/pull/165) (ověření značky u produktových fotografií), plus starší PR. Mohou být překonané pozdějšími změnami. **Neslučovat automaticky**; před rozhodnutím porovnat s `main`, relevantními novějšími PR a aktuálním požadavkem.

## Standard pro pokračování v novém chatu

1. Načíst aktuální GitHub `main`, `AGENTS.md`, tento soubor a `docs/DEVELOPMENT_PROTOCOL.md`, ověřit poslední relevantní PR/commity a stav produkce.
2. Pokud uživatel zadá změnu: sepsat akceptační chování, co se nemění, edge cases a důsledky pro data. Pracovat na **nové větvi** z aktuálního `main`.
3. Dodržet `SPEC → IMPLEMENT → TARGETED TEST → SELF-FIX → FULL REGRESSION → REVIEW → SELF-FIX → MERGE → DEPLOY → SMOKE VERIFY`. Po změně head SHA předchozí CI/review neplatí. Review a merge až po aktuálních kontrolách.
4. Po merge ověřit, že `main` ukazuje na výsledný commit, produkční deployment je READY, alias `dayframe2.vercel.app` míří právě na něj a produkční smoke uspěl. Teprve tehdy mluvit o dokončené změně.
5. Po významné úspěšné změně aktualizovat tento **horní, aktuální** oddíl: datum, výchozí/výsledné SHA, PR, testy, deployment, otevřená rizika a doporučený další krok. Historické pasáže pod oddělovačem nenahrazují aktuální kontrolu.

## Otevřená omezení a další krok

- Nejsou doloženy nové uživatelské požadavky po PR #265. **Další úpravu produktu určí uživatel**; bez požadavku nepřidávat funkce ani neslučovat staré otevřené PR.
- Google Routes nevrací všechny možné MHD trasy, a proto nejsou alternativy vyčerpávající. Výpočty spojení a parkování nesmějí být vydávány za jistotu.
- Dříve popsané nedodělky z 18. 9. jsou pouze historická pozorování a vyžadují novou verifikaci.
- Změna tohoto dokumentu sama o sobě **nemění žádnou funkcionalitu ani data Dayframe**.

---

## Archivní handoff z 18. 9. 2026 — pouze historický kontext

Následující původní text je ponechán pro kontinuitu, ale obsahuje zastaralé SHA, staré návrhy a dřívější stav produktu. V případě rozporu rozhoduje aktuální `main`, nejnovější sloučené PR a ověřené nasazení.

# Dayframe — začni tady

> Vývojový a release standard: [docs/DEVELOPMENT_PROTOCOL.md](docs/DEVELOPMENT_PROTOCOL.md). Instrukce pro coding agenty: [AGENTS.md](AGENTS.md).

Aktualizováno: 18. 9. 2026.

## Kontext

Dayframe je osobní plánovací a focus aplikace. UX má být krátké, klidné a praktické: uživatel může napsat jen název úkolu, Dayframe navrhne čas, ale den, délku, prioritu a konkrétní začátek lze vždy nastavit ručně.

Repo: `jankoukl0-svg/dayframe`  
Výchozí větev: `main`  
Vývojový Vercel: https://dayframe2.vercel.app  
Sites náhled: https://dayframe-focus.honza-koukl1.chatgpt.site — **není automaticky napojený na GitHub**.

GitHub → Vercel je zapojené. Projekt `dayframe2` používá Root Directory `web` a push do `main` automaticky deployuje stálý URL výše.

## Aktuální návaznost a druhý preview

- Výchozí main pro tuto práci: `9447ce447f66426271cece922879318d7673e4ac` (PR #30).
- Milníky lze kliknutím upravit (název, datum, poznámka) i smazat; pokrývá je browser test.
- Minulé dny jsou read-only historie pouze skutečně splněných bloků. Dnes a budoucnost zůstávají aktivní.
- Týden nemá success bannery po přesunu/přepočtu ani spodní instrukce a souhrn bloků.
- Vercel narazil na denní deployment limit; nevyvolávat zbytečné deploymenty.
- Připraven GitHub Pages workflow: po typechecku, regresích, buildu a Playwright testu **statického výstupu pod `/dayframe/`** publikuje pouze `main`. Ruční opakování přes `workflow_dispatch`.
- Pages vyžaduje jednorázově Settings → Pages → Source: GitHub Actions. Stav aktivace je nutné ověřit; samotný commit workflow není důkaz nasazení.
- PR #31 sloučen do main: `8de3fdb9bbecabca21222c019bf2e3aba6143a34`. Žádná změna produktového UI ani dat.
- TypeScript, 34 regresí, static build a Playwright nad `/dayframe/`: PASS v PR i po merge (run `35333501272`).
- Publikování v tomto runu BLOCKED: `configure-pages` vrací `Get Pages site failed / Not Found`. Pages ještě není aktivní; připojení GitHub neumí administrativní nastavení a cloud browser není do GitHubu přihlášen.
- Vlastník musí v Settings → Pages vybrat Source: GitHub Actions, potom v Actions spustit **Check and publish web preview → Run workflow (main)**. Po nasazení povinně otevřít výsledný URL.
- AKTUÁLNĚ Pages běží: https://jankoukl0-svg.github.io/dayframe/ — ověřeno v browseru 18. 9. 2026; ruční run `35334102051` nad `89126f1...` skončil success. Předchozí blokaci aktivace uvedenou výše už vlastník vyřešil.
- Povolený fallback ověřen: statický build v Work cloud browseru; uživateli přiložen screenshot. Work náhled je dočasný, není druhý stabilní veřejný hosting.
- Poznámka pro další Work: framework dev server má existující SSR/client timezone hydration mismatch; statický preview mount používaný Vercel/Pages SSR nemá. Pro fallback byl otevřen skutečný `preview-dist` pod `public/dayframe/index.html` (jen lokální kopie, necommitovat build).
- Postup: `web/preview/README.md`. Relativní Vite base zachovává Vercel i Pages.
- Každý host má oddělená lokální data; `dayframe-v1`, schema 5, beze změny.
- Pracovat pouze na `web/` (plus CI/handoff), vždy z čerstvého main. Staré `ui/` a Tauri ignorovat.
- Po každé UI změně ověřit skutečný náhled a poslat link nebo screenshot.

## Aktuální architektura — Calendar Foundation

PR #14 zavedl date-native Calendar Foundation. PR #15/#17 vrátily motivační odpočty a jejich původní Dayframe vizuál. PR #18 zlepšil čitelnost Týdne, PR #19 opravil grab-point drag/drop, PR #20 sjednotil přesnou časovou geometrii a změnil oběd na měkkou preferenci. **PR #21 odstranil z produktu celý koncept zamykání bloků. PR #22 přidal živý cílový čas během dragování, PR #23 ho přesunul k pohybujícímu se bloku a PR #24 ho posunul nad preview, aby ho nepřekrýval nativní drag obraz prohlížeče.**

Hlavní soubory:

| Soubor | Úloha |
| --- | --- |
| `web/app/dayframe-v2.tsx` | Aktivní UI, sdílený stav, week drag/snap, editor a hlavní views |
| `web/app/dayframe-v2.css` | Základní aktivní design a responsivita |
| `web/app/dayframe-countdowns.css` | Motivační odpočet dne a termínů |
| `web/app/week-calendar-polish.css` | Čitelnost time-gridu, přesná geometrie slotů a drop preview včetně live target-time badge u přesouvaného bloku |
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

#### Drag/drop po PR #21–#24 — bez zamykání

- **Neexistuje už žádný uživatelský koncept `zamknutý/flexibilní`.**
- Nezobrazují se lock ikony, lock glyphy, `zamknuto` notice ani fixed/flex metadata.
- Blok při tažení zachovává přesné místo úchopu a snapuje po 15 minutách.
- Při kolizi se hledá pouze nejbližší validní slot do ±60 minut.
- Drop preview ukazuje přesný výsledný čas bez zámku.
- **Live snapped čas se během tažení zobrazuje těsně nad aktivním drop preview.** Je tedy pořád přímo u přesouvaného bloku, ale neleží pod nativním drag obrazem prohlížeče. Nevalidní cíl používá chybový vzhled.
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

- odstraněny lock ikony a fixed/flex vizuální režimy;
- odstraněny texty `zamknuto`, `Zamknutý čas`, `Flexibilní čas`;
- editor má jen volitelný `Začátek`;
- drag/drop už nevytváří `mode: fixed`, ale zachová ručně zvolený den/čas;
- schema-5 fixed stav se nedestruktivně normalizuje na lockless model;
- `Přepočítat týden` dál respektuje ručně zadaný den/čas;
- unit testy i Playwright ověřují absenci lock UI a zachování výsledného času po drag/drop.

Ověření PR #21: TypeScript PASS, regresní testy PASS, static preview build PASS, Playwright browser smoke PASS. Produkční Vercel deployment merge commitu `fbb614f8...` skončil `success`.

### PR #22 — live drag target time
Merge: `f6ddab31c33e3e5ecc6efb09a123caf14b3be089`.

- během dragování se live snapped čas z drop preview zobrazoval nahoře ve viewportu;
- nevalidní cíl používá odlišný chybový badge;
- scheduling logika se nezměnila;
- TypeScript, regresní testy, static preview build a Playwright browser smoke PASS;
- produkční Vercel deployment merge commitu `f6ddab31...` skončil `success`.

### PR #23 — attach drag time to moving block
Merge: `4fc5506fd07c71a77f7b9877bc06c54b5f8cd0b9`.

- live snapped čas už není nahoře ve viewportu;
- časový badge byl přesunut přímo na aktivní drop preview;
- scheduling logika se nezměnila;
- TypeScript, regresní testy, static preview build a Playwright browser smoke PASS;
- produkční Vercel deployment merge commitu `4fc5506f...` skončil `success`.

### PR #24 — keep drag time visible above moving block
Merge: `8afbd4bbc84625277646977cd355ed6b23d2cd4c`.

- nativní drag image prohlížeče překrýval badge umístěný uvnitř preview;
- badge je nyní těsně nad pravou horní hranou drop preview;
- aktivní drop body během dragování dovolí badge vykreslit mimo vlastní box, takže se neořízne;
- scheduling logika se nezměnila;
- TypeScript, regresní testy, static preview build a Playwright browser smoke PASS;
- produkční Vercel deployment merge commitu `8afbd4bb...` skončil `success`.

CI workflow `.github/workflows/preview-build.yml` automaticky spouští typecheck, regresní testy, build a browser smoke.

## Produktové principy

- Málo textu, vysoká čitelnost.
- **Motivační odpočty jsou core feature.**
- Týden nesmí být datově ani vizuálně přehuštěný.
- Časový grid musí být geometricky pravdivý.
- Oběd je preference pro auto-planner, ne tvrdý zákaz.
- Drag/drop musí být předvídatelný: držet grab point, snapovat po 15 min, neházet blok daleko při kolizi a **během tažení jasně ukazovat aktuální cílový čas přímo u přesouvaného bloku, ale mimo oblast překrytou native drag image**.
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


## Produktový audit 18. 9. 2026 — návrhy, nikoli implementace

Ověřen aktuální main `89126f17dbb3be508fbd96a9d0804b8f3a2efc1a`, aktivní TSX/model/CSS a Pages UI (Dnes, Nastavení, Focus, Přidat úkol). Bez změny aplikace nebo uživatelských dat. CI úspěšného Pages runu prošlo; tento audit testy znovu nespouštěl.

Konkrétní nálezy:
- Browser: text `Matika 17:30 60 min` stále ukazuje v náhledu 45 min a automatický čas; submit přitom používá parser. Sjednotit náhled a ukládaná data. V kódu ruční hodnota 45 min / běžná priorita není odlišena od výchozí, takže ji parser může přepsat.
- Model: `deleteRoutine` odstraňuje i historické splněné výskyty. Vypnutí rutiny mění jen `active`, již vytvořené budoucí bloky zůstávají. Zachovat historii, upravit pouze budoucí výskyty.
- Model: tlačítko u backlogu volá `replanWeek`, který stávající backlog vůbec neprochází. Opravit skutečné opětovné plánování.
- UI/kód: Focus vždy 50 min, bez přímého dokončení úkolu a persistence; interval může driftovat na pozadí. Délka podle bloku, Hotovo / Pokračovat / Přestávka, výpočet z časové značky.
- UI/kód: karta Teď vybírá také budoucí nebo zmeškaný blok. Rozlišit probíhající práci, příští blok a volno.
- Browser: rutiny bez uvedení dnů vypadají jako duplicity; chybí jejich editor a skutečné obden.
- Kód/CSS: read-only historie je převážně pointer-events/CSS, ne modelová ochrana. Prověřit klávesnici, editaci a přepočet minulého týdne.
- Bez exportu/importu a undo; parse error localStorage může vést k přepsání původních dat novým stavem. Nejdřív uchovat původní obsah a nabídnout obnovu.
- Milníky jsou nyní datum/note/countdown, nemají vazbu na úkoly ani množství zbývající přípravy.

Doporučené pořadí: ochrana dat + chyby plánování/inputu → dokončení práce z Dnes/Focus → přehledné editovatelné rutiny → milníky propojené s přípravou → záloha/undo (ochrannou zálohu dat řešit už v prvním kroku). Zachovat odpočty i současný vizuální směr. Návrhy nebyly schváleny k implementaci.

## Jak pokračovat

1. Vždy načti aktuální `main` před editací.
2. Pracuj primárně v `web/app/dayframe-v2.tsx`, `web/lib/dayframe-calendar.ts` a aktivních CSS souborech.
3. Zachovej migraci `dayframe-v1` a data uživatele.
4. Zachovej prominentní odpočet do 00:30 i odpočty k důležitým termínům.
5. U nového CSS zkontroluj import v `page.tsx` i `web/preview/main.tsx`.
6. Každou větší změnu pokryj unit testem nebo Playwright scénářem.
7. U drag/drop změn browser test musí ověřit skutečný drop a výsledný čas; **nevracet lock UI** a zachovat jasný live target-time feedback přímo u přesouvaného bloku.
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
```\n