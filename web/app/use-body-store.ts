"use client";
import { useCallback, useEffect, useState } from "react";
import { BODY_STORAGE_KEY, BODY_SYNC_EVENT, emptyBodyStore, readBodyStore, saveBodyStore, type BodyStore } from "@/lib/dayframe-body";

export function useBodyStore() {
  const [store,setStore]=useState<BodyStore>(()=>emptyBodyStore());
  const [hydrated,setHydrated]=useState(false);
  const [blocked,setBlocked]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    const sync=()=>{const state=readBodyStore();setStore(state.store);setBlocked(state.blocked);setHydrated(true);};
    sync();
    const storage=(e:StorageEvent)=>{if(!e.key||e.key===BODY_STORAGE_KEY)sync();};
    window.addEventListener(BODY_SYNC_EVENT,sync);
    window.addEventListener("storage",storage);
    return ()=>{window.removeEventListener(BODY_SYNC_EVENT,sync);window.removeEventListener("storage",storage);};
  },[]);
  const persist=useCallback((change:(current:BodyStore)=>BodyStore)=>{
    const state=readBodyStore();
    if(state.blocked){setBlocked(true);setError("Poškozená nebo neznámá data měření. Ukládání je zablokované.");return false;}
    const next=change(state.store);
    if(!saveBodyStore(next)){setError("Změnu se nepodařilo bezpečně uložit.");return false;}
    setStore(next);setError("");return true;
  },[]);
  return {store,hydrated,blocked,error,persist};
}