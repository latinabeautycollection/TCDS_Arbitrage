export function validateEbayImages(urls:string[]): string[] { const e:string[]=[]; if(!urls.length) e.push('NO_IMAGES'); if(urls.length>24) e.push('TOO_MANY_IMAGES'); return e; }
