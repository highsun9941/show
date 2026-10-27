import { filterQuestions, makeDeck, validateQuestion, parseImport, MAX_IMAGE_BYTES } from './core.js';
import { LocalStore, GitHubStore } from './storage.js';

const $ = id => document.getElementById(id);
const state = { view: 'home', store: null, questions: [], admin: false, ready: false, category: '전체', page: 1, deck: [], index: 0, answer: false, hint: false, running: false, seconds: 0, deadline: 0, duration: 0, busy: false, edit: null, render: 0 };
const PAGE_SIZE = 24;
let toastTimer, clockInterval, confirmResolve;
const el = (tag, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
function toast(message, error = false, duration = 4500) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, duration);
}
function showDialog(id) { if (state.running) pauseTimer(); $(id).showModal(); }
function view(name) {
  state.view = name;
  for (const section of document.querySelectorAll('main > .view')) section.hidden = section.id !== `${name}-view`;
  document.body.classList.toggle('playing', name === 'game');
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === name; button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (name === 'library') renderLibrary();
  if (name !== 'game') { pauseTimer(); leaveFullscreen(); }
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function getMode() {
  try { return localStorage.getItem('show-storage-mode') === 'local' ? 'local' : 'shared'; } catch { return 'shared'; }
}
async function connect() {
  state.ready = false; state.admin = false; state.questions = []; state.page = 1;
  const shared = getMode() === 'shared'; state.store = shared ? new GitHubStore(window.SHOW_CONFIG) : new LocalStore();
  $('connection-label').textContent = shared ? 'GitHub에 저장' : '이 기기 저장';
  $('connection-button').classList.toggle('shared', shared);
  $('storage-banner').classList.toggle('shared', shared);
  renderAll(); $('error-view').hidden = true;
  try {
    await state.store.init(); state.questions = await state.store.list(); state.ready = true;
    if (shared) state.admin = await state.store.checkSession();
    renderAll();
  } catch (e) {
    $('load-error').textContent = e.message; $('error-view').hidden = false;
    $('setup-note').textContent = '저장소에 연결한 뒤 게임을 시작해 주세요.';
  }
}
async function refresh(silent = false) {
  const questions = await state.store.list(); state.questions = questions; state.ready = true; renderAll();
  if (!silent) toast('최신 문제를 불러왔어요.');
}
function roundOptions() { return { category: state.category, difficulty: $('round-difficulty').value, count: $('round-count').value, random: $('round-order').value === 'random' }; }
function updateAvailable() {
  const count = filterQuestions(state.questions, { ...roundOptions(), activeOnly: true }).length;
  const wanted = $('round-count').value;
  $('available-count').textContent = `${count.toLocaleString()}개`;
  $('start-game').disabled = !state.ready || count === 0;
  $('setup-note').textContent = !state.ready ? '문제를 불러오고 있습니다.' : count === 0 ? '조건에 맞는 문제가 없어요. 장르·난이도를 바꾸거나 문제를 추가해 주세요.' : `${wanted === 'all' ? count : Math.min(Number(wanted), count)}문제로 진행 · 한 게임 안에서 중복 없이 출제`;
}
function renderAll() {
  $('storage-description').textContent = state.store?.mode === 'shared'
    ? state.store.stale ? 'GitHub 원본을 읽지 못해 마지막 Pages 배포본을 보여드립니다. 최신 문제는 새로고침해 주세요. 편집에는 저장용 키가 필요합니다.' : '문제와 이미지가 GitHub 저장소에 함께 보관됩니다. 문제를 편집할 기기에서는 저장용 GitHub 키로 로그인해 주세요.'
    : '이 브라우저에만 저장됩니다. 다른 기기에는 공유되지 않으며, 브라우저 데이터를 지우면 삭제됩니다. GitHub 공동 저장으로 바꾸려면 우측 상단을 눌러주세요.';
  $('nav-count').textContent = state.questions.length.toLocaleString();
  $('home-total').textContent = state.questions.length.toLocaleString();
  $('sample-notice').hidden = !state.questions.some(q => q.demo);
  $('admin-toolbar').hidden = !state.admin;
  $('manage-button').hidden = state.admin;
  $('admin-badge').textContent = state.store?.mode === 'shared' ? '공동 관리 모드' : '이 기기 체험 모드';
  updateAvailable(); renderCards($('home-cards'), state.questions.filter(q => q.enabled).slice(0, 3), false);
  if (state.view === 'library') renderLibrary();
}
function renderCards(container, questions, admin) {
  container.replaceChildren();
  if (!questions.length) {
    const empty = el('div', 'empty-state'); empty.append(el('strong', '', state.questions.length ? '아직 이 장면은 없네요.' : '첫 번째 장면을 기다리고 있어요.'), el('p', '', '다른 조건으로 검색하거나 새로운 문제를 등록해 주세요.')); container.append(empty); return;
  }
  for (const q of questions) {
    const card = el('article', 'question-card');
    const button = el('button', 'card-play'); button.setAttribute('aria-label', `${q.title} 한 문제 플레이`);
    const img = el('img'); img.alt = `${q.title}의 등록된 장면`; img.loading = 'lazy'; img.decoding = 'async';
    state.store.imageUrl(q.image).then(url => { if (url) img.src = url; }).catch(() => {});
    img.addEventListener('error', () => { img.hidden = true; button.setAttribute('aria-label', `${q.title} — 이미지 오류, 한 문제 플레이`); });
    const playIcon = el('span', 'card-play-icon'); playIcon.append(el('span', '', '▶'));
    button.append(img, el('span', 'card-tag', q.demo ? 'ILLUSTRATION · DEMO' : q.enabled ? 'SCENE' : '출제 제외'), playIcon);
    button.addEventListener('click', () => startGame([q]));
    const content = el('div', 'card-content'), meta = el('div', 'card-meta');
    meta.append(el('span', '', q.category), el('span', '', '·'), el('span', '', q.year || '연도 미등록'), el('span', `difficulty${q.difficulty === '어려움' ? ' hard' : ''}`, q.difficulty));
    content.append(meta, el('h3', '', q.title), el('p', q.enabled ? '' : 'disabled-tag', q.demo ? '게임 방식 체험용 창작 샘플' : q.enabled ? '장면을 누르고 기억을 재생해 보세요' : '랜덤 게임에서는 출제되지 않아요'));
    if (admin) {
      const actions = el('div', 'card-admin');
      const edit = el('button', '', '수정하기 ↗'); edit.addEventListener('click', () => openEditor(q));
      const remove = el('button', '', '삭제'); remove.addEventListener('click', () => deleteQuestion(q));
      actions.append(edit, remove); content.append(actions);
    }
    card.append(button, content); container.append(card);
  }
}
function renderLibrary() {
  const filtered = filterQuestions(state.questions, { search: $('search').value, category: $('filter-category').value, difficulty: $('filter-difficulty').value });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); state.page = Math.min(state.page, pages);
  $('filtered-count').textContent = `${filtered.length.toLocaleString()}개의 장면${state.admin ? ' · 관리 중' : ''}`;
  renderCards($('library-cards'), filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE), state.admin);
  $('pagination').replaceChildren();
  if (pages > 1) {
    const prev = el('button', 'button subtle', '← 이전'), next = el('button', 'button subtle', '다음 →');
    prev.disabled = state.page <= 1; next.disabled = state.page >= pages;
    prev.onclick = () => { state.page--; renderLibrary(); $('library-view').scrollIntoView(); };
    next.onclick = () => { state.page++; renderLibrary(); $('library-view').scrollIntoView(); };
    $('pagination').append(prev, el('span', '', `${state.page} / ${pages}`), next);
  }
}

function startGame(deck = makeDeck(state.questions, roundOptions())) {
  if (!deck.length) { toast('출제할 문제가 없습니다.', true); return; }
  state.deck = deck; state.index = 0; state.duration = Number($('round-timer').value);
  view('game'); renderScene();
}
async function renderScene() {
  pauseTimer(); state.answer = false; state.hint = false; state.seconds = state.duration; updateTimer();
  const q = state.deck[state.index], render = ++state.render;
  $('game-current').textContent = String(state.index + 1).padStart(2, '0');
  $('game-total').textContent = String(state.deck.length).padStart(2, '0');
  $('stage-number').textContent = `SCENE ${String(state.index + 1).padStart(2, '0')}`;
  $('game-progress-bar').style.width = `${(state.index + 1) / state.deck.length * 100}%`;
  $('stage-image').hidden = true; $('stage-image').removeAttribute('src');
  $('stage-loading').hidden = false; $('stage-loading').textContent = '장면을 준비하고 있어요…';
  // 정답을 공개할 때만 DOM에 대사·작품명을 넣어 화면 읽기 프로그램에도 먼저 노출되지 않게 합니다.
  $('answer-text').textContent = ''; $('answer-title').textContent = ''; $('hint-text').textContent = '';
  $('answer-overlay').hidden = true; $('hint-overlay').hidden = true; $('timeout-overlay').hidden = true;
  $('answer-button').firstChild.textContent = '정답 공개 '; $('hint-button').disabled = !q.hint;
  $('prev-button').disabled = state.index === 0;
  $('next-button').textContent = state.index === state.deck.length - 1 ? '게임 마치기 →' : '다음 문제 →';
  $('timer-button').disabled = true;
  const failed = () => {
    if (state.render !== render) return;
    $('stage-loading').hidden = false; $('stage-loading').textContent = '이미지를 불러오지 못했어요.\n네트워크·이미지 주소를 확인하거나 다음 문제로 이동해 주세요.'; $('stage-image').hidden = true;
  };
  try {
    const url = await state.store.imageUrl(q.image);
    if (render !== state.render) return;
    if (!url) { failed(); return; }
    $('stage-image').onload = () => { if (render !== state.render) return; $('stage-image').hidden = false; $('stage-loading').hidden = true; $('timer-button').disabled = !state.duration; };
    $('stage-image').onerror = failed; $('stage-image').src = url;
    // 현재 장면 외에 다음 한 장만 미리 읽습니다.
    const next = state.deck[state.index + 1];
    if (next) state.store.imageUrl(next.image).then(src => { if (src) { const image = new Image(); image.src = src; } }).catch(() => {});
  } catch { failed(); }
}
function toggleAnswer() {
  state.answer = !state.answer;
  const q = state.deck[state.index];
  $('answer-text').textContent = state.answer ? q.answer : '';
  $('answer-title').textContent = state.answer ? `${q.title}${q.year ? ` (${q.year})` : ''} · ${q.category}${q.demo ? ' · 창작 샘플' : ''}` : '';
  $('answer-overlay').classList.toggle('long-answer', q.answer.length > 100);
  $('answer-overlay').hidden = !state.answer; $('hint-overlay').hidden = true; state.hint = false;
  $('timeout-overlay').hidden = true;
  $('answer-button').firstChild.textContent = state.answer ? '정답 숨기기 ' : '정답 공개 ';
  if (state.answer) pauseTimer();
}
function toggleHint() {
  const q = state.deck[state.index]; if (!q.hint || state.answer) return;
  state.hint = !state.hint; $('hint-text').textContent = state.hint ? q.hint : ''; $('hint-overlay').hidden = !state.hint;
}
function nextScene() {
  if (state.index < state.deck.length - 1) { state.index++; renderScene(); }
  else { $('finished-count').textContent = state.deck.length; view('finish'); }
}
function updateTimer() {
  $('timer-display').textContent = state.duration ? `${Math.floor(state.seconds / 60)}:${String(state.seconds % 60).padStart(2, '0')}` : '시간 제한 없음';
  $('timer-state').textContent = !state.duration ? '' : state.running ? '일시정지' : state.seconds === 0 ? '종료' : '시작';
  $('timer-button').classList.toggle('running', state.running); $('timer-button').classList.toggle('expired', Boolean(state.duration && state.seconds === 0));
  $('timer-reset').hidden = !state.duration;
}
function tick() {
  if (!state.running) return;
  state.seconds = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)); updateTimer();
  if (!state.seconds) { pauseTimer(); $('timeout-overlay').hidden = false; }
}
function pauseTimer() { if (state.running) { state.seconds = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)); } state.running = false; clearInterval(clockInterval); updateTimer(); }
function toggleTimer() {
  if (!state.duration || state.answer || !$('stage-loading').hidden) return;
  if (state.running) { pauseTimer(); return; }
  if (!state.seconds) state.seconds = state.duration;
  $('timeout-overlay').hidden = true; state.deadline = Date.now() + state.seconds * 1000; state.running = true; updateTimer(); clockInterval = setInterval(tick, 200);
}
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($('game-view').requestFullscreen) await $('game-view').requestFullscreen();
    else toast('이 기기는 브라우저 전체 화면을 지원하지 않습니다. 현재 게임 화면으로 진행해 주세요.');
  } catch { toast('전체 화면을 열 수 없습니다. 현재 화면으로 진행할 수 있어요.'); }
}
function leaveFullscreen() { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }

function confirm(title, description, yes = '확인') {
  $('confirm-title').textContent = title; $('confirm-description').textContent = description; $('confirm-yes').textContent = yes;
  showDialog('confirm-dialog'); return new Promise(resolve => { confirmResolve = resolve; });
}
function openLogin() {
  if (!state.ready) { toast('저장소 연결을 먼저 확인해 주세요.', true); return; }
  if (state.admin) return;
  const local = state.store.mode === 'local';
  $('login-form').reset(); $('login-error').textContent = '';
  $('login-fields').hidden = local;
  $('login-id').disabled = local; $('login-password').disabled = local; $('github-token').disabled = local;
  $('login-description').textContent = local ? '현재는 이 기기에만 저장되는 체험 모드입니다. 로그인 없이 기능을 확인할 수 있어요. 다른 기기와 함께 편집하려면 GitHub 공동 저장으로 바꿔주세요.' : '아이디·비밀번호와 공유받은 저장용 키를 입력해 주세요. 저장용 키는 이 탭에만 기억하며, 관리 종료 시 지웁니다.';
  $('login-submit').textContent = local ? '이 기기에서 체험하기 ↗' : '로그인하고 관리하기 ↗';
  showDialog('login-dialog');
}
async function requireAdmin(error) {
  if (error.status === 401) { state.admin = false; renderAll(); }
  toast(error.message, true, 6500);
}
function openEditor(q = null) {
  if (!state.admin || state.busy) return;
  $('question-form').reset(); $('image-file').value = ''; $('image-url').value = ''; $('edit-error').textContent = '';
  state.edit = { question: q ? { ...q } : null, image: q?.image || '', blob: null, preview: '', operation: 0 };
  $('edit-title').textContent = q ? '장면 수정하기' : '새로운 장면 추가';
  $('save-mode-label').textContent = state.store.mode === 'local' ? '이 브라우저에 저장됩니다' : '공동 저장소에 반영됩니다';
  if (q) {
    for (const name of ['title', 'category', 'difficulty', 'year', 'answer', 'hint', 'source']) $('question-form').elements[name].value = q[name];
    $('question-form').elements.enabled.checked = q.enabled;
    if (q.image.startsWith('https://')) $('image-url').value = q.image;
  }
  previewEditor(); showDialog('edit-dialog');
}
async function previewEditor() {
  const edit = state.edit; if (!edit) return;
  const operation = ++edit.operation;
  const url = edit.preview || (edit.image ? await state.store.imageUrl(edit.image) : '');
  if (state.edit !== edit || edit.operation !== operation) return;
  $('edit-image').hidden = !url; $('upload-placeholder').hidden = Boolean(url);
  if (url) $('edit-image').src = url; else $('edit-image').removeAttribute('src');
}
async function compressImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPG, PNG, WebP 이미지를 선택해 주세요.');
  if (file.size > 20 * 1024 * 1024) throw new Error('원본 이미지는 20MB 이내로 선택해 주세요.');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.')); image.src = url; });
    let scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    for (let i = 0; i < 6; i++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', i < 2 ? .84 : .72));
      if (blob && blob.size <= MAX_IMAGE_BYTES) return blob;
      scale *= .78;
    }
    throw new Error('이미지 용량을 줄이지 못했습니다. 더 작은 이미지를 선택해 주세요.');
  } finally { URL.revokeObjectURL(url); }
}
async function deleteQuestion(q) {
  if (!state.admin || state.busy) return;
  if (!await confirm('이 장면을 삭제할까요?', `「${q.title}」 문제가 ${state.store.mode === 'shared' ? '공동 저장소에서' : '이 기기에서'} 삭제됩니다. 삭제 전에 JSON 내보내기로 보관할 수 있어요.`, '문제 삭제')) return;
  try { await state.store.remove(q); await refresh(true); toast('문제를 삭제했어요.'); } catch (e) { requireAdmin(e); }
}
function setBusy(busy) {
  state.busy = busy;
  for (const id of ['import-button', 'export-button', 'add-button', 'logout-button', 'refresh-button']) $(id).disabled = busy;
}
function downloadJson(value) {
  const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), questions: value }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `scene-and-say-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => view(button.dataset.view)));
document.querySelector('.brand').addEventListener('click', e => { e.preventDefault(); view('home'); });
document.querySelectorAll('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('#category-picker button').forEach(button => button.addEventListener('click', () => {
  state.category = button.dataset.category;
  document.querySelectorAll('#category-picker button').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); }); updateAvailable();
}));
for (const id of ['round-count', 'round-difficulty']) $(id).addEventListener('change', updateAvailable);
$('start-game').onclick = () => startGame();
$('browse-library').onclick = () => view('library');
$('sample-manage').onclick = () => { view('library'); openLogin(); };
$('manage-button').onclick = openLogin;
for (const id of ['search', 'filter-category', 'filter-difficulty']) $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { state.page = 1; renderLibrary(); });
$('refresh-button').onclick = async () => { try { await refresh(); } catch (e) { toast(e.message, true); } };
$('answer-button').onclick = toggleAnswer;
$('hint-button').onclick = toggleHint;
$('prev-button').onclick = () => { if (state.index) { state.index--; renderScene(); } };
$('next-button').onclick = nextScene;
$('timer-button').onclick = toggleTimer;
$('timer-reset').onclick = () => { pauseTimer(); state.seconds = state.duration; updateTimer(); $('timeout-overlay').hidden = true; };
$('fullscreen-button').onclick = fullscreen;
$('exit-game').onclick = async () => { if (await confirm('게임을 나갈까요?', '진행 중인 게임이 종료됩니다. 등록한 문제는 그대로 보관돼요.', '게임 나가기')) view('home'); };
$('replay-button').onclick = () => startGame();
$('finish-home').onclick = () => view('home');
$('help-button').onclick = $('shortcuts-button').onclick = () => showDialog('help-dialog');
$('confirm-cancel').onclick = () => { confirmResolve?.(false); confirmResolve = null; $('confirm-dialog').close(); };
$('confirm-yes').onclick = () => { confirmResolve?.(true); confirmResolve = null; $('confirm-dialog').close(); };
$('confirm-dialog').addEventListener('close', () => { confirmResolve?.(false); confirmResolve = null; });
$('retry-button').onclick = connect;
function openConnection() { if (state.busy) return; $('storage-mode').value = getMode(); $('connection-error').textContent = ''; showDialog('connection-dialog'); }
$('connection-button').onclick = $('error-connection').onclick = openConnection;
$('connection-form').onsubmit = async e => {
  e.preventDefault();
  try {
    state.store.clearSession?.();
    localStorage.setItem('show-storage-mode', $('storage-mode').value); $('connection-dialog').close(); await connect();
  } catch (e) { $('connection-error').textContent = e.message; }
};
$('login-form').onsubmit = async e => {
  e.preventDefault(); $('login-submit').disabled = true; $('login-error').textContent = '';
  try {
    if (state.store.mode === 'shared') {
      if ($('login-id').value.trim() !== '이젠' || $('login-password').value !== 'ezen') throw new Error('아이디 또는 비밀번호를 확인해 주세요.');
      await state.store.login($('github-token').value);
      state.questions = await state.store.list();
    }
    state.admin = true; $('login-password').value = ''; $('github-token').value = ''; $('login-dialog').close(); renderAll(); toast(state.store.mode === 'shared' ? 'GitHub 공동 문제 관리를 시작합니다.' : '이 기기에서 관리 기능을 체험합니다.');
  } catch (e) { $('login-error').textContent = e.message; } finally { $('login-submit').disabled = false; }
};
$('logout-button').onclick = async () => {
  try { if (state.store.mode === 'shared') await state.store.logout(); } catch { /* 로컬 세션은 항상 지웁니다. */ }
  state.admin = false; renderAll(); toast('관리 모드를 종료했어요.');
};
$('add-button').onclick = () => openEditor();
$('image-file').onchange = async () => {
  const file = $('image-file').files[0], edit = state.edit; if (!file || !edit) return;
  $('save-button').disabled = true; $('edit-error').textContent = '이미지를 준비하고 있어요…';
  try {
    const blob = await compressImage(file); if (state.edit !== edit) return;
    if (edit.preview) URL.revokeObjectURL(edit.preview);
    edit.blob = blob; edit.preview = URL.createObjectURL(blob); edit.image = ''; $('image-url').value = ''; await previewEditor(); $('edit-error').textContent = '';
  } catch (e) { $('edit-error').textContent = e.message; } finally { $('save-button').disabled = false; }
};
$('image-url').onchange = () => {
  if (!state.edit) return;
  const value = $('image-url').value.trim();
  if (value && !/^https:\/\//i.test(value)) { $('edit-error').textContent = 'HTTPS 이미지 주소를 입력해 주세요.'; return; }
  if (state.edit.preview) URL.revokeObjectURL(state.edit.preview);
  state.edit.preview = ''; state.edit.blob = null; state.edit.image = value; $('image-file').value = ''; $('edit-error').textContent = ''; previewEditor();
};
$('edit-dialog').addEventListener('close', () => { if (state.edit?.preview) URL.revokeObjectURL(state.edit.preview); state.edit = null; $('save-button').disabled = false; });
$('question-form').onsubmit = async e => {
  e.preventDefault(); const edit = state.edit; if (!edit || state.busy) return;
  $('save-button').disabled = true; $('edit-error').textContent = '';
  try {
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const data = { ...edit.question, ...form, enabled: e.currentTarget.elements.enabled.checked, image: edit.blob ? 'https://upload.invalid/pending' : edit.image, demo: false };
    const validated = validateQuestion(data, { local: state.store.mode === 'local' });
    if (edit.blob) validated.image = await state.store.upload(edit.blob);
    await state.store.save(validated, Boolean(edit.question)); $('edit-dialog').close(); await refresh(true); toast('문제를 저장했어요.');
  } catch (e) {
    $('edit-error').textContent = e.message;
    if (e.status === 401) { state.admin = false; renderAll(); }
  } finally { $('save-button').disabled = false; }
};
$('import-button').onclick = () => { $('import-file').value = ''; $('import-file').click(); };
$('import-file').onchange = async () => {
  const file = $('import-file').files[0]; if (!file || !state.admin || state.busy) return;
  if (file.size > 450 * 1024 * 1024) { toast('가져오기 파일은 450MB 이하여야 합니다.', true); return; }
  setBusy(true);
  try {
    const questions = parseImport(await file.text(), file.name);
    const ids = new Set(state.questions.map(q => q.id)), fresh = questions.filter(q => !ids.has(q.id)).length;
    if (!await confirm(`${fresh.toLocaleString()}개의 문제를 가져올까요?`, `총 ${questions.length.toLocaleString()}개 중 기존 ID ${questions.length - fresh}개는 건너뜁니다. 기존 문제를 덮어쓰지 않고 새 문제만 추가합니다.`, '가져오기')) return;
    const result = await state.store.import(questions, (n, total) => toast(`문제를 가져오고 있어요… ${n} / ${total}`, false, 60000));
    await refresh(true); toast(`${result.added}개 추가 · ${result.skipped}개 중복 건너뛰기`);
  } catch (e) { await refresh(true).catch(() => {}); requireAdmin(e); } finally { setBusy(false); }
};
$('export-button').onclick = async () => {
  if (state.busy) return; setBusy(true);
  try { toast('문제 파일을 준비하고 있어요…', false, 60000); downloadJson(await state.store.export(state.questions)); toast(`${state.questions.length}개 문제를 JSON으로 내보냈어요.`); }
  catch (e) { toast(e.message, true); } finally { setBusy(false); }
};
document.addEventListener('keydown', e => {
  if (state.view !== 'game' || document.querySelector('dialog[open]') || e.target.closest('input,textarea,select,[contenteditable=true]') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.code === 'Space' && e.target.closest('button')) return;
  const actions = { Space: toggleAnswer, ArrowRight: nextScene, ArrowLeft: () => { if (state.index) { state.index--; renderScene(); } }, KeyH: toggleHint, KeyF: fullscreen, KeyT: toggleTimer };
  if (actions[e.code]) { e.preventDefault(); actions[e.code](); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state.running) pauseTimer(); });
window.addEventListener('pagehide', pauseTimer);
connect();
