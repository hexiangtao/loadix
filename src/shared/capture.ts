/**
 * Capture API: a tiny message-passing contract between the dashboard UI,
 * the area-selector content script, and the service worker.
 *
 *   Dashboard ──▶ SW ──▶ content script (in target tab) ──▶ back
 *
 * All payloads are JSON-serialisable so they survive `chrome.runtime.sendMessage`
 * without `chrome.runtime.connect`.
 */

export type CaptureMode = 'visible' | 'fullpage' | 'selection' | 'element';

/** Dashboard → SW: start a capture. */
export interface CaptureRequest {
  type: 'CAPTURE_REQUEST';
  mode: CaptureMode;
  /** For mode === 'element'. */
  selector?: string;
  /** Filename hint (no extension); SW adds a timestamp + .png. */
  filename?: string;
  /** For mode === 'element', whether to use html-to-image (true) or rely on
   *  the visible-tab capture (false). html-to-image is needed when the target
   *  is *not* the current tab — but we usually target the current tab anyway. */
  useHtmlToImage?: boolean;
}

/** SW → content script: tell it to ask the user to pick a region or element. */
export interface ContentScriptRequest {
  type: 'PICK_REGION' | 'PICK_ELEMENT';
}

/** Content script → SW: the user picked something; here is the geometry. */
export interface PickedRegion {
  type: 'PICKED_REGION';
  x: number;
  y: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface PickedElement {
  type: 'PICKED_ELEMENT';
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
  devicePixelRatio: number;
}

export interface PickedCancelled {
  type: 'PICK_CANCELLED';
}

/** SW → Dashboard: final result with a downloadable URL. */
export interface CaptureResult {
  type: 'CAPTURE_RESULT';
  ok: boolean;
  dataUrl?: string;
  filename: string;
  width?: number;
  height?: number;
  bytes?: number;
  error?: string;
}

export type CaptureMessage =
  | CaptureRequest
  | ContentScriptRequest
  | PickedRegion
  | PickedElement
  | PickedCancelled
  | CaptureResult;
