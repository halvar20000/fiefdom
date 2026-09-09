/**
 * Real fullscreen: the browser's own, not a maximised window.
 *
 * A castle-builder is a game you lean into, and the twenty-odd rows of browser
 * chrome above the canvas are twenty-odd rows of map you are not looking at.
 * F11 does the job on a desktop keyboard and nowhere else -- not on a laptop
 * whose function row is media keys, not on a tablet, not on a phone -- so the
 * game offers it itself.
 *
 * Wrapped in one file for two reasons. The vendor-prefixed spelling is still
 * needed for Safari, and the whole API is REFUSED unless it is called from a
 * real user gesture, which means the failure mode is a rejected promise rather
 * than an exception -- easy to leave unhandled, and then the button silently
 * does nothing. Both are handled once, here.
 */

/** The prefixed shapes that Safari and older WebKit still use. */
interface WebkitDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface WebkitElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

const doc = () => document as WebkitDocument;
const root = () => document.documentElement as WebkitElement;

/**
 * Whether this browser will do it at all.
 *
 * iOS Safari is the one that matters: it supports fullscreen for a <video> and
 * for nothing else, so the button is not offered there rather than offered and
 * then quietly failing. The home-screen web app is fullscreen anyway.
 */
export function fullscreenAvailable(): boolean {
  const el = root();
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

export function isFullscreen(): boolean {
  const d = doc();
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/**
 * Toggle. Resolves to what the state actually became, so a caller can correct
 * its own label rather than assume the request was honoured -- a request made
 * outside a user gesture, or refused by a kiosk policy, rejects.
 */
export async function toggleFullscreen(): Promise<boolean> {
  try {
    if (isFullscreen()) {
      const d = doc();
      await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.());
    } else {
      const el = root();
      // navigationUI: 'hide' asks a phone to drop its address bar too. Ignored
      // where it is not understood, which is most places.
      await (el.requestFullscreen
        ? el.requestFullscreen({ navigationUI: 'hide' })
        : el.webkitRequestFullscreen?.());
    }
  } catch {
    /* refused -- the state below is still the truth, whatever we asked for */
  }
  return isFullscreen();
}

/**
 * Call `fn` whenever it changes, including when the player leaves fullscreen
 * with Escape or F11 rather than through the game's own button. Returns a
 * teardown.
 */
export function onFullscreenChange(fn: (on: boolean) => void): () => void {
  const handler = () => fn(isFullscreen());
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
  return () => {
    document.removeEventListener('fullscreenchange', handler);
    document.removeEventListener('webkitfullscreenchange', handler);
  };
}
