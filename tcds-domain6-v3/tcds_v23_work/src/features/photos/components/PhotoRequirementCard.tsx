import { Camera, CheckCircle2, Cloud, CloudOff, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import type { PhotoRequirement } from '../types/photoTypes';

function labelForState(state: PhotoRequirement['state']): string {
  const labels: Record<PhotoRequirement['state'], string> = {
    NOT_STARTED: 'Ready', CAPTURED_LOCAL: 'Safe on device', PREFLIGHT_FAILED: 'Check failed', QUEUED_OFFLINE: 'Queued offline',
    UPLOAD_AUTHORIZING: 'Preparing upload', UPLOADING: 'Uploading', UPLOAD_RETRYING: 'Retrying upload', REMOTE_CONFIRMED: 'Remote confirmed',
    COMMITTING: 'Saving record', ASSESSMENT_QUEUED: 'AI queued', ASSESSMENT_PROCESSING: 'AI checking', ACCEPTED: 'Accepted',
    RETAKE_REQUIRED: 'Retake required', REVIEW_REQUIRED: 'Manager review', OVERRIDDEN: 'Approved override', REJECTED: 'Rejected', VOIDED: 'Voided'
  };
  return labels[state];
}

export function PhotoRequirementCard({ requirement, onCapture, onReview }: { requirement: PhotoRequirement; onCapture: (r: PhotoRequirement) => void; onReview: (r: PhotoRequirement) => void }) {
  const busy = ['UPLOAD_AUTHORIZING','UPLOADING','UPLOAD_RETRYING','COMMITTING','ASSESSMENT_QUEUED','ASSESSMENT_PROCESSING'].includes(requirement.state);
  const accepted = requirement.state === 'ACCEPTED' || requirement.state === 'OVERRIDDEN';
  const needsAction = ['PREFLIGHT_FAILED','RETAKE_REQUIRED','REJECTED'].includes(requirement.state);
  return <article className="enterprise-motion rounded-2xl border border-tcds-line bg-white p-3 shadow-soft" aria-label={`${requirement.displayName}: ${labelForState(requirement.state)}`}>
    <button type="button" onClick={() => onCapture(requirement)} disabled={busy || accepted} className="tcds-focus grid h-28 w-full place-items-center rounded-xl bg-tcds-surface text-tcds-gold">
      {busy ? <Loader2 className="animate-spin" /> : accepted ? <CheckCircle2 className="text-tcds-green" /> : needsAction ? <RefreshCw className="text-tcds-red" /> : <Camera />}
    </button>
    <div className="mt-3 flex items-start justify-between gap-2">
      <div><p className="font-black text-tcds-ink">{requirement.displayName}</p><p className="text-xs font-semibold text-tcds-muted">{requirement.requirementClass}</p></div>
      {requirement.remoteConfirmed ? <Cloud size={16} className="text-tcds-green" aria-label="Remote confirmed" /> : requirement.localCopyRetained ? <CloudOff size={16} className="text-tcds-warning" aria-label="Local recovery copy retained" /> : null}
    </div>
    <p className={`mt-2 text-xs font-black ${accepted ? 'text-tcds-green' : needsAction ? 'text-tcds-red' : 'text-tcds-goldDeep'}`}>{labelForState(requirement.state)}</p>
    {typeof requirement.uploadProgress === 'number' && requirement.uploadProgress < 100 && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-tcds-line"><div className="h-full bg-tcds-gold" style={{ width: `${requirement.uploadProgress}%` }} /></div>}
    {requirement.rejectionReasons.length > 0 && <div className="mt-2 rounded-xl bg-red-50 p-2 text-xs font-semibold text-tcds-red"><ShieldAlert size={14} className="mb-1" />{requirement.rejectionReasons[0]}</div>}
    {requirement.state === 'REVIEW_REQUIRED' && <button type="button" onClick={() => onReview(requirement)} className="tcds-focus mt-2 w-full rounded-xl border border-tcds-gold px-3 py-2 text-xs font-black text-tcds-goldDeep">Request Manager Review</button>}
  </article>;
}
