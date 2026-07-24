import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BarChart3, Boxes, CheckCircle2, ChevronRight, ClipboardCheck,
  Clock3, Database, DollarSign, Gauge, Lightbulb, Map, PackageSearch, RefreshCw,
  ServerCog, ShieldCheck, Smartphone, Users, WifiOff, Workflow
} from 'lucide-react';
import { AppHeader } from '../../components/AppHeader';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ScreenCard } from '../../components/ScreenCard';
import { supervisorApi } from './services/supervisorApi';
import type {
  AiInsight, ConsoleSection, ExceptionRecord, PackageLifecycleRecord, SupervisorConsoleResponse,
  SupervisorMessage
} from './types/supervisorTypes';
import { supervisorMessage } from './messages/supervisorMessageCatalog';
import { SupervisorMessageCenter } from './components/SupervisorMessageCenter';
import { SupervisorDetailSheet } from './components/SupervisorDetailSheet';
import { SupervisorToast } from './components/SupervisorToast';
import { ReadinessMatrix } from './components/ReadinessMatrix';
import { ExceptionQueue } from './components/ExceptionQueue';

const sections: Array<{ key: ConsoleSection; label: string }> = [
  { key: 'OPERATIONS', label: 'Operations' },
  { key: 'WORKFLOWS', label: 'Workflow Monitor' },
  { key: 'PACKAGES', label: 'Package Lifecycle' },
  { key: 'EXCEPTIONS', label: 'Exceptions' },
  { key: 'APPROVALS', label: 'Approvals' },
  { key: 'HEALTH', label: 'Warehouse Health' },
  { key: 'DEVICES', label: 'Devices' },
  { key: 'SYNC', label: 'Synchronization' },
  { key: 'SECURITY', label: 'Security' },
  { key: 'ANALYTICS', label: 'Executive Analytics' },
  { key: 'WORKFORCE', label: 'Workforce' },
  { key: 'SLA', label: 'SLA Monitor' }
];

export function SupervisorConsoleScreen() {
  const [data, setData] = useState<SupervisorConsoleResponse | null>(null);
  const [section, setSection] = useState<ConsoleSection>('OPERATIONS');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<SupervisorMessage | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedException, setSelectedException] = useState<ExceptionRecord | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<PackageLifecycleRecord | null>(null);

  async function load() {
    setLoading(true);
    try {
      setData(await supervisorApi.getConsole());
    } catch (error) {
      setMessage(error as SupervisorMessage);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const onOnline = () => void load();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  const messages = useMemo(() => {
    const current = data?.messages ?? [];
    return navigator.onLine ? current : [supervisorMessage('SUP_STALE_DATA'), ...current];
  }, [data]);

  function openMessage(value: SupervisorMessage) {
    if (value.destination) setSection(value.destination);
    setMessage(value);
  }

  if (loading && !data) return <LoadingShell />;
  if (!data) return <UnavailableShell onRetry={load} message={message} onClose={() => setMessage(null)} />;

  const blockingCount = messages.filter(item => item.blocking).length;

  return <>
    <AppHeader title="Warehouse Command Center" subtitle="Monitor, predict, direct, and govern warehouse execution" />
    <main className="mx-auto max-w-md space-y-4 p-4">
      <ScreenCard className="overflow-hidden p-0">
        <div className="bg-tcds-black p-5 text-white">
          <p className="text-xs font-black uppercase tracking-[.28em] text-tcds-gold">Authorized command view</p>
          <div className="mt-2 flex items-start justify-between gap-4">
            <div><h2 className="font-display text-page font-black">{data.facilityCode}</h2><p className="mt-1 text-sm text-white/65">{data.employeeName} · {data.role} · {data.stationCode}</p></div>
            <button onClick={() => void load()} aria-label="Refresh command center" className="tcds-focus rounded-xl border border-white/20 p-2.5"><RefreshCw size={18} className={loading ? 'animate-spin' : ''}/></button>
          </div>
          <p className="mt-3 text-xs font-semibold text-white/55">Authoritative snapshot generated {data.generatedAt}</p>
        </div>
        <div className="grid grid-cols-4 gap-px bg-tcds-line">
          <Metric label="Attention" value={data.summary.openExceptions} critical={data.summary.criticalExceptions > 0}/>
          <Metric label="Packages at risk" value={data.summary.packagesAtRisk} critical={data.summary.packagesAtRisk > 0}/>
          <Metric label="SLA breaches" value={data.summary.slaBreaches} critical={data.summary.slaBreaches > 0}/>
          <Metric label="Approvals" value={data.summary.pendingApprovals}/>
          <Metric label="Offline devices" value={data.summary.offlineDevices} critical={data.summary.offlineDevices > 0}/>
          <Metric label="Failed sync" value={data.summary.failedSyncOperations} critical={data.summary.failedSyncOperations > 0}/>
          <Metric label="Staff online" value={data.summary.workforceOnline}/>
          <Metric label="Shipments at risk" value={data.summary.shipmentsAtRisk} critical={data.summary.shipmentsAtRisk > 0}/>
        </div>
      </ScreenCard>

      <SupervisorMessageCenter messages={messages} onSelect={openMessage}/>

      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Warehouse command sections">
        {sections.map(item => <button key={item.key} onClick={() => setSection(item.key)} className={`tcds-focus enterprise-motion whitespace-nowrap rounded-full border px-3 py-2 text-xs font-black ${section === item.key ? 'border-tcds-black bg-tcds-black text-white' : 'border-tcds-line bg-white text-tcds-ink'}`}>{item.label}</button>)}
      </div>

      {section === 'OPERATIONS' && <OperationsSection data={data} onSection={setSection} onToast={setToast}/>} 
      {section === 'WORKFLOWS' && <WorkflowSection data={data} onInsight={insight => setToast(`${insight.title}: supervisor review requested.`)}/>} 
      {section === 'PACKAGES' && <PackageSection data={data} onSelect={setSelectedPackage}/>} 
      {section === 'EXCEPTIONS' && <ScreenCard><SectionHeading icon={AlertTriangle} title="Exception and escalation center" subtitle="Known and unknown roadblocks across every warehouse workflow."/><ExceptionQueue exceptions={data.exceptions} onOpen={setSelectedException}/></ScreenCard>} 
      {section === 'APPROVALS' && <ApprovalsSection data={data} onToast={setToast}/>} 
      {section === 'HEALTH' && <HealthSection data={data}/>} 
      {section === 'DEVICES' && <DevicesSection data={data} onToast={setToast}/>} 
      {section === 'SYNC' && <SyncSection data={data} onToast={setToast}/>} 
      {section === 'SECURITY' && <SecuritySection/>} 
      {section === 'ANALYTICS' && <AnalyticsSection data={data}/>} 
      {section === 'WORKFORCE' && <WorkforceSection data={data} onToast={setToast}/>} 
      {section === 'SLA' && <SlaSection data={data}/>} 

      <p className="px-1 text-xs font-semibold text-tcds-muted">Refresh before any sensitive decision. {blockingCount > 0 ? `${blockingCount} blocking control${blockingCount === 1 ? '' : 's'} remain active.` : 'No blocking command-center messages are active.'}</p>
    </main>

    {selectedException && <ExceptionSheet value={selectedException} onClose={() => setSelectedException(null)} onAction={text => { setToast(text); setSelectedException(null); }}/>} 
    {selectedPackage && <PackageSheet value={selectedPackage} onClose={() => setSelectedPackage(null)}/>} 
    <SupervisorDetailSheet message={message} onClose={() => setMessage(null)}/>
    {toast && <SupervisorToast message={toast} onClose={() => setToast(null)}/>} 
  </>;
}

function OperationsSection({ data, onSection, onToast }: { data: SupervisorConsoleResponse; onSection: (section: ConsoleSection) => void; onToast: (message: string) => void }) {
  return <>
    <ScreenCard><SectionHeading icon={Gauge} title="Operations command" subtitle="Live work, waiting work, completed work, and supervisor attention."/><div className="mt-4 grid grid-cols-2 gap-3">{data.operations.map(item => <button key={item.domain} onClick={() => onSection('WORKFLOWS')} className="tcds-focus rounded-2xl border border-tcds-line bg-white p-4 text-left shadow-surface"><p className="text-xs font-black uppercase tracking-[.14em] text-tcds-goldDeep">{item.label}</p><div className="mt-2 flex items-end justify-between"><p className="font-display text-page font-black">{item.active}</p><p className="text-xs font-black text-tcds-muted">active</p></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px] font-black"><span className="rounded-lg bg-tcds-surface p-2">{item.waiting}<br/>waiting</span><span className="rounded-lg bg-tcds-surface p-2">{item.completedToday}<br/>done</span><span className={`rounded-lg p-2 ${item.attentionRequired ? 'bg-red-50 text-tcds-red' : 'bg-tcds-surface'}`}>{item.attentionRequired}<br/>attention</span></div></button>)}</div></ScreenCard>
    <ScreenCard><SectionHeading icon={Lightbulb} title="Hourly intelligence summary" subtitle="Recommendations are advisory until accepted through an authorized workflow."/><div className="mt-4 space-y-3">{data.insights.slice(0, 3).map(insight => <InsightCard key={insight.insightId} value={insight} onReview={() => onToast(`${insight.title}: review opened.`)}/>)}</div></ScreenCard>
    <ShiftHandoffCard data={data} onToast={onToast}/>
  </>;
}

function WorkflowSection({ data, onInsight }: { data: SupervisorConsoleResponse; onInsight: (insight: AiInsight) => void }) {
  return <>
    <ScreenCard><SectionHeading icon={Workflow} title="Package lifecycle monitor" subtitle="Every package should have one authoritative current stage and next expected stage."/><div className="mt-4 space-y-2">{data.lifecycle.map((stage, index) => <div key={stage.key} className="relative flex items-center gap-3 rounded-2xl border border-tcds-line p-4"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-black ${stage.health === 'HEALTHY' ? 'bg-emerald-50 text-tcds-green' : stage.health === 'AT_RISK' ? 'bg-amber-50 text-tcds-warning' : 'bg-red-50 text-tcds-red'}`}>{stage.count}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="font-black">{stage.label}</p><span className="text-[10px] font-black uppercase text-tcds-muted">{stage.health}</span></div><p className="mt-1 text-xs font-semibold text-tcds-muted">Average age {stage.averageAgeMinutes}m · Oldest {stage.oldestAgeMinutes}m</p></div>{index < data.lifecycle.length - 1 && <span className="absolute -bottom-3 left-8 z-10 text-tcds-gold">↓</span>}</div>)}</div></ScreenCard>
    <ScreenCard><SectionHeading icon={BarChart3} title="Bottleneck detection" subtitle="Predicted constraints and approved recovery recommendations."/><div className="mt-4 space-y-3">{data.insights.filter(item => item.category === 'BOTTLENECK' || item.category === 'SLA' || item.category === 'WORKFORCE').map(insight => <InsightCard key={insight.insightId} value={insight} onReview={() => onInsight(insight)}/>)}</div></ScreenCard>
    <ScreenCard><SectionHeading icon={Map} title="Live warehouse overview" subtitle="Zone occupancy, workload, and blocked work."/><div className="mt-4 space-y-3">{data.zones.map(zone => <div key={zone.zoneCode} className="rounded-2xl bg-tcds-surface p-4"><div className="flex items-center justify-between"><div><p className="font-black">{zone.zoneName}</p><p className="mt-1 text-xs font-semibold text-tcds-muted">{zone.zoneCode} · {zone.occupiedStations}/{zone.totalStations} stations occupied</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${zone.state === 'HEALTHY' ? 'bg-emerald-50 text-tcds-green' : zone.state === 'BUSY' ? 'bg-amber-50 text-tcds-warning' : 'bg-red-50 text-tcds-red'}`}>{zone.state}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white"><div className="h-full bg-tcds-gold" style={{ width: `${Math.min(100, (zone.occupiedStations / Math.max(1, zone.totalStations)) * 100)}%` }}/></div><p className="mt-2 text-xs font-semibold text-tcds-muted">{zone.activeWork} active · {zone.blockedWork} blocked</p></div>)}</div></ScreenCard>
  </>;
}

function PackageSection({ data, onSelect }: { data: SupervisorConsoleResponse; onSelect: (record: PackageLifecycleRecord) => void }) {
  return <ScreenCard><SectionHeading icon={PackageSearch} title="Package lifecycle and missing-package watch" subtitle="Trace exact custody and identify overdue stage transitions."/><div className="mt-4 space-y-3">{data.packageWatch.length ? data.packageWatch.map(record => <button key={record.packageId} onClick={() => onSelect(record)} className="tcds-focus w-full rounded-2xl border border-tcds-line p-4 text-left"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{record.packageReference}</p><p className="mt-1 text-xs font-semibold text-tcds-muted">{record.currentStage} · {record.currentStation ?? 'No station'} · {record.currentOwner ?? 'No owner'}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${record.slaState === 'ON_TRACK' ? 'bg-emerald-50 text-tcds-green' : record.slaState === 'AT_RISK' ? 'bg-amber-50 text-tcds-warning' : 'bg-red-50 text-tcds-red'}`}>{record.slaState}</span></div><p className="mt-3 text-sm text-tcds-muted">Last event {record.lastEventAt} · Age {record.ageMinutes}m · Next {record.nextExpectedStage ?? 'Complete'}</p>{record.missingWatch && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-black text-tcds-red">Search recommended — package movement is overdue.</p>}</button>) : <Empty label="No packages currently require supervisory tracking"/>}</div></ScreenCard>;
}

function ApprovalsSection({ data, onToast }: { data: SupervisorConsoleResponse; onToast: (message: string) => void }) {
  return <ScreenCard><SectionHeading icon={ClipboardCheck} title="Governed approvals" subtitle="Evidence, policy, separation of duties, and non-overridable controls are enforced server-side."/><div className="mt-4 space-y-3">{data.approvals.length ? data.approvals.map(a => <div key={a.approvalId} className="rounded-2xl border border-tcds-line p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{a.title}</p><p className="mt-1 text-xs font-semibold text-tcds-muted">{a.approvalType} · {a.domain} · Requested by {a.requestedBy}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${a.riskLevel === 'CRITICAL' || a.riskLevel === 'EMERGENCY' ? 'bg-red-50 text-tcds-red' : 'bg-amber-50 text-tcds-warning'}`}>{a.riskLevel}</span></div>{!a.evidenceComplete && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-black text-tcds-red">Evidence incomplete — decision blocked.</p>}{a.prohibitedReasons.length > 0 && <p className="mt-2 rounded-xl bg-red-50 p-3 text-xs font-black text-tcds-red">Non-overridable conflict: {a.prohibitedReasons.join(', ')}</p>}<div className="mt-3 grid grid-cols-2 gap-2"><button disabled={!a.evidenceComplete || a.prohibitedReasons.length > 0} onClick={() => onToast('Approval review opened. Written justification and backend confirmation are required.')} className="tcds-focus min-h-11 rounded-xl bg-tcds-black px-3 text-sm font-black text-white disabled:bg-neutral-300">Review approval</button><button onClick={() => onToast('Request returned for additional evidence.')} className="tcds-focus min-h-11 rounded-xl border border-tcds-line px-3 text-sm font-black">Request evidence</button></div></div>) : <Empty label="No pending approvals"/>}</div></ScreenCard>;
}

function HealthSection({ data }: { data: SupervisorConsoleResponse }) {
  return <><ScreenCard><SectionHeading icon={ServerCog} title="Warehouse health" subtitle="Authoritative services across all twelve warehouse workflows."/><div className="mt-4"><ReadinessMatrix services={data.readiness}/></div></ScreenCard><ScreenCard><SectionHeading icon={ShieldCheck} title="Safeguard rails" subtitle="The command center directs work but never bypasses core controls."/><div className="mt-4 space-y-3"><Safeguard icon={ShieldCheck} title="Non-overridable controls" text="Safety, legal holds, evidence-integrity failures, wrong serialized identity, and database conflicts cannot be bypassed."/><Safeguard icon={Database} title="PostgreSQL remains authoritative" text="No source table is edited directly. Every mutation uses validated APIs, idempotency, row versions, audit, telemetry, and outbox events."/><Safeguard icon={ClipboardCheck} title="Evidence before approval" text="Approval remains unavailable until required evidence, justification, policy version, and second-person controls are satisfied."/></div></ScreenCard></>;
}

function DevicesSection({ data, onToast }: { data: SupervisorConsoleResponse; onToast: (message: string) => void }) {
  return <ScreenCard><SectionHeading icon={Smartphone} title="Device and station intelligence" subtitle="Current health, supplies, telemetry, calibration, and predicted failures."/><div className="mt-4 space-y-3">{data.devices.map(d => <div key={d.deviceId} className="rounded-2xl border border-tcds-line p-4"><div className="flex items-start gap-3"><Smartphone className={d.state === 'ONLINE' ? 'text-tcds-green' : d.state === 'DEGRADED' ? 'text-tcds-warning' : 'text-tcds-red'} size={20}/><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><p className="font-black">{d.name}</p><p className="mt-1 text-xs font-semibold text-tcds-muted">{d.deviceType} · {d.stationCode ?? 'No station'} · {d.state}</p></div>{d.batteryPercent !== undefined && <span className="text-xs font-black">{d.batteryPercent}%</span>}</div><div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-tcds-muted">{d.supplyRemaining !== undefined && <p>Supply remaining: <strong>{d.supplyRemaining}</strong></p>}{d.signalQuality && <p>Signal: <strong>{d.signalQuality}</strong></p>}{d.droppedEvents !== undefined && <p>Dropped events: <strong>{d.droppedEvents}</strong></p>}{d.calibrationState && <p>Calibration: <strong>{d.calibrationState}</strong></p>}{d.lastActivityAt && <p className="col-span-2">Last activity: <strong>{d.lastActivityAt}</strong></p>}</div>{d.issue && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-black text-tcds-red">{d.issue}</p>}{d.predictiveAlert && <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs font-black text-tcds-warning">Predictive alert: {d.predictiveAlert}</p>}</div></div><button onClick={() => onToast(`Health check requested for ${d.name}.`)} className="tcds-focus mt-3 min-h-10 w-full rounded-xl border border-tcds-line px-3 text-xs font-black">Request health check</button></div>)}</div></ScreenCard>;
}

function SyncSection({ data, onToast }: { data: SupervisorConsoleResponse; onToast: (message: string) => void }) {
  return <><ScreenCard><SectionHeading icon={RefreshCw} title="Synchronization control" subtitle="Inspect commit state before retrying or replaying any operation."/><div className="mt-4 grid grid-cols-2 gap-3"><MetricBox label="Queued" value={data.sync.queued}/><MetricBox label="Processing" value={data.sync.processing}/><MetricBox label="Failed" value={data.sync.failed} critical={data.sync.failed > 0}/><MetricBox label="Dead letter" value={data.sync.deadLetter} critical={data.sync.deadLetter > 0}/></div>{data.sync.oldestQueuedAt && <p className="mt-3 text-xs font-semibold text-tcds-muted">Oldest queued operation: {data.sync.oldestQueuedAt}</p>}</ScreenCard><ScreenCard><Safeguard icon={AlertTriangle} title="Do not replay blindly" text="Confirm idempotency, authoritative commit state, row version, entity state, root cause, and evidence retention before retry or dead-letter replay."/><button onClick={() => onToast('Sync investigation opened. Server confirmation is required before replay.')} className="tcds-focus mt-4 min-h-12 w-full rounded-2xl bg-tcds-black px-4 font-black text-white">Review failed operations</button></ScreenCard></>;
}

function SecuritySection() {
  return <ScreenCard><SectionHeading icon={ShieldCheck} title="Security and audit" subtitle="Read-only operational security and separation-of-duties view."/><div className="mt-4 space-y-3"><Safeguard icon={Activity} title="Actor attribution" text="Every sensitive decision retains user, employee, device, station, facility, IP, request ID, correlation ID, and policy version."/><Safeguard icon={AlertTriangle} title="No direct database controls" text="The PWA cannot run SQL, modify roles, delete evidence, clear audit history, or alter immutable ledgers."/><Safeguard icon={CheckCircle2} title="Separation of duties" text="Administrators maintain technology; managers approve business exceptions; executives handle exceptional risk within non-overridable limits."/></div></ScreenCard>;
}

function AnalyticsSection({ data }: { data: SupervisorConsoleResponse }) {
  const f = data.financials;
  return <><ScreenCard><SectionHeading icon={DollarSign} title="Executive operating snapshot" subtitle="Read-only financial and risk visibility for authorized roles."/><div className="mt-4 grid grid-cols-2 gap-3"><Money label="Revenue today" value={f.revenueTodayUsd} currency={f.currency}/><Money label="Shipping cost" value={f.shippingCostTodayUsd} currency={f.currency}/><Money label="Inventory value" value={f.inventoryValueUsd} currency={f.currency}/><Money label="Pending claims" value={f.pendingClaimsUsd} currency={f.currency}/><Money label="Potential loss" value={f.potentialLossUsd} currency={f.currency} critical/><Money label="Recovered value" value={f.recoveredValueUsd} currency={f.currency}/></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-black"><span className="rounded-xl bg-tcds-surface p-3">{f.shipmentsToday}<br/>shipments</span><span className="rounded-xl bg-tcds-surface p-3">{f.returnsToday}<br/>returns</span><span className="rounded-xl bg-tcds-surface p-3">{f.damagedToday}<br/>damaged</span></div></ScreenCard><ScreenCard><SectionHeading icon={Lightbulb} title="AI operating insights" subtitle="Predictions include confidence, reason, expected impact, and approval requirements."/><div className="mt-4 space-y-3">{data.insights.map(insight => <InsightCard key={insight.insightId} value={insight} onReview={() => undefined}/>)}</div></ScreenCard></>;
}

function WorkforceSection({ data, onToast }: { data: SupervisorConsoleResponse; onToast: (message: string) => void }) {
  return <ScreenCard><SectionHeading icon={Users} title="Workforce and workload" subtitle="See current assignment, queue ownership, productivity, and availability."/><div className="mt-4 space-y-3">{data.workforce.map(person => <div key={person.employeeId} className="rounded-2xl border border-tcds-line p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{person.employeeName}</p><p className="mt-1 text-xs font-semibold text-tcds-muted">{person.role} · {person.currentWorkflow ?? 'Unassigned'} · {person.currentStation ?? 'No station'}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${person.state === 'ACTIVE' ? 'bg-emerald-50 text-tcds-green' : person.state === 'ATTENTION' || person.state === 'OFFLINE' ? 'bg-red-50 text-tcds-red' : 'bg-tcds-surface text-tcds-muted'}`}>{person.state}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs font-black"><span className="rounded-xl bg-tcds-surface p-3">{person.activeWorkCount}<br/>active work</span><span className="rounded-xl bg-tcds-surface p-3">{person.completedToday}<br/>completed</span></div>{data.permissions.canReassignWorkforce && <button onClick={() => onToast(`Workforce reallocation review opened for ${person.employeeName}.`)} className="tcds-focus mt-3 min-h-10 w-full rounded-xl border border-tcds-line text-xs font-black">Review assignment</button>}</div>)}</div></ScreenCard>;
}

function SlaSection({ data }: { data: SupervisorConsoleResponse }) {
  return <ScreenCard><SectionHeading icon={Clock3} title="Workflow SLA monitor" subtitle="Target, average, p95, at-risk, and breached workload by workflow."/><div className="mt-4 space-y-3">{data.slaMetrics.map(metric => { const ratio = metric.averageMinutes / Math.max(1, metric.targetMinutes); return <div key={`${metric.workflow}-${metric.label}`} className="rounded-2xl border border-tcds-line p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{metric.label}</p><p className="mt-1 text-xs font-semibold text-tcds-muted">Goal {metric.targetMinutes}m · Average {metric.averageMinutes}m · p95 {metric.p95Minutes}m</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${ratio <= 1 ? 'bg-emerald-50 text-tcds-green' : ratio <= 1.25 ? 'bg-amber-50 text-tcds-warning' : 'bg-red-50 text-tcds-red'}`}>{ratio <= 1 ? 'ON TRACK' : ratio <= 1.25 ? 'AT RISK' : 'BREACHED'}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-tcds-surface"><div className={`h-full ${ratio <= 1 ? 'bg-tcds-green' : ratio <= 1.25 ? 'bg-tcds-gold' : 'bg-tcds-red'}`} style={{ width: `${Math.min(100, ratio * 75)}%` }}/></div><p className="mt-2 text-xs font-semibold text-tcds-muted">{metric.atRiskCount} at risk · {metric.breachedCount} breached</p></div>; })}</div></ScreenCard>;
}

function ShiftHandoffCard({ data, onToast }: { data: SupervisorConsoleResponse; onToast: (message: string) => void }) {
  const handoff = data.shiftHandoff;
  return <ScreenCard><SectionHeading icon={ClipboardCheck} title="Shift handoff" subtitle="Transfer unresolved work, device state, decisions, and critical context to the next supervisor."/><div className="mt-4 rounded-2xl bg-tcds-surface p-4"><div className="flex items-center justify-between"><div><p className="font-black">{handoff.shiftName}</p><p className="mt-1 text-xs font-semibold text-tcds-muted">{handoff.status}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${handoff.criticalIssues ? 'bg-red-50 text-tcds-red' : 'bg-emerald-50 text-tcds-green'}`}>{handoff.criticalIssues} critical</span></div><p className="mt-3 text-sm text-tcds-muted">Devices: {handoff.deviceSummary}</p>{handoff.notes && <p className="mt-2 text-sm font-semibold">{handoff.notes}</p>}</div>{data.permissions.canCreateShiftHandoff && <button onClick={() => onToast('Shift handoff draft opened. Incoming supervisor acknowledgement will be required.')} className="tcds-focus mt-4 min-h-12 w-full rounded-2xl bg-tcds-black px-4 font-black text-white">Create or review handoff</button>}</ScreenCard>;
}

function LoadingShell() { return <><AppHeader title="Warehouse Command Center" subtitle="Loading authoritative warehouse operations"/><div className="mx-auto max-w-md space-y-4 p-4"><div className="skeleton h-40 rounded-enterprise"/><div className="skeleton h-64 rounded-enterprise"/><div className="skeleton h-48 rounded-enterprise"/></div></>; }
function UnavailableShell({ onRetry, message, onClose }: { onRetry: () => void; message: SupervisorMessage | null; onClose: () => void }) { return <><AppHeader title="Warehouse Command Center" subtitle="Authoritative warehouse operations unavailable"/><div className="mx-auto max-w-md p-4"><ScreenCard><WifiOff className="text-tcds-red"/><h2 className="mt-3 font-display text-section font-black">Command center unavailable</h2><p className="mt-2 text-sm text-tcds-muted">Do not approve, resolve, reassign, replay, or override work using stale information.</p><PrimaryButton className="mt-5" onClick={onRetry}>Retry secure load</PrimaryButton></ScreenCard></div><SupervisorDetailSheet message={message} onClose={onClose}/></>; }
function SectionHeading({ icon: Icon, title, subtitle }: { icon: typeof Activity; title: string; subtitle: string }) { return <div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-tcds-black text-tcds-gold"><Icon size={20}/></div><div><h2 className="font-display text-section font-black">{title}</h2><p className="mt-1 text-sm text-tcds-muted">{subtitle}</p></div></div>; }
function InsightCard({ value, onReview }: { value: AiInsight; onReview: () => void }) { return <div className="rounded-2xl border border-tcds-line p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.14em] text-tcds-goldDeep">{value.category}</p><p className="mt-1 font-black">{value.title}</p></div><span className="rounded-full bg-tcds-surface px-2 py-1 text-[10px] font-black">{Math.round(value.confidence * 100)}%</span></div><p className="mt-3 text-sm font-semibold">{value.recommendation}</p><p className="mt-2 text-sm text-tcds-muted">Reason: {value.reason}</p>{value.expectedImpact && <p className="mt-2 text-xs font-black text-tcds-green">Expected impact: {value.expectedImpact}</p>}{value.requiresApproval && <button onClick={onReview} className="tcds-focus mt-3 min-h-10 w-full rounded-xl border border-tcds-line text-xs font-black">Review recommendation</button>}</div>; }
function Metric({ label, value, critical = false }: { label: string; value: number; critical?: boolean }) { return <div className="bg-white p-3 text-center"><p className={`font-display text-section font-black ${critical ? 'text-tcds-red' : 'text-tcds-ink'}`}>{value}</p><p className="mt-1 text-[9px] font-black uppercase tracking-[.1em] text-tcds-muted">{label}</p></div>; }
function MetricBox({ label, value, critical = false }: { label: string; value: number; critical?: boolean }) { return <div className="rounded-2xl bg-tcds-surface p-4"><p className={`font-display text-page font-black ${critical ? 'text-tcds-red' : 'text-tcds-ink'}`}>{value}</p><p className="text-xs font-black text-tcds-muted">{label}</p></div>; }
function Money({ label, value, currency, critical = false }: { label: string; value: number; currency: string; critical?: boolean }) { return <div className="rounded-2xl bg-tcds-surface p-4"><p className={`font-display text-card font-black ${critical ? 'text-tcds-red' : 'text-tcds-ink'}`}>{new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)}</p><p className="mt-1 text-xs font-black text-tcds-muted">{label}</p></div>; }
function Safeguard({ icon: Icon, title, text }: { icon: typeof ShieldCheck; title: string; text: string }) { return <div className="flex items-start gap-3 rounded-2xl bg-tcds-surface p-4"><Icon className="mt-0.5 shrink-0 text-tcds-gold" size={20}/><div><p className="font-black">{title}</p><p className="mt-1 text-sm leading-6 text-tcds-muted">{text}</p></div></div>; }
function Empty({ label }: { label: string }) { return <div className="rounded-2xl bg-tcds-surface p-5 text-center"><p className="font-black">{label}</p></div>; }
function ExceptionSheet({ value, onClose, onAction }: { value: ExceptionRecord; onClose: () => void; onAction: (text: string) => void }) { return <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-3" onClick={onClose}><section role="dialog" aria-modal="true" onClick={event => event.stopPropagation()} className="mx-auto w-full max-w-md rounded-[2rem] bg-white p-5 shadow-card"><p className="text-xs font-black uppercase tracking-[.2em] text-tcds-gold">{value.exceptionNumber}</p><h2 className="mt-1 font-display text-section font-black">{value.title}</h2><p className="mt-3 text-sm leading-6 text-tcds-muted">{value.summary}</p><div className="mt-4 rounded-2xl bg-tcds-surface p-4 text-sm"><p><strong>Domain:</strong> {value.domain}</p><p className="mt-1"><strong>Status:</strong> {value.status}</p><p className="mt-1"><strong>SLA:</strong> {value.slaState ?? 'Not supplied'}</p><p className="mt-1"><strong>Entity:</strong> {value.entityReference ?? 'Not supplied'}</p><p className="mt-1"><strong>Owner:</strong> {value.ownerName ?? 'Unassigned'}</p></div><div className="mt-4 space-y-2">{value.allowedActions.map(action => <button key={action} onClick={() => onAction(`${action} requested. Server confirmation is required.`)} className="tcds-focus min-h-12 w-full rounded-2xl border border-tcds-line px-4 font-black">{action}</button>)}</div><button onClick={onClose} className="tcds-focus mt-3 min-h-12 w-full rounded-2xl bg-tcds-black px-4 font-black text-white">Close</button></section></div>; }
function PackageSheet({ value, onClose }: { value: PackageLifecycleRecord; onClose: () => void }) { return <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-3" onClick={onClose}><section role="dialog" aria-modal="true" onClick={event => event.stopPropagation()} className="mx-auto w-full max-w-md rounded-[2rem] bg-white p-5 shadow-card"><p className="text-xs font-black uppercase tracking-[.2em] text-tcds-gold">Package lifecycle</p><h2 className="mt-1 font-display text-section font-black">{value.packageReference}</h2><p className="mt-2 text-sm text-tcds-muted">Current stage: {value.currentStage} · Last event {value.lastEventAt}</p><div className="mt-4 space-y-2">{value.timeline.map(entry => <div key={entry.stage} className="flex items-center justify-between rounded-xl bg-tcds-surface p-3"><span className="font-black">{entry.stage}</span><span className={`text-xs font-black ${entry.status === 'COMPLETE' ? 'text-tcds-green' : entry.status === 'BLOCKED' ? 'text-tcds-red' : 'text-tcds-muted'}`}>{entry.status}{entry.occurredAt ? ` · ${entry.occurredAt}` : ''}</span></div>)}</div><button onClick={onClose} className="tcds-focus mt-5 min-h-12 w-full rounded-2xl bg-tcds-black px-4 font-black text-white">Close</button></section></div>; }
