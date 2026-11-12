// 예제 앱: 제목과 메모를 저장하는 화면. 새 프로젝트에서는 이 파일을 앱에 맞게 바꾼다.
// 계산·규칙은 순수 함수로 따로 두고(테스트하기 쉽게), 이 파일은 그리기와 이벤트만 맡는다.
import { createDocSync } from './docsync.js';

const $ = id => document.getElementById(id);

const sync = createDocSync({
  render(doc, { force } = {}) {
    // 입력 중인 칸은 덮어쓰지 않는다(충돌로 문서를 통째로 바꿀 때는 예외).
    for (const k of ['title', 'memo']) {
      if (force || document.activeElement !== $(k)) $(k).value = doc[k] ?? '';
    }
    $('count').textContent = (doc.memo || '').length.toLocaleString('ko-KR') + '자';
  },
  status(text) { $('saveState').textContent = text; },
  needToken() { $('tokenForm').hidden = false; $('tokenIn').focus(); },
});

for (const k of ['title', 'memo']) {
  $(k).addEventListener('input', e => {
    sync.edit(doc => { doc[k] = e.target.value; });
    $('count').textContent = ($('memo').value || '').length.toLocaleString('ko-KR') + '자';
  });
}

$('tokenForm').addEventListener('submit', e => {
  e.preventDefault();
  const t = $('tokenIn').value.trim(); $('tokenIn').value = '';
  $('tokenForm').hidden = true;
  sync.setToken(t);
});

sync.load();
