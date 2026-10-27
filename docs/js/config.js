const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FILE_PATH = /^[A-Za-z0-9_./-]+$/;

export function repositoryFromPages(href) {
  const url = new URL(href);
  const match = url.hostname.match(/^([A-Za-z0-9-]+)\.github\.io$/i);
  if (!match) return '';
  const owner = match[1];
  const first = decodeURIComponent(url.pathname.split('/')[1] || '');
  const name = !first || first === 'index.html' ? `${owner}.github.io` : first;
  return REPOSITORY.test(`${owner}/${name}`) ? `${owner}/${name}` : '';
}

export function resolveConfig(settings = {}, deployment = {}, href) {
  const repository = String(settings.repository || deployment.repository || repositoryFromPages(href));
  if (repository && !REPOSITORY.test(repository)) throw new Error('repository는 계정/저장소 형식으로 지정해 주세요.');
  // 다른 저장소로 수동 연결할 때는 이전 배포본의 브랜치를 가져오지 않습니다.
  const sameRepository = repository.toLowerCase() === String(deployment.repository || '').toLowerCase();
  const branch = String(settings.branch || (sameRepository ? deployment.branch : '') || '');
  if (branch && /[\s?#[\]\\]/.test(branch)) throw new Error('branch 설정을 확인해 주세요.');
  const dataPath = String(settings.dataPath || 'docs/data/questions.json');
  const imageDirectory = String(settings.imageDirectory || 'docs/uploads');
  for (const path of [dataPath, imageDirectory]) {
    if (!FILE_PATH.test(path) || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('저장소의 파일 경로 설정을 확인해 주세요.');
  }
  const root = new URL('.', href).href;
  return Object.freeze({ repository, branch, dataPath, imageDirectory, siteScope: root });
}

export async function loadConfig(settings, href, fetcher = fetch) {
  // Actions 배포 시 이 파일에 현재 저장소·브랜치만 기록합니다. 비밀 키는 없습니다.
  let deployment = {};
  try {
    const response = await fetcher(new URL('./deployment.json', href).href, { cache: 'no-store' });
    if (response.ok) deployment = await response.json();
  } catch { /* 브랜치 직접 배포와 로컬 실행은 주소/명시적 설정으로 판단합니다. */ }
  return resolveConfig(settings, deployment || {}, href);
}

export function repositoryLinks(config) {
  if (!config.repository) return {};
  const root = `https://github.com/${config.repository}`;
  return { readme: `${root}/blob/${encodeURIComponent(config.branch || 'HEAD')}/README.md`, pages: `${root}/settings/pages`, actions: `${root}/actions` };
}
