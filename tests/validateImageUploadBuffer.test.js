const { validateImageUploadBuffer } = require('../src/utils/validateImageUploadBuffer');

describe('validateImageUploadBuffer', () => {
  test('accepts JPEG magic bytes regardless of declared mime', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const result = validateImageUploadBuffer(jpeg);
    expect(result.ok).toBe(true);
    expect(result.contentType).toBe('image/jpeg');
  });

  test('accepts PNG', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(validateImageUploadBuffer(png)).toMatchObject({
      ok: true,
      contentType: 'image/png'
    });
  });

  test('rejects empty and non-image payload', () => {
    expect(validateImageUploadBuffer(Buffer.alloc(0)).ok).toBe(false);
    expect(validateImageUploadBuffer(Buffer.from('not-an-image')).ok).toBe(false);
  });
});
