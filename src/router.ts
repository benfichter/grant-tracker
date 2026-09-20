import { useEffect, useState } from 'react'

/** Tiny hash router: '#/tracker/some-id' -> ['tracker', 'some-id']. */
export function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)
}

export const link = (...parts: string[]) => '#/' + parts.map(encodeURIComponent).join('/')
export const go = (...parts: string[]) => {
  location.hash = link(...parts)
}
