# Image Zoom for Roam Research

Image Zoom adds smooth, scroll-wheel zooming and panning to images in your Roam Research graph, with strong safeguards to avoid interfering with normal scrolling and Roam’s UI.

This extension is based on **Wheelzoom** (MIT licensed), with significant Roam-specific enhancements for safety, performance, and usability.

---

## Features

- 🖱 **Scroll-wheel zoom** on images  
- ✋ **Click-and-drag panning** when zoomed
- 🔍 **Zoom-in/zoom-out cursor** hints on hover
- ⌨️ **Optional modifier key requirement** (prevents scroll hijacking)
- 🔁 **Quick reset gesture**
- 🧠 **Automatically ignores Roam UI icons and chrome**
- ⚡ **Efficient DOM watching** (no polling)
- 🧹 **Clean teardown on unload or rebuild**

---

## Gestures

### Zoom
- **Modifier key + scroll wheel** (recommended and default), or
- **Scroll wheel only** (if modifier requirement is disabled)

### Pan
- **Drag when zoomed** *(modifier required if enabled)*

### Reset
- **Modifier-click** → resets zoom *(when modifier requirement is enabled)*  
- **Double-click** → resets zoom *(when modifier requirement is disabled)*

These gestures are designed to avoid triggering Roam’s image popover or editor behaviors, including after drag or reset interactions.

---

## Settings

All settings are available in **Roam Depot → Image Zoom**.

### Zoom step
Controls how much each scroll step zooms.

- Range: `0.01 – 0.50`
- Default: `0.10`

### Max zoom
Maximum zoom multiplier relative to the image’s rendered size.

- Example: `4` = 4× zoom
- Use `0` for unlimited
- Default: `0`

### Require modifier key
If enabled, zooming and panning only activate when a modifier key is held.

- Prevents accidental scroll hijacking
- Strongly recommended
- Default: **Enabled**

### Modifier key
Which key must be held when the modifier requirement is enabled.

- Options: `Alt`, `Ctrl`, `Shift`, `Meta`
- Default: `Alt`
- On macOS, Ctrl+click is right‑click; prefer Alt/Shift/Meta.

### Min image width / height
Skips very small images (icons, UI glyphs).

- Applies to **natural size or rendered size**
- Default: `80 × 80 px`

---

## How it works (technical notes)

- Images are processed **once per lifecycle**
  - Re-processed automatically if:
    - the image `src` changes (e.g. lazy-load or re-render)
    - settings are changed
- Uses a **MutationObserver** instead of polling
- Stores and restores the **original image `src`** safely
- Only images initialized by this extension are torn down
- All event handling is scoped to prevent Roam UI side effects

---

## Safety & Compatibility

- No external network requests
- No HTML injection
- No DOM polling
- Fully unloads on extension disable
- Designed to coexist safely with Roam’s image popovers and editor behaviors

---

## Credits

- **Wheelzoom** by Jack Moore  
  MIT License — http://www.jacklmoore.com/wheelzoom

---

## License

MIT
