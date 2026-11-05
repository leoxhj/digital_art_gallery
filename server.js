require('dotenv').config();

const cors = require('cors');
const express = require('express');
const multer = require('multer');
const path = require('node:path');
const { Pool } = require('pg');
const { normalizeArtworkMetadata, calculateAgeAtDate } = require('./artwork_metadata');
const sharp = require('sharp');

const app = express();
const PORT = Number(process.env.PORT) || 5001;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const MAX_ARTWORK_FILES = 5;
const AUTHOR_BIRTHDAY = process.env.AUTHOR_BIRTHDAY || '2017-09-04';
const ARTWORK_AUTHOR = process.env.ARTWORK_AUTHOR?.trim() || '';
const configuredWatermarkOpacity = Number(process.env.WATERMARK_OPACITY);
const WATERMARK_OPACITY = Number.isFinite(configuredWatermarkOpacity)
  ? Math.min(1, Math.max(0, configuredWatermarkOpacity))
  : 0.28;
const watermarkFontSizeMatch = /^(\d+(?:\.\d+)?)\s*(?:px)?$/i.exec(process.env.WATERMARK_FONT_SIZE?.trim() || '');
const configuredWatermarkFontSize = watermarkFontSizeMatch ? Number(watermarkFontSizeMatch[1]) : 16;
const WATERMARK_FONT_SIZE = `${Math.min(64, Math.max(6, configuredWatermarkFontSize))}px`;
const WATERMARK_FONT_SIZE_PX = Number.parseFloat(WATERMARK_FONT_SIZE);
if (calculateAgeAtDate(AUTHOR_BIRTHDAY, AUTHOR_BIRTHDAY) !== 0) {
  throw new Error('AUTHOR_BIRTHDAY must be a valid date in YYYY-MM-DD format.');
}
const databaseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST,
      database: process.env.PGDATABASE,
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    };
const pool = new Pool(databaseConfig);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE, files: MAX_ARTWORK_FILES },
  fileFilter: (request, file, callback) => {
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    if (!allowedTypes.has(file.mimetype)) {
      callback(new Error('Choose a JPG, PNG, WebP, or GIF image.'));
      return;
    }
    callback(null, true);
  },
});

app.use(cors());
app.use(express.json());

app.get('/api/config', (request, response) => {
  response.json({
    authorBirthday: AUTHOR_BIRTHDAY,
    artworkAuthor: ARTWORK_AUTHOR,
    watermarkOpacity: WATERMARK_OPACITY,
    watermarkFontSize: WATERMARK_FONT_SIZE,
  });
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drawings (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      artwork_date DATE NOT NULL DEFAULT CURRENT_DATE,
      age INTEGER NOT NULL CHECK (age BETWEEN 0 AND 120),
      medium TEXT NOT NULL,
      category TEXT NOT NULL,
      categories TEXT[] NOT NULL DEFAULT '{}',
      description TEXT,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      image_data BYTEA NOT NULL,
      source_key TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE drawings ADD COLUMN IF NOT EXISTS categories TEXT[] NOT NULL DEFAULT '{}'");
  await pool.query("UPDATE drawings SET categories = ARRAY[category] WHERE cardinality(categories) = 0");
  await pool.query('ALTER TABLE drawings ADD COLUMN IF NOT EXISTS description TEXT');
  await pool.query('ALTER TABLE drawings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
  await pool.query("ALTER TABLE drawings ADD COLUMN IF NOT EXISTS author TEXT NOT NULL DEFAULT ''");
  if (ARTWORK_AUTHOR) {
    const result = await pool.query(
      'UPDATE drawings SET author = $1 WHERE author IS DISTINCT FROM $1',
      [ARTWORK_AUTHOR],
    );
    console.log(`Updated author on ${result.rowCount} artwork(s).`);
  }
}

async function recalculateArtworkAges() {
  const result = await pool.query(
    `UPDATE drawings
     SET age = EXTRACT(YEAR FROM artwork_date)::int - EXTRACT(YEAR FROM $1::date)::int
       - CASE WHEN to_char(artwork_date, 'MM-DD') < to_char($1::date, 'MM-DD') THEN 1 ELSE 0 END
     WHERE artwork_date >= $1::date
       AND age IS DISTINCT FROM (
         EXTRACT(YEAR FROM artwork_date)::int - EXTRACT(YEAR FROM $1::date)::int
         - CASE WHEN to_char(artwork_date, 'MM-DD') < to_char($1::date, 'MM-DD') THEN 1 ELSE 0 END
       )`,
    [AUTHOR_BIRTHDAY],
  );
  console.log(`Recalculated artist age for ${result.rowCount} artwork(s).`);
}

app.get('/api/drawings', async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT id, title, author, artwork_date::text AS date, age, medium, category, categories, description, updated_at::text AS "imageVersion"
       FROM drawings ORDER BY created_at DESC, id DESC`,
    );
    response.json(result.rows.map((drawing) => ({
      ...drawing,
      imageUrl: `/api/drawings/${drawing.id}/image?v=${encodeURIComponent(drawing.imageVersion)}`,
    })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/drawings/:id/image', async (request, response, next) => {
  try {
    const result = await pool.query(
      'SELECT image_data, mime_type FROM drawings WHERE id = $1',
      [request.params.id],
    );
    if (result.rowCount === 0) {
      response.sendStatus(404);
      return;
    }
    response.set('Content-Type', result.rows[0].mime_type);
    response.set('Cache-Control', 'public, max-age=31536000, immutable');
    response.send(result.rows[0].image_data);
  } catch (error) {
    next(error);
  }
});

function escapeXml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character]);
}

function createCopyrightOverlay(width, height, artworkDate, artworkAuthor) {
  const year = artworkDate.slice(0, 4);
  const copyright = escapeXml(`© ${year} ${artworkAuthor}`);
  const marks = Array.from({ length: 12 }, (_, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = Math.round(((column + 0.5) * width) / 3);
    const y = Math.round(((row + 0.5) * height) / 4);
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-24 ${x} ${y})" font-family="Georgia,serif" font-size="${WATERMARK_FONT_SIZE_PX}" fill="#ffffff" fill-opacity="${WATERMARK_OPACITY}" stroke="#111111" stroke-opacity="${Math.min(0.3, WATERMARK_OPACITY)}" stroke-width="1" paint-order="stroke">${copyright}</text>`;
  }).join('');
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${marks}</svg>`);
}

app.get('/api/drawings/:id/download', async (request, response, next) => {
  if (!/^\d+$/.test(request.params.id) || Number(request.params.id) < 1) {
    response.status(400).json({ error: 'Drawing ID must be a positive integer.' });
    return;
  }
  if (!ARTWORK_AUTHOR) {
    response.status(503).json({ error: 'Set ARTWORK_AUTHOR to enable watermarked downloads.' });
    return;
  }

  try {
    const result = await pool.query(
      'SELECT image_data, mime_type, artwork_date::text AS date, author FROM drawings WHERE id = $1',
      [request.params.id],
    );
    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Artwork was not found.' });
      return;
    }

    const drawing = result.rows[0];
    const isGif = drawing.mime_type === 'image/gif';
    const image = sharp(drawing.image_data, { animated: isGif });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || !/^\d{4}-\d{2}-\d{2}$/.test(drawing.date)) {
      response.status(422).json({ error: 'The artwork image or creation date is invalid.' });
      return;
    }

    let output = image.composite([{
      input: createCopyrightOverlay(metadata.width, metadata.height, drawing.date, drawing.author || ARTWORK_AUTHOR),
    }]);
    let extension = 'png';
    let contentType = 'image/png';
    if (isGif) {
      output = output.gif();
      extension = 'gif';
      contentType = 'image/gif';
    } else if (drawing.mime_type === 'image/jpeg') {
      output = output.jpeg({ quality: 95 });
      extension = 'jpg';
      contentType = 'image/jpeg';
    } else if (drawing.mime_type === 'image/webp') {
      output = output.webp({ quality: 95 });
      extension = 'webp';
      contentType = 'image/webp';
    } else {
      output = output.png();
    }

    response.set('Content-Type', contentType);
    response.set('Content-Disposition', `attachment; filename="artwork-${request.params.id}-watermarked.${extension}"`);
    response.set('Cache-Control', 'private, no-store');
    response.send(await output.toBuffer());
  } catch (error) {
    next(error);
  }
});

app.put('/api/drawings/:id', upload.single('image'), async (request, response, next) => {
  if (!/^\d+$/.test(request.params.id) || Number(request.params.id) < 1) {
    response.status(400).json({ error: 'Drawing ID must be a positive integer.' });
    return;
  }

  try {
    const metadata = normalizeArtworkMetadata(request.body);
    if (!metadata) {
      response.status(400).json({ error: 'Provide a title, valid age, medium, and category.' });
      return;
    }
    const { title, age, medium, category, categories, description } = metadata;
    const { date } = request.body;

    const image = request.file;
    const result = await pool.query(
      `UPDATE drawings
       SET title = $2,
         author = COALESCE(NULLIF($12, ''), author),
           artwork_date = COALESCE(NULLIF($3, '')::date, artwork_date),
           age = $4,
           medium = $5,
           category = $6,
             categories = $7,
             description = $8,
             file_name = COALESCE($9, file_name),
             mime_type = COALESCE($10, mime_type),
               image_data = COALESCE($11, image_data),
               updated_at = NOW()
       WHERE id = $1
               RETURNING id, title, author, artwork_date::text AS date, age, medium, category, categories, description, updated_at::text AS "imageVersion"`,
              [request.params.id, title, date || null, age, medium, category, categories, description, image?.originalname || null, image?.mimetype || null, image?.buffer || null, ARTWORK_AUTHOR],
    );
    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Artwork was not found.' });
      return;
    }
    const drawing = result.rows[0];
    response.json({
      ...drawing,
      imageUrl: `/api/drawings/${drawing.id}/image?v=${encodeURIComponent(drawing.imageVersion)}`,
    });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/drawings/:id', async (request, response, next) => {
  if (!/^\d+$/.test(request.params.id) || Number(request.params.id) < 1) {
    response.status(400).json({ error: 'Drawing ID must be a positive integer.' });
    return;
  }

  try {
    const result = await pool.query('DELETE FROM drawings WHERE id = $1', [request.params.id]);
    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Artwork was not found.' });
      return;
    }
    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.post('/api/drawings', upload.fields([
  { name: 'images', maxCount: MAX_ARTWORK_FILES },
  { name: 'image', maxCount: 1 },
]), async (request, response, next) => {
  try {
    const { date } = request.body;
    const files = [...(request.files?.images || []), ...(request.files?.image || [])];
    if (files.length === 0) {
      response.status(400).json({ error: 'Choose an image to upload.' });
      return;
    }
    const metadata = normalizeArtworkMetadata(request.body);
    if (!metadata) {
      response.status(400).json({ error: 'Provide a title, valid age, medium, and category.' });
      return;
    }
    const { title, age, medium, category, categories, description } = metadata;

    const client = await pool.connect();
    let drawings;
    try {
      await client.query('BEGIN');
      drawings = [];
      for (const file of files) {
        const result = await client.query(
          `INSERT INTO drawings (title, author, artwork_date, age, medium, category, categories, description, file_name, mime_type, image_data)
            VALUES ($1, $2, COALESCE(NULLIF($3, '')::date, CURRENT_DATE), $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id, title, author, artwork_date::text AS date, age, medium, category, categories, description, updated_at::text AS "imageVersion"`,
          [title, ARTWORK_AUTHOR, date || null, age, medium, category, categories, description, file.originalname, file.mimetype, file.buffer],
        );
        drawings.push(result.rows[0]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const responseDrawings = drawings.map((drawing) => ({
      ...drawing,
      imageUrl: `/api/drawings/${drawing.id}/image?v=${encodeURIComponent(drawing.imageVersion)}`,
    }));
    response.status(201).json(responseDrawings.length === 1 ? responseDrawings[0] : responseDrawings);
  } catch (error) {
    next(error);
  }
});

const staticDirectory = path.join(__dirname, 'dist');
app.use(express.static(staticDirectory));
app.use((request, response, next) => {
  if (request.method === 'GET' && !request.path.startsWith('/api/')) {
    response.sendFile(path.join(staticDirectory, 'index.html'), (error) => {
      if (error) next(error);
    });
    return;
  }
  next();
});

app.use((error, request, response, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    response.status(413).json({ error: 'Images must be 20 MB or smaller.' });
    return;
  }
  if (error instanceof multer.MulterError && ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(error.code)) {
    response.status(400).json({ error: 'Choose no more than 5 images.' });
    return;
  }
  if (error.message === 'Choose a JPG, PNG, WebP, or GIF image.') {
    response.status(415).json({ error: error.message });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'The gallery could not complete that request.' });
});

async function startServer() {
  const missingDatabaseSettings = ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']
    .filter((name) => !process.env[name]);
  if (!process.env.DATABASE_URL && missingDatabaseSettings.length > 0) {
    throw new Error(`Set DATABASE_URL or provide PostgreSQL settings: ${missingDatabaseSettings.join(', ')}. See .env.example.`);
  }
  await initializeDatabase();
  await recalculateArtworkAges();
  app.listen(PORT, () => {
    console.log(`Museum API running at http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error(`Unable to start the Museum API: ${error.message}`);
  process.exitCode = 1;
});
