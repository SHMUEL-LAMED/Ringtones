## 2025-09-03 - Accessible Audio Range Sliders and Toggle Buttons
**Learning:** For audio editor interfaces with custom duration range sliders and play/pause toggle controls, explicitly associating labels with `for="id"`, updating `aria-valuetext` dynamically in Hebrew, and switching `aria-label` / `aria-pressed` on play state change dramatically improves screen reader clarity.
**Action:** Always maintain aria-valuetext and aria-pressed attributes when handling range inputs and toggle play buttons in audio widgets.

## 2025-09-04 - Slide-Over Drawer Modal Focus Trapping and Nudge Control Labels
**Learning:** For slide-over drawer panels marked with `role="dialog"` and `aria-modal="true"`, native keyboard focus escapes to background content unless a dynamic keydown listener traps `Tab` and `Shift+Tab` within currently focusable elements in the modal. Additionally, numeric nudge buttons (+0.1, -0.1) require explicit `aria-label` context to specify the target metric being adjusted.
**Action:** Always implement dynamic focus trapping on `aria-modal="true"` dialog containers and supply explicit `aria-label` text on incremental step/nudge buttons.
