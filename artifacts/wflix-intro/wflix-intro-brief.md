---
app: Wflix
feature: Intro title card
style: feature-demo
target: both
output_file: wflix-intro.html
---

# Design Language

- Background: `#070707`
- Deep background: `#050505`
- Surface: `#141414`
- Accent: `#e50914` (Wflix red)
- Accent shadow: `#b20710`, `#8c080e`
- Text: `#f2f2f2`
- Muted: `#8c8c8c`
- Heading font: `'Netflix Sans', 'Helvetica Neue', Helvetica, Arial, -apple-system, 'Segoe UI', sans-serif`
- Heading weight: `800`
- Letter spacing: `-0.055em`
- Border radius: `12px` desktop stage / `16px` mobile stage

# Layout (Desktop)

- Preview stage: `960x620px`
- Intro stage: `min(620px, 84vw)`, centered
- Wordmark: `clamp(4.6rem, 16vw, 9.5rem)`, white, tight tracking
- Horizon: full-width SVG arc, `800x130` viewBox, red at the edges and warm amber at the center
- Horizon glow: blurred duplicate arc plus a warm floor pool below the wordmark
- No buttons, labels, progress meters, controls, or cursor.

# Layout (Mobile)

- Preview stage: `360x640px`
- Intro stage: `84vw`, centered
- Wordmark: `clamp(4rem, 19vw, 7rem)`
- Perspective: `660px`
- Same single lockup, no added chrome.

# Animation Plan

## Style: Single-scene title card

### Before State

- Fully black field with a barely visible red pool at the lower center.
- The curved horizon is hidden.
- Wflix is below the mask line, tilted back and pushed away from the viewer.

### Action

- **0.16s:** the curved horizon draws from left to right, with a blurred warm glow following it.
- **0.30s:** Wflix unfolds from behind the rule using `rotateX`, a small `rotateY`, and negative Z depth.
- **1.12s:** one narrow white light pass crosses the wordmark.
- **1.45s:** the wordmark settles with a slight overshoot.
- The whole lockup receives a very small camera push-in during the settle.

### Payoff

The white Wflix mark above the warm curved horizon becomes a physical, dimensional title frame. The dark-red extruded edge and floor glow sell the depth without particles, gradients, or extra copy.

### After State

- Hold the finished lockup.
- Fade the overlay after 2.7s.
- Reduced motion: static lockup, no camera movement, 1s hold.

### Timing

- Total production intro: `2.7s`
- Reduced-motion version: `1s`
- Preview loop: `4.4s` including a short black reset
- Main easing: `cubic-bezier(0.16, 0.84, 0.24, 1)`
- Camera easing: `cubic-bezier(0.2, 0.7, 0.2, 1)`

# Constraints

- No interaction: no buttons, skip, sound toggle, hints, focus trap, or Escape handling.
- Sound may only play if the browser permits autoplay; otherwise the intro is silent.
- The production version is full viewport. The preview uses the skill's fixed desktop/mobile stages for review.
- No external assets or libraries. The preview is self-contained HTML/CSS with a small loop controller only.

# Research Note

The live app could not be inspected with Chrome in this environment. The design tokens and layout were extracted from the existing `styles.css`, and the user's mobile screenshot was used as the visual reference.
