# The Magic Cool Bus Challenge

A browser game from Fascinate Inc. Players pick a character, walk around a mobile STEM lab parked outside a middle school, and play a science game at each station. Six stamps unlock the last station, where they design a badge.

## Stations

| Station | Game | What you do |
|---|---|---|
| Microscope | Microscopic Madness | Guess the object from an extreme close-up. Zoom out for an easier guess. |
| Robot arm | Robot Relay | Queue moves to sort parts into bins. |
| Drone cage | Drone Dash | Code a drone's flight with blocks. |
| Hologram table | Hologram Heroes | Match a real problem to the invention that solved it. |
| Telescope | Sky Seeker | Star-hop to a target in a real night sky. |
| Stage | Science Cypher | Tap on the beat to finish lines of a science rap. |
| 3D printer | Badge Builder | Design and print a completion badge. Unlocks after six stamps. |

## Run it

```
npm install
npm run dev
```

Other commands:

- `npm test` runs the unit tests.
- `npm run build` writes the site to `dist/`.
- `npm run smoke:all` plays the whole game in headless Chrome. It needs Google Chrome installed and takes a while.

## How it is built

- Vite and Three.js, plain JavaScript.
- One shared shell in `src/` and one module per station in `src/stations/<id>/`. Each station loads only when the player opens it.
- 3D models are in `public/assets/`. They were exported from Blender as GLB files.
- No accounts and no data collection. Progress is saved in the browser on the player's device.
- No outside network calls at runtime.

## Status

All seven stations are built and pass an automated end-to-end run. The game has not yet been tested on a real Chromebook or with children.

Placeholders that still need a human:

- Science Cypher lyrics and vocals. The current bars are fact-checked stand-ins with a synthesized beat.
- Microscope images. They are simulated renders and are labeled "Simulated image" in the game.
- Hologram Heroes features six living STEM people by name and public facts only. Their permission is still pending.

Sources for the science facts are in each station's `SOURCES.md`.
