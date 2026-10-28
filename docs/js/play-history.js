import { uuid } from './core.js';

export const HISTORY_LIMIT = 10;
const copy = value => structuredClone(value);

// Only displayed scenes enter a round. Preloads, unseen cards, and revisits do not.
export class PlaySession {
  constructor(settings, { id = uuid(), startedAt = new Date().toISOString() } = {}) {
    this.id = id;
    this.startedAt = startedAt;
    this.settings = {
      category: String(settings.category), total: Number(settings.total),
      timer: Number(settings.timer), order: String(settings.order),
    };
    this.scenes = new Map();
    this.ended = null;
  }
  record(question, position, image) {
    if (this.ended || this.scenes.has(question.id)) return;
    // Whitelist the snapshot fields; store connections and credentials never enter history.
    const scene = { position, id: question.id, title: question.title, category: question.category,
      year: question.year || '', answer: question.answer, image };
    this.scenes.set(question.id, copy(scene));
  }
  finish(status, endedAt = new Date().toISOString()) {
    if (!this.ended) this.ended = { id: this.id, startedAt: this.startedAt, endedAt, status,
      settings: copy(this.settings), scenes: [...this.scenes.values()].map(copy) };
    return this.ended.scenes.length ? copy(this.ended) : null;
  }
}

export function appendHistory(current, round) {
  if (!round?.id || !Array.isArray(round.scenes) || !round.scenes.length) throw new Error('저장할 플레이 기록이 없습니다.');
  if (!current || !Array.isArray(current.rounds) || !Number.isSafeInteger(current.nextNumber) || current.nextNumber < 1) throw new Error('플레이 기록을 읽을 수 없습니다.');
  const existing = current.rounds.find(item => item.id === round.id);
  const number = existing?.number || Math.max(current.nextNumber, ...current.rounds.map(item => item.number + 1));
  const saved = { ...copy(round), number };
  const rounds = [...current.rounds.filter(item => item.id !== round.id), saved].sort((a, b) => b.number - a.number).slice(0, HISTORY_LIMIT);
  return { nextNumber: Math.max(current.nextNumber, number + 1), rounds };
}

// A separate database keeps history local in both GitHub and device question modes.
// The one read/write transaction also allocates round numbers and trims old rounds.
export class PlayHistoryStore {
  constructor(siteScope, indexedDBFactory = () => indexedDB) {
    this.databaseName = `show-play-history:${siteScope}`;
    this.indexedDBFactory = indexedDBFactory;
  }
  async open() {
    if (!this.database) this.database = new Promise((resolve, reject) => {
      let request;
      try { request = this.indexedDBFactory().open(this.databaseName, 1); }
      catch { reject(new Error('이 브라우저에서 플레이 기록 저장소를 열 수 없습니다.')); return; }
      request.onupgradeneeded = () => request.result.createObjectStore('history');
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); this.database = null; };
        resolve(db);
      };
      request.onerror = () => reject(new Error('이 브라우저에서 플레이 기록 저장소를 열 수 없습니다.'));
      request.onblocked = () => reject(new Error('다른 탭을 닫은 뒤 플레이 기록을 다시 불러와 주세요.'));
    }).catch(error => { this.database = null; throw error; });
    return this.database;
  }
  async access(round) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('history', round ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('history');
      let result, failure;
      const request = store.get('recent');
      request.onsuccess = () => {
        try {
          const current = request.result || { nextNumber: 1, rounds: [] };
          if (!Array.isArray(current.rounds)) throw new Error('플레이 기록을 읽을 수 없습니다.');
          if (round) {
            const next = appendHistory(current, round);
            store.put(next, 'recent');
            result = next.rounds.find(item => item.id === round.id);
          } else result = current.rounds;
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure || new Error(round ? '플레이 기록을 저장하지 못했어요. 브라우저 저장 공간을 확인하고 다시 시도해 주세요.' : '플레이 기록을 불러오지 못했어요. 다시 시도해 주세요.'));
      transaction.onerror = () => {}; // Abort reports read and write failures without a false success.
    });
  }
  list() { return this.access(); }
  save(round) { return this.access(round); }
}
