# Microscopic Madness: sources

Every fact, hint and real-world size in `levels.js` and every simulated look in
`scripts/render-specimens.py` was checked against a page opened on 2026-11-15.
Ids in backticks match the `src` lists in `levels.js`.

## Images are simulated

All 36 images are Blender renders made to imitate a scanning electron
microscope (SEM): grayscale, bright edges, dark crevices, deep focus. They are
not real micrographs. The game shows a "Simulated image" label on
every one, and `public/assets/microscope/manifest.json` marks each file
`simulated: true`. To swap in real licensed images, replace the file, set
`simulated` to `false` and set `widthUm` to the real width the photo shows. No
code changes are needed.

## Specimens

| Id | Used for | Source | What it supports |
| --- | --- | --- | --- |
| `salt-scale` | Table salt fact and size | [Grain of salt, Scale of the Universe](https://scaleofuniverse.com/universe/grain-of-salt) | Table salt grains are typically cubes, about 0.5 mm; Morton's iodized salt mostly cubes 0.2 to 0.6 mm across; sodium and chloride ions alternate in a repeating cubic pattern |
| `salt-sem` | Table salt look | [Salt crystals under an electron microscope, Encyclopedia.pub](https://www.encyclopedia.pub/image/1409) | Under an electron microscope, fine NaCl crystals show a characteristic cubic structure |
| `hair-sem` | Hair look and fact | [Human hair, SEM, Wellcome Collection](https://wellcomecollection.org/works/wxgqyf66) | The cuticle is made of overlapping, tightly packed scales; image 154 micrometres wide |
| `hair-width` | Hair width | [Width of human hair, Scale of the Universe](https://scaleofuniverse.com/universe/width-of-human-hair) | A head hair is about 0.1 mm (100 micrometres) wide; NNI gives 80 to 100 micrometres; a study found 20 to 180 |
| `hair-width` (extra) | Scale-edge spacing in the render | [BioNumbers 114259](https://bionumbers.hms.harvard.edu/bionumber.aspx?id=114259) | Cuticle cells are flat sheets about 0.5 micrometre thick and 50 micrometres long |
| `hooks-invent` | Hook-and-loop fact | [How did a walk in the woods lead to the invention of VELCRO fasteners?, National Inventors Hall of Fame](https://www.invent.org/blog/inventors/walk-in-the-woods-velcro) | George de Mestral studied a burr under a microscope and found it covered in tiny hooks; patented May 13, 1955 |
| `hooks-hackaday` | Hook look | [Mechanisms: hook and loop fasteners, Hackaday](https://hackaday.com/2018/04/19/mechanisms-hook-and-loop-fasteners) | Stiff nylon threads woven into loops, then cut to form hooks; uncut loops make the loop side |
| `pollen-nwe` | Pollen fact | [Pollen, New World Encyclopedia](https://www.newworldencyclopedia.org/entry/Pollen) | Pollen has a thick, tough outer wall of sporopollenin; the exine often bears spines or warts |
| `pollen-foldscope` | Sunflower spines and bees | [A tiny galaxy of sunflower pollen, Foldscope Microcosmos](https://microcosmos.foldscope.com/post/tGVj42l3nNHJosn3EtBP) | Sunflower pollen is spherical with characteristic spikes; the spiny exine helps it attach to pollinators such as bees |
| `pollen-size` | Sunflower pollen size in the render | [Shukla and Gupta, pollen morphology (Indian Botanical Society)](https://indianbotsoc.org/assets/upload/uploaded/80-83%20Brinda%20Shukla%20and%20S.%20N.%20Gupta.pdf) | Helianthus annuus grains about 35 micrometres with spines, 25 without; spines prominent and thin (scan is partly garbled, so treat as approximate) |
| `wing-phys` | Butterfly wing fact | [Moments of butterfly scale formation, Phys.org 2024](https://phys.org/news/2024-06-moments-butterfly-scale-formation.pdf) | Wings are covered in hundreds of thousands of tiny scales in overlapping rows, compared to roof shingles; a scale is as small as a speck of dust |
| `wing-rsc` | Butterfly scale look | [Faraday Discussions 2020, RSC (open access)](https://pubs.rsc.org/en/content/articlehtml/2020/fd/d0fd00038h) | Scales lie on one another like roof tiles; lengthwise ridges with cross ribs; ridge spacing about 1.7 to 2.3 micrometres; structural colour |
| `leaf-atlas` | Stomata look and fact | [Stomata, Atlas of Plant and Animal Histology, University of Vigo](https://mmegias.webs2.uvigo.es/02-english/1-vegetal/v-imagenes-grandes/proteccion_estomas.php) | Guard cells separate to open the pore; stomata regulate gas and water exchange; SEM images of a kiwi leaf surface |
| `leaf-csbsju` | Stoma size in the render | [Stomata lab, College of Saint Benedict and Saint John's University](https://faculty.csbsju.edu/SSAUPE/biol327/Lab/stomata/stoma_lab_size.htm) | Broad bean guard cells about 45 by 30 micrometres |
| `paper-brit` | Paper fact | [Paper, Britannica](https://www.britannica.com/technology/paper) | Paper is a matted or felted sheet, usually of cellulose fibres; wood is the major source of fibre |
| `wood-brit` | Fibre length in the fact | [Wood: microstructure, Britannica](https://www.britannica.com/science/wood-plant-tissue/Microstructure) | Softwood tracheids average 3 to 5 mm long; hardwood fibres usually 1 to 2 mm |
| `cotton-cameo` | Cotton look and fact | [Cotton, CAMEO, Museum of Fine Arts Boston](https://cameo.mfa.org/wiki/Cotton) | Cotton comes from the outside of Gossypium seeds; under a microscope fibres look like flattened twisted tubes; width 20 micrometres |
| `graphite-micro` | Pencil look and fact | [Pencil lead, Inner Space, micro.org.au (University of Adelaide SEM)](https://micro.org.au/inner-space/pencil-lead/) | SEM image shows the flaky layers that mark paper; pencil "lead" is carbon (graphite), not lead; image 80 by 80 micrometres |

## Sizes that are estimates

These widths set the zoom steps in the renders. They were not confirmed by a
source and need a check before real images replace the simulations:

* Hook-and-loop tape: hook height about 0.8 to 1 mm and monofilament about
  0.18 mm thick. No source with measurements was found.
* Butterfly scales modelled at about 100 by 50 micrometres. The sources
  opened give ridge spacing but not scale length.
* Paper fibres modelled 24 to 38 micrometres wide. Britannica gives only the
  general wood-cell range (about 0.01 to 0.5 mm).
* Graphite flakes 3 to 20 micrometres, pencil core 2 mm wide.

## Hints

Hints describe what is visible in the next, wider image. They make no claims
about the wrong answers, so they need no extra sources.
