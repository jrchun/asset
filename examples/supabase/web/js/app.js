// Supabase 모드 예제: 이메일·비밀번호 로그인 + 내 메모 목록(추가·삭제).
// 권한 규칙은 DB(RLS)에 있다. 화면은 로그인 상태에 따라 그리기만 한다.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const $ = id => document.getElementById(id);
const status = t => { $('status').textContent = t; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

if (SUPABASE_URL.startsWith('__')) {
  status('Supabase 연결 정보가 아직 없습니다. web/js/config.js를 채워 주세요(docs/AGENT_SETUP.md).');
  throw new Error('config.js not set');
}
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 오류 문구를 사용자가 아는 말로
function friendly(error) {
  const m = String(error?.message || error);
  if (/Invalid login credentials/i.test(m)) return '이메일이나 비밀번호가 맞지 않습니다.';
  if (/already registered/i.test(m)) return '이미 가입한 이메일입니다. 로그인을 눌러 주세요.';
  if (/Email not confirmed/i.test(m)) return '이메일 확인이 켜져 있어 로그인할 수 없습니다. Supabase에서 "Confirm email"을 꺼 주세요(docs/SETUP.md).';
  if (/Password should be/i.test(m)) return '비밀번호는 6자 이상이어야 합니다.';
  return '처리하지 못했습니다: ' + m;
}

async function render(session) {
  $('authPanel').hidden = !!session;
  $('notesPanel').hidden = !session;
  if (!session) { status(''); return; }
  $('who').textContent = session.user.email + ' 로 로그인됨';
  const { data, error } = await sb.from('notes').select('id, body, created_at').order('created_at', { ascending: false });
  if (error) { status(friendly(error)); return; }
  $('list').innerHTML = data.map(n => `<li><span>${esc(n.body)}</span><button class="del" type="button" data-id="${esc(n.id)}" aria-label="메모 삭제">✕</button></li>`).join('')
    || '<li class="hint">아직 메모가 없습니다.</li>';
  status('');
}

$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const act = e.submitter?.dataset.act || 'signin';
  const email = $('email').value.trim(), password = $('password').value;
  status(act === 'signup' ? '가입하는 중…' : '로그인하는 중…');
  const { data, error } = act === 'signup'
    ? await sb.auth.signUp({ email, password })
    : await sb.auth.signInWithPassword({ email, password });
  if (error) { status(friendly(error)); return; }
  if (act === 'signup' && !data.session) status('가입했습니다. 이메일 확인이 켜져 있어 바로 로그인되지 않습니다(docs/SETUP.md).');
});

$('signOut').addEventListener('click', () => sb.auth.signOut());

$('addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = $('body').value.trim(); if (!body) return;
  status('저장 중…');
  const { error } = await sb.from('notes').insert({ body });
  if (error) { status(friendly(error)); return; }
  $('body').value = '';
  render((await sb.auth.getSession()).data.session);
});

$('list').addEventListener('click', async e => {
  const id = e.target.dataset.id; if (!id) return;
  status('지우는 중…');
  const { error } = await sb.from('notes').delete().eq('id', id);
  if (error) { status(friendly(error)); return; }
  render((await sb.auth.getSession()).data.session);
});

sb.auth.onAuthStateChange((_event, session) => { render(session); });
