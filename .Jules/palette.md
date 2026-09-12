## 2025-09-03 - Accessible Audio Range Sliders and Toggle Buttons
**Learning:** For audio editor interfaces with custom duration range sliders and play/pause toggle controls, explicitly associating labels with `for="id"`, updating `aria-valuetext` dynamically in Hebrew, and switching `aria-label` / `aria-pressed` on play state change dramatically improves screen reader clarity.
**Action:** Always maintain aria-valuetext and aria-pressed attributes when handling range inputs and toggle play buttons in audio widgets.

## 2025-09-11 - Accessible Modal Trapping and Nudge Controls
**Learning:** For overlay slide-out dialogs and time adjustment nudge buttons in media editors, trapping keyboard Tab focus within open modal containers and providing descriptive `aria-label`s for positive/negative adjustment buttons prevents screen reader focus leaks and clearly communicates offset directions.
**Action:** Always implement modal focus trapping on slide-out overlays and include explicit aria-label descriptions on numeric nudge controls.
