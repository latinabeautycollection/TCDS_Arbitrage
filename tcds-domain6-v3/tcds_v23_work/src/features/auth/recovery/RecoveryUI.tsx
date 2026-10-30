import {useEffect,useState,type ReactNode,type FormEvent} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {ArrowLeft,ArrowRight,CheckCircle2,Eye,EyeOff,KeyRound,LockKeyhole,ShieldAlert,ShieldCheck,UserRoundCheck} from 'lucide-react';

import {ScreenCard} from '../../../components/ScreenCard';
import {PrimaryButton} from '../../../components/PrimaryButton';
import {recoveryApi,type Reason,type OverrideReason,type Decision,type Review} from './recoveryApi';
import {useAuth} from '../context/AuthContext';
import {authenticateWithPasskey} from '../security/webauthnBrowser';
const input='tcds-focus mt-2 min-h-14 w-full rounded-2xl border border-amber-500/25 bg-[#192129] px-4 text-[16px] font-semibold text-white placeholder:text-slate-400 focus:border-amber-400';
const textArea='tcds-focus mt-2 min-h-28 w-full resize-y rounded-2xl border border-amber-500/25 bg-[#192129] p-4 text-base text-white placeholder:text-slate-400 focus:border-amber-400';
const label='block text-sm font-black text-white';
function Notice({message,success=false}:{message:string;success?:boolean}){return <div role='status' aria-live='polite' className={`rounded-2xl border p-4 text-sm font-semibold ${success?'border-emerald-500/40 bg-emerald-950 text-emerald-200':'border-amber-500/40 bg-[#2d261b] text-amber-100'}`}>{message}</div>}
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
export function EmployeeRecoveryPage(){
 const [identifier,setIdentifier]=useState('');const [reason,setReason]=useState<Reason>('FORGOT_PASSWORD');const [details,setDetails]=useState('');const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [success,setSuccess]=useState(false);
 async function submit(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);setNotice('');try{const response=await recoveryApi.request({identifier:identifier.trim(),reason,details:details.trim()});setNotice(response.message||'If the account is eligible, the request will be reviewed.');setSuccess(true)}catch{setNotice('The recovery service is unavailable. Contact your warehouse administrator.')}finally{setBusy(false)}}
 return <Frame title='Account recovery' subtitle='Request help securely. An administrator verifies your identity before any password change.' icon={<KeyRound size={24}/>} step='Step 1 of 3'>
  {success?<div className='space-y-5 text-center'><div className='mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-700'><CheckCircle2 size={43}/></div><h2 className='font-display text-2xl font-black'>Request submitted</h2><p className='text-sm text-slate-300'>If your account is eligible, an administrator will review your request. Do not share recovery credentials with anyone.</p><Notice success message={notice}/><Link to='/' className='tcds-focus inline-flex min-h-12 items-center justify-center font-bold underline'>Return to sign in</Link></div>:
   <form className='space-y-5' onSubmit={submit}>
    <h2 className='font-display text-xl font-black'>Request password reset</h2>
    <label className={label}>Username or employee ID<input className={input} value={identifier} onChange={e=>setIdentifier(e.target.value)} autoComplete='username' maxLength={200} placeholder='EMP-0001' required/></label>
    <label className={label}>Reason for request<select className={input} value={reason} onChange={e=>setReason(e.target.value as Reason)}><option value='FORGOT_PASSWORD'>Forgot password</option><option value='ACCOUNT_LOCKED'>Account locked</option><option value='SUSPECTED_COMPROMISE'>Possible unauthorized access</option><option value='OTHER'>Other</option></select></label>
    <label className={label}>Additional information <span className='font-normal text-tcds-muted'>(optional)</span><textarea className={textArea} maxLength={1000} value={details} onChange={e=>setDetails(e.target.value)} placeholder='Explain the issue. Do not enter passwords or other secrets.'/><span className='mt-1 block text-right text-xs text-tcds-muted'>{details.length}/1000</span></label>
    <PrimaryButton className='!bg-[#ddb15f] !text-[#13171a] hover:!bg-[#f3ce83]' loading={busy} disabled={!identifier.trim()}>Submit request <ArrowRight size={18}/></PrimaryButton>
    {notice&&<Notice message={notice}/>}
    <p className='text-center text-xs text-tcds-muted'>For security, this form does not confirm whether an account exists.</p>
   </form>}
 </Frame>
}
export function ManagerRecoveryPage(){
 const {session}=useAuth();const [requestId,setRequestId]=useState('');const [reason,setReason]=useState<OverrideReason>('CRITICAL_SHIFT_ACCESS');const [justification,setJustification]=useState('');const [confirmed,setConfirmed]=useState(false);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [ok,setOk]=useState(false);
 async function submit(e:FormEvent){e.preventDefault();if(busy||!session?.authenticated)return;setBusy(true);setNotice('');try{await recoveryApi.override({priorRequestId:requestId.trim(),reason,justification:justification.trim()});setOk(false);setNotice('Exception response received. Any authorization and its validity must be confirmed by the IAM server.')}catch{setNotice('Override was not authorized or the recovery service is unavailable.')}finally{setBusy(false)}}
 return <Frame title='Emergency exception' subtitle='A controlled one-time exception to the 24-hour request policy. Manager approval never changes a password.' icon={<ShieldAlert size={24}/>} step='Manager'>
  <form className='space-y-5' onSubmit={submit}><h2 className='font-display text-xl font-black'>24-hour emergency exception</h2>
   <label className={label}>Existing request ID<input className={input} value={requestId} onChange={e=>setRequestId(e.target.value)} required placeholder='Request reference'/></label>
   <label className={label}>Emergency reason<select className={input} value={reason} onChange={e=>setReason(e.target.value as OverrideReason)}><option value='CRITICAL_SHIFT_ACCESS'>Critical shift access</option><option value='ACCOUNT_COMPROMISE'>Suspected account compromise</option><option value='OPERATIONAL_EMERGENCY'>Operational emergency</option><option value='PRIOR_RESET_FAILURE'>Previous reset failed</option><option value='OTHER_APPROVED_EXCEPTION'>Other documented exception</option></select></label>
   <label className={label}>Justification<textarea className={textArea} minLength={15} maxLength={1000} required value={justification} onChange={e=>setJustification(e.target.value)} placeholder='Describe why a second request is operationally necessary.'/><span className='mt-1 block text-right text-xs text-tcds-muted'>{justification.length}/1000</span></label>
   <label className='flex items-start gap-3 text-sm font-semibold'><input type='checkbox' className='mt-1 h-5 w-5 accent-amber-600' checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I understand an override is single-use and does not permit me to reset a password.</label>
   <PrimaryButton className='!bg-[#ddb15f] !text-[#13171a] hover:!bg-[#f3ce83]' loading={busy} disabled={!requestId.trim()||justification.trim().length<15||!confirmed}>Submit exception <ArrowRight size={18}/></PrimaryButton>{notice&&<Notice message={notice} success={ok}/>}
  </form>
 </Frame>
}
export function AdminRecoveryPage(){
 const {session}=useAuth();const [items,setItems]=useState<Review[]>([]);const [review,setReview]=useState<Review|null>(null);const [decision,setDecision]=useState<Decision>('APPROVE_RESET');const [verification,setVerification]=useState('');const [notes,setNotes]=useState('');const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [ok,setOk]=useState(false);
 async function loadQueue(){setBusy(true);setNotice('');try{const p=await recoveryApi.pending();setItems(p.items)}catch{setNotice('Unable to retrieve the authorized request queue.')}finally{setBusy(false)}}
 useEffect(()=>{if(session?.authenticated)void loadQueue()},[session?.authenticated]);
 async function load(id:string){setBusy(true);setNotice('');try{const r=await recoveryApi.review(id);if(!/^\d{1,18}$/.test(r.expectedRowVersion)||r.requestId!==id)throw new Error('INVALID_REVIEW');setReview(r)}catch{setNotice('Unable to load this authorized request.')}finally{setBusy(false)}}
 async function submit(e:FormEvent){e.preventDefault();if(!review||busy||!session?.authenticated)return;setBusy(true);setNotice('');try{
  let step: {challengeId?:string;passkeyResponse?:unknown}={};
  if(decision==='APPROVE_RESET') {const challenge=await recoveryApi.beginApproval(review.requestId);if(challenge.requestId!==review.requestId||challenge.rowVersion!==review.expectedRowVersion||challenge.purpose!=='WAREHOUSE_PASSWORD_RESET_APPROVAL')throw new Error('STEPUP_MISMATCH');const response=await authenticateWithPasskey(challenge.options);step={challengeId:challenge.challengeId,passkeyResponse:response}}
  const result=await recoveryApi.adminDecision({requestId:review.requestId,expectedRowVersion:review.expectedRowVersion,decision,notes:notes.trim(),verificationReference:verification.trim()||undefined,...step});
  setOk(true);setReview(null);setNotice(`Decision recorded: ${result.status}. This does not mean the employee password has changed.`);await loadQueue()
 }catch{setOk(false);setNotice('Action was not accepted. Check identity, passkey and authorization, then refresh.')}finally{setBusy(false)}}
 return <Frame title='Identity review' subtitle='Select an authorized pending request, verify identity and record a decision.' icon={<UserRoundCheck size={24}/>} step='Administrator'>
 <div className='space-y-5'><div className='flex items-center justify-between gap-3'><h2 className='font-display text-xl font-black'>Pending recovery requests</h2><button type='button' className='tcds-focus min-h-12 rounded-xl border border-amber-500/40 px-3 text-amber-200' onClick={()=>void loadQueue()} disabled={busy}>Refresh</button></div>
 {!review&&<div className='space-y-3'>{items.length===0&&<p className='text-sm text-slate-300'>No authorized pending requests found.</p>}{items.map(r=><div key={r.requestId} className='rounded-2xl border border-amber-500/30 bg-[#192129] p-4'><p className='font-bold'>{r.employeeDisplayId}</p><p className='mt-1 text-xs text-slate-300'>{r.status} · {r.reason||'Recovery request'}</p><button type='button' className='tcds-focus mt-3 min-h-12 rounded-xl bg-[#ddb15f] px-5 font-bold text-[#13171a]' onClick={()=>void load(r.requestId)}>Review request</button></div>)}</div>}
 {review&&<form onSubmit={submit} className='space-y-5 border-t border-amber-500/30 pt-5'><button type='button' className='text-sm text-amber-300 underline' onClick={()=>setReview(null)}>Back to queue</button><div className='rounded-2xl bg-[#192129] p-4 text-sm'><p className='font-black'>{review.employeeDisplayId}</p><p className='mt-1 text-slate-300'>Current state: {review.status}</p>{review.reason&&<p className='mt-2 whitespace-pre-wrap break-words text-slate-300'>{review.reason}</p>}</div>
 <label className={label}>Decision<select className={input} value={decision} onChange={e=>setDecision(e.target.value as Decision)}><option value='APPROVE_RESET'>Approve secure recovery</option><option value='REQUIRE_VERIFICATION'>Require additional verification</option><option value='REJECT'>Reject request</option></select></label>
 <label className={label}>Identity verification reference<input className={input} value={verification} onChange={e=>setVerification(e.target.value)} placeholder='Approved verification record'/></label>
 <label className={label}>Administrative rationale<textarea className={textArea} value={notes} onChange={e=>setNotes(e.target.value)} required maxLength={1000}/></label>
 <PrimaryButton className='!bg-[#ddb15f] !text-[#13171a] hover:!bg-[#f3ce83]' loading={busy} disabled={!notes.trim()||(decision==='APPROVE_RESET'&&!verification.trim())}>{decision==='APPROVE_RESET'?'Verify passkey and approve':'Submit decision'} <ArrowRight size={18}/></PrimaryButton></form>}
 {notice&&<Notice message={notice} success={ok}/>}
 </div></Frame>
}
export function NewPasswordRecoveryPage(){
 const [params]=useSearchParams();const reference=params.get('ref')||'';const [valid,setValid]=useState(false);const [code,setCode]=useState('');const [verified,setVerified]=useState(false);const [newPassword,setNewPassword]=useState('');const [confirm,setConfirm]=useState('');const [show,setShow]=useState(false);const [busy,setBusy]=useState(false);const [done,setDone]=useState(false);const [notice,setNotice]=useState('');
 useEffect(()=>{let active=true;setValid(false);setVerified(false);if(!reference||reference.length>150){setNotice('Open the recovery invitation sent to your verified recovery channel.');return}
  void recoveryApi.invitationContext(reference).then(v=>{if(active&&v.publicReference===reference)setValid(true)}).catch(()=>{if(active)setNotice('This recovery invitation cannot be verified. Contact your administrator.')});return()=>{active=false}},[reference]);
 async function verify(e:FormEvent){e.preventDefault();if(!valid)return;setBusy(true);setNotice('');try{await recoveryApi.browserBinding();await recoveryApi.claim({reference,code});setVerified(true);setCode('')}catch{setNotice('Recovery verification failed or the credential expired.')}finally{setBusy(false)}}
 async function finish(e:FormEvent){e.preventDefault();if(newPassword!==confirm){setNotice('Passwords do not match.');return}setBusy(true);setNotice('');try{await recoveryApi.complete({reference,newPassword});setDone(true);setVerified(false);setNewPassword('');setConfirm('')}catch{setNotice('Password update was not completed. Contact your administrator if this persists.')}finally{setBusy(false)}}
 return <Frame title='Create a new password' subtitle='Open your recovery invitation, verify its one-time code, then choose your new password.' icon={<LockKeyhole size={24}/>} step='Final step'>
 {done?<div className='space-y-4 text-center'><CheckCircle2 className='mx-auto text-emerald-400' size={58}/><h2 className='font-display text-2xl font-black'>Password updated</h2><p className='text-sm text-slate-300'>Sign in again with your new password.</p><Link to='/' className='inline-flex min-h-12 items-center justify-center font-bold underline'>Return to sign in</Link></div>:
 !verified?<form className='space-y-5' onSubmit={verify}><h2 className='font-display text-xl font-black'>Verify recovery credential</h2><p className='text-sm text-slate-300'>Your recovery request was identified from the invitation. No request ID is needed.</p><label className={label}>One-time recovery credential<input type='password' className={input} required value={code} onChange={e=>setCode(e.target.value)} autoComplete='one-time-code'/></label><PrimaryButton className='!bg-[#ddb15f] !text-[#13171a]' loading={busy} disabled={!valid||!code}>Verify credential <ArrowRight size={18}/></PrimaryButton></form>:
 <form className='space-y-5' onSubmit={finish}><h2 className='font-display text-xl font-black'>Set your new password</h2><label className={label}>New password<div className='relative'><input className={`${input} pr-14`} type={show?'text':'password'} autoComplete='new-password' value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/><button type='button' onClick={()=>setShow(v=>!v)} aria-label={show?'Hide password':'Show password'} className='absolute bottom-1 right-1 flex min-h-12 min-w-12 items-center justify-center'>{show?<EyeOff size={20}/>:<Eye size={20}/>}</button></div></label><label className={label}>Confirm password<input className={input} type='password' autoComplete='new-password' value={confirm} onChange={e=>setConfirm(e.target.value)} required/></label><div className='rounded-2xl bg-[#192129] p-4 text-xs text-slate-300'><ShieldCheck className='mb-2 text-amber-300' size={18}/>The server enforces your organization's active password policy.</div><PrimaryButton className='!bg-[#ddb15f] !text-[#13171a]' loading={busy} disabled={!newPassword||newPassword!==confirm}>Update password securely</PrimaryButton></form>}
 {notice&&<div className='mt-5'><Notice message={notice}/></div>}
 </Frame>
}
