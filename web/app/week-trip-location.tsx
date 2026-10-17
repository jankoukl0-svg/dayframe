"use client";
import {useEffect,useRef,useState} from "react";
import {readTravelStore,saveTravelStore,travelDirectionsUrl,
  type TravelPoint,type TravelMode} from "@/lib/dayframe-travel";

export type TripTarget={key:string;title:string;date:string;start:string};
const CSS_URL="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const JS_URL="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
let loader:Promise<any>|undefined;
function getLeaflet():Promise<any>{
  if((window as any).L)return Promise.resolve((window as any).L);
  if(loader)return loader;
  if(!document.querySelector('link[data-df2-map]')){
    const css=document.createElement("link");css.rel="stylesheet";css.href=CSS_URL;css.dataset.df2Map="true";document.head.appendChild(css);
  }
  loader=new Promise((resolve,reject)=>{
    const script=document.createElement("script");script.src=JS_URL;script.async=true;
    script.onload=()=>resolve((window as any).L);
    script.onerror=()=>reject(new Error("Leaflet unavailable"));
    document.head.appendChild(script);
  }).catch(e=>{loader=undefined;throw e;});
  return loader;
}
function MapPicker({point,setPoint}:{point?:TravelPoint;setPoint:(v:TravelPoint)=>void}){
  const container=useRef<HTMLDivElement>(null);
  const map=useRef<any>(null),marker=useRef<any>(null),latest=useRef(setPoint);
  const [text,setText]=useState(""),[results,setResults]=useState<TravelPoint[]>([]);
  const [hint,setHint]=useState("Načítám mapu…"),[busy,setBusy]=useState(false);
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
      const points=json.map(x=>({lat:Number(x.lat),lon:Number(x.lon),label:x.display_name}))
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
    <div className="df2-travel-coords">
      <label>Šířka<input type="number" aria-label="Zeměpisná šířka" min="-90" max="90" step="any"
        value={point?.lat??""} onChange={e=>{
          if(e.target.value==="")return;
          const lat=Number(e.target.value);
          if(Number.isFinite(lat)&&Math.abs(lat)<=90)setPoint({lat,lon:point?.lon??14.4,label:point?.label??"Souřadnice"});
        }}/></label>
      <label>Délka<input type="number" aria-label="Zeměpisná délka" min="-180" max="180" step="any"
        value={point?.lon??""} onChange={e=>{
          if(e.target.value==="")return;
          const lon=Number(e.target.value);
          if(Number.isFinite(lon)&&Math.abs(lon)<=180)setPoint({lat:point?.lat??50.1,lon,label:point?.label??"Souřadnice"});
        }}/></label>
    </div>
    {point&&<label>Popis vybraného místa<input aria-label="Popis vybraného místa" value={point.label}
      onChange={e=>setPoint({...point,label:e.target.value})}/></label>}
  </div>;
}
export function WeekTripLocationModal({target,onClose,onSaved}:{
  target:TripTarget;onClose:()=>void;onSaved:()=>void;
}){
  const data=readTravelStore();
  const current=data.store.blocks[target.key];
  const [offsite,setOffsite]=useState(Boolean(current));
  const [destination,setDestination]=useState<TravelPoint|undefined>(current?.place);
  const [origin,setOrigin]=useState<TravelPoint|undefined>(data.store.origin);
  const [pickingOrigin,setPickingOrigin]=useState(false);
  const [mode,setMode]=useState<TravelMode>(current?.mode??"driving");
  const [buffer,setBuffer]=useState(current?.bufferMinutes??15);
  const [typical,setTypical]=useState(current?.typicalMinutes?.toString()??"");
  const [error,setError]=useState("");
  function submit(){
    const latest=readTravelStore();
    if(latest.blocked){setError("Uložená data o cestách nelze bezpečně změnit.");return;}
    if(offsite&&(!destination||!destination.label.trim())){setError("Nejprve vyber místo konání.");return;}
    const typicalMinutes=typical.trim()?Number(typical):undefined;
    if(!Number.isInteger(buffer)||buffer<0||buffer>180||
      (typicalMinutes!==undefined&&(!Number.isInteger(typicalMinutes)||typicalMinutes<1||typicalMinutes>1440))){
      setError("Zkontroluj dobu cesty a rezervu.");return;
    }
    const next={...latest.store,origin,blocks:{...latest.store.blocks}};
    if(!offsite)delete next.blocks[target.key];
    else next.blocks[target.key]={
      place:destination!,mode,bufferMinutes:buffer,typicalMinutes,
      title:target.title,date:target.date,start:target.start,
    };
    if(!saveTravelStore(next)){setError("Místo se nepodařilo uložit.");return;}
    onSaved();onClose();
  }
  return <div className="df2-travel-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section className="df2-travel-dialog" role="dialog" aria-modal="true" aria-label={"Místo konání: "+target.title}>
      <header><div><small>CESTA A MÍSTO</small><h2>{target.title}</h2><p>{target.date} · {target.start||"bez času"}</p></div>
        <button type="button" onClick={onClose} aria-label="Zavřít místo konání">×</button></header>
      {data.blocked?<p role="alert">Uložená data o cestách jsou neplatná a nebyla přepsána.</p>:<>
        <label className="df2-travel-offsite"><input type="checkbox" checked={offsite}
          onChange={e=>setOffsite(e.target.checked)}/><strong>Blok se odehrává mimo domov</strong></label>
        {offsite&&<>
          <nav className="df2-travel-tabs" aria-label="Výběr místa">
            <button type="button" className={!pickingOrigin?"is-active":""}
              onClick={()=>setPickingOrigin(false)}>Místo konání</button>
            <button type="button" className={pickingOrigin?"is-active":""}
              onClick={()=>setPickingOrigin(true)}>Odkud vyrážím</button>
          </nav>
          <MapPicker key={pickingOrigin?"origin":"destination"}
            point={pickingOrigin?origin:destination} setPoint={pickingOrigin?setOrigin:setDestination}/>
          <p className="df2-travel-hint">{pickingOrigin
            ?(origin?"Místo odjezdu: "+origin.label:"Výchozí místo zatím není nastavené.")
            :(destination?"Cíl: "+destination.label:"Vyber cíl na mapě.")}</p>
          <div className="df2-travel-options">
            <label>Způsob dopravy<select aria-label="Způsob dopravy" value={mode}
              onChange={e=>setMode(e.target.value as TravelMode)}>
              <option value="driving">Autem</option><option value="walking">Pěšky</option>
              <option value="cycling">Na kole</option></select></label>
            <label>Časová rezerva (min)<input aria-label="Časová rezerva" type="number" min="0" max="180"
              value={buffer} onChange={e=>setBuffer(Number(e.target.value))}/></label>
            <label>Obvyklá cesta v minutách (volitelné)<input aria-label="Obvyklá doba cesty"
              type="number" min="1" max="1440" value={typical} onChange={e=>setTypical(e.target.value)}/></label>
          </div>
          <p className="df2-travel-hint">Jarvis používá pouze tebou zadanou dobu cesty a rezervu.
            Aktuální dopravní situaci ověř v Mapách; Dayframe ji zatím sám nezjišťuje.</p>
          {destination&&<a target="_blank" rel="noopener noreferrer"
            href={travelDirectionsUrl(origin,destination,mode)}>Otevřít trasu v Google Maps ↗</a>}
        </>}
        {error&&<p role="alert" className="df2-travel-error">{error}</p>}
        <footer><button type="button" onClick={onClose}>Zrušit</button>
          <button type="button" className="df2-travel-save" onClick={submit}>Uložit místo</button></footer>
      </>}
    </section>
  </div>;
}
