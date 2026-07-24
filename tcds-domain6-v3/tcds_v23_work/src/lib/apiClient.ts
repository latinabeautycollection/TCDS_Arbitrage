const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
  if (!response.ok) throw new Error(`API GET failed: ${path}`);
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`API POST failed: ${path}`);
  return response.json() as Promise<T>;
}
