import test from 'node:test';
import assert from 'node:assert/strict';
import { projectImageMasks } from '../docs/js/image-masks.js';
import { validateQuestion, parseImport, csvExport } from '../docs/js/core.js';

const masks = [{ x: .2, y: .8, width: .6, height: .15 }];
const question = { id: 'captioned', title: '자막 장면', category: '해외 영화', answer: '정답 대사', image: './uploads/captioned.jpg', imageMasks: masks };

test('자막 가림 영역을 JSON·CSV 가져오기와 내보내기에서 보존한다', () => {
  const validated = validateQuestion(question);
  assert.deepEqual(validated.imageMasks, masks);
  assert.notEqual(validated.imageMasks[0], masks[0]);
  assert.deepEqual(parseImport(JSON.stringify([validated]), 'scenes.json')[0].imageMasks, masks);
  assert.deepEqual(parseImport(csvExport([validated]), 'scenes.csv')[0].imageMasks, masks);
  assert.equal(Object.hasOwn(validateQuestion({ ...question, imageMasks: [] }), 'imageMasks'), false);
});

test('잘못된 좌표와 지나치게 많은 가림 영역을 거부한다', () => {
  for (const imageMasks of ['broken JSON', {}, Array(9).fill(masks[0]), [{ x: -.1, y: 0, width: .2, height: .2 }], [{ x: .9, y: .1, width: .2, height: .1 }], [{ ...masks[0], width: 0 }], [{ ...masks[0], y: NaN }], [{ ...masks[0], height: '0.1' }]]) {
    assert.throws(() => validateQuestion({ ...question, imageMasks }), /가림 영역/);
  }
});

test('가로·세로 여백과 썸네일 잘림을 고려해 자막을 같은 위치에서 가린다', () => {
  const photo = { imageWidth: 1000, imageHeight: 500 };
  assert.deepEqual(projectImageMasks(masks, { ...photo, boxWidth: 800, boxHeight: 600 }), [{ left: 160, top: 420, width: 480, height: 60 }]);
  assert.deepEqual(projectImageMasks(masks, { ...photo, boxWidth: 400, boxHeight: 200 }), [{ left: 80, top: 160, width: 240, height: 30 }]);
  assert.deepEqual(projectImageMasks(masks, { imageWidth: 500, imageHeight: 1000, boxWidth: 600, boxHeight: 400 }), [{ left: 240, top: 320, width: 120, height: 60 }]);
  assert.deepEqual(projectImageMasks(masks, { ...photo, boxWidth: 400, boxHeight: 300, fit: 'cover' }), [{ left: 20, top: 240, width: 360, height: 45 }]);
  assert.deepEqual(projectImageMasks(masks, { ...photo, boxWidth: 0, boxHeight: 0 }), []);
});
