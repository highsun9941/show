import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { repositoryFromPages, resolveConfig, loadConfig, repositoryLinks } from '../docs/js/config.js';
import { LocalStore } from '../docs/js/storage.js';
import { deploymentConfig } from '../scripts/prepare-pages.mjs';

test('복제한 소스의 기본 설정은 원본 계정·저장소·main을 덮어씌우지 않는다', async () => {
  const window = {};
  runInNewContext(await readFile(new URL('../docs/config.js', import.meta.url), 'utf8'), { window });
  const config = resolveConfig(window.SHOW_CONFIG, {}, 'https://clone-owner.github.io/clone-project/');
  assert.equal(config.repository, 'clone-owner/clone-project'); assert.equal(config.branch, '');
});

test('다른 계정과 다른 저장소 이름을 Pages 주소에서 찾는다', () => {
  assert.equal(repositoryFromPages('https://new-account.github.io/movie-party/'), 'new-account/movie-party');
  assert.equal(repositoryFromPages('https://another.github.io/renamed-game/index.html'), 'another/renamed-game');
  assert.equal(repositoryFromPages('https://new-account.github.io/'), 'new-account/new-account.github.io');
  assert.equal(repositoryFromPages('https://new-account.github.io/index.html'), 'new-account/new-account.github.io');
});
test('로컬·사용자 지정 도메인에서 원본 저장소로 임의 연결하지 않는다', () => {
  for (const href of ['http://localhost:3000/', 'https://party.example.com/', 'https://owner.github.io.evil.example/game/']) assert.equal(repositoryFromPages(href), '');
});
test('Actions가 새 저장소와 실제 배포 브랜치를 기록해 사용자 지정 도메인에서도 동작한다', () => {
  const deployment = deploymentConfig({ GITHUB_REPOSITORY: 'new-owner/new-repo', GITHUB_REF_NAME: 'master', GITHUB_TOKEN: 'ignored-fixture' });
  assert.deepEqual(deployment, { repository: 'new-owner/new-repo', branch: 'master' });
  const config = resolveConfig({}, deployment, 'https://party.example.org/');
  assert.equal(config.repository, 'new-owner/new-repo'); assert.equal(config.branch, 'master');
  assert.ok(!JSON.stringify(deployment).includes('ignored-fixture'));
});
test('수동 대상 지정은 다른 배포본의 브랜치를 따라가지 않는다', () => {
  const config = resolveConfig({ repository: 'manual-owner/manual-repo' }, { repository: 'previous-owner/previous-repo', branch: 'old' }, 'https://example.org/');
  assert.equal(config.repository, 'manual-owner/manual-repo'); assert.equal(config.branch, '');
  assert.equal(resolveConfig({ repository: 'manual-owner/manual-repo', branch: 'event/live' }, {}, 'http://localhost:3000/').branch, 'event/live');
});
test('도움말 링크도 새 계정·저장소·브랜치를 가리킨다', () => {
  assert.equal(repositoryLinks({ repository: 'owner-b/game-b', branch: 'event/live' }).readme, 'https://github.com/owner-b/game-b/blob/event%2Flive/README.md');
  assert.equal(repositoryLinks({ repository: 'owner-b/game-b', branch: '' }).readme, 'https://github.com/owner-b/game-b/blob/HEAD/README.md');
  assert.deepEqual(repositoryLinks({ repository: '' }), {});
});
test('같은 github.io 계정에 두 저장소를 배포해도 기기 저장소가 분리된다', () => {
  const one = resolveConfig({}, {}, 'https://owner.github.io/game-a/');
  const two = resolveConfig({}, {}, 'https://owner.github.io/game-b/');
  assert.notEqual(one.siteScope, two.siteScope);
  assert.notEqual(new LocalStore(one.siteScope).databaseName, new LocalStore(two.siteScope).databaseName);
  assert.equal(resolveConfig({}, {}, 'https://owner.github.io/game-a/index.html').siteScope, one.siteScope);
});
test('배포 정보가 없는 브랜치 배포에서도 Pages 주소로 현재 저장소를 찾는다', async () => {
  const requested = [];
  const config = await loadConfig({}, 'https://other.github.io/new-game/', async url => { requested.push(url); return new Response('{}'); });
  assert.deepEqual(requested, ['https://other.github.io/new-game/deployment.json']);
  assert.equal(config.repository, 'other/new-game'); assert.equal(config.branch, '');
});
test('설정의 잘못된 저장소와 저장소 밖 파일 경로를 거부한다', () => {
  assert.throws(() => resolveConfig({ repository: 'https://github.com/a/b' }, {}, 'https://example.org/'), /repository/);
  for (const dataPath of ['/docs/file.json', '../file.json', 'docs/../file.json']) assert.throws(() => resolveConfig({ dataPath }, {}, 'https://example.org/'), /경로/);
});
test('실제 배포는 새 저장소 정보와 같은 버전의 HTML·스타일·의존 모듈을 제공한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scene-clone-'));
  try {
    await cp(new URL('../scripts', import.meta.url), join(dir, 'scripts'), { recursive: true });
    await cp(new URL('../docs', import.meta.url), join(dir, 'docs'), { recursive: true });
    await cp(new URL('../package.json', import.meta.url), join(dir, 'package.json'));
    const revision = 'a'.repeat(40);
    const env = { ...process.env, GITHUB_REPOSITORY: 'clone-user/clone-title', GITHUB_REF_NAME: 'master', GITHUB_SHA: revision };
    const result = spawnSync(process.execPath, ['scripts/prepare-pages.mjs'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'docs/deployment.json'), 'utf8')), { repository: 'clone-user/clone-title', branch: 'master' });
    assert.equal(await readFile(join(dir, 'docs/config.js'), 'utf8'), await readFile(new URL('../docs/config.js', import.meta.url), 'utf8'));
    const html = await readFile(join(dir, 'docs/index.html'), 'utf8');
    for (const path of ['js/app.js', 'js/theme.js', 'config.js', 'styles.css']) assert.ok(html.includes(`./${path}?v=${revision}`), path);
    for (const [file, dependency] of [['app.js', 'core.js'], ['app.js', 'storage.js'], ['app.js', 'image-export.js'], ['image-export.js', 'zip.js'], ['storage.js', 'core.js'], ['core.js', 'image-masks.js']]) {
      assert.ok((await readFile(join(dir, 'docs/js', file), 'utf8')).includes(`./${dependency}?v=${revision}`), `${file}: ${dependency}`);
    }
    const second = spawnSync(process.execPath, ['scripts/prepare-pages.mjs'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(await readFile(join(dir, 'docs/index.html'), 'utf8'), html);
    assert.equal(await readFile(join(dir, 'docs/data/questions.json'), 'utf8'), await readFile(new URL('../docs/data/questions.json', import.meta.url), 'utf8'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
