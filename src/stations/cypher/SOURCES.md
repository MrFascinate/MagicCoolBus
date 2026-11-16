# Science Cypher: sources

The lyrics in `lyrics.json` are PLACEHOLDERS so the game can be played and
tested. Justin rewrites, performs and records the real verses. Every line and
every "meaning" shown after a miss was checked against a page opened on
2026-11-15. Ids in backticks match the `src` lists in `lyrics.json`. Rights
for the final lyrics and beats need written agreements from everyone who
writes, produces or performs them (Station specs, Science Cypher).

The beat is synthesised in the browser with the Web Audio API (`audio.js`).
It uses no samples and no recordings.

| Id | Lines | Source | What it supports |
| --- | --- | --- | --- |
| `nobel-ruska` | Level 1, lines 1 and 2 | [Ernst Ruska facts, NobelPrize.org](https://www.nobelprize.org/prizes/physics/1986/ruska/facts/) | Electron microscopes use electron beams; electrons have shorter wavelengths than light, so they show smaller objects; Nobel Prize in Physics 1986 |
| `nobel-ruska-bio` | Level 1, line 2 | [Ernst Ruska biographical, NobelPrize.org](https://www.nobelprize.org/prizes/physics/1986/ruska/biographical/) | "Further work, conducted together with Dr Knoll, led to the first construction of an electron microscope in 1931." The line credits Ruska and Max Knoll together, the same wording Hologram Heroes uses. (The facts page says 1933, the year Ruska's microscope first beat a light microscope; the game uses the biography's 1931 for the first one.) |
| `hair-width` | Level 1, line 3 | [Width of human hair, Scale of the Universe](https://scaleofuniverse.com/universe/width-of-human-hair) | A head hair is about 0.1 mm (100 micrometres) wide |
| `hair-sem` | Level 1, line 4 | [Human hair, SEM, Wellcome Collection](https://wellcomecollection.org/works/wxgqyf66) | The cuticle is made of overlapping, tightly packed scales |
| `salt-scale` | Level 1, line 5 | [Grain of salt, Scale of the Universe](https://scaleofuniverse.com/universe/grain-of-salt) | Table salt grains are cubes; sodium and chloride ions alternate in a repeating cubic pattern |
| `pollen-foldscope` | Level 1, line 6 | [A tiny galaxy of sunflower pollen, Foldscope Microcosmos](https://microcosmos.foldscope.com/post/tGVj42l3nNHJosn3EtBP) | The spiny exine helps sunflower pollen attach to pollinators such as bees |
| `wing-phys` | Level 1, line 7 | [Moments of butterfly scale formation, Phys.org 2024](https://phys.org/news/2024-06-moments-butterfly-scale-formation.pdf) | Hundreds of thousands of tiny scales in overlapping rows, compared to roof shingles |
| `leaf-atlas` | Level 1, line 8 | [Stomata, Atlas of Plant and Animal Histology, University of Vigo](https://mmegias.webs2.uvigo.es/02-english/1-vegetal/v-imagenes-grandes/proteccion_estomas.php) | Stomata regulate gas and water exchange; guard cells separate to open the pore |
| `seq-flip` | Level 2, line 1 | [Sequence: order of instructions, Flip Education](https://flipeducation.ai/curriculum/gb/computing/year-7/sequence-order-of-instructions) | "Sequence in computing means the exact order computers follow to execute instructions, one after another"; order changes outcomes |
| `loop-codingal` | Level 2, line 2 | [Loops in programming, Codingal](https://www.codingal.com/coding-for-kids/blog/loops-in-programming/) | "Loops allow you to use just one command to repeat the same process multiple times" |
| `nihf-devol` | Level 2, lines 5 to 7 | [George Devol, National Inventors Hall of Fame](https://www.invent.org/inductees/george-devol) | 1954 patent for a robotic arm that became the Unimate; first Unimate installed at a GM plant in 1961; stored digital instructions one step at a time; picked up and stacked hot die-cast metal pieces |
| `nasa-saturn` | Level 3, lines 1 and 2 | [Saturn facts, NASA Science](https://science.nasa.gov/saturn/facts/) | Rings are billions of small chunks of ice and rock coated with dust; Saturn is the sixth planet and 9 times wider than Earth |
| `nasa-moon` | Level 3, line 3 | [Moon facts, NASA Science](https://science.nasa.gov/moon/facts/) | Asteroids, meteoroids and comets strike the Moon; its atmosphere is too thin to slow them; craters preserved for billions of years |
| `skyatnight-hop` | Level 3, line 4 | [How to star-hop the night sky, BBC Sky at Night](https://www.skyatnightmagazine.com/advice/star-hopping-guide-find-your-way-around-the-skies/) | Star-hopping uses bright star patterns as stepping stones to fainter targets |
| `nihf-carruthers` | Level 3, lines 5 and 6 | [George R. Carruthers, National Inventors Hall of Fame](https://www.invent.org/inductees/george-r-carruthers) | Far ultraviolet camera set up on the Moon by Apollo 16 astronauts in 1972, the first Moon-based observatory; imaged Earth's outer atmosphere, stars, galaxies |
| `nihf-kwolek` | Level 3, line 7 | [Stephanie Louise Kwolek, National Inventors Hall of Fame](https://www.invent.org/inductees/stephanie-louise-kwolek) | Kevlar is five times stronger than the same weight of steel; used in mooring ropes, canoes and bullet-resistant vests |
| `nihf-bath` | Level 3, line 8 | [Patricia Bath, National Inventors Hall of Fame](https://www.invent.org/inductees/patricia-bath) | Invented a device and technique to remove cataracts; first U.S. patent issued 1988; recognized as a laser pioneer |
| `game` | Level 2, lines 3, 4 and 8 | This game | Describe how Drone Dash turns work, the joints of the Robot Relay arm, and the Run button |

## Notes for the rewrite

* Keep the blank as the last word of each line. The game places it on the
  star beat (beat 7 of a two-bar line).
* "Five times stronger than the same weight of steel" must keep "same
  weight". Kevlar is not five times stronger than steel of any size.
* Level 3, line 5: Carruthers invented the camera, and Apollo 16 astronauts
  set it up on the Moon. Keep both parts; he did not go to the Moon.
