// ZIP "stored" entries preserve the already-compressed image bytes.
// Format: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export function createZip(files, date = new Date()) {
  if (files.length > 65535) throw new Error('한 ZIP에 담을 수 있는 파일 수를 초과했습니다.');
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const parts = [], central = [], names = new Set();
  let offset = 0, centralSize = 0;
  for (const { name, data } of files) {
    if (!name || /[/\\\u0000]/u.test(name) || name === '.' || name === '..' || names.has(name)) throw new Error('ZIP 파일명이 올바르지 않거나 중복되었습니다.');
    names.add(name);
    const filename = encoder.encode(name);
    if (filename.length > 65535 || !(data instanceof Uint8Array)) throw new Error('ZIP 파일 이름 또는 데이터가 올바르지 않습니다.');
    const size = data.byteLength, checksum = crc32(data);
    if (offset + 30 + filename.length + size > 0xffffffff) throw new Error('이미지 전체 용량이 ZIP 내보내기 한도를 초과했습니다.');
    const local = new Uint8Array(30), localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); // UTF-8 filenames, including Korean.
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, size, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, filename.length, true);
    const directory = new Uint8Array(46), directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true);
    directoryView.setUint16(4, 20, true);
    directoryView.setUint16(6, 20, true);
    directoryView.setUint16(8, 0x0800, true);
    directoryView.setUint16(12, dosTime, true);
    directoryView.setUint16(14, dosDate, true);
    directoryView.setUint32(16, checksum, true);
    directoryView.setUint32(20, size, true);
    directoryView.setUint32(24, size, true);
    directoryView.setUint16(28, filename.length, true);
    directoryView.setUint32(42, offset, true);
    parts.push(local, filename, data);
    central.push(directory, filename);
    offset += local.length + filename.length + size;
    centralSize += directory.length + filename.length;
  }
  if (offset + centralSize + 22 > 0xffffffff) throw new Error('이미지 전체 용량이 ZIP 내보내기 한도를 초과했습니다.');
  const end = new Uint8Array(22), endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
