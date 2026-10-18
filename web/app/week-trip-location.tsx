"use client";
import {useEffect,useRef,useState} from "react";
import {readTravelStore,saveTravelStore,travelDirectionsUrl,
  type TravelPoint,type TravelMode,type TravelLeg,TRAVEL_MODE_LABELS} from "@/lib/dayframe-travel";

export type TripTarget={key:string;title:string;date:string;start:string;initialOffsite?:boolean};
const CSS_URL="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const JS_URL="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
let loader:Promise<any>|undefined;
function getLeaflet():Promise<any>{
  if((window as any).L)return Promise.resolve((window as any).L);
  if(loader)return loader;
  if(!document.querySelector('link[data-df2-map]')){
    const css=document.createElement("link");css.rel="stylesheet";css.href=CSS_URL;css.dataset.df2Map="true";css.crossOrigin="anonymous";css.integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";document.head.appendChild(css);
  }
  loader=new Promise((resolve,reject)=>{
    const script=document.createElement("script");script.src=JS_URL;script.async=true;script.crossOrigin="anonymous";script.integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
    script.onload=()=>resolve((window as any).L);
    script.onerror=()=>reject(new Error("Leaflet unavailable"));
    document.head.appendChild(script);
  }).catch(e=>{loader=undefined;throw e;});
  return loader;
}
function MapPicker({point,setPoint}:{point?:TravelPoint;setPoint:(v:TravelPoint|undefined)=>void}){
  const container=useRef<HTMLDivElement>(null);
  const map=useRef<any>(null),marker=useRef<any>(null),latest=useRef(setPoint);
  const [text,setText]=useState(""),[results,setResults]=useState<TravelPoint[]>([]);
  const [hint,setHint]=useState("Načítám mapu…"),[busy,setBusy]=useState(false);
  const [latDraft,setLatDraft]=useState("");
  const [lonDraft,setLonDraft]=useState("");
  function commitCoordinates(lat:string,lon:string){
    if(!lat.trim()||!lon.trim())return;
    const a=Number(lat),b=Number(lon);
    if(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180)
      setPoint({lat:a,lon:b,label:"Vybrané souřadnice"});
  }
  useEffect(()=>{latest.current=setPoint},[setPoint]);
  useEffect(()=>{
    let canceled=false;
    getLeaflet().then(L=>{
      if(canceled||!container.current||map.current)return;
      const m=L.map(container.current,{scrollWheelZoom:false})
        .setView(point?[point.lat,point.lon]:[49.8,15.25],point?15:7);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
        maxZoom:19,
        attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(m);
      m.on("click",(event:any)=>{
        latest.current({lat:event.latlng.lat,lon:event.latlng.lng,label:"Vybraný bod na mapě"});
      });
      map.current=m;setHint("Klikni do mapy nebo najdi adresu.");
      window.requestAnimationFrame(()=>m.invalidateSize());
    }).catch(()=>{if(!canceled)setHint("Mapa se nenačetla. Použij hledání nebo ruční souřadnice.");});
    return ()=>{canceled=true;map.current?.remove();map.current=null;marker.current=null;};
  // Picker lives only while modal is opened; never automatically geolocates user.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{
    const m=map.current,L=(window as any).L;if(!m||!L)return;
    if(!point){marker.current?.remove();marker.current=null;return;}
    const coords:[number,number]=[point.lat,point.lon];
    if(!marker.current)marker.current=L.marker(coords).addTo(m);
    else marker.current.setLatLng(coords);
    m.panTo(coords);
  },[point,hint]);
  async function search(){
    if(text.trim().length<3)return;
    setBusy(true);setResults([]);setHint("Hledám místo…");
    try{
      const u=new URL("https://nominatim.openstreetmap.org/search");
      u.searchParams.set("format","jsonv2");u.searchParams.set("q",text.trim());
      u.searchParams.set("limit","5");u.searchParams.set("accept-language","cs");
      const controller=new AbortController(),tid=window.setTimeout(()=>controller.abort(),9000);
      let response:Response;
      try{response=await fetch(u.toString(),{signal:controller.signal});}finally{window.clearTimeout(tid);}
      if(!response.ok)throw new Error("Geocoding unavailable");
      const json=await response.json() as Array<{lat:string;lon:string;display_name:string}>;
      const points=json.map(x=>({lat:Number(x.lat),lon:Number(x.lon),label:x.display_name.slice(0,300)}))
        .filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
      setResults(points);setHint(points.length?"Vyber místo z výsledků.":"Místo nenalezeno. Zkus přesnější adresu.");
    }catch{setHint("Vyhledávání není dostupné; vyber bod na mapě nebo souřadnice.");}
    finally{setBusy(false);}
  }
  return <div className="df2-travel-map-picker">
    <form className="df2-travel-search" onSubmit={e=>{e.preventDefault();void search();}}>
      <input aria-label="Vyhledat adresu nebo místo" value={text} minLength={3}
        placeholder="Podnik, ulice, město…" onChange={e=>setText(e.target.value)}/>
      <button type="submit" disabled={busy||text.trim().length<3}>{busy?"Hledám…":"Hledat"}</button>
    </form>
    {results.length>0&&<div className="df2-travel-search-results" aria-label="Nalezené adresy">
      {results.map((x,i)=><button key={i} type="button" onClick={()=>{setPoint(x);setResults([]);}}>{x.label}</button>)}
    </div>}
    <div ref={container} className="df2-travel-map" aria-label="Mapa – kliknutím vyber bod"/>
    <p className="df2-travel-hint" role="status">{hint} Podklady © OpenStreetMap.</p>
    {point?<div className="df2-travel-coords-read">
      <small>Zvolené souřadnice: {point.lat.toFixed(6)}, {point.lon.toFixed(6)}</small>
      <button type="button" onClick={()=>{setLatDraft(String(point.lat));setLonDraft("");setPoint(undefined);}}>
        Upravit souřadnice
      </button>
    </div>:<div className="df2-travel-coords">
      <label>Šířka<input type="number" aria-label="Zeměpisná šířka" min="-90" max="90" step="any"
        value={latDraft} onChange={e=>{setLatDraft(e.target.value);commitCoordinates(e.target.value,lonDraft);}}/></label>
      <label>Délka<input type="number" aria-label="Zeměpisná délka" min="-180" max="180" step="any"
        value={lonDraft} onChange={e=>{setLonDraft(e.target.value);commitCoordinates(latDraft,e.target.value);}}/></label>
    </div>}
    {point&&<label>Popis vybraného místa<input aria-label="Popis vybraného místa" maxLength={300} value={point.label}
      onChange={e=>setPoint({...point,label:e.target.value})}/></label>}
  </div>;
}
export function WeekTripLocationModal({target,onClose,onSaved}:{
  target:TripTarget;onClose:()=>void;onSaved:()=>void;
}){
  const data=readTravelStore();
  const dialogRef=useRef<HTMLElement>(null);
  const closeRef=useRef(onClose);
  useEffect(()=>{closeRef.current=onClose;},[onClose]);
  useEffect(()=>{
    const opener=document.activeElement as HTMLElement|null;
    window.requestAnimationFrame(()=>dialogRef.current?.querySelector<HTMLElement>('input[type="checkbox"]')?.focus());
    const handler=(event:KeyboardEvent)=>{
      const dialog=dialogRef.current;
      if(!dialog)return;
      if(event.key==="Escape"){
        event.preventDefault();event.stopImmediatePropagation();
        closeRef.current();return;
      }
      if(event.key!=="Tab")return;
      const candidates=[...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],textarea:not([disabled])')]
        .filter(node=>node.getClientRects().length>0);
      if(!candidates.length)return;
      const i=candidates.indexOf(document.activeElement as HTMLElement);
      const index=i<0?(event.shiftKey?candidates.length-1:0)
        :(i+(event.shiftKey?-1:1)+candidates.length)%candidates.length;
      event.preventDefault();event.stopPropagation();
      candidates[index].focus();
    };
    document.addEventListener("keydown",handler,true);
    return ()=>{document.removeEventListener("keydown",handler,true);opener?.focus();};
  },[]);
  const current=data.store.blocks[target.key];
  const [offsite,setOffsite]=useState(Boolean(current)||Boolean(target.initialOffsite));
  const [destination,setDestination]=useState<TravelPoint|undefined>(current?.place);
  const [origin,setOrigin]=useState<TravelPoint|undefined>(data.store.origin);
  const [mapTarget,setMapTarget]=useState<"destination"|"origin"|number>("destination");
  const [mixed,setMixed]=useState(Boolean(current?.legs?.length));
  const [legs,setLegs]=useState<Array<{mode:TravelMode;minutes:string;via?:TravelPoint}>>(
    ()=>current?.legs?.map(leg=>({...leg,minutes:String(leg.minutes)}))
      ??[{mode:"driving",minutes:"",via:undefined},{mode:"walking",minutes:""}]);
  const selectedPoint=mapTarget==="origin"?origin:mapTarget==="destination"?destination:legs[mapTarget]?.via;
  function updateSelectedPoint(point:TravelPoint|undefined){
    if(mapTarget==="origin")setOrigin(point);
    else if(mapTarget==="destination")setDestination(point);
    else setLegs(previous=>previous.map((leg,index)=>index===mapTarget?{...leg,via:point}:leg));
  }
  const [mode,setMode]=useState<TravelMode>(current?.mode??"driving");
  const [buffer,setBuffer]=useState(current?.bufferMinutes??15);
  const [typical,setTypical]=useState(current?.typicalMinutes?.toString()??"");
  const [error,setError]=useState("");
  const [googleAvailable,setGoogleAvailable]=useState(false);
  const [googleAccess,setGoogleAccess]=useState("");
  const [googleLoading,setGoogleLoading]=useState(false);
  const [googleError,setGoogleError]=useState("");
  const [googleEstimates,setGoogleEstimates]=useState<Array<{minutes:number;distanceMeters:number}>|null>(null);
  // The separate access secret is session-scoped. Neither it nor the Google API key is persisted with the travel plan.
  useEffect(()=>{
    try{setGoogleAccess(sessionStorage.getItem("dayframe-routes-access-session")??"");}catch{}
    const controller=new AbortController();
    fetch("/api/google-travel",{signal:controller.signal,cache:"no-store"})
      .then(response=>response.ok?response.json():null)
      .then(value=>{if(!controller.signal.aborted)setGoogleAvailable((value as {available?:boolean}|null)?.available===true);})
      .catch(()=>{if(!controller.signal.aborted)setGoogleAvailable(false);});
    return ()=>controller.abort();
  },[]);
  const routeParts=origin&&destination
    ?mixed
      ?legs.every((leg,index)=>index===legs.length-1||Boolean(leg.via))
        ?legs.map((leg,index)=>({
          from:index===0?origin:legs[index-1].via!,
          to:index===legs.length-1?destination:leg.via!,
          mode:leg.mode,
        }))
        :null
      :[{from:origin,to:destination,mode}]
    :null;
  // Never transmit user-written place labels or use them to trigger paid recalculations.
  const routeSignature=routeParts?JSON.stringify(routeParts.map(part=>({
    from:{lat:part.from.lat,lon:part.from.lon},
    to:{lat:part.to.lat,lon:part.to.lon},
    mode:part.mode,
  }))):"";
  useEffect(()=>{
    setGoogleEstimates(null);
    setGoogleError("");
    if(!offsite||!routeSignature||!googleAvailable||googleAccess.length<20){
      setGoogleLoading(false);return;
    }
    const controller=new AbortController();
    const timer=window.setTimeout(async()=>{
      setGoogleLoading(true);
      try{
        const parts=JSON.parse(routeSignature) as Array<{from:TravelPoint;to:TravelPoint;mode:TravelMode}>;
        // Explicit map edits and mode changes trigger a new calculation. Never silently poll paid APIs.
        const calculated=await Promise.all(parts.map(async part=>{
          const response=await fetch("/api/google-travel",{
            method:"POST",signal:controller.signal,cache:"no-store",
            headers:{"Content-Type":"application/json","Authorization":"Bearer "+googleAccess},
            body:JSON.stringify(part),
          });
          const result=await response.json() as {minutes?:number;distanceMeters?:number;error?:string};
          if(!response.ok||!Number.isInteger(result.minutes)||typeof result.distanceMeters!=="number")
            throw Error(result.error??"Google Maps trasu nevypočítaly.");
          return {minutes:result.minutes!,distanceMeters:result.distanceMeters};
        }));
        if(!controller.signal.aborted)setGoogleEstimates(calculated);
      }catch(e){
        if(!controller.signal.aborted)setGoogleError(e instanceof Error?e.message:"Nepodařilo se vypočítat trasu.");
      }finally{if(!controller.signal.aborted)setGoogleLoading(false);}
    },800);
    return ()=>{window.clearTimeout(timer);controller.abort();};
  },[offsite,routeSignature,googleAvailable,googleAccess]);
  const googleTotal=googleEstimates?.reduce((sum,item)=>sum+item.minutes,0);
  const googleDistance=googleEstimates?.reduce((sum,item)=>sum+item.distanceMeters,0);
  function submit(){
    const latest=readTravelStore();
    if(latest.blocked){setError("Uložená data o cestách nelze bezpečně změnit.");return;}
    // Removing a trip must never depend on unsaved or incomplete leg drafts.
    if(!offsite){
      const blocks={...latest.store.blocks};
      delete blocks[target.key];
      if(!saveTravelStore({...latest.store,blocks})){setError("Místo se nepodařilo odebrat.");return;}
      onSaved();onClose();return;
    }
    if(!destination||!destination.label.trim()){setError("Nejprve vyber místo konání.");return;}
    if((destination&&destination.label.trim().length>300)||(origin&&origin.label.trim().length>300)){
      setError("Název místa může mít maximálně 300 znaků.");return;
    }
    const stages:TravelLeg[]|undefined=mixed?legs.map(leg=>({
      mode:leg.mode,minutes:leg.minutes.trim()?Number(leg.minutes):NaN,via:leg.via,
    })):undefined;
    const total=stages?.reduce((sum,leg)=>sum+leg.minutes,0);
    const typicalMinutes=mixed?total:(typical.trim()?Number(typical):undefined);
    if(!Number.isInteger(buffer)||buffer<0||buffer>180||
      (typicalMinutes!==undefined&&(!Number.isInteger(typicalMinutes)||typicalMinutes<1||typicalMinutes>1440))){
      setError("Zkontroluj dobu cesty a rezervu.");return;
    }
    if(mixed&&(!stages||stages.length<2||stages.length>6||stages.some((leg,index)=>
      !Number.isInteger(leg.minutes)||leg.minutes<1||leg.minutes>1440||
      (index<stages.length-1?!leg.via||!leg.via.label.trim():leg.via!==undefined)))){
      setError("U každého úseku nastav dobu v minutách a u mezizastávek vyber místo na mapě.");return;
    }
    const next={...latest.store,origin,blocks:{...latest.store.blocks}};
    next.blocks[target.key]={
      place:destination!,mode:mixed?legs[0].mode:mode,bufferMinutes:buffer,typicalMinutes,...(mixed?{legs:stages}:{}),
      title:target.title.slice(0,300),date:target.date,start:target.start,
    };
    if(!saveTravelStore(next)){setError("Místo se nepodařilo uložit.");return;}
    onSaved();onClose();
  }
  return <div className="df2-travel-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section ref={dialogRef} className="df2-travel-dialog" role="dialog" aria-modal="true" aria-label={"Místo konání: "+target.title}>
      <header><div><small>CESTA A MÍSTO</small><h2>{target.title}</h2><p>{target.date} · {target.start||"bez času"}</p></div>
        <button type="button" onClick={onClose} aria-label="Zavřít místo konání">×</button></header>
      {data.blocked?<p role="alert">Uložená data o cestách jsou neplatná a nebyla přepsána.</p>:<>
        <label className="df2-travel-offsite"><input type="checkbox" checked={offsite}
          onChange={e=>setOffsite(e.target.checked)}/><strong>Blok se odehrává mimo domov</strong></label>
        {offsite&&<>
          <nav className="df2-travel-tabs" aria-label="Výběr místa">
            <button type="button" aria-pressed={mapTarget==="destination"} className={mapTarget==="destination"?"is-active":""}
              onClick={()=>setMapTarget("destination")}>Místo konání</button>
            <button type="button" aria-pressed={mapTarget==="origin"} className={mapTarget==="origin"?"is-active":""}
              onClick={()=>setMapTarget("origin")}>Odkud vyrážím</button>
            {mixed&&legs.slice(0,-1).map((leg,index)=>
              <button type="button" key={index} aria-pressed={mapTarget===index} className={mapTarget===index?"is-active":""}
                onClick={()=>setMapTarget(index)}>Zastávka {index+1}{leg.via?" ✓":""}</button>)}
          </nav>
          <MapPicker key={String(mapTarget)} point={selectedPoint} setPoint={updateSelectedPoint}/>
          <p className="df2-travel-hint">{mapTarget==="origin"
            ?(origin?"Místo odjezdu: "+origin.label:"Výchozí místo zatím není nastavené.")
            :mapTarget==="destination"
              ?(destination?"Cíl: "+destination.label:"Vyber cíl na mapě.")
              :(selectedPoint?"Mezizastávka: "+selectedPoint.label:"Na mapě vyber parkoviště, přestup nebo zastávku.")}</p>
          <div className="df2-travel-kind" role="group" aria-label="Typ cesty">
            <button type="button" aria-pressed={!mixed} className={!mixed?"is-active":""}
              onClick={()=>{setMixed(false);setMapTarget("destination");}}>Jednoduchá cesta</button>
            <button type="button" aria-pressed={mixed} className={mixed?"is-active":""}
              onClick={()=>setMixed(true)}>Kombinovaná cesta</button>
          </div>
          {mixed?<section className="df2-travel-legs" aria-label="Úseky cesty">
            <p className="df2-travel-hint">Sestav cestu postupně, například auto → parkoviště → metro → chůze. Časy zadáváš orientačně včetně čekání a parkování.</p>
            {legs.map((leg,index)=>{
              const last=index===legs.length-1;
              const end=last?destination:leg.via;
              const from=index===0?origin:legs[index-1].via;
              return <div className="df2-travel-leg" key={index}>
                <div className="df2-travel-leg-head">
                  <strong>Úsek {index+1}</strong>
                  <small>{last?"Příjezd do cíle":end?.label??"Vyber mezizastávku"}</small>
                  {legs.length>2&&<button type="button" aria-label={"Odebrat úsek "+(index+1)}
                    onClick={()=>{
                      setLegs(current=>current.filter((_,i)=>i!==index)
                        .map((part,i,all)=>i===all.length-1?{...part,via:undefined}:part));
                      setMapTarget("destination");
                    }}>Odebrat</button>}
                </div>
                <div className="df2-travel-leg-fields">
                  <label>Doprava
                    <select aria-label={"Doprava úsek "+(index+1)} value={leg.mode}
                      onChange={e=>setLegs(current=>current.map((item,i)=>i===index?{...item,mode:e.target.value as TravelMode}:item))}>
                      {Object.entries(TRAVEL_MODE_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label>Minuty
                    <input aria-label={"Délka úseku "+(index+1)} type="number" min="1" max="1440" step="1"
                      value={leg.minutes} onChange={e=>setLegs(current=>current.map((item,i)=>i===index?{...item,minutes:e.target.value}:item))}/>
                  </label>
                </div>
                {!last&&<button type="button" className="df2-travel-via"
                  onClick={()=>setMapTarget(index)}>📍 {end?.label??"Vybrat parkoviště / přestup na mapě"}</button>}
                {last&&<p className="df2-travel-hint">Cíl: {destination?.label??"Zatím není vybraný"}</p>}
                {end&&<a href={travelDirectionsUrl(from,end,leg.mode)} target="_blank" rel="noopener noreferrer">
                  Úsek {index+1} v Google Maps ↗</a>}
              </div>;
            })}
            <button type="button" className="df2-travel-add-leg" disabled={legs.length>=6}
              onClick={()=>{setLegs(current=>[...current.slice(0,-1),{mode:"walking",minutes:""},current[current.length-1]]);setMapTarget("destination");}}>
              + Přidat úsek
            </button>
            <p className="df2-travel-hint">Celková cesta: {legs.every(leg=>leg.minutes.trim()&&Number.isInteger(Number(leg.minutes))&&Number(leg.minutes)>0)
              ?legs.reduce((sum,leg)=>sum+Number(leg.minutes),0)+" min":"doplň časy úseků"}.</p>
          </section>:<label className="df2-travel-single-mode">Způsob dopravy
            <select aria-label="Způsob dopravy" value={mode}
              onChange={e=>setMode(e.target.value as TravelMode)}>
              {Object.entries(TRAVEL_MODE_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}
            </select>
          </label>}
          <div className="df2-google-route-box">
            <div className="df2-google-route-head">
              <strong>Automatický výpočet trasy</strong>
              <span translate="no" className="df2-google-attribution">Google Maps</span>
            </div>
            {!googleAvailable?<p className="df2-travel-hint">
              Automatický výpočet zatím není aktivní. Provozovatel musí nakonfigurovat Routes API a soukromý přístupový kód na serveru Vercel. Ruční plánování funguje dál.
            </p>:<>
              <label>Přístupový kód k výpočtu tras
                <input type="password" autoComplete="off" aria-label="Přístupový kód k výpočtu tras"
                  value={googleAccess} onChange={event=>{
                    const token=event.target.value;
                    setGoogleAccess(token);
                    try{if(token)sessionStorage.setItem("dayframe-routes-access-session",token);
                      else sessionStorage.removeItem("dayframe-routes-access-session");}catch{}
                  }} placeholder="Osobní přístupový kód"/>
              </label>
              <p className="df2-travel-hint">Google Maps používáme pro aktuální zobrazení doby a vzdálenosti, nikoli k trvalému ukládání výsledků. <a href="./privacy.html" target="_blank" rel="noopener noreferrer">Soukromí</a> · <a href="./terms.html" target="_blank" rel="noopener noreferrer">Podmínky</a></p>
              {!routeParts?<p className="df2-travel-hint">Pro výpočet vyber výchozí místo, cíl a všechny přestupy.</p>
                :googleAccess.length<20?<p className="df2-travel-hint">Zadej přístupový kód pro automatické načítání. Klíč Google Maps do prohlížeče nevkládej.</p>
                :googleLoading?<p role="status">Počítám trasu přes Google Maps…</p>
                :googleEstimates?<div className="df2-google-route-results" role="status">
                  <strong>{googleTotal} min · {((googleDistance??0)/1000).toFixed(1)} km</strong>
                  <span>Odhad při dotazu, pro {mixed?"kombinovanou":"jednoduchou"} cestu. {mode==="driving"&&!mixed?"Jízda zohledňuje provoz.":""}</span>
                  {mixed&&googleEstimates.map((part,index)=><span key={index}>Úsek {index+1}: {part.minutes} min · {(part.distanceMeters/1000).toFixed(1)} km</span>)}
                  <span className="df2-google-route-note">Aktuální údaj Google Maps je pouze pro orientaci. Do uloženého plánu se nepřenáší. Pro Jarvise nastav vlastní obvyklou dobu cesty níže.</span>
                </div>:googleError?<p className="df2-travel-error" role="alert">{googleError} Můžeš pokračovat ručně.</p>
                :<p className="df2-travel-hint">Časy se načtou automaticky po výběru všech míst.</p>}
            </>}
          </div>
          <div className="df2-travel-options">
            <label>Časová rezerva (min)<input aria-label="Časová rezerva" type="number" min="0" max="180"
              value={buffer} onChange={e=>setBuffer(Number(e.target.value))}/></label>
            {!mixed&&<label>Obvyklá cesta v minutách (volitelné)<input aria-label="Obvyklá doba cesty"
              type="number" min="1" max="1440" value={typical} onChange={e=>setTypical(e.target.value)}/></label>}
          </div>
          {!target.start&&<p className="df2-travel-hint">Blok zatím nemá čas začátku. Místo se uloží; doporučený odjezd Jarvis spočítá až po naplánování času.</p>}
          <p className="df2-travel-hint">Jarvis zatím pracuje s uloženým plánovacím časem a rezervou.
            Výpočet Google Maps je aktuální pouze při otevřeném editoru a nepředstavuje záruku včasného příjezdu.</p>
          {!mixed&&destination&&<a target="_blank" rel="noopener noreferrer"
            href={travelDirectionsUrl(origin,destination,mode)}>Otevřít trasu v Google Maps ↗</a>}
        </>}
        {error&&<p role="alert" className="df2-travel-error">{error}</p>}
        <footer><button type="button" onClick={onClose}>Zrušit</button>
          <button type="button" className="df2-travel-save" onClick={submit}>Uložit místo</button></footer>
      </>}
    </section>
  </div>;
}
