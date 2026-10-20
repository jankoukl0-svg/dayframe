"use client";
import {useEffect,useRef,useState} from "react";
import {readTravelStore,saveTravelStore,travelDirectionsUrl,
  type TravelPoint,type TravelMode,type TravelLeg,TRAVEL_MODE_LABELS,eventStart} from "@/lib/dayframe-travel";

export type TripTarget={key:string;title:string;date:string;start:string;end?:string;initialOffsite?:boolean};
type TransitPreference="balanced"|"fastest"|"fewer_transfers"|"less_walking";
type RouteStep={kind:"transit"|"walk";line?:string;vehicle?:string;headsign?:string;
  from?:string;to?:string;departureTime?:string;arrivalTime?:string;
  departureLabel?:string;arrivalLabel?:string;departureZone?:string;arrivalZone?:string;
  stops?:number;distanceMeters?:number;instructions?:string};
type RouteOption={minutes:number;distanceMeters:number;steps:RouteStep[];
  transfers:number;walkingMeters:number};
type RouteEstimate={minutes:number;distanceMeters:number;options:RouteOption[];departureISO:string;trafficAware?:boolean};
type RouteSettings={departureISO?:string;transitPreference:TransitPreference;transferMinutes:number};
type ParkingItem={id:string;name:string;lat:number;lon:number;distanceMeters:number;
  kind:string;access:string;capacity?:number;price:{kind:"free"|"hourly"|"paid"|"unknown";
    label:string;amount?:number;currency?:string};parkRide:boolean;osmUrl:string;website?:string};
type ParkingSort="nearest"|"price"|"free";
const parkingCost=(p:ParkingItem,hours:number)=>{
  if(p.price.kind==="free")return p.price.label;
  if(p.price.kind!=="hourly"||p.price.amount===undefined||!p.price.currency)return p.price.label;
  const rate=p.price.amount+" "+p.price.currency+"/h";
  return hours>0?rate+" · asi "+(Math.round(p.price.amount*hours*100)/100)+" "+p.price.currency+" za "+hours+" h":rate;
};
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
  if(["SUBWAY","METRO_RAIL"].includes(kind))return {label:"Metro",icon:"🚇"};
  if(["COMMUTER_TRAIN","HEAVY_RAIL","HIGH_SPEED_TRAIN","LONG_DISTANCE_TRAIN","RAIL","MONORAIL","TRAIN"].includes(kind))
    return {label:"Vlak",icon:"🚆"};
  if(["TRAM","LIGHT_RAIL"].includes(kind))return {label:"Tramvaj",icon:"🚋"};
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
const isSubwayOnly=(option:RouteOption)=>{
  const rides=option.steps.filter(step=>step.kind==="transit");
  return rides.length>0&&rides.every(step=>
    ["SUBWAY","METRO_RAIL"].includes((step.vehicle??"").toUpperCase()));
};
const transitSummary=(option:RouteOption)=>option.steps.filter(step=>step.kind==="transit")
  .map(step=>{const kind=transitPresentation(step.vehicle,step.line);
    return kind.label+(step.line?" "+step.line:"");}).join(" → ")||"MHD";
function RouteItinerary({estimate,index,mode,preference,onChoose}:{estimate:RouteEstimate;index:number;
  mode:TravelMode;preference:TransitPreference;onChoose?:(optionIndex:number)=>void}){
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
          {onChoose&&<button type="button" className="df2-travel-alternative-select"
            onClick={()=>onChoose(i+1)}>Vybrat variantu {i+2} (bez API)</button>}
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
  const [parkingChoiceNotice,setParkingChoiceNotice]=useState("");
  const [parkingResults,setParkingResults]=useState<ParkingItem[]>([]);
  const [parkingStatus,setParkingStatus]=useState<"idle"|"loading"|"ready"|"error">("idle");
  const [parkingError,setParkingError]=useState("");
  const [parkingRadius,setParkingRadius]=useState<1800|4000>(1800);
  const [parkingSort,setParkingSort]=useState<ParkingSort>("nearest");
  const [parkingHours,setParkingHours]=useState(0);
  const [parkingAround,setParkingAround]=useState<"destination"|"interchange">("destination");
  const [parkingExpanded,setParkingExpanded]=useState(false);
  const [parkingRetry,setParkingRetry]=useState(0);
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
    setParkSwitchNotice(false);
    if(mapTarget==="origin")setOrigin(point);
    else if(mapTarget==="destination")setDestination(point);
    else setLegs(previous=>previous.map((leg,index)=>index===mapTarget?{...leg,via:point}:leg));
  }
  const [mode,setMode]=useState<TravelMode>(current?.mode??"driving");
  const [buffer,setBuffer]=useState(current?.bufferMinutes??15);
  const [typical,setTypical]=useState(current?.typicalMinutes?.toString()??"");
  const [returnHome,setReturnHome]=useState(current?.returnHome??false);
  const [returnMinutes,setReturnMinutes]=useState(current?.returnMinutes?.toString()??"");
  const [returnVerified,setReturnVerified]=useState(current?.returnVerified??false);
  const [reverseLoading,setReverseLoading]=useState(false);
  const [reverseError,setReverseError]=useState("");
  const [error,setError]=useState("");
  const [googleAvailable,setGoogleAvailable]=useState(false);
  const [googleConnection,setGoogleConnection]=useState<"checking"|"ready"|"disabled"|"unreachable">("checking");
  const [googleStatusRetry,setGoogleStatusRetry]=useState(0);
  const [googleAccess,setGoogleAccess]=useState("");
  const [googleLoading,setGoogleLoading]=useState(false);
  const [metroLoading,setMetroLoading]=useState(false);
  const [metroChecked,setMetroChecked]=useState(false);
  const [metroMessage,setMetroMessage]=useState("");
  const [subwayLoading,setSubwayLoading]=useState(false);
  const [subwayChecked,setSubwayChecked]=useState(false);
  const [subwayMessage,setSubwayMessage]=useState("");
  const [subwayComparison,setSubwayComparison]=useState<{
    signature:string;stage:number;original:RouteEstimate;subway:RouteEstimate;
    chosen:"original"|"subway";
  }|null>(null);
  const [metroComparison,setMetroComparison]=useState<{
    signature:string;stage:number;original:RouteEstimate;metro:RouteEstimate;
    chosen:"original"|"metro";
  }|null>(null);
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
  const returnController=useRef<AbortController|null>(null);
  const partialRoute=useRef<{
    signature:string;settings:RouteSettings;startedAt:number;cachedAt:number;estimates:RouteEstimate[];
  }|null>(null);
  const [failedStage,setFailedStage]=useState<number|null>(null);
  const [canRetrySimplified,setCanRetrySimplified]=useState(false);
  useEffect(()=>()=>{routeController.current?.abort();returnController.current?.abort();},[]);
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
  // A single explicit action prepares a practical car → metro interchange without
  // querying Google. Never infer a specific service or overwrite saved plans.
  const metroParkPresetEligible=Boolean(origin&&destination
    &&distanceBetweenMetres(origin,CERNY_MOST_PARK)>8000
    &&distanceBetweenMetres(destination,CERNY_MOST_PARK)<26000);
  const metroParkPresetActive=Boolean(mixed&&legs.length===2
    &&legs[0].mode==="driving"&&legs[1].mode==="transit"&&legs[0].via
    &&legs[0].via.lat===CERNY_MOST_PARK.lat&&legs[0].via.lon===CERNY_MOST_PARK.lon);
  function chooseMetroParkPreset(){
    setLegs(previous=>[
      {mode:"driving",minutes:metroParkPresetActive?previous[0].minutes:"",via:CERNY_MOST_PARK},
      {mode:"transit",minutes:metroParkPresetActive?previous[1].minutes:""},
    ]);
    setMixed(true);
    setMapTarget("destination");
    setPlaceEditorOpen(false);
    setParkSwitchNotice(true);
  }
  const isDrivingJourney=mixed?legs[0]?.mode==="driving":mode==="driving";
  const parkingAtInterchange=parkingAround==="interchange"&&mixed&&legs[0]?.via;
  const parkingCenter=parkingAtInterchange?legs[0].via:destination;
  const parkingCenterLat=parkingCenter?.lat,parkingCenterLon=parkingCenter?.lon;
  useEffect(()=>{
    if(!offsite||!isDrivingJourney||parkingCenterLat===undefined||parkingCenterLon===undefined){
      setParkingResults([]);setParkingStatus("idle");setParkingError("");return;
    }
    const controller=new AbortController();
    setParkingStatus("loading");setParkingError("");setParkingResults([]);
    // Coordinates can be edited digit-by-digit; debounce and cancel stale searches.
    const timer=window.setTimeout(async()=>{
      try{
        const query=new URLSearchParams({lat:String(parkingCenterLat),lon:String(parkingCenterLon),
          radius:String(parkingRadius)});
        const response=await fetch("/api/parking?"+query,{signal:controller.signal,cache:"default"});
        const payload=await response.json() as {items?:ParkingItem[];error?:string};
        if(controller.signal.aborted)return;
        if(!response.ok||!Array.isArray(payload.items))throw Error(payload.error??"Parkování není dostupné.");
        setParkingResults(payload.items);
        setParkingStatus("ready");
      }catch(e){
        if(!controller.signal.aborted){
          setParkingStatus("error");setParkingError(e instanceof Error?e.message:"Parkování nyní není dostupné.");
        }
      }
    },700);
    return ()=>{window.clearTimeout(timer);controller.abort();};
  },[offsite,isDrivingJourney,parkingCenterLat,parkingCenterLon,parkingRadius,parkingRetry]);
  const parkingChoices=[...parkingResults].filter(item=>parkingSort!=="free"||item.price.kind==="free")
    .sort((a,b)=>{
      if(parkingSort!=="price")return a.distanceMeters-b.distanceMeters;
      const tier=(p:ParkingItem)=>p.price.kind==="free"?0:p.price.kind==="hourly"?1:2;
      return tier(a)-tier(b)||
        (a.price.kind==="hourly"&&b.price.kind==="hourly"
          ?(a.price.currency??"").localeCompare(b.price.currency??"")||
            (a.price.amount??0)-(b.price.amount??0):0)||
        a.distanceMeters-b.distanceMeters;
    });
  function chooseFoundParking(item:ParkingItem){
    const chosen:TravelPoint={lat:item.lat,lon:item.lon,label:item.name+" (OSM parkoviště)"};
    // Retain TRANSIT only when the user's current path genuinely is drive → MHD.
    // Otherwise the local last mile should be WALK rather than an invented transit ride.
    const lastMode:TravelMode=mixed&&legs.length===2&&legs[0].mode==="driving"
      &&legs[1].mode==="transit"?"transit":"walking";
    const same=mixed&&legs.length===2&&legs[0].via?.lat===chosen.lat
      &&legs[0].via?.lon===chosen.lon&&legs[0].mode==="driving"&&legs[1].mode===lastMode;
    setLegs(previous=>[
      {mode:"driving",minutes:same?previous[0].minutes:"",via:chosen},
      {mode:lastMode,minutes:same?previous[1].minutes:""},
    ]);
    setMixed(true);setParkSwitchNotice(false);
    setParkingChoiceNotice("Vybráno: "+item.name+". Spočítej cestu tlačítkem; ověř vjezd a ceník parkoviště.");
    setParkingAround("destination");setPlaceEditorOpen(false);setMapTarget("destination");
  }
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
  const returnRouteSignature=JSON.stringify({routeSignature,transitPreference,transferMinutes});
  const previousReturnSignature=useRef(returnRouteSignature);
  useEffect(()=>{
    if(previousReturnSignature.current===returnRouteSignature)return;
    previousReturnSignature.current=returnRouteSignature;
    returnController.current?.abort();
    setReverseLoading(false);setReverseError("");
    setReturnMinutes("");setReturnVerified(false);
  },[returnRouteSignature]);
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
    setMetroLoading(false);
    setMetroChecked(false);
    setMetroMessage("");
    setMetroComparison(null);
    setSubwayLoading(false);
    setSubwayChecked(false);
    setSubwayMessage("");
    setSubwayComparison(null);
  },[routeSignature,departureMode,departureLocal,transitPreference,transferMinutes,googleAccess,offsite]);
  async function calculateRoute(resumeFailed=false){
    if(!googleAvailable||!routeSignature||!offsite||googleLoading||metroLoading||subwayLoading
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
    setMetroChecked(false);
    setMetroComparison(null);
    setMetroMessage("");
    setSubwayChecked(false);
    setSubwayComparison(null);
    setSubwayMessage("");
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
        setParkSwitchNotice(false);
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
  // Metro is a separate, explicitly requested Google calculation. Never requery
  // the driving stage just because an alternative transit route is desired.
  // A different route duration invalidates any following stage's departure
  // time; keep free switching and one-call subway comparison on the last leg.
  const transitStage=routeParts&&googleEstimates
    &&routeParts[routeParts.length-1]?.mode==="transit"?routeParts.length-1:-1;
  const subwayStageEstimate=transitStage>=0?googleEstimates?.[transitStage]:undefined;
  const subwayPrimary=subwayStageEstimate?.options[0];
  const availableSubway=subwayStageEstimate?.options.slice(1).find(isSubwayOnly);
  const subwayOpportunity=transitStage>=0&&Boolean(subwayPrimary)
    &&(!isSubwayOnly(subwayPrimary!)||subwayComparison!==null);
  function chooseReturnedTransitOption(stage:number,index:number){
    if(!googleEstimates)return;
    const estimate=googleEstimates[stage],candidate=estimate?.options[index];
    if(!candidate||routeParts?.[stage]?.mode!=="transit")return;
    setGoogleEstimates(prev=>prev?.map((part,i)=>i!==stage?part:{
      ...part,minutes:candidate.minutes,distanceMeters:candidate.distanceMeters,
      options:[candidate,...part.options.filter((_,optionIndex)=>optionIndex!==index)],
    })??null);
    // A different user-selected route supersedes an earlier comparison.
    setMetroComparison(null);setMetroChecked(false);
    setSubwayComparison(null);setSubwayChecked(false);
  }
  // Metro is a separate, explicitly requested Google calculation. Never requery
  const metroStage=routeParts&&googleEstimates
    ?routeParts.findIndex((part,i)=>i===routeParts.length-1&&part.mode==="transit"
      &&distanceBetweenMetres(part.from,CERNY_MOST_PARK)<3000
      &&distanceBetweenMetres(part.to,CERNY_MOST_PARK)<26000)
    :-1;
  const metroPrimary=metroStage>=0?googleEstimates?.[metroStage]?.options[0]:undefined;
  // Černý Most connects to metro B. A ride on metro A or C must not be
  // described as a verified B alternative, even if Google returned SUBWAY.
  const isMetroB=(option:RouteOption)=>option.steps.some(step=>
    step.kind==="transit"&&transitPresentation(step.vehicle,step.line).label==="Metro"
    &&/^(?:METRO[ ]*)?B$/i.test((step.line??"").trim()));
  const existingMetroOption=metroStage>=0?googleEstimates?.[metroStage]?.options.slice(1).find(isMetroB):undefined;
  const metroOpportunity=metroStage>=0&&Boolean(metroPrimary)&&
    (Boolean(metroComparison)||!isMetroB(metroPrimary!)||metroPrimary!.transfers>=2);
  function chooseMetro(stage:number,metro:RouteEstimate){
    if(!googleEstimates)return;
    const original=googleEstimates[stage];
    setMetroComparison({signature:routeSignature,stage,original,metro,chosen:"original"});
    setMetroMessage("");
    setMetroChecked(true);
  }
  function selectMetroVariant(which:"original"|"metro"){
    const comparison=metroComparison;
    if(!comparison||comparison.signature!==routeSignature)return;
    const part=which==="metro"?comparison.metro:comparison.original;
    setGoogleEstimates(previous=>previous?.map((item,i)=>i===comparison.stage?part:item)??null);
    setMetroComparison({...comparison,chosen:which});
  }
  async function checkMetro(){
    if(!googleEstimates||!routeParts||metroStage<0||googleLoading||metroLoading||subwayLoading
      ||metroChecked||!googleAvailable||!(/^[A-Za-z0-9_-]{20,}$/.test(googleAccess)))return;
    const stage=metroStage,part=routeParts[stage];
    const alternative=googleEstimates[stage].options.slice(1).find(isMetroB);
    if(alternative){
      chooseMetro(stage,{...googleEstimates[stage],
        minutes:alternative.minutes,distanceMeters:alternative.distanceMeters,
        options:[alternative,...googleEstimates[stage].options.filter(o=>o!==alternative)]});
      return;
    }
    const currentSignature=routeSignature;
    const departureTime=googleEstimates[stage].departureISO;
    if(!Number.isFinite(Date.parse(departureTime))||Date.parse(departureTime)<Date.now()-120000){
      setMetroChecked(true);
      setMetroMessage("Původní odjezd už uplynul. Nejprve znovu spočítej celou cestu, aby bylo možné metro spravedlivě porovnat ve stejném čase.");
      return;
    }
    const controller=new AbortController();
    routeController.current?.abort();
    routeController.current=controller;
    setMetroLoading(true);
    setMetroMessage("");
    setMetroChecked(true);
    try{
      const response=await fetch("/api/google-travel",{
        method:"POST",signal:controller.signal,cache:"no-store",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+googleAccess},
        body:JSON.stringify({from:{lat:part.from.lat,lon:part.from.lon},
          to:{lat:part.to.lat,lon:part.to.lon},mode:"transit",departureTime,
          transitPreference:appliedSettings.transitPreference,transitTravelModes:"metro"}),
      });
      const result=await response.json() as {
        minutes?:number;distanceMeters?:number;options?:RouteOption[];error?:string;
      };
      if(controller.signal.aborted||currentSignature!==routeSignature)return;
      if(!response.ok){
        setMetroMessage(result.error??"Google metro nyní nedokáže ověřit.");
        return;
      }
      const metroRoute=result.options?.find(isMetroB);
      if(!metroRoute){
        setMetroMessage("Google ani s preferencí metra nenabídl ověřenou trasu linkou B. Zkus P+R přímo u stanice nebo otevři spojení v Google Maps.");
        return;
      }
      const metro:RouteEstimate={minutes:metroRoute.minutes,
        distanceMeters:metroRoute.distanceMeters,
        options:[metroRoute,...(result.options??[]).filter(o=>o!==metroRoute)],
        departureISO:departureTime,trafficAware:false};
      chooseMetro(stage,metro);
    }catch{
      if(!controller.signal.aborted)setMetroMessage("Porovnání metra teď neproběhlo. Původní trasa zůstala beze změny.");
    }finally{
      if(!controller.signal.aborted)setMetroLoading(false);
    }
  }
  // Additional metro-only query is always user-initiated and counts as ONE
  // transit request. Even SUBWAY-only is a preference, not a Google guarantee.
  function chooseSubway(stage:number,subway:RouteEstimate){
    if(!googleEstimates)return;
    setMetroComparison(null);setMetroChecked(false);
    setSubwayComparison({signature:routeSignature,stage,original:googleEstimates[stage],
      subway,chosen:"original"});
    setSubwayMessage("");setSubwayChecked(true);
  }
  function selectSubwayVariant(which:"original"|"subway"){
    const compare=subwayComparison;
    if(!compare||compare.signature!==routeSignature)return;
    const chosen=which==="subway"?compare.subway:compare.original;
    setGoogleEstimates(previous=>previous?.map((part,i)=>i===compare.stage?chosen:part)??null);
    setSubwayComparison({...compare,chosen:which});
  }
  async function checkSubway(){
    if(!googleEstimates||!routeParts||transitStage<0||googleLoading||metroLoading
      ||subwayLoading||subwayChecked||!googleAvailable
      ||!(/^[A-Za-z0-9_-]{20,}$/.test(googleAccess)))return;
    const stage=transitStage,part=routeParts[stage];
    const candidate=googleEstimates[stage].options.slice(1).find(isSubwayOnly);
    if(candidate){
      chooseSubway(stage,{...googleEstimates[stage],minutes:candidate.minutes,
        distanceMeters:candidate.distanceMeters,
        options:[candidate,...googleEstimates[stage].options.filter(x=>x!==candidate)]});
      return;
    }
    const signature=routeSignature,departureTime=googleEstimates[stage].departureISO;
    if(!Number.isFinite(Date.parse(departureTime))||Date.parse(departureTime)<Date.now()-120000){
      setSubwayChecked(true);
      setSubwayMessage("Čas původního odjezdu už uplynul. Nejprve přepočítej celou cestu.");
      return;
    }
    const controller=new AbortController();
    routeController.current?.abort();
    routeController.current=controller;
    setSubwayLoading(true);setSubwayChecked(true);setSubwayMessage("");
    try{
      const response=await fetch("/api/google-travel",{
        method:"POST",signal:controller.signal,cache:"no-store",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+googleAccess},
        body:JSON.stringify({from:{lat:part.from.lat,lon:part.from.lon},
          to:{lat:part.to.lat,lon:part.to.lon},mode:"transit",departureTime,
          transitPreference:"fewer_transfers",transitTravelModes:"subway_only"}),
      });
      const result=await response.json() as {options?:RouteOption[];error?:string};
      if(controller.signal.aborted||routeSignature!==signature)return;
      if(!response.ok){
        setSubwayMessage(result.error??"Nepodařilo se ověřit alternativu pouze metrem.");
        return;
      }
      const onlyMetro=result.options?.find(isSubwayOnly);
      if(!onlyMetro){
        setSubwayMessage("Google ani s preferencí pouze metra nevrátil ověřenou trasu bez tramvaje či autobusu. Můžeš otevřít trasu v Google Maps nebo zkusit jiné přestupní místo.");
        return;
      }
      chooseSubway(stage,{minutes:onlyMetro.minutes,distanceMeters:onlyMetro.distanceMeters,
        departureISO:departureTime,trafficAware:false,
        options:[onlyMetro,...(result.options??[]).filter(x=>x!==onlyMetro)]});
    }catch{
      if(!controller.signal.aborted)
        setSubwayMessage("Metro teď nešlo ověřit. Původní spoj zůstal beze změny.");
    }finally{
      if(!controller.signal.aborted)setSubwayLoading(false);
    }
  }
  const googleTotal=googleEstimates?googleEstimates.reduce((sum,item)=>sum+item.minutes,0)
    +(mixed?Math.max(0,googleEstimates.length-1)*appliedSettings.transferMinutes:0):undefined;
  const googleDistance=googleEstimates?.reduce((sum,item)=>sum+item.distanceMeters,0);
  const journeyDeparture=googleEstimates?.[0]?.departureISO;
  const journeyArrival=journeyDeparture&&googleTotal!==undefined
    ?new Date(Date.parse(journeyDeparture)+googleTotal*60000).toISOString():undefined;
  const calendarMinutes=googleTotal??(mixed
    ?legs.every(leg=>Number.isInteger(Number(leg.minutes))&&Number(leg.minutes)>0)
      ?legs.reduce((total,leg)=>total+Number(leg.minutes),0):undefined
    :typical.trim()&&Number.isInteger(Number(typical))&&Number(typical)>0?Number(typical):undefined);
  /** Reverse each actual leg as a new Google query. Not a mathematically
   * reversible ETA: transit schedules/traffic can differ after the event.
   * Never request automatically or bypass the existing Redis quotas.
   */
  async function calculateReturn(){
    if(!routeParts||!googleAvailable||reverseLoading||googleLoading||metroLoading||subwayLoading
      ||!(/^[A-Za-z0-9_-]{20,}$/.test(googleAccess)))return;
    const end=target.end?eventStart(target.date,target.end):null;
    // The planning day runs until 02:00 of the following calendar day.
    if(end&&target.end==="02:00")end.setDate(end.getDate()+1);
    if(!end||end.getTime()<Date.now()-120000||end.getTime()>Date.now()+7*86400000){
      setReverseError("Pro ověření zpáteční cesty musí mít blok konec v následujících 7 dnech. Můžeš použít orientační dobu cesty tam.");return;
    }
    returnController.current?.abort();
    const controller=new AbortController();
    returnController.current=controller;
    setReverseLoading(true);setReverseError("");setReturnVerified(false);
    // Strip user labels from every reversed endpoint, exactly like the
    // outbound path. The provider only needs coordinates; labels stay local.
    const reversed=[...routeParts].reverse().map(part=>({
      mode:part.mode,
      from:{lat:part.to.lat,lon:part.to.lon},
      to:{lat:part.from.lat,lon:part.from.lon},
    }));
    let elapsed=0;
    try{
      for(let i=0;i<reversed.length;i++){
        if(controller.signal.aborted)return;
        const part=reversed[i];
        const response=await fetch("/api/google-travel",{
          method:"POST",signal:controller.signal,cache:"no-store",
          headers:{"Content-Type":"application/json","Authorization":"Bearer "+googleAccess},
          body:JSON.stringify({...part,departureTime:new Date(end.getTime()+elapsed*60000).toISOString(),
            ...(part.mode==="transit"?{transitPreference}:{}),
          }),
        });
        const result=await response.json() as {minutes?:number;error?:string};
        if(!response.ok||!Number.isInteger(result.minutes)||result.minutes!<1){
          throw Error("Zpáteční úsek "+(i+1)+": "+(result.error??"Google trasu nespočítal."));
        }
        elapsed+=result.minutes!+(i<reversed.length-1?transferMinutes:0);
      }
      if(!controller.signal.aborted){
        setReturnMinutes(String(elapsed));setReturnVerified(true);
      }
    }catch(e){
      if(!controller.signal.aborted)setReverseError((e instanceof Error?e.message:"Zpáteční cesta není dostupná.")+
        " Původní odhad lze použít bez dalšího volání.");
    }finally{if(!controller.signal.aborted)setReverseLoading(false);}
  }
  function submit(locationOnly=false){
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
    const stages:TravelLeg[]|undefined=mixed?legs.map((leg,index)=>({
      mode:leg.mode,
      minutes:googleEstimates?.[index]
        ?googleEstimates[index].minutes+(index<legs.length-1?appliedSettings.transferMinutes:0)
        :leg.minutes.trim()?Number(leg.minutes):NaN,
      via:leg.via,
    })):undefined;
    const total=stages?.reduce((sum,leg)=>sum+leg.minutes,0);
    const typicalMinutes=mixed?total:(googleTotal??(typical.trim()?Number(typical):undefined));
    const calendarMinutes=googleTotal??typicalMinutes;
    const reverseDuration=returnMinutes.trim()?Number(returnMinutes):calendarMinutes;
    // A direct itinerary may intentionally be saved as a location-only record,
    // but it must not silently look like a scheduled commute. The user has an
    // explicit secondary action for that instead of accidentally losing time.
    if(!mixed&&origin&&target.start&&target.end&&typicalMinutes===undefined&&!locationOnly){
      setError("Přímá cesta zatím nemá délku. Klikni na „Spočítat trasu“ nebo vyplň „Můj běžný čas cesty“. Bez času se cesta v Týdnu nezobrazí. Chceš-li uložit jen místo, použij samostatné tlačítko.");
      return;
    }
    if(returnHome&&locationOnly){
      setError("Při zpáteční cestě musí být určená délka cesty tam. Nejdřív ji spočítej nebo zadej ručně.");
      return;
    }
    if(returnHome&&(!origin||!target.start||!target.end||!Number.isInteger(reverseDuration)
      ||reverseDuration!<1||reverseDuration!>1440)){
      setError("Pro zpáteční cestu nastav čas začátku a konce bloku a platnou délku cesty domů.");return;
    }
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
      ...(calendarMinutes?{calendarMinutes,calendarVerified:googleTotal!==undefined}:{}),returnHome,
      ...(returnHome?{returnMinutes:reverseDuration,returnVerified:returnVerified&&
        Number(returnMinutes)===reverseDuration}:{}),
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
            {isDrivingJourney&&destination&&<div className="df2-parking-discovery" aria-label="Parkování poblíž">
              <div className="df2-parking-top">
                <div><strong>Parkování v okolí</strong>
                  <p>Vyhledáno automaticky podle místa cesty · OpenStreetMap</p></div>
                <button type="button" aria-label="Obnovit parkoviště" onClick={()=>setParkingRetry(n=>n+1)}
                  disabled={parkingStatus==="loading"}>↻ Obnovit</button>
              </div>
              <div className="df2-parking-controls">
                <label>Seřadit
                  <select aria-label="Seřadit parkoviště" value={parkingSort}
                    onChange={e=>{setParkingSort(e.target.value as ParkingSort);setParkingExpanded(false);}}>
                    <option value="nearest">Nejbližší</option>
                    <option value="price">Podle ceny (známé sazby)</option>
                    <option value="free">Pouze označená jako zdarma</option>
                  </select>
                </label>
                <label>Okruh
                  <select aria-label="Okruh parkování" value={parkingRadius}
                    onChange={e=>{setParkingRadius(Number(e.target.value) as 1800|4000);setParkingExpanded(false);}}>
                    <option value={1800}>1,8 km</option><option value={4000}>4 km</option>
                  </select>
                </label>
                {mixed&&legs[0]?.via&&<label>Hledat u
                  <select aria-label="Oblast parkování" value={parkingAround}
                    onChange={e=>setParkingAround(e.target.value as "destination"|"interchange")}>
                    <option value="destination">Cíle</option><option value="interchange">Přestupu</option>
                  </select>
                </label>}
                <label>Doba stání
                  <select aria-label="Doba parkování" value={parkingHours}
                    onChange={e=>setParkingHours(Number(e.target.value))}>
                    <option value={0}>Bez odhadu</option>
                    {[1,2,3,4,6,8,12].map(h=><option key={h} value={h}>{h} h</option>)}
                  </select>
                </label>
              </div>
              {parkingStatus==="loading"&&<p className="df2-trip-inline-hint" role="status">Hledám parkoviště…</p>}
              {parkingStatus==="error"&&<p className="df2-trip-inline-hint" role="status">{parkingError} <button type="button" onClick={()=>setParkingRetry(n=>n+1)}>Zkusit znovu</button></p>}
              {parkingStatus==="ready"&&parkingChoices.length===0&&<p className="df2-trip-inline-hint">V tomto okruhu nejsou dostupná parkoviště s vybraným filtrem. Zvětši okruh, změň filtr nebo vyber místo ručně na mapě.</p>}
              {parkingStatus==="ready"&&parkingChoices.length>0&&<div className="df2-parking-list">
                {parkingChoices.slice(0,parkingExpanded?15:5).map(item=><article className="df2-parking-item" key={item.id}>
                  <div className="df2-parking-item-info"><strong>{item.name}</strong>
                    <span>{(item.distanceMeters/1000).toFixed(1)} km vzdušnou čarou
                      {item.parkRide?" · P+R":""}{item.access==="customers"?" · jen zákazníci":""}
                      {item.capacity?" · "+item.capacity+" míst":""}</span>
                    <span className="df2-parking-price">{parkingCost(item,parkingHours)}</span>
                    <a href={item.website??item.osmUrl} target="_blank" rel="noopener noreferrer">
                      Informace o parkovišti ↗</a>
                  </div>
                  <button type="button" onClick={()=>chooseFoundParking(item)}>Vybrat</button>
                </article>)}
                {parkingChoices.length>5&&<button type="button" className="df2-parking-expand"
                  onClick={()=>setParkingExpanded(v=>!v)}>{parkingExpanded?"Zobrazit méně":`Zobrazit další (${parkingChoices.length-5})`}</button>}
              </div>}
              {parkingChoiceNotice&&<p className="df2-trip-inline-hint" role="status">{parkingChoiceNotice}</p>}
              <p className="df2-parking-disclaimer">Ceny jsou neúplná komunitní data, nikoli aktuální tarif. Odhady při uvedené hodinové sazbě jsou orientační; podmínky, vjezd a volná místa vždy ověř. Žádné placené Google volání se při hledání nespouští. © OpenStreetMap contributors.</p>
            </div>}
          </section>
          <section className="df2-trip-section" aria-label="Způsob dopravy">
            <div className="df2-trip-section-title"><span className="df2-trip-section-number">2</span><h3>Jak pojedeš?</h3></div>
            <div className="df2-travel-kind" role="group" aria-label="Typ cesty">
              <button type="button" aria-pressed={!mixed} className={!mixed?"is-active":""}
                onClick={()=>{setMixed(false);setMapTarget("destination");setPlaceEditorOpen(false);}}>Jednoduchá cesta</button>
              <button type="button" aria-pressed={mixed} className={mixed?"is-active":""}
                onClick={()=>{setMixed(true);setPlaceEditorOpen(false);}}>Kombinovaná cesta</button>
            </div>
            {metroParkPresetEligible&&<div className="df2-trip-quick-route" role="group" aria-label="Rychlá volba cesty">
              <div><strong>🚗 Auto → P+R Černý Most → MHD</strong>
                <p>Jedním kliknutím nastavíš přestup u metra B. Google pak ověří skutečný spoj, dobu i chůzi.</p>
              </div>
              <button type="button" aria-pressed={metroParkPresetActive}
                onClick={chooseMetroParkPreset} disabled={metroParkPresetActive}>
                {metroParkPresetActive?"P+R Černý Most vybráno":"Použít tuto kombinaci"}
              </button>
            </div>}
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
                {subwayOpportunity&&<div className="df2-trip-subway-compare" aria-label="Alternativa pouze metrem">
                  <div className="df2-trip-metro-heading">
                    <span className="df2-route-step-icon" aria-hidden="true">🚇</span>
                    <div><strong>Raději jen metrem?</strong>
                      <p>Pokud existuje spojení přes další linku metra (např. B → C přes Florenc),
                      může být jednodušší než kombinace metra a tramvaje. Porovnej čas, chůzi a přestupy.</p>
                    </div>
                  </div>
                  {!subwayChecked&&!subwayComparison&&<button type="button"
                    disabled={googleLoading||metroLoading||subwayLoading}
                    onClick={()=>void checkSubway()}>
                    {availableSubway?"Porovnat dostupnou trasu pouze metrem (zdarma)":
                      "Prověřit cestu pouze metrem · 1 API požadavek"}
                  </button>}
                  {subwayLoading&&<p role="status">Hledám ověřenou trasu pouze metrem…</p>}
                  {subwayComparison&&<div className="df2-trip-metro-options">
                    <div className="df2-trip-metro-choice">
                      <strong>{transitSummary(subwayComparison.original.options[0])} · {subwayComparison.original.minutes} min</strong>
                      <span>{subwayComparison.original.options[0].transfers} přestupů · pěšky {subwayComparison.original.options[0].walkingMeters} m</span>
                      <button type="button" aria-pressed={subwayComparison.chosen==="original"}
                        onClick={()=>selectSubwayVariant("original")}>Ponechat původní spoj</button>
                    </div>
                    <div className="df2-trip-metro-choice">
                      <strong>{transitSummary(subwayComparison.subway.options[0])} · {subwayComparison.subway.minutes} min</strong>
                      <span>{subwayComparison.subway.options[0].transfers} přestupů · pěšky {subwayComparison.subway.options[0].walkingMeters} m</span>
                      <button type="button" aria-pressed={subwayComparison.chosen==="subway"}
                        onClick={()=>selectSubwayVariant("subway")}>Vybrat pouze metro</button>
                    </div>
                    <small>Přepnutí variant nemá další API náklady. Skutečná dostupnost a délka chůze závisejí na odpovědi Googlu.</small>
                  </div>}
                  {subwayMessage&&<p role="status" className="df2-trip-inline-hint">{subwayMessage}</p>}
                </div>}

                {metroOpportunity&&<div className="df2-trip-metro-compare">
                  <div className="df2-trip-metro-heading">
                    <span className="df2-route-step-icon" aria-hidden="true">🚇</span>
                    <div><strong>A co metro B?</strong>
                      <p>Google zatím vybral {metroPrimary?.transfers} přestupy a {metroPrimary?.walkingMeters} m chůze.
                      U Černého Mostu má smysl prověřit i trasu metrem.</p>
                    </div>
                  </div>
                  {metroParkingAlternative&&!metroComparison&&
                    <div className="df2-trip-metro-park">
                      <span>Vybrané parkoviště může být dál od vstupu do metra. Zvaž P+R Černý Most přímo u stanice B.</span>
                      <button type="button" onClick={()=>{
                        setParkSwitchNotice(true);
                        setLegs(previous=>previous.map((leg,i)=>i===0?{...leg,via:CERNY_MOST_PARK}:leg));
                        setPlaceEditorOpen(false);
                      }}>Nastavit P+R u metra B (bez výpočtu)</button>
                    </div>}
                  {!metroChecked&&!metroComparison&&<button type="button"
                    onClick={()=>void checkMetro()} disabled={googleLoading||metroLoading}>
                    {existingMetroOption?"Porovnat metro z dostupných spojů (zdarma)":"Porovnat trasu metrem B · 1 API požadavek"}
                  </button>}
                  {metroLoading&&<p role="status">Prověřuji metro z tohoto přestupního místa…</p>}
                  {metroComparison&&<div className="df2-trip-metro-options">
                    <div className="df2-trip-metro-choice">
                      <strong>Původní spoj · {metroComparison.original.minutes} min</strong>
                      <span>{metroComparison.original.options[0].transfers} přestupů · pěšky {metroComparison.original.options[0].walkingMeters} m</span>
                      <button type="button" aria-pressed={metroComparison.chosen==="original"}
                        onClick={()=>selectMetroVariant("original")}>Ponechat původní</button>
                    </div>
                    <div className="df2-trip-metro-choice">
                      <strong>{metroComparison.metro.options[0].steps.filter(is=>is.kind==="transit"&&
                          transitPresentation(is.vehicle,is.line).label==="Metro").map(is=>"Metro "+(is.line??"")).join(" → ")||"Metro"} · {metroComparison.metro.minutes} min</strong>
                      <span>{metroComparison.metro.options[0].transfers} přestupů · pěšky {metroComparison.metro.options[0].walkingMeters} m</span>
                      <button type="button" aria-pressed={metroComparison.chosen==="metro"}
                        onClick={()=>selectMetroVariant("metro")}>Vybrat metro</button>
                    </div>
                    <small>Přepínání mezi vypočítanými trasami je bez dalších API požadavků. Čas pro Jarvise nastavíš zvlášť.</small>
                  </div>}
                  {metroMessage&&<p className="df2-trip-inline-hint" role="status">{metroMessage}</p>}
                </div>}

                {routeParts?.some((part,index)=>part.mode==="transit"
                  &&(googleEstimates[index]?.options[0]?.walkingMeters??0)>1000)&&
                  <div className="df2-trip-comfort-warning">
                    <strong>Hodně chůze na této trase</strong>
                    <span>Trasa zahrnuje {Math.round(googleEstimates.reduce((sum,part,i)=>sum+
                      (routeParts[i]?.mode==="transit"?(part.options[0]?.walkingMeters??0):0),0)/100)/10} km chůze.
                      Zkus pohodlnější variantu nebo jiné parkování u metra.</span>
                    {metroParkingAlternative&&!metroOpportunity&&<div className="df2-trip-park-suggestion">
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
                    estimate={part} mode={routeParts?.[index]?.mode??"driving"}
                    preference={appliedSettings.transitPreference}
                    onChoose={routeParts?.[index]?.mode==="transit"&&index===(routeParts?.length??0)-1
                      ?(optionIndex)=>chooseReturnedTransitOption(index,optionIndex):undefined}/>)}
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
            <p className="df2-trip-kind-help">Po explicitním výpočtu se pro plánování Týdne uloží vypočtená doba; bez výpočtu použije Dayframe tvůj ruční odhad. Google se nepřepočítává automaticky.</p>
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
            {calendarMinutes!==undefined&&<p className="df2-trip-calendar-info" role="status">
              Cesta tam bude v Týdnu vyhrazena na <strong>{calendarMinutes}+{buffer} min</strong>
              (cesta + rezerva) bezprostředně před začátkem bloku. Doba z Googlu se uloží až po kliknutí na „Uložit místo“.
            </p>}
            {!mixed&&calendarMinutes===undefined&&<p className="df2-trip-calendar-missing" role="status">
              <strong>Chybí délka přímé cesty.</strong> Bez ní nelze v Týdnu rezervovat čas.
              Použij tlačítko „Spočítat trasu“ (placený API požadavek jen na kliknutí)
              nebo zadej obvyklou dobu cesty ručně. Platí pro auto, MHD, chůzi i kolo.
            </p>}
            <div className="df2-trip-return">
              <label className="df2-trip-return-toggle">
                <input type="checkbox" aria-label="Přidat cestu domů po skončení bloku"
                  checked={returnHome} onChange={e=>setReturnHome(e.target.checked)}/>
                <span><strong>Přidat cestu domů po skončení bloku</strong>
                  <small>Obrácené pořadí úseků · samostatný blok v Týdnu</small></span>
              </label>
              {returnHome&&<>
                {!target.end&&<p>Blok nemá stanovený čas konce. Pro návrat ho nejprve naplánuj.</p>}
                <label>Doba zpáteční cesty (min)
                  <input type="number" min="1" max="1440" aria-label="Doba cesty domů"
                    value={returnMinutes} placeholder={String(calendarMinutes??"")}
                    onChange={e=>{setReturnMinutes(e.target.value);setReturnVerified(false);}}/>
                </label>
                <p className="df2-trip-kind-help">{returnVerified
                  ?"Zpáteční doba ověřena samostatným výpočtem pro čas po skončení bloku."
                  :"Pokud nezadáš vlastní dobu, použije se délka cesty tam jako orientační odhad. Skutečná cesta zpět se může lišit."}</p>
                {routeParts&&googleAvailable&&target.end&&<button type="button" className="df2-trip-return-calc"
                  disabled={reverseLoading||googleLoading||metroLoading||subwayLoading}
                  onClick={()=>void calculateReturn()}>
                  {reverseLoading?"Počítám zpáteční trasu…":
                    "Spočítat zpáteční trasu ("+routeParts.length+" API požad.)"}
                </button>}
                {reverseError&&<p role="alert" className="df2-travel-error">{reverseError}</p>}
                {target.end&&<p className="df2-trip-kind-help">Návrat začne po skončení bloku v {target.end}.
                  Vyhradí {returnMinutes||calendarMinutes||"?"} min. Zbytek týdne nesmí automaticky zasahovat do této rezervace.</p>}
              </>}
            </div>
            {!target.start&&<p className="df2-trip-kind-help">Blok zatím nemá začátek. Jarvis odjezd dopočítá, až blok naplánuješ na určitý čas.</p>}
          </section>
          {!mixed&&destination&&<a target="_blank" rel="noopener noreferrer"
            href={travelDirectionsUrl(origin,destination,mode)}>Otevřít trasu v Google Maps ↗</a>}
        </>}
        {error&&<p role="alert" className="df2-travel-error">{error}</p>}
        <footer><button type="button" onClick={onClose}>Zrušit</button>
          {offsite&&!mixed&&origin&&target.start&&target.end&&calendarMinutes===undefined&&!returnHome&&
            <button type="button" className="df2-travel-location-only"
              onClick={()=>submit(true)}>Uložit pouze místo (bez cesty)</button>}
          <button type="button" className="df2-travel-save" onClick={()=>submit()}>Uložit místo</button></footer>
      </>}
    </section>
  </div>;
}
