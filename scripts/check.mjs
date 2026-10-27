import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { validateQuestion } from '../docs/js/core.js';

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.filter(e => !['.git', 'node_modules', '.openai'].includes(e.name)).map(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : `${dir}/${e.name}`))).flat();
}
const files = await walk('.');
for (const file of files.filter(f => /\.(m?js)$/.test(f))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${file}\n${result.stderr}`);
}
const html = await readFile('docs/index.html', 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
if (ids.length !== new Set(ids).size) throw new Error('HTML ID가 중복되었습니다.');
const app = await readFile('docs/js/app.js', 'utf8');
for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) if (!ids.includes(id)) throw new Error(`HTML에 없는 ID: ${id}`);
for (const [, path] of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) await access(resolve('docs', path));
const questions = JSON.parse(await readFile('docs/data/questions.json', 'utf8'));
if (new Set(questions.map(q => q.id)).size !== questions.length) throw new Error('문제 ID가 중복되었습니다.');
for (const q of questions) { validateQuestion(q); if (q.image.startsWith('./')) await access(resolve('docs', q.image)); }
// 사용자 입력으로 실행 가능한 HTML을 만들지 않습니다.
if (/\.innerHTML\s*=/.test(app)) throw new Error('사용자 콘텐츠는 textContent로 렌더링해 주세요.');
console.log(`검증 완료: JavaScript ${files.filter(f => /\.(m?js)$/.test(f)).length}개, HTML ID ${ids.length}개, 샘플 문제 ${questions.length}개`);
