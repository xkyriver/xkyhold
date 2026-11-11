import { describe, expect, it } from 'vitest'
import { fromHex, utf8 } from './bytes'
import {
  AuthenticationError,
  blobId,
  changePassword,
  createRepository,
  deriveRepoKeys,
  FormatError,
  open,
  seal,
  SEAL_OVERHEAD,
  unlockRepository,
  WrongKeyError,
} from './crypto'

// Cheap Argon2 parameters: these tests check the logic, not the cost.
const FAST = { memoryKiB: 64, iterations: 1, parallelism: 1 }
const MASTER = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
const REPO = '00112233445566778899aabbccddeeff'

describe('seal / open', () => {
  it('round-trips and adds a fixed overhead', async () => {
    const { encKey } = await deriveRepoKeys(MASTER, REPO)
    const sealed = await seal(encKey, utf8('hello'), 'role')
    expect(sealed.length).toBe(5 + SEAL_OVERHEAD)
    expect(await open(encKey, sealed, 'role')).toEqual(utf8('hello'))
  })

  it('uses a fresh nonce every time', async () => {
    const { encKey } = await deriveRepoKeys(MASTER, REPO)
    expect(await seal(encKey, utf8('x'), 'r')).not.toEqual(await seal(encKey, utf8('x'), 'r'))
  })

  it('rejects another role, a flipped bit, a short object and another repository', async () => {
    const { encKey } = await deriveRepoKeys(MASTER, REPO)
    const sealed = await seal(encKey, utf8('hello'), 'role')
    await expect(open(encKey, sealed, 'other')).rejects.toThrow(AuthenticationError)
    const tampered = sealed.slice()
    tampered[20] ^= 1
    await expect(open(encKey, tampered, 'role')).rejects.toThrow(AuthenticationError)
    await expect(open(encKey, sealed.subarray(0, 10), 'role')).rejects.toThrow(AuthenticationError)
    const other = await deriveRepoKeys(MASTER, 'ffffffffffffffffffffffffffffffff')
    await expect(open(other.encKey, sealed, 'role')).rejects.toThrow(AuthenticationError)
  })
})

describe('blobId', () => {
  it('is stable for the same content and differs across repositories', async () => {
    const a = await deriveRepoKeys(MASTER, REPO)
    const b = await deriveRepoKeys(MASTER, 'ffffffffffffffffffffffffffffffff')
    expect(await blobId(a, utf8('abc'))).toBe(await blobId(a, utf8('abc')))
    expect(await blobId(a, utf8('abc'))).not.toBe(await blobId(a, utf8('abd')))
    expect(await blobId(a, utf8('abc'))).not.toBe(await blobId(b, utf8('abc')))
  })
})

describe('repository keys', () => {
  it('unlocks with the password and with the recovery key, to the same keys', async () => {
    const repo = await createRepository('correct horse', FAST)
    const id = await blobId(repo.keys, utf8('abc'))
    const byPassword = await unlockRepository(repo.config, { password: 'correct horse' })
    const byRecovery = await unlockRepository(repo.config, { recoveryKey: repo.recoveryKey.toLowerCase() })
    expect(await blobId(byPassword, utf8('abc'))).toBe(id)
    expect(await blobId(byRecovery, utf8('abc'))).toBe(id)
  })

  it('rejects a wrong password and a wrong or malformed recovery key', async () => {
    const repo = await createRepository('correct horse', FAST)
    const other = await createRepository('x', FAST)
    await expect(unlockRepository(repo.config, { password: 'wrong' })).rejects.toThrow(WrongKeyError)
    await expect(unlockRepository(repo.config, { recoveryKey: other.recoveryKey })).rejects.toThrow(WrongKeyError)
    await expect(unlockRepository(repo.config, { recoveryKey: 'nonsense' })).rejects.toThrow(WrongKeyError)
  })

  it('treats composed and decomposed accents as the same password', async () => {
    const repo = await createRepository('café', FAST)
    await expect(unlockRepository(repo.config, { password: 'café' })).resolves.toBeDefined()
  })

  it('stores neither the password nor the keys in the config', async () => {
    const repo = await createRepository('correct horse', FAST)
    const json = JSON.stringify(repo.config)
    expect(json).not.toContain('correct horse')
    expect(json).not.toContain(repo.recoveryKey.replace(/-/g, ''))
    expect(repo.config.keys.map((k) => k.type)).toEqual(['password', 'recovery'])
  })

  it('changes the password, keeping the data keys and the recovery key', async () => {
    const repo = await createRepository('old', FAST)
    const id = await blobId(repo.keys, utf8('abc'))
    const updated = await changePassword(repo.config, { password: 'old' }, 'new', FAST)
    await expect(unlockRepository(updated, { password: 'old' })).rejects.toThrow(WrongKeyError)
    expect(await blobId(await unlockRepository(updated, { password: 'new' }), utf8('abc'))).toBe(id)
    expect(await blobId(await unlockRepository(updated, { recoveryKey: repo.recoveryKey }), utf8('abc'))).toBe(id)
  })

  it('sets a new password from the recovery key when the old one is forgotten', async () => {
    const repo = await createRepository('forgotten', FAST)
    const updated = await changePassword(repo.config, { recoveryKey: repo.recoveryKey }, 'new', FAST)
    await expect(unlockRepository(updated, { password: 'new' })).resolves.toBeDefined()
  })

  it('refuses a newer format and something that is not a config', async () => {
    const repo = await createRepository('p', FAST)
    await expect(unlockRepository({ ...repo.config, format: 2 }, { password: 'p' })).rejects.toThrow(FormatError)
    await expect(unlockRepository({} as never, { password: 'p' })).rejects.toThrow(FormatError)
  })

  it('opens with the real Argon2id cost', async () => {
    const repo = await createRepository('correct horse')
    expect(repo.config.keys[0]).toMatchObject({ memoryKiB: 65536, iterations: 3, parallelism: 1 })
    await expect(unlockRepository(repo.config, { password: 'correct horse' })).resolves.toBeDefined()
  })
})
