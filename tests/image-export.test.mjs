import test from 'node:test';
import assert from 'node:assert/strict';
import { imageExportJobs, buildImageExport, imageArchiveName, roundImageExport } from '../docs/js/image-export.js';
import { createZip } from '../docs/js/zip.js';

const encoder = new TextEncoder();
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
const question = (title, answer, image = 'https://example.test/scene') => ({ title, answer, image });

test('기존 회차의 장면 스냅샷만 내보내고 이후 수정·회차 선택 변경과 관계없이 파일명과 원본을 유지한다', async () => {
  // Same schema as history saved before the export feature existed.
  const saved = { id: 'old-round', number: 1, startedAt: new Date(2026, 9, 28, 12).toISOString(), scenes: [
    { position: 1, ...question('타짜', '묻고 더블로 가!', 'https://original.test/first.jpg') },
    { position: 2, ...question('친구', '니가 가라 하와이', 'local:second') },
  ] };
  const before = structuredClone(saved);
  const request = roundImageExport(saved);
  assert.deepEqual(saved, before, 'Export does not rewrite stored history');
  assert.equal(request.filename, '한컷한마디-1회차-이미지-2026-10-28.zip');
  assert.equal(request.label, '1회차');
  const another = roundImageExport({ ...saved, number: 2, scenes: [question('다른 회차', '다른 대사', 'unseen')] });
  saved.scenes[0].title = '수정된 보관함 제목'; saved.scenes[0].answer = '수정된 대사'; saved.scenes.push(question('보지 않은 문제', '미출제', 'unseen'));
  const fetched = [], jpeg = new Uint8Array([255, 216, 255, 224, 1, 2, 3]);
  const result = await buildImageExport(request.jobs, async image => image.startsWith('local:') ? `blob:${image}` : image, {
    fetcher: async url => { fetched.push(url); return new Response(url.startsWith('blob:') ? png : jpeg); },
  });
  assert.deepEqual(fetched, ['https://original.test/first.jpg', 'blob:local:second']);
  assert.equal(result.count, 2);
  const files = await entries(result.blob);
  assert.deepEqual(files.map(f => f.name), ['타짜 - 묻고 더블로 가!.jpg', '친구 - 니가 가라 하와이.png']);
  assert.deepEqual(files[0].data, jpeg); assert.deepEqual(files[1].data, png);
  assert.equal(another.filename, '한컷한마디-2회차-이미지-2026-10-28.zip');
  assert.equal(request.label, '1회차');
});

test('회차 이미지 실패 재시도는 최초 회차의 파일명 중복 번호와 이미지 범위를 유지한다', async () => {
  const request = roundImageExport({ number: 7, startedAt: new Date(2026, 9, 28, 12).toISOString(), scenes: [question('같은 작품', '같은 대사', 'ok'), question('같은 작품', '같은 대사', 'missing')] });
  const first = await buildImageExport(request.jobs, async image => image, { fetcher: async url => url === 'ok' ? new Response(png) : new Response('', { status: 404 }) });
  const retried = await buildImageExport(first.failed.map(({ job }) => job), async image => image, { fetcher: async url => { assert.equal(url, 'missing'); return new Response(png); } });
  assert.equal((await entries(retried.blob))[0].name, '같은 작품 - 같은 대사 (2).png');
  assert.equal(request.filename, '한컷한마디-7회차-이미지-2026-10-28.zip');
  for (const value of [null, { number: 1, scenes: [] }, { number: 1, startedAt: 'invalid', scenes: [question('작품', '대사')] }]) assert.throws(() => roundImageExport(value), /회차/);
});
async function entries(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer), result = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 6, true), 0x0800, 'Korean filenames must declare UTF-8');
    assert.equal(view.getUint16(offset + 8, true), 0, 'Preserve image bytes without recompression');
    const size = view.getUint32(offset + 18, true), nameSize = view.getUint16(offset + 26, true), extra = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameSize)), start = offset + 30 + nameSize + extra;
    result.push({ name, data: bytes.slice(start, start + size), offset }); offset = start + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), result.length);
  assert.equal(view.getUint32(end + 16, true), offset);
  return result;
}

test('작품명 - 대사 파일명에서 줄바꿈·금지 문자를 정리하고 중복을 덮어쓰지 않는다', () => {
  const input = [question('어벤져스: 엔드게임', '3000만큼\n사랑해?'), question('타짜', '너무 좋아'), question('타짜', '너무 좋아'), question('타짜', '너무 좋아 (2)'), question('SAME', 'Quote'), question('same', 'quote')];
  const jobs = imageExportJobs(input);
  assert.deepEqual(jobs.map(j => j.stem), ['어벤져스 엔드게임 - 3000만큼 사랑해', '타짜 - 너무 좋아', '타짜 - 너무 좋아 (2)', '타짜 - 너무 좋아 (2) (2)', 'SAME - Quote', 'same - quote (2)']);
  input[0].title = '수정된 작품';
  assert.equal(jobs[0].question.title, '어벤져스: 엔드게임', 'An export uses a stable snapshot');
  const [long] = imageExportJobs([question('가'.repeat(150), '한글😀'.repeat(300))]);
  assert.equal(long.shortened, true);
  assert.ok(encoder.encode(long.stem + ' (5000).webp').length < 240);
  assert.ok(!long.stem.includes('\uFFFD'));
  assert.ok(long.stem.startsWith('가'));
});

test('ZIP의 CRC·중앙 디렉터리·한글 파일명이 표준에 맞고 파일 바이트를 보존한다', async () => {
  const name = '타짜 - 묻고 더블로 가!.jpg', data = encoder.encode('123456789');
  const blob = createZip([{ name, data }, { name: '비어 있는 파일.txt', data: new Uint8Array() }], new Date(2026, 9, 28, 12, 34, 56));
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  assert.equal(blob.type, 'application/zip');
  assert.equal(view.getUint32(14, true), 0xcbf43926, 'Standard CRC32 check vector');
  const decoded = await entries(blob);
  assert.equal(decoded[0].name, name); assert.deepEqual(decoded[0].data, data);
  const central = view.getUint32(bytes.length - 6, true);
  assert.equal(view.getUint16(central + 8, true), 0x0800);
  assert.equal(view.getUint32(central + 42, true), 0);
  assert.throws(() => createZip([{ name: '../escape.jpg', data }]), /파일명/);
  assert.throws(() => createZip([{ name, data }, { name, data }]), /중복/);
});

test('실제 이미지 서명에 맞는 확장자를 쓰고 원본 바이트와 전체 문제 순서를 보존한다', async () => {
  const jpeg = new Uint8Array([255, 216, 255, 224, 1, 2, 3]);
  // A multi-byte UTF-8 sequence in RIFF's size field must not move WEBP's byte offset.
  const webp = new Uint8Array([82, 73, 70, 70, 195, 169, 0, 0, 87, 69, 66, 80, 1, 2, 3]);
  const images = [jpeg, png, webp];
  const jobs = imageExportJobs(images.map((_, i) => ({ ...question('작품', `대사 ${i}`, `image-${i}`), enabled: false, imageMasks: [{ x: 0, y: 0, width: 1, height: 1 }] })));
  const seen = [], progress = [];
  const result = await buildImageExport(jobs, async image => `blob:${image}`, {
    concurrency: 2,
    fetcher: async (url, options) => { seen.push(url); assert.equal(options.credentials, 'omit'); return new Response(images[Number(url.slice(-1))], { headers: { 'content-type': 'application/octet-stream' } }); },
    onProgress: (n, total) => progress.push([n, total]),
  });
  assert.equal(result.count, 3); assert.deepEqual(result.failed, []);
  assert.equal(seen.length, 3); assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
  const files = await entries(result.blob);
  assert.deepEqual(files.map(f => f.name), ['작품 - 대사 0.jpg', '작품 - 대사 1.png', '작품 - 대사 2.webp']);
  files.forEach((file, i) => assert.deepEqual(file.data, images[i]));
});

test('일부 실패는 ZIP과 화면용 결과에 명시하며 재시도에서도 파일명을 유지한다', async () => {
  const jobs = imageExportJobs([question('작품', '대사', 'ok'), question('작품', '대사', 'missing'), question('다른 작품', '다른 대사', 'html')]);
  const result = await buildImageExport(jobs, async image => image, { fetcher: async url => url === 'ok' ? new Response(png) : url === 'missing' ? new Response('', { status: 404 }) : new Response('<html>error</html>') });
  assert.equal(result.count, 1); assert.equal(result.failed.length, 2);
  const files = await entries(result.blob);
  assert.deepEqual(files.map(f => f.name), ['작품 - 대사.png', '다운로드 실패 목록.txt']);
  const report = new TextDecoder().decode(files[1].data);
  assert.match(report, /다른 작품/); assert.match(report, /404/);
  const retry = await buildImageExport(result.failed.map(f => f.job), async image => image, { fetcher: async () => new Response(png) });
  assert.equal(retry.count, 2); assert.equal(retry.failed.length, 0);
  assert.equal((await entries(retry.blob))[0].name, '작품 - 대사 (2).png');
});

test('취소하면 진행 중인 요청과 대기 작업을 중단하고 ZIP을 만들지 않는다', async () => {
  const controller = new AbortController(); let fetched = 0;
  const jobs = imageExportJobs(Array.from({ length: 12 }, (_, i) => question('작품', `대사${i}`)));
  await assert.rejects(buildImageExport(jobs, async image => image, {
    signal: controller.signal, concurrency: 2,
    fetcher: async () => { fetched++; return new Response(png); },
    onProgress: () => controller.abort(),
  }), { name: 'AbortError' });
  assert.ok(fetched <= 2);
  await assert.rejects(buildImageExport(jobs, async image => image, { signal: controller.signal }), { name: 'AbortError' });
});

test('응답 지연·전체 실패를 성공으로 표시하지 않으며 긴 파일명의 전체 대사를 보관한다', async () => {
  const jobs = imageExportJobs([question('작품', '대사')]);
  const failed = await buildImageExport(jobs, async image => image, {
    timeoutMs: 5,
    fetcher: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })),
  });
  assert.equal(failed.count, 0); assert.equal(failed.blob, null); assert.match(failed.failed[0].error, /시간/);
  const answer = '긴 대사 '.repeat(200);
  const result = await buildImageExport(imageExportJobs([question('작품', answer)]), async image => image, { fetcher: async () => new Response(png) });
  const files = await entries(result.blob);
  assert.equal(files[1].name, '전체 파일명과 대사.txt');
  assert.ok(new TextDecoder().decode(files[1].data).includes(answer));
  assert.equal(imageArchiveName(new Date(2026, 9, 28)), '한컷한마디-이미지-2026-10-28.zip');
});
