import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolveConfig } from '../docs/js/config.js';

export function deploymentConfig(env) {
  const repository = env.GITHUB_REPOSITORY || '';
  const branch = env.GITHUB_REF_NAME || '';
  if (!repository || !branch) throw new Error('GitHub Actions의 GITHUB_REPOSITORY와 GITHUB_REF_NAME이 필요합니다.');
  resolveConfig({ repository, branch }, {}, 'https://example.invalid/');
  return { repository, branch };
}

// 테스트에서 import할 때는 파일을 변경하지 않습니다.
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const deployment = deploymentConfig(process.env);
  await writeFile(new URL('../docs/deployment.json', import.meta.url), JSON.stringify(deployment, null, 2) + '\n');
  // HTML과 의존 모듈을 같은 배포 버전으로 읽어 이전 코드와 새 데이터가 섞이지 않게 합니다.
  const revision = process.env.GITHUB_SHA;
  if (revision) {
    if (!/^[a-f0-9]{40}$/i.test(revision)) throw new Error('GITHUB_SHA 형식을 확인해 주세요.');
    const jsRoot = new URL('../docs/js/', import.meta.url);
    for (const name of (await readdir(jsRoot)).filter(name => name.endsWith('.js'))) {
      const file = new URL(name, jsRoot);
      const source = await readFile(file, 'utf8');
      await writeFile(file, source.replace(/(\bfrom\s*['"])(\.[^'"?]+\.js)(?:\?v=[a-f0-9]+)?(['"])/gi, `$1$2?v=${revision}$3`));
    }
    const index = new URL('../docs/index.html', import.meta.url);
    const html = await readFile(index, 'utf8');
    await writeFile(index, html.replace(/((?:src|href)=")(\.\/(?:js\/[^"?]+\.js|config\.js|styles\.css))(?:\?v=[a-f0-9]+)?(")/gi, `$1$2?v=${revision}$3`));
  }
  console.log(`Pages 저장 대상: ${deployment.repository} (${deployment.branch})`);
}
