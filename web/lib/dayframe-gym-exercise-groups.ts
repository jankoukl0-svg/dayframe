import type {GymExercise} from "./dayframe-gym";

export const GYM_EXERCISE_GROUPS = ["Push","Pull","Lower","Core","Ostatní"] as const;
export type GymExerciseGroup = typeof GYM_EXERCISE_GROUPS[number];
export type GymExerciseFilter = GymExerciseGroup | "Vše";

export function gymExerciseGroup(exercise:Pick<GymExercise,"id"|"muscle">):GymExerciseGroup {
  const m=exercise.muscle.trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  // These two movements train posterior delts and belong in Pull even in
  // existing saved stores, where their original muscle was "Ramena".
  if(exercise.id==="reverse-pec-deck"||exercise.id==="face-pull")return "Pull";
  if(["zadni ramena","zadni delty","posterior delts","rear delts"].includes(m))return "Pull";
  if(["hrudnik","ramena","triceps"].includes(m))return "Push";
  if(["zada","biceps","trapezy"].includes(m))return "Pull";
  if(["nohy","hamstringy","hyzde","vnitrni stehna","lytka","kvadricepsy"].includes(m))return "Lower";
  if(["core","bricho","brucho","brisni svaly"].includes(m))return "Core";
  return "Ostatní";
}

export function defaultGymExerciseFilter(dayName:string):GymExerciseFilter {
  const name=dayName.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  if(/^(push|tlaky)(\b|$)/.test(name))return "Push";
  if(/^(pull|tahy)(\b|$)/.test(name))return "Pull";
  if(/^(lower|legs|nohy)(\b|$)/.test(name))return "Lower";
  if(/^(core|bricho)(\b|$)/.test(name))return "Core";
  return "Vše";
}

const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLocaleLowerCase("cs").replace(/\s+/g," ").trim();

const EXERCISE_ALIASES:Record<string,readonly string[]>={
  "pec-deck":[
    "pecdec","pec dec","pecdeck","peck deck",
    "motylek na prsa","butterfly machine","chest fly machine",
  ],
  "reverse-pec-deck":[
    "pecdec","pec dec","pecdeck","peck deck",
    "pecdec na zadni ramena","pec dec na zadni ramena",
    "pec deck na zadni ramena","reverse pec deck",
    "rear delt pec deck","rear delt fly","reverse fly machine",
    "obraceny motylek","rozpazovani na zadni ramena",
  ],
};

export function matchesGymExerciseSearch(exercise:GymExercise,query:string):boolean{
  const needle=normalize(query);
  if(!needle)return true;
  const hay=normalize([exercise.name,exercise.muscle,exercise.equipment,
    ...(EXERCISE_ALIASES[exercise.id]??[])].join(" "));
  // Multiple terms may have words between them; spelling variants include
  // "pecdec", "pec dec", and "pec deck".
  return needle.split(" ").every(term=>hay.includes(term));
}

export function searchGymExercises(
  exercises:readonly GymExercise[],query:string,filter:GymExerciseFilter="Vše"
):{group:GymExerciseGroup;items:GymExercise[]}[]{
  const needle=normalize(query);
  return GYM_EXERCISE_GROUPS.map(group=>({
    group,items:exercises.filter(ex=>{
      if(gymExerciseGroup(ex)!==group || (filter!=="Vše" && filter!==group))return false;
      return matchesGymExerciseSearch(ex,needle);
    }).sort((a,b)=>a.name.localeCompare(b.name,"cs")),
  })).filter(bucket=>bucket.items.length>0);
}
