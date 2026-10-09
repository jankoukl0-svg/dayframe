// Browser-local image storage. The Hygiene metadata store remains the single
// source of truth for product assignments; binary photos live outside localStorage.
const DATABASE = "dayframe-hygiene-images";
const STORE = "photos";
export const MAX_PRODUCT_PHOTO_BYTES = 6 * 1024 * 1024;

export function validateProductPhoto(file: File): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return "Použij fotografii JPG, PNG nebo WebP.";
  }
  if (!file.size || file.size > MAX_PRODUCT_PHOTO_BYTES) {
    return "Fotografie musí mít maximálně 6 MB.";
  }
  return null;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Tento prohlížeč nepodporuje místní ukládání fotografií."));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Úložiště fotografií nelze otevřít."));
    request.onblocked = () => reject(new Error("Úložiště fotografií je blokované jinou záložkou."));
  });
}

async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let response: T;
    const transaction = db.transaction(STORE, mode);
    const request = operation(transaction.objectStore(STORE));
    request.onsuccess = () => { response = request.result; };
    transaction.oncomplete = () => { db.close(); resolve(response); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error("Fotografii nelze uložit.")); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("Ukládání fotografie bylo přerušeno.")); };
  });
}

export function saveProductPhoto(key: string, file: File): Promise<IDBValidKey> {
  const invalid = validateProductPhoto(file);
  if (invalid) return Promise.reject(new Error(invalid));
  return transact("readwrite", (store) => store.put(file, key));
}

export function loadProductPhoto(key: string): Promise<Blob | undefined> {
  return transact<Blob | undefined>("readonly", (store) => store.get(key));
}

export function removeProductPhoto(key: string): Promise<undefined> {
  return transact<undefined>("readwrite", (store) => store.delete(key));
}
