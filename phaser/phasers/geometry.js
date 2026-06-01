// Tower Battles Phaser simulator
// Source: phasers.html (extracted section: // ----- Geometry helpers -----)

// ----- Geometry helpers -----
  function buildPath() {
    pathPoints = [{ x: 0, y: 0 }];
    let x = 0, y = 0;
    for (const [dir, len] of segmentDefs) {
      if (dir === 'U') y += len;
      else if (dir === 'D') y -= len;
      else if (dir === 'L') x -= len;
      else if (dir === 'R') x += len;
      pathPoints.push({ x, y });
    }

    segments = [];
    let sStart = 0;
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const p0 = pathPoints[i];
      const p1 = pathPoints[i + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const length = Math.hypot(dx, dy);
      const dirx = dx / length;
      const diry = dy / length;
      segments.push({
        x0: p0.x,
        y0: p0.y,
        x1: p1.x,
        y1: p1.y,
        length,
        dirx,
        diry,
        sStart
      });
      sStart += length;
    }
    totalPathLength = sStart;

    // Bounding box
    let xs = pathPoints.map(p => p.x);
    let ys = pathPoints.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    worldMinX = minX - MARGIN_STUDS;
    worldMaxX = maxX + MARGIN_STUDS;
    worldMinY = minY - MARGIN_STUDS;
    worldMaxY = maxY + MARGIN_STUDS;
    worldWidth = worldMaxX - worldMinX;
    worldHeight = worldMaxY - worldMinY;

    // Forbidden rectangles (path area +/- pathHalfWidth around)
    rects = [];
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const p0 = pathPoints[i];
      const p1 = pathPoints[i + 1];
      if (Math.abs(p0.x - p1.x) < 1e-6) {
        // vertical segment
        const xLeft = p0.x - pathHalfWidth;
        const xRight = p0.x + pathHalfWidth;
        const yBottom = Math.min(p0.y, p1.y) - pathHalfWidth;
        const yTop = Math.max(p0.y, p1.y) + pathHalfWidth;
        rects.push({ xLeft, yBottom, xRight, yTop });
      } else if (Math.abs(p0.y - p1.y) < 1e-6) {
        // horizontal segment
        const yBottom = p0.y - pathHalfWidth;
        const yTop = p0.y + pathHalfWidth;
        const xLeft = Math.min(p0.x, p1.x) - pathHalfWidth;
        const xRight = Math.max(p0.x, p1.x) + pathHalfWidth;
        rects.push({ xLeft, yBottom, xRight, yTop });
      }
    }

    // Snap points: path vertices plus rect corners
    const cornerSet = new Map();
    const pushPt = (pt) => {
      const key = `${pt.x.toFixed(3)},${pt.y.toFixed(3)}`;
      if (!cornerSet.has(key)) cornerSet.set(key, pt);
    };
    for (const p of pathPoints) {
      pushPt({ x: p.x, y: p.y });
      pushPt({ x: p.x + pathHalfWidth, y: p.y + pathHalfWidth });
      pushPt({ x: p.x + pathHalfWidth, y: p.y - pathHalfWidth });
      pushPt({ x: p.x - pathHalfWidth, y: p.y + pathHalfWidth });
      pushPt({ x: p.x - pathHalfWidth, y: p.y - pathHalfWidth });
    }
    for (const r of rects) {
      pushPt({ x: r.xLeft, y: r.yBottom });
      pushPt({ x: r.xLeft, y: r.yTop });
      pushPt({ x: r.xRight, y: r.yBottom });
      pushPt({ x: r.xRight, y: r.yTop });
    }
    snapPoints = Array.from(cornerSet.values());
  }

  function updateDpsPanel() {
    if (!dpsTotalsLabel || !dpsBreakdownLabel) return;
    if (mode !== MODE_SIMULATION || !currentSimState) {
      dpsTotalsLabel.textContent = 'DPS: --';
      dpsBreakdownLabel.textContent = '';
      return;
    }
    const railguns = currentSimState.railgunners ?? Math.max(0, baseRailgunners - (currentSimState.phasers?.length || 0));
    const phaserCount = currentSimState.phasers?.length || 0;
    const railDps = currentSimState.railgunDps ?? (railguns * RAILGUNNER_DAMAGE_PER_SEC);
    const dps = currentSimState.dpsInstant ?? 0;
    const avg = currentSimState.dpsAverage ?? 0;
    const phaserList = currentSimState.phaserDpsList || [];
    dpsTotalsLabel.textContent =
      `DPS now ≈ ${dps.toFixed(1)}; avg 0→t ≈ ${avg.toFixed(1)}; railguns: ${railguns} (${railDps.toFixed(1)} DPS); phasers: ${phaserCount}`;
    if (!phaserList.length) {
      dpsBreakdownLabel.textContent = 'Phaser DPS: none placed.';
    } else {
      dpsBreakdownLabel.textContent = phaserList
        .map(p => `P#${p.id}: ${p.dps.toFixed(1)} (${p.status})`)
        .join(' · ');
    }
  }

  function worldToCanvas(x, y) {
    const px = (x - worldMinX) * SCALE;
    const py = (worldMaxY - y) * SCALE;
    return { x: px, y: py };
  }

  function canvasToWorld(px, py) {
    const logicalX = px / DPR;
    const logicalY = py / DPR;
    const x = worldMinX + logicalX / SCALE;
    const y = worldMaxY - logicalY / SCALE;
    return { x, y };
  }

  function pointOnPath(s) {
    // Clamp to [0, totalPathLength]
    if (s <= 0) return { x: pathPoints[0].x, y: pathPoints[0].y };
    if (s >= totalPathLength) {
      const last = pathPoints[pathPoints.length - 1];
      return { x: last.x, y: last.y };
    }
    for (const seg of segments) {
      const s0 = seg.sStart;
      const s1 = s0 + seg.length;
      if (s <= s1 + 1e-9) {
        const t = s - s0;
        return {
          x: seg.x0 + seg.dirx * t,
          y: seg.y0 + seg.diry * t
        };
      }
    }
    const last = pathPoints[pathPoints.length - 1];
    return { x: last.x, y: last.y };
  }

  function inForbidden(x, y) {
    // Outside polygon is forbidden when polygon is defined.
    if (polygonPoints.length >= 3 && !pointInPolygon(x, y, polygonPoints)) {
      return true;
    }
    // On-path (expanded rects) is forbidden.
    for (const r of rects) {
      if (r.xLeft <= x && x <= r.xRight &&
          r.yBottom <= y && y <= r.yTop) {
        return true;
      }
    }
    return false;
  }

  // Intervals along path where distance to q <= R
  function computeIntervalsForRadius(qx, qy, R) {
    const R2 = R * R;
    const intervals = [];
    for (const seg of segments) {
      const vx = seg.x0 - qx;
      const vy = seg.y0 - qy;
      const b = 2 * (vx * seg.dirx + vy * seg.diry);
      const c = vx * vx + vy * vy - R2;
      const disc = b * b - 4 * c;
      if (disc <= EPS) continue;
      const sqrtDisc = Math.sqrt(disc);
      let u1 = (-b - sqrtDisc) / 2;
      let u2 = (-b + sqrtDisc) / 2;
      let uLow = Math.max(0, Math.min(u1, u2));
      let uHigh = Math.min(seg.length, Math.max(u1, u2));
      if (uLow < uHigh) {
        intervals.push([seg.sStart + uLow, seg.sStart + uHigh]);
      }
    }
    intervals.sort((a, b) => a[0] - b[0]);
    return intervals;
  }

  function mergeIntervals(intervals) {
    if (!intervals.length) return [];
    const out = [];
    let [curA, curB] = intervals[0];
    for (let k = 1; k < intervals.length; k++) {
      const [a, b] = intervals[k];
      if (a <= curB + EPS) {
        curB = Math.max(curB, b);
      } else {
        out.push([curA, curB]);
        curA = a; curB = b;
      }
    }
    out.push([curA, curB]);
    return out;
  }

  function findContainingInterval(intervals, s) {
    for (const [a, b] of intervals) {
      if (a - EPS <= s && s <= b + EPS) return [a, b];
      if (s < a - EPS) break;
    }
    return null;
  }

  function nextEntryInIntervals(intervals, s) {
    for (const [a, b] of intervals) {
      if (s <= b + EPS) {
        return Math.max(a, s);
      }
    }
    return null;
  }

  function containsPoint(intervals, s) {
    return findContainingInterval(intervals, s) !== null;
  }

  function overlapsRange(intervals, a, b) {
    if (!intervals.length) return false;
    for (const [lo, hi] of intervals) {
      if (hi + EPS < a) continue;
      if (lo - EPS > b) break;
      if (lo - EPS <= b && hi + EPS >= a) return true;
    }
    return false;
  }

  function pointInPolygon(x, y, poly) {
    // Ray casting, assumes poly is array of {x,y}
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || EPS) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
