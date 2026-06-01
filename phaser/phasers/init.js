// Tower Battles Phaser simulator
// Source: phasers.html (extracted section: // ----- Init -----)

// ----- Init -----
  function init() {
    canvas = document.getElementById('mapCanvas');
    canvas2 = document.getElementById('mapCanvas2');
    ctx = canvas.getContext('2d');
    ctx2 = canvas2.getContext('2d');
    canvasShell = document.getElementById('canvasShell');

    frontSlider = document.getElementById('frontSlider');
    behindSlider = document.getElementById('behindSlider');
    maxBehindSlider = document.getElementById('maxBehindSlider');
    modeSelect = document.getElementById('modeSelect');
    zombieHealthInput = document.getElementById('zombieHealth');
    zombieSpeedInput = document.getElementById('zombieSpeed');
    zombieDpsInput = document.getElementById('zombieDps');
    spawnPatternInfo = document.getElementById('spawnPatternInfo');
    skipFrontLockCheckbox = document.getElementById('skipFrontLock');
    animateFrontCheckbox = document.getElementById('animateFront');
    animateSpeedInput = document.getElementById('animateSpeed');
    dualViewCheckbox = document.getElementById('dualView');
    canvasBlock2 = document.getElementById('canvasBlock2');
    canvasTitle1 = document.getElementById('canvasTitle1');
    canvasTitle2 = document.getElementById('canvasTitle2');
    renderCommanderCheckbox = document.getElementById('renderCommander');
    commanderBoostCheckbox = document.getElementById('commanderBoost');
    dynamicScaleCheckbox = document.getElementById('dynamicScale');
    fixedMinInput = document.getElementById('fixedMin');
    fixedPeakInput = document.getElementById('fixedPeak');
    heatAlphaInput = document.getElementById('heatAlpha');
    showPathCheckbox = document.getElementById('showPath');
    showWhiteCheckbox = document.getElementById('showWhite');
    showPolygonCheckbox = document.getElementById('showPolygon');
    blueOnlyCheckbox = document.getElementById('blueOnly');
    captureRefButton = document.getElementById('captureRef');
    clearRefsButton = document.getElementById('clearRefs');
    pathWidthInput = document.getElementById('pathWidth');
    polygonAddButton = document.getElementById('polygonAdd');
    polygonClearButton = document.getElementById('polygonClear');
    polygonInfo = document.getElementById('polygonInfo');
    refInfo = document.getElementById('refInfo');
    magnifierCanvas = document.getElementById('magnifier');
    magnifierCtx = magnifierCanvas.getContext('2d');
    magnifierLabel = document.getElementById('magnifierLabel');
    simTimeSlider = document.getElementById('simTimeSlider');
    simTimeLabel = document.getElementById('simTimeLabel');
    simRealtimeCheckbox = document.getElementById('simRealtime');
    simRealtimeSpeedSlider = document.getElementById('simRealtimeSpeed');
    simRealtimeSpeedLabel = document.getElementById('simRealtimeSpeedLabel');
    baseRailgunnersInput = document.getElementById('baseRailgunners');
    simHeatmapCheckbox = document.getElementById('simHeatmap');
    simActionsListEl = document.getElementById('simulationActionsList');
    clearSimActionsButton = document.getElementById('clearSimActions');
    noActionsMessage = document.getElementById('noActionsMessage');
    frontLabel = document.getElementById('frontLabel');
    behindLabel = document.getElementById('behindLabel');
	    maxBehindLabel = document.getElementById('maxBehindLabel');
	    rangeInfo = document.getElementById('rangeInfo');
	    customRangesButton = document.getElementById('customRangesButton');
	    customRangesText = document.getElementById('customRangesText');
	    scaleInfo = document.getElementById('scaleInfo');
	    effectiveLabel = document.getElementById('effectiveLabel');
    pathLabel = document.getElementById('pathLabel');
    dpsTotalsLabel = document.getElementById('dpsTotals');
    dpsBreakdownLabel = document.getElementById('dpsBreakdown');
    mouseInfo = document.getElementById('mouseInfo');
    statusTimeEl = document.getElementById('statusTime');
    statusWorldEl = document.getElementById('statusWorld');
    statusPlacementEl = document.getElementById('statusPlacement');
    statusValueEl = document.getElementById('statusValue');
    statusModeEl = document.getElementById('statusMode');
    statusRealtimeEl = document.getElementById('statusRealtime');
    statusCountsEl = document.getElementById('statusCounts');
    if (spawnPatternInfo) {
      spawnPatternInfo.textContent = spawnPatternDescription();
    }

    if (pathWidthInput) {
      const parsed = parseFloat(pathWidthInput.value);
      const defaultWidth = DEFAULT_PATH_HALF_WIDTH * 2;
      pathWidth = Math.max(0.1, isNaN(parsed) ? defaultWidth : parsed);
      pathHalfWidth = pathWidth / 2;
      pathWidthInput.value = pathWidth.toFixed(1).replace(/0+$/,'').replace(/\.$/,'');
    } else {
      pathWidth = DEFAULT_PATH_HALF_WIDTH * 2;
      pathHalfWidth = DEFAULT_PATH_HALF_WIDTH;
    }

    buildPath();

    // Size canvas
    const logicalW = Math.round(worldWidth * SCALE);
    const logicalH = Math.round(worldHeight * SCALE);
    const aspect = `${logicalW}/${logicalH}`;
    [canvas, canvas2].forEach((c) => {
      c.width = Math.round(logicalW * DPR);
      c.height = Math.round(logicalH * DPR);
      c.style.width = '100%';
      c.style.height = 'auto';
      c.style.aspectRatio = aspect;
    });

    // Set slider ranges based on actual path length
    frontSlider.max = totalPathLength.toFixed(1);
    behindSlider.max = totalPathLength.toFixed(1);
    maxBehindSlider.max = totalPathLength.toFixed(1);
    currentFront = parseFloat(frontSlider.value);
    currentBehind = parseFloat(behindSlider.value);
    currentMaxBehind = parseFloat(maxBehindSlider.value);
    zombieHealth = parseFloat(zombieHealthInput.value) || DEFAULT_ZOMBIE_HEALTH;
    zombieSpeed = parseFloat(zombieSpeedInput.value) || DEFAULT_ZOMBIE_SPEED;
    zombieSpeedInput.value = zombieSpeed.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
    zombieDps = parseFloat(zombieDpsInput.value) || DEFAULT_ZOMBIE_DPS;
    skipFrontLocks = skipFrontLockCheckbox.checked;
    animateFront = animateFrontCheckbox.checked;
    animateSpeed = parseFloat(animateSpeedInput.value) || DEFAULT_FRONT_ANIM_SPEED;
    animateSpeedInput.value = animateSpeed.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
    dualView = dualViewCheckbox.checked;
    renderCommander = renderCommanderCheckbox.checked;
	    mode = modeSelect.value === MODE_LOCK
	      ? MODE_LOCK
	      : (modeSelect.value === MODE_SIMULATION
	        ? MODE_SIMULATION
	        : (modeSelect.value === MODE_TOTAL
	          ? MODE_TOTAL
	          : (modeSelect.value === MODE_BACKMOST
	            ? MODE_BACKMOST
	            : (modeSelect.value === MODE_L5TOTAL ? MODE_L5TOTAL : MODE_COVERAGE))));
	    commanderBoost = commanderBoostCheckbox.checked;
	    placementBoosted = commanderBoost;
	    if (customRangesText) {
	      customRangesText.value = `${DEFAULT_RANGE1}/${DEFAULT_RANGE2}`;
	      customRangesText.classList.remove('invalid');
	    }
	    setCustomRangesEnabled(false);
	    dynamicScale = dynamicScaleCheckbox.checked;
	    fixedMin = parseFloat(fixedMinInput.value) || 0;
	    fixedPeak = parseFloat(fixedPeakInput.value) || DEFAULT_FIXED_PEAK;
	    fixedMinInput.value = fixedMin.toFixed(0);
	    fixedPeakInput.value = fixedPeak.toFixed(0);
    heatAlpha = parseFloat(heatAlphaInput.value) || 0.5;
    heatAlphaInput.value = heatAlpha.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
    showPath = showPathCheckbox.checked;
    showWhite = showWhiteCheckbox.checked;
    showPolygon = showPolygonCheckbox.checked;
    blueOnly = blueOnlyCheckbox.checked;
    polygonPoints = DEFAULT_POLYGON.slice();
    updatePolygonInfo();
    blueOnly = blueOnlyCheckbox.checked;
    if (simTimeSlider) {
      simTime = parseFloat(simTimeSlider.value) || 0;
    }
    if (simRealtimeSpeedSlider) {
      const minRt = parseFloat(simRealtimeSpeedSlider.min) || 0.1;
      const maxRt = parseFloat(simRealtimeSpeedSlider.max) || 10;
      const parsedRt = parseFloat(simRealtimeSpeedSlider.value);
      simRealtimeSpeed = Math.max(minRt, Math.min(maxRt, isNaN(parsedRt) ? DEFAULT_REALTIME_SPEED : parsedRt));
      simRealtimeSpeedSlider.value = simRealtimeSpeed.toFixed(2);
    } else {
      simRealtimeSpeed = DEFAULT_REALTIME_SPEED;
    }
    if (simRealtimeSpeedLabel) {
      simRealtimeSpeedLabel.textContent = `${simRealtimeSpeed.toFixed(2)}x`;
    }
    if (baseRailgunnersInput) {
      const parsed = parseFloat(baseRailgunnersInput.value);
      baseRailgunners = Math.max(0, Math.round(isNaN(parsed) ? DEFAULT_BASE_RAILGUNNERS : parsed));
      baseRailgunnersInput.value = baseRailgunners.toString();
    } else {
      baseRailgunners = DEFAULT_BASE_RAILGUNNERS;
    }
    if (simHeatmapCheckbox) {
      simHeatmapEnabled = !!simHeatmapCheckbox.checked;
    }
    updateSimulationMaxTime();
    if (simTimeSlider) {
      simTimeSlider.max = simMaxTime.toFixed(2);
      simTimeSlider.value = simTime.toFixed(2);
    }
    if (simTimeLabel) {
      simTimeLabel.textContent = `${simTime.toFixed(2)}s`;
    }
    updateSimActionList();
    recomputeRanges();
    toggleModeControls();
    // Load background image
    bgImage = new Image();
    bgImage.onload = () => { bgReady = true; drawScene(); };
    bgImage.src = BG_FILE;

    buildGrid();
    updateLabels();
    if (mode === MODE_SIMULATION) {
      setSimulationTime(simTime);
    } else {
      refreshHeatmap();
    }
    updateRefInfo();

    // Events
    frontSlider.addEventListener('input', onSliderChange);
    behindSlider.addEventListener('input', onSliderChange);
    maxBehindSlider.addEventListener('input', onSliderChange);
    modeSelect.addEventListener('change', onModeChange);
    zombieHealthInput.addEventListener('input', onZombieParamsChange);
    zombieSpeedInput.addEventListener('input', onZombieParamsChange);
	    zombieDpsInput.addEventListener('input', onZombieParamsChange);
	    skipFrontLockCheckbox.addEventListener('change', onZombieParamsChange);
	    commanderBoostCheckbox.addEventListener('change', onBoostChange);
	    if (customRangesButton) customRangesButton.addEventListener('click', onCustomRangesToggle);
	    if (customRangesText) customRangesText.addEventListener('change', onCustomRangesTextChange);
	    dynamicScaleCheckbox.addEventListener('change', onScaleModeChange);
	    fixedMinInput.addEventListener('input', onFixedMinChange);
	    fixedPeakInput.addEventListener('input', onFixedPeakChange);
	    heatAlphaInput.addEventListener('input', onHeatAlphaChange);
    showPathCheckbox.addEventListener('change', onShowPathChange);
    showWhiteCheckbox.addEventListener('change', onShowPathChange);
    showPolygonCheckbox.addEventListener('change', onShowPathChange);
    blueOnlyCheckbox.addEventListener('change', onShowPathChange);
    animateFrontCheckbox.addEventListener('change', onAnimateToggle);
    animateSpeedInput.addEventListener('input', onAnimateSpeedChange);
    dualViewCheckbox.addEventListener('change', onDualViewChange);
    if (simTimeSlider) simTimeSlider.addEventListener('input', onSimTimeChange);
    if (simRealtimeCheckbox) simRealtimeCheckbox.addEventListener('change', onSimRealtimeToggle);
    if (simRealtimeSpeedSlider) simRealtimeSpeedSlider.addEventListener('input', onSimRealtimeSpeedChange);
    if (baseRailgunnersInput) baseRailgunnersInput.addEventListener('input', onBaseRailgunnersChange);
    if (simHeatmapCheckbox) simHeatmapCheckbox.addEventListener('change', onSimHeatmapToggle);
    renderCommanderCheckbox.addEventListener('change', () => {
      renderCommander = renderCommanderCheckbox.checked;
      drawScene();
    });
    captureRefButton.addEventListener('click', onCaptureRef);
    clearRefsButton.addEventListener('click', onClearRefs);
    if (pathWidthInput) pathWidthInput.addEventListener('input', onPathWidthChange);
    polygonAddButton.addEventListener('click', onPolygonAdd);
    polygonClearButton.addEventListener('click', onPolygonClear);
    if (clearSimActionsButton) clearSimActionsButton.addEventListener('click', clearSimulationActions);

    canvas.addEventListener('mousemove', (ev) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const px = (ev.clientX - rect.left) * scaleX;
      const py = (ev.clientY - rect.top) * scaleY;
      mouseCanvas = { x: px, y: py };
      mouseWorld = canvasToWorld(px, py);
      updateMouseInfo();
      updateMagnifier();
      drawScene();
    });

    canvas.addEventListener('mouseleave', () => {
      mouseWorld = null;
      mouseCanvas = null;
      updateMouseInfo();
      updateMagnifier();
      drawScene();
    });

    canvas.addEventListener('click', (ev) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const px = (ev.clientX - rect.left) * scaleX;
      const py = (ev.clientY - rect.top) * scaleY;

      if (captureState === 'waiting-image') {
        pendingSrc = { x: px, y: py };
        captureState = 'waiting-path';
        updateRefInfo();
        return;
      }
      if (captureState === 'waiting-path' && pendingSrc) {
        const dstPt = nearestPathCornerCanvas(px, py);
        if (dstPt) {
          refPoints.push({ src: pendingSrc, dst: dstPt });
          captureState = 'idle';
          pendingSrc = null;
          updateRefInfo();
        }
        return;
      }
      if (polygonCapture) {
        const world = canvasToWorld(px, py);
        polygonPoints.push(world);
        buildGrid();
        updatePolygonInfo();
        refreshHeatmap();
        return;
      }

      if (mode === MODE_SIMULATION) {
        const world = canvasToWorld(px, py);
        addPlacement(world, placementBoosted);
        return;
      }
    });

    canvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      if (mode !== MODE_SIMULATION) return;
      if (captureState !== 'idle' || polygonCapture) return;
      if (towerToPlace !== TOWER_PHASER) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const px = (ev.clientX - rect.left) * scaleX;
      const py = (ev.clientY - rect.top) * scaleY;
      const world = canvasToWorld(px, py);
      addPlacement(world, placementBoosted, { autoReplace: true });
    });

    window.addEventListener('keydown', (ev) => {
      if (mode !== MODE_SIMULATION) return;
      if (!ev.key) return;
      const key = ev.key.toLowerCase();
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      if (activeTag && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)) return;
      if (key === '1') {
        ev.preventDefault();
        towerToPlace = TOWER_PHASER;
        setSimulationTime(simTime);
      } else if (key === '2') {
        ev.preventDefault();
        towerToPlace = TOWER_SLEETER;
        setSimulationTime(simTime);
      } else if (key === 'c') {
        ev.preventDefault();
        placementBoosted = !placementBoosted;
        commanderBoostCheckbox.checked = placementBoosted;
        recomputeRanges();
        buildGrid();
        setSimulationTime(simTime);
      } else if (key === 'x') {
        ev.preventDefault();
        if (!mouseWorld) return;
        const hit = findTowerAt(mouseWorld);
        if (hit) {
          sellTower(hit.towerType || TOWER_PHASER, hit.id);
        }
      }
    });
  }

window.addEventListener('DOMContentLoaded', init);
