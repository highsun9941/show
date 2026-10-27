import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubStore, encodeBase64, decodeBase64 } from '../docs/js/storage.js';

const originalFetch = globalThis.fetch;
const sessions = new Map();
globalThis.sessionStorage = { getItem: k => sessions.get(k) || null, setItem: (k, v) => sessions.set(k, v), removeItem: k => sessions.delete(k) };
afterEach(() => { globalThis.fetch = originalFetch; sessions.clear(); });
const config = { repository: 'highsun9941/show', branch: 'main', dataPath: 'docs/data/questions.json', imageDirectory: 'docs/uploads' };
const fixture = (id = 'one', overrides = {}) => ({ id, title: '작품 💬', category: '영화', difficulty: '보통', year: '', answer: '우리의 다음 장면.\n안녕!', hint: '', source: '', image: './assets/scene-space.svg', version: 1, enabled: true, createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z', ...overrides });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const encoded = value => encodeBase64(new TextEncoder().encode(JSON.stringify(value)));
function fakeRepository(initial, { race, large = false } = {}) {
  let questions = structuredClone(initial), sha = 'head-1', raced = false;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === `https://api.github.com/repos/${config.repository}`) return json({ permissions: { push: true } });
    if (url.includes('/git/blobs/')) return json({ encoding: 'base64', content: encoded(questions) });
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      if (!raced && race) { questions = race(structuredClone(questions)); sha = 'raced-head'; raced = true; return json({ message: 'conflict' }, 409); }
      if (body.sha !== sha) return json({ message: 'conflict' }, 409);
      questions = JSON.parse(decodeBase64(body.content)); sha += '-next'; return json({ content: { sha }, commit: { sha: 'commit-sha' } });
    }
    return json({ sha, encoding: large ? 'none' : 'base64', content: large ? '' : encoded(questions) });
  };
  return { calls, get questions() { return questions; } };
}
function authenticated() { const store = new GitHubStore(config); store.token = 'fixture-token'; return store; }

test('큰 한국어 데이터를 UTF-8 base64로 왕복한다', () => {
  const text = '안녕 💬 "다음 장면"\n'.repeat(10000);
  assert.equal(decodeBase64(encodeBase64(new TextEncoder().encode(text))), text);
});
test('1MB 초과 문제은행은 같은 SHA의 blob으로 읽는다', async () => {
  const data = Array.from({ length: 1000 }, (_, i) => fixture(`q-${i}`, { answer: '가'.repeat(1500) }));
  const repo = fakeRepository(data, { large: true });
  const result = await authenticated().list();
  assert.equal(result.length, 1000); assert.equal(result[500].answer.length, 1500);
  assert.equal(repo.calls.length, 2); assert.match(repo.calls[1].url, /\/git\/blobs\/head-1$/);
});
test('다른 문제를 동시에 수정하면 최신 변경과 합쳐 재시도한다', async () => {
  const repo = fakeRepository([fixture('one'), fixture('two')], { race: list => list.map(q => q.id === 'two' ? { ...q, answer: '다른 사람의 정답', version: 2 } : q) });
  const result = await authenticated().save(fixture('one', { answer: '내 수정 내용' }), true);
  assert.equal(result.version, 2);
  assert.equal(repo.questions.find(q => q.id === 'one').answer, '내 수정 내용');
  assert.equal(repo.questions.find(q => q.id === 'two').answer, '다른 사람의 정답');
  assert.equal(repo.calls.filter(c => c.options.method === 'PUT').length, 2);
});
test('같은 문제의 동시 수정은 덮어쓰지 않는다', async () => {
  const repo = fakeRepository([fixture()], { race: list => list.map(q => ({ ...q, answer: '먼저 저장한 대사', version: 2 })) });
  await assert.rejects(authenticated().save(fixture('one', { answer: '뒤늦은 대사' }), true), error => error.status === 409);
  assert.equal(repo.questions[0].answer, '먼저 저장한 대사');
  assert.equal(repo.calls.filter(c => c.options.method === 'PUT').length, 1);
});
test('삭제도 버전을 확인하고 다른 사람의 수정 내용을 보존한다', async () => {
  const repo = fakeRepository([fixture('one', { version: 2 }), fixture('two')]);
  await assert.rejects(authenticated().remove(fixture()), error => error.status === 409);
  assert.equal(repo.questions.length, 2);
  await authenticated().remove(fixture('one', { version: 2 })); assert.equal(repo.questions.length, 1); assert.equal(repo.questions[0].id, 'two');
});
test('1,000개 가져오기를 한 커밋으로 처리하고 기존 ID는 건너뛴다', async () => {
  const repo = fakeRepository([fixture('q-0', { answer: '기존 정답' })]);
  const data = Array.from({ length: 1000 }, (_, i) => fixture(`q-${i}`));
  const result = await authenticated().import(data);
  assert.deepEqual(result, { added: 999, skipped: 1 }); assert.equal(repo.questions.length, 1000);
  assert.equal(repo.questions[0].answer, '기존 정답');
  assert.equal(repo.calls.filter(c => c.options.method === 'PUT').length, 1);
});
test('내장 이미지가 든 GitHub 일괄 가져오기는 쓰기 전에 중단한다', async () => {
  const repo = fakeRepository([]);
  await assert.rejects(authenticated().import([fixture('a', { image: 'data:image/webp;base64,YWJj' })]), /HTTPS/);
  assert.equal(repo.calls.length, 0);
});
test('저장용 키가 없으면 쓰기 요청을 보내지 않는다', async () => {
  const repo = fakeRepository([]);
  await assert.rejects(new GitHubStore(config).save(fixture()), error => error.status === 401);
  assert.equal(repo.calls.length, 0);
});
test('로그인한 키는 탭 세션에만 보관하고 로그아웃 때 지운다', async () => {
  fakeRepository([fixture()]);
  const store = new GitHubStore(config); await store.login('fixture-token');
  assert.equal(sessions.get(store.key), 'fixture-token');
  assert.equal(await new GitHubStore(config).checkSession(), true);
  await store.logout(); assert.equal(store.token, ''); assert.equal(sessions.size, 0);
});
test('401 인증 오류는 저장된 키도 지운다', async () => {
  const store = authenticated(); sessions.set(store.key, 'fixture-token'); globalThis.fetch = async () => json({ message: 'Bad credentials' }, 401);
  await assert.rejects(store.readCurrent(), error => error.status === 401); assert.equal(store.token, ''); assert.equal(sessions.size, 0);
});
test('공개 API 제한 시 배포본으로 플레이하되 상태를 표시한다', async () => {
  globalThis.fetch = async url => url.startsWith('https://api.github.com/') ? json({}, 403, { 'x-ratelimit-remaining': '0' }) : json([fixture()]);
  const store = new GitHubStore(config); assert.equal((await store.list()).length, 1); assert.equal(store.stale, true);
});
test('이미지는 한 번 올린 뒤 공개 raw 주소를 쓰며 토큰을 주소에 넣지 않는다', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return json({ content: { sha: 'image-sha' } }); };
  const image = await authenticated().upload(new Blob(['fixture-image'], { type: 'image/webp' }));
  assert.match(image, /^https:\/\/raw\.githubusercontent\.com\/highsun9941\/show\/main\/docs\/uploads\/.+\.webp$/);
  assert.ok(!image.includes('fixture-token')); assert.equal(calls.length, 1);
  assert.equal(atob(calls[0].body.content), 'fixture-image');
});
