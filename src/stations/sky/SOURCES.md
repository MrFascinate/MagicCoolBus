# Sky Seeker: sources and facts

Every star, planet, Moon feature and clue in Sky Seeker comes from the sources below.
The game ships one small data file, `public/assets/sky/sky.json` (about 39 KB, 17 KB gzipped),
built offline by `scripts/build-sky-data.mjs`. The sky is drawn in code; no sky images ship.

## The fixed sky

- Date and time: Tuesday, October 20, 2026, 9:00 pm Central Daylight Time (2026-10-21 02:00 UTC).
- Place: Tulsa, Oklahoma, latitude 36.15 N, longitude 95.99 W, a mid-northern sky.
- Why this night: the Moon is waxing gibbous (about 73 percent lit) and low in the south, Saturn is
  up in the east-southeast, and the Great Square of Pegasus and the Andromeda Galaxy are high in the
  east, all at once. US daylight time ends on November 1, 2026, so 9:00 pm is CDT (UTC minus 5).

## Sources

| What | Source | Used for |
| --- | --- | --- |
| Star positions (J2000 RA/Dec) and V magnitudes, star names, Bayer letters | HYG Database v3.8, `hyg/v3/hyg_v38.csv.gz`, https://github.com/astronexus/HYG-Database (CC BY-SA 4.0) | Every star drawn. Kept: magnitude 5.2 or brighter above the horizon, fainter stars (to 8.0) within 7 degrees of the clue path, to 9.5 within 1 degree of Saturn and M31, and every star in a stick figure |
| Constellation stick figures | Stellarium 0.22.2, `skycultures/western/constellationship.fab`, https://github.com/Stellarium/stellarium (GPL) | Lines between stars, by Hipparcos number |
| Moon, Saturn and Sun positions; Moon phase angle, lit fraction, libration; Saturn magnitude and ring tilt; Moon and Saturn spin axes; J2000 to altitude/azimuth with refraction | Astronomy Engine 2.x by Don Cross (MIT), https://github.com/cosinekitty/astronomy | All solar system positions and the conversion of every star to tonight's sky |
| Lunar crater and mare positions and sizes | IAU Gazetteer of Planetary Nomenclature (USGS), `MOON_nomenclature_center_pts.zip` from the Gazetteer downloads; feature pages such as Tycho https://planetarynames.wr.usgs.gov/Feature/6163 | Where maria and craters sit on the Moon drawing, and which crater is Tycho |
| Andromeda Galaxy position, size, magnitude, distance | Wikipedia, "Andromeda Galaxy" infobox (RA 00h 42m 44.3s, Dec +41 16 09, J2000; size 3.167 x 1 degrees; V 3.44; 765 kpc, 2.50 million light-years), https://en.wikipedia.org/wiki/Andromeda_Galaxy | M31's place and the oval's size |
| Andromeda Galaxy position angle | Chemin, Carignan and Foster 2009, "HI kinematics and dynamics of Messier 31", https://arxiv.org/abs/0909.3846 (photometric PA about 38 degrees; HI disc 37.7 degrees) | Which way the oval points |
| Star-hop to M31 | EarthSky, "2 ways to find the Andromeda galaxy", https://earthsky.org/astronomy-essentials/2-ways-to-find-the-andromeda-galaxy ("An imaginary line drawn through Mirach to Mu points to the Andromeda galaxy"; Alpheratz joins Pegasus to Andromeda) | Level 3 clue path |

## Facts the game relies on, and how each is checked

Tests in `tests/sky/sky.test.js` re-check the starred items against the shipped data.

1. Star positions are tonight's real ones. Six named stars are re-computed with an independent
   sidereal-time formula from their HYG J2000 coordinates and must agree within 0.5 degrees (*).
2. Polaris stands at about the observer's latitude, due north (*).
3. The Moon is in Capricornus, at altitude 39 degrees, azimuth 176 (south), 0.51 degrees wide,
   phase angle 63 degrees, about 73 percent lit (*).
4. A waxing evening Moon is lit on the side toward the set Sun in the west. On the Moon that side is
   IAU east, where Mare Crisium is, so Crisium is sunlit and the far western edge is dark (*).
5. Tycho (43.30 S, 348.78 E, 85.3 km across) sits in the lower part of the Moon as seen tonight and
   is sunlit (*). Its rays are the reason it is easy to spot; it is one of the youngest large craters.
   Copernicus (9.62 N, 339.92 E) is also lit, close to the terminator.
6. Saturn is in Cetus tonight, magnitude 0.3, ring tilt about 7 degrees (the rings opened again
   after edge-on in 2025), disk 19.6 arcseconds. Nothing brighter lies within 12 degrees of it (*).
7. The Great Square of Pegasus is high in the east: Alpheratz is its left corner (smallest azimuth)
   and Algenib its bottom corner (lowest) as seen tonight (*). Alpheratz belongs to Andromeda and is
   shared with Pegasus.
8. Saturn lies past Algenib, toward the horizon, about one side of the square further:
   Alpheratz to Algenib is 13.9 degrees, Algenib to Saturn 15.3 degrees (*).
9. From Mirach, Mu Andromedae is up and to the left tonight, 3.87 degrees away, and the Andromeda
   Galaxy is the same distance again (3.86 degrees) on almost the same line (*).
10. The Andromeda figure links Mirach to Mu Andromedae (Stellarium western figures) (*).
11. Planets do not twinkle like stars and drift against the stars over weeks; this is why the map
    needs a fixed date.

## Drawing choices, labelled in the game

- Zooms: Finder 60 degrees (a naked-eye-wide view), Low 6 degrees, High 0.4 degrees (about what a
  small telescope shows at 150x). At High the Moon is wider than the field, as in a real eyepiece.
- Saturn is drawn at true size at High (rings about 44 arcseconds wide), so it looks small, as it
  does in a small telescope, with its rings visible. The close-ups after each level are marked as illustrations.
- The Moon drawing places maria and craters at their gazetteer positions with tonight's libration;
  shapes and shading are simplified. The view is the eye's view (not flipped like some telescopes).
- The Andromeda Galaxy shows as a soft oval with a bright middle, which is how it looks in binoculars
  or a small telescope.
