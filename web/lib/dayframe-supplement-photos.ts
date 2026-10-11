/** Supplement package photographs stay local in IndexedDB, never in localStorage or cloud. */
const DB="dayframe-supplement-photos-v1";
const STORE="photos";
export const SUPPLEMENT_PHOTO_TYPES=["image/jpeg","image/png","image/webp"] as const;
export const SUPPLEMENT_PHOTO_MAX_SIZE=6*1024*1024;
export function validSupplementPhoto(file:Blob):boolean {
  return SUPPLEMENT_PHOTO_TYPES.some(type=>type===file.type)
    &&file.size>0&&file.size<=SUPPLEMENT_PHOTO_MAX_SIZE;
}
export function validSupplementPhotoId(id:unknown):id is string{
  return typeof id==="string"&& /^supp-photo-[a-f0-9-]{20,80}$/.test(id);
}
function openDb():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==="undefined"){reject(Error("Tento prohlížeč nepodporuje ukládání fotografií."));return;}
    const req=indexedDB.open(DB,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};
    req.onerror=()=>reject(req.error??Error("Nepodařilo se otevřít úložiště fotografií."));
    req.onsuccess=()=>resolve(req.result);
  });
}
async function operation<T>(id:string,mode:IDBTransactionMode,photo?:Blob):Promise<T>{
  if(!validSupplementPhotoId(id))throw Error("Neplatné ID fotografie.");
  const db=await openDb();
  return new Promise<T>((resolve,reject)=>{
    let result:unknown=null;
    let settled=false;
    let req:IDBRequest;
    try{
      const tx=db.transaction(STORE,mode);
      req=photo?tx.objectStore(STORE).put(photo,id):
        mode==="readonly"?tx.objectStore(STORE).get(id):tx.objectStore(STORE).delete(id);
      req.onsuccess=()=>{result=req.result;};
      req.onerror=()=>{settled=true;reject(req.error??Error("Operace s fotografií selhala."));};
      tx.oncomplete=()=>{db.close();if(!settled)resolve(result as T);};
      tx.onerror=()=>{db.close();if(!settled)reject(tx.error??Error("Operace s fotografií selhala."));};
      tx.onabort=()=>{db.close();if(!settled)reject(tx.error??Error("Ukládání fotografie bylo přerušeno."));};
    }catch(error){db.close();reject(error);}
  });
}
export async function saveSupplementPhoto(id:string,photo:Blob):Promise<void>{
  if(!validSupplementPhoto(photo))throw Error("Vyber JPG, PNG nebo WebP do 6 MB.");
  await operation<void>(id,"readwrite",photo);
}
export async function loadSupplementPhoto(id:string):Promise<Blob|null>{
  const photo=await operation<Blob|undefined>(id,"readonly");
  return photo instanceof Blob&&validSupplementPhoto(photo)?photo:null;
}
export async function deleteSupplementPhoto(id:string):Promise<void>{
  await operation<void>(id,"readwrite");
}
