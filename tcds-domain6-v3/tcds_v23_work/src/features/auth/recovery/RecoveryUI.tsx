import {useEffect,useRef,useState,type ReactNode,type FormEvent} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {ArrowLeft,ArrowRight,CheckCircle2,Eye,EyeOff,KeyRound,LockKeyhole,ShieldAlert,ShieldCheck,UserRoundCheck} from 'lucide-react';

import {ScreenCard} from '../../../components/ScreenCard';
import {PrimaryButton} from '../../../components/PrimaryButton';
import {recoveryApi,RecoveryApiError,type Reason,type Review} from './recoveryApi';
import {useAuth} from '../context/AuthContext';
import {authenticateWithPasskey} from '../security/webauthnBrowser';
const input='tcds-focus mt-2 min-h-14 w-full rounded-2xl border border-amber-500/25 bg-[#192129] px-4 text-[16px] font-semibold text-white placeholder:text-slate-400 focus:border-amber-400 disabled:opacity-60';
const textArea='tcds-focus mt-2 min-h-28 w-full resize-y rounded-2xl border border-amber-500/25 bg-[#192129] p-4 text-base text-white placeholder:text-slate-400 focus:border-amber-400';
const label='block text-sm font-black text-white';
const gold='!bg-[#ddb15f] !text-[#13171a] hover:!bg-[#f3ce83]';
const MIN_PASSWORD=14;
function Notice({message,success=false}:{message:string;success?:boolean}){return <div role={success?'status':'alert'} aria-live='polite' className={`rounded-2xl border p-4 text-sm font-semibold ${success?'border-emerald-500/40 bg-emerald-950 text-emerald-200':'border-amber-500/40 bg-[#2d261b] text-amber-100'}`}>{message}</div>}
function Frame({title,subtitle,icon,children,step}:{title:string;subtitle:string;icon:ReactNode;children:ReactNode;step?:string}){
 return <main className='safe-top safe-bottom min-h-[100dvh] bg-[#0b1117] px-4 py-8 text-white'>
  <div className='mx-auto w-full max-w-lg space-y-5'>
   <div className='rounded-[1.65rem] bg-tcds-black px-6 pb-7 pt-6 text-white shadow-gold'>
    <img src='/tcds-recovery-official-logo.jpeg' alt='TCDS — Total Coverage Database Solutions' className='mx-auto h-auto w-52 max-w-full rounded-xl border border-amber-500/25 object-contain sm:w-60' />
    <div className='mt-6 flex items-center justify-between'><span className='inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-tcds-gold/50 text-tcds-gold'>{icon}</span>{step&&<span className='rounded-full border border-tcds-gold/30 px-3 py-1 text-xs font-bold text-tcds-gold'>{step}</span>}</div>
    <h1 className='mt-4 font-display text-3xl font-black tracking-tight'>{title}</h1><p className='mt-2 text-sm leading-6 text-white/80'>{subtitle}</p>
   </div>
   <ScreenCard className='rounded-[1.5rem] !border-amber-500/25 !bg-[#111a22] p-5 !text-white sm:p-7'><div className='[&_h2]:text-white [&_p]:text-slate-200 [&_label]:text-white [&_.text-tcds-muted]:!text-slate-300 [&_.text-tcds-ink]:!text-white [&_.bg-tcds-surface]:!bg-[#192129]'>{children}</div></ScreenCard>
   <Link to='/' className='tcds-focus flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-bold text-amber-300'><ArrowLeft size={17}/> Back to sign in</Link>
   <p className='text-center text-xs text-slate-300'>TCDS Warehouse · Secure account recovery</p>
  </div>
 </main>
}
const codeOf=(e:unknown)=>e instanceof RecoveryApiError?e.code:e instanceof DOMException&&e.name==='NotAllowedError'?'PASSKEY_CANCELLED':'UNKNOWN';
const REASONS:Record<string,string>={FORGOT_PASSWORD:'Forgot password',ACCOUNT_LOCKED:'Account locked',SUSPECTED_COMPROMISE:'Possible unauthorized access',OTHER:'Other'};
const when=(iso?:string)=>{if(!iso)return '';const t=Date.parse(iso);return Number.isFinite(t)?new Date(t).toLocaleString([],{dateStyle:'medium',timeStyle:'short'}):''};

export function EmployeeRecoveryPage(){
 const [identifier,setIdentifier]=useState('');const [reason,setReason]=useState<Reason>('FORGOT_PASSWORD');const [details,setDetails]=useState('');const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [success,setSuccess]=useState(false);
 async function submit(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);setNotice('');try{const response=await recoveryApi.request({identifier:identifier.trim(),reason,details:details.trim()});setNotice(response.message||'If the account is eligible, the request will be reviewed.');setSuccess(true)}
  catch(err){setNotice(codeOf(err)==='RATE_LIMITED'?'Too many requests from this device. Wait a few minutes, then try again.':'The recovery service is unavailable. Contact your warehouse administrator.')}finally{setBusy(false)}}
 return <Frame title='Account recovery' subtitle='Request help securely. An administrator verifies your identity before any password change.' icon={<KeyRound size={24}/>} step='Step 1 of 3'>
  {success?<div className='space-y-5 text-center'><div className='mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-700'><CheckCircle2 size={43}/></div><h2 className='font-display text-2xl font-black'>Request submitted</h2><p className='text-sm text-slate-300'>If your account is eligible, an administrator will review your request. Once approved, you will receive an email with a link and a one-time code. Do not share them with anyone.</p><Notice success message={notice}/><Link to='/' className='tcds-focus inline-flex min-h-12 items-center justify-center font-bold underline'>Return to sign in</Link></div>:
   <form className='space-y-5' onSubmit={submit}>
    <h2 className='font-display text-xl font-black'>Request password reset</h2>
    <label className={label}>Username or employee ID<input className={input} value={identifier} onChange={e=>setIdentifier(e.target.value)} autoComplete='username' maxLength={200} placeholder='EMP-0001' required/></label>
    <label className={label}>Reason for request<select className={input} value={reason} onChange={e=>setReason(e.target.value as Reason)}><option value='FORGOT_PASSWORD'>Forgot password</option><option value='ACCOUNT_LOCKED'>Account locked</option><option value='SUSPECTED_COMPROMISE'>Possible unauthorized access</option><option value='OTHER'>Other</option></select></label>
    <label className={label}>Additional information <span className='font-normal text-tcds-muted'>(optional)</span><textarea className={textArea} maxLength={1000} value={details} onChange={e=>setDetails(e.target.value)} placeholder='Explain the issue. Do not enter passwords or other secrets.'/><span className='mt-1 block text-right text-xs text-tcds-muted'>{details.length}/1000</span></label>
    <PrimaryButton className={gold} loading={busy} disabled={!identifier.trim()}>Submit request <ArrowRight size={18}/></PrimaryButton>
    {notice&&<Notice message={notice}/>}
    <p className='text-center text-xs text-tcds-muted'>For security, this form does not confirm whether an account exists.</p>
   </form>}
 </Frame>
}

/** The 24-hour exception needs a manager passkey step-up that the server does not offer yet (it answers 501). */
export function ManagerRecoveryPage(){
 return <Frame title='Emergency exception' subtitle='A controlled one-time exception to the 24-hour request policy. Manager approval never changes a password.' icon={<ShieldAlert size={24}/>} step='Manager'>
  <div className='space-y-4'><h2 className='font-display text-xl font-black'>Not available yet</h2>
   <p className='text-sm text-slate-300'>Emergency exceptions to the 24-hour limit will require your passkey and are not enabled yet. If an employee needs a second recovery within 24 hours, contact the IAM team.</p></div>
 </Frame>
}

const ADMIN_ERRORS:Record<string,string>={
 VERIFIED_RECOVERY_DESTINATION_REQUIRED:'This employee has no verified recovery email yet, so recovery cannot be approved.',
 STALE_RESET_VERSION:'This request changed since you opened it. Go back to the queue, refresh, and review it again.',
 STALE_OR_INVALID_STATE:'This request changed since you opened it. Go back to the queue, refresh, and review it again.',
 AAL2_REQUIRED:'Approvals need a passkey sign-in. Sign out, sign in with your passkey, then try again.',
 SELF_APPROVAL_PROHIBITED:'You cannot approve a recovery for your own account.',
 APPROVER_PASSKEY_NOT_ENROLLED:'No passkey is registered for you on this device. Approve from the device where your passkey is set up.',
 PASSKEY_CANCELLED:'The passkey check was cancelled. Try again and confirm with your passkey.',
 RATE_LIMITED:'Too many attempts. Wait a few minutes, then try again.',
};
const adminMessage=(code:string)=>ADMIN_ERRORS[code]
 ??(/^(STEPUP_|FRESH_STEP_UP)/.test(code)?'The passkey check did not pass. Try again on the device where your passkey is registered.'
 :/^(ACCESS_DENIED|APPROVER_NOT_AUTHORIZED|RECOVERY_REVIEW_NOT_AUTHORIZED|SESSION_INVALID)$/.test(code)?'You are not authorized to approve this request, or your session ended. Sign in again.'
 :'The approval was not completed. Refresh and try again; contact IAM if it keeps failing.');

export function AdminRecoveryPage(){
 const {session}=useAuth();const [items,setItems]=useState<Review[]>([]);const [loaded,setLoaded]=useState(false);const [review,setReview]=useState<Review|null>(null);const [confirmed,setConfirmed]=useState(false);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [ok,setOk]=useState(false);
 async function loadQueue(){setBusy(true);try{const p=await recoveryApi.pending();setItems(p.items);setLoaded(true)}catch{setOk(false);setNotice('Unable to retrieve the authorized request queue.')}finally{setBusy(false)}}
 useEffect(()=>{if(session?.authenticated)void loadQueue()},[session?.authenticated]);
 async function load(id:string){setBusy(true);setNotice('');setConfirmed(false);try{const r=await recoveryApi.review(id);if(!/^\d{1,18}$/.test(r.expectedRowVersion)||r.requestId!==id)throw new Error('INVALID_REVIEW');setReview(r)}catch{setOk(false);setNotice('Unable to load this request. Refresh the queue.')}finally{setBusy(false)}}
 async function approve(e:FormEvent){e.preventDefault();if(!review||busy||!confirmed||!session?.authenticated)return;setBusy(true);setNotice('');try{
  const challenge=await recoveryApi.beginApproval(review.requestId);
  if(challenge.requestId!==review.requestId||challenge.rowVersion!==review.expectedRowVersion||challenge.purpose!=='WAREHOUSE_PASSWORD_RESET_APPROVAL')throw new RecoveryApiError(409,'STALE_RESET_VERSION');
  const passkeyResponse=await authenticateWithPasskey(challenge.options);
  await recoveryApi.adminDecision({requestId:review.requestId,expectedRowVersion:review.expectedRowVersion,decision:'APPROVE_RESET',challengeId:challenge.challengeId,passkeyResponse});
  setOk(true);setReview(null);setNotice(`Approved. ${review.employeeDisplayId} will get a recovery email with a link and a one-time code within a minute. Their password changes only when they complete it.`);await loadQueue();
 }catch(err){setOk(false);setNotice(adminMessage(codeOf(err)))}finally{setBusy(false)}}
 return <Frame title='Identity review' subtitle='Confirm the employee’s identity, then approve with your passkey.' icon={<UserRoundCheck size={24}/>} step='Administrator'>
 <div className='space-y-5'>
  {!review&&<><div className='flex items-center justify-between gap-3'><h2 className='font-display text-xl font-black'>Pending recovery requests</h2><button type='button' className='tcds-focus min-h-12 rounded-xl border border-amber-500/40 px-3 text-amber-200 disabled:opacity-50' onClick={()=>{setNotice('');void loadQueue()}} disabled={busy}>Refresh</button></div>
   <div className='space-y-3'>{loaded&&items.length===0&&<p className='text-sm text-slate-300'>No pending requests for your facility.</p>}{items.map(r=><div key={r.requestId} className='rounded-2xl border border-amber-500/30 bg-[#192129] p-4'><p className='font-bold'>{r.employeeDisplayId}</p><p className='mt-1 text-xs text-slate-300'>{REASONS[r.reasonCode??'']??'Recovery request'}{r.requestedAt?` · ${when(r.requestedAt)}`:''}</p><button type='button' className='tcds-focus mt-3 min-h-12 rounded-xl bg-[#ddb15f] px-5 font-bold text-[#13171a] disabled:opacity-50' disabled={busy} onClick={()=>void load(r.requestId)}>Review request</button></div>)}</div></>}
  {review&&<form onSubmit={approve} className='space-y-5'><button type='button' className='text-sm text-amber-300 underline' onClick={()=>{setReview(null);setNotice('')}}>Back to queue</button>
   <div className='rounded-2xl bg-[#192129] p-4 text-sm'><p className='font-black'>{review.employeeDisplayId}</p><p className='mt-1 text-slate-300'>{REASONS[review.reasonCode??'']??'Recovery request'}{review.requestedAt?` · requested ${when(review.requestedAt)}`:''}</p>{review.reason&&review.reason!==review.reasonCode&&<p className='mt-2 whitespace-pre-wrap break-words text-slate-300'>{review.reason}</p>}</div>
   <label className='flex items-start gap-3 text-sm font-semibold'><input type='checkbox' className='mt-1 h-5 w-5 accent-amber-600' checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I confirmed this employee’s identity in person or by an approved method.</label>
   <p className='text-xs text-slate-300'>If you cannot confirm who is asking, do not approve. A request that is never approved never changes anything.</p>
   <PrimaryButton className={gold} loading={busy} disabled={!confirmed}>Approve with passkey <ArrowRight size={18}/></PrimaryButton></form>}
  {notice&&<Notice message={notice} success={ok}/>}
 </div></Frame>
}

const RESET_ENDED=/^(INVITATION_UNAVAILABLE|RECOVERY_SESSION_INVALID|RECOVERY_COOKIE_REQUIRED|RECOVERY_SESSION_CONFLICT|RESET_TOKEN_UNAVAILABLE|RESET_CLAIM_FAILED|RESET_NOT_CONFIRMED|RESET_INVALID|RESET_NOT_FOUND|OTP_UNAVAILABLE|OTP_PROOF_REQUIRED|HTTP_404)$/;
type Phase='checking'|'ready'|'ended'|'done';
export function NewPasswordRecoveryPage(){
 const [params]=useSearchParams();const reference=params.get('ref')||'';
 const [phase,setPhase]=useState<Phase>('checking');const [code,setCode]=useState('');const [codeAccepted,setCodeAccepted]=useState(false);
 const [newPassword,setNewPassword]=useState('');const [confirm,setConfirm]=useState('');const [show,setShow]=useState(false);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');
 const bound=useRef(false);const codeRef=useRef<HTMLInputElement>(null);const passwordRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{let active=true;bound.current=false;setPhase('checking');setNotice('');
  if(!/^[A-Za-z0-9_-]{43}$/.test(reference)){setPhase('ended');return}
  recoveryApi.invitationContext(reference).then(v=>{if(active)setPhase(v.publicReference===reference?'ready':'ended')}).catch(err=>{if(active){if(codeOf(err)==='RATE_LIMITED'){setPhase('ready');setNotice('Too many attempts. Wait a few minutes, then try again.')}else setPhase('ended')}});
  return()=>{active=false}},[reference]);
 const digits=code.replace(/\D/g,'');const mismatch=confirm.length>0&&newPassword!==confirm;
 const canSubmit=(codeAccepted||digits.length===8)&&newPassword.length>=MIN_PASSWORD&&newPassword===confirm;
 async function submit(e:FormEvent){e.preventDefault();if(busy||!canSubmit)return;setBusy(true);setNotice('');try{
  // One binding per page: a retry after a refused password must keep the same browser binding (the code is already used).
  if(!bound.current){await recoveryApi.browserBinding(reference);bound.current=true}
  await recoveryApi.complete({reference,newPassword,code:codeAccepted?undefined:digits});
  setPhase('done');setCode('');setNewPassword('');setConfirm('');
 }catch(err){const c=codeOf(err);
  if(c==='OTP_INVALID'){setCode('');setNotice('That code is not correct. Check the latest recovery email and enter the 8-digit code again.');codeRef.current?.focus()}
  else if(/^PASSWORD_/.test(c)){setCodeAccepted(true);setNotice(c==='PASSWORD_BREACHED'?'This password appears in known data breaches. Choose a different one.':c==='PASSWORD_REUSE'?'You have used this password before. Choose a new one.':c==='BREACHED_PASSWORD_SERVICE_UNAVAILABLE'?'The password check is unavailable right now. Try again in a minute.':`This password does not meet the policy. Use at least ${MIN_PASSWORD} characters and do not include your username or employee ID.`);passwordRef.current?.focus()}
  else if(RESET_ENDED.test(c)){setPhase('ended')}
  else if(c==='RATE_LIMITED'){setNotice('Too many attempts. Wait a few minutes, then try again.')}
  else{setNotice('Your password was not changed. Check your connection and try again.')}
 }finally{setBusy(false)}}
 return <Frame title='Create a new password' subtitle='Enter the one-time code from your recovery email and choose your new password.' icon={<LockKeyhole size={24}/>} step='Final step'>
 {phase==='done'?<div className='space-y-4 text-center'><CheckCircle2 className='mx-auto text-emerald-400' size={58}/><h2 className='font-display text-2xl font-black'>Password updated</h2><p className='text-sm text-slate-300'>You have been signed out everywhere. Sign in again with your new password.</p><Link to='/' className='inline-flex min-h-12 items-center justify-center font-bold underline'>Return to sign in</Link></div>
 :phase==='ended'?<div className='space-y-4'><h2 className='font-display text-xl font-black'>This recovery link can’t be used</h2><p className='text-sm text-slate-300'>It has expired, was already used, or the code can no longer be used. Your password has not changed. Ask your administrator to approve a new recovery request.</p><Link to='/auth/recovery' className='inline-flex min-h-12 items-center font-bold text-amber-300 underline'>Request recovery again</Link></div>
 :phase==='checking'?<p role='status' className='text-sm text-slate-300'>Checking your recovery link…</p>
 :<form className='space-y-5' onSubmit={submit} noValidate>
   <label className={label}>One-time code
    {codeAccepted?<p className='mt-2 flex min-h-14 items-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-950 px-4 text-sm font-bold text-emerald-200'><CheckCircle2 size={18}/> Code verified. Now choose a password the policy accepts.</p>
    :<input ref={codeRef} className={`${input} tracking-[0.3em]`} inputMode='numeric' autoComplete='one-time-code' maxLength={11} placeholder='8 digits' value={code} onChange={e=>setCode(e.target.value)} aria-describedby='code-hint'/>}</label>
   {!codeAccepted&&<p id='code-hint' className='-mt-3 text-xs text-slate-300'>From the recovery email. It expires 10 minutes after it was sent.</p>}
   <label className={label}>New password<div className='relative'><input ref={passwordRef} className={`${input} pr-14`} type={show?'text':'password'} autoComplete='new-password' value={newPassword} onChange={e=>setNewPassword(e.target.value)} aria-describedby='password-hint'/><button type='button' onClick={()=>setShow(v=>!v)} aria-label={show?'Hide password':'Show password'} className='absolute bottom-1 right-1 flex min-h-12 min-w-12 items-center justify-center'>{show?<EyeOff size={20}/>:<Eye size={20}/>}</button></div></label>
   <p id='password-hint' className={`-mt-3 text-xs ${newPassword&&newPassword.length<MIN_PASSWORD?'text-amber-200':'text-slate-300'}`}>At least {MIN_PASSWORD} characters ({newPassword.length}/{MIN_PASSWORD}). Do not use your username or employee ID.</p>
   <label className={label}>Confirm password<input className={input} type={show?'text':'password'} autoComplete='new-password' value={confirm} onChange={e=>setConfirm(e.target.value)} aria-invalid={mismatch}/></label>
   {mismatch&&<p className='-mt-3 text-xs font-semibold text-amber-200'>Passwords do not match.</p>}
   <div className='flex gap-3 rounded-2xl bg-[#192129] p-4 text-xs text-slate-300'><ShieldCheck className='shrink-0 text-amber-300' size={18}/><span>Finish within 2 minutes of entering the code. Changing your password signs you out on every device.</span></div>
   <PrimaryButton className={gold} loading={busy} disabled={!canSubmit}>Update password securely</PrimaryButton>
  </form>}
 {notice&&phase==='ready'&&<div className='mt-5'><Notice message={notice}/></div>}
 </Frame>
}
