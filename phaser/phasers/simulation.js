// Tower Battles Phaser simulator
// Source: phasers.html (extracted section: // ----- Simulation helpers -----)

// ----- Simulation helpers -----
  function dist2(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  function normalizeTowerCollection(towerCollection) {
    if (!towerCollection) return [];
    if (towerCollection instanceof Map) return Array.from(towerCollection.values());
    if (Array.isArray(towerCollection)) return towerCollection;
    if (typeof towerCollection !== 'object') return [];
    const maps = [];
    if (towerCollection.phaserMap instanceof Map) maps.push(towerCollection.phaserMap);
    if (towerCollection.sleeterMap instanceof Map) maps.push(towerCollection.sleeterMap);
    if (towerCollection.phasers instanceof Map) maps.push(towerCollection.phasers);
    if (towerCollection.sleeters instanceof Map) maps.push(towerCollection.sleeters);
    return maps.flatMap(m => Array.from(m.values()));
  }

  function placementBlockedAt(x, y, phaserCollection) {
    if (inForbidden(x, y)) return 'Cannot place on the path or outside the polygon.';
    const list = normalizeTowerCollection(phaserCollection);
    for (const p of list) {
      if (Math.abs(p.x - x) <= PHASER_BLOCK_HALF && Math.abs(p.y - y) <= PHASER_BLOCK_HALF) {
        return 'Inside an existing tower block.';
      }
    }
    return null;
  }

  function pickFrontmostTarget(zombies, phaser, range) {
    const r2 = range * range;
    let best = null;
    let bestDist = -Infinity;
    for (const z of zombies) {
      const d2 = dist2(z.x, z.y, phaser.x, phaser.y);
      if (d2 <= r2 + EPS && z.distance > bestDist) {
        best = z;
        bestDist = z.distance;
      }
    }
    return best;
  }

  function simulateStateAt(timeLimit) {
    const actions = simulationActions
      .filter(a => a.time <= timeLimit + EPS)
      .slice()
      .sort((a, b) => (a.time - b.time) || (a.id - b.id));

    const spawnSchedule = buildSpawnSchedule();
    const zombies = spawnSchedule.map((spawn, idx) => ({
      id: idx,
      spawnTime: spawn,
      health: zombieHealth,
      alive: false,
      dead: false,
      distance: 0,
      x: pathPoints[0].x,
      y: pathPoints[0].y,
      speedMultiplier: 1,
      permafrostStacks: 0,
    }));

    const phasers = new Map();
    const sleeters = new Map();
    let actionIdx = 0;
    let spawnIdx = 0;
    let currentTime = 0;
    let respawnQueue = [];
    let cumulativeDamage = 0;

    const cancelRespawn = (phaserId) => {
      respawnQueue = respawnQueue.filter(evt => evt.phaserId !== phaserId);
    };

    const scheduleRespawn = (phaser, disabledAt) => {
      if (!phaser.autoReplace) return;
      const respawnTime = disabledAt + AUTO_REPLACE_DELAY;
      cancelRespawn(phaser.id);
      respawnQueue.push({
        phaserId: phaser.id,
        time: respawnTime,
        x: phaser.x,
        y: phaser.y,
        boosted: !!phaser.boosted,
        autoReplace: true,
      });
      respawnQueue.sort((a, b) => a.time - b.time);
    };

    const applyPendingRespawns = (t) => {
      const { base1, base2 } = getBaseRanges();
      while (respawnQueue.length && respawnQueue[0].time <= t + EPS) {
        const evt = respawnQueue.shift();
        phasers.delete(evt.phaserId);
        const blocked = placementBlockedAt(evt.x, evt.y, { phasers, sleeters });
        if (blocked) continue;
        phasers.set(evt.phaserId, {
          towerType: TOWER_PHASER,
          id: evt.phaserId,
          x: evt.x,
          y: evt.y,
          boosted: !!evt.boosted,
          autoReplace: !!evt.autoReplace,
          placedAt: evt.time,
          status: 'idle', // idle | locked | disabled
          targetId: null,
          nextDamageTime: null,
          rawDamage: PHASER_DAMAGE_START,
          damage: PHASER_DAMAGE_START,
          range1: base1 * (evt.boosted ? BOOST_FACTOR : 1),
          range2: base2 * (evt.boosted ? BOOST_FACTOR : 1),
        });
      }
    };

    const disablePhaser = (p, atTime) => {
      if (p.status === 'disabled') return;
      p.status = 'disabled';
      p.targetId = null;
      p.nextDamageTime = null;
      scheduleRespawn(p, atTime);
    };

    const applyAction = (action) => {
      const { base1, base2 } = getBaseRanges();
      const towerType = action.towerType || TOWER_PHASER;
      const towerId = action.towerId ?? action.phaserId;
      if (!Number.isFinite(towerId)) return;

      if (action.type === 'place') {
        const reason = placementBlockedAt(action.x, action.y, { phasers, sleeters });
        if (reason) return;
        if (towerType === TOWER_SLEETER) {
          sleeters.set(towerId, {
            towerType: TOWER_SLEETER,
            id: towerId,
            x: action.x,
            y: action.y,
            placedAt: action.time,
            nextHitTime: action.time + SLEETER_FIRE_INTERVAL,
            range: SLEETER_BASE_RANGE,
          });
          return;
        }
        phasers.set(towerId, {
          towerType: TOWER_PHASER,
          id: towerId,
          x: action.x,
          y: action.y,
          boosted: !!action.boosted,
          autoReplace: !!action.autoReplace,
          placedAt: action.time,
          status: 'idle', // idle | locked | disabled
          targetId: null,
          nextDamageTime: null,
          rawDamage: PHASER_DAMAGE_START,
          damage: PHASER_DAMAGE_START,
          range1: base1 * (action.boosted ? BOOST_FACTOR : 1),
          range2: base2 * (action.boosted ? BOOST_FACTOR : 1),
        });
      } else if (action.type === 'sell') {
        if (towerType === TOWER_SLEETER) {
          sleeters.delete(towerId);
          return;
        }
        phasers.delete(towerId);
        cancelRespawn(towerId);
      }
    };

    const getAliveZombies = () => zombies.filter(z => z.alive && !z.dead);

    const pickFrontZombie = (zs) => zs.reduce((best, z) => {
      if (!best) return z;
      return z.distance > best.distance ? z : best;
    }, null);

    const advanceZombiesBetween = (fromTime, toTime) => {
      const dt = toTime - fromTime;
      if (dt <= 0) return;
      zombies.forEach(z => {
        if (z.dead) return;
        if (!z.alive) {
          if (toTime + EPS < z.spawnTime) return;
          z.alive = true;
          const dtAfterSpawn = Math.max(0, toTime - z.spawnTime);
          const speedNow = zombieSpeed * (z.speedMultiplier || 1);
          z.distance = Math.min(totalPathLength, Math.max(0, speedNow * dtAfterSpawn));
        } else {
          const speedNow = zombieSpeed * (z.speedMultiplier || 1);
          z.distance = Math.min(totalPathLength, z.distance + speedNow * dt);
        }
        if (z.distance >= totalPathLength - EPS) {
          z.dead = true;
          z.alive = false;
          return;
        }
        const pos = pointOnPath(z.distance);
        z.x = pos.x;
        z.y = pos.y;
      });
    };

    const nextPhaserShotTime = () => {
      let next = Infinity;
      phasers.forEach(p => {
        if (p.status !== 'locked') return;
        if (p.nextDamageTime === null) return;
        if (p.nextDamageTime < next) next = p.nextDamageTime;
      });
      return next;
    };

    const nextSleeterHitTime = () => {
      let next = Infinity;
      sleeters.forEach(s => {
        if (s.nextHitTime === null || s.nextHitTime === undefined) return;
        if (s.nextHitTime < next) next = s.nextHitTime;
      });
      return next;
    };

    const applySleeterHitsAt = (t) => {
      const active = getAliveZombies();
      sleeters.forEach(s => {
        while (s.nextHitTime !== null && s.nextHitTime <= t + EPS) {
          const target = pickFrontmostTarget(active, s, s.range || SLEETER_BASE_RANGE);
          if (target && !target.dead) {
            if ((target.permafrostStacks || 0) <= 0) {
              target.speedMultiplier = (target.speedMultiplier || 1) * SLEETER_SLOW_MULTIPLIER;
              target.permafrostStacks = 1;
            }
          }
          s.nextHitTime += SLEETER_FIRE_INTERVAL;
        }
      });
    };

    const updatePhasersAt = (t) => {
      const active = getAliveZombies();

      phasers.forEach(p => {
        if (p.status === 'disabled') return;
        if (p.targetId !== null) {
          const tgt = zombies[p.targetId];
          if (!tgt || tgt.dead) {
            disablePhaser(p, t);
            return;
          }
          if (dist2(tgt.x, tgt.y, p.x, p.y) > p.range2 * p.range2 + EPS) {
            disablePhaser(p, t);
          }
        }
      });

      phasers.forEach(p => {
        if (p.status !== 'idle') return;
        const target = pickFrontmostTarget(active, p, p.range1);
        if (!target) return;
        p.status = 'locked';
        p.targetId = target.id;
        p.rawDamage = PHASER_DAMAGE_START;
        p.damage = PHASER_DAMAGE_START;
        p.nextDamageTime = t;
      });

      phasers.forEach(p => {
        if (p.status !== 'locked' || p.targetId === null) return;
        if (p.nextDamageTime === null || p.nextDamageTime > t + EPS) return;
        const tgt = zombies[p.targetId];
        if (!tgt || tgt.dead) {
          disablePhaser(p, t);
          return;
        }
        if (dist2(tgt.x, tgt.y, p.x, p.y) > p.range2 * p.range2 + EPS) {
          disablePhaser(p, t);
          return;
        }
        tgt.health -= p.damage;
        cumulativeDamage += p.damage;
        p.rawDamage = Math.min(PHASER_DAMAGE_CAP, p.rawDamage + PHASER_DAMAGE_STEP);
        p.damage = Math.min(PHASER_DAMAGE_CAP, Math.floor(p.rawDamage + 1e-9));
        p.nextDamageTime += PHASER_FIRE_INTERVAL;
        if (tgt.health <= 0) {
          tgt.dead = true;
          tgt.alive = false;
          disablePhaser(p, t);
        }
      });
    };

    const spawnDueZombiesAt = (t) => {
      while (spawnIdx < zombies.length && zombies[spawnIdx].spawnTime <= t + EPS) {
        const z = zombies[spawnIdx];
        if (!z.dead && !z.alive) {
          z.alive = true;
          z.distance = 0;
          z.x = pathPoints[0].x;
          z.y = pathPoints[0].y;
        }
        spawnIdx++;
      }
    };

    while (currentTime < timeLimit - EPS) {
      while (actionIdx < actions.length && actions[actionIdx].time <= currentTime + EPS) {
        applyAction(actions[actionIdx]);
        actionIdx++;
      }
      applyPendingRespawns(currentTime);
      spawnDueZombiesAt(currentTime);
      applySleeterHitsAt(currentTime);
      updatePhasersAt(currentTime);

      const nextSpawnTime = spawnIdx < zombies.length ? zombies[spawnIdx].spawnTime : Infinity;
      const nextActionTime = actionIdx < actions.length ? actions[actionIdx].time : Infinity;
      const nextRespawnTime = respawnQueue.length ? respawnQueue[0].time : Infinity;
      const nextPhaserTime = nextPhaserShotTime();
      const nextSleeterTime = nextSleeterHitTime();
      const nextTime = Math.min(
        timeLimit,
        nextSpawnTime,
        nextActionTime,
        nextRespawnTime,
        nextPhaserTime,
        nextSleeterTime,
        currentTime + SIM_STEP,
      );

      const dt = nextTime - currentTime;
      if (dt > EPS) {
        advanceZombiesBetween(currentTime, nextTime);
        const railgunners = Math.max(0, baseRailgunners - phasers.size);
        if (railgunners > 0) {
          const active = getAliveZombies();
          const front = pickFrontZombie(active);
          if (front) {
            const railDmg = railgunners * RAILGUNNER_DAMAGE_PER_SEC * dt;
            front.health -= railDmg;
            cumulativeDamage += railDmg;
            if (front.health <= 0) {
              front.dead = true;
              front.alive = false;
            }
          }
        }
      }

      currentTime = nextTime;
    }

    while (actionIdx < actions.length && actions[actionIdx].time <= timeLimit + EPS) {
      applyAction(actions[actionIdx]);
      actionIdx++;
    }
    applyPendingRespawns(timeLimit);
    spawnDueZombiesAt(timeLimit);
    applySleeterHitsAt(timeLimit);
    updatePhasersAt(timeLimit);

    const finalAlive = getAliveZombies();
    const frontZombie = pickFrontZombie(finalAlive);
    const railgunners = Math.max(0, baseRailgunners - phasers.size);

    const totalTime = Math.max(timeLimit, 1e-6);
    const phaserArray = Array.from(phasers.values());
    const sleeterArray = Array.from(sleeters.values());
    const phaserDpsList = phaserArray.map(p => ({
      id: p.id,
      dps: p.status === 'locked' ? p.damage * PHASER_FIRE_INTERVAL_INV : 0,
      status: p.status,
      boosted: !!p.boosted,
    }));
    const railgunDpsNow = railgunners * RAILGUNNER_DAMAGE_PER_SEC;
    const dpsInstant = railgunDpsNow + phaserDpsList.reduce((sum, p) => sum + p.dps, 0);
    const dpsAverage = cumulativeDamage / totalTime;

    return {
      time: timeLimit,
      phasers: phaserArray,
      phaserMap: phasers,
      sleeters: sleeterArray,
      sleeterMap: sleeters,
      zombies: finalAlive,
      frontZombieId: frontZombie ? frontZombie.id : null,
      railgunners,
      railgunDps: railgunDpsNow,
      phaserDpsList,
      dpsInstant,
      dpsAverage,
    };
  }

  function recomputeSimulationHeatmap() {
    if (mode !== MODE_SIMULATION) return;
    if (!currentSimState) {
      maxExtraGlobal = 0;
      return;
    }
    const aliveZombies = (currentSimState.zombies || []).filter(z => !z.dead);
    if (!aliveZombies.length) {
      for (let j = 0; j < grid.length; j++) {
        for (let i = 0; i < grid[0].length; i++) grid[j][i].extra = 0;
      }
      maxExtraGlobal = 0;
      return;
    }
    const frontId = currentSimState.frontZombieId;
    const railguns = currentSimState.railgunners ?? Math.max(0, baseRailgunners - currentSimState.phasers.length);
    const railgunDps = railguns * RAILGUNNER_DAMAGE_PER_SEC;
    const targetDpsMap = new Map();
    currentSimState.phasers.forEach(p => {
      if (p.status === 'locked' && p.targetId !== null) {
        const prev = targetDpsMap.get(p.targetId) || 0;
        targetDpsMap.set(p.targetId, prev + p.damage * PHASER_FIRE_INTERVAL_INV);
      }
    });

    // Order by frontmost (distance), then spawn time for stability.
    const sortedAliveForCells = aliveZombies.slice().sort((a, b) => {
      if (Math.abs(b.distance - a.distance) > EPS) return b.distance - a.distance;
      return (a.spawnTime || 0) - (b.spawnTime || 0);
    });

    // Railgun focus start per zombie, considering phaser DPS on those ahead.
    const startRailMap = new Map(); // id -> { start }
    let railCurrentTime = simTime;
    for (const z of sortedAliveForCells) {
      const phaserDpsExisting = targetDpsMap.get(z.id) || 0;
      const elapsed = Math.max(0, railCurrentTime - simTime);
      const healthAtStart = Math.max(0, z.health - phaserDpsExisting * elapsed);
      startRailMap.set(z.id, { start: railCurrentTime });
      const totalDps = phaserDpsExisting + railgunDps;
      if (totalDps > 0 && healthAtStart > 0) {
        const timeToDie = healthAtStart / totalDps;
        railCurrentTime += timeToDie;
      }
    }

    const candidateDuration = (healthAtEntry, timeToExit, baselineBefore, baselineAfter, railOffset = null) => {
      let health = healthAtEntry;
      let t = 0;
      let nextShot = 0;
      let rawDamage = PHASER_DAMAGE_START;
      let dmg = Math.min(PHASER_DAMAGE_CAP, Math.floor(rawDamage + 1e-9));
      let railActive = railOffset === null || railOffset <= 0;
      while (t < timeToExit - EPS && health > 0) {
        let nextEvent = timeToExit;
        if (!railActive && railOffset !== null) nextEvent = Math.min(nextEvent, railOffset);
        nextEvent = Math.min(nextEvent, nextShot);
        if (nextEvent > t) {
          const dpsNow = railActive ? baselineAfter : baselineBefore;
          health -= dpsNow * (nextEvent - t);
          t = nextEvent;
          if (health <= 0) return Math.min(timeToExit, t);
        }
        if (!railActive && railOffset !== null && Math.abs(t - railOffset) <= 1e-9) {
          railActive = true;
          continue;
        }
        if (Math.abs(t - nextShot) <= 1e-9) {
          // New phaser shot
          health -= dmg;
          if (health <= 0) return Math.min(timeToExit, t);
          rawDamage = Math.min(PHASER_DAMAGE_CAP, rawDamage + PHASER_DAMAGE_STEP);
          dmg = Math.min(PHASER_DAMAGE_CAP, Math.floor(rawDamage + 1e-9));
          nextShot += PHASER_FIRE_INTERVAL;
        } else {
          break;
        }
      }
      return Math.min(timeToExit, t >= timeToExit - EPS ? timeToExit : t);
    };

    let maxExtra = 0;
    for (let j = 0; j < grid.length; j++) {
      for (let i = 0; i < grid[0].length; i++) {
        const cell = grid[j][i];
        let bestDuration = 0;
        let bestEntryTime = Infinity;
        if (!cell.forbidden && cell.intervals1.length && cell.intervals2Merged.length) {
          for (const z of sortedAliveForCells) { // break after first viable (frontmost in L1 now)
            const l1Interval = findContainingInterval(cell.intervals1, z.distance);
            if (!l1Interval) continue; // not currently in L1
            const sEntry = z.distance; // target chosen based on current L1 position
            const interval2 = findContainingInterval(cell.intervals2Merged, sEntry);
            if (!interval2) continue; // somehow not in L5; treat as no target
            const entryTime = simTime; // lock starts now
            const speedNow = zombieSpeed * (z.speedMultiplier || 1);
            const timeToExit = speedNow > EPS ? Math.max(0, (interval2[1] - sEntry) / speedNow) : 0;
            if (timeToExit <= 0) continue;
            const existingDps = targetDpsMap.get(z.id) || 0;
            const isFront = frontId !== null && z.id === frontId;
            const startRail = startRailMap.get(z.id)?.start ?? Infinity;
            let healthAtEntry = z.health - existingDps * Math.max(0, entryTime - simTime);
            if (entryTime > startRail) {
              healthAtEntry -= railgunDps * (entryTime - startRail);
            }
            if (healthAtEntry <= 0) continue;
            if (skipFrontLocks && frontId !== null && z.id === frontId) {
              bestEntryTime = entryTime;
              bestDuration = 0;
              break;
            }

            const railOffset = startRail > entryTime ? startRail - entryTime : null;
            const baselineBefore = existingDps;
            const baselineAfter = existingDps + railgunDps;
            const duration = candidateDuration(
              healthAtEntry,
              timeToExit,
              baselineBefore,
              baselineAfter,
              railOffset
            );
            bestEntryTime = entryTime;
            bestDuration = duration;
            break; // frontmost viable found
          }
        }
        cell.extra = bestDuration;
        if (bestDuration > maxExtra) maxExtra = bestDuration;
      }
    }
    maxExtraGlobal = maxExtra;
  }


  function valueToColor(v, maxRefOverride = null) {
    const minRef = dynamicScale ? 0 : fixedMin;
    const maxRef = dynamicScale ? (maxRefOverride !== null ? maxRefOverride : maxExtraGlobal) : fixedPeak;
    if (v <= minRef || maxRef <= minRef) return blueOnly ? 'rgba(0,0,255,0)' : 'rgb(255,255,255)';
    let t = (v - minRef) / (maxRef - minRef);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    if (blueOnly) {
      // Transparent -> solid blue
      const alpha = t;
      return `rgba(0,0,255,${alpha.toFixed(3)})`;
    } else {
      const c = Math.round(255 * (1 - t));
      // white -> blue
      return `rgb(${c},${c},255)`;
    }
  }

  function nearestPathCornerCanvas(px, py) {
    let best = null;
    let bestD2 = Infinity;
    // Use the precomputed snapPoints (path vertices + inner/outer rectangle corners)
    for (const p of snapPoints) {
      const cc = worldToCanvas(p.x, p.y);
      const dx = cc.x - px;
      const dy = cc.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = cc;
      }
    }
    return best;
  }

  function drawWarpedBackground(targetCtx) {
    if (!bgReady || !bgImage) return;
    const logicalW = logicalCanvasWidth();
    const logicalH = logicalCanvasHeight();
    targetCtx.drawImage(bgImage, 0, 0, logicalW, logicalH);
  }

  function drawRefDebug(targetCtx) {
    if (!refPoints.length) return;
    targetCtx.save();
    targetCtx.lineWidth = 2;
    refPoints.forEach((p, idx) => {
      // src (image click) in magenta
      targetCtx.fillStyle = '#ff00ff';
      targetCtx.strokeStyle = '#660066';
      targetCtx.beginPath();
      targetCtx.arc(p.src.x, p.src.y, 5, 0, Math.PI * 2);
      targetCtx.fill();
      targetCtx.stroke();
      // dst in green
      targetCtx.fillStyle = '#00ff6a';
      targetCtx.strokeStyle = '#006633';
      targetCtx.beginPath();
      targetCtx.arc(p.dst.x, p.dst.y, 5, 0, Math.PI * 2);
      targetCtx.fill();
      targetCtx.stroke();
      // line between
      targetCtx.strokeStyle = '#ffaa00';
      targetCtx.beginPath();
      targetCtx.moveTo(p.src.x, p.src.y);
      targetCtx.lineTo(p.dst.x, p.dst.y);
      targetCtx.stroke();
      // labels
      targetCtx.fillStyle = '#ffffff';
      targetCtx.font = '12px monospace';
      targetCtx.fillText(`${idx + 1}`, p.src.x + 8, p.src.y - 8);
      targetCtx.fillText(`${idx + 1}`, p.dst.x + 8, p.dst.y - 8);
    });
    targetCtx.restore();
  }
