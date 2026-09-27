// Automated check against every line in "A reviewer checks".
// Run with: node test/acceptance.test.js
// Starts the real server on an ephemeral port and hits it over HTTP.

const server = require('../server');

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
  }
}

async function main() {
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://localhost:${port}`;

  console.log('\n1) Three or more endpoints, each returning a documented status code\n');
  const created = await fetch(`${base}/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/one', title: 'One' }),
  });
  const createdBody = await created.json();
  check('POST /bookmarks -> 201 on first create', created.status === 201);

  const list = await fetch(`${base}/bookmarks`);
  check('GET /bookmarks -> 200', list.status === 200);

  const one = await fetch(`${base}/bookmarks/${createdBody.id}`);
  check('GET /bookmarks/:id -> 200', one.status === 200);

  const del = await fetch(`${base}/bookmarks/${createdBody.id}`, { method: 'DELETE' });
  check('DELETE /bookmarks/:id -> 204', del.status === 204);

  console.log('\n2) Malformed input returns 400 with a message naming the field\n');

  const emptyString = await fetch(`${base}/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: '' }),
  });
  const emptyStringBody = await emptyString.json();
  check('empty string url -> 400', emptyString.status === 400);
  check('empty string url -> field is "url"', emptyStringBody.field === 'url');

  const numberUrl = await fetch(`${base}/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 12345 }),
  });
  const numberUrlBody = await numberUrl.json();
  check('number as url -> 400', numberUrl.status === 400);
  check('number as url -> field is "url"', numberUrlBody.field === 'url');

  const missingField = await fetch(`${base}/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'no url here' }),
  });
  const missingFieldBody = await missingField.json();
  check('missing url field -> 400', missingField.status === 400);
  check('missing url field -> field is "url"', missingFieldBody.field === 'url');

  const longUrl = 'https://example.com/' + 'a'.repeat(2100); // ~2KB+
  const tooLong = await fetch(`${base}/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: longUrl }),
  });
  const tooLongBody = await tooLong.json();
  check('~2KB url -> 400', tooLong.status === 400);
  check('~2KB url -> field is "url"', tooLongBody.field === 'url');

  console.log('\n3) No input produces a 500\n');

  const noBody = await fetch(`${base}/bookmarks`, { method: 'POST' });
  check('POST with no body -> 400 (not 500)', noBody.status === 400);

  const badJson = await fetch(`${base}/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not valid json',
  });
  check('POST with invalid JSON -> 400 (not 500)', badJson.status === 400);

  const notAnId = await fetch(`${base}/bookmarks/does-not-exist`);
  check('GET unknown id -> 404 (not 500)', notAnId.status === 404);

  console.log('\n4) The same create request sent twice leaves one row\n');

  const first = await fetch(`${base}/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/dupe-check' }),
  });
  const firstBody = await first.json();
  const second = await fetch(`${base}/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/dupe-check' }),
  });
  const secondBody = await second.json();
  check('first create -> 201', first.status === 201);
  check('repeat create -> 200 (not a new row)', second.status === 200);
  check('repeat create -> same id returned', firstBody.id === secondBody.id);

  const afterList = await fetch(`${base}/bookmarks`);
  const afterListBody = await afterList.json();
  const dupeCount = afterListBody.filter((b) => b.url === 'https://example.com/dupe-check').length;
  check('exactly one row exists for that url', dupeCount === 1);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  server.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
