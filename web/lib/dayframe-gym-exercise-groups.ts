import type {GymExercise} from "./dayframe-gym";

export const GYM_EXERCISE_GROUPS = ["Push","Pull","Lower","Core","Ostatní"] as const;
export type GymExerciseGroup = typeof GYM_EXERCISE_GROUPS[number];
export type GymExerciseFilter = GymExerciseGroup | "Vše";

export function gymExerciseGroup(exercise:Pick<GymExercise,"muscle">):GymExerciseGroup {
  const m=exercise.muscle.trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
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

export function searchGymExercises(
  exercises:readonly GymExercise[],query:string,filter:GymExerciseFilter="Vše"
):{group:GymExerciseGroup;items:GymExercise[]}[]{
  const needle=normalize(query);
  return GYM_EXERCISE_GROUPS.map(group=>({
    group,items:exercises.filter(ex=>{
      if(gymExerciseGroup(ex)!==group || (filter!=="Vše" && filter!==group))return false;
      if(!needle)return true;
      const hay=normalize([ex.name,ex.muscle,ex.equipment].join(" "));
      // Accept both full phrases and individual words separated by other terms:
      // "kladivove zdvihy" matches "Kladivové bicepsové zdvihy".
      return needle.split(" ").every(term=>hay.includes(term));
    }).sort((a,b)=>a.name.localeCompare(b.name,"cs")),
  })).filter(bucket=>bucket.items.length>0);
}
