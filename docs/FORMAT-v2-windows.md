# XkyHold repository format — version 2, Windows addendum

Status: **approved by the owner and frozen** on 20 November 2026
(decisions in section 10). Not implemented yet; XkyHold-wd implements it
first. The rules of `FORMAT-v2.md` apply: wording may be clarified, the
bytes it describes do not change, and its test vector (section 9) is
written once and never regenerated.

This addendum says how XkyHold-wd, the Windows app, writes version 2
repositories, and what every reader does with what it writes. **It is not
a new format version.** Everything here is either an optional field that
version 2 readers already ignore (`FORMAT-v2.md` 4.7), or a rule about
which existing fields a Windows writer fills. A repository written by
XkyHold-wd is an ordinary `format: 2` repository: XkyHold-lx 1.0 and
XkyHold web read it without changes, and the reverse holds too.

Everything this document does not mention is as in `FORMAT-v2.md`.

## 1. Constraints from the readers already released

The addendum is shaped by what XkyHold-lx 1.0.x and XkyHold web already do,
read in their code on 20 November 2026:

- Both ignore unknown fields in tree entries and snapshots.
- XkyHold-lx 1.0.x requires `uid` and `gid` inside the snapshot's `home`
  object when `home` is present. A Windows writer has no numeric ids, so it
  **never writes `home`** (which is optional in `FORMAT-v2.md` 5.1) and
  puts the Windows origin in a new field, `origin` (section 3.1).
- XkyHold-lx 1.0.x requires `ctime`, `ctimeNanos` and `ino` inside
  `change` when `change` is present. A Windows writer fills the same three
  fields (section 4.5).
- An unknown entry type stops prune in every version 2 reader (4.7). So a
  Windows writer adds **no new entry type**: everything it stores is a
  `file`, a `dir` or a `symlink`.

## 2. Who writes

- XkyHold-wd writes only into repositories created as `format: 2`, and
  only version 2 snapshots, exactly as XkyHold-lx (`FORMAT-v2.md` 3.3, 7).
  It opens version 1 repositories to browse, restore and check them, and
  never writes into them.
- One repository may hold snapshots from Linux and Windows computers. The
  content is deduplicated across them as usual.

## 3. Snapshots written on Windows

```json
{
  "format": 2,
  "id": "…",
  "time": "2026-11-20T10:00:00Z",
  "device": "ANA-LAPTOP",
  "origin": { "os": "windows", "path": "C:\\Users\\ana", "user": "ana", "sid": "S-1-5-21-…-1001" },
  "roots": [
    { "name": "home", "tree": "…", "source": { "kind": "home", "path": "" },
      "meta": { "mtime": 1794400000000, "winAttrs": [] },
      "leftOut": [ … ] }
  ],
  "stats": { "files": 51234, "bytes": 81234567890, "skipped": 0, "changed": 1, "symlinks": 4, "locked": 3, "cloudOnly": 1520, "badNames": 0 },
  "parent": "…"
}
```

### 3.1 `origin` (new, optional)

Where a Windows backup came from. No `home` field is written.

| Field | Type | Meaning |
|---|---|---|
| `os` | string | `"windows"` |
| `path` | string | The user folder (`%USERPROFILE%`) as Windows writes it, with `\` |
| `user` | string | The account name |
| `sid` | string | The account's security identifier, for "this backup came from another account" (like `uid` in `FORMAT-v2.md` 6) |

Readers that do not know `origin` see a snapshot without `home`: they can
browse and restore it to a folder, and do not offer "the original place".

### 3.2 Roots

As in `FORMAT-v2.md` 5.2. `source.kind` is `"home"` and `source.path` is
relative to `origin.path`, **with `/` between names** like every path in
the format. XkyHold-wd writes one root for the user folder (`path: ""`).

**Finding the previous tree.** `FORMAT-v2.md` 5.2 finds it by `source`.
In a repository shared by several computers, an incremental backup takes
the newest snapshot with the same `device` **and** the same `home.path` or
`origin.path` as its parent, then the root with the same `source`. (This
is what XkyHold-lx already does by device and home; written down here
because two systems can now share a repository.)

### 3.3 Stats

As in `FORMAT-v2.md` 5.3, plus, optional:

| Field | Counts |
|---|---|
| `locked` | Files another program held open without sharing (Windows error 32) or with a byte-range lock (error 33). Not stored; no partial file is ever stored |
| `badNames` | Items whose name is not valid UTF-16 (4.1). Not stored |
| `cloudOnly` | Cloud files that were not on this computer ("online-only": attribute `RECALL_ON_DATA_ACCESS` or `RECALL_ON_OPEN`, or Windows error 395). Not stored, because reading them would download them |

The snapshot holds only these counts. The paths behind `locked`,
`cloudOnly` and `badNames` are kept in the app's local log on the computer
that made the backup, and shown to the user there (decision D2).

`special` also counts reparse points of other kinds (section 4.4).
`mounts` is not used on Windows.

### 3.4 `leftOut` on Windows

Same structure as `FORMAT-v2.md` 5.4. The defaults XkyHold-wd writes:

```json
"leftOut": [
  { "kind": "default", "id": "temp", "patterns": ["AppData/Local/Temp"] },
  { "kind": "default", "id": "registry-hives", "patterns": ["NTUSER.DAT*", "ntuser.dat.LOG*", "ntuser.ini", "AppData/Local/Microsoft/Windows/UsrClass.dat*"] },
  { "kind": "default", "id": "app-state", "patterns": ["AppData/Local/xkyhold-wd", "AppData/Roaming/xkyhold-wd"] },
  { "kind": "default", "id": "cachedir-tag" },
  { "kind": "default", "id": "cloud-only" }
]
```

- `cloud-only` has no patterns: it names the rule of section 3.3.
- Patterns on Windows match names **without regard to case**, as the file
  system does. A reader showing the rules needs no change: patterns stay
  display data.

## 4. Tree entries written on Windows

### 4.1 Names

- `name` is the name converted from UTF-16 to UTF-8. Windows names never
  contain `/` or NUL, so the rules of `FORMAT-v2.md` 4.1 hold as they are.
- A name that is not valid UTF-16 (an unpaired surrogate, possible but
  rare) cannot be written as UTF-8 exactly. Such an item is **not stored**
  and is counted in `badNames` (3.3), and the app tells the user after the
  backup which items these were (their paths, with the bad part shown as
  U+FFFD) and why. `nameBytes` is never written by XkyHold-wd.
- Uniqueness and order follow `FORMAT-v2.md` 4.1 (bytes of the UTF-8
  name). Two names that differ only in case cannot exist in one Windows
  folder, so a Windows writer never produces them.

### 4.2 Fields

| Field | On Windows |
|---|---|
| `mtime` + `mtimeNanos` | From the last-write time (100 ns units since 1601), converted to the Unix epoch. `mtimeNanos` is therefore a multiple of 100 |
| `btime` + `btimeNanos` (new) | Creation time, split exactly like `mtime` + `mtimeNanos`. `FORMAT-v2.md` 4.10 does not store birth time on Linux; on Windows it is part of what users see, so it is stored |
| `winAttrs` (new) | Array of strings, sorted, from this fixed list: `readonly`, `hidden`, `system`, `archive`, `notIndexed`. Absent when empty. Other attributes are not stored (compressed, encrypted, sparse, temporary, offline, pinned and unpinned, integrity) |
| `mode`, `uid`, `gid`, `user`, `group`, `xattrs` | Not written |
| `change` | Section 4.5 |

Folders (`dir`) and the root's `meta` carry the same fields. Symbolic
links carry `mtime`, `btime` and `winAttrs` of the link itself.

### 4.3 Symbolic links and junctions

Windows symbolic links and junctions are stored as `symlink` entries
(`FORMAT-v2.md` 4.4), never followed:

```json
{ "name": "Projects", "type": "symlink", "target": "D:\\Projects", "link": "junction", "mtime": 1794400000000 }
```

| Field | Meaning |
|---|---|
| `target` | The target as Windows stores it (the print name, else the substitute name without its `\??\` prefix), with `\`. Relative or absolute, never resolved |
| `link` (new, optional) | `"file"` (file symbolic link), `"dir"` (folder symbolic link) or `"junction"`. Needed to recreate the link on Windows. Absent in links written on Linux |

Counted in `stats.symlinks`.

### 4.4 Other reparse points and special cases

| What is on disk | Stored as |
|---|---|
| A cloud file already on this computer (OneDrive "always keep" or downloaded) | An ordinary `file`: its data is local |
| A cloud file that is online-only | Nothing; counted in `cloudOnly` (3.3) |
| A file locked by another program | Nothing; counted in `locked` (3.3) |
| A hard link | An ordinary `file`, as in `FORMAT-v2.md` 4.8 |
| An EFS-encrypted file the user can read | An ordinary `file` with its readable content; the EFS encryption itself is not stored (the backup is encrypted by XkyHold) |
| A deduplicated file (Data Deduplication) | An ordinary `file` |
| Any other reparse point (app execution aliases in `AppData/Local/Microsoft/WindowsApps`, unknown tags) | Nothing; counted in `special` |

**Not stored on Windows:** alternate data streams (they would need blob
references, hence a new format version), security descriptors and ACLs
(the restore takes the permissions of the folder it writes into, which is
what a user expects of personal files), the file attributes not listed in
4.2, and short (8.3) names.

### 4.5 `change`

Same three fields as on Linux, so that every reader parses them:

- `ctime` + `ctimeNanos`: the change time (`ChangeTime` of
  `FILE_BASIC_INFO`), split like `mtime`.
- `ino`: the file ID (`FILE_ID_INFO`, 128 bits), as a decimal string.

Only the writer's own next backup reads `change`.

## 5. Restoring on Windows (XkyHold-wd)

From any version 2 repository, whatever system wrote it.

- As in `FORMAT-v2.md` 6: temporary name then rename; never follow a link
  or junction while restoring (open with `FILE_FLAG_OPEN_REPARSE_POINT` and
  check each folder on the way); times last, folders after their contents;
  never replace an item in the original place silently.
- Long paths are written with the `\\?\` prefix.
- **Owner and permissions:** never set. Every restored item inherits the
  permissions of the folder it is restored into.
- `winAttrs`: applied after the content and the times. `readonly` is
  applied last of all, because it would block setting the times.
- `btime` is applied when present.
- **Names Windows cannot create.** A name that contains `< > : " \ | ? *`
  or a control character, ends with a space or a dot, is a reserved device
  name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, also with
  an extension and with the superscript digits `¹ ² ³`), or is longer than
  255 UTF-16 units, is restored under a safe name: each forbidden character
  becomes `_`, a reserved name gets `_` appended, a trailing space or dot
  becomes `_`, and a long name is cut. The restore lists every renamed item
  with its original name.
- **Names that differ only in case** (possible in a Linux backup): the
  first in the tree's order keeps its name, the others are restored as
  `name (2).ext`, `name (3).ext`… and listed.
- **Symbolic links.**
  - `link: "junction"`: recreated as a junction (no special privilege).
  - `link: "file"` / `"dir"`: recreated as such, with
    `SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE`.
  - No `link` (a Linux link): recreated as a folder link if, once the
    restore is done, the target is a folder; otherwise as a file link.
    Links are created after everything else for that reason.
  - Windows refuses symbolic links to users without Developer Mode or
    the privilege to create them. Then the link is **not restored**, and
    the app tells the user at the end of the restore: which links, where
    each one pointed, and that turning on Developer Mode in Windows
    Settings and restoring again brings them back. Junctions are never
    affected.
  - The target is written as stored, with one exception: a **relative**
    target of a Linux link (no `link`, not starting with `/`) has each `/`
    written as `\`, because Windows does not follow a relative link
    written with `/` (decision D5). Nothing else is rewritten: a Linux
    target such as `/home/ana/x` or a Windows target from another computer
    may point nowhere, and the list says so. The repository keeps the
    target as it was stored.
- `mode`, owners and `xattrs` from a Linux backup are ignored, like a
  browser does (`FORMAT-v2.md` 8). Files whose name starts with a dot are
  not made hidden.

## 6. Restoring a Windows backup elsewhere

- **XkyHold-lx:** restores files, folders and links; ignores `winAttrs`,
  `btime`, `link` and `origin`. Items get the default permissions of the
  restoring user (`0o666`/`0o777` minus the umask). A link target with `\`
  or a drive letter is written as stored and will not resolve on Linux;
  the restore counts such links. "The original place" is not offered,
  because there is no `home`.
- **XkyHold web:** as for any version 2 repository (`FORMAT-v2.md` 8):
  files and folders restored, links not restored to a folder and stored as
  links in a `.zip`, unknown fields ignored.

None of this needs a change in the released readers. Showing the Windows
origin, or `cloudOnly` and `locked`, in XkyHold-lx or the web is optional
later work.

## 7. Local folder destination on Windows

As in `FORMAT-v2.md` 9, with Windows calls: a temporary name in the same
folder, `FlushFileBuffers`, `MoveFileEx` with
`MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH`. A network folder
(`\\server\share\…`) is a local folder for the format. Folders cannot be
flushed on Windows; the rename with write-through stands in for it.

## 8. What Google can observe

Unchanged. All the fields above live inside encrypted trees and snapshots.

## 9. Test vector

`golden-v2-windows-repo.json`: a whole small `format: 2` repository,
written once by the first Windows implementation (XkyHold-wd) and frozen
with this document. Version 2 snapshots only, with `origin` and without
`home`. It contains:

- files with `winAttrs` `readonly`, `hidden` + `system`, and none; an empty
  file; a file of more than one chunk (small chunk size recorded in the
  fixture);
- a folder with a creation time different from its modification time;
- times whose `mtimeNanos` and `btimeNanos` are not zero, and a time before
  1970;
- a file symbolic link, a folder symbolic link, a junction to an absolute
  target and a dangling relative link;
- a name with non-ASCII characters;
- `stats.locked` and `stats.badNames` not zero, and the matching items
  absent from the tree. Online-only cloud files (`cloudOnly`) and other
  reparse points (`special`) cannot be made in a temporary folder: they
  are tested against a real OneDrive folder and the real
  `AppData/Local/Microsoft/WindowsApps` on a Windows test machine, not
  frozen in the fixture (clarified 20 November 2026; the bytes of the
  format are unchanged);
- a `leftOut` list with the defaults of section 3.4 and one rule of each
  user kind.

Tests read it with the Rust engine (both apps share it) and the TypeScript
engine. Cross round trips: a repository written on Windows restored by the
Linux build and by the web engine, and one written on Linux restored on
Windows, covering the renaming rules of section 5. `golden-v1*.json` and
`golden-v2-repo.json` keep passing unchanged.

## 10. Decisions of the owner (20 November 2026)

| # | Question | Decision |
|---|---|---|
| D1 | A name that is not valid UTF-16 | Not stored, counted in `badNames`, and the user is told which items and why (4.1) |
| D2 | Which files were locked or online-only in a given backup | Counts in the snapshot; the list of paths only in the app's local log on that computer |
| D3 | Restoring a symbolic link when Windows refuses it (no Developer Mode) | Not restored; the user is told which links, their targets, and how to get them back (5) |
| D4 | Creation time | Stored (`btime`) and restored on Windows |
| D5 | A relative Linux link target written with `/`, restored on Windows (21 November 2026, found in XkyHold-wd's Phase 6) | Each `/` becomes `\` when the link is created, so Windows follows it; the stored target does not change (5) |
