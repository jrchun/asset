// 문서 하나를 서버와 동기화한다. 화면 코드와 섞지 않는다.
//   불러오기 → edit()로 고치면 0.7초 뒤 자동 저장 → 다른 기기에서 먼저 고쳤으면(409) 최신 문서로 바꾸고 알림
//   → 편집 암호가 없거나 틀리면(401) needToken({ firstTime, minLength })을 불러 암호를 받은 뒤 그대로 저장
//     firstTime: 아직 아무도 편집 암호를 정하지 않음 → 입력한 값으로 처음 정한다(대시보드 단계 없음)
//     minLength: 처음 정할 때의 최소 글자 수(서버가 /api/health로 알려 준다)
import * as api from './api.js';

export function createDocSync({ render, status, needToken, delay = 700 }) {
  let doc = null, version = 0, timer = null, saving = false, again = false;
  let firstTime = false, minLength = 6;

  // 401을 받았을 때: 아직 아무도 암호를 안 정했는지(정하기) 아니면 틀렸는지(입력) 서버에 물어 안내한다.
  async function askForToken() {
    const s = await api.getStatus().catch(() => ({}));
    firstTime = s.passwordSet === false;
    minLength = s.passwordMinLength || minLength;
    status(firstTime
      ? `아직 편집 암호가 없습니다. 앞으로 쓸 편집 암호를 정해 주세요(${minLength}자 이상). 다른 기기에서도 이 암호로 고칩니다.`
      : api.getToken() ? '편집 암호가 맞지 않아 저장하지 못했습니다. 다시 입력해 주세요.' : '저장하려면 편집 암호를 입력하세요. 이 기기에서는 한 번만 넣으면 됩니다.');
    needToken({ firstTime, minLength });
  }

  async function load() {
    try {
      const r = await api.getDoc();
      doc = r.doc; version = r.version;
      render(doc, { replaced: true });
      status('');
    } catch (e) {
      status('서버에 연결하지 못했습니다. 잠시 후 새로고침해 주세요.');
    }
  }

  function edit(mutate) {
    if (!doc) return;
    mutate(doc);
    status('저장 대기 중…');
    clearTimeout(timer); timer = setTimeout(() => { timer = null; flush(); }, delay);
  }

  async function flush() {
    if (saving) { again = true; return; }
    saving = true;
    try {
      const r = await api.putDoc(JSON.parse(JSON.stringify(doc)), version);
      if (r.ok) { version = r.version; status('저장됨'); }
      else if (r.unauthorized) {
        saving = false; again = false;
        await askForToken();
        return;
      } else {
        clearTimeout(timer); timer = null; again = false;
        doc = r.doc; version = r.version;
        render(doc, { replaced: true, force: true });
        status('다른 기기에서 수정돼 새로 불러왔습니다');
      }
    } catch (e) {
      status('저장하지 못했습니다. 잠시 후 다시 수정해 보세요.');
    }
    saving = false;
    if (again) { again = false; flush(); }
  }

  async function setToken(t) {
    if (firstTime) {
      const r = await api.claimPassword(t).catch(() => ({ ok: false, detail: '서버에 연결하지 못했습니다.' }));
      if (!r.ok) {
        firstTime = !r.taken;
        status(r.taken ? '편집 암호가 이미 정해져 있습니다. 그 암호를 입력해 주세요.' : r.detail);
        needToken({ firstTime, minLength });
        return;
      }
      firstTime = false;
    }
    api.setToken(t); status('저장 중…'); flush();
  }

  // 서버가 다른 경로(체결 반영·되돌리기)로 문서를 바꿨을 때 그 결과로 바꿔 끼운다.
  function replace(nextDoc, nextVersion) {
    clearTimeout(timer); timer = null; again = false;
    doc = nextDoc; version = nextVersion;
    render(doc, { replaced: true, force: true });
  }
  // 저장 대기 중인 수정이 있으면 지금 저장하고 끝날 때까지 기다린다.
  async function settle() {
    for (let i = 0; i < 50 && (timer || saving); i++) {
      if (timer) { clearTimeout(timer); timer = null; await flush(); }
      else await new Promise(r => setTimeout(r, 100));
    }
  }

  return { load, edit, flush, setToken, replace, settle, askForToken, get doc() { return doc; }, get version() { return version; } };
}
