// Cryptography for the repository format (docs/FORMAT.md, section 4).
// Everything here is WebCrypto except Argon2id, which is WebAssembly.

import { argon2id } from 'hash-wasm'
import { concat, fromBase32Groups, fromBase64, randomBytes, toBase32Groups, toBase64, toHex, utf8 } from './bytes'
import type { Bytes } from './bytes'

export const FORMAT_VERSION = 1
const NONCE_LENGTH = 12
const TAG_LENGTH = 16
const KEY_LENGTH = 32

/** The data did not authenticate: wrong key, wrong role, or corruption. */
export class AuthenticationError extends Error {
  constructor(message = 'Data failed authentication') {
    super(message)
    this.name = 'AuthenticationError'
  }
}

/** The password or recovery key does not open this repository. */
export class WrongKeyError extends Error {
  constructor() {
    super('Wrong password or recovery key')
    this.name = 'WrongKeyError'
  }
}

export class FormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormatError'
  }
}

// --- Encrypted objects --------------------------------------------------

/** nonce || ciphertext || tag, bound to `aad` (the object's role). */
export async function seal(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<Bytes> {
  const nonce = randomBytes(NONCE_LENGTH)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: utf8(aad), tagLength: TAG_LENGTH * 8 },
    key,
    plaintext as Bytes,
  )
  return concat(nonce, new Uint8Array(ciphertext))
}

export async function open(key: CryptoKey, sealed: Uint8Array, aad: string): Promise<Bytes> {
  if (sealed.length < NONCE_LENGTH + TAG_LENGTH) throw new AuthenticationError('Encrypted object is too short')
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.subarray(0, NONCE_LENGTH) as Bytes, additionalData: utf8(aad), tagLength: TAG_LENGTH * 8 },
      key,
      sealed.subarray(NONCE_LENGTH) as Bytes,
    )
    return new Uint8Array(plaintext)
  } catch {
    throw new AuthenticationError()
  }
}

/** Bytes added to a plaintext by `seal`. */
export const SEAL_OVERHEAD = NONCE_LENGTH + TAG_LENGTH

// --- Keys ---------------------------------------------------------------

export interface RepoKeys {
  repoId: string
  encKey: CryptoKey
  idKey: CryptoKey
}

const aesKey = (raw: Uint8Array): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', raw as Bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])

const hkdfKey = (raw: Uint8Array): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', raw as Bytes, 'HKDF', false, ['deriveKey'])

const hkdf = (info: string): HkdfParams => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) })

/** Derives the working keys from the master key (section 4.1). */
export async function deriveRepoKeys(masterKey: Uint8Array, repoId: string): Promise<RepoKeys> {
  const master = await hkdfKey(masterKey)
  const [encKey, idKey] = await Promise.all([
    crypto.subtle.deriveKey(hkdf(`xkyhold/v1/enc/${repoId}`), master, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]),
    crypto.subtle.deriveKey(
      hkdf(`xkyhold/v1/id/${repoId}`),
      master,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign'],
    ),
  ])
  return { repoId, encKey, idKey }
}

/** HMAC-SHA-256(idKey, plaintext) as hex: the blob's identity. */
export async function blobId(keys: RepoKeys, plaintext: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', keys.idKey, plaintext as Bytes)))
}

// --- Config and key slots ----------------------------------------------

export interface Argon2Params {
  memoryKiB: number
  iterations: number
  parallelism: number
}

export const DEFAULT_ARGON2: Argon2Params = { memoryKiB: 64 * 1024, iterations: 3, parallelism: 1 }

export interface PasswordSlot extends Argon2Params {
  type: 'password'
  kdf: 'argon2id'
  salt: string
  wrappedMasterKey: string
}

export interface RecoverySlot {
  type: 'recovery'
  kdf: 'hkdf-sha256'
  wrappedMasterKey: string
}

export type KeySlot = PasswordSlot | RecoverySlot

export interface RepoConfig {
  format: number
  repoId: string
  created: string
  chunker: { type: 'fixed'; size: number }
  keys: KeySlot[]
}

export const CHUNK_SIZE = 4 * 1024 * 1024

const keyAad = (repoId: string) => `xkyhold/v1/key/${repoId}`

async function passwordKek(password: string, salt: Uint8Array, params: Argon2Params): Promise<CryptoKey> {
  const raw = await argon2id({
    password: password.normalize('NFC'),
    salt,
    memorySize: params.memoryKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: KEY_LENGTH,
    outputType: 'binary',
  })
  return aesKey(raw)
}

async function recoveryKek(recoveryKey: Uint8Array, repoId: string): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    hkdf(`xkyhold/v1/recovery/${repoId}`),
    await hkdfKey(recoveryKey),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function passwordSlot(
  password: string,
  masterKey: Uint8Array,
  repoId: string,
  params: Argon2Params,
): Promise<PasswordSlot> {
  const salt = randomBytes(32)
  const kek = await passwordKek(password, salt, params)
  return {
    type: 'password',
    kdf: 'argon2id',
    ...params,
    salt: toBase64(salt),
    wrappedMasterKey: toBase64(await seal(kek, masterKey, keyAad(repoId))),
  }
}

export type Credential = { password: string } | { recoveryKey: string }

export interface NewRepository {
  config: RepoConfig
  keys: RepoKeys
  /** Shown to the user once; never stored. */
  recoveryKey: string
}

export async function createRepository(password: string, params: Argon2Params = DEFAULT_ARGON2): Promise<NewRepository> {
  const repoId = toHex(randomBytes(16))
  const masterKey = randomBytes(KEY_LENGTH)
  const recovery = randomBytes(KEY_LENGTH)
  const config: RepoConfig = {
    format: FORMAT_VERSION,
    repoId,
    created: new Date().toISOString(),
    chunker: { type: 'fixed', size: CHUNK_SIZE },
    keys: [
      await passwordSlot(password, masterKey, repoId, params),
      {
        type: 'recovery',
        kdf: 'hkdf-sha256',
        wrappedMasterKey: toBase64(await seal(await recoveryKek(recovery, repoId), masterKey, keyAad(repoId))),
      },
    ],
  }
  return { config, keys: await deriveRepoKeys(masterKey, repoId), recoveryKey: toBase32Groups(recovery) }
}

function checkConfig(config: RepoConfig): void {
  if (typeof config?.format !== 'number') throw new FormatError('This is not an XkyHold backup')
  if (config.format !== FORMAT_VERSION) {
    throw new FormatError(`This backup uses format ${config.format}, which this version of XkyHold cannot read`)
  }
}

async function unwrapMasterKey(config: RepoConfig, credential: Credential): Promise<Bytes> {
  checkConfig(config)
  const aad = keyAad(config.repoId)
  for (const slot of config.keys) {
    let kek: CryptoKey | null = null
    if ('password' in credential && slot.type === 'password' && slot.kdf === 'argon2id') {
      kek = await passwordKek(credential.password, fromBase64(slot.salt), slot)
    } else if ('recoveryKey' in credential && slot.type === 'recovery' && slot.kdf === 'hkdf-sha256') {
      const raw = fromBase32Groups(credential.recoveryKey, KEY_LENGTH)
      if (raw) kek = await recoveryKek(raw, config.repoId)
    }
    if (!kek) continue
    try {
      return await open(kek, fromBase64(slot.wrappedMasterKey), aad)
    } catch {
      // not this slot; try the next
    }
  }
  throw new WrongKeyError()
}

/** Opens a repository with the password or the recovery key. */
export async function unlockRepository(config: RepoConfig, credential: Credential): Promise<RepoKeys> {
  return deriveRepoKeys(await unwrapMasterKey(config, credential), config.repoId)
}

/**
 * Returns a config with a new password. `credential` is the current
 * password, or the recovery key when the password was forgotten. The
 * recovery slot and the data are untouched.
 */
export async function changePassword(
  config: RepoConfig,
  credential: Credential,
  newPassword: string,
  params: Argon2Params = DEFAULT_ARGON2,
): Promise<RepoConfig> {
  const masterKey = await unwrapMasterKey(config, credential)
  const slot = await passwordSlot(newPassword, masterKey, config.repoId, params)
  return { ...config, keys: [slot, ...config.keys.filter((k) => k.type !== 'password')] }
}
