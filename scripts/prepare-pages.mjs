import { writeFile } from 'node:fs/promises';
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
  console.log(`Pages 저장 대상: ${deployment.repository} (${deployment.branch})`);
}
