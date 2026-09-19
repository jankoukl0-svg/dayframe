import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const url=process.env.DAYFRAME_BASE_URL || 'http://127.0.0.1:4173';
const empty=()=>({schema:5,plans:{},backlog:[],routines:[],routineSkips:[],milestones:[],dismissedOverdueKeys:[]});
const task=(patch={})=>({id:'task',title:'Čtení',date:'2026-09-17',duration:20,start:'10:00',end:'10:20',priority:'normal',category:'Studium',mode:'flexible',completed:false,source:'user',createdAt:'2026-09-17T08:00:00Z',...patch});
async function boot(page,state=empty()) {
 await page.clock.install({time:new Date('2026-09-17T10:00:00')});
 await page.clock.pauseAt(new Date('2026-09-17T10:00:01'));
 await page.addInitScript(s=>{if(!localStorage.getItem('dayframe-v1'))localStorage.setItem('dayframe-v1',JSON.stringify(s));},state);
 await page.goto(url);
 await expect(page.getByRole('heading',{name:'Dnes',exact:true})).toBeVisible();
}
async function nav(page,name){await page.locator('.df2-sidebar nav button').filter({hasText:name}).click();}
async function data(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('dayframe-v1')));}

test('smart fields match the saved task and manual default values win',async({page})=>{
 await boot(page);await nav(page,'Přidat úkol');
 await page.getByPlaceholder('Např. zeměpis 20 min').fill('Matika zítra 17:30 60 min urgent');
 await expect(page.getByLabel('Délka',{exact:true})).toHaveValue('60');await expect(page.getByLabel('Začít v',{exact:true})).toHaveValue('17:30');
 await expect(page.locator('.df2-understood')).toContainText('60 min');
 await page.getByLabel('Délka',{exact:true}).selectOption('45');await page.getByLabel('Priorita',{exact:true}).selectOption('normal');
 await expect(page.locator('.df2-understood')).toContainText('45 min');
 await page.getByRole('button',{name:'Naplánovat',exact:true}).click();
 await expect(page.locator('.df2-result')).toContainText('17:30–18:15');
 const s=await data(page);expect(s.plans['2026-09-18'][0]).toMatchObject({title:'Matika',duration:45,priority:'normal',start:'17:30'});
});

test('focus uses task duration, survives reload and pause, completes and undoes',async({page})=>{
 await boot(page,{...empty(),plans:{'2026-09-17':[task()]}});
 await page.getByRole('button',{name:'Zahájit blok',exact:true}).click();await expect(page.getByRole('timer')).toHaveText('20:00');
 await page.clock.fastForward(120000);await expect(page.getByRole('timer')).toHaveText('18:00');
 await page.reload();await nav(page,'Soustředění');await expect(page.getByRole('timer')).toHaveText(/^17:5\d|18:00$/);
 await page.getByRole('button',{name:'Pozastavit',exact:true}).click();const paused=await page.getByRole('timer').innerText();await page.clock.fastForward(300000);await expect(page.getByRole('timer')).toHaveText(paused);
 await page.getByRole('button',{name:'Pokračovat',exact:true}).click();await page.getByRole('button',{name:'Pauza 5 min',exact:true}).click();await expect(page.getByRole('timer')).toHaveText('05:00');
 await page.getByRole('button',{name:'Zpět k úkolu',exact:true}).click();await expect(page.getByRole('timer')).toHaveText(paused);
 await page.getByRole('button',{name:'Hotovo',exact:true}).click();await expect(page.getByRole('heading',{name:'Dnes máš hotovo'})).toBeVisible();
 await page.getByRole('button',{name:'Vrátit zpět',exact:true}).click();await expect(page.getByRole('heading',{name:'Čtení',exact:true})).toBeVisible();
 expect((await data(page)).plans['2026-09-17'][0].completed).toBe(false);
});

test('future block is not labelled as current work',async({page})=>{
 await boot(page,{...empty(),plans:{'2026-09-17':[task({start:'14:00',end:'14:20'})]}});
 await expect(page.getByRole('heading',{name:'Teď máš volno'})).toBeVisible();await expect(page.locator('.df2-next')).toContainText('14:00');
});

test('routine editor creates alternate days and disable/delete preserves history',async({page})=>{
 const s={...empty(),routines:[{id:'r',title:'Jazyk',start:'18:00',duration:30,category:'Studium',priority:'normal',frequency:'daily',active:true,createdAt:'2026-09-01T00:00:00Z'}],plans:{'2026-09-16':[task({id:'past',title:'Jazyk',date:'2026-09-16',completed:true,routineId:'r',source:'routine'})]}};
 await boot(page,s);await nav(page,'Nastavení');await page.getByRole('checkbox',{name:'Aktivní Jazyk Každý den'}).uncheck();
 expect((await data(page)).plans['2026-09-16'][0].completed).toBe(true);expect((await data(page)).plans['2026-09-18']).toEqual([]);
 await page.locator('.df2-routine-edit').filter({hasText:'Jazyk'}).click();await page.getByRole('button',{name:'Smazat rutinu',exact:true}).click();expect((await data(page)).plans['2026-09-16']).toHaveLength(1);
 await page.getByRole('button',{name:'+ Nová rutina',exact:true}).click();const modal=page.getByRole('dialog');await modal.getByLabel('Název',{exact:true}).fill('Obden');await modal.getByLabel('Opakování',{exact:true}).selectOption('alternate');await modal.getByLabel('Od data',{exact:true}).fill('2026-09-18');await modal.getByRole('button',{name:'Uložit rutinu'}).click();
 await expect(page.locator('.df2-routines')).toContainText('Obden od 2026-09-18');const result=await data(page);expect(result.plans['2026-09-18'].some(t=>t.title==='Obden')).toBe(true);expect(result.plans['2026-09-19'].some(t=>t.title==='Obden')).toBe(false);expect(result.plans['2026-09-20'].some(t=>t.title==='Obden')).toBe(true);
});

test('milestone proposes preparation before committing it and never duplicates',async({page})=>{
 await boot(page,{...empty(),milestones:[{id:'g',title:'Zkouška',date:'2026-09-24',note:''}]});await nav(page,'Milníky');await page.locator('.df2-milestones article').click();
 await page.getByLabel('Celkem hodin přípravy').fill('3');await page.getByRole('button',{name:'Navrhnout přípravu'}).click();await expect(page.getByRole('heading',{name:'Návrh přípravy'})).toBeVisible();await expect(page.locator('.df2-preparation-list > div')).toHaveCount(3);expect(Object.values((await data(page)).plans).flat()).toHaveLength(0);
 await page.getByRole('button',{name:'Použít plán'}).click();expect(Object.values((await data(page)).plans).flat().filter(t=>t.milestoneId==='g')).toHaveLength(3);
 await page.locator('.df2-milestones article').click();await page.getByRole('button',{name:'Navrhnout přípravu'}).click();await expect(page.locator('.df2-preparation-list > div')).toHaveCount(0);await page.getByRole('button',{name:'Zpět',exact:true}).click();
});

test('backup download/import preserves data and recovery can be undone',async({page})=>{
 await boot(page,{...empty(),plans:{'2026-09-17':[task()]}});await nav(page,'Nastavení');
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Stáhnout zálohu',exact:true}).click();const download=await downloadPromise;const exported=JSON.parse(await readFile(await download.path(),'utf8'));expect(exported.data.plans['2026-09-17'][0].title).toBe('Čtení');
 const replacement={...empty(),milestones:[{id:'restored',title:'Obnovený milník',date:'2026-12-01',note:''}]};
 await page.getByLabel('Obnovit ze souboru',{exact:true}).setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(replacement))});await expect(page.getByRole('heading',{name:'Obnovit zálohu?'})).toBeVisible();expect((await data(page)).plans['2026-09-17']).toHaveLength(1);
 await page.getByRole('button',{name:'Nahradit data'}).click();expect((await data(page)).milestones[0].id).toBe('restored');await page.getByRole('button',{name:'Vrátit zpět',exact:true}).click();expect((await data(page)).plans['2026-09-17']).toHaveLength(1);
 await page.getByLabel('Obnovit ze souboru',{exact:true}).setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{broken')});await expect(page.locator('.df2-backup [role="alert"]')).toBeVisible();expect((await data(page)).plans['2026-09-17']).toHaveLength(1);
});

test('corrupt saved data is never silently replaced and can be recovered',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('dayframe-v1','{broken'));await page.goto(url);await expect(page.getByRole('heading',{name:'Nastavení',exact:true})).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('dayframe-v1'))).toBe('{broken');
 await page.getByLabel('Obnovit ze souboru',{exact:true}).setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(empty()))});await page.getByRole('button',{name:'Nahradit data'}).click();expect((await data(page)).schema).toBe(5);expect(await page.evaluate(()=>localStorage.getItem('dayframe-v1-recovery'))).toBe('{broken');
});

test('mobile screens and modal remain within viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});await boot(page);await nav(page,'Nastavení');await page.getByRole('button',{name:'+ Nová rutina',exact:true}).click();const box=await page.getByRole('dialog').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(391);
});
