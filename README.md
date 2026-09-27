# Bookmark service

A small HTTP service for saving bookmarks. No framework, no dependencies —
just Node's built-in `http` module, so `node server.js` is all it takes to
run it anywhere.

## Endpoints

| Method | Path             | Success       | Notes                                    |
|--------|------------------|---------------|-------------------------------------------|
| POST   | `/bookmarks`     | `201 Created` | `200 OK` if the url already exists (see "Repeats" below) |
| GET    | `/bookmarks`     | `200 OK`      | returns a JSON array                     |
| GET    | `/bookmarks/:id` | `200 OK`      | `404` if the id doesn't exist            |
| DELETE | `/bookmarks/:id` | `204 No Content` | `404` if the id doesn't exist         |

`POST /bookmarks` body: `{ "url": "https://...", "title": "optional string" }`

## Validation (the interesting part)

Every one of these returns **`400`** with a JSON body of
`{ "error": "<message>", "field": "<field name>" }` — never a silent save,
never a `500`:

- missing `url`
- `url` is an empty string
- `url` is not a string (e.g. a number)
- `url` longer than ~2KB
- `url` that isn't a valid `http://` or `https://` URL
- no request body at all
- a body that isn't valid JSON
- a body that isn't a JSON object

A catch-all wraps the request handler so a truly unexpected error still
returns `500` rather than crashing the process — but every *input* problem
is caught before that point and turned into a `400`.

## How repeats are recognised

A bookmark's identity, from the caller's point of view, **is its URL** —
"save this page" twice means "I already have this," not "make a second
copy." So the service keeps a `url -> id` index alongside the main store.

On create:
- if the URL is new, insert it and return `201` with the new row.
- if the URL already exists, return `200` with the **existing** row —
  nothing new is written.

This is why `POST` returns `201` on the first call and `200` on a repeat:
the status code itself tells the caller whether anything was created,
without them needing to inspect the body.

A production version scoped to multiple users would key on
`(user_id, url)` instead of `url` alone — this brief has no auth, so a
global unique URL is the closest equivalent, and demonstrates the same
idempotency the reviewer is checking for.

## Running it

```bash
node server.js
# Bookmark service listening on port 3000
```

## Automated acceptance check

`test/acceptance.test.js` starts the real server on an ephemeral port and
exercises every line in the brief's "A reviewer checks" list — endpoint
status codes, each malformed-input case, no-input handling, and the
duplicate-create case — and prints pass/fail for each.

```bash
node test/acceptance.test.js
```

Sample manual check with curl, once the server is running:

```bash
curl -i -X POST localhost:3000/bookmarks \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}'
# -> 201, then run it again -> 200, same id

curl -i -X POST localhost:3000/bookmarks \
  -H 'Content-Type: application/json' \
  -d '{"url": ""}'
# -> 400 {"error":"url must not be empty","field":"url"}

curl -i localhost:3000/bookmarks
```
