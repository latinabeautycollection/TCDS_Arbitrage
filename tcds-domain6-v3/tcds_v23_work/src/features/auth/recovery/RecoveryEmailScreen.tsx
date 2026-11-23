import {useEffect,useRef,useState,type FormEvent} from 'react';
import {CheckCircle2,Clock3,MailCheck,MailPlus,RefreshCw} from 'lucide-react';
import {AppHeader} from '../../../components/AppHeader';
import {ScreenCard} from '../../../components/ScreenCard';
import {PrimaryButton} from '../../../components/PrimaryButton';
import {RecoveryApiError} from './recoveryApi';
import {recoveryEmailApi,type RecoveryEmailView} from './recoveryEmailApi';

// Recovery email (TCDS 645): the signed-in employee adds an address, confirms the code sent to it, then an
// administrator approves it with a passkey. Only an approved address can be used to reset a forgotten password.
const field='tcds-focus mt-2 min-h-14 w-full rounded-2xl border border-tcds-line bg-white px-4 text-[16px] font-semibold text-tcds-ink placeholder:text-tcds-muted focus:border-tcds-gold disabled:opacity-60';
const when=(iso?:string)=>{if(!iso)return '';const t=Date.parse(iso);return Number.isFinite(t)?new Date(t).toLocaleString([],{dateStyle:'medium',timeStyle:'short'}):''};
const ERRORS:Record<string,string>={
 RECOVERY_EMAIL_INVALID:'Enter a valid email address.',
 RECOVERY_CONTACT_ALREADY_ACTIVE:'That address is already your recovery email.',
 RECOVERY_CONTACT_TOO_MANY_ATTEMPTS:'You have tried too many times today. Try again tomorrow, or ask your administrator.',
 RECOVERY_CODE_INVALID:'That code is not correct. Check the latest email and try again.',
 RECOVERY_CONTACT_CODE_UNAVAILABLE:'This code can no longer be used (it expired, was used, or had too many attempts). Send a new code.',
 RATE_LIMITED:'Too many attempts. Wait a few minutes, then try again.',
 SESSION_INVALID:'Your session ended. Sign in again.',
};
const message=(e:unknown)=>ERRORS[e instanceof RecoveryApiError?e.code:'']??'Something went wrong. Check your connection and try again.';

export function RecoveryEmailScreen(){
 const [view,setView]=useState<RecoveryEmailView|null>(null);const [loadError,setLoadError]=useState('');
 const [email,setEmail]=useState('');const [lastEmail,setLastEmail]=useState('');const [code,setCode]=useState('');
 const [changing,setChanging]=useState(false);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState<{text:string;ok:boolean}|null>(null);
 const codeRef=useRef<HTMLInputElement>(null);const emailRef=useRef<HTMLInputElement>(null);
 async function load(){setLoadError('');try{setView(await recoveryEmailApi.view())}catch(e){setLoadError(message(e))}}
 useEffect(()=>{void load()},[]);
 const pending=view?.pending??null;
 useEffect(()=>{if(pending?.status==='AWAITING_CODE')codeRef.current?.focus()},[pending?.status]);
 async function run(fn:()=>Promise<RecoveryEmailView>,ok?:string){setBusy(true);setNotice(null);
  try{const v=await fn();setView(v);if(ok)setNotice({text:ok,ok:true});return true}catch(e){setNotice({text:message(e),ok:false});return false}finally{setBusy(false)}}
 async function start(e:FormEvent){e.preventDefault();const a=email.trim();if(!a||busy)return;
  if(await run(()=>recoveryEmailApi.start(a),'We sent an 8-digit code to that address. It expires in 10 minutes.')){setLastEmail(a);setEmail('');setCode('');setChanging(false)}}
 async function verify(e:FormEvent){e.preventDefault();const c=code.replace(/\D/g,'');if(c.length!==8||busy)return;
  if(!await run(()=>recoveryEmailApi.verify(c),'Code confirmed. An administrator will now approve your recovery email.')){setCode('');codeRef.current?.focus()}}
 async function resend(){if(!lastEmail){setChanging(true);setTimeout(()=>emailRef.current?.focus(),0);return}
  await run(()=>recoveryEmailApi.start(lastEmail),'We sent a new code. Use the newest email.');setCode('')}
 async function cancel(){await run(()=>recoveryEmailApi.cancel(),'Request cancelled.');setChanging(false)}
 const digits=code.replace(/\D/g,'');
 const showForm=!!view&&!pending&&(!view.active||changing);

 return <><AppHeader title="Recovery email" subtitle="Used only to reset a forgotten password"/>
 <div className="mx-auto max-w-md space-y-4 p-4 pb-28">
  {!view&&!loadError&&<ScreenCard><div role="status" className="skeleton h-14 w-full rounded-2xl"/></ScreenCard>}
  {loadError&&<ScreenCard><p role="alert" className="text-sm font-semibold text-red-700">{loadError}</p>
   <button type="button" className="tcds-focus mt-3 inline-flex min-h-12 items-center gap-2 rounded-xl border border-tcds-line px-4 font-black" onClick={()=>void load()}><RefreshCw size={16}/> Try again</button></ScreenCard>}

  {view?.active&&!changing&&<ScreenCard>
   <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-tcds-green" size={22}/>
    <div className="min-w-0"><p className="text-xs font-black uppercase tracking-[.18em] text-tcds-muted">Active recovery email</p>
     <p className="mt-1 break-all font-display text-xl font-black text-tcds-ink">{view.active.email}</p>
     <p className="mt-1 text-sm text-tcds-muted">Approved {when(view.active.since)}. If you forget your password, the reset code goes here.</p></div></div>
   {!pending&&<button type="button" className="tcds-focus mt-4 min-h-12 rounded-xl border border-tcds-line px-4 text-sm font-black" onClick={()=>{setChanging(true);setNotice(null);setTimeout(()=>emailRef.current?.focus(),0)}}>Change recovery email</button>}
  </ScreenCard>}

  {view&&!view.active&&!pending&&!changing&&<ScreenCard>
   <div className="flex items-start gap-3"><MailPlus className="mt-0.5 shrink-0 text-tcds-gold" size={22}/>
    <div><p className="font-display text-lg font-black">No recovery email yet</p>
     <p className="mt-1 text-sm text-tcds-muted">Add a personal email you can open from home. If you ever forget your password, an administrator can then send you a reset code there.</p></div></div>
  </ScreenCard>}

  {showForm&&<ScreenCard><form onSubmit={start} className="space-y-4">
   <label className="block text-sm font-black text-tcds-ink">{view?.active?'New recovery email':'Recovery email'}
    <input ref={emailRef} className={field} type="email" inputMode="email" autoComplete="email" maxLength={254} placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} disabled={busy}/></label>
   <p className="text-xs text-tcds-muted">Use an address only you can open. A shared or work mailbox others can read is not safe for password recovery.</p>
   <PrimaryButton loading={busy} disabled={!email.trim()}>Send code</PrimaryButton>
   {view?.active&&<button type="button" className="tcds-focus min-h-12 w-full rounded-xl text-sm font-black text-tcds-muted" onClick={()=>{setChanging(false);setEmail('');setNotice(null)}}>Keep {view.active.email}</button>}
  </form></ScreenCard>}

  {pending?.status==='AWAITING_CODE'&&<ScreenCard><form onSubmit={verify} className="space-y-4">
   <div className="flex items-start gap-3"><MailCheck className="mt-0.5 shrink-0 text-tcds-gold" size={22}/>
    <div><p className="font-display text-lg font-black">Check your email</p>
     <p className="mt-1 text-sm text-tcds-muted">Enter the 8-digit code we sent to <b className="text-tcds-ink">{pending.email}</b>. It expires 10 minutes after it was sent.</p></div></div>
   <label className="block text-sm font-black text-tcds-ink">Confirmation code
    <input ref={codeRef} className={`${field} tracking-[0.3em]`} inputMode="numeric" autoComplete="one-time-code" maxLength={11} placeholder="8 digits" value={code} onChange={e=>setCode(e.target.value)} disabled={busy}/></label>
   <PrimaryButton loading={busy} disabled={digits.length!==8}>Confirm code</PrimaryButton>
   <div className="flex flex-wrap justify-between gap-2">
    <button type="button" className="tcds-focus min-h-12 rounded-xl px-2 text-sm font-black text-tcds-ink underline disabled:opacity-50" disabled={busy} onClick={()=>void resend()}>{lastEmail?'Send a new code':'Send a new code to a different address'}</button>
    <button type="button" className="tcds-focus min-h-12 rounded-xl px-2 text-sm font-black text-red-700 disabled:opacity-50" disabled={busy} onClick={()=>void cancel()}>Cancel</button>
   </div>
  </form></ScreenCard>}

  {pending?.status==='AWAITING_APPROVAL'&&<ScreenCard>
   <div className="flex items-start gap-3"><Clock3 className="mt-0.5 shrink-0 text-tcds-gold" size={22}/>
    <div className="min-w-0"><p className="text-xs font-black uppercase tracking-[.18em] text-tcds-muted">Waiting for approval</p>
     <p className="mt-1 break-all font-display text-xl font-black text-tcds-ink">{pending.email}</p>
     <p className="mt-1 text-sm text-tcds-muted">You confirmed the code. An administrator now approves the address with their passkey{pending.required>1?` (${pending.approvals} of ${pending.required} approvals)`:''}. Until then {view?.active?`${view.active.email} stays your recovery email`:'it cannot be used for a password reset'}.</p>
     <p className="mt-2 text-xs text-tcds-muted">Request expires {when(pending.expiresAt)}.</p></div></div>
   <div className="mt-4 flex flex-wrap gap-2">
    <button type="button" className="tcds-focus inline-flex min-h-12 items-center gap-2 rounded-xl border border-tcds-line px-4 text-sm font-black disabled:opacity-50" disabled={busy} onClick={()=>void run(()=>recoveryEmailApi.view())}><RefreshCw size={16}/> Check status</button>
    <button type="button" className="tcds-focus min-h-12 rounded-xl px-3 text-sm font-black text-red-700 disabled:opacity-50" disabled={busy} onClick={()=>void cancel()}>Cancel request</button>
   </div>
  </ScreenCard>}

  {notice&&<div role={notice.ok?'status':'alert'} aria-live="polite" className={`rounded-2xl border p-4 text-sm font-semibold ${notice.ok?'border-emerald-300 bg-emerald-50 text-emerald-900':'border-amber-300 bg-amber-50 text-amber-900'}`}>{notice.text}</div>}
 </div></>;
}
