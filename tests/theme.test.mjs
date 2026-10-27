import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../docs/js/theme.js', import.meta.url), 'utf8');
function page({ dark = false, storage = new Map(), blocked = false, href = 'https://owner.github.io/game/' } = {}) {
  const events = {}, domEvents = {}, systemEvents = {};
  const buttons = Array.from({ length: 2 }, () => {
    const label = { textContent: '' }, attrs = {}, handlers = {};
    return { label, attrs, handlers, setAttribute: (key, value) => { attrs[key] = value; }, querySelector: () => label, addEventListener: (type, handler) => { handlers[type] = handler; } };
  });
  const meta = {};
  const document = { readyState: 'loading', documentElement: { dataset: {} }, querySelector: () => ({ setAttribute: (key, value) => { meta[key] = value; } }), querySelectorAll: () => buttons, addEventListener: (key, handler) => { domEvents[key] = handler; } };
  const media = { matches: dark, addEventListener: (key, handler) => { systemEvents[key] = handler; } };
  const window = { location: { href }, matchMedia: () => media, localStorage: { getItem: key => { if (blocked) throw Error('blocked'); return storage.get(key) ?? null; }, setItem: (key, value) => { if (blocked) throw Error('blocked'); storage.set(key, value); } }, addEventListener: (key, handler) => { events[key] = handler; } };
  runInNewContext(source, { window, document, URL });
  return { document, buttons, storage, meta, media, ready: () => domEvents.DOMContentLoaded(), system: value => { media.matches = value; systemEvents.change(); }, storageEvent: event => events.storage(event) };
}

test('처음에는 기기 모드를 따르고 수동 선택이 없으면 기기 변경도 따라간다', () => {
  const app = page(); assert.equal(app.document.documentElement.dataset.theme, 'light');
  app.ready(); app.system(true); assert.equal(app.document.documentElement.dataset.theme, 'dark');
  assert.equal(app.meta.content, '#101010');
});
test('수동 선택은 두 전환 버튼에 반영되고 새로고침·기기 설정 변경 후에도 유지된다', () => {
  const app = page(); app.ready(); app.buttons[0].handlers.click();
  assert.equal(app.document.documentElement.dataset.theme, 'dark');
  for (const button of app.buttons) { assert.equal(button.attrs['aria-pressed'], 'true'); assert.equal(button.label.textContent, '라이트 모드'); }
  app.system(false); assert.equal(app.document.documentElement.dataset.theme, 'dark');
  const reloaded = page({ storage: app.storage });
  assert.equal(reloaded.document.documentElement.dataset.theme, 'dark'); // 본문 준비 전 적용
  reloaded.ready(); reloaded.buttons[1].handlers.click();
  assert.equal(reloaded.document.documentElement.dataset.theme, 'light');
});
test('브라우저 저장이 차단되어도 라이트·다크를 바꿀 수 있다', () => {
  const app = page({ blocked: true, dark: true }); app.ready(); app.buttons[0].handlers.click();
  assert.equal(app.document.documentElement.dataset.theme, 'light'); assert.equal(app.meta.content, '#ffffff');
});
test('같은 계정의 다른 사이트에 테마 선택을 강제로 전달하지 않는다', () => {
  const app = page(); app.ready(); app.buttons[0].handlers.click();
  const clone = page({ storage: app.storage, href: 'https://owner.github.io/another-game/' });
  assert.equal(clone.document.documentElement.dataset.theme, 'light');
  clone.storageEvent({ key: 'scene-theme:https://owner.github.io/game/', newValue: 'dark' });
  assert.equal(clone.document.documentElement.dataset.theme, 'light');
});
