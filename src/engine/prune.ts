// Retention and prune (docs/FORMAT.md, section 10.3).
//
// The order of operations is the whole point: at every moment, every index
// file in the destination refers only to packs that still exist, and every
// remaining snapshot can be restored. An interruption leaves extra files,
// never missing ones.

import type { BlobType } from './pack'
import type { Repository, Snapshot } from './repo'

/** Snapshots older than `keepMonths`, oldest first. Never the newest one. */
export function expired(snapshots: Snapshot[], keepMonths: number, now: Date): Snapshot[] {
  if (keepMonths <= 0 || snapshots.length <= 1) return []
  const cutoff = new Date(now)
  cutoff.setMonth(cutoff.getMonth() - keepMonths)
  const sorted = [...snapshots].sort((a, b) => a.time.localeCompare(b.time))
  return sorted.slice(0, -1).filter((s) => Date.parse(s.time) < cutoff.getTime())
}

/** Trashes expired snapshots. Returns the ones kept and the ones removed. */
export async function forget(
  repo: Repository,
  snapshots: Snapshot[],
  keepMonths: number,
  now: Date,
): Promise<{ kept: Snapshot[]; removed: Snapshot[] }> {
  const removed = expired(snapshots, keepMonths, now)
  for (const snapshot of removed) await repo.trashSnapshot(snapshot.id)
  const gone = new Set(removed.map((s) => s.id))
  return { kept: snapshots.filter((s) => !gone.has(s.id)), removed }
}

export interface PruneResult {
  packsRemoved: number
  packsRewritten: number
  bytesFreed: number
}

export interface PruneOptions {
  signal?: AbortSignal
  /** Rewrite a pack when less than this fraction of it is still used. */
  repackBelow?: number
}

/** Every blob that the given snapshots need, trees and data alike. */
async function reachable(repo: Repository, snapshots: Snapshot[], signal?: AbortSignal): Promise<Set<string>> {
  const live = new Set<string>()
  const todo = snapshots.flatMap((s) => s.roots.map((r) => r.tree))
  while (todo.length > 0) {
    signal?.throwIfAborted()
    const tree = todo.pop()!
    if (live.has(tree)) continue
    live.add(tree)
    // If a listing cannot be read we stop here, before removing anything.
    for (const entry of await repo.loadTree(tree)) {
      if (entry.type === 'dir') todo.push(entry.subtree)
      else for (const id of entry.content) live.add(id)
    }
  }
  return live
}

/**
 * Frees the space of data no remaining snapshot needs. The caller holds
 * the prune lock. The snapshots and the index are read again here, from
 * the destination, so that work done by another device since this
 * instance was opened is never mistaken for garbage.
 */
export async function prune(repo: Repository, options: PruneOptions = {}): Promise<PruneResult> {
  const { signal } = options
  const repackBelow = options.repackBelow ?? 0.5
  await repo.loadIndex()
  const live = await reachable(repo, await repo.listSnapshots(), signal)

  const stored = new Map((await repo.dest.list('packs', true)).map((o) => [o.name, o.size]))
  const known = repo.packs()
  const remove = new Set<string>()
  let rewritten = 0

  // With the lock held, a pack that no index mentions belongs to a backup
  // that never finished: nothing can refer to it.
  for (const name of stored.keys()) if (!known.has(name)) remove.add(name)

  for (const [name, blobs] of known) {
    signal?.throwIfAborted()
    if (!stored.has(name)) continue // already gone; restore would report it
    const used = blobs.filter((b) => live.has(b.id))
    if (used.length === 0) {
      remove.add(name)
      continue
    }
    const total = blobs.reduce((n, b) => n + b.length, 0)
    const usedBytes = used.reduce((n, b) => n + b.length, 0)
    if (usedBytes / total >= repackBelow) continue
    for (const blob of used) {
      await repo.rewriteBlob(blob.type as BlobType, blob.id, await repo.loadBlob(blob.type as BlobType, blob.id), signal)
    }
    remove.add(name)
    rewritten++
  }

  if (remove.size === 0) return { packsRemoved: 0, packsRewritten: 0, bytesFreed: 0 }

  // 1. New packs and their index are safely stored.
  await repo.flush(signal)
  // 2. One index that no longer mentions the packs about to go.
  repo.dropPacks(remove)
  await repo.consolidateIndex(signal)
  // 3. Only now the old packs.
  let bytesFreed = 0
  for (const name of remove) {
    await repo.dest.trash('packs', name)
    bytesFreed += stored.get(name) ?? 0
  }
  return { packsRemoved: remove.size, packsRewritten: rewritten, bytesFreed }
}
