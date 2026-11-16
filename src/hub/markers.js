/** Marker names the shell and stations read from hub.glb. */
export const STATION_IDS = ['microscope', 'robot', 'drone', 'heroes', 'sky', 'cypher', 'badge'];
export const REQUIRED_MARKERS = [
  'spawn_player',
  'walk_area',
  ...STATION_IDS.flatMap((id) => [`station_${id}`, `cam_${id}`, `ring_${id}`]),
  'drone_start', 'pad_1', 'pad_2', 'pad_3',
  'arm_base', 'part_tray', 'bin_1', 'bin_2', 'bin_3', 'barrier_1',
  'holo_center', 'print_bed', 'stage_center',
];
