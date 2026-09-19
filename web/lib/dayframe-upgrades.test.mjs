import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, materializeRange, deleteRoutine, setRoutineActive, retryBacklog, replanWeek, moveTask, toggleTask, updateTask, saveRoutine, routineLabel, planMilestone, milestoneProgress, addTask } from './dayframe-calendar.ts';
import { resolveSmartDraft } from './dayframe-smart-input.ts';
import { loadCalendar, saveCalendar, decodeBackup, encodeBackup, STORAGE_KEY, BACKUP_KEY } from './dayframe-storage.ts';
import { focusRemaining, pauseFocus, readFocus, breakFocus, resumeWork, extendFocus } from './dayframe-focus.ts';
const now = new Date('2026-09-17T10:00:00');
const state = () => ({ ...createEmptyState(), plans: {}, routines: [], milestones: [] });
const task = (patch = {}) => ({ id:'t', title:'Matika', date:'2026-09-18', duration:60, start:'17:00', end:'18:00', priority:'normal', category:'Studium', mode:'flexible', autoScheduled:true, requestedStart:undefined, completed:false, source:'user', createdAt:now.toISOString(), ...patch });
const routine = (patch = {}) => ({ id:'r', title:'Čtení', start:'20:00', duration:30, category:'Studium', priority:'normal', frequency:'daily', active:true, createdAt:now.toISOString(), ...patch });

test('deleting and disabling routines keeps history and started/completed work', () => {
 const s={...state(),routines:[routine()], plans:{'2026-09-16':[task({date:'2026-09-16',completed:true,routineId:'r'})],'2026-09-17':[task({id:'active',date:'2026-09-17',start:'09:30',end:'10:30',routineId:'r'})],'2026-09-18':[task({routineId:'r'})]}};
 for(const next of [deleteRoutine(s,'r',now),setRoutineActive(s,'r',false,now)]){
 assert.deepEqual(next.plans['2026-09-16'],s.plans['2026-09-16']); assert.deepEqual(next.plans['2026-09-17'],s.plans['2026-09-17']); assert.equal(next.plans['2026-09-18'].length,0);
 }
 const resumed=setRoutineActive(setRoutineActive(s,'r',false,now),'r',true,now);
 assert.equal(resumed.plans['2026-09-18'].length,1);
});
test('history cannot be created, edited, moved or replanned',()=>{
 const s={...state(), routines:[routine()],plans:{'2026-09-16':[task({date:'2026-09-16',autoScheduled:true,completed:true})]}};
 assert.deepEqual(materializeRange(s,'2026-09-01','2026-09-16',now),s);
 assert.ok(moveTask(s,'t','2026-09-18','15:00',now).error);
 assert.ok(updateTask(s,'t',{title:'changed'},now).error);
 assert.equal(toggleTask(s,'t',now).plans['2026-09-16'][0].completed,true);
 assert.deepEqual(replanWeek(s,new Date('2026-09-14T12:00'),now).plans['2026-09-16'],s.plans['2026-09-16']);
});
test('retry backlog respects exact time, deadline, date and never duplicates',()=>{
 const pending=task({start:undefined,end:undefined,requestedStart:'13:15',duration:30,dateLocked:true,dueDate:'2026-09-18'});
 const s={...state(),backlog:[pending]}; const next=retryBacklog(s,now,now,'t');
 assert.equal(next.backlog.length,0); assert.equal(next.plans['2026-09-18'][0].start,'13:15');
 assert.equal(Object.values(retryBacklog(next,now,now).plans).flat().filter(t=>t.id==='t').length,1);
 const expired={...s,backlog:[{...pending,dueDate:'2026-09-16'}]};assert.equal(retryBacklog(expired,now,now).backlog.length,1);
});
test('a failed exact-time placement stays waiting and can be edited',()=>{
 const s={...state(),plans:{'2026-09-18':[task({id:'busy'})]},backlog:[task({id:'waiting',requestedStart:'17:00',start:undefined,end:undefined,dateLocked:true})]};
 const retry=retryBacklog(s,now,now); assert.equal(retry.backlog.length,1);
 const edited=updateTask(retry,'waiting',{date:'2026-09-19',start:'16:00'},now);
 assert.equal(edited.error,undefined);assert.equal(edited.state.backlog.length,0);assert.equal(edited.task.start,'16:00');
});
test('explicit replan does not move missed auto tasks to another day',()=>{
 const missed=task({date:'2026-09-17',start:'09:00',end:'09:30',duration:30,autoScheduled:true});
 const s={...state(),plans:{'2026-09-17':[missed]}};
 assert.deepEqual(replanWeek(s,now,now).plans['2026-09-17'],[missed]);
});
test('manual defaults and cleared fields override parsed hints in preview and submission',()=>{
 const draft={title:'Matika zítra 17:30 60 min urgent',date:'',start:'',duration:45,priority:'normal',deadlineTime:'22:30'};
 const parsed=resolveSmartDraft(draft,{},'2026-09-17','2026-09-18'); assert.equal(parsed.duration,60);assert.equal(parsed.start,'17:30');assert.equal(parsed.date,'2026-09-18');assert.equal(parsed.priority,'high');
 const manual=resolveSmartDraft(draft,{duration:true,priority:true,start:true,date:true},'2026-09-17','2026-09-18');
 assert.equal(manual.duration,45);assert.equal(manual.priority,'normal');assert.equal(manual.start,'');assert.equal(manual.date,'');
});
test('alternate-day recurrence crosses weeks and DST without resetting',()=>{
 const s={...state(),routines:[routine({frequency:'alternate',startsOn:'2026-10-24'})]};
 const n=materializeRange(s,'2026-10-24','2026-11-02',now);
 assert.deepEqual(Object.keys(n.plans).filter(d=>n.plans[d].length),['2026-10-24','2026-10-26','2026-10-28','2026-10-30','2026-11-01']);
});
test('routine edit validates collisions and retains historical completed occurrences',()=>{
 const past=task({date:'2026-09-16',routineId:'r',completed:true});
 const s={...state(),routines:[routine()],plans:{'2026-09-16':[past],'2026-09-18':[task({start:'18:00',end:'19:00',id:'busy'})]}};
 assert.ok(saveRoutine(s,routine({start:'18:00',startsOn:'2026-09-18'}),now).error);
 const good=saveRoutine(s,routine({start:'19:30',startsOn:'2026-09-18',frequency:'weekly',weekdays:[1,3,5]}),now);
 assert.equal(good.error,undefined);assert.deepEqual(good.state.plans['2026-09-16'],[past]);assert.equal(routineLabel(good.state.routines[0]),'Po, St, Pá');
});
test('a newly added repeat task is linked and not duplicated on materialization',()=>{
 const a=addTask(state(),{title:'Read',duration:30,date:'2026-09-18',start:'20:00',priority:'normal',category:'Studium',repeat:'alternate'},now);
 const n=materializeRange(a.state,'2026-09-18','2026-09-22',now);assert.equal(n.plans['2026-09-18'].length,1);assert.ok(n.plans['2026-09-18'][0].routineId);assert.equal(n.plans['2026-09-19'].length,0);
});
test('milestone proposal is immutable, spread over days, linked and idempotent',()=>{
 const s={...state(),milestones:[{id:'goal',title:'Zkouška',date:'2026-09-21',note:'',targetMinutes:180,blockMinutes:60}]};
 const p=planMilestone(s,'goal',now);assert.equal(Object.values(s.plans).flat().length,0);assert.equal(p.tasks.length,3);assert.equal(new Set(p.tasks.map(t=>t.date)).size,3);assert.ok(p.tasks.every(t=>t.milestoneId==='goal'));
 assert.equal(planMilestone(p.state,'goal',now).tasks.length,0);
 const done=toggleTask(p.state,p.tasks[0].id,now);assert.equal(milestoneProgress(done,'goal',now).completed,60);
});
test('preparation accounts for existing and overdue linked tasks without duplicates',()=>{
 const s={...state(),milestones:[{id:'g',title:'Exam',date:'2026-09-20',note:'',targetMinutes:60}],plans:{'2026-09-16':[task({date:'2026-09-16',milestoneId:'g'})]}};
 assert.equal(planMilestone(s,'g',now).tasks.length,0);assert.equal(milestoneProgress(s,'g',now).waiting,60);
});
test('impossible preparation reports unscheduled minutes without collisions',()=>{
 const s={...state(),milestones:[{id:'g',title:'Exam',date:'2026-09-17',note:'',targetMinutes:60}],plans:{'2026-09-17':[task({date:'2026-09-17',duration:750,start:'10:00',end:'22:30'})]}};
 const p=planMilestone(s,'g',now);assert.equal(p.tasks.length,0);assert.equal(p.remaining,60);
});
test('corrupt and future-version storage remains intact; valid backup round trips all data',()=>{
 const values=new Map([[STORAGE_KEY,'{broken']]); const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 assert.ok(loadCalendar(storage).blocked);assert.ok(saveCalendar(storage,state()));assert.equal(values.get(STORAGE_KEY),'{broken');
 const s={...state(),plans:{'2026-09-18':[task({milestoneId:'g'})]},routines:[routine({frequency:'alternate',startsOn:'2026-09-18'})]};
 assert.deepEqual(decodeBackup(encodeBackup(s)),s);
 assert.throws(()=>decodeBackup('{"schema":99}')); assert.throws(()=>decodeBackup('{"schema":5,"plans":[]}'));
});
test('unchanged saves do not overwrite the previous automatic backup',()=>{
 const s=state();const values=new Map([[STORAGE_KEY,JSON.stringify(s)],[BACKUP_KEY,'older']]);const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 assert.equal(saveCalendar(storage,s),'');assert.equal(values.get(BACKUP_KEY),'older');
 const n={...s,milestones:[{id:'g',title:'Exam',date:'2026-10-01',note:''}]};assert.equal(saveCalendar(storage,n),'');assert.deepEqual(JSON.parse(values.get(BACKUP_KEY)),s);
});
test('quota failure is surfaced and does not discard current saved data',()=>{
 const original=JSON.stringify(state());const storage={getItem:()=>original,setItem:()=>{throw new Error('Quota');}};
 assert.ok(saveCalendar(storage,{...state(),milestones:[]} ) === '');
 assert.ok(saveCalendar(storage,{...state(),routines:[routine()]}));assert.equal(storage.getItem(),original);
});
test('focus survives background time, reload, pause, break and extension',()=>{
 const t=100000;const s={taskId:'t',title:'Read',category:'Studium',totalSeconds:1200,remainingSeconds:1200,endsAt:t+1200000,mode:'work'};
 const read=readFocus(JSON.stringify(s));assert.equal(focusRemaining(read,t+120000),1080);
 const paused=pauseFocus(read,t+120000);assert.equal(focusRemaining(paused,t+800000),1080);
 const rest=breakFocus({...paused,endsAt:t+1080000},t);assert.equal(focusRemaining(rest,t+60000),240);
 assert.equal(focusRemaining(resumeWork(rest,t+60000),t+60000),1080);
 assert.equal(focusRemaining(extendFocus(paused,t),t),1680);
 assert.equal(focusRemaining(read,t+2000000),0);assert.equal(readFocus('broken'),null);
});
