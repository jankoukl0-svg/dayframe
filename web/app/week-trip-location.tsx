"use client";
import {useEffect,useRef,useState} from "react";
import {readTravelStore,saveTravelStore,travelDirectionsUrl,
  type TravelPoint,type TravelMode,type TravelLeg,TRAVEL_MODE_LABELS,eventStart} from "@/lib/dayframe-travel";

export type TripTarget={key:string;title:string;date:string;start:string;initialOffsite?:boolean};
type TransitPreference="balanced"|"fastest"|"fewer_transfers"|"less_walking";
type RouteStep={kind:"transit"|"walk";line?:string;vehicle?:string;headsign?:string;
  from?:string;to?:string;departureTime?:string;arrivalTime?:string;
  departureLabel?:string;arrivalLabel?:string;departureZone?:string;arrivalZone?:string;
  stops?:number;distanceMeters?:number;instructions?:string};
type RouteOption={minutes:number;distanceMeters:number;steps:RouteStep[];
  transfers:number;walkingMeters:number};
type RouteEstimate={minutes:number;distanceMeters:number;options:RouteOption[];departureISO:string;trafficAware?:boolean};
type RouteSettings={departureISO?:string;transitPreference:TransitPreference;transferMinutes:number};
const formatClock=(iso?:string)=>iso&&Number.isFinite(Date.parse(iso))
  ?new Intl.DateTimeFormat("cs-CZ",{hour:"2-digit",minute:"2-digit"}).format(new Date(iso)):"—";
function formatStationTime(iso?:string,label?:string,zone?:string){
  if(label)return label;
  if(!iso||!Number.isFinite(Date.parse(iso)))return "—";
  const parsed=new Date(iso);
  try{
    if(zone)return new Intl.DateTimeFormat("cs-CZ",{hour:"2-digit",minute:"2-digit",timeZone:zone}).format(parsed);
  }catch{/* Use explicitly labeled UTC instead of a possibly incorrect device time zone. */}
  return new Intl.DateTimeFormat("cs-CZ",{hour:"2-digit",minute:"2-digit",timeZone:"UTC"}).format(parsed)+" UTC";
}
// Use the vehicle enum returned by Google rather than inferring bus/metro/train
// from the transport leg (which is always generically "transit").
// Official entrance to the Černý Most P+R garage (parking.praha.eu).
const CERNY_MOST_PARK:TravelPoint={lat:50.1102028,lon:14.5794097,label:"P+R Černý Most — parkovací dům u metra B"};
function distanceBetweenMetres(a:TravelPoint,b:TravelPoint){
  const rad=Math.PI/180;
  const dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
}
function transitPresentation(vehicle?:string,line?:string){
  const kind=(vehicle??"").toUpperCase();
  if(kind==="SUBWAY")return {label:"Metro",icon:"🚇"};
  if(["COMMUTER_TRAIN","HEAVY_RAIL","HIGH_SPEED_TRAIN","LONG_DISTANCE_TRAIN","RAIL","MONORAIL","TRAIN"].includes(kind))
    return {label:"Vlak",icon:"🚆"};
  if(["TRAM","LIGHT_RAIL","METRO_RAIL"].includes(kind))return {label:"Tramvaj",icon:"🚋"};
  if(["BUS","INTERCITY_BUS","TROLLEYBUS","SHARE_TAXI"].includes(kind))return {label:"Autobus",icon:"🚌"};
  if(kind==="FERRY")return {label:"Přívoz",icon:"⛴️"};
  if(["CABLE_CAR","GONDOLA_LIFT","FUNICULAR"].includes(kind))return {label:"Lanovka",icon:"🚠"};
  // Czech train lines like S22 may be returned as OTHER by the provider.
  if(/^(?:S|R|RE|Ex)\s*\d+[A-Z]?$/i.test((line??"").trim()))return {label:"Vlak",icon:"🚆"};
  return {label:"MHD",icon:"🚏"};
}
// Safely support compact server responses and older step-rich responses.
function compactTravelSteps(steps:RouteStep[]):RouteStep[]{
  const items:RouteStep[]=[];
  for(const step of steps){
    if(step.kind==="walk"){
      if(!Number.isFinite(step.distanceMeters)||Number(step.distanceMeters)<0)continue;
      const distance=Math.round(step.distanceMeters??0);
      const last=items[items.length-1];
      if(last?.kind==="walk")last.distanceMeters=(last.distanceMeters??0)+distance;
      else items.push({kind:"walk",distanceMeters:distance});
    }else if(step.kind==="transit")items.push(step);
  }
  return items;
}
function RouteItinerary({estimate,index,mode,preference}:{estimate:RouteEstimate;index:number;mode:TravelMode;preference:TransitPreference}){
  const primary=estimate.options[0];
  const itinerary=compactTravelSteps(primary.steps);
  return <div className="df2-travel-itinerary">
    <strong>Úsek {index+1} · {estimate.minutes} min · {(estimate.distanceMeters/1000).toFixed(1)} km</strong>
    <span className="df2-travel-hint">Odhadovaný odjezd {formatClock(estimate.departureISO)}</span>
    {mode==="transit"&&<div className="df2-route-overview">
      <span className="df2-travel-hint">{preference==="balanced"?"Přednost: pohodlná cesta":preference==="fewer_transfers"?"Přednost: méně přestupů":preference==="less_walking"?"Přednost: méně chůze":"Přednost: nejrychlejší cesta"} · {primary.transfers} přestupů · pěšky {primary.walkingMeters} m</span>
      {itinerary.length>0?<ol className="df2-route-timeline" aria-label="Přehled spojů a chůze">{itinerary.map((step,i)=>{
        if(step.kind==="walk")return <li key={i} className="df2-route-timeline-item df2-route-walk">
          <span className="df2-route-step-icon" aria-hidden="true">🚶</span>
          <div className="df2-route-step-content">
            <strong>Pěšky</strong>
            <span>{step.distanceMeters??0} m</span>
          </div>
        </li>;
        const vehicle=transitPresentation(step.vehicle,step.line);
        return <li key={i} className="df2-route-timeline-item df2-route-transit">
          <span className="df2-route-step-icon" aria-hidden="true">{vehicle.icon}</span>
          <div className="df2-route-step-content">
            <div className="df2-route-line-head"><strong>{vehicle.label}</strong>
              {step.line&&<span className="df2-route-line-number">{step.line}</span>}
            </div>
            {step.headsign&&<span className="df2-route-headsign">Směr {step.headsign}</span>}
            <div className="df2-route-stop-pair">
              <div><span className="df2-route-stop-tag">Nástup</span><strong>{step.from||"Neuvedená zastávka"}</strong>
                <span className="df2-route-stop-time">{formatStationTime(step.departureTime,step.departureLabel,step.departureZone)}</span></div>
              <div><span className="df2-route-stop-tag">Výstup</span><strong>{step.to||"Neuvedená zastávka"}</strong>
                <span className="df2-route-stop-time">{formatStationTime(step.arrivalTime,step.arrivalLabel,step.arrivalZone)}</span></div>
            </div>
            {Number.isInteger(step.stops)&&<span className="df2-route-stop-count">{step.stops} zastávek</span>}
          </div>
        </li>;
      })}</ol>:<p className="df2-travel-hint">Google neposkytl podrobnosti spojů. Ověř trasu přímo v Google Maps.</p>}
      {estimate.options.length>1&&<details className="df2-travel-alternatives">
        <summary>Porovnat {estimate.options.length-1} další dostupné varianty</summary>
        {estimate.options.slice(1).map((option,i)=><div key={i} className="df2-travel-alternative">
          <strong>Varianta {i+2}: {option.minutes} min</strong>
          <span> · {option.transfers} přestupů · pěšky {option.walkingMeters} m</span>
          <span> · {option.steps.filter(step=>step.kind==="transit").map(step=>{
            const vehicle=transitPresentation(step.vehicle,step.line);
            return vehicle.label+(step.line?" "+step.line:"");
          }).join(" → ")||"MHD"}</span>
        </div>)}
      </details>}
      <span className="df2-travel-hint">Časy jsou místní časy zastávek. Detailní pěší navigaci otevři v Google Maps.</span>
    </div>}
    {mode!=="transit"&&estimate.options.length>1&&<details className="df2-travel-alternatives">
      <summary>Další {estimate.options.length-1} alternativní trasy</summary>
      {estimate.options.slice(1).map((option,i)=><div key={i}>Varianta {i+2}: {option.minutes} min · {(option.distanceMeters/1000).toFixed(1)} km</div>)}
    </details>}
  </div>;
}
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
  const [placeEditorOpen,setPlaceEditorOpen]=useState(!current?.place);
  const [advancedOpen,setAdvancedOpen]=useState(false);
  const [parkSwitchNotice,setParkSwitchNotice]=useState(false);
  const [accessEditorOpen,setAccessEditorOpen]=useState(false);
  function choosePlace(next:"destination"|"origin"|number){
    setMapTarget(next);setPlaceEditorOpen(true);
  }
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
  const [googleConnection,setGoogleConnection]=useState<"checking"|"ready"|"disabled"|"unreachable">("checking");
  const [googleStatusRetry,setGoogleStatusRetry]=useState(0);
  const [googleAccess,setGoogleAccess]=useState("");
  const [googleLoading,setGoogleLoading]=useState(false);
  const [googleError,setGoogleError]=useState("");
  const [googleDiagnostic,setGoogleDiagnostic]=useState("");
  const [googleEstimates,setGoogleEstimates]=useState<RouteEstimate[]|null>(null);
  const [departureMode,setDepartureMode]=useState<"now"|"scheduled">("now");
  const [departureLocal,setDepartureLocal]=useState(()=>{
    const event=target.start?eventStart(target.date,target.start):null;
    const duration=current?.typicalMinutes??30;
    const estimate=event?new Date(event.getTime()-(duration+(current?.bufferMinutes??15))*60000):new Date(Date.now()+3600000);
    const d=estimate.getTime()>Date.now()?estimate:new Date(Date.now()+3600000);
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-")+
      "T"+[String(d.getHours()).padStart(2,"0"),String(d.getMinutes()).padStart(2,"0")].join(":");
  });
  const [transitPreference,setTransitPreference]=useState<TransitPreference>("balanced");
  const [transferMinutes,setTransferMinutes]=useState(5);
  const [appliedSettings,setAppliedSettings]=useState<RouteSettings>({transitPreference:"balanced",transferMinutes:5});
  const routeController=useRef<AbortController|null>(null);
  const partialRoute=useRef<{
    signature:string;settings:RouteSettings;startedAt:number;cachedAt:number;estimates:RouteEstimate[];
  }|null>(null);
  const [failedStage,setFailedStage]=useState<number|null>(null);
  const [canRetrySimplified,setCanRetrySimplified]=useState(false);
  useEffect(()=>()=>routeController.current?.abort(),[]);
  // The separate access secret is session-scoped. Neither it nor the Google API key is persisted with the travel plan.
  useEffect(()=>{
    try{setGoogleAccess(sessionStorage.getItem("dayframe-routes-access-session")??"");}catch{}
    const controller=new AbortController();
    let timedOut=false;
    const timeout=window.setTimeout(()=>{timedOut=true;controller.abort();},7000);
    setGoogleConnection("checking");
    fetch("/api/google-travel",{signal:controller.signal,cache:"no-store"})
      .then(async response=>{
        if(!response.ok||!response.headers.get("content-type")?.includes("application/json"))
          return "unreachable" as const;
        const data=await response.json() as {available?:boolean};
        return data.available===true?"ready" as const:"disabled" as const;
      })
      .then(status=>{
        if(controller.signal.aborted)return;
        setGoogleAvailable(status==="ready");
        setGoogleConnection(status);
      })
      .catch(()=>{
        if(controller.signal.aborted&&!timedOut)return;
        setGoogleAvailable(false);
        setGoogleConnection("unreachable");
      })
      .finally(()=>window.clearTimeout(timeout));
    return ()=>{window.clearTimeout(timeout);controller.abort();};
  },[googleStatusRetry]);
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
  const metroParkingAlternative=Boolean(mixed&&legs.length===2&&legs[0].mode==="driving"
    &&legs[1].mode==="transit"&&legs[0].via&&destination
    &&distanceBetweenMetres(legs[0].via,CERNY_MOST_PARK)<8000
    &&distanceBetweenMetres(destination,CERNY_MOST_PARK)<26000
    &&distanceBetweenMetres(legs[0].via,CERNY_MOST_PARK)>150);
  // Never transmit user-written place labels or use them to trigger paid recalculations.
  const routeSignature=routeParts?JSON.stringify(routeParts.map(part=>({
    from:{lat:part.from.lat,lon:part.from.lon},
    to:{lat:part.to.lat,lon:part.to.lon},
    mode:part.mode,
  }))):"";
  // Every paid calculation is deliberate. Editing a point, preference or time never calls Google.
  useEffect(()=>{
    routeController.current?.abort();
    partialRoute.current=null;
    setFailedStage(null);
    setCanRetrySimplified(false);
    setGoogleEstimates(null);
    setGoogleError("");
    setGoogleDiagnostic("");
    setGoogleLoading(false);
  },[routeSignature,departureMode,departureLocal,transitPreference,transferMinutes,googleAccess,offsite]);
  async function calculateRoute(resumeFailed=false){
    if(!googleAvailable||!routeSignature||!offsite||googleLoading
      ||!(/^[A-Za-z0-9_-]{20,}$/.test(googleAccess)))return;
    let departureISO:string|undefined;
    if(departureMode==="scheduled"){
      const date=new Date(departureLocal);
      if(!Number.isFinite(date.getTime())||date.getTime()<Date.now()-120000||date.getTime()>Date.now()+7*86400000){
        setGoogleError("Zvol čas odjezdu od nynějška nejvýše 7 dní dopředu.");
        return;
      }
      departureISO=date.toISOString();
    }
    if(!Number.isInteger(transferMinutes)||transferMinutes<0||transferMinutes>30){
      setGoogleError("Na přestup lze vyhradit 0 až 30 minut.");return;
    }
    const settings:RouteSettings={departureISO,transitPreference,transferMinutes};
    const previous=partialRoute.current;
    const canResume=resumeFailed&&previous&&previous.signature===routeSignature
      &&JSON.stringify(previous.settings)===JSON.stringify(settings)
      &&Date.now()>=previous.cachedAt&&Date.now()-previous.cachedAt<10*60000;
    if(resumeFailed&&!canResume){
      setGoogleError("Dřívější výpočet už není aktuální. Spusť nový výpočet celé trasy.");
      setCanRetrySimplified(false);
      partialRoute.current=null;
      return;
    }
    routeController.current?.abort();
    const controller=new AbortController();
    routeController.current=controller;
    setGoogleLoading(true);
    setFailedStage(null);
    setCanRetrySimplified(false);
    setGoogleError("");
    setGoogleDiagnostic("");
    setGoogleEstimates(null);
    let stage=0;
    try{
      const parts=JSON.parse(routeSignature) as Array<{from:TravelPoint;to:TravelPoint;mode:TravelMode}>;
      const calculated:RouteEstimate[]=canResume?[...previous!.estimates]:[];
      const departure=canResume?previous!.startedAt:
        departureISO?Date.parse(departureISO):Date.now()+1000;
      let elapsed=calculated.reduce((sum,part)=>sum+part.minutes+settings.transferMinutes,0);
      for(let i=calculated.length;i<parts.length;i++){
        if(controller.signal.aborted)return;
        stage=i;
        const part=parts[i],planned=new Date(departure+elapsed*60000).toISOString();
        const response=await fetch("/api/google-travel",{
          method:"POST",signal:controller.signal,cache:"no-store",
          headers:{"Content-Type":"application/json","Authorization":"Bearer "+googleAccess},
          body:JSON.stringify({...part,
            // For "now" car journeys Google's default departure time is now.
            // Omit the explicit timestamp to restore the previously working
            // basic DRIVE request; keep planned times for transfers and transit.
            ...(!departureISO&&i===0&&part.mode==="driving"
              ?{}:{departureTime:planned}),
            ...(part.mode==="transit"?{transitPreference:settings.transitPreference}:{}),
            ...(resumeFailed?{simpleRoute:true}:{})}),
        });
        const result=await response.json() as {
          minutes?:number;distanceMeters?:number;options?:RouteOption[];
          error?:string;providerStatus?:number;retryable?:boolean;
          providerCode?:string;providerReason?:string;trafficAware?:boolean;
        };
        if(!response.ok||!Number.isInteger(result.minutes)||typeof result.distanceMeters!=="number"){
          // Keep successful earlier stages in memory, never charge for them again on retry.
          if(response.status===502&&result.providerStatus===503&&result.retryable){
            partialRoute.current={signature:routeSignature,settings,startedAt:departure,
              cachedAt:canResume?previous!.cachedAt:Date.now(),estimates:calculated};
            setCanRetrySimplified(true);
          }else partialRoute.current=null;
          setFailedStage(i);
          const details=[result.providerCode,result.providerReason].filter(value=>typeof value==="string"&&/^[A-Z][A-Z0-9_]{2,60}$/.test(value));
          if(details.length)setGoogleDiagnostic("Kód služby Google: "+details.join(" / "));
          throw Error(`Úsek ${i+1} z ${parts.length} (${TRAVEL_MODE_LABELS[part.mode]}): ${result.error??"Google Maps trasu nevypočítaly."}`);
        }
        const options=Array.isArray(result.options)&&result.options.length?result.options:
          [{minutes:result.minutes!,distanceMeters:result.distanceMeters,steps:[],transfers:0,walkingMeters:0}];
        calculated.push({minutes:result.minutes!,distanceMeters:result.distanceMeters,options,departureISO:planned,
          trafficAware:result.trafficAware});
        elapsed+=result.minutes!+settings.transferMinutes;
      }
      if(!controller.signal.aborted){
        partialRoute.current=null;
        setAppliedSettings(settings);
        setGoogleEstimates(calculated);
      }
    }catch(e){
      if(!controller.signal.aborted){
        if(failedStage===null&&!(e instanceof Error&&e.message.startsWith("Úsek ")))
          setFailedStage(stage);
        setGoogleError(e instanceof Error?e.message:"Nepodařilo se vypočítat trasu.");
      }
    }finally{
      if(!controller.signal.aborted)setGoogleLoading(false);
    }
  }
  const googleTotal=googleEstimates?googleEstimates.reduce((sum,item)=>sum+item.minutes,0)
    +(mixed?Math.max(0,googleEstimates.length-1)*appliedSettings.transferMinutes:0):undefined;
  const googleDistance=googleEstimates?.reduce((sum,item)=>sum+item.distanceMeters,0);
  const journeyDeparture=googleEstimates?.[0]?.departureISO;
  const journeyArrival=journeyDeparture&&googleTotal!==undefined
    ?new Date(Date.parse(journeyDeparture)+googleTotal*60000).toISOString():undefined;
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
          <section className="df2-trip-section" aria-label="Místa cesty">
            <div className="df2-trip-section-title"><span className="df2-trip-section-number">1</span><h3>Odkud a kam?</h3></div>
            <nav className="df2-travel-tabs df2-trip-place-cards" aria-label="Výběr místa">
              <button type="button" aria-label="Odkud vyrážím" aria-pressed={mapTarget==="origin"&&placeEditorOpen}
                className={mapTarget==="origin"&&placeEditorOpen?"is-active":""}
                onClick={()=>choosePlace("origin")}>
                <small>ODKUD</small>
                <strong>{origin?origin.label.split(",").slice(0,2).join(","):"Vybrat místo odjezdu"}</strong>
                <span>{origin?"Změnit místo":"Klikni pro výběr"}</span>
              </button>
              <button type="button" aria-label="Místo konání" aria-pressed={mapTarget==="destination"&&placeEditorOpen}
                className={mapTarget==="destination"&&placeEditorOpen?"is-active":""}
                onClick={()=>choosePlace("destination")}>
                <small>KAM</small>
                <strong>{destination?destination.label.split(",").slice(0,2).join(","):"Vybrat cíl cesty"}</strong>
                <span>{destination?"Změnit místo":"Klikni pro výběr"}</span>
              </button>
              {mixed&&legs.slice(0,-1).map((leg,index)=>
                <button type="button" key={index} aria-label={"Zastávka "+(index+1)} aria-pressed={mapTarget===index&&placeEditorOpen}
                  className={mapTarget===index&&placeEditorOpen?"is-active":""}
                  onClick={()=>choosePlace(index)}>
                  <small>PŘESTUP {index+1}</small>
                  <strong>{leg.via?leg.via.label.split(",").slice(0,2).join(","):"Vybrat zastávku"}</strong>
                  <span>{leg.via?"Změnit místo":"Klikni pro výběr"}</span>
                </button>)}
            </nav>
            {placeEditorOpen&&<div className="df2-trip-location-editor">
              <div className="df2-trip-location-head">
                <strong>{mapTarget==="origin"?"Odkud vyrážíš?":mapTarget==="destination"?"Kam jedeš?":`Kde přestupuješ? (zastávka ${mapTarget+1})`}</strong>
                <button type="button" onClick={()=>setPlaceEditorOpen(false)}>Hotovo</button>
              </div>
              <MapPicker key={String(mapTarget)} point={selectedPoint} setPoint={updateSelectedPoint}/>
            </div>}
            {!destination&&<p className="df2-trip-inline-hint">Nejprve vyber cíl cesty.</p>}
            {destination&&!origin&&<p className="df2-trip-inline-hint">Cíl je vybraný. Ještě nastav místo odjezdu.</p>}
          </section>
          <section className="df2-trip-section" aria-label="Způsob dopravy">
            <div className="df2-trip-section-title"><span className="df2-trip-section-number">2</span><h3>Jak pojedeš?</h3></div>
            <div className="df2-travel-kind" role="group" aria-label="Typ cesty">
              <button type="button" aria-pressed={!mixed} className={!mixed?"is-active":""}
                onClick={()=>{setMixed(false);setMapTarget("destination");setPlaceEditorOpen(false);}}>Jednoduchá cesta</button>
              <button type="button" aria-pressed={mixed} className={mixed?"is-active":""}
                onClick={()=>{setMixed(true);setPlaceEditorOpen(false);}}>Kombinovaná cesta</button>
            </div>
            <p className="df2-trip-kind-help">{mixed?"Naplánuj postupně auto, MHD, chůzi a případná přestupní místa.":"Stačí vybrat jeden dopravní prostředek."}</p>
          {mixed?<section className="df2-travel-legs" aria-label="Úseky cesty">
            <p className="df2-trip-kind-help">Přestupní místo vybereš kliknutím na kartu výše. Minuty jsou tvůj plánovací odhad pro Jarvise, nikoli automaticky uložený čas Googlu.</p>
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
                  onClick={()=>choosePlace(index)}>📍 {end?.label??"Vybrat parkoviště / přestup na mapě"}</button>}
                {last&&<p className="df2-travel-hint">Cíl: {destination?.label??"Zatím není vybraný"}</p>}
                {end&&<a className="df2-trip-small-link" href={travelDirectionsUrl(from,end,leg.mode)} target="_blank" rel="noopener noreferrer">
                  Zobrazit tento úsek v Google Maps ↗</a>}
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
          </section>
          <section className="df2-trip-section" aria-label="Výpočet cesty">
            <div className="df2-trip-section-title"><span className="df2-trip-section-number">3</span><h3>Kdy vyrazit?</h3></div>
          <div className="df2-google-route-box">
            <div className="df2-google-route-head">
              <strong>Trasa podle Google Maps</strong>
              {googleAvailable&&<span translate="no" className="df2-google-attribution"><img src="https://www.gstatic.com/images/branding/product/2x/maps_96dp.png" alt="Google Maps" /><span aria-hidden="true">Google Maps</span></span>}
            </div>
            {(/^[A-Za-z0-9_-]{20,}$/.test(googleAccess))&&!accessEditorOpen
              ?<div className="df2-trip-access-ready"><span>✓ Přístupový kód je vyplněný</span>
                <button type="button" onClick={()=>setAccessEditorOpen(true)}>Změnit kód</button></div>
              :<label>Přístupový kód k výpočtu tras
                <input type="password" autoComplete="off" aria-label="Přístupový kód k výpočtu tras"
                  value={googleAccess} onChange={event=>{
                    const token=event.target.value;
                    setAccessEditorOpen(true);
                    setGoogleAccess(token);
                    try{if(token)sessionStorage.setItem("dayframe-routes-access-session",token);
                      else sessionStorage.removeItem("dayframe-routes-access-session");}catch{}
                  }} placeholder="Osobní přístupový kód (ne Google API klíč)"/>
                {(/^[A-Za-z0-9_-]{20,}$/.test(googleAccess))&&
                  <button className="df2-trip-small-link" type="button" onClick={()=>setAccessEditorOpen(false)}>Hotovo s kódem</button>}
              </label>}
            <div className="df2-trip-main-time">
              <label>Kdy chceš odjet?
                <select aria-label="Čas odjezdu" value={departureMode}
                  onChange={e=>setDepartureMode(e.target.value as "now"|"scheduled")}>
                  <option value="now">Co nejdřív (teď)</option>
                  <option value="scheduled">V konkrétní čas</option>
                </select>
              </label>
              {departureMode==="scheduled"&&<label>Datum a čas odjezdu
                <input aria-label="Datum a čas odjezdu" type="datetime-local" value={departureLocal}
                  onChange={e=>setDepartureLocal(e.target.value)}/>
              </label>}
            </div>
            {(mixed||mode==="transit")&&<>
              <button type="button" className="df2-trip-more-btn" aria-expanded={advancedOpen}
                onClick={()=>setAdvancedOpen(open=>!open)}>{advancedOpen?"Skrýt upřesnění":"Upřesnit cestu (volitelné)"} <span aria-hidden="true">{advancedOpen?"⌃":"⌄"}</span></button>
              {advancedOpen&&<div className="df2-travel-route-settings">
                <label>Co je důležitější?
                  <select aria-label="Preference MHD" value={transitPreference}
                    onChange={e=>setTransitPreference(e.target.value as TransitPreference)}>
                    <option value="balanced">Pohodlná cesta (doporučeno)</option>
                    <option value="fastest">Nejrychlejší spoj</option>
                    <option value="fewer_transfers">Méně přestupů</option>
                    <option value="less_walking">Méně chůze</option>
                  </select>
                </label>
                {mixed&&<label>Čas na parkování a přestup (min)
                  <input aria-label="Minuty na přestup" type="number" min="0" max="30" step="1"
                    value={transferMinutes} onChange={e=>setTransferMinutes(Number(e.target.value))}/>
                </label>}
              </div>}
            </>}
            {!googleAvailable?<div className="df2-google-route-offline" role="status">
              <p className="df2-travel-hint">{googleConnection==="checking"
                ?"Připojuji Google Maps…"
                :googleConnection==="disabled"
                  ?"Automatický výpočet není dostupný. Cestu lze uložit ručně."
                  :"Google Maps teď neodpovídají. Cestu můžeš stále uložit ručně."}</p>
              <button type="button" className="df2-travel-use-estimate"
                onClick={()=>setGoogleStatusRetry(n=>n+1)}>Zkusit připojení znovu</button>
            </div>:<>
              <button type="button" className="df2-trip-calculate" onClick={()=>void calculateRoute()}
                disabled={!offsite||!routeParts||googleLoading||!(/^[A-Za-z0-9_-]{20,}$/.test(googleAccess))}>
                {googleLoading?"Počítám trasu…":googleEstimates?"Přepočítat trasu":"Spočítat trasu"}
              </button>
              {parkSwitchNotice&&<p className="df2-trip-inline-hint" role="status">
                Přestupní místo je nastaveno na P+R Černý Most u metra B.
                Klikni na „Spočítat trasu“ pro nový odhad (u kombinace dvě API volání).
                Parkování a dostupnost míst ověř před odjezdem.
              </p>}
              {!routeParts?<p className="df2-trip-inline-hint">K výpočtu vyber odkud, kam a případná přestupní místa.</p>
                :!(/^[A-Za-z0-9_-]{20,}$/.test(googleAccess))?<p className="df2-trip-inline-hint">Pro výpočet zadej svůj osobní přístupový kód.</p>
                :<p className="df2-trip-cost-note">Výpočet spustíš jen tlačítkem. {mixed?`Každý z ${routeParts.length} úseků spotřebuje jeden požadavek.`:"Jeden výpočet spotřebuje jeden požadavek."}</p>}
              {googleEstimates&&<div className="df2-google-route-results" role="status">
                <div className="df2-trip-result-head">
                  <div><span>ODHAD CESTY</span><strong>{googleTotal} min</strong></div>
                  <div><span>VZDÁLENOST</span><strong>{((googleDistance??0)/1000).toFixed(1)} km</strong></div>
                </div>
                <p>Vyrazit {formatClock(journeyDeparture)} · příjezd přibližně {formatClock(journeyArrival)}</p>
                {googleEstimates.some((part,index)=>routeParts?.[index]?.mode==="driving"&&part.trafficAware===false)&&
                  <p className="df2-trip-fallback-note">Orientační čas autem bez aktuálních kolon. Pro přesnější odhad dopravní situace použij Google Maps.</p>}
                {googleEstimates.map((part,index)=><div className="df2-trip-mini-segment" key={index}>
                  <span>{mixed?`Úsek ${index+1} · `:""}{TRAVEL_MODE_LABELS[routeParts?.[index]?.mode??"driving"]}</span>
                  <strong>{part.minutes} min</strong>
                  {part.options[0]?.steps.some(step=>step.kind==="transit")&&<>
                    <small>{part.options[0].steps.filter(step=>step.kind==="transit").map(step=>{
                      const presentation=transitPresentation(step.vehicle,step.line);
                      return presentation.label+(step.line?" "+step.line:"");
                    }).join(" → ")}</small>
                    <small>Pěšky {part.options[0].walkingMeters} m · {part.options[0].transfers} přestupů</small>
                  </>}
                </div>)}
                {mixed&&<span>Parkování a přestupy: {Math.max(0,googleEstimates.length-1)*appliedSettings.transferMinutes} min navíc (zahrnuto v součtu).</span>}
                {routeParts?.some((part,index)=>part.mode==="transit"
                  &&(googleEstimates[index]?.options[0]?.walkingMeters??0)>1000)&&
                  <div className="df2-trip-comfort-warning">
                    <strong>Hodně chůze na této trase</strong>
                    <span>Trasa zahrnuje {Math.round(googleEstimates.reduce((sum,part,i)=>sum+
                      (routeParts[i]?.mode==="transit"?(part.options[0]?.walkingMeters??0):0),0)/100)/10} km chůze.
                      Zkus pohodlnější variantu nebo jiné parkování u metra.</span>
                    {metroParkingAlternative&&<div className="df2-trip-park-suggestion">
                      <div><strong>Alternativa: P+R Černý Most</strong>
                      <p>Parkovací dům přímo u metra B. Můžeš vyzkoušet trasu přes metro místo vlaku.
                         Google potom spočítá oba nové úseky.</p></div>
                      <button type="button" onClick={()=>{
                        setParkSwitchNotice(true);
                        setLegs(prev=>prev.map((leg,index)=>index===0?{...leg,via:CERNY_MOST_PARK}:leg));
                        setPlaceEditorOpen(false);
                      }}>Zkusit P+R Černý Most</button>
                    </div>}
                  </div>}

                <details className="df2-trip-details">
                  <summary>Zobrazit stanice, spoje a alternativy</summary>
                  {googleEstimates.map((part,index)=><RouteItinerary key={index} index={index}
                    estimate={part} mode={routeParts?.[index]?.mode??"driving"} preference={appliedSettings.transitPreference}/>)}
                  <p className="df2-travel-hint">Google nemusí vrátit všechny možné spoje. Aktuální přestupy si před cestou ověř.</p>
                </details>
              </div>}
              {googleError&&<div className="df2-trip-route-failure" role="alert">
                <p className="df2-travel-error">{googleError}</p>
                {partialRoute.current?.estimates.length? <p className="df2-trip-cost-note">
                  Hotovo: {partialRoute.current.estimates.map((part,i)=>`úsek ${i+1} (${part.minutes} min)`).join(", ")}.
                  Při opakování se tyto úseky nepočítají znovu.
                </p>:null}
                {canRetrySimplified&&failedStage!==null&&<button type="button" className="df2-trip-retry"
                  onClick={()=>void calculateRoute(true)} disabled={googleLoading}>
                  Zkusit jednodušší výpočet (od úseku {failedStage+1})
                </button>}
                {canRetrySimplified&&<p className="df2-trip-cost-note">
                  Další pokus spustíš jen tlačítkem. Každý zbývající úsek spotřebuje jeden požadavek.
                  Bez alternativ; u auta také bez dopravního modelu. Čas autem bude pouze orientační. Google může být stále nedostupný.
                </p>}
                {googleDiagnostic&&<p className="df2-trip-cost-note">{googleDiagnostic}</p>}
                {failedStage!==null&&routeParts?.[failedStage]&&
                  <a className="df2-trip-external-route"
                    href={travelDirectionsUrl(routeParts[failedStage].from,routeParts[failedStage].to,routeParts[failedStage].mode)}
                    target="_blank" rel="noopener noreferrer">
                    Otevřít úsek {failedStage+1} v Google Maps ↗
                  </a>}
                <p className="df2-trip-inline-hint">Když Google Routes neodpovídá, trasu můžeš otevřít přímo v Google Maps nebo zadat běžný čas ručně.</p>
              </div>}
            </>}
            <details className="df2-trip-legal"><summary>Limity a soukromí</summary>
              <p>Maximálně 50 požadavků denně a 1 000 měsíčně. Údaje Google Maps slouží k orientaci a neukládají se do plánovacího času.</p>
              <a href="./privacy.html" target="_blank" rel="noopener noreferrer">Soukromí</a> · <a href="./terms.html" target="_blank" rel="noopener noreferrer">Podmínky</a>
            </details>
          </div>
          </section>
          <section className="df2-trip-section df2-trip-save-section" aria-label="Plán pro Jarvise">
            <div className="df2-trip-section-title"><span className="df2-trip-section-number">4</span><h3>Uložit plán pro Jarvise</h3></div>
            <p className="df2-trip-kind-help">Jarvis plánuje odjezd podle tvého běžného času. Automatický odhad Googlu zůstává pouze pro náhled.</p>
            <div className="df2-travel-options">
              {!mixed&&<label>Můj běžný čas cesty (min)
                <input aria-label="Obvyklá doba cesty" type="number" min="1" max="1440"
                  value={typical} onChange={e=>setTypical(e.target.value)} placeholder="Např. 60"/>
              </label>}
              <label>Časová rezerva (min)
                <input aria-label="Časová rezerva" type="number" min="0" max="180" value={buffer}
                  onChange={e=>setBuffer(Number(e.target.value))}/>
              </label>
            </div>
            {mixed&&<p className="df2-trip-kind-help">U kombinované cesty se pro Jarvise sečtou plánovací minuty z jednotlivých úseků výše.</p>}
            {!target.start&&<p className="df2-trip-kind-help">Blok zatím nemá začátek. Jarvis odjezd dopočítá, až blok naplánuješ na určitý čas.</p>}
          </section>
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
