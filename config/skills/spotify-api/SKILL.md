---
name: spotify-api
description: 'Script the Spotify Web API directly for what the bundled spotify_* tools cannot do: delete a playlist, check whether tracks are liked, bulk-like, or fill a playlist from the library. Use when asked to remove a Spotify playlist, like/unlike in bulk, build a playlist from Liked Songs, or when a Spotify call returns 403 on /me/tracks.'
---

# Spotify Web API via the profile token

The bundled `spotify_*` tools cover playback, playlist list/get/items/create/add/remove, and library list/save. Use raw REST (python + urllib) only for what they lack: **deleting a playlist**, **contains checks**, **bulk like**, **filling a playlist from the library**.

## When to Use

- "remove/delete my <name> playlist" → unfollow endpoint below
- "like all songs in <playlist>" → contains + bulk save
- "add everything I liked by <artist> to <playlist>" → library scan + artist match
- any Spotify call returning **403** on `/me/tracks*` → the endpoint moved to `/me/library`

## Token

`~/apps/hermes/profiles/<profile>/auth.json` → `providers.spotify`:
`client_id`, `access_token`, `refresh_token`, `expires_at`. PKCE public client — refresh with **no client secret**:

```python
POST https://accounts.spotify.com/api/token
grant_type=refresh_token&refresh_token=...&client_id=...
```

If a call returns 401/403, refresh once and retry before assuming a scope problem. Check `providers.spotify.granted_scope` first — `playlist-modify-public`, `playlist-modify-private`, `user-library-read`, `user-library-modify`, `playlist-read-private` cover everything here.

## Endpoint traps (verified 2026)

- `PUT/GET/DELETE /me/tracks` and `GET /me/tracks/contains` → **403 Forbidden** (deprecated for newer apps). Do not use.
- Use instead:
  - **like**: `PUT /me/library?uris=<comma-separated uris>` (≤40 per call)
  - **unlike**: `DELETE /me/library?uris=...`
  - **check**: `GET /me/library/contains?uris=...` → `[true,false,...]` in request order
  - **count**: `GET /me/tracks?limit=1` → `total` still works
- URIs must be URL-encoded (colons are fine, commas separate).

## Creating a playlist

`POST /v1/me/playlists` `{name, description, public}` → **201** with the new id.
`POST /v1/users/{user_id}/playlists` → **403 Forbidden** (legacy, do not use).
Add tracks with `POST /v1/playlists/{id}/items` `{uris:[...]}` (≤100 per call) → 201.

## Deleting a playlist (i.e. "remove my playlist")

There is no delete endpoint. Unfollow your own playlist = delete:

```
DELETE /playlists/{id}/followers   → 200
```

Guard first: `GET /v1/me` id must equal `GET /v1/playlists/{id}` `owner.id`, else abort. **Back up the tracklist to JSON** in the scratch dir before the DELETE (`/playlists/{id}/items?limit=50&offset=N`).

Verify after: `GET /me/playlists` no longer lists it and `/playlists/{id}/items` returns **404**. A `GET /playlists/{id}` may briefly return a 200 **stub** (name + owner, `tracks.total: null`) from cache — that is not a survivor. Deleting a playlist is permanent; if the user might want it back, the JSON backup is the only recovery.

## Pitfalls

- Paging: pass `limit` ≤ 50; loop on `offset` until `offset >= total`.
- `items[].item` may be null (removed/unavailable) or `is_local: true` — filter both before saving URIs; local files cannot be liked.
- **Never probe an endpoint with a real track and leave it liked.** A `PUT /me/library` of a random track to "test" silently alters the library; if you do it, DELETE it and confirm `contains == [false]`, and if the count math shows the track was already liked, re-PUT it. Same for probe playlists — create, use, unfollow in one script.
- `items.total` inside a `/me/playlists` page is **stale right after a create/edit** (often 0) even though `/playlists/{id}/items` already returns the real count. Trust the items endpoint, not the list snapshot.
- Fill a themed playlist from the library by matching artist names (normalize case; keep a `{norm(name): group}` map). Dedupe on `(norm(title), norm(group))` — Spotify carries the same song under multiple track IDs (e.g. a single vs the EP release), so URI dedupe alone lets duplicates in.
- Sanity-check the library `total` before/after a batch as independent proof (like count +N).
- Verify each saved entry with `/me/library/contains`, not with the PUT status code.
- Report deletions/missing playlists to the user as facts with evidence (API 404 + public oembed 404), never as guesses — a playlist vanishing from `/me/playlists` may be the user's own action in the app.
