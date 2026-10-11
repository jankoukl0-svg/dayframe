"use client";
import {useEffect,useState} from "react";
import {loadSupplementPhoto} from "@/lib/dayframe-supplement-photos";

/** Stable local photo viewer; every generated object URL is revoked on cleanup. */
export function SupplementPhoto({photoId,name,previewFile,large=false}:{
  photoId?:string;name:string;previewFile?:File|null;large?:boolean;
}){
  const [url,setUrl]=useState<string|null>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    let revoked=false;
    let objectUrl:string|null=null;
    setUrl(null);setFailed(false);
    const apply=(blob:Blob)=>{
      if(revoked)return;
      objectUrl=URL.createObjectURL(blob);
      setUrl(objectUrl);
    };
    if(previewFile)apply(previewFile);
    else if(photoId)loadSupplementPhoto(photoId).then(blob=>{
      if(blob)apply(blob);else if(!revoked)setFailed(true);
    }).catch(()=>{if(!revoked)setFailed(true);});
    return ()=>{revoked=true;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[photoId,previewFile]);
  return <div className={"df2-supplement-photo"+(large?" is-large":"")} data-supplement-photo={photoId??"none"}>
    {url?<img src={url} alt={"Fotografie produktu "+name} loading="lazy" onError={()=>{URL.revokeObjectURL(url);setUrl(null);setFailed(true);}}/>:
      <span className="df2-supplement-photo-placeholder" aria-label={failed?"Fotografie není dostupná":"Bez fotografie"} aria-hidden="true">◻</span>}
  </div>;
}
