import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaySession, PlayHistoryStore, appendHistory } from '../docs/js/play-history.js';

const settings = { category: '전체', total: 10, timer: 30, order: 'random' };
const scene = (id, overrides = {}) => ({ id, title: '작품', category: '국내 영화', year: '2026', answer: '기억할 대사\n두 번째 줄', image: './uploads/original.jpg', ...overrides });
function round(id) {
  const session = new PlaySession(settings, { id });
  session.record(scene('q1'), 1, 'https://example.test/original.jpg');
  return session.finish('stopped');
}

test('실제로 표시한 문제만 첫 출제 순서로 보존하고 이전 문제 재방문은 중복 저장하지 않는다', () => {
  const session = new PlaySession(settings, { id: 'round-1' });
  const deck = [scene('a'), scene('b'), scene('c')];
  session.record(deck[0], 1, 'https://example.test/a.jpg');
  session.record(deck[1], 2, 'https://example.test/b.jpg');
  session.record(deck[0], 1, 'https://example.test/a.jpg');
  const saved = session.finish('stopped');
  assert.deepEqual(saved.scenes.map(q => q.id), ['a', 'b']);
  assert.deepEqual(saved.scenes.map(q => q.position), [1, 2]);
  assert.equal(saved.settings.total, 10);
  session.record(deck[2], 3, 'https://example.test/c.jpg');
  assert.deepEqual(session.finish('completed'), saved, 'Ending twice or a late image load cannot alter the round');
});

test('게임 당시의 작품명·대사·이미지 주소를 복사하고 모드 전환이나 이후 편집의 영향을 받지 않는다', () => {
  const config = { ...settings, token: 'never-save-this', store: { secret: 'never-save-this' } };
  const session = new PlaySession(config, { id: 'snapshot', startedAt: '2026-10-28T09:00:00Z' });
  const question = scene('a', { source: 'private metadata', token: 'never-save-this' });
  session.record(question, 1, 'https://raw.githubusercontent.com/owner/game/main/docs/uploads/a.jpg');
  question.title = '수정된 작품'; question.answer = '바뀐 정답'; config.category = '국내 드라마';
  const saved = session.finish('completed', '2026-10-28T09:01:00Z');
  assert.equal(saved.status, 'completed'); assert.equal(saved.startedAt, '2026-10-28T09:00:00Z');
  assert.equal(saved.endedAt, '2026-10-28T09:01:00Z');
  assert.equal(saved.settings.category, '전체'); assert.equal(saved.scenes[0].title, '작품');
  assert.equal(saved.scenes[0].answer, '기억할 대사\n두 번째 줄');
  assert.match(saved.scenes[0].image, /^https:\/\/raw\.githubusercontent\.com/);
  assert.ok(!JSON.stringify(saved).includes('never-save-this'));
  assert.equal(saved.scenes[0].source, undefined);
  saved.scenes[0].answer = '외부 수정';
  assert.equal(session.finish('completed').scenes[0].answer, '기억할 대사\n두 번째 줄');
});

test('한 장도 표시하지 못한 게임은 빈 회차로 저장하지 않으며 기기 이미지 참조는 보존한다', () => {
  const session = new PlaySession(settings);
  assert.equal(session.finish('stopped'), null);
  assert.throws(() => appendHistory({ nextNumber: 1, rounds: [] }, null), /기록/);
  const local = new PlaySession(settings);
  local.record(scene('local'), 1, 'local:original-id');
  assert.equal(local.finish('stopped').scenes[0].image, 'local:original-id');
});

test('12회차를 저장하면 3~12회차만 남고 새로 열어도 번호는 13회차로 이어진다', () => {
  let stored = { nextNumber: 1, rounds: [] };
  for (let i = 1; i <= 12; i++) stored = appendHistory(stored, round(`r-${i}`));
  assert.deepEqual(stored.rounds.map(r => r.number), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  assert.equal(stored.nextNumber, 13);
  const reloaded = structuredClone(stored);
  const next = appendHistory(reloaded, round('r-13'));
  assert.equal(next.rounds[0].number, 13);
  assert.equal(next.rounds.at(-1).number, 4);
  assert.equal(stored.rounds[0].number, 12, 'Updating storage does not mutate existing snapshots');
});

test('저장 재시도는 같은 회차를 두 번 만들거나 회차 번호를 올리지 않는다', () => {
  const input = round('same');
  const first = appendHistory({ nextNumber: 1, rounds: [] }, input);
  const second = appendHistory(first, input);
  assert.deepEqual(second, first);
});

test('사이트별로 기록을 분리하고 저장소가 차단되면 성공으로 처리하지 않는다', async () => {
  const unavailable = () => { throw new Error('blocked'); };
  const one = new PlayHistoryStore('https://owner.github.io/game/', unavailable);
  const two = new PlayHistoryStore('https://owner.github.io/clone/', unavailable);
  assert.notEqual(one.databaseName, two.databaseName);
  await assert.rejects(one.save(round('no-storage')), /저장소/);
  await assert.rejects(one.list(), /저장소/);
});
