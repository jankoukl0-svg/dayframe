# Dayframe — začni tady

Tento dokument je informační předání mezi chaty. Datum: 16. 9. 2026.

## Kontext pro nového asistenta

Navazuješ na existující Dayframe, osobní aplikaci pro plánování a soustředění. Uživatel Jan chce krátké, konkrétní české odpovědi a intuitivní produkt: napíše úkol a aplikace za něj řeší den i čas. Nechce spravovat komplikované seznamy, ručně třídit Inbox ani při každé změně stahovat instalátor. Dlouhodobý cíl je Windows aplikace a později propojený iOS klient.

Společný repozitář: https://github.com/jankoukl0-svg/dayframe — výchozí větev `main`. Nejdřív načti aktuální stav a tento dokument, pak pokračuj. Nepředpokládej, že si pamatuješ předchozí chat. Pokud nemáš přístup do soukromého repozitáře nebo možnost zapisovat, řekni to; nezaměňuj návrh kódu za uloženou změnu.

## Kde se pracuje

| Umístění | Význam |
| --- | --- |
| `web/` | Aktuální webové rozhraní a plánovací logika. Tady pokračuj v běžných UX změnách. |
| `web/app/dayframe-app.tsx` | Obrazovky, stav, denní šablony, přepočet dne a místní ukládání |
| `web/lib/dayframe-planning.ts` | Automatické hledání času pro nové a čekající úkoly |
| `web/lib/dayframe-planning.test.mjs` | Testy této plánovací logiky |
| `web/app/globals.css` | Stávající design a responzivní rozložení |
| `web/app/compact-copy.css` | Jemné UX override pro omezení opakujícího se vysvětlujícího textu |
| `ui/`, `src-tauri/` | Starší nativní Windows verze, zatím nezapojená do nového webového rozhraní |
| `supabase/schema.sql` | Návrh databáze, ne důkaz hotové synchronizace |
| `.github/workflows/windows-build.yml` | Stávající sestavení Windows instalátoru |

Web byl importován beze změn ze Sites revize `915107bbda34a66c34d63e003ebf6f0fda525852`, nasazené jako verze 8. Tento SHA patří původnímu Sites repozitáři, ne historii GitHubu. Pro nové změny používej skutečný aktuální GitHub commit jako základ a zapisuj jej do zpětného předání.

Soukromý živý náhled: https://dayframe-focus.honza-koukl1.chatgpt.site

**GitHub je nyní společný zdroj pro další vývoj, ale automatické nasazení GitHub → Sites není zapojené.** Uložení commitu není zveřejnění webu. Work při návratu načte změny z `web/`, zkontroluje je, přenese do existujícího Sites projektu a publikuje. Neměň identitu Site v `web/.openai/hosting.json`, nezakládej náhradní projekt a neměň soukromí. Sites project ID: `appgprj_6aa9d908ba108191965d2abe4da24cf3`.

## Produkt a schválený vzhled

- Klidná světlá pracovní plocha, přehledná časová osa, jemné linky, cihlový akcent. Tmavý režim jen pro soustředění.
- Zachovat stávající design. Žádný generický AI dashboard, fialové gradienty, svítící koule, přemíra karet ani marketingová výplň.
- UX má být stručné: vysvětlit jen to, co pomáhá udělat rozhodnutí. Neopakovat stejnou informaci v nadpisu, helper textu a pravém panelu.
- Uživatel vstává v 9:00, učí se od 10:00, má oběd 13–14, konec dne 00:30. Střídá CFI/Excel, ekonomii, matematiku a angličtinu; chce VŠE AJ obden po 15:00, později SCIO a večer 20 minut knihy.
- Výzva „Přepočítat od teď“ musí zmizet po kliknutí a vrátit se až při dalším nově zmeškaném bloku. Nenahrazovat ji trvalým potvrzovacím bannerem.
- Nevracet Inbox s povinným tříděním Dnes/Zítra/Do Inboxu. Základní přidání má vyžadovat pouze název, další volby jsou volitelné.
- Nedokončené úkoly z minulého dne se nesmí samy přesouvat do dalšího dne. Bez výslovné volby uživatele zůstávají čekat; uživatel může přes úpravu zvolit dnešek nebo zítřek. Tím se má zabránit efektu sněhové koule.

## Co už je ve webu

Dnešní plán, odpočet, hotové úkoly, úpravy a mazání, pevné i přesunutelné bloky, přepočet dne, milníky, 50minutový focus timer, lokální ukládání a zítřejší plán.

„Přidat úkol“ přijme název, předvyplní 45 minut a najde volno dnes, jinak zítra. Při přidání nepřesouvá stávající bloky. Hledá mezi 10:00 a 22:30 a chrání oběd 13–14. Podrobnosti dovolují změnit délku, důležitost, oblast, nejzazší čas a volitelně konkrétní den. Potvrzení ukáže skutečný čas a umožní vzít přidání zpět.

Když se nový úkol nevejde, zůstane uložený a jasně označený. Uvolněné místo se znovu automaticky kontroluje. Původní zachycené úkoly se migrují. Zítřejší plán se při změně data stane dnešním. Nedokončený úkol z předchozího dne bez explicitního `targetDate` se už automaticky nezařadí do dneška ani zítřka; zůstane v čekajících, dokud uživatel nevybere konkrétní den.

Dne 16. 9. 2026 proběhl první UX průchod zaměřený na méně textu. PR #1 byl squash-merge do `main` jako commit `b22ae165130c7409a98dd52194f53218bb7af446`. Přidán `web/app/compact-copy.css` a import v `web/app/layout.tsx`. Skryty byly hlavně duplicitní helper odstavce v Dnes, Přidat úkol, Milníky, Nastavení a pravém kontextovém panelu. Zachovány zůstaly časy, stav, ovládací prvky, kapacita, důvody čekajících úkolů a důležité akce. Plánovací logika ani data se neměnily. Build, TypeScript ani browser/E2E test tohoto konkrétního UX kola nebyly spuštěny. Změna je v GitHubu, ale nebyla publikována do Sites.

Dne 16. 9. 2026 bylo v PR #2 změněno přenášení nedokončených úkolů. Squash-merge do `main`: `c1beae33087c9f92784a7a29b3648087ff8b1f87`. `web/lib/dayframe-planning.ts` nyní rozpozná čekající úkol bez zvoleného dne, který vznikl v dřívější den, a ponechá ho čekat místo automatického přesunu. Explicitně zvolený dnešek nebo zítřek se dál naplánuje běžně. Přidán regresní test v `web/lib/dayframe-planning.test.mjs`; plánovací testy 9/9 PASS po lokální TypeScript kompilaci a spuštění Node testů. Build, kontrola celé aplikace ani browser/E2E test v tomto kole provedeny nebyly. Změna je v GitHubu, ale nebyla publikována do Sites.

Stack: React, TypeScript, Vinext/Vite, Next-style struktura a stávající UI komponenty. Zachovat `pnpm-lock.yaml`, strukturu a závislosti. Data: localStorage `dayframe-v1`, schema 4. Interní pole `inboxTasks` je ponecháno kvůli kompatibilitě, v rozhraní Inbox není. Nemazat úložiště jako běžný krok při testování.

## Co hotové není

- Cloudový účet, synchronizace zařízení, propojení nového webu s Tauri, automatické aktualizace instalátoru, iOS aplikace a export/import dat.
- Webový hlídač rušivých aplikací je demo. Není skutečné čtení nebo blokování Windows/iOS aplikací. Starší UI může působit silněji než implementace.
- Nové úkoly se plánují pouze na dnes a zítra. Není hotová dlouhodobá optimalizace ani automatický rozpad cílů.
- Název úkolu není jazykový povel. „Zítra 30 minut“ se automaticky neparsuje; 45 minut je výchozí hodnota, ne AI odhad.
- Důležitost řadí čekající úkoly, automaticky nevytlačuje již naplánované bloky.
- VŠE AJ má zatím šablonu Po/St/Pá/Ne, nikoli přesný nepřerušený interval obden. Výchozí termíny milníků nejsou ověřené oficiální termíny zkoušek.
- Některé starší ovládací prvky Nastavení/milníků a týdenní statistiky jsou stále nedokončené nebo ilustrativní. Před tvrzením, že fungují, ověř kód.

## Jak pokračovat a předávat práci

1. Načti aktuální `main` a zapiš výchozí SHA. Pro změnu používej samostatnou větev a přehledný commit/PR. Bez oprávnění pouze navrhuj, neslibuj push.
2. Pracuj hlavně ve `web/`. Windows projekt nepřepisuj ani nepřepojuj bez samostatného zadání.
3. Nejprve pochop uživatelův požadavek, potom udělej nejmenší smysluplnou změnu. Zachovej data a design. Nedělej velký redesign či změnu frameworku bez souhlasu.
4. Rozlišuj NAVRŽENO, SCHVÁLENO, UPRAVENO, OTESTOVÁNO a NASAZENO. Testy, push ani publikování netvrď bez skutečného výsledku.
5. Po změně aktualizuj tento dokument, pokud se změnil produktový nebo technický stav. Nezaměňuj přání za hotové funkce.

Ověření importované revize: 8/8 testů plánování, TypeScript a produkční build prošly v původním Work prostředí. Browserové/E2E testy tohoto kola nebyly provedeny. Samotný přesun do GitHubu nemění chování aplikace.

Pro testy z `web/`: `node --test lib/dayframe-planning.test.mjs` (ověřeno Node 24.19.0). Kontrola typů: `node node_modules/typescript/bin/tsc --noEmit`. Build: použij existující skripty v `web/package.json` a odpovídající prostředí, nevymýšlej náhradu za úspěšný test. Žádné tokeny do commitu ani předání.

### Až uživatel řekne „handoff zpět do Work“

Vrať krátký text v tomto formátu:

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

Work musí nejprve porovnat skutečný aktuální GitHub diff s předáním, zachovat cizí změny a data, teprve potom změny přijmout a případně nasadit. Pokud se pouze diskutovalo, napiš výslovně „Kód ani nasazení se nezměnily“.