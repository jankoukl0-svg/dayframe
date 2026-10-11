const DB = "dayframe-body-photos-v1";
const STORE = "photos";

function openDb():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==="undefined"){reject(new Error("Fotografie vyžadují podporu IndexedDB."));return;}
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
    request.onerror=()=>reject(request.error??new Error("Nelze otevřít úložiště fotografií."));
    request.onsuccess=()=>resolve(request.result);
  });
}
async function transact<T>(mode:IDBTransactionMode,id:string,data?:Blob):Promise<T>{
  const db=await openDb();
  return new Promise<T>((resolve,reject)=>{
    let settled=false;
    const tx=db.transaction(STORE,mode);
    const request=data ? tx.objectStore(STORE).put(data,id)
      : mode==="readonly" ? tx.objectStore(STORE).get(id) : tx.objectStore(STORE).delete(id);
    let result:unknown=null;
    request.onsuccess=()=>{result=request.result;};
    request.onerror=()=>{settled=true;reject(request.error);};
    tx.oncomplete=()=>{db.close();if(!settled)resolve(result as T);};
    tx.onerror=()=>{db.close();if(!settled)reject(tx.error);};
    tx.onabort=()=>{db.close();if(!settled)reject(tx.error??new Error("Ukládání fotografie bylo přerušeno."));};
  });
}
export async function saveBodyPhoto(id:string,photo:Blob):Promise<void>{
  if(!/^[a-z0-9-]{8,110}$/.test(id))throw Error("Neplatný identifikátor fotografie.");
  if(!["image/jpeg","image/png","image/webp"].includes(photo.type)||photo.size===0||photo.size>6*1024*1024)
    throw Error("Fotografie musí být JPG, PNG nebo WebP do 6 MB.");
  await transact<void>("readwrite",id,photo);
}
export async function loadBodyPhoto(id:string):Promise<Blob|null>{
  const value=await transact<Blob|undefined>("readonly",id);
  return value instanceof Blob?value:null;
}
export async function deleteBodyPhoto(id:string):Promise<void>{
  await transact<void>("readwrite",id);
}
