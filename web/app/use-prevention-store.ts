"use client";
import {useCallback,useEffect,useState} from "react";
import {
  PREVENTION_STORAGE_KEY,PREVENTION_SYNC_EVENT,emptyPreventionStore,
  readPreventionStore,savePreventionStore,type PreventionStore
} from "@/lib/dayframe-prevention";

export function usePreventionStore(){
  const [store,setStore]=useState<PreventionStore>(()=>emptyPreventionStore());
  const [hydrated,setHydrated]=useState(false);
  const [blocked,setBlocked]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    const sync=()=>{
      const state=readPreventionStore();
      setStore(state.store);setBlocked(state.blocked);setHydrated(true);
    };
    sync();
    const onStorage=(event:StorageEvent)=>{if(!event.key||event.key===PREVENTION_STORAGE_KEY)sync();};
    window.addEventListener(PREVENTION_SYNC_EVENT,sync);
    window.addEventListener("storage",onStorage);
    return ()=>{
      window.removeEventListener(PREVENTION_SYNC_EVENT,sync);
      window.removeEventListener("storage",onStorage);
    };
  },[]);
  const persist=useCallback((change:(current:PreventionStore)=>PreventionStore|null)=>{
    const latest=readPreventionStore();
    if(latest.blocked){
      setBlocked(true);setError("Neznámá nebo poškozená data prevence. Ukládání je zablokované.");return false;
    }
    const next=change(latest.store);
    if(!next){setError("Změnu nelze bezpečně uložit. Zkontroluj aktuální záznam.");return false;}
    if(!savePreventionStore(next)){setError("Změnu se nepodařilo uložit.");return false;}
    setStore(next);setError("");return true;
  },[]);
  return {store,hydrated,blocked,error,persist};
}
