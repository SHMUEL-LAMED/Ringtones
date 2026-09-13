## 2025-09-03 - Accessible Audio Range Sliders and Toggle Buttons
**Learning:** For audio editor interfaces with custom duration range sliders and play/pause toggle controls, explicitly associating labels with `for="id"`, updating `aria-valuetext` dynamically in Hebrew, and switching `aria-label` / `aria-pressed` on play state change dramatically improves screen reader clarity.
**Action:** Always maintain aria-valuetext and aria-pressed attributes when handling range inputs and toggle play buttons in audio widgets.

## 2025-09-13 - Audio Segment Presets and Fine-Tuning Nudge Controls
**Learning:** For audio segment selection buttons and numeric trim controls, sync `aria-pressed="true"` and `.active` on default auto-selected segment choices (such as Chorus) upon analysis completion, and provide explicit descriptive `aria-label` text for numeric fine-tuning nudge buttons (e.g., ±0.1s / ±1s).
**Action:** Always reflect auto-selected segment defaults visually/semantically and add descriptive directional aria-labels to numeric trim controls in audio editor tools.
