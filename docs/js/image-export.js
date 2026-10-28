import { createZip } from './zip.js';

const encoder = new TextEncoder();
function cleanName(value, fallback) {
  return String(value || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().replace(/[. ]+$/u, '') || fallback;
}
function shorten(value, limit) {
  if (encoder.encode(value).length <= limit) return value;
  let result = '', length = 0;
  for (const char of value) {
    const size = encoder.encode(char).length;
    if (length + size > limit - 3) break;
    result += char; length += size;
  }
  return result.trimEnd() + '…';
}

export function imageExportJobs(questions) {
  const used = new Set();
  return questions.map(question => {
    const fullName = `${cleanName(question.title, '제목 없음')} - ${cleanName(question.answer, '대사 없음')}`;
    const title = shorten(cleanName(question.title, '제목 없음'), 120);
    const base = shorten(`${title} - ${cleanName(question.answer, '대사 없음')}`, 220);
    let stem = base, number = 1;
    // Reserve room for the extension and suffix; avoid collisions on Windows/macOS.
    while (used.has(stem.toLowerCase())) stem = `${base} (${++number})`;
    used.add(stem.toLowerCase());
    return { question: { ...question }, stem, shortened: base !== fullName };
  });
}

function imageExtension(data) {
  const header = String.fromCharCode(...data.subarray(0, 40));
  const text = new TextDecoder().decode(data.subarray(0, 512));
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => data[i] === byte)) return 'png';
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'webp';
  if (/^GIF8[79]a/u.test(header)) return 'gif';
  if (header.startsWith('BM')) return 'bmp';
  if ((data[0] === 73 && data[1] === 73 && data[2] === 42 && data[3] === 0) || (data[0] === 77 && data[1] === 77 && data[2] === 0 && data[3] === 42)) return 'tif';
  if (header.slice(4, 8) === 'ftyp' && /avif|avis/u.test(header.slice(8, 40))) return 'avif';
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/u.test(text)) return 'svg';
  throw new Error('이미지 파일을 읽을 수 없습니다.');
}
function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('이미지 내보내기를 취소했습니다.', 'AbortError');
}
async function fetchImage(job, resolveImageUrl, { signal, fetcher, timeoutMs }) {
  checkAbort(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const url = await resolveImageUrl(job.question.image);
    checkAbort(signal);
    if (!url) throw new Error('이미지 주소를 찾을 수 없습니다.');
    const response = await fetcher(url, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`이미지 요청 실패 (${response.status})`);
    const data = new Uint8Array(await response.arrayBuffer());
    checkAbort(signal);
    return { name: `${job.stem}.${imageExtension(data)}`, data, job };
  } catch (error) {
    checkAbort(signal);
    if (controller.signal.aborted) throw new Error('이미지 응답 시간이 초과되었습니다. 다시 시도해 주세요.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function buildImageExport(jobs, resolveImageUrl, { signal, onProgress, fetcher = fetch, concurrency = 6, timeoutMs = 30000 } = {}) {
  checkAbort(signal);
  const results = new Array(jobs.length);
  let next = 0, completed = 0;
  const worker = async () => {
    while (next < jobs.length) {
      checkAbort(signal);
      const index = next++, job = jobs[index];
      try { results[index] = await fetchImage(job, resolveImageUrl, { signal, fetcher, timeoutMs }); }
      catch (error) {
        checkAbort(signal);
        results[index] = { job, error: error.message || '이미지를 다운로드할 수 없습니다.' };
      }
      onProgress?.(++completed, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), jobs.length) }, worker));
  checkAbort(signal);
  const successful = results.filter(result => !result.error), failed = results.filter(result => result.error);
  const files = successful.map(({ name, data }) => ({ name, data }));
  if (successful.some(({ job }) => job.shortened)) {
    const text = successful.map(({ name, job }) => `파일: ${name}\n작품명: ${job.question.title}\n대사: ${job.question.answer}`).join('\n\n');
    files.push({ name: '전체 파일명과 대사.txt', data: encoder.encode('\uFEFF' + text) });
  }
  if (failed.length && successful.length) {
    const text = '다음 이미지는 ZIP에 포함되지 않았습니다. 사이트에서 실패한 이미지 다시 받기를 눌러 주세요.\n\n' + failed.map(({ job, error }) => `작품명: ${job.question.title}\n대사: ${job.question.answer}\n이유: ${error}`).join('\n\n');
    files.push({ name: '다운로드 실패 목록.txt', data: encoder.encode('\uFEFF' + text) });
  }
  return { blob: successful.length ? createZip(files) : null, count: successful.length, failed, total: jobs.length };
}

export function imageArchiveName(date = new Date()) {
  const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  return `한컷한마디-이미지-${stamp}.zip`;
}
