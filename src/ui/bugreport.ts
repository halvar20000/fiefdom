import { VERSION, BUILD } from '../game/version';
import { isServerBacked } from '../game/backend';

/**
 * A bug report that arrives already filled in.
 *
 * GitHub's issue forms take their field ids as query parameters, so a link
 * built here opens `bug_report.yml` with the version, build, mode, browser,
 * hosting and a block of context already in place, and the player writes
 * only what happened. The difference between "it broke" and a report that
 * can be reproduced is usually the six lines they would not have thought to
 * include.
 *
 * Nothing personal goes in: no account name, no address, no save. The
 * renderer string is the one thing a WebGL bug cannot be found without.
 */

const REPO = 'https://github.com/halvar20000/fiefdom';

export interface ReportContext {
  mode: 'Single-player' | 'Multiplayer (host)' | 'Multiplayer (joined)' | 'Map editor' | 'Menu';
  map?: string;
  /** Play time in seconds. */
  elapsed?: number;
  /** "WebGL 2 · ANGLE (…)" or whatever the canvas reports. */
  renderer?: string;
}

/** Which option in the form's browser dropdown this is. */
function browserOption(): string {
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'Chrome / Chromium / Edge';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  return 'Other (say which below)';
}

/** Which option in the hosting dropdown, where it can be told at all. */
function hostingOption(): string | null {
  if (import.meta.env.DEV) return 'Local dev build (`npm run dev`)';
  if (isServerBacked()) return 'Docker container (own server / Unraid)';
  return null;
}

export function bugReportUrl(ctx: ReportContext): string {
  const p = new URLSearchParams();
  p.set('template', 'bug_report.yml');
  p.set('labels', 'bug');
  p.set('version', `${VERSION} (${BUILD})`);
  if (ctx.mode !== 'Menu') p.set('mode', ctx.mode);
  p.set('browser', browserOption());
  const hosting = hostingOption();
  if (hosting) p.set('hosting', hosting);
  const lines = [
    `version: ${VERSION}`,
    `build: ${BUILD}`,
    `mode: ${ctx.mode}`,
    ctx.map ? `map: ${ctx.map}` : null,
    ctx.elapsed !== undefined ? `play time: ${Math.round(ctx.elapsed / 60)} min` : null,
    ctx.renderer ? `renderer: ${ctx.renderer}` : null,
    `screen: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`,
    `storage: ${isServerBacked() ? 'server' : 'browser only'}`,
    `agent: ${navigator.userAgent}`,
  ].filter((l): l is string => !!l);
  p.set('context', lines.join('\n'));
  return `${REPO}/issues/new?${p.toString()}`;
}

/** The GPU string three.js is drawing with, for the report. */
export function rendererString(gl: WebGLRenderingContext | WebGL2RenderingContext | null): string | undefined {
  if (!gl) return undefined;
  const kind = gl instanceof WebGL2RenderingContext ? 'WebGL 2' : 'WebGL 1';
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const name = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string : null;
  return name ? `${kind} · ${name}` : kind;
}

/** A small link, styled like the version line, that opens the report. */
export function bugReportLink(ctx: () => ReportContext): HTMLElement {
  const a = document.createElement('a');
  a.className = 'verline';
  a.textContent = 'Report a bug';
  a.title = 'Opens a GitHub issue with the version and build already filled in';
  a.target = '_blank';
  a.rel = 'noopener';
  // Built at click time, so the map and play time are the current ones.
  a.onclick = e => {
    e.stopPropagation();
    a.href = bugReportUrl(ctx());
  };
  a.href = `${REPO}/issues/new?template=bug_report.yml`;
  return a;
}
