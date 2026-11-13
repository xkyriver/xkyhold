// The chosen folders as the engine backs them up: each loose folder is a
// top-level folder of the snapshot, and each folder made in XkyHold groups
// the folders it holds. Plain values only: this crosses to the worker.

import type { BackupRoot } from '../engine/backup'
import type { SavedFolder } from '../fs/folders'

export function backupRoots(folders: SavedFolder[]): BackupRoot[] {
  const roots: BackupRoot[] = []
  const groups = new Map<string, BackupRoot>()
  for (const folder of folders) {
    const leaveOut = [...(folder.leaveOut ?? [])]
    if (!folder.group) {
      // Files only live inside a folder made in XkyHold.
      if (folder.handle.kind === 'directory') roots.push({ name: folder.name, handle: folder.handle, leaveOut })
      continue
    }
    let group = groups.get(folder.group)
    if (!group) {
      group = { name: folder.group, members: [], leaveOut: [] }
      groups.set(folder.group, group)
      roots.push(group)
    }
    group.members!.push(folder.handle)
    group.leaveOut!.push(...leaveOut.map((path) => `${folder.name}/${path}`))
  }
  return roots
}
