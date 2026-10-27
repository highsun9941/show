// CSS가 표시되기 전에 적용해 저장된 다크 모드에서 흰 화면이 번쩍이지 않게 합니다.
(() => {
  const key = `scene-theme:${new URL('.', window.location.href).href}`;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const valid = value => value === 'light' || value === 'dark';
  let preference = null;
  try { const saved = window.localStorage.getItem(key); if (valid(saved)) preference = saved; } catch { /* 저장이 차단되어도 전환은 동작합니다. */ }

  function apply() {
    const theme = preference || (system.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101010' : '#ffffff');
    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      const action = theme === 'dark' ? '라이트 모드' : '다크 모드';
      button.setAttribute('aria-label', `${action}로 전환`);
      button.setAttribute('title', `${action}로 전환`);
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      const label = button.querySelector('[data-theme-label]');
      if (label) label.textContent = action;
    }
  }

  function toggle() {
    preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { window.localStorage.setItem(key, preference); } catch { /* 이 페이지에서 선택한 모드는 유지합니다. */ }
    apply();
  }

  apply();
  function setup() {
    for (const button of document.querySelectorAll('[data-theme-toggle]')) button.addEventListener('click', toggle);
    apply();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
  if (system.addEventListener) system.addEventListener('change', () => { if (!preference) apply(); });
  else system.addListener(() => { if (!preference) apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : null;
    apply();
  });
})();
