"use client";
import { useCallback, useEffect, useState } from "react";
import { emptySupplementStore, readSupplementStore, saveSupplementStore,
  SUPPLEMENTS_STORAGE_KEY, SUPPLEMENTS_SYNC_EVENT, type SupplementStore } from "@/lib/dayframe-supplements";

export function useSupplementStore(){
  const [store,setStore]=useState<SupplementStore>(()=>emptySupplementStore());
  const [hydrated,setHydrated]=useState(false);
  const [blocked,setBlocked]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    const sync=()=>{const result=readSupplementStore();setStore(result.store);setBlocked(result.blocked);setHydrated(true);};
    sync();
    const onStorage=(event:StorageEvent)=>{if(!event.key || event.key===SUPPLEMENTS_STORAGE_KEY)sync();};
    window.addEventListener(SUPPLEMENTS_SYNC_EVENT,sync);
    window.addEventListener("storage",onStorage);
    return ()=>{window.removeEventListener(SUPPLEMENTS_SYNC_EVENT,sync);window.removeEventListener("storage",onStorage);};
  },[]);
  const persist=useCallback((fn:(store:SupplementStore)=>SupplementStore)=>{
    const previous=readSupplementStore();
    if(previous.blocked){setBlocked(true);setError("Data nelze bezpečně načíst. Ukládání je zablokované.");return false;}
    const next=fn(previous.store);
    if(!saveSupplementStore(next)){setError("Změnu se nepodařilo uložit. Zkontroluj údaje nebo místo v úložišti.");return false;}
    setStore(next);setError("");return true;
  },[]);
  return {store,hydrated,blocked,error,persist};
}