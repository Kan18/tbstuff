// Tower Battles Phaser simulator
// Source: phasers.html (extracted section: // ----- Global state -----)

// ----- Global state -----
  let canvas, ctx;
  let canvas2, ctx2;
  let canvasShell;
  let frontSlider, behindSlider, maxBehindSlider;
  let modeSelect, zombieHealthInput, zombieSpeedInput, zombieDpsInput, skipFrontLockCheckbox, spawnPatternInfo;
  let animateFrontCheckbox, animateSpeedInput;
	  let frontLabel, behindLabel, maxBehindLabel;
	  let commanderBoostCheckbox, rangeInfo;
	  let customRangesButton, customRangesText;
	  let dualViewCheckbox, canvasBlock2, canvasTitle1, canvasTitle2;
	  let renderCommanderCheckbox;
	  let dynamicScaleCheckbox, scaleInfo, fixedMinInput, fixedPeakInput;
  let heatAlphaInput, showPathCheckbox, showWhiteCheckbox, blueOnlyCheckbox, showPolygonCheckbox;
  let effectiveLabel, pathLabel, dpsTotalsLabel, dpsBreakdownLabel, mouseInfo, refInfo;
  let captureRefButton, clearRefsButton;
  let pathWidthInput;
  let polygonAddButton, polygonClearButton, polygonInfo;
  let magnifierCanvas, magnifierCtx, magnifierLabel;
  let simTimeSlider, simTimeLabel, simRealtimeCheckbox, simRealtimeSpeedSlider, simRealtimeSpeedLabel;
  let baseRailgunnersInput, simHeatmapCheckbox;
  let simActionsListEl, clearSimActionsButton, noActionsMessage;
  let statusTimeEl, statusWorldEl, statusPlacementEl, statusValueEl, statusModeEl, statusRealtimeEl, statusCountsEl;

  let pathPoints = [];
  let segments = [];
  let rects = [];         // forbidden rectangles (path area + margin)
  let snapPoints = [];    // snapping corners (path centers + expanded corners)
  let totalPathLength = 0;
  let polygonPoints = []; // placement-allowed polygon in world coords
  let polygonCapture = false;
  let pathWidth = DEFAULT_PATH_HALF_WIDTH * 2;
  let pathHalfWidth = DEFAULT_PATH_HALF_WIDTH;

  let worldMinX, worldMaxX, worldMinY, worldMaxY;
  let worldWidth, worldHeight;
  let gridRows, gridCols;
  let grid = [];          // primary grid
  let secondaryGrid = [];
  let secondaryMaxExtra = 1;

  let currentFront = 130;
  let currentBehind = 50;
  let currentMaxBehind = 150;
  let mode = MODE_COVERAGE;
  let zombieHealth = DEFAULT_ZOMBIE_HEALTH;
  let zombieSpeed = DEFAULT_ZOMBIE_SPEED;
  let zombieDps = DEFAULT_ZOMBIE_DPS;
  let skipFrontLocks = DEFAULT_SKIP_FRONT_LOCK;
  let animateFront = false;
  let animateSpeed = DEFAULT_FRONT_ANIM_SPEED;
  let lastAnimateTime = null;
  let dualView = false;
	  let renderCommander = false;
	  let commanderBoost = false;
	  let range1 = DEFAULT_RANGE1;
	  let range2 = DEFAULT_RANGE2;
	  let useCustomRanges = false;
	  let customBaseRange1 = DEFAULT_RANGE1;
	  let customBaseRange2 = DEFAULT_RANGE2;
	  let dynamicScale = true;
	  let fixedMin = 0;
	  let fixedPeak = DEFAULT_FIXED_PEAK;
	  let maxExtraGlobal = 1;
  let heatAlpha = 0.5;
  let showPath = false;
  let showWhite = false;
  let showPolygon = false;
  let blueOnly = false;
  let bgImage = null;
  let bgReady = false;
  let lastLockContext = null;
  let placementBoosted = false;
  let simTime = 0;
  let simMaxTime = 300;
  let simRealtime = false;
  let simRealtimeSpeed = DEFAULT_REALTIME_SPEED;
  let simLastRealtimeTs = null;
  let baseRailgunners = DEFAULT_BASE_RAILGUNNERS;
  let simHeatmapEnabled = true;
  let towerToPlace = TOWER_PHASER;
  let simulationActions = [];
  let simActionIdCounter = 1;
  let phaserIdCounter = 1;
  let sleeterIdCounter = 1;
  let currentSimState = null;
  const BG_FILE = "warped.png";
  
  // Reference capture (visual debug only; no warp applied)
  let refPoints = []; // {src:{x,y}, dst:{x,y}}
  let captureState = 'idle'; // 'idle' | 'waiting-image' | 'waiting-path'
  let pendingSrc = null;

  let mouseWorld = null;  // {x,y} in world coords or null
  let mouseCanvas = null; // {x,y} in canvas coords
