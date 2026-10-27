export const CATEGORIES = ['국내 영화', '해외 영화', '국내 드라마', '해외 드라마', '국내 애니메이션', '해외 애니메이션'];
const LEGACY_CATEGORIES = ['영화', '드라마', '애니메이션'];
export const MAX_IMAGE_BYTES = 300 * 1024;
export const MAX_QUESTIONS = 5000;
export const uuid = () => crypto.randomUUID();

export function validateQuestion(input, { local = false, allowLegacyCategory = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('문제 형식을 확인해 주세요.');
  const field = (name, limit, required = false) => {
    const v = String(input[name] ?? '').trim();
    if (required && !v) throw new Error(`${{ title: '작품명', answer: '정답 대사', image: '장면 이미지' }[name] || name}을 입력해 주세요.`);
    if (v.length > limit) throw new Error(`${name}은 ${limit}자 이내로 입력해 주세요.`);
    return v;
  };
  const id = String(input.id || uuid());
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('문제 ID는 영문·숫자·밑줄·하이픈 80자 이내여야 합니다.');
  const category = field('category', 20);
  if (!CATEGORIES.includes(category) && !(allowLegacyCategory && LEGACY_CATEGORIES.includes(category))) throw new Error(`분류는 ${CATEGORIES.join(', ')} 중 하나를 선택해 주세요.`);
  const image = field('image', 450000, true);
  const remote = /^https:\/\/[^\s]+$/i.test(image);
  const asset = /^\.\/(assets|uploads)\/[a-zA-Z0-9/_\-.]+$/.test(image) && !image.includes('..');
  const stored = local && /^local:[a-zA-Z0-9_-]{1,80}$/.test(image);
  const embedded = local && /^data:image\/(webp|png|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(image);
  if (!(remote || asset || stored || embedded)) throw new Error('이미지는 HTTPS 주소 또는 ./uploads/파일명 경로여야 합니다.');
  if (remote) {
    const u = new URL(image);
    if (u.username || u.password) throw new Error('인증 정보가 포함된 이미지 주소는 사용할 수 없습니다.');
  }
  const year = field('year', 4);
  if (year && !/^\d{4}$/.test(year)) throw new Error('연도는 네 자리 숫자로 입력해 주세요.');
  const version = Number(input.version ?? 1);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('문제 버전이 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.');
  const now = new Date().toISOString();
  return {
    id, title: field('title', 150, true), category, year,
    answer: field('answer', 2000, true), hint: field('hint', 300), image,
    source: field('source', 1000), enabled: input.enabled !== false && input.enabled !== 'false',
    demo: input.demo === true, version,
    createdAt: String(input.createdAt || now), updatedAt: now,
  };
}

export function filterQuestions(questions, { search = '', category = '전체', activeOnly = false } = {}) {
  const term = search.trim().toLocaleLowerCase();
  return questions.filter(q => (!activeOnly || q.enabled) && (category === '전체' || q.category === category)
    && (!term || `${q.title} ${q.answer} ${q.hint} ${q.year}`.toLocaleLowerCase().includes(term)));
}

export function makeDeck(questions, { category = '전체', count = 10, random = true } = {}) {
  const deck = filterQuestions(questions, { category, activeOnly: true }).map(q => ({ ...q }));
  if (!random) deck.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  if (random) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }
  return deck.slice(0, count === 'all' ? deck.length : Math.max(1, Number(count) || 10));
}

// RFC 4180: 쉼표, 큰따옴표, 셀 안의 줄바꿈, UTF-8 BOM을 지원합니다.
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (!quoted && cell !== '') throw new Error('CSV 따옴표 형식이 올바르지 않습니다.');
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(cell); cell = '';
      if (c !== ',') {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else cell += c;
  }
  if (quoted) throw new Error('CSV에 닫히지 않은 큰따옴표가 있습니다.');
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  if (!rows.length) throw new Error('CSV 파일이 비어 있습니다.');
  const headers = rows.shift().map(h => h.trim());
  if (new Set(headers).size !== headers.length) throw new Error('CSV 열 이름이 중복되었습니다.');
  for (const required of ['title', 'category', 'answer', 'image']) {
    if (!headers.includes(required)) throw new Error(`CSV에 ${required} 열이 필요합니다.`);
  }
  return rows.map((values, i) => {
    if (values.length !== headers.length) throw new Error(`CSV ${i + 2}행의 열 개수를 확인해 주세요.`);
    return Object.fromEntries(headers.map((h, j) => [h, values[j]]));
  });
}

export function parseImport(text, filename) {
  let values;
  if (/\.csv$/i.test(filename)) values = parseCsv(text);
  else {
    try { values = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('JSON 형식을 확인해 주세요.'); }
    values = Array.isArray(values) ? values : values.questions;
  }
  if (!Array.isArray(values) || !values.length) throw new Error('가져올 문제가 없습니다.');
  if (values.length > MAX_QUESTIONS) throw new Error(`한 번에 최대 ${MAX_QUESTIONS}개까지 가져올 수 있습니다.`);
  const seen = new Set();
  return values.map((v, i) => {
    try {
      const q = validateQuestion(v, { local: true, allowLegacyCategory: true });
      if (seen.has(q.id)) throw new Error('같은 ID가 파일 안에 중복되었습니다.');
      seen.add(q.id); return q;
    } catch (e) { throw new Error(`${i + 1}번째 문제: ${e.message}`); }
  });
}

export function csvExport(questions) {
  const headers = ['id', 'title', 'category', 'year', 'answer', 'hint', 'image', 'source', 'enabled'];
  const quote = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return '\uFEFF' + [headers, ...questions.map(q => headers.map(k => q[k]))].map(row => row.map(quote).join(',')).join('\r\n');
}
