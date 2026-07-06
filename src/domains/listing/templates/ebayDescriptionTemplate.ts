export function renderEbayDescription(data: { title: string; bullets: string[]; condition: string; disclosures: string[]; specifics: Record<string, unknown>; }): string {
  const bullets = data.bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('');
  const disclosures = data.disclosures.length ? `<h3>Condition / Disclosure</h3><ul>${data.disclosures.map(d=>`<li>${escapeHtml(d)}</li>`).join('')}</ul>` : '';
  const specifics = Object.entries(data.specifics).map(([k,v]) => `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(Array.isArray(v)?v.join(', '):String(v))}</td></tr>`).join('');
  return `<h2>${escapeHtml(data.title)}</h2><p>${escapeHtml(data.condition)}</p><ul>${bullets}</ul>${disclosures}<h3>Item Specifics</h3><table>${specifics}</table><p>Please review all photos before purchase. The item shown is the item you will receive unless otherwise noted.</p>`;
}
function escapeHtml(s:string){return s.replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] as string));}
