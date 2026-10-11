"use client";

import { useCallback, useEffect, useState } from "react";
import { emptyGymStore, readGymStore, saveGymStore, GYM_STORAGE_KEY, GYM_SYNC_EVENT, type GymStore } from "@/lib/dayframe-gym";

export function useGymStore() {
  const [store, setStore] = useState<GymStore>(()=>emptyGymStore());
  const [hydrated, setHydrated] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");

  useEffect(()=>{
    const sync=()=>{
      const value=readGymStore();
      setStore(value.store);setBlocked(value.blocked);setHydrated(true);
    };
    sync();
    const storage=(e:StorageEvent)=>{if(!e.key || e.key===GYM_STORAGE_KEY)sync();};
    window.addEventListener(GYM_SYNC_EVENT,sync);window.addEventListener("storage",storage);
    return ()=>{window.removeEventListener(GYM_SYNC_EVENT,sync);window.removeEventListener("storage",storage);};
  },[]);

  const persist=useCallback((change:(current:GymStore)=>GymStore)=>{
    const current=readGymStore();
    if(current.blocked){setBlocked(true);setError("Tréninková data nelze bezpečně načíst. Ukládání je zablokované.");return false;}
    const next=change(current.store);
    if(!saveGymStore(next)){setError("Změny se nepodařilo uložit.");return false;}
    setStore(next);setError("");return true;
  },[]);

  return {store,hydrated,blocked,error,persist};
}
