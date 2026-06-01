// Tower Battles Phaser simulator
// Source: phasers.html (extracted section: // ----- Drawing -----)

// ----- Drawing -----
  // Clamp devicePixelRatio to avoid oversized canvases (high zoom can blow up backing store).
  const DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  const logicalCanvasWidth = () => Math.round(worldWidth * SCALE);
  const logicalCanvasHeight = () => Math.round(worldHeight * SCALE);

  function drawScene() {
    drawSceneFor(ctx, grid, maxExtraGlobal, true);
    if (mode !== MODE_SIMULATION && dualView && canvasBlock2.style.display !== 'none') {
      drawSceneFor(ctx2, secondaryGrid, secondaryMaxExtra, false);
    }
  }

  function drawSceneFor(targetCtx, targetGrid, maxRef, showMarkers) {
    if (!targetCtx || !targetGrid) return;
    const isSimulation = mode === MODE_SIMULATION;
    const logicalW = logicalCanvasWidth();
    const logicalH = logicalCanvasHeight();
    targetCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    targetCtx.clearRect(0, 0, logicalW, logicalH);

    // Background image (map) warped via homography
    drawWarpedBackground(targetCtx);

    const showHeatmap = !isSimulation || simHeatmapEnabled;
    if (showHeatmap) {
      // Heatmap background
      const cellW = STEP * SCALE;
      const cellH = STEP * SCALE;
      const zeroThreshold = dynamicScale ? 0 : fixedMin;
      targetCtx.save();
      targetCtx.globalAlpha = heatAlpha;
      for (let j = 0; j < targetGrid.length; j++) {
        const yPix = j * cellH;
        for (let i = 0; i < targetGrid[0].length; i++) {
          const cell = targetGrid[j][i];
          if (cell.forbidden) continue; // will be overdrawn in red
          if (!showWhite && cell.extra <= zeroThreshold) continue;
          targetCtx.fillStyle = valueToColor(cell.extra, maxRef);
          const xPix = i * cellW;
          targetCtx.fillRect(xPix, yPix, cellW, cellH);
        }
      }
      targetCtx.restore();
    }

    if (showPath) {
      // Red forbidden region
      targetCtx.fillStyle = 'red';
      for (const r of rects) {
        const p1 = worldToCanvas(r.xLeft, r.yBottom); // bottom-left
        const p2 = worldToCanvas(r.xRight, r.yTop);   // top-right
        const left = Math.min(p1.x, p2.x);
        const right = Math.max(p1.x, p2.x);
        const top = Math.min(p1.y, p2.y);
        const bottom = Math.max(p1.y, p2.y);
        targetCtx.fillRect(left, top, right - left, bottom - top);
      }

      // Path line
      targetCtx.strokeStyle = 'black';
      targetCtx.lineWidth = 3;
      targetCtx.beginPath();
      pathPoints.forEach((p, idx) => {
        const c = worldToCanvas(p.x, p.y);
        if (idx === 0) targetCtx.moveTo(c.x, c.y);
        else targetCtx.lineTo(c.x, c.y);
      });
      targetCtx.stroke();
    }

    // Polygon overlay (allowed placement region)
    if (polygonPoints.length && showPolygon) {
      targetCtx.save();
      targetCtx.lineWidth = 2;
      targetCtx.strokeStyle = 'rgba(0, 200, 80, 0.8)';
      targetCtx.fillStyle = 'rgba(0, 200, 80, 0.12)';
      targetCtx.beginPath();
      polygonPoints.forEach((p, idx) => {
        const c = worldToCanvas(p.x, p.y);
        if (idx === 0) targetCtx.moveTo(c.x, c.y);
        else targetCtx.lineTo(c.x, c.y);
      });
      if (polygonPoints.length >= 2) targetCtx.closePath();
      targetCtx.fill();
      targetCtx.stroke();
      // Vertices
      targetCtx.fillStyle = '#00c850';
      targetCtx.strokeStyle = '#004020';
      targetCtx.font = '12px monospace';
      polygonPoints.forEach((p, idx) => {
        const c = worldToCanvas(p.x, p.y);
        targetCtx.beginPath();
        targetCtx.arc(c.x, c.y, 4, 0, Math.PI * 2);
        targetCtx.fill();
        targetCtx.stroke();
        targetCtx.fillText(`${idx + 1}`, c.x + 6, c.y - 6);
      });
      targetCtx.restore();
    }

    // Slider markers on path
    if (!isSimulation && mode !== MODE_TOTAL && mode !== MODE_BACKMOST && mode !== MODE_L5TOTAL) {
      const frontPoint = pointOnPath(currentFront);
      const frontCanvas = worldToCanvas(frontPoint.x, frontPoint.y);
      if (mode === MODE_COVERAGE) {
        const effBehind = Math.min(currentBehind, currentFront);
        const windowEnd = Math.max(0, currentFront - effBehind);          // min behind (nearer to front)
        const windowStart = Math.max(0, currentFront - currentMaxBehind);  // max behind (farther from front)
        const backPointNear = pointOnPath(windowEnd);
        const backPointFar = pointOnPath(windowStart);
        const backCanvasNear = worldToCanvas(backPointNear.x, backPointNear.y);
        const backCanvasFar = worldToCanvas(backPointFar.x, backPointFar.y);

        // Min-behind cutoff marker (yellow)
        targetCtx.fillStyle = '#ffff00';
        targetCtx.beginPath();
        targetCtx.arc(backCanvasNear.x, backCanvasNear.y, 5, 0, Math.PI * 2);
        targetCtx.fill();
        targetCtx.strokeStyle = '#666600';
        targetCtx.stroke();

        // Max-behind cutoff marker (orange)
        targetCtx.fillStyle = '#ffb347';
        targetCtx.beginPath();
        targetCtx.arc(backCanvasFar.x, backCanvasFar.y, 5, 0, Math.PI * 2);
        targetCtx.fill();
        targetCtx.strokeStyle = '#8a4f00';
        targetCtx.stroke();
      }

      const zombieDots = getZombiePositionsAtSnapshot();
      if (zombieDots.length) {
        targetCtx.save();
        zombieDots.forEach((z) => {
          const c = worldToCanvas(z.x, z.y);
          targetCtx.beginPath();
          targetCtx.fillStyle = z.isFront ? '#00e6ff' : 'rgba(0,255,255,0.65)';
          const r = z.isFront ? 3 : 2;
          targetCtx.arc(c.x, c.y, r, 0, Math.PI * 2);
          targetCtx.fill();
        });
        targetCtx.restore();
      }

      // Front zombie marker (blue with dark halo to keep it visible)
      targetCtx.save();
      targetCtx.globalAlpha = 1;
      targetCtx.fillStyle = '#001b26';
      targetCtx.beginPath();
      targetCtx.arc(frontCanvas.x, frontCanvas.y, 7, 0, Math.PI * 2);
      targetCtx.fill();
      targetCtx.strokeStyle = '#002a3d';
      targetCtx.lineWidth = 2.5;
      targetCtx.stroke();
      targetCtx.fillStyle = '#00ffff';
      targetCtx.beginPath();
      targetCtx.arc(frontCanvas.x, frontCanvas.y, 4.5, 0, Math.PI * 2);
      targetCtx.fill();
      targetCtx.restore();
    }

    if (isSimulation) {
      drawSimulationOverlay(targetCtx);
    }

    // Mouse-over tower ranges
    if (mouseWorld && showMarkers) {
      const c = worldToCanvas(mouseWorld.x, mouseWorld.y);
      targetCtx.save();
      targetCtx.lineWidth = 2;
      if (renderCommander) {
        targetCtx.strokeStyle = 'rgba(0,200,255,0.9)';
        targetCtx.setLineDash([6, 4]);
        targetCtx.beginPath();
        targetCtx.arc(c.x, c.y, COMMANDER_RANGE * SCALE, 0, Math.PI * 2);
        targetCtx.stroke();
        targetCtx.setLineDash([]);
      } else {
        if (isSimulation && towerToPlace === TOWER_SLEETER) {
          targetCtx.strokeStyle = 'rgba(120, 240, 255, 0.8)';
          targetCtx.beginPath();
          targetCtx.arc(c.x, c.y, SLEETER_BASE_RANGE * SCALE, 0, Math.PI * 2);
          targetCtx.stroke();
        } else {
          // Phaser level 1 radius
          targetCtx.strokeStyle = 'rgba(0,0,255,0.7)';
          targetCtx.beginPath();
          targetCtx.arc(c.x, c.y, range1 * SCALE, 0, Math.PI * 2);
          targetCtx.stroke();
          // Phaser level 5 radius
          targetCtx.strokeStyle = 'rgba(0,0,139,0.75)';
          targetCtx.beginPath();
          targetCtx.arc(c.x, c.y, range2 * SCALE, 0, Math.PI * 2);
          targetCtx.stroke();
        }
      }
      // Cursor marker for screenshots
      targetCtx.strokeStyle = 'rgba(0,0,0,0.65)';
      targetCtx.lineWidth = 2.5;
      targetCtx.beginPath();
      targetCtx.arc(c.x, c.y, 6, 0, Math.PI * 2);
      targetCtx.stroke();
      targetCtx.strokeStyle = 'rgba(255,255,255,0.85)';
      targetCtx.lineWidth = 1.5;
      targetCtx.beginPath();
      targetCtx.moveTo(c.x - 8, c.y);
      targetCtx.lineTo(c.x + 8, c.y);
      targetCtx.moveTo(c.x, c.y - 8);
      targetCtx.lineTo(c.x, c.y + 8);
      targetCtx.stroke();
      targetCtx.restore();
    }

    drawRefDebug(targetCtx);
  }

  function drawSimulationOverlay(targetCtx) {
    if (!currentSimState) return;
    const { phasers = [], sleeters = [], zombies = [], frontZombieId } = currentSimState;

    // Placement blockers
    const halfPx = PHASER_BLOCK_HALF * SCALE;
    targetCtx.save();
    [...phasers, ...sleeters].forEach(t => {
      const c = worldToCanvas(t.x, t.y);
      targetCtx.fillStyle = 'rgba(255, 64, 64, 0.12)';
      targetCtx.strokeStyle = '#ff4040';
      targetCtx.lineWidth = 1.5;
      targetCtx.fillRect(c.x - halfPx, c.y - halfPx, halfPx * 2, halfPx * 2);
      targetCtx.strokeRect(c.x - halfPx, c.y - halfPx, halfPx * 2, halfPx * 2);
    });
    targetCtx.restore();

    // Beams
    targetCtx.save();
    targetCtx.strokeStyle = '#c7a3ff';
    targetCtx.lineWidth = 2;
    phasers.forEach(p => {
      if (p.status !== 'locked' || p.targetId === null) return;
      const tgt = zombies.find(z => z.id === p.targetId);
      if (!tgt) return;
      const pc = worldToCanvas(p.x, p.y);
      const zc = worldToCanvas(tgt.x, tgt.y);
      targetCtx.beginPath();
      targetCtx.moveTo(zc.x, zc.y);
      targetCtx.lineTo(pc.x, pc.y);
      targetCtx.stroke();
    });
    targetCtx.restore();

    // Zombies
    targetCtx.save();
    zombies.forEach(z => {
      const c = worldToCanvas(z.x, z.y);
      const isFront = z.id === frontZombieId;
      targetCtx.beginPath();
      targetCtx.fillStyle = isFront ? '#00e6ff' : 'rgba(0,255,255,0.65)';
      targetCtx.strokeStyle = isFront ? '#004957' : 'rgba(0,90,90,0.6)';
      targetCtx.lineWidth = isFront ? 2 : 1.5;
      targetCtx.arc(c.x, c.y, isFront ? 4.5 : 3.5, 0, Math.PI * 2);
      targetCtx.fill();
      targetCtx.stroke();
      if ((z.permafrostStacks || 0) > 0) {
        targetCtx.strokeStyle = 'rgba(180, 255, 255, 0.8)';
        targetCtx.lineWidth = 1.25;
        targetCtx.beginPath();
        targetCtx.arc(c.x, c.y, (isFront ? 4.5 : 3.5) + 2.5, 0, Math.PI * 2);
        targetCtx.stroke();
      }
    });
    targetCtx.restore();

    // Phasers
    targetCtx.save();
    phasers.forEach(p => {
      const c = worldToCanvas(p.x, p.y);
      const isAuto = !!p.autoReplace;
      const isBoosted = !!p.boosted;
      let stroke = '#5ab0ff';
      let fill = 'rgba(90, 176, 255, 0.16)';
      if (p.status === 'locked') {
        stroke = '#c7a3ff';
        fill = 'rgba(130, 80, 255, 0.22)';
      } else if (p.status === 'disabled') {
        stroke = '#ff5c5c';
        fill = 'rgba(255, 80, 80, 0.2)';
      }
      if (isAuto) {
        if (p.status === 'locked') {
          stroke = '#ffb347';
          fill = 'rgba(255, 196, 102, 0.26)';
        } else if (p.status === 'disabled') {
          stroke = '#ffae42';
          fill = 'rgba(255, 184, 77, 0.22)';
        } else {
          stroke = '#ffd54f';
          fill = 'rgba(255, 214, 79, 0.2)';
        }
      } else if (isBoosted) {
        // Slightly different palette to indicate commander boost.
        stroke = p.status === 'disabled' ? '#ff7a7a' : '#48e6d1';
        fill = p.status === 'locked'
          ? 'rgba(72, 230, 209, 0.28)'
          : 'rgba(72, 230, 209, 0.18)';
      }
      targetCtx.lineWidth = (isBoosted || isAuto) ? 2.5 : 2;
      targetCtx.beginPath();
      targetCtx.fillStyle = fill;
      targetCtx.strokeStyle = stroke;
      targetCtx.arc(c.x, c.y, PHASER_DRAW_RADIUS, 0, Math.PI * 2);
      targetCtx.fill();
      targetCtx.stroke();
      if (isBoosted) {
        // Outer halo and inner core for boosted placements.
        targetCtx.strokeStyle = isAuto ? 'rgba(255, 214, 79, 0.6)' : 'rgba(0, 200, 255, 0.5)';
        targetCtx.lineWidth = 1.5;
        targetCtx.beginPath();
        targetCtx.arc(c.x, c.y, PHASER_DRAW_RADIUS + 3, 0, Math.PI * 2);
        targetCtx.stroke();
        targetCtx.fillStyle = isAuto ? 'rgba(255, 240, 180, 0.85)' : 'rgba(0, 255, 213, 0.75)';
        targetCtx.beginPath();
        targetCtx.arc(c.x, c.y, PHASER_DRAW_RADIUS * 0.45, 0, Math.PI * 2);
        targetCtx.fill();
      } else {
        // unboosted: add a subtle core
        targetCtx.fillStyle = isAuto ? 'rgba(255, 226, 140, 0.82)' : 'rgba(120, 180, 255, 0.7)';
        targetCtx.beginPath();
        targetCtx.arc(c.x, c.y, PHASER_DRAW_RADIUS * 0.4, 0, Math.PI * 2);
        targetCtx.fill();
      }

      // Charge indicator (pie wedge) based on current rawDamage vs cap
      const charge = Math.max(0, Math.min(1, (p.rawDamage || PHASER_DAMAGE_START) / PHASER_DAMAGE_CAP));
      if (charge > 0) {
        targetCtx.save();
        targetCtx.translate(c.x, c.y);
        targetCtx.beginPath();
        targetCtx.moveTo(0, 0);
        targetCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        const endAngle = -Math.PI / 2 + charge * Math.PI * 2;
        targetCtx.arc(0, 0, PHASER_DRAW_RADIUS - 1.5, -Math.PI / 2, endAngle, false);
        targetCtx.closePath();
        targetCtx.fill();
        targetCtx.restore();
      }
    });
    targetCtx.restore();

    // Sleeters
    targetCtx.save();
    sleeters.forEach(s => {
      const c = worldToCanvas(s.x, s.y);
      targetCtx.lineWidth = 2.25;
      targetCtx.fillStyle = 'rgba(120, 240, 255, 0.18)';
      targetCtx.strokeStyle = '#78f0ff';
      targetCtx.beginPath();
      targetCtx.arc(c.x, c.y, PHASER_DRAW_RADIUS, 0, Math.PI * 2);
      targetCtx.fill();
      targetCtx.stroke();
      targetCtx.fillStyle = 'rgba(235, 255, 255, 0.9)';
      targetCtx.beginPath();
      targetCtx.arc(c.x, c.y, PHASER_DRAW_RADIUS * 0.38, 0, Math.PI * 2);
      targetCtx.fill();
    });
    targetCtx.restore();
  }
