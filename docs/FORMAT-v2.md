# XkyHold repository format — version 2

Status: **draft for review**, 13 November 2026. Nothing implements it yet.
Once approved it is frozen like version 1, and the fixtures written for it
(`golden-v2*.json`, section 10) are never regenerated.

Version 2 is version 1 (`docs/FORMAT.md`) plus what a program running on
Linux can capture and a browser cannot: permissions, owners, nanosecond
times, extended attributes, symbolic links and names that are not valid
UTF-8. It exists for XkyHold-lx, the Linux app that backs up a whole home
folder. Everything this document does not mention is exactly as in
version 1: cryptography, keys, recovery key, packs, chunking, compression,
index, locks, prune order and Drive layout.

## 1. Goals

1. **A version 2 repository restores the home folder as it was**: content,
   permission bits, modification times to the nanosecond, symbolic links,
   extended attributes and, where the user is the same, the owner.
2. **XkyHold web can still restore files from it** in any browser, ignoring
   what a browser cannot apply (section 8).
3. **A program that only knows version 1 never misreads version 2.** It
   either refuses with a clear message or fails before it reads or removes
   anything (section 3).
4. **Every version 1 repository stays readable**, byte for byte, by every
   version 2 reader.

Non-goals, as in version 1: compatibility with restic, hiding the total
size or the timing of backups, system backups. Version 2 describes files
inside one user's home folder; it has no notion of devices, sockets or
files outside it.

## 2. Summary of changes

| Where | Version 1 | Version 2 |
|---|---|---|
| `config.format` | `1` | `2` |
| Snapshot | `id`, `time`, `device`, `roots`, `stats`, `parent` | Adds `format: 2`, optional `home`, `source` and `meta` per root, more `stats`; encrypted with AAD `xkyhold/v2/snapshot/<id>` |
| Tree entry types | `file`, `dir` | Adds `symlink` |
| Entry fields | `name`, `size`, `mtime` (ms), `content` / `subtree` | Adds optional `nameBytes`, `mtimeNanos`, `mode`, `uid`, `gid`, `user`, `group`, `xattrs`, `change`; folders get the same metadata |
| Destinations | Google Drive | Also a local folder (section 9) |

## 3. Marking the version, and what older programs do

### 3.1 In `config`

A repository that may contain version 2 snapshots has `"format": 2` in
`config`. Nothing else in `config` changes; the key slots and the
derivation of keys are those of version 1, including the HKDF info strings
that say `v1`.

- Readers of version 2 accept `format` 1 and 2.
- XkyHold web 1.0 refuses `format: 2` when it connects to a backup, with
  "This is not an XkyHold backup, or it was made by a newer version." (it
  checks `format` in `unlockRepository`). This is the clear refusal.

### 3.2 In each snapshot

XkyHold web 1.0 has one path that does not read `config`: reopening a
backup this browser already knows, with the keys kept in IndexedDB. If a
repository it knew as version 1 later became version 2 (section 7), that
path would load version 2 snapshots and trees as if they were version 1.
Its restore would then fail on a symbolic link in an unhelpful way, and
its prune would read a tree it does not understand.

So every version 2 snapshot is sealed with a different AAD:

| Object | AAD (ASCII) |
|---|---|
| Version 1 snapshot | `xkyhold/v1/snapshot/<snapshot id>` |
| Version 2 snapshot | `xkyhold/v2/snapshot/<snapshot id>` |

A version 1 reader fails to authenticate a version 2 snapshot, and because
it lists all snapshots before it backs up, restores or prunes, it stops
before reading any version 2 tree. It says the backup is damaged, which is
wrong but safe; it can only happen to a browser tab left open from before
XkyHold web learned version 2. Version 2 trees are only reachable from
version 2 snapshots, so no other object needs a new AAD.

A version 2 reader opens a snapshot with the version 2 AAD first and, if
that fails authentication, with the version 1 AAD. The plaintext also
carries `"format": 2`; a snapshot whose `format` disagrees with the AAD
that opened it is damaged.

### 3.3 Mixed repositories

A `format: 2` repository may hold version 1 and version 2 snapshots side by
side, and they share blobs. A writer that records anything version 2 adds
writes a version 2 snapshot; a writer that only knows version 1 fields
(XkyHold web, which keeps writing version 1 snapshots) may keep doing so.
A version 1 snapshot never refers to a tree containing version 2 fields or
types, because version 1 writers do not produce them.

## 4. Tree entries

A tree is still `{ "entries": [ … ] }`, one blob per folder, compressed and
encrypted as in version 1.

### 4.1 Common fields

Every entry type may carry these, all optional unless stated:

| Field | Type | Meaning |
|---|---|---|
| `name` | string, **required** | The entry's name as UTF-8. When the name on disk is not valid UTF-8, this is a display form with each invalid sequence replaced by U+FFFD, and `nameBytes` holds the real name |
| `nameBytes` | base64 | The exact name on disk. Present only when it is not valid UTF-8 |
| `mtime` | integer | Modification time, milliseconds since the Unix epoch, rounded towards minus infinity. **Required** for `file` (as in version 1), optional for the others |
| `mtimeNanos` | integer 0–999 999 | Nanoseconds to add to `mtime`. The full time is `mtime × 10⁶ + mtimeNanos` ns. Split this way because JSON numbers are only exact up to 2⁵³ in JavaScript |
| `mode` | integer | Permission bits, `st_mode & 0o7777` (setuid, setgid, sticky and `rwx` for user, group, others). Not present on `symlink` |
| `uid`, `gid` | integer | Numeric owner and group |
| `user`, `group` | string | Owner and group names at backup time, for display and for matching by name |
| `xattrs` | array | Extended attributes, section 4.5 |
| `change` | object | Change-detection data for the next backup, section 4.6. Readers ignore it |

Names: a name is never empty, `.` or `..`, and never contains `/` or NUL,
whether in `name` or in `nameBytes`. Within a tree, names (compared as the
bytes of `nameBytes` if present, else of `name` as UTF-8) are unique.
Writers sort entries by those bytes; readers must not depend on the order.

Two different invalid names can have the same display form. A reader that
can only write UTF-8 names (a browser, a `.zip`) must not let one overwrite
the other; it restores the second under a changed name or skips it and
says so.

### 4.2 `file`

```json
{ "name": "run.sh", "type": "file", "size": 1234, "mtime": 1794400000123, "mtimeNanos": 456789,
  "mode": 493, "uid": 1000, "gid": 1000, "user": "ana", "group": "ana",
  "content": ["…blob id…"] }
```

`size` and `content` are as in version 1. A file that changed while it was
being read is stored as read; the backup counts it (section 5.3) and does
not mark the entry.

### 4.3 `dir`

```json
{ "name": ".ssh", "type": "dir", "subtree": "…blob id…", "mode": 448, "mtime": 1794400000000, "uid": 1000, "gid": 1000 }
```

Folders now carry the common metadata. A folder that was not walked
because it was left out is absent, as in version 1.

### 4.4 `symlink` (new)

```json
{ "name": "current", "type": "symlink", "target": "releases/2026-11", "mtime": 1794400000000, "uid": 1000, "gid": 1000 }
```

| Field | Type | Meaning |
|---|---|---|
| `target` | string, **required** | The link's target as stored, never resolved. Display form if not valid UTF-8 |
| `targetBytes` | base64 | The exact target, present only when it is not valid UTF-8 |

A symbolic link is stored as a link: the backup never follows it, whatever
it points to (inside or outside the home folder, or nowhere). It has no
content blobs.

### 4.5 Extended attributes

```json
"xattrs": [ { "name": "user.xdg.origin.url", "value": "…base64…" } ]
```

- Stored: the `user.` namespace, and the POSIX ACLs
  `system.posix_acl_access` and `system.posix_acl_default` (value as the
  kernel returns it).
- Not stored: `security.*` (SELinux labels, capabilities), `trusted.*`, and
  any other namespace.
- Sorted by name; names are unique. Values are inline: Linux limits a value
  to 64 KiB, and trees are compressed.

### 4.6 `change`

```json
"change": { "ctime": 1794400000000, "ctimeNanos": 0, "ino": "1234567" }
```

What the writer needs to tell, at the next backup, whether a file may have
changed even though its size and `mtime` did not (a program that sets the
time back, for example). `ino` is a decimal string, because inode numbers
can exceed 2⁵³. Readers other than the writer's own backup ignore it.
Because it changes the tree, a folder whose files were only touched
(`chmod`, a new hard link) produces a new tree blob; that is intended.

### 4.7 What readers do with fields and types they do not know

- An **unknown field** on a known entry type is ignored. Future additions
  of this kind must never refer to blobs: anything that adds a blob
  reference needs a new format version.
- An **unknown entry type** is not restored; the reader says how many
  entries it skipped. **Prune and any other operation that removes data
  must stop** when it meets an unknown entry type, because it cannot know
  what that entry keeps alive.

### 4.8 Hard links

Version 2 stores every hard link as an ordinary file. The content is
stored once anyway, because blobs are deduplicated; a restore produces
independent files with the same content. Recording the link itself (for
example an optional `linkGroup` field) can be added later under 4.7 without
a new version, since a reader that ignores it still restores correct
files.

## 5. Snapshots

```json
{
  "format": 2,
  "id": "…16 random bytes, hex…",
  "time": "2026-11-14T10:00:00Z",
  "device": "orestes",
  "home": { "path": "/home/ana", "user": "ana", "uid": 1000, "gid": 1000 },
  "roots": [
    { "name": "home", "tree": "…blob id…", "source": { "kind": "home", "path": "" },
      "meta": { "mode": 448, "mtime": 1794400000000, "uid": 1000, "gid": 1000 } }
  ],
  "stats": { "files": 51234, "bytes": 81234567890, "skipped": 2, "changed": 1, "special": 3, "symlinks": 120 },
  "parent": "…previous snapshot id, or null…"
}
```

### 5.1 `home`

Where the backup came from: the absolute path of the home folder, the user
name and the numeric ids. Used to restore "to the original place" and to
decide whether owners can be restored (section 6). Optional; version 2
snapshots written by XkyHold-lx always have it.

### 5.2 Roots

- `name` and `tree` as in version 1.
- `source` (optional): where the root's tree comes from. `kind: "home"`
  with `path` relative to `home.path`, `""` being the home folder itself.
  XkyHold-lx writes one root for the home folder (`path: ""`), whose tree
  holds only what the user chose; folders on the way to a chosen item are
  included with their metadata and only the chosen children. Readers that
  do not need it treat the root as in version 1.
- `meta` (optional): the common metadata of section 4.1 for the root
  folder itself, which has no entry of its own.

An incremental backup finds its previous tree by `source`, not by `name`.

### 5.3 Stats

`files`, `bytes` and `skipped` as in version 1, plus, optional:

| Field | Counts |
|---|---|
| `changed` | Files that changed while being read, stored as read |
| `special` | Sockets, FIFOs and device files, which are never stored |
| `symlinks` | Symbolic links stored |

## 6. Restoring

What a restore must do with each field when it can (XkyHold-lx); section 8
says what a browser does.

- Write each file under a temporary name in its destination folder and
  rename it into place when complete. Never follow a symbolic link while
  restoring: create entries relative to an open folder, refusing to open
  links (`openat` with `O_NOFOLLOW`).
- Validate every name (section 4.1) before using it; a bad name is skipped
  and counted, never written.
- `mode`: apply `mode & 0o1777`. **Setuid and setgid are never restored.**
- `uid`/`gid`: applied only when the restoring user is the one in `home`
  (same `uid`) or when they equal the restoring user's own ids; otherwise
  the files belong to whoever restores them. Restores never need root.
- `xattrs`: applied when the destination file system supports them; a
  failure is counted, not fatal.
- Times: applied last, after content and attributes, and folders after
  their contents, so that writing into a folder does not change its time.
- Symbolic links: created with their stored `target`, unchanged.
- To the original place: never replace an existing item silently; the user
  chooses to skip, replace or keep both.

## 7. Upgrading a version 1 repository

Proposal (to be decided by the owner, `xkyhold-lx/docs/PLAN.md`, open
question 4): XkyHold-lx may back up into an existing version 1 repository
only after the user agrees to upgrade it. Upgrading rewrites `config` with
`"format": 2` and nothing else (keys and data untouched), the same way a
password change rewrites it. From then on XkyHold web older than the
version that reads version 2 refuses to connect (3.1) and, in a tab left
open, fails on the first version 2 snapshot (3.2). XkyHold-lx only offers
the upgrade once XkyHold web with version 2 support is published.

The alternative is that XkyHold-lx only writes into repositories it
created, and opens version 1 repositories for restoring and checking only.

## 8. XkyHold web and version 2

XkyHold web will (in its own phase of work):

- Accept `format: 2` and open snapshots with both AADs (3.2).
- Restore files and folders; ignore `mode`, owners, `xattrs` and
  `mtimeNanos` (a browser cannot set them); use `mtime` in `.zip` restores
  as now.
- Not restore symbolic links to a folder; in a `.zip`, store them as
  links (Unix mode `0o120777` in the external attributes, target as
  content). Either way, say how many items were not restored and why.
- Use `name` for display and writing, and handle display-form collisions
  as in 4.1.
- Treat `symlink` as an entry with no blobs in prune; stop on unknown types
  (4.7).
- Keep writing version 1 snapshots, which are valid in a version 2
  repository (3.3).

## 9. Local folder destination

The layout is the same as in Drive (FORMAT.md, section 3), inside a folder
the user chooses, typically `XkyHold/<repository name>` on an external
disk. Differences:

- Objects are written to a temporary name in the same folder, flushed to
  disk (`fsync`), renamed into place, and the folder is flushed.
- "Delete" moves the object to `trash/<dir>/<name>` inside the repository.
  Objects in `trash/` older than 30 days are removed by the next prune.
  Readers never look in `trash/`.
- A file system cannot hold two objects with the same name in one folder,
  so the duplicate case of FORMAT.md section 3 does not arise.
- There is no server checksum: the quick check (FORMAT.md 10.5) hashes the
  packs locally instead.

Neither the format nor the engine depends on which destination holds the
repository: a local repository copied into Drive (or the reverse) is still
valid.

## 10. Test vectors

- `golden-v1.json` and `golden-v1-repo.json` keep passing unchanged in
  every implementation.
- `golden-v2-repo.json`: a whole small `format: 2` repository, written once
  by the first implementation (XkyHold-lx) and frozen with this document.
  It holds one version 1 snapshot and one version 2 snapshot, and in the
  version 2 snapshot: a file with mode `0o755`, a file with `0o600`, an empty
  file, a file of more than one chunk (with a small chunk size recorded in
  the fixture), an empty folder with mode `0o700`, a relative symbolic link, a
  dangling symbolic link, a name that is not valid UTF-8, a `user.` extended
  attribute, nanosecond times, and a setuid bit that a restore must drop.
- Both engines (Rust and TypeScript) read it; the Rust engine also reads
  repositories written by the TypeScript engine, and the reverse.

## 11. What Google can observe

Unchanged from version 1. All version 2 metadata lives inside encrypted
trees and snapshots.
