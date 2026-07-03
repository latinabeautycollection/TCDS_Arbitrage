export async function traceListing<T>(_name:string, fn:()=>Promise<T>): Promise<T> { return fn(); }
