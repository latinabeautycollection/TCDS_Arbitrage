export type RoundingMode='REJECT_EXCESS_PRECISION'|'HALF_UP'|'HALF_EVEN'|'DOWN';

export class FixedDecimal{
 private constructor(private readonly units:bigint,public readonly scale:number){}
 static parse(value:string|number,scale=8,rounding:RoundingMode='REJECT_EXCESS_PRECISION'):FixedDecimal{
  const s=String(value).trim();if(!/^-?\d+(?:\.\d+)?$/.test(s))throw new Error(`INVALID_DECIMAL:${s}`);
  const neg=s.startsWith('-');const raw=neg?s.slice(1):s;const [whole,frac='']=raw.split('.');
  let kept=frac.slice(0,scale);const extra=frac.slice(scale);
  if(extra&&/[1-9]/.test(extra)){
   if(rounding==='REJECT_EXCESS_PRECISION')throw new Error('EXCESS_MONETARY_PRECISION');
   if(rounding==='HALF_UP' && Number(`0.${extra}`)>=0.5){
    const base=BigInt(whole!)*10n**BigInt(scale)+BigInt((kept+'0'.repeat(scale)).slice(0,scale)||'0');
    return new FixedDecimal(neg?-(base+1n):base+1n,scale);
   }
  }
  kept=(kept+'0'.repeat(scale)).slice(0,scale);
  const u=BigInt(whole!)*10n**BigInt(scale)+BigInt(kept||'0');
  return new FixedDecimal(neg?-u:u,scale);
 }
 add(o:FixedDecimal){this.same(o);return new FixedDecimal(this.units+o.units,this.scale);}
 sub(o:FixedDecimal){this.same(o);return new FixedDecimal(this.units-o.units,this.scale);}
 toString(){const neg=this.units<0n;const u=neg?-this.units:this.units;const f=10n**BigInt(this.scale);const w=u/f;const fr=(u%f).toString().padStart(this.scale,'0').replace(/0+$/,'');return `${neg?'-':''}${w}${fr?'.'+fr:''}`;}
 private same(o:FixedDecimal){if(o.scale!==this.scale)throw new Error('DECIMAL_SCALE_MISMATCH');}
}
