const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const MAX_URL_BYTES = 2000; // comfortably under 2KB, so any "~2KB" URL is rejected
const MAX_BODY_BYTES = 1024 * 1024; // 1MB cap on request body, to reject abuse before it becomes a crash

// In-memory store. Swap for a real DB in production; the validation and
// dedupe logic below don't depend on the storage layer.
const store = new Map(); // id -> bookmark
const urlIndex = new Map(); // url -> id (enforces "one row per URL")

function sendJSON(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

// Every validation failure goes through here: always 400, always names the field.
function badRequest(res, field, message) {
  sendJSON(res, 400, { error: message, field });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject({ tooLarge: true });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isValidHttpUrl(candidate) {
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function handleCreate(req, res) {
  let raw;
  try {
    raw = await readBody(req);
  } catch (e) {
    if (e && e.tooLarge) return badRequest(res, 'body', 'request body exceeds the size limit');
    return badRequest(res, 'body', 'could not read request body');
  }

  if (!raw || raw.trim().length === 0) {
    return badRequest(res, 'body', 'request body is required and must be a JSON object with a "url" field');
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return badRequest(res, 'body', 'request body must be valid JSON');
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return badRequest(res, 'body', 'request body must be a JSON object');
  }

  const { url, title } = payload;

  if (url === undefined || url === null) {
    return badRequest(res, 'url', 'url is required');
  }
  if (typeof url !== 'string') {
    return badRequest(res, 'url', 'url must be a string');
  }
  if (url.trim().length === 0) {
    return badRequest(res, 'url', 'url must not be empty');
  }
  if (Buffer.byteLength(url, 'utf8') > MAX_URL_BYTES) {
    return badRequest(res, 'url', `url must be ${MAX_URL_BYTES} bytes or fewer`);
  }
  if (!isValidHttpUrl(url)) {
    return badRequest(res, 'url', 'url must be a valid http:// or https:// URL');
  }
  if (title !== undefined && title !== null && typeof title !== 'string') {
    return badRequest(res, 'title', 'title must be a string');
  }

  // Idempotency: the same create request (same url) must not create a second row.
  // We use the URL itself as the natural key -- see README for the reasoning.
  if (urlIndex.has(url)) {
    const existing = store.get(urlIndex.get(url));
    return sendJSON(res, 200, existing); // 200: returning the existing row, nothing was created
  }

  const id = crypto.randomUUID();
  const bookmark = { id, url, title: title || null, createdAt: new Date().toISOString() };
  store.set(id, bookmark);
  urlIndex.set(url, id);
  return sendJSON(res, 201, bookmark);
}

function handleList(req, res) {
  return sendJSON(res, 200, Array.from(store.values()));
}

function handleGetOne(req, res, id) {
  const bookmark = store.get(id);
  if (!bookmark) return sendJSON(res, 404, { error: 'bookmark not found', field: 'id' });
  return sendJSON(res, 200, bookmark);
}

function handleDelete(req, res, id) {
  const bookmark = store.get(id);
  if (!bookmark) return sendJSON(res, 404, { error: 'bookmark not found', field: 'id' });
  store.delete(id);
  urlIndex.delete(bookmark.url);
  res.writeHead(204);
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const parts = parsedUrl.pathname.split('/').filter(Boolean);

    if (parts[0] !== 'bookmarks') {
      return sendJSON(res, 404, { error: 'not found' });
    }
    if (req.method === 'POST' && parts.length === 1) {
      return await handleCreate(req, res);
    }
    if (req.method === 'GET' && parts.length === 1) {
      return handleList(req, res);
    }
    if (req.method === 'GET' && parts.length === 2) {
      return handleGetOne(req, res, parts[1]);
    }
    if (req.method === 'DELETE' && parts.length === 2) {
      return handleDelete(req, res, parts[1]);
    }
    return sendJSON(res, 404, { error: 'not found' });
  } catch (err) {
    // Genuinely unexpected errors only -- every validation path above
    // already returns 400 before this point, so this should stay unreached.
    console.error('Unexpected error:', err);
    return sendJSON(res, 500, { error: 'internal server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Bookmark service listening on port ${PORT}`);
  });
}

module.exports = server;
