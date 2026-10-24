import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// TCDS: pick up new releases without closing tabs. The service worker does not cache the app itself, so a new release is
// detected by fetching index.html and comparing its entry script with the one this page loaded. On the sign-in screen
// the app reloads straight away; elsewhere it offers an Update button so a worker is never interrupted mid-task.
const CHECK_EVERY_MS = 5 * 60 * 1000;
const entryScript = (html: string) => html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1] ?? null;
const loadedScript = () => document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src') ?? null;

export function AppUpdate() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const current = loadedScript();
    if (!current || !import.meta.env.PROD) return;
    let stopped = false;
    async function check() {
      if (stopped || !navigator.onLine) return;
      try {
        const r = await fetch('/', { cache: 'no-store', credentials: 'same-origin' });
        const latest = r.ok ? entryScript(await r.text()) : null;
        if (!latest || latest === current) return;
        const typing = document.activeElement instanceof HTMLInputElement;
        if (window.location.pathname === '/' && !typing) window.location.reload();
        else setAvailable(true);
      } catch { /* offline or server busy: try again later */ }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    void check();
    return () => { stopped = true; document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onVisible); window.clearInterval(timer); };
  }, []);

  if (!available) return null;
  return (
    <div role="status" className="safe-top fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-2">
      <button type="button" onClick={() => window.location.reload()} className="tcds-focus flex min-h-11 items-center gap-2 rounded-full bg-tcds-black px-5 text-sm font-black text-white shadow-card">
        <RefreshCw size={16} /> New version available · Update
      </button>
    </div>
  );
}
