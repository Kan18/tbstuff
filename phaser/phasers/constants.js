// Tower Battles Phaser simulator
// Source: phasers.html (extracted section: // ----- Constants -----)

// ----- Constants -----
  const BASE_STEP = 0.5;     // coarse sampling step in studs
  const SUPER_SAMPLE = 2;    // 2x finer resolution each direction (balance detail vs. speed)
  const STEP = BASE_STEP / SUPER_SAMPLE;
  const SCALE = 12;          // pixels per stud (multiple of 1/STEP to avoid grid gaps)
  const DEFAULT_PATH_HALF_WIDTH = 2.5;    // path "no-place" half width in studs
  const MARGIN_STUDS = 29;   // extra margin around path
  const EPS = 1e-6;

  const DEFAULT_RANGE1 = 23;
  const DEFAULT_RANGE2 = 37;
  const BOOST_FACTOR = 1.25;
  const DEFAULT_FIXED_PEAK = 255;
  const MODE_COVERAGE = 'coverage';
  const MODE_TOTAL = 'total';
  const MODE_BACKMOST = 'backmost';
  const MODE_L5TOTAL = 'l5total';
  const MODE_LOCK = 'lock';
  const MODE_SIMULATION = 'simulation';
  const SIM_STEP = 0.05;          // simulation tick for movement / railgun damage
  const PHASER_FIRE_INTERVAL = 0.25;
  const AUTO_REPLACE_DELAY = 2;   // seconds after disable before auto phasers sell/replace
  const DEFAULT_REALTIME_SPEED = 1;
  const PHASER_DAMAGE_START = 15;
  const PHASER_DAMAGE_STEP = 4 / 3;
  const PHASER_DAMAGE_CAP = 101;
  const PHASER_BLOCK_HALF = 3;    // half-size of 6x6 placement blocker
  const PHASER_HIT_RADIUS = 1.5;  // world studs for click/sell hit test
  const PHASER_DRAW_RADIUS = 6;
  const PHASER_FIRE_INTERVAL_INV = 1 / PHASER_FIRE_INTERVAL;
  const DEFAULT_BASE_RAILGUNNERS = 54;
  const RAILGUNNER_DAMAGE_PER_SEC = 215;
  const GROUP_COUNT = 14;
  const GROUP_SIZE = 5;
  const INTRA_GROUP_DELAY = 5;   // seconds between zombies in the same group
  const INTER_GROUP_DELAY = 10;  // seconds between the last zombie of a group and the first of the next
  const DEFAULT_ZOMBIE_HEALTH = 125000;
  const DEFAULT_ZOMBIE_SPEED = 1.25;
  const DEFAULT_ZOMBIE_DPS = 13000;
  const DEFAULT_SKIP_FRONT_LOCK = true;
  const DEFAULT_FRONT_ANIM_SPEED = 10;
  const COMMANDER_RANGE = 14;
  const TOWER_PHASER = 'phaser';
  const TOWER_SLEETER = 'sleeter';
  const SLEETER_BASE_RANGE = 12;
  const SLEETER_FIRE_INTERVAL = 1.0;
  const SLEETER_SLOW_MULTIPLIER = 1 / 1.2;
  const DEFAULT_POLYGON = [
    {"x":5.561624326906006,"y":1.690380919901731},
    {"x":12.283268558180104,"y":9.090058733973784},
    {"x":21.196729145532444,"y":10.261657215200351},
    {"x":23.26753312037188,"y":8.909812813785095},
    {"x":27.139036203767347,"y":11.343132736332564},
    {"x":28.579595490612164,"y":10.892517935860816},
    {"x":29.29987513403458,"y":13.235714898313937},
    {"x":34.071727771708055,"y":17.111002182371045},
    {"x":35.33221714769728,"y":17.561616982842793},
    {"x":45.41613215561104,"y":14.497436339634852},
    {"x":52.8747182059422,"y":33.26807308700099},
    {"x":52.78468325051439,"y":35.250778209076714},
    {"x":48.73311025626333,"y":39.12606549313382},
    {"x":47.83276070198532,"y":46.1556563804932},
    {"x":49.698721612250054,"y":49.55343117810392},
    {"x":46.007288045816495,"y":50.99539865132884},
    {"x":40.78526007378851,"y":54.23982546608488},
    {"x":37.09382650735495,"y":61.78011279471191},
    {"x":35.9233719619004,"y":66.7068340781188},
    {"x":37.27389643742488,"y":68.86978528795616},
    {"x":33.37237762237761,"y":73.85659038297054},
    {"x":28.960664335664333,"y":73.85659038297054},
    {"x":24.45891608391608,"y":79.44421434171709},
    {"x":23.01835664335664,"y":79.08372247341084},
    {"x":19.146853146853147,"y":81.87753445278412},
    {"x":14.825174825174827,"y":81.0664277490951},
    {"x":9.963286713286713,"y":76.65040236234381},
    {"x":4.561188811188806,"y":77.37138609895628},
    {"x":2.7604895104895135,"y":79.71458324294674},
    {"x":-3.541958041958047,"y":79.53433730879362},
    {"x":-4.412292373763933,"y":77.76191987306625},
    {"x":-9.994460205931766,"y":76.4100753669179},
    {"x":-13.05564901712058,"y":77.8520428401428},
    {"x":-14.046033632505193,"y":80.19523998413327},
    {"x":-20.61858608005764,"y":76.86069020230066},
    {"x":-22.26923076923077,"y":76.92077126357349},
    {"x":-26.41083916083916,"y":71.96400807436287},
    {"x":-32.35314685314685,"y":71.4232702719035},
    {"x":-38.53554412201568,"y":78.21253470844903},
    {"x":-49.54982517482517,"y":59.557080523601755},
    {"x":-44.41783216783217,"y":56.3126537088457},
    {"x":-42.88723776223776,"y":48.291709639032135},
    {"x":-40.18618881118881,"y":45.94851249504164},
    {"x":-38.56555944055944,"y":38.438264321883665},
    {"x":-41.89685314685315,"y":34.35268889763486},
    {"x":-36.76486013986014,"y":27.142851531510303},
    {"x":-37.39510489510489,"y":21.254819516065048},
    {"x":-31.452797202797203,"y":21.43506545021817},
    {"x":-29.291958041958043,"y":17.830146767155895},
    {"x":-17.767482517482513,"y":17.559777865926208},
    {"x":-17.40734265734266,"y":12.603014676715588},
    {"x":-28.39160839160839,"y":12.332645775485922},
    {"x":-28.211538461538463,"y":9.628956763189215},
    {"x":-29.47202797202797,"y":8.457358191193975},
    {"x":-25.330419580419584,"y":7.015390717969048},
    {"x":-22.62937062937063,"y":2.9598571995239986},
    {"x":-16.627037795273573,"y":4.702232729447644},
    {"x":-6.633156676392453,"y":1.0973140463853497},
    {"x":-5.012527305763086,"y":-1.9668668342175692},
    {"x":-5.372667165902946,"y":2.4491585525337136}
  ];

  // Path segments: direction, length in studs
  const segmentDefs = [
    ['U', 15],
    ['L', 15],
    ['U', 14],
    ['R', 27],
    ['D', 13],
    ['R', 12],
    ['U', 26],
    ['L', 45],
    ['U', 16],
    ['R', 13],
    ['D', 5],
    ['R', 20],
    ['U', 15],
    ['L', 12],
    ['U', 16],
  ];
