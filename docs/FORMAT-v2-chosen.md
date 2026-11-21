# XkyHold repository format — version 2, addendum: the chosen items

Status: **approved by the owner and frozen** on 21 November 2026, the day
the owner decided that a backup records the "only some folders" choice
(XkyHold-wd `docs/PLAN.md`, section 8). Implemented in XkyHold engine
`f3781f7`. The rules of `FORMAT-v2.md` apply: wording may be clarified,
the bytes it describes do not change.

This addendum adds one optional field to a snapshot's roots. **It is not a
new format version.** Version 2 readers already ignore unknown fields in
snapshots (`FORMAT-v2.md` 4.7, `FORMAT-v2-windows.md` 1), so a snapshot
with this field is read by XkyHold-lx 1.0.x and XkyHold web as before, and
a snapshot without it means what it always meant.

Everything this document does not mention is as in `FORMAT-v2.md` and,
for Windows writers, `FORMAT-v2-windows.md`.

## 1. Why

A version 2 backup records the rules that left things out (`leftOut`,
`FORMAT-v2.md` 5.4), but not that the user chose to save only some items
of the home folder or user folder. The tree holds only what was chosen
(`FORMAT-v2.md` 5.2), yet nothing says it was a choice. So when a computer
connects to an existing backup (a new computer, or the same one after its
settings were removed), the app can bring back what was left out but not
what was chosen, and would go back to saving the whole folder.

## 2. `chosen` (new, optional)

On a root with `source.kind: "home"`:

```json
{ "name": "home", "tree": "…blob id…", "source": { "kind": "home", "path": "" },
  "chosen": [ { "path": "Documents/Photos" }, { "path": "Desktop" } ],
  "leftOut": [ … ] }
```

- Present only when the user chose to save only some items. Absent means
  the whole `source` folder, minus `leftOut`, as before.
- An array of the items the user chose, in the order the writer keeps
  them. Each item is an object with `path`, relative to the root's
  `source.path` with `/` between names, or `pathBytes` (base64) instead
  when the path is not valid UTF-8, as in `FORMAT-v2.md` 4.1 and 5.4.
- It records the choice, not the result: an item that did not exist when
  the backup ran is still listed, and the tree simply does not hold it.
- `leftOut` still applies inside the chosen items.
- Never an empty array: a writer with nothing chosen omits the field.

## 3. Readers

- `chosen` is for display and for carrying the choice over when a
  computer connects to the backup. It never changes what is restored, and
  readers that do not need it ignore it.
- A reader that carries the choice over shows it to the user to confirm
  before the next backup, since the folders may not exist on this
  computer.

## 4. Writers

- XkyHold-wd and XkyHold-lx may write it, in version 2 snapshots only.
  XkyHold web writes version 1 snapshots and never writes it.
- Writing it changes no other field.

## 5. What Google can observe

Nothing new: the field is inside the encrypted snapshot.

## 6. Test vector

No new frozen fixture. The frozen fixtures (`golden-v2-repo.json`,
`golden-v2-windows-repo.json`) have no `chosen` and keep passing unchanged.
The engine tests a backup with a choice: the snapshot records it, the
choice is read back, and a snapshot without it reads as before.
