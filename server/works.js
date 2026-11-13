import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_CAPTION = 120;
const FULL_MAX_EDGE = 1600;
const THUMB_WIDTH = 720;
const THUMB_HEIGHT = 540; // 4:3 — совпадает с сеткой на сайте

export function publicWork(item) {
  const url = item.url;
  const thumbUrl = item.thumbUrl || url;
  return {
    id: item.id,
    url,
    thumbUrl,
    caption: item.caption,
    createdAt: item.createdAt,
    avgRating: item.ratingCount > 0 ? Math.round((item.ratingSum / item.ratingCount) * 10) / 10 : 0,
    ratingCount: item.ratingCount || 0,
  };
}

/** Newest first — top-left of the site grid, then right/down like a snake. */
export function sortWorksNewestFirst(items) {
  return [...(items || [])].sort((a, b) => {
    const tb = Date.parse(b?.createdAt || '') || 0;
    const ta = Date.parse(a?.createdAt || '') || 0;
    if (tb !== ta) return tb - ta;
    return String(b?.id || '').localeCompare(String(a?.id || ''));
  });
}

export async function ensureWorksDirs(dataDir) {
  const uploadsDir = path.join(dataDir, 'uploads', 'works');
  await fs.mkdir(uploadsDir, { recursive: true });
  return uploadsDir;
}

const DEMO_WORKS = [
  {
    id: 'demo-kitchen',
    src: 'result-kitchen-detail.jpg',
    filename: 'demo-kitchen.jpg',
    caption: 'Кухня после генеральной уборки',
    createdAt: '2026-11-11T12:00:00.000Z',
  },
  {
    id: 'demo-after-kitchen',
    src: 'after-kitchen.jpg',
    filename: 'demo-after-kitchen.jpg',
    caption: 'Чистая кухня — готово к жизни',
    createdAt: '2026-11-11T12:00:00.000Z',
  },
  {
    id: 'demo-window',
    src: 'after-window.jpg',
    filename: 'demo-window.jpg',
    caption: 'Окна без разводов',
    createdAt: '2026-11-11T12:00:00.000Z',
  },
];

/** Re-seed built-in demo shots if they disappeared from works.json. */
export async function ensureDemoWorks(worksFilePath, dataDir, distDir) {
  const uploadsDir = await ensureWorksDirs(dataDir);
  const data = await readWorks(worksFilePath);
  const byId = new Map(data.items.map((item) => [item.id, item]));
  let changed = false;
  const srcRoot = path.join(distDir, 'images', 'works');

  for (const demo of DEMO_WORKS) {
    const target = path.join(uploadsDir, demo.filename);
    try {
      await fs.access(target);
    } catch {
      try {
        await fs.copyFile(path.join(srcRoot, demo.src), target);
      } catch (error) {
        console.error('demo_work_copy_error', demo.id, error);
        continue;
      }
    }

    if (!byId.has(demo.id)) {
      byId.set(demo.id, {
        id: demo.id,
        filename: demo.filename,
        thumbFilename: demo.filename,
        url: `/uploads/works/${demo.filename}`,
        thumbUrl: `/uploads/works/${demo.filename}`,
        caption: demo.caption,
        createdAt: demo.createdAt,
        ratingSum: 0,
        ratingCount: 0,
      });
      changed = true;
    }
  }

  const ordered = sortWorksNewestFirst([...byId.values()]);
  const sameOrder =
    ordered.length === data.items.length &&
    ordered.every((item, index) => item.id === data.items[index]?.id);
  if (!changed && sameOrder) return { items: data.items, changed: false };

  await writeWorksAtomic(worksFilePath, { items: ordered });
  return { items: ordered, changed: true };
}

export async function readWorks(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.items)) return { items: [] };
    return { items: sortWorksNewestFirst(parsed.items) };
  } catch {
    return { items: [] };
  }
}

export async function writeWorksAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

export function sanitizeCaption(value) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_CAPTION);
}

export function extForMime(mime) {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  return null;
}

export function isAllowedUpload(file) {
  if (!file) return false;
  const mime = String(file.mimetype || '').toLowerCase();
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return false;
  if (ext && !ALLOWED_EXT.has(ext)) return false;
  return Boolean(extForMime(mime));
}

export function newWorkId() {
  return crypto.randomBytes(8).toString('hex');
}

export function buildWorkRecord({ id, filename, thumbFilename, caption }) {
  return {
    id,
    filename,
    thumbFilename,
    url: `/uploads/works/${filename}`,
    thumbUrl: `/uploads/works/${thumbFilename}`,
    caption: sanitizeCaption(caption) || 'Работа',
    createdAt: new Date().toISOString(),
    ratingSum: 0,
    ratingCount: 0,
  };
}

async function processAndStoreImage(file, uploadsDir, id) {
  const fullName = `${id}.webp`;
  const thumbName = `${id}-thumb.webp`;
  const fullPath = path.join(uploadsDir, fullName);
  const thumbPath = path.join(uploadsDir, thumbName);

  const pipeline = sharp(file.path, { failOn: 'none' }).rotate();

  await pipeline
    .clone()
    .resize({
      width: FULL_MAX_EDGE,
      height: FULL_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 78, effort: 4 })
    .toFile(fullPath);

  await sharp(file.path, { failOn: 'none' })
    .rotate()
    .resize({
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT,
      fit: 'cover',
      position: 'centre',
    })
    .webp({ quality: 68, effort: 4 })
    .toFile(thumbPath);

  await fs.unlink(file.path).catch(() => {});
  return { filename: fullName, thumbFilename: thumbName };
}

export async function addWork(filePath, uploadsDir, file, caption) {
  if (!isAllowedUpload(file)) {
    return { ok: false, error: 'Допустимы только JPEG, PNG или WebP' };
  }

  const id = newWorkId();
  let stored;
  try {
    stored = await processAndStoreImage(file, uploadsDir, id);
  } catch (error) {
    console.error('works_image_process_error', error);
    await fs.unlink(file.path).catch(() => {});
    return { ok: false, error: 'Не удалось обработать изображение' };
  }

  const data = await readWorks(filePath);
  const item = buildWorkRecord({
    id,
    filename: stored.filename,
    thumbFilename: stored.thumbFilename,
    caption,
  });
  data.items = sortWorksNewestFirst([item, ...data.items]);
  await writeWorksAtomic(filePath, data);
  return { ok: true, item: publicWork(item) };
}

export async function deleteWork(filePath, uploadsDir, id) {
  const data = await readWorks(filePath);
  const index = data.items.findIndex((item) => item.id === id);
  if (index < 0) return { ok: false, error: 'Фото не найдено', status: 404 };

  const [removed] = data.items.splice(index, 1);
  await writeWorksAtomic(filePath, data);

  for (const name of [removed?.filename, removed?.thumbFilename]) {
    if (!name) continue;
    try {
      await fs.unlink(path.join(uploadsDir, name));
    } catch {
      /* ignore missing file */
    }
  }
  return { ok: true };
}

export async function updateWorkCaption(filePath, id, caption) {
  const data = await readWorks(filePath);
  const item = data.items.find((entry) => entry.id === id);
  if (!item) return { ok: false, error: 'Фото не найдено', status: 404 };

  const next = sanitizeCaption(caption);
  if (!next) {
    return { ok: false, error: 'Укажите название фото', status: 400 };
  }

  item.caption = next;
  await writeWorksAtomic(filePath, data);
  return { ok: true, item: publicWork(item) };
}

export async function rateWork(filePath, id, stars) {
  const value = Number(stars);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    return { ok: false, error: 'Оценка должна быть от 1 до 5', status: 400 };
  }

  const data = await readWorks(filePath);
  const item = data.items.find((entry) => entry.id === id);
  if (!item) return { ok: false, error: 'Фото не найдено', status: 404 };

  item.ratingSum = (item.ratingSum || 0) + value;
  item.ratingCount = (item.ratingCount || 0) + 1;
  await writeWorksAtomic(filePath, data);
  return { ok: true, item: publicWork(item) };
}
