// Minimal shapes of the File System Access API that XkyHold relies on.
// Declared here because parts of it (showDirectoryPicker, the permission
// methods) are Chromium-only and missing from TypeScript's DOM types, and
// so that tests can pass plain fakes.

export type PermissionState = 'granted' | 'prompt' | 'denied'

export interface FileLike {
  readonly size: number
  readonly lastModified: number
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> }
}

export interface FileHandleLike {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<FileLike>
  queryPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>
  requestPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>
  isSameEntry?(other: DirHandleLike | FileHandleLike): Promise<boolean>
}

export interface DirHandleLike {
  readonly kind: 'directory'
  readonly name: string
  values(): AsyncIterable<FileHandleLike | DirHandleLike>
  queryPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>
  requestPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>
  isSameEntry?(other: DirHandleLike | FileHandleLike): Promise<boolean>
}
