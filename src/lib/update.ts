// Is a newer build of XkyHold deployed than the one in this tab?
// (docs/UPDATES.md in xkyhold-lx, section 3.) The page asks its own origin
// for /version.json; nothing goes to anyone else, and a failure says nothing.

export interface DeployedVersion {
  version: string
  build: string
}

/** Reads a version.json body; anything else is not an answer. */
export function parseVersion(body: unknown): DeployedVersion | null {
  if (typeof body !== 'object' || body === null) return null
  const { version, build } = body as Record<string, unknown>
  if (typeof version !== 'string' || typeof build !== 'string' || !build) return null
  return { version, build }
}

/** True when the deployed build differs from this page's and was not set aside. */
export function updateWaiting(current: string, deployed: DeployedVersion | null, dismissed: string | null): boolean {
  return !!deployed && deployed.build !== current && deployed.build !== dismissed
}

export async function fetchDeployed(fetcher: typeof fetch = fetch): Promise<DeployedVersion | null> {
  try {
    const res = await fetcher('/version.json', { cache: 'no-store' })
    if (!res.ok) return null
    return parseVersion(await res.json())
  } catch {
    return null
  }
}
