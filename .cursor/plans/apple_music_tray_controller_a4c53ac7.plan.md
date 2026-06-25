---
name: Apple Music Tray Controller
overview: A frameless, acrylic-blur Electron tray widget for Windows that reads Apple Music's SMTC session (track, artist, album art, play state) and controls play/pause/skip, popping up just above the tray icon with slide+fade animations.
todos:
  - id: scaffold
    content: Create package.json with electron, @coooookies/windows-smtc-monitor, win-media-control; npm install; add start script
    status: completed
  - id: tray-icons
    content: Generate assets/icon-playing.png and icon-paused.png
    status: completed
  - id: media
    content: "src/media.js: normalize current/Apple Music SMTC session (title, artist, album-art data URL, status) + play/pause/next/prev via win-media-control"
    status: completed
  - id: tray
    content: "src/tray.js: create tray, toggle window, swap icon by play state, expose getBounds for positioning"
    status: completed
  - id: main
    content: "src/main.js: frameless transparent acrylic window, positioning above tray, blur-to-close flow, 1s poll loop, IPC wiring"
    status: completed
  - id: preload
    content: "src/preload.js: contextBridge API (onUpdate, control, requestClose ack)"
    status: completed
  - id: renderer-ui
    content: "src/renderer/index.html + styles.css: layout, acrylic/rounded, open/close animations, hover states, SVG buttons"
    status: completed
  - id: renderer-logic
    content: "src/renderer/renderer.js: render updates, button handlers, album-art accent-color extraction, animation orchestration"
    status: completed
  - id: verify
    content: Run app, verify info sync, controls, popup position/animations, click-away dismiss
    status: completed
isProject: false
---

## Packages

- `electron@42` - tray + frameless transparent window
- `@coooookies/windows-smtc-monitor@1` - native (prebuilt napi binary, no compile) read of current SMTC session: title, artist, album, playback status, and album-art `thumbnail` Buffer + change events
- `win-media-control@0.1.1` - PowerShell-based play/pause/next/previous to the current SMTC session

Target logic: prefer the Apple Music session (match `sourceAppId` containing `AppleInc` / `AppleMusic`), fall back to current session.

## Project structure

```
package.json
src/
  main.js        # app lifecycle, window creation, IPC, 1s poll loop
  tray.js        # tray icon + playing/paused state + position helpers
  media.js       # wrapper: getSession() -> normalized obj w/ art data URL; play/pause/next/prev
  preload.js     # contextBridge: onUpdate(cb), control(action), requestClose()
  renderer/
    index.html
    styles.css   # acrylic, rounded, animations, hover states
    renderer.js  # render track UI, buttons, album-art color extraction, open/close anim
assets/
  icon-playing.png
  icon-paused.png
```

## Key implementation points

- Window: `frame:false`, `transparent:true`, `resizable:false`, `skipTaskbar:true`, `show:false`, `backgroundMaterial:'acrylic'` (Win11 blur) with CSS semi-transparent dark fallback, fixed size ~320x120, `roundedCorners:true`.
- Positioning: on tray click, use `tray.getBounds()` + `screen.getDisplayMatching(...).workArea` to place the window bottom-right, just above the taskbar tray. Re-position each open.
- Show/hide: clicking tray toggles. On `window.blur`, send IPC to renderer to play the close animation, then `win.hide()` on `transitionend` ack (with a safety timeout).
- Poll loop in `main.js`: every 1000ms call `media.getSession()`; if changed, push to renderer via IPC and update tray icon (playing vs paused). `@coooookies` static `getCurrentMediaSession()` is read each tick; if it blocks the main thread noticeably, move to a worker thread (README pattern) - noted as fallback.
- Album art: convert `thumbnail` Buffer -> base64 `data:image/png` URL in `media.js`, send over IPC.
- Accent color: in `renderer.js`, draw album art to a 1x1 `<canvas>` to get the dominant color (no library) and apply it as a subtle button glow / border accent.
- Controls: buttons call `win-media-control` `togglePlayPause()`, `next()`, `previous()` (no arg = current session) via IPC; UI updates optimistically and corrects on next poll.

## UI (styles.css)

- 12-16px `border-radius`, dark theme, acrylic-friendly translucent background.
- Layout: rounded-square album art left; bold track title + lighter artist right; SVG-only control buttons row.
- Open: `@keyframes` translateY(+8px)->0 + opacity 0->1 (~180ms ease-out); Close: reverse.
- Buttons: `transform: scale(1.08)` + soft glow on `:hover`, all via CSS transitions.

## Notes / caveats

- `win-media-control` requires PowerShell execution allowed (`RemoteSigned`); first skip may lag ~100-300ms due to PS spawn - documented in README.
- Tray icons: generate two simple PNGs (play/pause glyph) into `assets/` during setup.
- Apple Music (Windows) must expose SMTC (it does via the Apple Music app); if Apple Music isn't running, UI shows an idle "Not playing" state.