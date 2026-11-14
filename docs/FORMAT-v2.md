# XkyHold repository format — version 2

Status: **approved by the owner and frozen** on 14 November 2026. Not
implemented yet; XkyHold-lx implements it first. The rules of version 1
apply from here on:

- Version 2 does not change in incompatible ways. Wording may be
  clarified, as long as it describes the same bytes.
- `golden-v2-repo.json` (section 10) is written once by the first
  implementation and never regenerated. If a test against it fails, the
  change is wrong.

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
   extended attributes and, where the restoring user belongs to it, the
   group.
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
| Snapshot | `id`, `time`, `device`, `roots`, `stats`, `parent` | Adds `format: 2`, optional `home`, `source`, `meta` and `leftOut` per root, more `stats`; encrypted with AAD `xkyhold/v2/snapshot/<id>` |
| Tree entry types | `file`, `dir` | Adds `symlink`; a mount point that is not crossed is an empty `dir` (4.9) |
| Entry fields | `name`, `size`, `mtime` (ms), `content` / `subtree` | Adds optional `nameBytes`, `mtimeNanos`, `mode`, `uid`, `gid`, `user`, `group`, `xattrs`, `change`; folders get the same metadata |
| Who writes | XkyHold web | XkyHold-lx writes only into `format: 2` repositories; XkyHold web only restores from them (sections 7 and 8) |
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
backup this browser already knows, with the keys kept in IndexedDB.
Version 2 never turns a version 1 repository into a version 2 one (section
7), so that path should never meet a version 2 snapshot. The rule below is
defence in depth for the day it does (an in-place upgrade specified later,
or a `config` copied by hand): without it, that path would load version 2
snapshots and trees as if they were version 1, its restore would fail on a
symbolic link in an unhelpful way, and its prune would read a tree it does
not understand.

So every version 2 snapshot is sealed with a different AAD:

| Object | AAD (ASCII) |
|---|---|
| Version 1 snapshot | `xkyhold/v1/snapshot/<snapshot id>` |
| Version 2 snapshot | `xkyhold/v2/snapshot/<snapshot id>` |

A version 1 reader fails to authenticate a version 2 snapshot, and because
it lists all snapshots before it backs up, restores or prunes, it stops
before reading any version 2 tree. It says the backup is damaged, which is
wrong but safe. Version 2 trees are only reachable from
version 2 snapshots, so no other object needs a new AAD.

A version 2 reader opens a snapshot with the version 2 AAD first and, if
that fails authentication, with the version 1 AAD. The plaintext also
carries `"format": 2`; a snapshot whose `format` disagrees with the AAD
that opened it is damaged.

### 3.3 Mixed repositories

The format allows a `format: 2` repository to hold version 1 and version 2
snapshots side by side, sharing blobs, and readers accept both (3.2). A
version 1 snapshot never refers to a tree containing version 2 fields or
types.

No first-version writer produces a version 1 snapshot in a `format: 2`
repository: XkyHold-lx writes only version 2 snapshots, and XkyHold web
does not write into `format: 2` repositories at all (section 8). The rule
exists so that a later writer may do so without a new format version.

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

### 4.9 Mount points

Another file system mounted inside the home folder (a second disk, a
network share, a FUSE mount) is not crossed unless the user chose to cross
it. A folder whose device differs from its parent's and that is not
crossed is stored as a `dir` entry with its own metadata and an empty
subtree (`{ "entries": [] }`), so that a restore recreates the mount point
as an empty folder. It may carry `"mount": true` (optional, for display:
"another disk, not backed up"); readers that ignore it restore an empty
folder. Each such folder is counted in `stats.mounts` (5.3). A mount point
the user chose to cross is stored like any folder.

### 4.10 Not stored

- **Holes in sparse files.** A sparse file is stored expanded. Its zero
  chunks all have the same id and are stored once. A restore may recreate
  holes; that is the restore's freedom, not a matter of the format.
- **File flags** set with `chattr` (immutable, append-only, btrfs
  `nodatacow`, …).
- **Creation (birth) time.**
- What section 4.5 leaves out of extended attributes, and the special
  files counted in `stats.special`.

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
tell the user when a backup came from another account (section 6). Optional; version 2
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
- `leftOut` (optional): the rules that decided what was left out of this
  root in this backup (5.4).

An incremental backup finds its previous tree by `source`, not by `name`.

### 5.3 Stats

`files`, `bytes` and `skipped` as in version 1, plus, optional:

| Field | Counts |
|---|---|
| `changed` | Files that changed while being read, stored as read |
| `special` | Sockets, FIFOs and device files, which are never stored |
| `symlinks` | Symbolic links stored |
| `mounts` | Mount points not crossed, stored as empty folders (4.9) |

### 5.4 `leftOut`

The exclusion rules in force for a root when the backup ran, so that the
app can answer "why is this folder not in the backup?" for that backup,
even after the rules have changed. It holds the **rules**, not the list of
paths they excluded, which could run to thousands of entries. Readers
ignore it for restoring; it is for display only.

```json
"leftOut": [
  { "kind": "default", "id": "cache", "patterns": [".cache"] },
  { "kind": "default", "id": "trash", "patterns": [".local/share/Trash"] },
  { "kind": "default", "id": "app-state", "patterns": [".cache/xkyhold-lx", ".local/state/xkyhold-lx"] },
  { "kind": "default", "id": "cachedir-tag" },
  { "kind": "default", "id": "other-file-systems" },
  { "kind": "preset", "id": "node-modules", "patterns": ["**/node_modules"] },
  { "kind": "path", "path": "Downloads" },
  { "kind": "pattern", "patterns": ["**/*.iso"] },
  { "kind": "cross-mount", "path": "Data" }
]
```

An array of rules, in the order the writer applied them:

| `kind` | Meaning |
|---|---|
| `default` | Always left out by the writer. With `patterns`, the paths they match. Without, a rule named by `id`: `cachedir-tag` (folders holding a `CACHEDIR.TAG` file) and `other-file-systems` (mount points not crossed, 4.9) |
| `preset` | A suggestion the user switched on (`node_modules`, build folders, browser caches…), with the `patterns` it stands for |
| `path` | A folder or file the user unticked in the leave-out tree |
| `pattern` | Glob `patterns` the user wrote |
| `cross-mount` | An exception: a mount point the user chose to cross |

- `id` is the writer's name for a default or preset; readers show it or
  ignore it, and must not need to know it, since `patterns` says what it
  matched.
- `path` is relative to the root's `source.path`, with `/` between names;
  `pathBytes` (base64) replaces it when it is not valid UTF-8, as in 4.1.
- Patterns are relative to the same folder and match whole paths: `*` and
  `?` match within one name, and `**` matches any number of whole names,
  including none. Patterns are anchored there: `.cache` matches only the
  `.cache` at the top, and `**/node_modules` matches one at any depth.
- Mount points not crossed are also visible in the trees (4.9); the
  `other-file-systems` rule says why.
- Unknown `kind` values are shown as they are or ignored; they never change
  what is restored.

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
- **Owner:** never changed. Every restored item belongs to the user who
  restores it (without root, changing the owner to another user fails
  anyway). Restores never need root.
- **Group:** restored only when the restoring user is a member of that
  group (primary or supplementary); otherwise the item keeps the group it
  was created with.
- **Matching names and numbers:** `user` and `group` names win over the
  numeric `uid` and `gid` when the name exists on the restoring system;
  otherwise the number is used. The same rule decides whether the stored
  owner is the restoring user, for example to warn that a backup came from
  another account.
- `xattrs`: applied when the destination file system supports them; a
  failure is counted, not fatal.
- Times: applied last, after content and attributes, and folders after
  their contents, so that writing into a folder does not change its time.
- Symbolic links: created with their stored `target`, unchanged.
- To the original place: never replace an existing item silently; the user
  chooses to skip, replace or keep both.

## 7. Version 1 repositories

XkyHold-lx writes only into repositories created as `format: 2`. It opens
version 1 repositories to browse, restore and check them, and never writes
into them: no backup, no retention, no prune, no change to `config`.

Version 2 does not specify an in-place upgrade from version 1. One can be
specified later if there is demand; section 3.2 already keeps an old reader
safe if that happens.

## 8. XkyHold web and version 2

In its first version with version 2 support, XkyHold web is
**restore-only on `format: 2` repositories**: it connects to them, browses,
restores and checks, but does not back up into them and does not prune
them (retention included), and says so when the user opens one. It will
(in its own phase of work):

- Accept `format: 2` and open snapshots with both AADs (3.2).
- Restore files and folders; ignore `mode`, owners, `xattrs` and
  `mtimeNanos` (a browser cannot set them); use `mtime` in `.zip` restores
  as now.
- Not restore symbolic links to a folder; in a `.zip`, store them as
  links (Unix mode `0o120777` in the external attributes, target as
  content). Either way, say how many items were not restored and why.
- Use `name` for display and writing, and handle display-form collisions
  as in 4.1.
- Restore a mount point (4.9) as an empty folder.
- Keep backing up and pruning version 1 repositories exactly as today.

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
  It holds version 2 snapshots only, since no first-version writer
  produces a version 1 snapshot in a `format: 2` repository (3.3); reading
  version 1 snapshots is covered by the version 1 fixtures. It contains:
  - a file with mode `0o755`, a file with `0o600`, an empty file, and a
    file of more than one chunk (with a small chunk size recorded in the
    fixture);
  - an empty folder with mode `0o700`;
  - a relative symbolic link and a dangling symbolic link;
  - a name that is not valid UTF-8, and two invalid names with the same
    display form in one folder;
  - a `user.` extended attribute and a POSIX ACL
    (`system.posix_acl_access`);
  - nanosecond times, and a modification time before 1970, to pin the
    "round towards minus infinity" rule of `mtime` + `mtimeNanos` in both
    languages;
  - a mount point that was not crossed (4.9);
  - a `leftOut` list on the root with one rule of every kind (5.4), and
    the matching items absent from the tree;
  - a setuid bit that a restore must drop.
- Both engines (Rust and TypeScript) read it. Cross round trips: the Rust
  engine reads version 1 repositories written by the TypeScript engine,
  and the TypeScript engine reads version 2 repositories written by the
  Rust engine.

## 11. What Google can observe

Unchanged from version 1. All version 2 metadata lives inside encrypted
trees and snapshots.
