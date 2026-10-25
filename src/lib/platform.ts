export const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform} ${navigator.userAgent}`);

/**
 * True when the bundle runs inside the native Windows shell (ByAzen.exe), which
 * loads the app from a loopback origin with `?desktop=1`. In that mode links are
 * handed to the default browser through the shell instead of `window.open`.
 */
export const isDesktopShell =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('desktop') === '1';
