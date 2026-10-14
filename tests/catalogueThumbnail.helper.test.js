const sharp = require('sharp');
const {
  generateCatalogueThumbBuffer,
  INVALID_IMAGE_MESSAGE
} = require('../src/services/catalogueThumbnail');

describe('catalogueThumbnail.generateCatalogueThumbBuffer', () => {
  it('applies EXIF orientation so output dimensions match upright display', async () => {
    const rawWidth = 1200;
    const rawHeight = 800;
    const input = await sharp({
      create: { width: rawWidth, height: rawHeight, channels: 3, background: { r: 10, g: 20, b: 30 } }
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const inputMeta = await sharp(input).metadata();
    expect(inputMeta.width).toBe(rawWidth);
    expect(inputMeta.height).toBe(rawHeight);
    expect(inputMeta.orientation).toBe(6);

    const thumb = await generateCatalogueThumbBuffer(input);
    const outMeta = await sharp(thumb).metadata();
    expect(outMeta.format).toBe('jpeg');
    expect(outMeta.width).toBe(600);
    expect(outMeta.height).toBe(900);
    expect(outMeta.height).toBeGreaterThan(outMeta.width);
    expect(outMeta.orientation).toBeUndefined();
  });

  it('converts PNG with alpha to JPEG', async () => {
    const png = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 0.5 } }
    })
      .png()
      .toBuffer();

    const thumb = await generateCatalogueThumbBuffer(png);
    const meta = await sharp(thumb).metadata();
    expect(meta.format).toBe('jpeg');
  });

  it('rejects corrupt buffers with INVALID_IMAGE', async () => {
    await expect(generateCatalogueThumbBuffer(Buffer.from('not-an-image'))).rejects.toMatchObject({
      code: 'INVALID_IMAGE',
      status: 400,
      message: INVALID_IMAGE_MESSAGE
    });
  });
});
