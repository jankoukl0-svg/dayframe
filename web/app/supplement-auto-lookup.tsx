"use client";
import {useEffect,useRef,useState} from "react";
import {findBestProductPackshot,type PackshotCandidate} from "@/lib/dayframe-product-packshots";
import {sameSupplementProduct,supplementSuggestionFromUrl,packCountFromLabel,type SupplementLookupMatch} from "@/lib/dayframe-supplement-lookup";

type LookupResponse={matches?:SupplementLookupMatch[];notice?:string;error?:unknown};
function safeLookupError(value:unknown,status:number):string{
  if(typeof value==="string"&&value.trim()&&!value.includes("[object Object]"))return value.slice(0,250);
  if(value&&typeof value==="object"&&"message" in value){
    const message=(value as {message?:unknown}).message;
    if(typeof message==="string"&&message.trim()&&!message.includes("[object Object]"))
      return message.slice(0,250);
  }
  return "Vyhledávání je momentálně nedostupné (HTTP "+status+"). Zkus jiný odkaz nebo doplň údaje ručně.";
}
/** Hygiene already indexes product pages independently: safe fallback for a broken supplement function. */
async function fallbackProductPage(url:string):Promise<SupplementLookupMatch[]>{
  const response=await fetch("/api/hygiene-product-lookup?query="+encodeURIComponent(url),
    {signal:AbortSignal.timeout(9000)});
  if(!response.ok||!response.headers.get("content-type")?.includes("application/json"))return [];
  const value=await response.json() as {matches?:unknown};
  if(!Array.isArray(value.matches))return [];
  const canonical=(s:string)=>{try{const x=new URL(s);return x.hostname+x.pathname.replace(/\/$/,"");}catch{return "";}};
  return value.matches.filter((x):x is Record<string,unknown>=>!!x&&typeof x==="object")
    .filter(x=>typeof x.name==="string"&&typeof x.sourceUrl==="string"&&canonical(x.sourceUrl)===canonical(url))
    .slice(0,4).map(x=>{
      const name=String(x.name).slice(0,160),amount=typeof x.amount==="string"?x.amount.slice(0,130):"";
      const pack=packCountFromLabel(name+" "+amount);
      return {name,brand:typeof x.brand==="string"?x.brand.slice(0,100):"",amount,
        priceCzk:typeof x.priceCzk==="number"&&Number.isFinite(x.priceCzk)?x.priceCzk:null,
        imageUrl:typeof x.imageUrl==="string"&&x.imageUrl.startsWith("https://")?x.imageUrl:"",
        sourceUrl:String(x.sourceUrl),sourceLabel:"Produktová stránka",
        packServings:pack?.count??null,packUnit:pack?.unit??""};
    });
}
type Props={
  hint:string|null;
  onApply:(match:SupplementLookupMatch)=>void;
  onPhoto:(file:File)=>void;
  onBusy:(busy:boolean)=>void;
  manualPhoto:boolean;
};
/** Real product discovery; never invents dosage or unverified package details. */
export function SupplementAutoLookup({hint,onApply,onPhoto,onBusy,manualPhoto}:Props){
  const [query,setQuery]=useState("");
  const [busy,setBusy]=useState(false);
  const [findingPhoto,setFindingPhoto]=useState(false);
  const [matches,setMatches]=useState<SupplementLookupMatch[]>([]);
  const [notice,setNotice]=useState("");
  const [error,setError]=useState("");
  const [photoNotice,setPhotoNotice]=useState("");
  const alive=useRef(true);
  const request=useRef(0);
  const photoRequest=useRef(0);
  const lastQuery=useRef("");
  const manualRef=useRef(manualPhoto);
  const callbackRef=useRef({onApply,onPhoto,onBusy});
  useEffect(()=>{manualRef.current=manualPhoto;},[manualPhoto]);
  useEffect(()=>{callbackRef.current={onApply,onPhoto,onBusy};},[onApply,onPhoto,onBusy]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++;photoRequest.current++;callbackRef.current.onBusy(false);};},[]);
  const invalidatePending=()=>{
    request.current++;photoRequest.current++;lastQuery.current="";
    setBusy(false);setFindingPhoto(false);setMatches([]);
    callbackRef.current.onBusy(false);
  };
  useEffect(()=>{
    if(hint!==null){invalidatePending();setQuery(hint);}
  // Changes typed into name/link fields must cancel pending responses immediately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[hint]);

  const apply=async(match:SupplementLookupMatch)=>{
    request.current++;setBusy(false);
    photoRequest.current++;setFindingPhoto(false);callbackRef.current.onBusy(false);
    setMatches([]);setError("");
    setNotice("Doplnil jsem dostupné údaje produktu. Dávku vyplň podle etikety nebo odborníka.");
    callbackRef.current.onApply(match);
    const photoSession=++photoRequest.current;
    // An intentional manual selection always wins over a remote photo.
    if(manualRef.current)return;
    setFindingPhoto(true);callbackRef.current.onBusy(true);
    setPhotoNotice("Hledám fotografii produktu s čistým bílým pozadím…");
    try{
      const params=new URLSearchParams({mode:"photos",name:match.name,brand:match.brand,
        url:match.sourceUrl,image:match.imageUrl});
      let candidates:PackshotCandidate[]=[];
      try{
        const res=await fetch("/api/hygiene-product-lookup?"+params,{signal:AbortSignal.timeout(16000)});
        if(res.ok){
          const payload=await res.json() as {candidates?:PackshotCandidate[]};
          candidates=(payload.candidates??[]).filter(x=>x&&typeof x.url==="string"
            &&typeof x.source==="string"&&typeof x.priority==="number");
        }
      }catch{/* Direct packshot URL remains available. */}
      if(match.imageUrl.startsWith("https://")&&!candidates.some(x=>x.url===match.imageUrl))
        candidates.unshift({url:match.imageUrl,source:match.sourceLabel,priority:25});
      const selected=await findBestProductPackshot(candidates);
      if(!alive.current||photoRequest.current!==photoSession||manualRef.current)return;
      if(selected){
        callbackRef.current.onPhoto(selected.file);
        setPhotoNotice(selected.quality==="white"?"Fotografie s bílým pozadím byla doplněna."
          :selected.quality==="cleaned"?"Pozadí fotografie se podařilo sjednotit na bílou."
          :"Fotografie byla doplněna; bílé pozadí nelze spolehlivě zaručit.");
      }else setPhotoNotice("Fotografii se nepodařilo bezpečně získat. Můžeš ji nahrát ručně.");
    }catch{
      if(alive.current&&photoRequest.current===photoSession)
        setPhotoNotice("Fotografii se nepodařilo zpracovat. Můžeš ji vybrat ručně.");
    }finally{
      if(alive.current&&photoRequest.current===photoSession){
        setFindingPhoto(false);callbackRef.current.onBusy(false);
      }
    }
  };
  const search=async(value:string,force=false)=>{
    const q=value.trim();
    if(q.length<3){setError("Zadej alespoň 3 znaky názvu nebo HTTPS odkaz.");return;}
    if(!force&&lastQuery.current===q)return;
    lastQuery.current=q;
    const id=++request.current;
    photoRequest.current++; // Prior lookup must never set a stale packshot.
    setFindingPhoto(false);callbackRef.current.onBusy(false);
    setBusy(true);setError("");setNotice("");setMatches([]);setPhotoNotice("");
    try{
      let choices:SupplementLookupMatch[]=[];
      let info="";
      let failure="";
      try{
        const res=await fetch("/api/supplement-product-lookup?query="+encodeURIComponent(q),
          {signal:AbortSignal.timeout(16500),headers:{Accept:"application/json"}});
        if(!res.headers.get("content-type")?.includes("application/json"))
          throw Error("Vyhledávací server vrátil neplatnou odpověď.");
        const data=await res.json() as LookupResponse;
        if(!res.ok)throw Error(safeLookupError(data?.error,res.status));
        choices=Array.isArray(data?.matches)?data.matches.filter((x):x is SupplementLookupMatch=>
          !!x&&typeof x.name==="string"&&!!x.name.trim()
          &&typeof x.sourceUrl==="string"&&x.sourceUrl.startsWith("https://")).slice(0,6):[];
        info=typeof data.notice==="string"?data.notice:"";
      }catch(e){
        failure=e instanceof Error?e.message:"Vyhledávací server nyní není dostupný.";
      }
      if(!alive.current||id!==request.current)return;
      const isLink=/^https:\/\//i.test(q);
      if(isLink&&choices.length===0){
        try{choices=await fallbackProductPage(q);}catch{/* A shop may block both services. */}
      }
      if(!alive.current||id!==request.current)return;
      if(isLink&&choices.length===0){
        const inferred=supplementSuggestionFromUrl(q);
        if(inferred){
          setMatches([inferred]);
          setNotice("Stránku se nepodařilo načíst. Toto je pouze neověřený návrh názvu podle odkazu; "
            +"balení, cenu a fotografii je nutné ověřit nebo doplnit ručně.");
          setError("");
          return;
        }
      }
      if(choices.length===0&&failure){setError(failure);return;}
      if(choices.length===0){setNotice(info||"Odpovídající produkt se nepodařilo ověřit.");return;}
      setNotice(info||"Vyber správný produkt a zkontroluj variantu balení.");
      const exactLink=isLink&&choices.length===1&&(()=>{
        try{
          const a=new URL(choices[0].sourceUrl),b=new URL(q);
          return a.hostname===b.hostname&&a.pathname.replace(/\/$/,"")===b.pathname.replace(/\/$/,"");
        }catch{return false;}
      })();
      const exactName=!isLink&&choices.length===1
        &&sameSupplementProduct(choices[0].name,choices[0].brand,q)
        &&[choices[0].name,choices[0].brand+" "+choices[0].name]
          .some(name=>name.trim().toLocaleLowerCase("cs")===q.toLocaleLowerCase("cs"));
      if(exactLink||exactName){
        await apply(choices[0]);
      }else setMatches(choices);
    }catch(e){
      if(alive.current&&id===request.current)
        setError(e instanceof Error?e.message:"Produkt se nepodařilo vyhledat.");
    }finally{if(alive.current&&id===request.current)setBusy(false);}
  };
  useEffect(()=>{
    if(query.trim().length<4)return;
    const timeout=window.setTimeout(()=>{void search(query);},/^https:\/\//i.test(query.trim())?350:950);
    return()=>window.clearTimeout(timeout);
  // Search is intentionally tied to user-entered text; callback refs avoid stale parent props.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[query]);
  return <div className="df2-supplement-autofill" data-supplement-autofill>
    <div className="df2-supplement-autofill-intro">
      <strong>Automaticky najít produkt</strong>
      <small>Napiš název nebo vlož odkaz. Zkontroluj nalezenou variantu před uložením.</small>
    </div>
    <div className="df2-supplement-autofill-row">
      <input type="text" aria-label="Název nebo odkaz suplementu" value={query}
        placeholder="Např. MyProtein Creatine nebo https://…"
        onChange={e=>{invalidatePending();setQuery(e.target.value);}}
        onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void search(query,true);}}}/>
      <button type="button" disabled={busy||findingPhoto} onClick={()=>void search(query,true)}>
        {busy?"Vyhledávám…":"Vyhledat"}
      </button>
    </div>
    {busy&&<small role="status">Vyhledávám odpovídající produkty…</small>}
    {error&&<p role="alert" className="df2-hygiene-error">{error}</p>}
    {!error&&notice&&<small role="status">{notice}</small>}
    {matches.length>0&&<div className="df2-supplement-autofill-results" aria-label="Nalezené suplementy">
      {matches.map((match,index)=><article key={match.sourceUrl+index}>
        <div><strong>{match.name}</strong><small>{[match.brand,match.amount,match.sourceLabel].filter(Boolean).join(" · ")}</small></div>
        <button type="button" onClick={()=>void apply(match)} disabled={findingPhoto}>Použít produkt</button>
      </article>)}
    </div>}
    {photoNotice&&<small role="status">{photoNotice}</small>}
  </div>;
}
