// 원본 사진은 보존하고, 정답이 적힌 자막 영역만 화면에서 가립니다.
export function validateImageMasks(value) {
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('이미지 가림 영역 형식을 확인해 주세요.'); }
  }
  if (!Array.isArray(value) || value.length > 8) throw new Error('이미지 가림 영역은 최대 8개까지 지정할 수 있습니다.');
  return value.map(rect => {
    const keys = ['x', 'y', 'width', 'height'];
    if (!rect || keys.some(key => typeof rect[key] !== 'number' || !Number.isFinite(rect[key]))
      || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0
      || rect.x + rect.width > 1.000001 || rect.y + rect.height > 1.000001) {
      throw new Error('이미지 가림 영역은 사진 안의 0~1 좌표여야 합니다.');
    }
    return Object.fromEntries(keys.map(key => [key, rect[key]]));
  });
}

export function projectImageMasks(masks, { boxWidth, boxHeight, imageWidth, imageHeight, fit = 'contain' }) {
  if (![boxWidth, boxHeight, imageWidth, imageHeight].every(n => Number.isFinite(n) && n > 0)) return [];
  const scale = Math[fit === 'cover' ? 'max' : 'min'](boxWidth / imageWidth, boxHeight / imageHeight);
  const width = imageWidth * scale, height = imageHeight * scale;
  const left = (boxWidth - width) / 2, top = (boxHeight - height) / 2;
  return masks.map(rect => ({ left: left + rect.x * width, top: top + rect.y * height, width: rect.width * width, height: rect.height * height }));
}

export function createImageMasks(img) {
  const layer = document.createElement('span');
  layer.className = 'image-masks'; layer.setAttribute('aria-hidden', 'true'); layer.hidden = true;
  img.after(layer);
  let masks = [];
  const paint = () => {
    const rectangles = img.hidden ? [] : projectImageMasks(masks, {
      boxWidth: img.clientWidth, boxHeight: img.clientHeight,
      imageWidth: img.naturalWidth, imageHeight: img.naturalHeight,
      fit: getComputedStyle(img).objectFit,
    });
    layer.replaceChildren(...rectangles.map(rect => {
      const cover = document.createElement('span');
      for (const key of ['left', 'top', 'width', 'height']) cover.style[key] = `${rect[key]}px`;
      return cover;
    }));
    layer.hidden = !rectangles.length;
  };
  const observer = new ResizeObserver(paint); observer.observe(img);
  img.addEventListener('load', paint);
  return {
    set(value = []) {
      masks = value; img.parentElement.classList.toggle('has-image-masks', Boolean(masks.length)); paint();
    },
    dispose() { observer.disconnect(); img.removeEventListener('load', paint); layer.remove(); },
  };
}
