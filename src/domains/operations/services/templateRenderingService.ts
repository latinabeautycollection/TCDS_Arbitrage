import type {
  PolicyTemplateBinding,RecipientResolution
} from "../models/decisionTypes";
import type { PersistedOperationalEvent } from "../models/eventTypes";
import { OperationsDecisionError } from "../errors/OperationsDecisionError";

const TOKEN=/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

function pathGet(root:Record<string,unknown>,path:string):unknown{
  return path.split(".").reduce<unknown>((v,key)=>{
    if(v && typeof v==="object" && !Array.isArray(v)) return (v as Record<string,unknown>)[key];
    return undefined;
  },root);
}

function escapeHtml(v:unknown):string{
  return String(v??"")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function plain(v:unknown):string{
  return String(v??"").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,"");
}

function context(event:PersistedOperationalEvent,r:RecipientResolution):Record<string,unknown>{
  return {
    event:{
      event_id:event.eventId,event_type:event.eventType,severity:event.severity,
      classification:event.classification,occurred_at:event.occurredAt,
      subject_type:event.subjectType??null,subject_id:event.subjectId??null,
      correlation_id:event.correlationId
    },
    payload:event.payload,
    recipient:{
      display_name:r.displayName
    }
  };
}

function render(
  template:string,
  ctx:Record<string,unknown>,
  allowed:Set<string>,
  html:boolean
):string{
  return template.replace(TOKEN,(_all,path:string)=>{
    if(!allowed.has(path)){
      throw new OperationsDecisionError(
        `Template attempted unauthorized variable path: ${path}`,
        "TEMPLATE_RENDER_FAILED",false
      );
    }
    const value=pathGet(ctx,path);
    return html?escapeHtml(value):plain(value);
  });
}

export function renderBoundTemplate(
  binding:PolicyTemplateBinding,
  event:PersistedOperationalEvent,
  recipient:RecipientResolution
):{subject?:string;textBody:string;htmlBody?:string}{
  const ctx=context(event,recipient);
  const allowed=new Set(binding.allowedVariablePaths);

  for(const path of binding.requiredVariablePaths){
    if(!allowed.has(path)){
      throw new OperationsDecisionError(
        `Required template path is not allowlisted: ${path}`,
        "TEMPLATE_RENDER_FAILED",false
      );
    }
    const v=pathGet(ctx,path);
    if(v===undefined || v===null || v===""){
      throw new OperationsDecisionError(
        `Required template value is missing: ${path}`,
        "TEMPLATE_RENDER_FAILED",false
      );
    }
  }

  const subject=binding.subjectTemplate
    ? render(binding.subjectTemplate,ctx,allowed,false).replace(/[\r\n]+/g," ").trim()
    : undefined;

  const textBody=render(binding.textTemplate,ctx,allowed,false);
  const htmlBody=binding.htmlTemplate
    ? render(binding.htmlTemplate,ctx,allowed,true)
    : undefined;

  return { ...(subject?{subject}:{}), textBody, ...(htmlBody?{htmlBody}:{}) };
}
