import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, validateQuestion, parseCsv, parseImport, csvExport, makeDeck, filterQuestions, uuid } from '../docs/js/core.js';

const fixture = (overrides = {}) => ({ id: 'scene-1', title: '테스트 작품', category: '국내 영화', answer: '기억할게, 이 장면을.\n언제까지나.', image: 'https://example.com/scene.webp', enabled: true, ...overrides });

test('randomUUID가 없는 브라우저도 중복 없는 ID로 문제를 등록할 수 있다', () => {
  const olderCrypto = { getRandomValues: bytes => crypto.getRandomValues(bytes) };
  const ids = Array.from({ length: 1000 }, () => uuid(olderCrypto));
  assert.equal(new Set(ids).size, 1000);
  for (const id of [uuid(), ...ids]) {
    assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.equal(validateQuestion(fixture({ id })).id, id);
  }
});

test('영상·만화·뉴스·밈을 검증하고 선택한 분류만 출제한다', () => {
  assert.deepEqual(CATEGORIES, ['국내 영화', '해외 영화', '국내 드라마', '해외 드라마', '국내 애니메이션', '해외 애니메이션', '국내 예능', '국내 교양', '국내 만화', '해외 만화', '국내 뉴스', '기타 밈']);
  const questions = CATEGORIES.map((category, i) => validateQuestion(fixture({ id: `type-${i}`, category })));
  for (const category of CATEGORIES) {
    assert.deepEqual(makeDeck(questions, { category, count: 'all' }).map(q => q.category), [category]);
    assert.equal(filterQuestions(questions, { category }).length, 1);
  }
  const imported = parseImport(csvExport(questions), 'all-types.csv');
  assert.deepEqual(imported.map(q => q.category), CATEGORIES);
});

test('구분 없는 이전 분류를 보존하고 국내·해외를 임의로 정하지 않는다', () => {
  const previous = ['영화', '드라마', '애니메이션'].map((category, i) => fixture({ id: `legacy-${i}`, category }));
  const imported = parseImport(JSON.stringify(previous), 'legacy.json');
  assert.deepEqual(imported.map(q => q.category), ['영화', '드라마', '애니메이션']);
  assert.equal(makeDeck(imported, { count: 'all' }).length, 3);
  assert.equal(makeDeck(imported, { category: '국내 영화' }).length, 0);
  for (const q of previous) {
    assert.equal(validateQuestion(q, { allowLegacyCategory: true }).category, q.category);
    assert.throws(() => validateQuestion(q), /분류/);
  }
});

test('한국어·여러 줄 대사·따옴표·BOM CSV를 손실 없이 가져온다', () => {
  const values = [fixture({ hint: '쉼표, 그리고 "따옴표"', source: '출처\n메모' }), fixture({ id: 'scene-2', category: '해외 애니메이션', enabled: false })];
  const imported = parseImport(csvExport(values), 'questions.csv');
  for (let i = 0; i < values.length; i++) for (const key of Object.keys(values[i])) assert.equal(imported[i][key], values[i][key], key);
});
test('CSV 열 개수 오류와 닫히지 않은 따옴표를 구체적으로 알려준다', () => {
  assert.throws(() => parseCsv('title,category,answer,image\nA,영화,"정답'), /큰따옴표/);
  assert.throws(() => parseCsv('title,category,answer,image\nA,영화,정답'), /2행/);
});
test('일괄 가져오기에서 전체를 검사하고 오류 행·중복 ID를 알려준다', () => {
  assert.throws(() => parseImport(JSON.stringify([fixture(), fixture({ id: 'scene-2', answer: '' })]), 'a.json'), /2번째.*정답/);
  assert.throws(() => parseImport(JSON.stringify([fixture(), fixture()]), 'a.json'), /중복/);
  assert.throws(() => parseImport('{}', 'a.json'), /문제가 없습니다/);
});
test('1,000개 문제를 파싱하고 중복 없는 게임 덱을 만든다', () => {
  const data = Array.from({ length: 1000 }, (_, i) => fixture({ id: `scene-${i}`, enabled: i % 10 !== 0 }));
  const questions = parseImport(JSON.stringify({ questions: data }), 'a.json');
  const deck = makeDeck(questions, { count: 1000 });
  assert.equal(deck.length, 900); assert.equal(new Set(deck.map(q => q.id)).size, 900);
  assert.ok(deck.every(q => q.enabled));
  assert.equal(questions[0].id, 'scene-0'); // 원본 배열을 섞지 않습니다.
});
test('장르·출제 제외 조건을 지키고 부족한 문제 수를 줄인다', () => {
  const data = [fixture(), fixture({ id: '2', category: '해외 드라마' }), fixture({ id: '3' }), fixture({ id: '4', enabled: false })];
  assert.equal(makeDeck(data, { category: '국내 영화', count: 10 }).length, 2);
  assert.equal(makeDeck(data, { count: 'all' }).length, 3);
  assert.equal(filterQuestions(data, { search: '기억할게' }).length, 4);
  assert.notEqual(makeDeck(data)[0], data[0]);
});
test('이전 난이도 값이 있는 JSON·CSV도 읽고 새 데이터에서는 난이도를 제외한다', () => {
  const legacy = fixture({ difficulty: '이전 버전의 값' });
  assert.equal(Object.hasOwn(validateQuestion(legacy), 'difficulty'), false);
  assert.equal(Object.hasOwn(parseImport(JSON.stringify([legacy]), 'legacy.json')[0], 'difficulty'), false);
  const csv = 'id,title,category,difficulty,answer,image\nold,작품,영화,어려움,정답,https://example.com/scene.webp';
  const imported = parseImport(csv, 'legacy.csv');
  assert.equal(imported.length, 1);
  assert.equal(Object.hasOwn(imported[0], 'difficulty'), false);
  assert.equal(csvExport(imported).includes('difficulty'), false);
});
test('실행 가능한 이미지 주소·잘못된 분류·연도·버전을 거부한다', () => {
  for (const image of ['javascript:alert(1)', 'http://example.com/a.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', 'https://user:password@example.com/a.jpg', './assets/../../a.jpg']) assert.throws(() => validateQuestion(fixture({ image })), /이미지|정보/);
  assert.throws(() => validateQuestion(fixture({ category: '기타' })), /분류/);
  assert.throws(() => validateQuestion(fixture({ year: 'abc' })), /연도/);
  assert.throws(() => validateQuestion(fixture({ version: NaN })), /버전/);
});
test('기기 이미지와 내장 이미지는 기기 모드에서만 허용한다', () => {
  for (const image of ['local:abc-123', 'data:image/webp;base64,YWJj']) {
    assert.equal(validateQuestion(fixture({ image }), { local: true }).image, image);
    assert.throws(() => validateQuestion(fixture({ image })), /이미지/);
  }
});
