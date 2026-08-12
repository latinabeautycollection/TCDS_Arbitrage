import { pool } from "./db";

export interface TemplateVersion {
  templateId: string; templateKey: string; version: number;
  subjectTemplate: string; textTemplate: string; htmlTemplate: string;
  active: boolean;
}

export async function getTemplate(key:string, version:number): Promise<TemplateVersion> {
  const r = await pool.query<{
    template_id:string; template_key:string; version:number; subject_template:string;
    text_template:string; html_template:string; active:boolean;
  }>(`SELECT t.template_id, t.template_key, v.version, v.subject_template, v.text_template,
      v.html_template, v.active
      FROM operations.notification_templates t
      JOIN operations.notification_template_versions v ON v.template_id=t.template_id
      WHERE t.template_key=$1 AND v.version=$2`, [key, version]);
  if (r.rowCount !== 1 || !r.rows[0]) throw new Error(`Template ${key}@${version} not found`);
  const x=r.rows[0];
  return { templateId:x.template_id, templateKey:x.template_key, version:x.version,
    subjectTemplate:x.subject_template, textTemplate:x.text_template, htmlTemplate:x.html_template, active:x.active };
}
