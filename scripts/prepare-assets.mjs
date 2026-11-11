import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const imagesDir = path.join(publicDir, 'images');
const worksDir = path.join(imagesDir, 'works');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function splitPair(source, beforeOut, afterOut) {
  const image = sharp(source);
  const meta = await image.metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) throw new Error(`Cannot read ${source}`);
  const half = Math.floor(width / 2);

  await sharp(source)
    .extract({ left: 0, top: 0, width: half, height })
    .jpeg({ quality: 82 })
    .toFile(beforeOut);

  await sharp(source)
    .extract({ left: half, top: 0, width: width - half, height })
    .jpeg({ quality: 82 })
    .toFile(afterOut);
}

async function main() {
  await ensureDir(worksDir);

  const heroSrc = path.join(root, 'Светлана_ уборка квартир с заботой.png');
  const heroMeta = await sharp(heroSrc).metadata();
  const srcW = heroMeta.width || 1672;
  const srcH = heroMeta.height || 941;
  // About: only the person (no brand lettering on the right of the banner).
  const aboutLeft = Math.floor(srcW * 0.02);
  const aboutW = Math.floor(srcW * 0.38);

  await sharp(heroSrc)
    .resize(1672, 941, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toFile(path.join(imagesDir, 'hero-svetlana.jpg'));

  // Keep full height so the head/bun is not sliced; do not force a tall cover crop.
  await sharp(heroSrc)
    .extract({ left: aboutLeft, top: 0, width: aboutW, height: srcH })
    .resize(720, null, { fit: 'inside', withoutEnlargement: false })
    .jpeg({ quality: 88 })
    .toFile(path.join(imagesDir, 'about-svetlana.jpg'));

  await sharp(heroSrc)
    .resize(1200, 630, { fit: 'contain', background: { r: 15, g: 118, b: 110, alpha: 1 } })
    .jpeg({ quality: 85 })
    .toFile(path.join(publicDir, 'og-image.jpg'));

  await sharp(heroSrc)
    .extract({ left: aboutLeft + Math.floor(aboutW * 0.2), top: 20, width: Math.floor(aboutW * 0.55), height: Math.floor(srcH * 0.85) })
    .resize(180, 180, { fit: 'cover', position: 'attention' })
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));

  await splitPair(
    path.join(root, 'foto', 'photo_8.webp'),
    path.join(worksDir, 'before-kitchen.jpg'),
    path.join(worksDir, 'after-kitchen.jpg')
  );

  await splitPair(
    path.join(root, 'foto', 'photo_9.jpg'),
    path.join(worksDir, 'before-window.jpg'),
    path.join(worksDir, 'after-window.jpg')
  );

  // photo_8 is 960x960 side-by-side kitchen; also export a detail crop as result shot
  await sharp(path.join(root, 'foto', 'photo_8.webp'))
    .extract({ left: 480, top: 120, width: 460, height: 720 })
    .jpeg({ quality: 85 })
    .toFile(path.join(worksDir, 'result-kitchen-detail.jpg'));

  await sharp(path.join(root, 'foto', 'photo_21.jpg'))
    .resize(900, 700, { fit: 'cover' })
    .jpeg({ quality: 85 })
    .toFile(path.join(worksDir, 'supplies.jpg'));

  console.log('Assets prepared');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
