// Tower Battles Phaser simulator
// Source: phasers.html (extracted section: // ----- Grid + heatmap -----)

// ----- Grid + heatmap -----
  function buildGridWithRanges(r1, r2) {
    const cols = Math.floor(worldWidth / STEP);
    const rows = Math.floor(worldHeight / STEP);
    const out = new Array(rows);
    for (let j = 0; j < rows; j++) {
      const row = new Array(cols);
      const y = worldMaxY - (j + 0.5) * STEP;
      for (let i = 0; i < cols; i++) {
        const x = worldMinX + (i + 0.5) * STEP;
        const cell = { x, y, extra: 0 };
        if (inForbidden(x, y)) {
          cell.forbidden = true;
          cell.intervals1 = [];
          cell.intervals1Merged = [];
          cell.intervals2 = [];
          cell.intervals2Merged = [];
        } else {
          cell.forbidden = false;
          cell.intervals1 = computeIntervalsForRadius(x, y, r1);
          cell.intervals1Merged = mergeIntervals(cell.intervals1);
          cell.intervals2 = computeIntervalsForRadius(x, y, r2);
          cell.intervals2Merged = mergeIntervals(cell.intervals2);
        }
        row[i] = cell;
      }
      out[j] = row;
    }
    gridCols = cols;
    gridRows = rows;
    return out;
  }

  function buildGrid() {
    grid = buildGridWithRanges(range1, range2);
  }

  function recomputeHeatmap() {
    if (mode === MODE_SIMULATION) {
      recomputeSimulationHeatmap();
      return;
    }
    const max = mode === MODE_LOCK
      ? recomputeHeatmapLock(grid, { updateGlobalMax: true, storeLast: true })
      : recomputeHeatmapByMode(grid, { updateGlobalMax: true });
    maxExtraGlobal = max;
  }

  function intervalLength(intervals) {
    let total = 0;
    for (const [a, b] of intervals) {
      if (b > a) total += (b - a);
    }
    return total;
  }

  function recomputeHeatmapCoverage(gridLocal, opts = {}) {
    lastLockContext = null;
    const sFront = currentFront;
    const windowEnd = Math.max(0, sFront - Math.min(currentBehind, sFront)); // max behind (nearer to front)
    const windowStart = Math.max(0, sFront - currentMaxBehind);             // min behind (farther from front)

    let maxExtra = 0;

    for (let j = 0; j < gridLocal.length; j++) {
      for (let i = 0; i < gridLocal[0].length; i++) {
        const cell = gridLocal[j][i];
        let extra = 0;

        if (!cell.forbidden && cell.intervals1.length && cell.intervals2Merged.length && windowStart <= windowEnd + EPS) {
          // Frontmost point the Phaser could lock (zombies only exist up to sFront)
          let frontmost = null;
          for (const [a1, b1] of cell.intervals1) {
            const clippedA = Math.max(a1, 0);
            const clippedB = Math.min(b1, sFront);
            if (clippedB + EPS >= clippedA) {
              if (frontmost === null || clippedB > frontmost) frontmost = clippedB;
            }
          }

          // Require that the frontmost reachable point also lies inside the allowed window.
          if (frontmost !== null && frontmost + EPS >= windowStart && frontmost <= windowEnd + EPS) {
            const s0 = frontmost;
            for (const [a2, b2] of cell.intervals2Merged) {
              if (a2 - EPS <= s0 && s0 <= b2 + EPS) {
                extra = Math.max(0, b2 - s0);
                break;
              }
            }
          }
        }

        cell.extra = extra;
        if (extra > maxExtra) maxExtra = extra;
      }
    }
    if (opts.updateGlobalMax) maxExtraGlobal = maxExtra;
    return maxExtra;
  }

  function recomputeHeatmapTotal(gridLocal, opts = {}) {
    lastLockContext = null;
    let maxExtra = 0;

    for (let j = 0; j < gridLocal.length; j++) {
      for (let i = 0; i < gridLocal[0].length; i++) {
        const cell = gridLocal[j][i];
        let extra = 0;

        if (!cell.forbidden && cell.intervals2Merged.length) {
          const len2 = intervalLength(cell.intervals2Merged);
          const len1 = cell.intervals1Merged.length ? intervalLength(cell.intervals1Merged) : 0;
          extra = Math.max(0, len2 - len1);
        }

        cell.extra = extra;
        if (extra > maxExtra) maxExtra = extra;
      }
    }
    if (opts.updateGlobalMax) maxExtraGlobal = maxExtra;
    return maxExtra;
  }

  function recomputeHeatmapByMode(gridLocal, opts = {}) {
    if (mode === MODE_TOTAL) {
      return recomputeHeatmapTotal(gridLocal, opts);
    }
    if (mode === MODE_BACKMOST) {
      return recomputeHeatmapBackmost(gridLocal, opts);
    }
    if (mode === MODE_L5TOTAL) {
      return recomputeHeatmapL5Total(gridLocal, opts);
    }
    return recomputeHeatmapCoverage(gridLocal, opts);
  }

  function recomputeHeatmapBackmost(gridLocal, opts = {}) {
    lastLockContext = null;
    let maxExtra = 0;

    for (let j = 0; j < gridLocal.length; j++) {
      for (let i = 0; i < gridLocal[0].length; i++) {
        const cell = gridLocal[j][i];
        let extra = 0;

        if (!cell.forbidden && cell.intervals1Merged.length && cell.intervals2Merged.length) {
          const s0 = cell.intervals1Merged[0][0];
          const interval2 = findContainingInterval(cell.intervals2Merged, s0);
          if (interval2) {
            extra = Math.max(0, interval2[1] - s0);
          }
        }

        cell.extra = extra;
        if (extra > maxExtra) maxExtra = extra;
      }
    }
    if (opts.updateGlobalMax) maxExtraGlobal = maxExtra;
    return maxExtra;
  }

  function recomputeHeatmapL5Total(gridLocal, opts = {}) {
    lastLockContext = null;
    let maxExtra = 0;

    for (let j = 0; j < gridLocal.length; j++) {
      for (let i = 0; i < gridLocal[0].length; i++) {
        const cell = gridLocal[j][i];
        let extra = 0;

        if (!cell.forbidden && cell.intervals2Merged.length) {
          extra = intervalLength(cell.intervals2Merged);
        }

        cell.extra = extra;
        if (extra > maxExtra) maxExtra = extra;
      }
    }
    if (opts.updateGlobalMax) maxExtraGlobal = maxExtra;
    return maxExtra;
  }

  function buildSpawnSchedule() {
    const times = [];
    const groupStride = (GROUP_SIZE - 1) * INTRA_GROUP_DELAY + INTER_GROUP_DELAY;
    for (let g = 0; g < GROUP_COUNT; g++) {
      const base = g * groupStride;
      for (let i = 0; i < GROUP_SIZE; i++) {
        times.push(base + i * INTRA_GROUP_DELAY);
      }
    }
    return times;
  }

  function spawnPatternDescription() {
    return `${GROUP_COUNT} groups of ${GROUP_SIZE} (${INTRA_GROUP_DELAY}s in-group, ${INTER_GROUP_DELAY}s between groups)`;
  }

  function buildLockTimeline(sFront) {
    const tKill = zombieHealth / zombieDps;
    const res = {
      found: false,
      frontTime: null,
      frontIndex: null,
      spawnTimes: [],
      startTimes: [],
      endTimes: [],
      maxReach: 0,
    };
    const v = zombieSpeed;
    const spawnSchedule = buildSpawnSchedule();
    let prevEnd = 0;

    spawnSchedule.forEach((spawn, idx) => {
      const start = Math.max(spawn, prevEnd);
      const end = start + tKill;
      res.spawnTimes.push(spawn);
      res.startTimes.push(start);
      res.endTimes.push(end);
      const reach = Math.min(totalPathLength, v * (end - spawn));
      res.maxReach = Math.max(res.maxReach, reach);

      const tHit = spawn + sFront / v;
      if (!res.found && tHit + EPS >= start && tHit <= end + EPS) {
        res.found = true;
        res.frontTime = tHit;
        res.frontIndex = idx;
      }
      prevEnd = end;
    });

    return res;
  }

  function recomputeHeatmapLock(gridLocal, { updateGlobalMax = false, storeLast = false } = {}) {
    const timeline = buildLockTimeline(currentFront);
    if (storeLast) lastLockContext = timeline;
    let maxExtraLocal = 0;

    if (!timeline.found) {
      for (let j = 0; j < gridLocal.length; j++) {
        for (let i = 0; i < gridLocal[0].length; i++) {
          gridLocal[j][i].extra = 0;
        }
      }
      if (updateGlobalMax) maxExtraGlobal = 0;
      return 0;
    }

    const frontTime = timeline.frontTime;

    for (let j = 0; j < gridLocal.length; j++) {
      for (let i = 0; i < gridLocal[0].length; i++) {
        const cell = gridLocal[j][i];
        let duration = 0;

        if (!cell.forbidden && cell.intervals1.length && cell.intervals2Merged.length) {
          if (!overlapsRange(cell.intervals1, 0, currentFront)) {
            cell.extra = 0;
            continue;
          }
          let bestEntryTime = Infinity;
          let bestIndex = null;
          let bestEntryS = null;

          for (let idx = timeline.frontIndex; idx < timeline.spawnTimes.length; idx++) {
            const spawn = timeline.spawnTimes[idx];
            if (spawn > bestEntryTime) break; // later spawns cannot beat current best
            const start = timeline.startTimes[idx];
            const end = timeline.endTimes[idx];

            const sMin = Math.max(0, zombieSpeed * (frontTime - spawn)); // position at front time or 0 if not spawned yet
            const sEntry = nextEntryInIntervals(cell.intervals1, sMin);
            if (sEntry === null) continue;

            const tEntry = spawn + sEntry / zombieSpeed;
            if (tEntry + EPS < frontTime) continue; // before our snapshot
            if (tEntry > end + EPS) continue;       // dies before entering range

            if (tEntry + EPS < bestEntryTime) {
              bestEntryTime = tEntry;
              bestIndex = idx;
              bestEntryS = sEntry;
            }
          }

          if (bestIndex !== null) {
            if (!(skipFrontLocks && bestIndex === timeline.frontIndex)) {
              const interval2 = findContainingInterval(cell.intervals2Merged, bestEntryS);
              if (interval2) {
                const timeToExit = (interval2[1] - bestEntryS) / zombieSpeed;
                const timeToDeath = timeline.endTimes[bestIndex] - bestEntryTime;
                duration = Math.max(0, Math.min(timeToExit, timeToDeath));
              }
            }
          }
        }

        cell.extra = duration;
        if (duration > maxExtraLocal) maxExtraLocal = duration;
      }
    }
    if (updateGlobalMax) maxExtraGlobal = maxExtraLocal;
    return maxExtraLocal;
  }

  function getZombiePositionsAtSnapshot() {
    if (mode !== MODE_LOCK || !lastLockContext || !lastLockContext.found || lastLockContext.frontTime === null) {
      return [];
    }
    const t = lastLockContext.frontTime;
    const zombies = [];
    for (let i = 0; i < lastLockContext.spawnTimes.length; i++) {
      const spawn = lastLockContext.spawnTimes[i];
      const end = lastLockContext.endTimes[i];
      if (t + EPS < spawn || t - EPS > end) continue;
      const dist = Math.max(0, zombieSpeed * (t - spawn));
      if (dist > totalPathLength + EPS) continue;
      const pt = pointOnPath(Math.min(dist, totalPathLength));
      zombies.push({ x: pt.x, y: pt.y, isFront: i === lastLockContext.frontIndex });
    }
    return zombies;
  }
