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
  // navigator.standalone is true only in an iOS home screen app. display-mode: fullscreen also matches a
  // desktop browser in full screen, where the screen is taller than the window.
  if (navigator.standalone) fillScreen();
  const el = document.documentElement, go = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (installed || !go || !(document.fullscreenEnabled ?? document.webkitFullscreenEnabled) || !matchMedia('(pointer: coarse)').matches) return;
  addEventListener('pointerup', () => {
    if (!(document.fullscreenElement ?? document.webkitFullscreenElement)) go.call(el, { navigationUI: 'hide' })?.catch?.(() => {});
  }, { once: true });
}

// iOS home screen app: 100vh, 100lvh and innerHeight can be short by the height of the Safari bars
// (WebKit bugs 316008 and others), which leaves a gap under the canvas. When the window is as wide as
// the screen, it is the full screen: set --app-h to the screen height, and --under to the height under
// the short viewport, so the bottom controls move down with it. Not on a windowed iPad (Stage Manager).
function fillScreen() {
  const root = document.documentElement.style;
  const fit = () => {
    const long = Math.max(screen.width, screen.height), short = Math.min(screen.width, screen.height);
    const [w, h] = innerWidth > innerHeight ? [long, short] : [short, long];
    if (Math.abs(innerWidth - w) > 1 || h <= innerHeight) {
      root.removeProperty('--app-h');
      root.removeProperty('--under');
      return;
    }
    root.setProperty('--app-h', `${h}px`);
    root.setProperty('--under', `${h - innerHeight}px`);
  };
  fit();
  addEventListener('resize', fit);
  addEventListener('orientationchange', () => setTimeout(fit, 300));   // iOS updates innerWidth late
}
