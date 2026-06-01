// Tower Battles Phaser simulator
// Source: phasers.html (extracted section: // ----- UI + mouse info -----)

// ----- UI + mouse info -----
  function setStatusChip(el, text) {
    if (!el) return;
    const cleaned = (text ?? '').toString().trim();
    el.textContent = cleaned;
    el.style.display = cleaned ? '' : 'none';
  }

  function setStatusChips({ time, world, placement, value, modeText, realtime, counts } = {}) {
    if (!mouseInfo) return;
    if (!statusTimeEl && !statusWorldEl && !statusPlacementEl) {
      const parts = [time, world, placement, value, modeText, realtime, counts].filter(Boolean);
      mouseInfo.textContent = parts.join(' · ');
      return;
    }
    setStatusChip(statusTimeEl, time);
    setStatusChip(statusWorldEl, world);
    setStatusChip(statusPlacementEl, placement);
    setStatusChip(statusValueEl, value);
    setStatusChip(statusModeEl, modeText);
    setStatusChip(statusRealtimeEl, realtime);
    setStatusChip(statusCountsEl, counts);
  }

  function towerLabel(type, id) {
    if (type === TOWER_SLEETER) return `S#${id}`;
    return `P#${id}`;
  }

  function updateCanvasTitle() {
    if (!canvasTitle1) return;
    const boostFlag = mode === MODE_SIMULATION ? placementBoosted : commanderBoost;
    canvasTitle1.textContent = `Commander boost: ${boostFlag ? 'ON' : 'OFF'}`;
  }

  function updateLabels() {
    if (mode === MODE_SIMULATION) {
      const phasers = currentSimState?.phasers || [];
      const sleeters = currentSimState?.sleeters || [];
      const locked = phasers.filter(p => p.status === 'locked').length;
      const disabled = phasers.filter(p => p.status === 'disabled').length;
      const zombiesAlive = currentSimState?.zombies?.length || 0;
	      const { base1, base2 } = getBaseRanges();
	      const boosted1 = base1 * BOOST_FACTOR;
	      const boosted2 = base2 * BOOST_FACTOR;
      const rails = currentSimState?.railgunners ?? Math.max(0, baseRailgunners - phasers.length);
      const modeLabel = placementBoosted ? 'Boosted' : 'Unboosted';
      const towerModeLabel = towerToPlace === TOWER_SLEETER ? 'Sleeter' : 'Phaser';
      frontLabel.textContent = `${simTime.toFixed(2)} s`;
      behindLabel.textContent = '--';
      maxBehindLabel.textContent = '--';
	      const baseLabel = useCustomRanges ? 'custom' : 'default';
	      rangeInfo.textContent = `Phaser ranges (${baseLabel}): ${base1.toFixed(1)} / ${base2.toFixed(1)} studs (boosted: ${boosted1.toFixed(1)} / ${boosted2.toFixed(1)}); Sleeter range: ${SLEETER_BASE_RANGE.toFixed(1)}; placing: ${towerModeLabel}`;
      scaleInfo.textContent =
        `Timeline: 0–${simMaxTime.toFixed(1)}s; realtime ${simRealtime ? 'ON' : 'OFF'} @ ${simRealtimeSpeed.toFixed(2)}x; ` +
        (simHeatmapEnabled ? `heatmap = lock duration (s) for ${modeLabel.toLowerCase()} Phaser placement.` : 'heatmap: OFF.');
      effectiveLabel.textContent =
        `Simulation t=${simTime.toFixed(2)}s · Zombies alive: ${zombiesAlive}; railgunners: ${rails}; placement mode: ${modeLabel}. ` +
        `phasers: ${phasers.length} (${locked} locked, ${disabled} disabled); sleeters: ${sleeters.length}.`;
      pathLabel.textContent =
        'Towers block a 6x6 red square; placements obey the path margin and the green polygon (if shown).';
      updateDpsPanel();
      return;
    }
    const maxBehindClamped = Math.max(currentMaxBehind, Math.min(currentBehind, currentFront));
    if (mode === MODE_TOTAL || mode === MODE_BACKMOST || mode === MODE_L5TOTAL) {
      frontLabel.textContent = '--';
      behindLabel.textContent = '--';
      maxBehindLabel.textContent = '--';
    } else {
      const effBehind = Math.min(currentBehind, currentFront);
      frontLabel.textContent = currentFront.toFixed(1) + ' studs';
      behindLabel.textContent = currentBehind.toFixed(1) + ' studs';
      maxBehindLabel.textContent = maxBehindClamped.toFixed(1) + ' studs';
    }
    rangeInfo.textContent = `Ranges: ${range1.toFixed(1)} / ${range2.toFixed(1)} studs`;
    const unit = mode === MODE_LOCK ? 's' : 'studs';
    scaleInfo.textContent = dynamicScale
      ? `Current max scale: auto (${maxExtraGlobal.toFixed(2)} ${unit})`
      : `Current scale: ${fixedMin.toFixed(1)}-${fixedPeak.toFixed(1)} ${unit}`;

    if (mode === MODE_LOCK) {
      const parts = [
        `Front zombie at ${currentFront.toFixed(1)} studs; lock duration mode.`,
        `Spawn pattern: ${spawnPatternDescription()}; health ${zombieHealth.toLocaleString()}, speed ${zombieSpeed.toFixed(2)} studs/s, DPS ${zombieDps.toLocaleString()}.`,
        skipFrontLocks ? 'Cells that first lock onto the front zombie are zeroed.' : 'Cells include locks onto the front zombie.'
      ];
      if (lastLockContext && !lastLockContext.found) {
        parts.push(`Front dies before reaching that point (max ≈ ${lastLockContext.maxReach.toFixed(1)} studs); heatmap will be zero.`);
      } else if (lastLockContext && lastLockContext.frontTime !== null) {
        parts.push(`Front reaches that point around t=${lastLockContext.frontTime.toFixed(1)}s (oldest alive zombie).`);
      }
      effectiveLabel.textContent = parts.join(' ');
    } else if (mode === MODE_TOTAL) {
      effectiveLabel.textContent =
        'Total extra path coverage: sum of L5 coverage minus L1 coverage across the full path.';
    } else if (mode === MODE_BACKMOST) {
      effectiveLabel.textContent =
        'Backmost L1 anchor: extra continuous L5 coverage from the earliest L1 point along the path.';
    } else if (mode === MODE_L5TOTAL) {
      effectiveLabel.textContent =
        'Total coverage: sum of all L5 range intervals along the full path.';
    } else {
      const effBehind = Math.min(currentBehind, currentFront);
      const cutoff = Math.max(0, currentFront - effBehind);
      const windowStart = Math.max(0, currentFront - maxBehindClamped);
      const windowEnd = cutoff;
      effectiveLabel.textContent =
        `Front zombie at ${currentFront.toFixed(1)} studs; Phaser must lock on a target within ` +
        `[${windowStart.toFixed(1)}, ${windowEnd.toFixed(1)}] along the path ` +
        `(behind distance between ${effBehind.toFixed(1)} and ${maxBehindClamped.toFixed(1)}).`;
    }

    pathLabel.textContent =
      `Path length ≈ ${totalPathLength.toFixed(1)} studs. Distances are measured from the start of the path.`;
    updateDpsPanel();
  }

  function updateMouseInfo() {
    if (mode === MODE_SIMULATION) {
      const phasers = currentSimState?.phasers || [];
      const sleeters = currentSimState?.sleeters || [];
      const locked = phasers.filter(p => p.status === 'locked').length;
      const disabled = phasers.filter(p => p.status === 'disabled').length;
      const zombiesAlive = currentSimState?.zombies?.length || 0;
      const modeLabel = placementBoosted ? 'Boosted' : 'Unboosted';
      const rails = currentSimState?.railgunners ?? Math.max(0, baseRailgunners - phasers.length);
      const realtimeLabel = simRealtime ? `Realtime: ${simRealtimeSpeed.toFixed(2)}x` : 'Realtime: OFF';
      const placingLabel = towerToPlace === TOWER_SLEETER ? 'Place: Sleeter (2)' : `Place: Phaser (1, ${modeLabel.toLowerCase()})`;
      const placementHint = towerToPlace === TOWER_SLEETER
        ? 'Left-click places Sleeter. (Right-click auto-replace is Phaser-only.)'
        : 'Left-click places Phaser. Right-click places auto-replace Phaser.';
      if (!mouseWorld) {
        setStatusChips({
          time: `t=${simTime.toFixed(2)}s`,
          placement: placementHint,
          modeText: placingLabel,
          realtime: realtimeLabel,
          counts: `Zombies: ${zombiesAlive}; Railgunners: ${rails}; Phasers: ${phasers.length} (${locked} locked, ${disabled} disabled); Sleeters: ${sleeters.length}`,
        });
        return;
      }
      const gx = (mouseWorld.x - worldMinX) / STEP;
      const gy = (worldMaxY - mouseWorld.y) / STEP;
      const i = Math.floor(gx);
      const j = Math.floor(gy);
      let cell = null;
      if (i >= 0 && i < gridCols && j >= 0 && j < gridRows) {
        cell = grid[j][i];
      }
      const state = ensureSimState();
      const blocked = placementBlockedAt(mouseWorld.x, mouseWorld.y, {
        phaserMap: state?.phaserMap,
        sleeterMap: state?.sleeterMap,
      });
      const placementText = blocked ? `Blocked: ${blocked}` : placementHint;
      let valueText = '';
      if (simHeatmapEnabled && cell) {
        const extra = cell.extra || 0;
        const placementInfo = cell.forbidden ? ' (on path / invalid)' : '';
        valueText = `Lock time ≈ ${extra.toFixed(2)}s${placementInfo}`;
      }
      setStatusChips({
        time: `t=${simTime.toFixed(2)}s`,
        world: `World (x=${mouseWorld.x.toFixed(1)}, y=${mouseWorld.y.toFixed(1)})`,
        placement: placementText,
        value: valueText,
        modeText: placingLabel,
        realtime: realtimeLabel,
        counts: `Zombies: ${zombiesAlive}; Railgunners: ${rails}; Phasers: ${phasers.length} (${locked} locked, ${disabled} disabled); Sleeters: ${sleeters.length}`,
      });
      return;
    }
    if (!mouseWorld) {
      setStatusChips({ value: 'Hover over the map to see Phaser ranges and local micro value.' });
      return;
    }
    const gx = (mouseWorld.x - worldMinX) / STEP;
    const gy = (worldMaxY - mouseWorld.y) / STEP;
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    if (i < 0 || i >= gridCols || j < 0 || j >= gridRows) {
      setStatusChips({
        world: `World (x=${mouseWorld.x.toFixed(1)}, y=${mouseWorld.y.toFixed(1)})`,
        value: 'Outside analysis region.',
      });
      return;
    }
    const cell = grid[j][i];
    const extra = cell.extra || 0;
    const placementInfo = cell.forbidden ? ' (on path / invalid placement)' : '';
    const descriptor = mode === MODE_LOCK
      ? 'lock time'
      : (mode === MODE_TOTAL
        ? 'extra total coverage'
        : (mode === MODE_BACKMOST
          ? 'backmost L1 extra coverage'
          : (mode === MODE_L5TOTAL ? 'total coverage' : 'extra continuous coverage')));
    const unit = mode === MODE_LOCK ? 's' : 'studs';
    setStatusChips({
      world: `World (x=${mouseWorld.x.toFixed(1)}, y=${mouseWorld.y.toFixed(1)})`,
      value: `${descriptor} ≈ ${extra.toFixed(2)} ${unit}${placementInfo}.`,
    });
  }

  function ensureSimState() {
    if (!currentSimState || Math.abs((currentSimState.time || 0) - simTime) > 1e-4) {
      currentSimState = simulateStateAt(simTime);
    }
    return currentSimState;
  }

  function updateSimulationMaxTime() {
    const schedule = buildSpawnSchedule();
    const lastSpawn = schedule.length ? schedule[schedule.length - 1] : 0;
    const travel = totalPathLength / zombieSpeed;
    simMaxTime = Math.max(30, Math.ceil(lastSpawn + travel + 30));
    if (simTimeSlider) {
      simTimeSlider.max = simMaxTime.toFixed(2);
    }
  }

  function setSimulationTime(t, { fromSlider = false } = {}) {
    const clamped = Math.max(0, Math.min(simMaxTime, isNaN(t) ? simTime : t));
    simTime = clamped;
    if (simTimeSlider && !fromSlider) {
      simTimeSlider.value = simTime.toFixed(2);
    }
    if (simTimeLabel) {
      simTimeLabel.textContent = `${simTime.toFixed(2)}s`;
    }
    updateCanvasTitle();
    currentSimState = simulateStateAt(simTime);
    if (simHeatmapEnabled) recomputeSimulationHeatmap();
    updateLabels();
    updateMouseInfo();
    drawScene();
    if (simRealtime && simTime >= simMaxTime - EPS) {
      simRealtime = false;
      if (simRealtimeCheckbox) simRealtimeCheckbox.checked = false;
    }
  }

  function onSimTimeChange() {
    const val = parseFloat(simTimeSlider.value);
    setSimulationTime(isNaN(val) ? simTime : val, { fromSlider: true });
  }

  function simRealtimeLoop(ts) {
    if (!simRealtime) {
      simLastRealtimeTs = null;
      return;
    }
    if (simLastRealtimeTs === null) {
      simLastRealtimeTs = ts;
      requestAnimationFrame(simRealtimeLoop);
      return;
    }
    const dt = Math.max(0, (ts - simLastRealtimeTs) / 1000) * simRealtimeSpeed;
    simLastRealtimeTs = ts;
    setSimulationTime(simTime + dt);
    if (simRealtime) requestAnimationFrame(simRealtimeLoop);
  }

  function onSimRealtimeToggle() {
    simRealtime = simRealtimeCheckbox.checked;
    simLastRealtimeTs = null;
    updateLabels();
    updateMouseInfo();
    if (simRealtime) requestAnimationFrame(simRealtimeLoop);
  }

  function onSimRealtimeSpeedChange() {
    if (!simRealtimeSpeedSlider) return;
    const v = parseFloat(simRealtimeSpeedSlider.value);
    if (!isNaN(v) && v > 0) {
      const min = parseFloat(simRealtimeSpeedSlider.min) || 0.1;
      const max = parseFloat(simRealtimeSpeedSlider.max) || 10;
      simRealtimeSpeed = Math.max(min, Math.min(max, v));
      simRealtimeSpeedSlider.value = simRealtimeSpeed.toFixed(2);
      if (simRealtimeSpeedLabel) {
        simRealtimeSpeedLabel.textContent = `${simRealtimeSpeed.toFixed(2)}x`;
      }
      updateLabels();
      updateMouseInfo();
    }
  }

  function findTowerAt(worldPt) {
    const state = ensureSimState();
    const phasers = state?.phasers || [];
    const sleeters = state?.sleeters || [];
    let best = null;
    let bestD2 = PHASER_HIT_RADIUS * PHASER_HIT_RADIUS;
    for (const tower of [...phasers, ...sleeters]) {
      const d2 = dist2(worldPt.x, worldPt.y, tower.x, tower.y);
      if (d2 <= bestD2 + EPS) {
        best = tower;
        bestD2 = d2;
      }
    }
    return best;
  }

  function addSimulationAction(action) {
    simulationActions.push(action);
    simulationActions.sort((a, b) => (a.time - b.time) || (a.id - b.id));
    updateSimActionList();
    setSimulationTime(simTime);
  }

  function removeSimAction(id) {
    const idx = simulationActions.findIndex(a => a.id === id);
    if (idx === -1) return;
    const removed = simulationActions[idx];
    simulationActions.splice(idx, 1);
    if (removed.type === 'place') {
      const removedType = removed.towerType || TOWER_PHASER;
      const removedId = removed.towerId ?? removed.phaserId;
      simulationActions = simulationActions.filter(a => {
        if (a.type !== 'sell') return true;
        const sellType = a.towerType || TOWER_PHASER;
        const sellId = a.towerId ?? a.phaserId;
        return !(sellType === removedType && sellId === removedId);
      });
    }
    updateSimActionList();
    setSimulationTime(Math.min(simTime, removed.time));
  }

  function clearSimulationActions() {
    simulationActions = [];
    updateSimActionList();
    setSimulationTime(simTime);
  }

  function addPlacement(worldPt, boosted = false, { autoReplace = false, towerType = null } = {}) {
    const state = ensureSimState();
    const type = towerType || towerToPlace || TOWER_PHASER;
    const reason = placementBlockedAt(worldPt.x, worldPt.y, { phaserMap: state?.phaserMap, sleeterMap: state?.sleeterMap });
    if (reason) {
      setStatusChips({ placement: `Cannot place: ${reason}` });
      return;
    }
    const nextId = type === TOWER_SLEETER ? sleeterIdCounter++ : phaserIdCounter++;
    const action = {
      id: simActionIdCounter++,
      type: 'place',
      towerType: type,
      towerId: nextId,
      phaserId: type === TOWER_PHASER ? nextId : undefined,
      time: simTime,
      x: worldPt.x,
      y: worldPt.y,
      boosted: type === TOWER_PHASER ? !!boosted : false,
      autoReplace: type === TOWER_PHASER ? !!autoReplace : false,
    };
    addSimulationAction(action);
  }

  function sellTower(towerType, towerId) {
    const action = {
      id: simActionIdCounter++,
      type: 'sell',
      towerType: towerType || TOWER_PHASER,
      towerId,
      phaserId: towerType === TOWER_PHASER ? towerId : undefined,
      time: simTime,
    };
    addSimulationAction(action);
  }

  function updateSimActionList() {
    if (!simActionsListEl) return;
    simActionsListEl.innerHTML = '';
    if (!simulationActions.length) {
      if (noActionsMessage) {
        noActionsMessage.style.display = '';
        simActionsListEl.appendChild(noActionsMessage);
      }
      return;
    }
    if (noActionsMessage) {
      noActionsMessage.style.display = 'none';
    }
    simulationActions
      .slice()
      .sort((a, b) => (a.time - b.time) || (a.id - b.id))
      .forEach(action => {
        const row = document.createElement('div');
        row.className = 'actionItem';
        const meta = document.createElement('div');
        meta.className = 'actionMeta';
        const title = document.createElement('strong');
        const timeText = `t=${action.time.toFixed(2)}s`;
        const actionTowerType = action.towerType || TOWER_PHASER;
        const actionTowerId = action.towerId ?? action.phaserId;
        if (action.type === 'place') {
          title.textContent = `${timeText} — Place ${towerLabel(actionTowerType, actionTowerId)}`;
        } else {
          title.textContent = `${timeText} — Sell ${towerLabel(actionTowerType, actionTowerId)}`;
        }
        const detail = document.createElement('span');
        if (action.type === 'place') {
          detail.textContent = `(${action.x.toFixed(1)}, ${action.y.toFixed(1)})`;
        } else {
          detail.textContent = 'Remove tower from the field';
        }
        meta.appendChild(title);
        meta.appendChild(detail);
        const badges = document.createElement('div');
        badges.style.display = 'flex';
        badges.style.gap = '6px';
        if (action.type === 'place' && actionTowerType === TOWER_PHASER && action.boosted) {
          const b = document.createElement('span');
          b.className = 'actionBadge boosted';
          b.textContent = 'Commander boost';
          badges.appendChild(b);
        }
        if (action.type === 'place' && actionTowerType === TOWER_PHASER && action.autoReplace) {
          const b = document.createElement('span');
          b.className = 'actionBadge autoReplace';
          b.textContent = 'Auto-replace';
          badges.appendChild(b);
        }
        if (action.type === 'sell') {
          const b = document.createElement('span');
          b.className = 'actionBadge sell';
          b.textContent = 'Sell';
          badges.appendChild(b);
        }
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => removeSimAction(action.id));
        row.appendChild(meta);
        row.appendChild(badges);
        row.appendChild(removeBtn);
        simActionsListEl.appendChild(row);
      });
  }

  function refreshHeatmap() {
    if (mode === MODE_SIMULATION) {
      dualView = false;
      if (dualViewCheckbox) {
        dualViewCheckbox.checked = false;
      }
      if (canvasBlock2) {
        canvasBlock2.style.display = 'none';
      }
      if (canvasShell) {
        canvasShell.classList.add('single-view');
      }
      updateCanvasTitle();
      setSimulationTime(simTime);
      return;
    }
	    recomputeHeatmap();
	    if (dualView) {
	      const altBoost = !commanderBoost;
	      const { base1, base2 } = getBaseRanges();
	      const altRange1 = base1 * (altBoost ? BOOST_FACTOR : 1);
	      const altRange2 = base2 * (altBoost ? BOOST_FACTOR : 1);
      secondaryGrid = buildGridWithRanges(altRange1, altRange2);
      secondaryMaxExtra = mode === MODE_LOCK
        ? recomputeHeatmapLock(secondaryGrid, { updateGlobalMax: false, storeLast: false })
        : recomputeHeatmapByMode(secondaryGrid, { updateGlobalMax: false });
      canvasBlock2.style.display = '';
      canvasTitle2.textContent = `Commander boost: ${altBoost ? 'ON' : 'OFF'}`;
    } else {
      canvasBlock2.style.display = 'none';
    }
    if (canvasShell) {
      canvasShell.classList.toggle('single-view', !dualView);
    }
    updateCanvasTitle();
    updateLabels();
    updateMouseInfo();
    drawScene();
  }

  function animateLoop(ts) {
    if (!animateFront) {
      lastAnimateTime = null;
      return;
    }
    if (lastAnimateTime === null) {
      lastAnimateTime = ts;
      requestAnimationFrame(animateLoop);
      return;
    }
    const dt = Math.max(0, (ts - lastAnimateTime) / 1000);
    lastAnimateTime = ts;
    const delta = animateSpeed * dt;
    let newFront = currentFront + delta;
    const len = totalPathLength;
    if (len > 0) {
      newFront = ((newFront % len) + len) % len;
    }
    currentFront = newFront;
    frontSlider.value = currentFront.toFixed(1);
    refreshHeatmap();
    requestAnimationFrame(animateLoop);
  }

  function updateMagnifier() {
    if (!magnifierCtx || !bgReady || !bgImage || !mouseCanvas) return;
    // Convert canvas coords to image coords because the image is stretched to canvas size.
    const logicalW = canvas.width / DPR;
    const logicalH = canvas.height / DPR;
    const scaleX = bgImage.width / logicalW;
    const scaleY = bgImage.height / logicalH;
    const imgX = (mouseCanvas.x / DPR) * scaleX;
    const imgY = (mouseCanvas.y / DPR) * scaleY;
    if (imgX < 0 || imgY < 0 || imgX > bgImage.width || imgY > bgImage.height) {
      magnifierCtx.clearRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);
      magnifierLabel.textContent = 'Outside image';
      return;
    }
    const sizeX = 30 * scaleX;
    const sizeY = 30 * scaleY;
    magnifierCtx.clearRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);
    magnifierCtx.fillStyle = '#000';
    magnifierCtx.fillRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);
    magnifierCtx.imageSmoothingEnabled = false;
    magnifierCtx.drawImage(
      bgImage,
      imgX - sizeX / 2, imgY - sizeY / 2, sizeX, sizeY,
      0, 0, magnifierCanvas.width, magnifierCanvas.height
    );
    magnifierCtx.strokeStyle = '#ff0';
    magnifierCtx.lineWidth = 1;
    magnifierCtx.beginPath();
    magnifierCtx.moveTo(magnifierCanvas.width / 2, 0);
    magnifierCtx.lineTo(magnifierCanvas.width / 2, magnifierCanvas.height);
    magnifierCtx.moveTo(0, magnifierCanvas.height / 2);
    magnifierCtx.lineTo(magnifierCanvas.width, magnifierCanvas.height / 2);
    magnifierCtx.stroke();
    magnifierLabel.textContent = `Warped img (${imgX.toFixed(1)}, ${imgY.toFixed(1)})`;
  }

  function updateRefInfo() {
    const lines = refPoints.map((p, idx) =>
      `${idx + 1}. src=(${p.src.x.toFixed(1)}, ${p.src.y.toFixed(1)}) -> dst=(${p.dst.x.toFixed(1)}, ${p.dst.y.toFixed(1)})`);
    if (captureState === 'waiting-path' && pendingSrc) {
      lines.push(`Pending: image=(${pendingSrc.x.toFixed(1)}, ${pendingSrc.y.toFixed(1)}); click a path corner`);
    } else if (captureState === 'waiting-image') {
      lines.push('Pending: click image, then path corner');
    }
    refInfo.textContent = lines.join('\n');
    drawScene();
  }

	  function updatePolygonInfo() {
	    const status = polygonCapture ? ' (capturing: click map to add points)' : '';
	    if (polygonPoints.length === 0) {
	      polygonInfo.textContent = 'Polygon: none (placements unrestricted)' + status;
	    } else {
	      polygonInfo.textContent = `Polygon: ${polygonPoints.length} point(s); placements must be inside` + status;
	    }
	  }

	  function getBaseRanges() {
	    const base1 = useCustomRanges ? customBaseRange1 : DEFAULT_RANGE1;
	    const base2 = useCustomRanges ? customBaseRange2 : DEFAULT_RANGE2;
	    return { base1, base2 };
	  }

	  function parseCustomRangesText(text) {
	    const raw = (text || '').trim().toLowerCase();
	    if (!raw) return null;
	    if (raw === 'default' || raw === 'defaults') return { base1: DEFAULT_RANGE1, base2: DEFAULT_RANGE2 };
	    const nums = raw.match(/[+-]?(?:\d+\.?\d*|\.\d+)/g);
	    if (!nums || nums.length === 0) return null;
	    const a = parseFloat(nums[0]);
	    const b = nums.length >= 2 ? parseFloat(nums[1]) : null;
	    if (!Number.isFinite(a) || a <= 0) return null;
	    if (b === null) {
	      const ratio = DEFAULT_RANGE1 / DEFAULT_RANGE2;
	      const base2 = a;
	      const base1 = Math.max(0.1, base2 * ratio);
	      return { base1, base2 };
	    }
	    if (!Number.isFinite(b) || b <= 0) return null;
	    const base1 = Math.min(a, b);
	    const base2 = Math.max(a, b);
	    return { base1, base2 };
	  }

	  function setCustomRangesEnabled(enabled) {
	    useCustomRanges = !!enabled;
	    if (customRangesButton) {
	      customRangesButton.classList.toggle('on', useCustomRanges);
	      customRangesButton.textContent = useCustomRanges ? 'Custom: ON' : 'Custom: OFF';
	    }
	  }

	  function applyRangesChange() {
	    recomputeRanges();
	    buildGrid();
	    if (mode === MODE_SIMULATION) {
	      setSimulationTime(simTime);
	    } else {
	      refreshHeatmap();
	    }
	  }

	  function recomputeRanges() {
	    const boostedFlag = mode === MODE_SIMULATION ? placementBoosted : commanderBoost;
	    const { base1, base2 } = getBaseRanges();
	    range1 = base1 * (boostedFlag ? BOOST_FACTOR : 1);
	    range2 = base2 * (boostedFlag ? BOOST_FACTOR : 1);
	  }

  function onSliderChange() {
    currentFront = parseFloat(frontSlider.value);
    currentBehind = parseFloat(behindSlider.value);
    currentMaxBehind = parseFloat(maxBehindSlider.value);
    if (currentMaxBehind < currentBehind) {
      currentMaxBehind = currentBehind;
      maxBehindSlider.value = currentMaxBehind.toFixed(1);
    }
    refreshHeatmap();
  }

	  function onBoostChange() {
	    commanderBoost = commanderBoostCheckbox.checked;
	    recomputeRanges();
	    buildGrid();
	    refreshHeatmap();
	  }

	  function onCustomRangesToggle() {
	    if (!customRangesText) return;
	    if (useCustomRanges) {
	      setCustomRangesEnabled(false);
	      customRangesText.classList.remove('invalid');
	      applyRangesChange();
	      return;
	    }
	    const parsed = parseCustomRangesText(customRangesText.value);
	    if (!parsed) {
	      customRangesText.classList.add('invalid');
	      return;
	    }
	    customRangesText.classList.remove('invalid');
	    customBaseRange1 = parsed.base1;
	    customBaseRange2 = parsed.base2;
	    setCustomRangesEnabled(true);
	    const fmt = (n) => n.toFixed(1).replace(/0+$/,'').replace(/\.$/,'');
	    customRangesText.value = `${fmt(customBaseRange1)}/${fmt(customBaseRange2)}`;
	    applyRangesChange();
	  }

	  function onCustomRangesTextChange() {
	    if (!useCustomRanges || !customRangesText) return;
	    const parsed = parseCustomRangesText(customRangesText.value);
	    if (!parsed) {
	      customRangesText.classList.add('invalid');
	      return;
	    }
	    customRangesText.classList.remove('invalid');
	    customBaseRange1 = parsed.base1;
	    customBaseRange2 = parsed.base2;
	    applyRangesChange();
	  }

	  function onScaleModeChange() {
	    dynamicScale = dynamicScaleCheckbox.checked;
	    refreshHeatmap();
	  }

  function onFixedMinChange() {
    const val = parseFloat(fixedMinInput.value);
    if (!isNaN(val) && val >= 0) {
      fixedMin = val;
      refreshHeatmap();
    }
  }

  function onFixedPeakChange() {
    const val = parseFloat(fixedPeakInput.value);
    if (!isNaN(val) && val > 0) {
      fixedPeak = val;
      refreshHeatmap();
    }
  }

  function onHeatAlphaChange() {
    const val = parseFloat(heatAlphaInput.value);
    if (!isNaN(val)) {
      heatAlpha = Math.min(1, Math.max(0, val));
      heatAlphaInput.value = heatAlpha.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
      drawScene();
    }
  }

  function onPathWidthChange() {
    if (!pathWidthInput) return;
    const val = parseFloat(pathWidthInput.value);
    if (isNaN(val) || val <= 0) {
      pathWidthInput.value = pathWidth.toFixed(1).replace(/0+$/,'').replace(/\.$/,'');
      return;
    }
    pathWidth = val;
    pathHalfWidth = pathWidth / 2;
    pathWidthInput.value = pathWidth.toFixed(1).replace(/0+$/,'').replace(/\.$/,'');
    buildPath();
    buildGrid();
    if (mode === MODE_SIMULATION) {
      setSimulationTime(simTime);
    } else {
      refreshHeatmap();
    }
  }

  function onShowPathChange() {
    showPath = showPathCheckbox.checked;
    showWhite = showWhiteCheckbox.checked;
    showPolygon = showPolygonCheckbox.checked;
    blueOnly = blueOnlyCheckbox.checked;
    drawScene();
  }

  function onDualViewChange() {
    dualView = dualViewCheckbox.checked;
    refreshHeatmap();
  }

  function onAnimateToggle() {
    animateFront = animateFrontCheckbox.checked;
    lastAnimateTime = null;
    if (animateFront) requestAnimationFrame(animateLoop);
  }

  function onAnimateSpeedChange() {
    const v = parseFloat(animateSpeedInput.value);
    if (!isNaN(v) && v > 0) {
      animateSpeed = v;
      animateSpeedInput.value = animateSpeed.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
    }
  }

  function toggleModeControls() {
    const isSim = mode === MODE_SIMULATION;
    const usesFront = mode === MODE_COVERAGE || mode === MODE_LOCK;
    document.querySelectorAll('.frontControl').forEach(el => {
      el.style.display = usesFront ? 'flex' : 'none';
    });
    document.querySelectorAll('.coverageControl').forEach(el => {
      el.style.display = mode === MODE_COVERAGE ? 'flex' : 'none';
    });
    document.querySelectorAll('.lockControl').forEach(el => {
      el.style.display = mode === MODE_LOCK ? 'flex' : 'none';
    });
    document.querySelectorAll('.simControl').forEach(el => {
      el.style.display = isSim ? (el.classList.contains('row') ? 'flex' : 'block') : 'none';
    });
    const simActionsPanel = document.getElementById('simActions');
    if (simActionsPanel) simActionsPanel.style.display = isSim ? '' : 'none';
    if (dualViewCheckbox) {
      dualViewCheckbox.disabled = isSim;
    }
    if (commanderBoostCheckbox) {
      commanderBoostCheckbox.disabled = isSim;
      commanderBoostCheckbox.checked = isSim ? placementBoosted : commanderBoost;
    }
    if (simTimeSlider) simTimeSlider.disabled = !isSim;
    if (simRealtimeCheckbox) simRealtimeCheckbox.disabled = !isSim;
    if (simRealtimeSpeedSlider) simRealtimeSpeedSlider.disabled = !isSim;
    if (clearSimActionsButton) clearSimActionsButton.disabled = !isSim;
    [frontSlider, behindSlider, maxBehindSlider, animateFrontCheckbox, animateSpeedInput].forEach(ctrl => {
      if (ctrl) ctrl.disabled = isSim || !usesFront;
    });
    if (isSim) {
      dualView = false;
      animateFront = false;
      if (animateFrontCheckbox) animateFrontCheckbox.checked = false;
    } else {
      if (dualViewCheckbox) dualViewCheckbox.disabled = false;
      [frontSlider, behindSlider, maxBehindSlider, animateFrontCheckbox].forEach(ctrl => {
        if (ctrl) ctrl.disabled = !usesFront;
      });
      if (simRealtimeCheckbox) simRealtimeCheckbox.checked = false;
      simRealtime = false;
      if (!usesFront) {
        animateFront = false;
        if (animateFrontCheckbox) animateFrontCheckbox.checked = false;
      }
    }
  }

  function onModeChange() {
    const val = modeSelect.value;
    mode = val === MODE_LOCK
      ? MODE_LOCK
      : (val === MODE_SIMULATION
        ? MODE_SIMULATION
        : (val === MODE_TOTAL
          ? MODE_TOTAL
          : (val === MODE_BACKMOST
            ? MODE_BACKMOST
            : (val === MODE_L5TOTAL ? MODE_L5TOTAL : MODE_COVERAGE))));
    toggleModeControls();
    if (mode === MODE_SIMULATION) {
      animateFront = false;
      if (animateFrontCheckbox) animateFrontCheckbox.checked = false;
      dualView = false;
      if (dualViewCheckbox) dualViewCheckbox.checked = false;
      if (canvasBlock2) canvasBlock2.style.display = 'none';
      if (canvasShell) canvasShell.classList.add('single-view');
      recomputeRanges();
      buildGrid();
      updateSimulationMaxTime();
      setSimulationTime(simTime);
      return;
    }
    recomputeRanges();
    buildGrid();
    refreshHeatmap();
  }

  function onZombieParamsChange() {
    const zh = parseFloat(zombieHealthInput.value);
    const zs = parseFloat(zombieSpeedInput.value);
    const zd = parseFloat(zombieDpsInput.value);
    skipFrontLocks = skipFrontLockCheckbox.checked;
    if (!isNaN(zh) && zh > 0) zombieHealth = zh;
    if (!isNaN(zs) && zs > 0) zombieSpeed = zs;
    if (!isNaN(zd) && zd > 0) zombieDps = zd;
    zombieSpeedInput.value = zombieSpeed.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
    zombieHealthInput.value = Math.round(zombieHealth).toString();
    zombieDpsInput.value = Math.round(zombieDps).toString();
    updateSimulationMaxTime();
    if (mode === MODE_SIMULATION) {
      setSimulationTime(Math.min(simTime, simMaxTime));
    } else {
      refreshHeatmap();
    }
  }

  function onBaseRailgunnersChange() {
    if (!baseRailgunnersInput) return;
    const parsed = parseFloat(baseRailgunnersInput.value);
    if (!Number.isFinite(parsed)) return;
    baseRailgunners = Math.max(0, Math.round(parsed));
    baseRailgunnersInput.value = baseRailgunners.toString();
    if (mode === MODE_SIMULATION) {
      setSimulationTime(simTime);
    } else {
      updateLabels();
      updateMouseInfo();
    }
  }

  function onSimHeatmapToggle() {
    if (!simHeatmapCheckbox) return;
    simHeatmapEnabled = !!simHeatmapCheckbox.checked;
    if (mode === MODE_SIMULATION) {
      if (simHeatmapEnabled) recomputeSimulationHeatmap();
      updateLabels();
      updateMouseInfo();
      drawScene();
    }
  }

  function onPolygonAdd() {
    polygonCapture = !polygonCapture;
    updatePolygonInfo();
  }

  function onPolygonClear() {
    polygonCapture = false;
    polygonPoints = [];
    buildGrid();
    updatePolygonInfo();
    refreshHeatmap();
  }

  function onCaptureRef() {
    captureState = 'waiting-image';
    pendingSrc = null;
    updateRefInfo();
  }

  function onClearRefs() {
    refPoints = [];
    captureState = 'idle';
    pendingSrc = null;
    updateRefInfo();
  }
