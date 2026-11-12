// 서버 통신. 같은 출처의 /api 만 호출한다.
// 읽기는 누구나, 저장은 편집 암호가 있어야 한다. 암호는 이 기기 브라우저에만 저장한다.

const TOKEN_KEY = 'app-write-token';
export function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
export function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 저장 공간이 없으면 이번 화면에서만 쓴다 */ } }
const auth = () => { const t = getToken(); return t ? { Authorization: 'Bearer ' + t } : {}; };

export async function getDoc() {
  const res = await fetch('/api/doc', { cache: 'no-store', headers: auth() });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// 성공 { ok: true, version } / 충돌 { ok: false, conflict: true, doc, version } / 암호 없음·틀림 { ok: false, unauthorized: true }
export async function putDoc(doc, version) {
  const res = await fetch('/api/doc', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify({ doc, version }),
  });
  if (res.status === 409) return { ok: false, conflict: true, ...(await res.json()) };
  if (res.status === 401) return { ok: false, unauthorized: true };
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return { ok: true, ...(await res.json()) };
}
