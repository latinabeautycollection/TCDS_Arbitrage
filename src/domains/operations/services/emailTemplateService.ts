import { createHash } from "node:crypto";
import { getTemplate } from "../repositories/emailTemplateRepository";
import type { RenderedEmail } from "../models/emailTypes";

function escapeHtml(v:unknown):string {
  return String(v??"")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function plain(v:unknown):string {
  return String(v??"").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,"");
}
function render(template:string, vars:Record<string,unknown>, html:boolean):string {
  return template.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g,(_,key)=>html?escapeHtml(vars[key]):plain(vars[key]));
}
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");

export async function renderEmail(
  key:string, version:number, vars:Record<string,unknown>
):Promise<RenderedEmail>{
  const t=await getTemplate(key,version);
  if(!t.active) throw new Error(`Template ${key}@${version} is inactive`);
  const subject=render(t.subjectTemplate,vars,false).replace(/[\r\n]+/g," ").trim();
  const textBody=render(t.textTemplate,vars,false);
  const htmlBody=render(t.htmlTemplate,vars,true);
  return {
    subject,textBody,htmlBody,templateKey:key,templateVersion:version,
    subjectHash:hash(subject),
    bodyHash:hash(textBody+"\n"+htmlBody)
  };
}
