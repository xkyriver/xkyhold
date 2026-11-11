# XkyHold repository format — version 1 (draft)

Status: **draft, not yet implemented.** Nothing here is frozen until the
engine passes round-trip tests against it. After the first public release,
any incompatible change needs a new format version.

This document is the contract between the backup engine and the data it
leaves in Google Drive. If the code and this document disagree, one of them
has a bug.

## 1. Goals and non-goals

Goals, in priority order:

1. **Never lose data silently.** Every byte read back is authenticated, and
   an interrupted operation leaves the repository readable.
2. **Google sees only ciphertext.** File names, contents, sizes of
   individual files and folder structure are hidden.
3. **Incremental and deduplicated.** Unchanged data is not uploaded twice.
4. **Friendly to Drive.** Few, medium-sized files; no dependence on atomic
   operations Drive does not have.
5. **Simple enough to re-implement** from this document alone.

Non-goals for version 1:

- Compatibility with restic or any other tool.
- Hiding the total size of the backup or when backups happen.
- Protection against someone with write access to the Drive folder rolling
  the repository back to an older state.
- Protection of a device that is already compromised.

## 2. What the browser can and cannot capture

The File System Access API exposes, per file: name, size and last-modified
time. Nothing else. Consequences that the format accepts:

- No permissions, owners, extended attributes or creation times are stored.
  On Linux and macOS this includes the executable bit: restored scripts and
  programs must be made executable again by hand.
- Symbolic links are believed not to be exposed to the app (to be confirmed
  by test) and are not backed up.
- Chrome refuses to open the home folder itself and system folders; only
  sub-folders such as Documents or Pictures can be chosen.
- Empty folders **are** stored.
- On restore to a folder, the browser cannot set a file's modification
  time: restored files carry the time of the restore. A `.zip` restore
  preserves the original times. The original time is always kept in the
  snapshot.

XkyHold is therefore a backup of personal files — documents, pictures,
work — not of a system, of dotfiles or of a development environment. The
product must say so plainly.

## 3. Layout in Google Drive

```
XkyHold/                      created by the app in the user's Drive root
  <repository name>/          one per backup set (default: the device name)
    config                    plaintext JSON: format, KDF, wrapped keys
    snapshots/<snapshot id>   one encrypted manifest per backup
    index/<sha256>            encrypted maps: blob -> pack
    packs/<sha256>            encrypted file data and folder listings
    locks/<random id>         advisory locks
```

Drive-specific rules:

- Drive allows several files with the same name in one folder. Every
  object except `config` and locks is named after its content (or a random
  id), so duplicates are harmless: readers use any one of them, and prune
  removes the extras.
- The app uses the `drive.file` scope, so it only sees files created by
  XkyHold itself, on any device signed in to the same Google account.
- Objects are written once and never modified, except `config` (rewritten
  on password change).
- "Delete" always means **move to the Drive trash**, which Drive keeps for
  30 days. The engine never deletes permanently.

## 4. Cryptography

All primitives are available in WebCrypto except Argon2id, which runs as
WebAssembly.

| Purpose | Primitive |
|---|---|
| Password → key-encryption key | Argon2id |
| Sub-key derivation | HKDF-SHA-256 |
| Encryption of every object | AES-256-GCM, 96-bit random nonce, 128-bit tag |
| Blob identifiers | HMAC-SHA-256 |
| Object names, transport integrity | SHA-256 |

### 4.1 Keys

- **Master key**: 32 random bytes, generated once per repository. It never
  leaves the browser unwrapped.
- **Password KEK**: `Argon2id(password, salt)`, 32 bytes. Default
  parameters: memory 64 MiB, 3 iterations, parallelism 1, 32-byte random
  salt. The parameters are stored in `config`, so they can be raised later
  without a format change. The password is encoded as UTF-8 after Unicode
  NFC normalisation.
- **Recovery key**: 32 random bytes generated when the repository is
  created, shown to the user once to print or store away from the
  computer, and never stored by the app. It is a second way to unwrap the
  same master key, for when the password is forgotten.
- **Recovery KEK**: `HKDF-SHA-256(recovery key, salt = empty,
  info = "xkyhold/v1/recovery/<repo id>")`, 32 bytes. No slow KDF is
  needed: the recovery key already has 256 bits of entropy.
- **Sub-keys**, derived from the master key with HKDF-SHA-256, empty salt:

  | Key | HKDF info | Use |
  |---|---|---|
  | `encKey` | `xkyhold/v1/enc/<repo id>` | AES-256-GCM for all objects |
  | `idKey` | `xkyhold/v1/id/<repo id>` | HMAC-SHA-256 for blob ids |

In the browser, the master key is imported as a non-extractable key and
kept in IndexedDB, so the password is asked once per device, not on every
visit. The password itself is never stored.

### 4.2 Encrypted object encoding

Every encrypted object, whatever its kind, is:

```
nonce (12 bytes) || AES-256-GCM ciphertext || tag (16 bytes)
```

with **additional authenticated data** that binds it to its role, so one
object cannot be passed off as another:

| Object | AAD (ASCII) |
|---|---|
| Wrapped master key | `xkyhold/v1/key/<repo id>` |
| Blob | `xkyhold/v1/blob/<type>/<blob id hex>` |
| Pack header | `xkyhold/v1/pack-header` |
| Index | `xkyhold/v1/index` |
| Snapshot | `xkyhold/v1/snapshot/<snapshot id>` |

Nonces are random. With one key this is safe up to 2³² encryptions; at
4 MiB per blob that is far beyond any Drive quota.

### 4.3 `config`

Plaintext JSON, because it must be readable before the password is known:

```json
{
  "format": 1,
  "repoId": "9f2c…  (16 random bytes, hex)",
  "created": "2026-11-11T14:00:00Z",
  "chunker": { "type": "fixed", "size": 4194304 },
  "keys": [
    {
      "type": "password",
      "kdf": "argon2id",
      "memoryKiB": 65536,
      "iterations": 3,
      "parallelism": 1,
      "salt": "…base64…",
      "wrappedMasterKey": "…base64 of an encrypted object…"
    },
    {
      "type": "recovery",
      "kdf": "hkdf-sha256",
      "wrappedMasterKey": "…base64 of an encrypted object…"
    }
  ]
}
```

- `keys` holds one slot per way of unwrapping the master key. Version 1
  writes exactly one `password` slot and one `recovery` slot. Readers try
  the slots of the matching `type` and ignore types they do not know.
- A wrong password or recovery key is detected when unwrapping the master
  key fails authentication.
- Changing the password rewrites `config` with a new salt and a re-wrapped
  master key in the `password` slot. The recovery slot and all data are
  untouched. A forgotten password is replaced the same way, after
  unlocking with the recovery key.

**Recovery key as text.** The 32 bytes are written in Crockford base32
(alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`), 52 characters, shown in
groups of four separated by hyphens. When reading, case, spaces and hyphens
are ignored, `O` is read as `0`, and `I` and `L` as `1`.
- Readers must refuse a `format` they do not know.

## 5. Blobs

A **blob** is a run of plaintext bytes with a type:

- `data`: a chunk of file content.
- `tree`: the listing of one folder (section 7).

Its id is `HMAC-SHA-256(idKey, plaintext)`, 32 bytes, written as hex.
Identical plaintext always has the same id, which is what gives
deduplication. The id is keyed so that it reveals nothing about the content
even if an index leaked.

### 5.1 Chunking

Files are split into fixed 4 MiB chunks; the last chunk is shorter. An
empty file has no chunks.

The chunk boundaries are recorded per file in the tree, so the *format*
does not depend on how the data was chunked. A later writer may switch to
content-defined chunking without a format change; `config.chunker` records
what the repository was created with.

### 5.2 Compression

Each blob records its encoding: `0` = stored as is, `1` = raw DEFLATE
before encryption. Version 1 writers compress `tree` blobs, indexes and
snapshots, and store `data` blobs as is. Readers must support both.

## 6. Packs

Blobs are grouped into **packs** so that Drive holds thousands of files
rather than millions.

```
"XKH1" (4 bytes)
encrypted blob 0
encrypted blob 1
…
encrypted header
header length (4 bytes, unsigned, little-endian)
```

The header, before compression (encoding 1) and encryption, is JSON:

```json
{
  "blobs": [
    { "id": "…hex…", "type": "data", "offset": 4, "length": 4194332, "rawLength": 4194304, "encoding": 0 }
  ]
}
```

- `offset` and `length` locate the encrypted blob inside the pack.
- `rawLength` is the plaintext length.
- The pack's name is the hex SHA-256 of the whole pack file. Drive reports
  a SHA-256 for every file, so a pack can be verified **without downloading
  it**, by comparing its name with Drive's checksum.
- Target size: 16 MiB. A pack is closed when adding the next blob would
  exceed it. `data` and `tree` blobs go in separate packs, so that browsing
  a backup only downloads tree packs.
- A single blob is read from a pack with an HTTP range request; restoring
  one file does not download whole packs.

The header duplicates what the index says. It exists so the index can be
rebuilt from the packs alone.

## 7. Trees

A `tree` blob lists one folder, as JSON, entries sorted by name:

```json
{
  "entries": [
    { "name": "notes.txt", "type": "file", "size": 1234, "mtime": 1794400000000,
      "content": ["…blob id…"] },
    { "name": "Photos", "type": "dir", "subtree": "…blob id…" }
  ]
}
```

- `mtime` is milliseconds since the Unix epoch, as the browser reports it.
- `content` lists the file's `data` blobs in order. The size of each chunk
  is in the index (`rawLength`).
- Because a tree is a blob, an unchanged folder produces the same id and is
  stored once across all snapshots.

## 8. Index

An index maps blob ids to their place in packs. Before compression and
encryption:

```json
{
  "packs": [
    { "id": "…pack sha256…", "blobs": [ { "id": "…", "type": "data", "offset": 4, "length": 4194332, "rawLength": 4194304, "encoding": 0 } ] }
  ]
}
```

- Index files are named after the SHA-256 of their content and never
  modified. The full index is the union of all index files.
- During a backup an index file is written after every few packs. This is
  the checkpoint: if the backup is interrupted, the next run finds those
  blobs in the index and does not upload them again.
- A blob may appear in more than one pack (after an interrupted run, or two
  devices backing up the same file). Readers use any.
- Prune may merge many small index files into one.

## 9. Snapshots

One per completed backup. Before compression and encryption:

```json
{
  "id": "…16 random bytes, hex…",
  "time": "2026-11-11T14:05:00Z",
  "device": "orestes",
  "roots": [ { "name": "Documents", "tree": "…blob id…" } ],
  "stats": { "files": 5123, "bytes": 8123456789, "skipped": 2 },
  "parent": "…previous snapshot id, or null…"
}
```

- `roots` holds one entry per folder the user chose. Only the folder's own
  name is known to the browser, never its full path.
- A snapshot is written **last**, after every pack and index it depends on
  is safely in Drive. A snapshot that exists is therefore always complete.
- `skipped` counts files that could not be read; the backup still succeeds
  and the UI says so.

## 10. Operations

### 10.1 Backup

1. Load the index (from the local cache, refreshed from Drive).
2. Walk each chosen folder. For every file, compare size and `mtime` with
   the same path in the parent snapshot; if both match, reuse its `content`
   list without reading the file.
3. Otherwise read the file, chunk it, and for each chunk compute its id; if
   the index already has it, skip; else encrypt it and add it to the open
   pack.
   This is the usual size-and-time rule: a file rewritten with exactly the
   same size and the same modification time is taken as unchanged.
4. Upload full packs with resumable uploads; write an index file every few
   packs.
5. Build tree blobs bottom-up, upload the remaining packs and the final
   index.
6. Write the snapshot.

Two backups may run at the same time against one repository: everything is
append-only and content-addressed.

### 10.2 Restore

1. Read the snapshot, then tree blobs on demand as the user browses.
2. For each chosen file, fetch its blobs by range request, decrypt, and
   verify that `HMAC(idKey, plaintext)` equals the blob id.
3. Write to the chosen folder, or stream into a `.zip`.

A failed check stops that file with a clear error and never writes
unverified data.

### 10.3 Retention and prune

Retention ("keep at least N months") moves snapshots older than the window
to the trash, always keeping the most recent one.

Prune then reclaims space:

1. Take the exclusive lock (10.4).
2. Collect every blob reachable from the remaining snapshots.
3. Packs with no reachable blob are unused. Packs where less than half the
   bytes are reachable are rewritten: their live blobs go into new packs.
4. Write the new packs, then a new index that no longer mentions the old
   ones, **then** trash the old index files, **then** trash the old packs.

At every point in that order, each index file present refers only to packs
that still exist. An interruption leaves extra files, never missing ones.

### 10.4 Locks

Drive has no atomic "create if absent", so locks are advisory:

```json
{ "kind": "backup", "device": "orestes", "time": "2026-11-11T14:05:00Z" }
```

- A lock is refreshed every 5 minutes and is stale after 30 minutes
  without refresh.
- Backup writes a `backup` lock, **then** lists all locks. If a fresh `prune`
  lock exists it waits; otherwise it proceeds.
- Prune writes a `prune` lock, **then** lists all locks. If any other fresh
  lock exists, it removes its own and gives up until later. Writing before
  checking means two simultaneous prunes both back off.
- Both sides write before they check, so a backup and a prune that start
  together cannot both go ahead: prune must never trash a pack that a
  running backup has just decided not to re-upload.

### 10.5 Check and repair

- **Quick check**: list packs and compare each name with Drive's SHA-256;
  confirm every pack named in the index exists. No downloads.
- **Full check**: additionally download and verify every blob.
- **Rebuild index**: read every pack header and write a fresh index. This
  is the recovery path if index files are lost.

## 11. What Google can observe

- The repository name, the number of objects and their sizes (packs are
  about 16 MiB, so individual file sizes are hidden except for a lone small
  final pack).
- When objects are created and trashed.
- Nothing about file names, folder structure or contents.

## 12. Open questions

1. **Content-defined chunking.** Fixed chunks re-upload everything after an
   insertion near the start of a large file. Acceptable for documents and
   photos; worth revisiting for large, frequently edited files.
2. **Compressing file data.** Most large user files (photos, video,
   archives) are already compressed. Could be enabled per blob later.
3. **Symbolic links.** Confirm by test what Chrome does with them, and
   count anything that cannot be stored as skipped.
4. **Argon2id cost on phones.** 64 MiB should be fine for restore-only use
   on mobile; to be measured.
5. **Test vectors.** A fixture written by the first implementation lives in
   `src/engine/golden-v1.json` (config, password, recovery key, one pack).
   Every later version must still open it. `golden-v1-repo.json` is a whole
   small repository (config, packs, index, snapshot) that every later
   version must still restore.
