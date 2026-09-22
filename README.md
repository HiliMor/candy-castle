# 🍭 Candy Castle

An interactive 3D candy fortress on a floating layered cake, built with **three.js r186** and the **WebGPU renderer**. All materials are written in TSL, the three.js shading language. If a browser has no WebGPU, the page falls back to WebGL 2.

![Candy Castle at night](screenshot.jpg)

![Castle detail](screenshot-detail.jpg)

## The castle

The castle assembles itself piece by piece while the camera flies in:

- **An octagonal curtain wall** of strawberry wafer, topped with gumdrops and dripping icing, with **eight flagged towers** at its corners.
- **A gatehouse** with twin towers, a glowing swirl emblem, a candy-cane arch and a gingerbread door that swings open.
- **A raised cake terrace** with a candy-bar staircase and six turrets around it.
- **The Royal Keep** with candy-cane columns, a rose window and four corner turrets. Above it stands **the great spire** with a balcony.
- **The Crystal Sugar Heart**, an iridescent heart floating above the spire. Gumball rings orbit it, and at night it casts pink light and a beam into the sky.
- **Festival lights** strung from the spire to every outer tower.
- **Two chocolate fountains** in the courtyard, a chocolate moat, and **gummy bear guards** that patrol the walls, guard the gate and dance on the terrace.

**Live demo:** https://hilimor.github.io/candy-castle/

## Things to click

| Click | What happens |
| --- | --- |
| 💖 The crystal heart | The grand finale: fireworks, a light flash, and every bear and tower jumps |
| 🏰 Towers | They squash and bounce, spray sprinkles and launch a firework |
| 🐻 Gummy bears | They jump |
| ⛲ Chocolate fountains | A chocolatey splash |
| 👑 The keep | A full fireworks show |
| 🍭 Lollipops | They spin and chime |
| 🟣 Gumdrops | They hop |
| 🍩 Flying donuts, ☁️ clouds, 🍦 ice-cream trees, 🍬 candy canes | Each does something |
| 🚪 Gingerbread gate | It swings open |
| 🍫 Chocolate river | A splash |
| 🧁 The frosting ground | Plants new candy that grows in with an elastic animation |

**Controls:** drag to orbit, scroll to zoom. Keyboard shortcuts:
`F` fireworks · `N` day/night · `R` sugar rush · `S` sprinkle storm · `M` music · `B` rebuild the castle · `H` hide UI

## Under the hood

- **WebGPU compute shader.** Thousands of sprinkles rain from the sky, animated on the GPU with `instancedArray` and `Fn().compute()`.
- **Procedural TSL materials.** No textures are loaded. Everything is shader code: helical candy stripes, lollipop swirls, wafer grids, waffle cones, sprinkle patterns, donut icing, a spongy cake, a flowing chocolate river, sugar-crystal glitter, and a sky with stars that twinkle at night.
- **Soft-serve roofs.** Lathe geometry is twisted into a helical ridge.
- **Merged static geometry.** Each tower, wall ring and terrace is baked into one mesh per material, so the large castle stays cheap to draw.
- **Waving flags.** The vertex shader squeezes each flag into a pennant shape and animates the wind.
- **Post-processing.** Bloom, a sugar-rush hue spin with a saturation boost, and a vignette, all built with `RenderPipeline`.
- **Day/night cycle.** Candle-lit windows, glowing gumball lamps with point lights, stars and a moon.
- **Fireworks.** Sphere, ring and heart-shaped bursts with HDR sparks.
- **Synthesized audio.** Every pop, boing, chime, whoosh and boom, plus the music-box melody, is generated live with WebAudio. There are no audio files.

## Run locally

No build step is needed. Serve the folder with any static server:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Files

```
index.html        UI, styles, import map (three.js from jsDelivr)
src/main.js       renderer, camera, post-processing, interaction, main loop
src/world.js      the cake island, castle, garden, donuts, clouds, sky, rainbow
src/materials.js  TSL shader materials
src/effects.js    GPU sprinkle rain, sprinkle bursts, fireworks
src/anim.js       squash/stretch springs, spins, elastic growth
src/audio.js      WebAudio sound effects and music box
```
