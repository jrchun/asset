// 문서 하나를 서버와 동기화한다. 화면 코드와 섞지 않는다.
//   불러오기 → edit()로 고치면 0.7초 뒤 자동 저장 → 다른 기기에서 먼저 고쳤으면(409) 최신 문서로 바꾸고 알림
//   → 편집 암호가 없거나 틀리면(401) needToken()을 불러 암호를 받은 뒤 그대로 저장
import * as api from './api.js';

export function createDocSync({ render, status, needToken, delay = 700 }) {
  let doc = null, version = 0, timer = null, saving = false, again = false;

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
    clearTimeout(timer); timer = setTimeout(flush, delay);
  }

  async function flush() {
    if (saving) { again = true; return; }
    saving = true;
    try {
      const r = await api.putDoc(JSON.parse(JSON.stringify(doc)), version);
      if (r.ok) { version = r.version; status('저장됨'); }
      else if (r.unauthorized) {
        saving = false; again = false;
        status(api.getToken() ? '편집 암호가 맞지 않아 저장하지 못했습니다. 다시 입력해 주세요.' : '저장하려면 편집 암호를 입력하세요. 이 기기에서는 한 번만 넣으면 됩니다.');
        needToken();
        return;
      } else {
        clearTimeout(timer); again = false;
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

  function setToken(t) { api.setToken(t); status('저장 중…'); flush(); }

  return { load, edit, flush, setToken, get doc() { return doc; } };
}
