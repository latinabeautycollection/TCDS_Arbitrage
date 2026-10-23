export function toBytes(value:string):Uint8Array{
  const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
  const padded=normalized+'='.repeat((4-normalized.length%4)%4);
  const binary=atob(padded); const out=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i+=1)out[i]=binary.charCodeAt(i);
  return out;
}
export function fromBytes(input:ArrayBuffer|Uint8Array):string{
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input); let binary='';
  for(const b of bytes)binary+=String.fromCharCode(b);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
