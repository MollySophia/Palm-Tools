type DroppedFile = Pick<File, 'name'> & { path?: string }

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

function pathFromFileUri(raw: string): string | null {
  const value = raw.trim()
  if (!value || value.startsWith('#')) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return null
    let path = decodeURIComponent(url.pathname)
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
    return isAbsolutePath(path) ? path : null
  } catch {
    return null
  }
}

/** Resolve only trustworthy absolute paths; never degrade to a bare filename. */
export function absoluteDroppedFilePaths(
  files: ArrayLike<DroppedFile>,
  uriList = '',
): string[] {
  const paths: string[] = []
  for (let index = 0; index < files.length; index++) {
    const path = files[index]?.path?.trim()
    if (path && isAbsolutePath(path)) paths.push(path)
  }
  for (const line of uriList.split(/\r?\n/)) {
    const path = pathFromFileUri(line)
    if (path) paths.push(path)
  }
  return [...new Set(paths)]
}
