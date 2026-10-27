import { validateQuestion, MAX_IMAGE_BYTES, MAX_QUESTIONS, uuid } from './core.js';

export class StoreError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

let dbPromise;
function openDB() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('ezen-one-scene', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('questions', { keyPath: 'id' });
      req.result.createObjectStore('images', { keyPath: 'id' });
      req.result.createObjectStore('settings');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = undefined; reject(new StoreError('기기 저장소를 열 수 없습니다. 브라우저의 저장 공간 설정을 확인해 주세요.')); };
  });
  return dbPromise;
}
async function read(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = key === undefined ? db.transaction(store).objectStore(store).getAll() : db.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
function completed(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(new StoreError('저장하지 못했습니다. 저장 공간 또는 다른 창에서의 변경을 확인해 주세요.'));
    tx.onerror = () => {}; // 최종 결과는 abort/complete에서 처리합니다.
  });
}
const objectUrls = new Map();

export class LocalStore {
  mode = 'local';
  async init() {
    if (!await read('settings', 'seeded')) {
      const response = await fetch('./data/questions.json');
      if (!response.ok) throw new StoreError('샘플 문제를 불러오지 못했습니다.');
      const sample = (await response.json()).map(q => validateQuestion(q, { local: true }));
      const db = await openDB(), tx = db.transaction(['questions', 'settings'], 'readwrite');
      const done = completed(tx);
      sample.forEach(q => tx.objectStore('questions').put(q));
      tx.objectStore('settings').put(true, 'seeded'); await done;
    }
  }
  async list() { return (await read('questions')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async imageUrl(value) {
    if (!value.startsWith('local:')) return value;
    if (objectUrls.has(value)) return objectUrls.get(value);
    const record = await read('images', value.slice(6));
    if (!record) return '';
    const url = URL.createObjectURL(record.blob); objectUrls.set(value, url); return url;
  }
  async upload(blob) {
    if (blob.size > MAX_IMAGE_BYTES) throw new StoreError('이미지는 300KB 이하여야 합니다.');
    const id = uuid(), db = await openDB(), tx = db.transaction('images', 'readwrite');
    const done = completed(tx); tx.objectStore('images').add({ id, blob }); await done;
    return `local:${id}`;
  }
  async save(input, existing = false) {
    const q = validateQuestion(input, { local: true });
    const db = await openDB(), tx = db.transaction('questions', 'readwrite'), store = tx.objectStore('questions');
    let conflict = false, full = false;
    const done = completed(tx);
    const req = store.get(q.id);
    req.onsuccess = () => {
      if ((existing && (!req.result || req.result.version !== q.version)) || (!existing && req.result)) { conflict = true; tx.abort(); return; }
      q.version = existing ? q.version + 1 : 1;
      if (existing) store.put(q);
      else {
        const count = store.count(); count.onsuccess = () => {
          if (count.result >= MAX_QUESTIONS) { full = true; tx.abort(); } else store.add(q);
        };
      }
    };
    try { await done; } catch (e) {
      if (conflict) throw new StoreError('다른 창에서 이 문제가 변경되었습니다. 창을 닫고 새로고침한 뒤 다시 수정해 주세요.', 409);
      if (full) throw new StoreError(`최대 ${MAX_QUESTIONS}개까지 등록할 수 있습니다.`);
      throw e;
    }
    return q;
  }
  async remove(q) {
    const db = await openDB(), tx = db.transaction('questions', 'readwrite'), store = tx.objectStore('questions');
    let conflict = false; const done = completed(tx);
    const req = store.get(q.id);
    req.onsuccess = () => {
      if (!req.result || req.result.version !== q.version) { conflict = true; tx.abort(); }
      else store.delete(q.id);
    };
    try { await done; } catch (e) { if (conflict) throw new StoreError('이 문제가 변경되었습니다. 새로고침 후 다시 삭제해 주세요.', 409); throw e; }
  }
  async import(questions, progress) {
    const existing = new Set((await this.list()).map(q => q.id));
    const fresh = questions.filter(q => !existing.has(q.id));
    if (existing.size + fresh.length > MAX_QUESTIONS) throw new StoreError(`최대 ${MAX_QUESTIONS}개까지 등록할 수 있습니다.`);
    // 이미지 업로드는 메타데이터 트랜잭션 전에 수행합니다. 중복 ID는 덮어쓰지 않습니다.
    const normalized = [];
    for (const [i, input] of fresh.entries()) {
      let image = input.image;
      if (image.startsWith('data:')) image = await this.upload(await (await fetch(image)).blob());
      if (image.startsWith('local:') && !await read('images', image.slice(6))) throw new StoreError('이 기기에 없는 이미지입니다. JSON 내보내기로 만든 파일을 이용해 주세요.');
      normalized.push(validateQuestion({ ...input, image, version: 1 }, { local: true }));
      progress?.(i + 1, fresh.length);
    }
    const db = await openDB(), tx = db.transaction('questions', 'readwrite'), done = completed(tx);
    normalized.forEach(q => tx.objectStore('questions').add(q)); await done;
    return { added: normalized.length, skipped: questions.length - normalized.length };
  }
  async export(questions) {
    return Promise.all(questions.map(async q => {
      if (!q.image.startsWith('local:')) return { ...q };
      const record = await read('images', q.image.slice(6));
      if (!record) throw new StoreError(`${q.title}: 이미지를 찾을 수 없어 내보내기를 중단했습니다.`);
      const image = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(record.blob);
      });
      return { ...q, image };
    }));
  }
}

export function encodeBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodeBase64(value) {
  return new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\s/g, '')), c => c.charCodeAt(0)));
}

// 별도 서버 없이 GitHub Contents API로 저장합니다. 토큰은 이 탭의 세션에만 보관합니다.
export class GitHubStore {
  mode = 'shared';
  stale = false;
  constructor(config) {
    this.config = config;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository)) throw new StoreError('저장소 설정을 확인해 주세요.');
    this.base = `https://api.github.com/repos/${config.repository}`;
    this.key = `show-github:${config.repository}:${config.branch}`;
    try { this.token = sessionStorage.getItem(this.key) || ''; } catch { this.token = ''; }
  }
  path(value) { return value.split('/').map(encodeURIComponent).join('/'); }
  async request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${this.base}${path}`, {
        method, signal: controller.signal, cache: 'no-store',
        headers: { Accept: path.startsWith('/contents/') && method === 'GET' ? 'application/vnd.github.object+json' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        if (response.status === 401) this.clearSession();
        const rate = response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
        const message = response.status === 401 ? '저장용 키가 만료되었거나 올바르지 않습니다. 다시 로그인해 주세요.'
          : rate ? 'GitHub 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요. 저장용 키로 로그인하면 읽기 한도가 늘어납니다.'
          : response.status === 403 ? '이 저장소에 쓰기 권한이 있는 키가 필요합니다. Contents: Read and write 설정을 확인해 주세요.'
          : response.status === 404 ? '저장소나 문제 파일에 접근할 수 없습니다. 저장용 키의 저장소 선택을 확인해 주세요.'
          : response.status === 409 || response.status === 422 ? '다른 편집 내용과 충돌했습니다. 새로고침 후 다시 시도해 주세요.' : 'GitHub에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
        throw new StoreError(message, response.status);
      }
      return await response.json();
    } catch (e) {
      if (e instanceof StoreError) throw e;
      throw new StoreError('GitHub에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.');
    } finally { clearTimeout(timer); }
  }
  async init() {}
  async readCurrent() {
    const path = `/contents/${this.path(this.config.dataPath)}`;
    const meta = await this.request(`${path}?ref=${encodeURIComponent(this.config.branch)}`);
    // 1MB보다 큰 Contents 응답은 본문이 없으므로 동일 SHA의 Git blob을 읽습니다.
    let content;
    if (meta.encoding === 'base64') content = decodeBase64(meta.content);
    else {
      const blob = await this.request(`/git/blobs/${encodeURIComponent(meta.sha)}`);
      if (blob.encoding !== 'base64') throw new StoreError('문제 파일을 읽을 수 없습니다.');
      content = decodeBase64(blob.content);
    }
    let questions;
    try { const data = JSON.parse(content); questions = Array.isArray(data) ? data : data.questions; } catch { throw new StoreError('저장된 문제 JSON이 올바르지 않습니다. 저장소 파일을 확인해 주세요.'); }
    if (!Array.isArray(questions)) throw new StoreError('저장된 문제 목록 형식이 올바르지 않습니다.');
    // 읽기에서 updatedAt을 바꾸지 않습니다. 버전은 저장 시에만 증가합니다.
    return { questions: questions.map(q => ({ ...validateQuestion(q), updatedAt: q.updatedAt || q.createdAt || '' })), sha: meta.sha };
  }
  async list() {
    try { const { questions } = await this.readCurrent(); this.stale = false; return questions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
    catch (e) {
      if (this.token || e.status === 401) throw e;
      // 공개 API 한도/네트워크 문제 시 마지막 Pages 배포본으로 플레이할 수 있습니다.
      const response = await fetch('./data/questions.json', { cache: 'no-store' });
      if (!response.ok) throw e;
      this.stale = true;
      const data = await response.json();
      return (Array.isArray(data) ? data : data.questions).map(q => validateQuestion(q));
    }
  }
  async imageUrl(value) { return value; }
  async login(token) {
    token = token.trim();
    if (!token || /\s/.test(token)) throw new StoreError('저장용 GitHub 키를 입력해 주세요.');
    this.token = token;
    try {
      const repo = await this.request('');
      if (repo.permissions?.push === false) throw new StoreError('이 키에는 저장소 쓰기 권한이 없습니다.');
      await this.readCurrent();
      try { sessionStorage.setItem(this.key, token); } catch { /* 이 탭의 메모리에서만 유지 */ }
    } catch (e) { this.clearSession(); throw e; }
  }
  async checkSession() {
    if (!this.token) return false;
    try { await this.request(''); return true; } catch (e) { if (e.status === 401 || e.status === 403 || e.status === 404) { this.clearSession(); return false; } throw e; }
  }
  clearSession() { this.token = ''; try { sessionStorage.removeItem(this.key); } catch { /* 무시 */ } }
  async logout() { this.clearSession(); }
  async writeQuestions(mutate, message) {
    if (!this.token) throw new StoreError('저장용 키로 먼저 로그인해 주세요.', 401);
    // 최신 목록에서 한 문제만 변경합니다. 서로 다른 문제를 동시에 수정하면 재시도해 합칩니다.
    // 같은 문제의 version이 달라졌으면 사용자의 입력을 보존하고 409로 중단합니다.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { questions, sha } = await this.readCurrent();
      const { next, result } = mutate(questions);
      if (next.length > MAX_QUESTIONS) throw new StoreError(`최대 ${MAX_QUESTIONS}개까지 등록할 수 있습니다.`);
      const content = encodeBase64(new TextEncoder().encode(JSON.stringify(next, null, 2) + '\n'));
      try {
        await this.request(`/contents/${this.path(this.config.dataPath)}`, { method: 'PUT', body: { message, content, sha, branch: this.config.branch } });
        return result;
      } catch (e) { if (!(e.status === 409 || e.status === 422) || attempt === 2) throw e; }
    }
  }
  async upload(blob) {
    if (!this.token) throw new StoreError('저장용 키로 먼저 로그인해 주세요.', 401);
    if (blob.size > MAX_IMAGE_BYTES || !['image/webp', 'image/png', 'image/jpeg'].includes(blob.type)) throw new StoreError('이미지는 JPG·PNG·WebP 형식의 300KB 이하여야 합니다.');
    const ext = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[blob.type];
    const path = `${this.config.imageDirectory}/${uuid()}.${ext}`;
    const body = { message: '장면 이미지 추가', content: encodeBase64(new Uint8Array(await blob.arrayBuffer())), branch: this.config.branch };
    await this.request(`/contents/${this.path(path)}`, { method: 'PUT', body });
    // 새 파일마다 고유한 주소를 사용하므로 Pages 재배포 전에 바로 이미지를 볼 수 있습니다.
    return `https://raw.githubusercontent.com/${this.config.repository}/${encodeURIComponent(this.config.branch)}/${this.path(path)}`;
  }
  async save(input, existing = false) {
    const q = validateQuestion(input);
    return this.writeQuestions(questions => {
      const current = questions.find(v => v.id === q.id);
      if (existing ? !current || current.version !== q.version : Boolean(current)) throw new StoreError('다른 사람이 이 문제를 변경했습니다. 입력 내용을 복사해 둔 뒤 창을 닫고 새로고침해 주세요.', 409);
      const saved = { ...q, version: existing ? q.version + 1 : 1 };
      return { next: existing ? questions.map(v => v.id === q.id ? saved : v) : [...questions, saved], result: saved };
    }, `${existing ? '문제 수정' : '문제 추가'}: ${q.title}`);
  }
  async remove(q) {
    return this.writeQuestions(questions => {
      const current = questions.find(v => v.id === q.id);
      if (!current || current.version !== q.version) throw new StoreError('이 문제가 변경되었습니다. 새로고침 후 다시 삭제해 주세요.', 409);
      return { next: questions.filter(v => v.id !== q.id) };
    }, `문제 삭제: ${q.title}`);
  }
  async import(questions, progress) {
    // 약 1,000개의 메타데이터도 한 번의 커밋으로 저장합니다.
    // 이미지가 내장된 큰 백업은 먼저 기기 모드에서 불러오고, URL 기반 CSV/JSON을 사용하세요.
    const seen = new Set();
    const normalized = questions.map(q => {
      if (seen.has(q.id)) throw new StoreError('같은 ID가 가져오기 목록 안에 중복되었습니다.');
      seen.add(q.id);
      if (q.image.startsWith('data:') || q.image.startsWith('local:')) throw new StoreError('GitHub 일괄 가져오기에는 HTTPS 이미지 주소가 필요합니다. 이미지가 내장된 백업은 이 기기 체험 모드에서 가져올 수 있어요.');
      return validateQuestion({ ...q, version: 1 });
    });
    progress?.(0, normalized.length);
    const result = await this.writeQuestions(current => {
      const ids = new Set(current.map(q => q.id)), fresh = normalized.filter(q => !ids.has(q.id));
      return { next: [...current, ...fresh], result: { added: fresh.length, skipped: normalized.length - fresh.length } };
    }, `문제 일괄 가져오기 (${normalized.length}개)`);
    progress?.(result.added, normalized.length); return result;
  }
  async export(questions) { return questions.map(q => ({ ...q })); }
}
