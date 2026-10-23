import type { DeviceEnrollmentProfile, DeviceSecrets } from '../types/authTypes';

const DB_NAME = 'tcds-warehouse-identity';
const DB_VERSION = 1;
const PROFILE_STORE = 'device-profile';
const SECRET_STORE = 'device-secrets';
const PROFILE_KEY = 'active';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROFILE_STORE)) db.createObjectStore(PROFILE_STORE);
      if (!db.objectStoreNames.contains(SECRET_STORE)) db.createObjectStore(SECRET_STORE);
    };
    request.onerror = () => reject(request.error ?? new Error('DEVICE_STORE_OPEN_FAILED'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function get<T>(storeName:string,key:string):Promise<T|null>{
  const db=await openDb();
  try{return await new Promise<T|null>((resolve,reject)=>{const tx=db.transaction(storeName,'readonly');const r=tx.objectStore(storeName).get(key);r.onsuccess=()=>resolve((r.result as T|undefined)??null);r.onerror=()=>reject(r.error);});}
  finally{db.close();}
}
async function put<T>(storeName:string,key:string,value:T):Promise<void>{
  const db=await openDb();
  try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(storeName,'readwrite');tx.objectStore(storeName).put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('DEVICE_STORE_ABORTED'));});}
  finally{db.close();}
}
async function del(storeName:string,key:string):Promise<void>{
  const db=await openDb();
  try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(storeName,'readwrite');tx.objectStore(storeName).delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
  finally{db.close();}
}

export const deviceCredentialStore={
  profile:()=>get<DeviceEnrollmentProfile>(PROFILE_STORE,PROFILE_KEY),
  secrets:()=>get<DeviceSecrets>(SECRET_STORE,PROFILE_KEY),
  async provision(profile:DeviceEnrollmentProfile,secrets:DeviceSecrets){
    if(profile.schemaVersion!==1||secrets.schemaVersion!==1)throw new Error('DEVICE_ENROLLMENT_VERSION_UNSUPPORTED');
    await put(PROFILE_STORE,PROFILE_KEY,profile); await put(SECRET_STORE,PROFILE_KEY,secrets);
  },
  async clear(){await del(PROFILE_STORE,PROFILE_KEY);await del(SECRET_STORE,PROFILE_KEY);}
};
