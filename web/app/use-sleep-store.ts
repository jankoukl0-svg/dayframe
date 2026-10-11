"use client";
import {useCallback,useEffect,useState} from "react";
import {SLEEP_STORAGE_KEY,SLEEP_SYNC_EVENT,emptySleepStore,readSleepStore,saveSleepStore,type SleepStore} from "@/lib/dayframe-sleep";

export function useSleepStore(){
  const [store,setStore]=useState<SleepStore>(()=>emptySleepStore());
  const [hydrated,setHydrated]=useState(false);
  const [blocked,setBlocked]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    const sync=()=>{
      const current=readSleepStore();
      setStore(current.store);setBlocked(current.blocked);setHydrated(true);
    };
    sync();
    const storage=(event:StorageEvent)=>{if(!event.key||event.key===SLEEP_STORAGE_KEY)sync();};
    window.addEventListener(SLEEP_SYNC_EVENT,sync);
    window.addEventListener("storage",storage);
    return()=>{window.removeEventListener(SLEEP_SYNC_EVENT,sync);window.removeEventListener("storage",storage);};
  },[]);
  const persist=useCallback((change:(current:SleepStore)=>SleepStore|null)=>{
    const current=readSleepStore();
    if(current.blocked){setBlocked(true);setError("Data spánku nelze bezpečně načíst. Ukládání je zablokované.");return false;}
    const next=change(current.store);
    if(next===null||next===current.store){setError("Časy byly současně změněny v jiné záložce. Zkontroluj je a ulož znovu.");return false;}
    if(!saveSleepStore(next)){setError("Změnu se nepodařilo bezpečně uložit.");return false;}
    setStore(next);setError("");return true;
  },[]);
  return {store,hydrated,blocked,error,persist};
}
