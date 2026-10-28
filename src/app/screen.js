// The page as a full screen game on phones: no browser zoom, no page gestures, full screen on the first touch.
//
//   lockScreen();   // once, at start
//
// iOS Safari ignores user-scalable=no, and touch-action does not stop a double tap of a second finger
// while one finger is down. Only non-passive touch listeners stop it:
// - touchstart with more than one finger: no pinch and no multi-finger zoom. CSS touch-action: none
//   stops scroll.
// - touchend: no double-tap zoom. This also stops the click after a touch, so buttons act on
//   pointerdown for touch (onPress in ui.js). Pointer events still come.
// - gesture*: the Safari pinch events.
export function lockScreen() {
  const stop = e => { if (e.cancelable) e.preventDefault(); };
  const opts = { passive: false };
  document.addEventListener('touchstart', e => { if (e.touches.length > 1) stop(e); }, opts);
  document.addEventListener('touchend', stop, opts);
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu']) document.addEventListener(ev, stop, opts);

  // Full screen on the first touch, where the browser lets an element go full screen (Android, iPad).
  // Not in an installed app (it is full screen already) and not with a mouse.
  const installed = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone;
  const el = document.documentElement, go = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (installed || !go || !(document.fullscreenEnabled ?? document.webkitFullscreenEnabled) || !matchMedia('(pointer: coarse)').matches) return;
  addEventListener('pointerup', () => {
    if (!(document.fullscreenElement ?? document.webkitFullscreenElement)) go.call(el, { navigationUI: 'hide' })?.catch?.(() => {});
  }, { once: true });
}
