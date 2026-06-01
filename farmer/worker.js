/* eslint-disable no-restricted-globals */
(() => {
  "use strict";

  const LEVEL_INCOME = [0, 50, 100, 200, 500];
  const BUY_COST = 300;
  const UPGRADE_COST = { "1-2": 250, "2-3": 550, "3-4": 1200 };
  const SELL_VALUE = { 1: 150, 2: 275, 3: 550, 4: 1150 };
  const BUY_DEBT = BUY_COST - SELL_VALUE[1];
  const UPGRADE_DEBT = {
    "1-2": UPGRADE_COST["1-2"] - (SELL_VALUE[2] - SELL_VALUE[1]),
    "2-3": UPGRADE_COST["2-3"] - (SELL_VALUE[3] - SELL_VALUE[2]),
    "3-4": UPGRADE_COST["3-4"] - (SELL_VALUE[4] - SELL_VALUE[3]),
  };
  const BEST_INCOME_PER_LIQUID_DEBT = Math.max(
    LEVEL_INCOME[1] / BUY_DEBT,
    (LEVEL_INCOME[2] - LEVEL_INCOME[1]) / UPGRADE_DEBT["1-2"],
    (LEVEL_INCOME[3] - LEVEL_INCOME[2]) / UPGRADE_DEBT["2-3"],
    (LEVEL_INCOME[4] - LEVEL_INCOME[3]) / UPGRADE_DEBT["3-4"]
  );
  const BEST_FINAL_INCOME_PER_CASH = Math.max(
    LEVEL_INCOME[1] / BUY_COST,
    (LEVEL_INCOME[2] - LEVEL_INCOME[1]) / UPGRADE_COST["1-2"],
    (LEVEL_INCOME[3] - LEVEL_INCOME[2]) / UPGRADE_COST["2-3"],
    (LEVEL_INCOME[4] - LEVEL_INCOME[3]) / UPGRADE_COST["3-4"]
  );

  const MODE_CONFIGS = {
    "1v1": { startCash: 650, wave1Reward: 230, incrementCycle: [30] },
    "2v2": { startCash: 600, wave1Reward: 115, incrementCycle: [15] },
    "3v3": { startCash: 550, wave1Reward: 77, incrementCycle: [10] },
    "4v4": { startCash: 550, wave1Reward: 58, incrementCycle: [7, 8] },
    solo: { startCash: 650, wave1Reward: 213, incrementCycle: [36, 35, 36, 36, 35, 36, 35, 36, 35] },
    coop: { startCash: 600, wave1Reward: 120, incrementCycle: [20] },
    triop: { startCash: 550, wave1Reward: 74, incrementCycle: [12, 12, 13] },
    quadop: { startCash: 500, wave1Reward: 44, incrementCycle: [7, 7, 7, 8, 7, 7, 8, 7, 7, 7, 8] },
  };
  const MODE_ALIASES = { qop: "quadop" };

  function normalizeMode(mode) {
    const canonical = MODE_ALIASES[mode] || mode;
    if (!MODE_CONFIGS[canonical]) throw new Error(`Unknown mode: ${mode}`);
    return canonical;
  }

  function incomeOf(farms) {
    return farms[0] * LEVEL_INCOME[1] + farms[1] * LEVEL_INCOME[2] + farms[2] * LEVEL_INCOME[3] + farms[3] * LEVEL_INCOME[4];
  }

  function sellValueOf(farms) {
    return farms[0] * SELL_VALUE[1] + farms[1] * SELL_VALUE[2] + farms[2] * SELL_VALUE[3] + farms[3] * SELL_VALUE[4];
  }

  function sum(arr) {
    let s = 0;
    for (let i = 0; i < arr.length; i += 1) s += arr[i];
    return s;
  }

  function waveReward(mode, wave, bonuses) {
    if (wave === 0) return 0;
    const canonical = normalizeMode(mode);
    const cfg = MODE_CONFIGS[canonical];
    const increments = cfg.incrementCycle;
    const cycleLen = increments.length;
    const waveIndex = wave - 1;
    const fullCycles = Math.floor(waveIndex / cycleLen);
    const remainder = waveIndex % cycleLen;
    let reward = cfg.wave1Reward;
    reward += fullCycles * sum(increments);
    for (let i = 0; i < remainder; i += 1) reward += increments[i];
    const bonus = wave < bonuses.length ? (bonuses[wave] || 0) : 0;
    return reward + bonus;
  }

  function waveRewardBase(mode, wave) {
    if (wave === 0) return 0;
    const canonical = normalizeMode(mode);
    const cfg = MODE_CONFIGS[canonical];
    const increments = cfg.incrementCycle;
    const cycleLen = increments.length;
    const waveIndex = wave - 1;
    const fullCycles = Math.floor(waveIndex / cycleLen);
    const remainder = waveIndex % cycleLen;
    let reward = cfg.wave1Reward;
    reward += fullCycles * sum(increments);
    for (let i = 0; i < remainder; i += 1) reward += increments[i];
    return reward;
  }

  function encodeFarms(l1, l2, l3, l4) {
    return (l1 & 63) | ((l2 & 63) << 6) | ((l3 & 63) << 12) | ((l4 & 63) << 18);
  }

  function farmsFromEnc(enc) {
    return [enc & 63, (enc >> 6) & 63, (enc >> 12) & 63, (enc >> 18) & 63];
  }

  function encodeLock(debt, marginalIncome) {
    return debt * 1000 + marginalIncome;
  }

  function lockDebt(lock) {
    return Math.floor(lock / 1000);
  }

  function lockMarginalIncome(lock) {
    return lock % 1000;
  }

  function canonicalizeSellLocks(sellLocks) {
    const out = [[], [], [], []];
    for (let i = 0; i < 4; i += 1) out[i] = (sellLocks?.[i] || []).slice().sort((a, b) => a - b);
    return out;
  }

  function cloneSellLocks(sellLocks) {
    return [sellLocks[0].slice(), sellLocks[1].slice(), sellLocks[2].slice(), sellLocks[3].slice()];
  }

  function insertSorted(arr, value) {
    const out = arr.slice();
    let i = out.length;
    while (i > 0 && out[i - 1] > value) i -= 1;
    out.splice(i, 0, value);
    return out;
  }

  function sellLockKey(sellLocks) {
    return sellLocks.map((locks) => locks.join(".")).join("|");
  }

  function sellLockScore(sellLocks) {
    let score = 0;
    for (const locks of sellLocks) for (const lock of locks) score += lockDebt(lock);
    return score;
  }

  function endpointBetter(cash, sellLockScoreValue, incumbent) {
    if (!incumbent) return true;
    if (cash !== incumbent.cash) return cash > incumbent.cash;
    return sellLockScoreValue < incumbent.sellLockScore;
  }

  function seenBetter(cash, sellLockScoreValue, incumbent) {
    if (!incumbent) return true;
    if (cash !== incumbent.cash) return cash > incumbent.cash;
    return sellLockScoreValue < incumbent.sellLockScore;
  }

  function accrueSellLocks(sellLocks) {
    const out = [[], [], [], []];
    for (let level = 0; level < 4; level += 1) {
      for (const lock of sellLocks[level]) {
        const debt = lockDebt(lock) - lockMarginalIncome(lock);
        if (debt >= 0) out[level].push(encodeLock(debt, lockMarginalIncome(lock)));
      }
    }
    return out;
  }

  function addLockToLevel(sellLocks, idx, debt, marginalIncome) {
    const next = cloneSellLocks(sellLocks);
    next[idx] = insertSorted(next[idx], encodeLock(debt, marginalIncome));
    return next;
  }

  function addBoughtLock(sellLocks) {
    return addLockToLevel(sellLocks, 0, BUY_DEBT, LEVEL_INCOME[1]);
  }

  function upgradeSellLockVariants(sellLocks, fromLevel, farmCount) {
    const variants = [];
    const seen = new Set();
    const idx = fromLevel - 1;
    const upgradeDebt = UPGRADE_DEBT[`${fromLevel}-${fromLevel + 1}`];
    const upgradeIncome = LEVEL_INCOME[fromLevel + 1] - LEVEL_INCOME[fromLevel];
    const addVariant = (next, debt, marginalIncome) => {
      const upgraded = addLockToLevel(next, fromLevel, debt, marginalIncome);
      const key = sellLockKey(upgraded);
      if (!seen.has(key)) {
        seen.add(key);
        variants.push(upgraded);
      }
    };

    const canonical = sellLocks;
    const locked = canonical[idx];
    if (farmCount > locked.length) addVariant(canonical, upgradeDebt, upgradeIncome);
    for (let i = 0; i < locked.length; i += 1) {
      if (i > 0 && locked[i] === locked[i - 1]) continue;
      const next = cloneSellLocks(canonical);
      const [lock] = next[idx].splice(i, 1);
      addVariant(next, lockDebt(lock) + upgradeDebt, lockMarginalIncome(lock) + upgradeIncome);
    }
    return variants;
  }

  function canSellFarm(sellLocks, level, farmCount) {
    return farmCount > (sellLocks[level - 1]?.length || 0);
  }

  function seenKey(farmEnc, startDone, rewardCollected, endDone) {
    return farmEnc + (startDone ? 1 << 24 : 0) + (rewardCollected ? 1 << 25 : 0) + (endDone ? 1 << 26 : 0);
  }

  function appendAction(path, action) {
    return { prev: path, action };
  }

  function actionsFromPath(path) {
    const out = [];
    for (let node = path; node; node = node.prev) out.push(node.action);
    out.reverse();
    return out;
  }

  function actionLogCost(actionLog) {
    let count = 0;
    for (const actions of actionLog || []) {
      for (const action of actions || []) {
        if (action !== "__REWARD__") count += 1;
      }
    }
    return count;
  }

  function betterThan(a, b, objective) {
    if (objective === "max-cash") {
      if (a.cash !== b.cash) return a.cash > b.cash;
      const aInc = incomeOf(a.farms);
      const bInc = incomeOf(b.farms);
      if (aInc !== bInc) return aInc > bInc;
    } else if (objective === "max-income") {
      const aInc = incomeOf(a.farms);
      const bInc = incomeOf(b.farms);
      if (aInc !== bInc) return aInc > bInc;
      if (a.cash !== b.cash) return a.cash > b.cash;
      const aCount = a.farms[0] + a.farms[1] + a.farms[2] + a.farms[3];
      const bCount = b.farms[0] + b.farms[1] + b.farms[2] + b.farms[3];
      if (aCount !== bCount) return aCount < bCount;
    } else {
      throw new Error("objective must be 'max-cash' or 'max-income'");
    }

    const aActionCost = actionLogCost(a.actionLog);
    const bActionCost = actionLogCost(b.actionLog);
    if (aActionCost !== bActionCost) return aActionCost < bActionCost;

    const len = Math.min(a.trace.length, b.trace.length);
    for (let i = 0; i < len; i += 1) {
      const [incA, cashA] = a.trace[i];
      const [incB, cashB] = b.trace[i];
      if (incA !== incB) return incA > incB;
      if (cashA !== cashB) return cashA > cashB;
    }

    const hlen = Math.min(a.farmHistory.length, b.farmHistory.length);
    for (let i = 0; i < hlen; i += 1) {
      const fa = a.farmHistory[i];
      const fb = b.farmHistory[i];
      const ca = fa[0] + fa[1] + fa[2] + fa[3];
      const cb = fb[0] + fb[1] + fb[2] + fb[3];
      if (ca !== cb) return ca < cb;
    }
    return false;
  }

  function nextForcedPurchasesByWave(endWave, startPurchases, endPurchases) {
    const out = new Array(endWave);
    let next = null;
    for (let w = endWave - 1; w >= 0; w -= 1) {
      const endCost = w < endPurchases.length ? Number(endPurchases[w] || 0) : 0;
      if (endCost > 0) next = { wave: w, phase: "end", cost: endCost };
      const startCost = w < startPurchases.length ? Number(startPurchases[w] || 0) : 0;
      if (startCost > 0) next = { wave: w, phase: "start", cost: startCost };
      out[w] = next;
    }
    return out;
  }

  function optimisticLiquidForPurchase({ mode, fromWave, target, farms, cash, bonuses }) {
    let liquid = cash + sellValueOf(farms);
    let income = incomeOf(farms);

    for (let w = fromWave; w <= target.wave; w += 1) {
      liquid += income;
      if (w === target.wave && target.phase === "start") return liquid;

      liquid += waveReward(mode, w, bonuses);
      if (w === target.wave && target.phase === "end") return liquid;

      const futureIncomeEvents = target.wave - w;
      // Optimistic fractional reinvestment: real farms cannot beat this ROI, so
      // pruning below cannot discard an actually affordable purchase path.
      if (futureIncomeEvents * BEST_INCOME_PER_LIQUID_DEBT > 1) {
        income += liquid * BEST_INCOME_PER_LIQUID_DEBT;
        liquid = 0;
      }
    }

    return liquid;
  }

  function optimisticMaxIncomeToEndUpper({ mode, currentWave, endWave, farms, cash, rewardLocked, rewardCollected, bonuses }) {
    let upperIncome = incomeOf(farms);
    let upperCash = cash + (rewardCollected ? 0 : rewardLocked);
    const cashToFinalIncome = BEST_FINAL_INCOME_PER_CASH * Math.pow(1 + BEST_FINAL_INCOME_PER_CASH, Math.max(0, endWave - 1 - currentWave));
    let resaleSurplus = 0;

    for (let level = 1; level <= 4; level += 1) {
      const surplus = SELL_VALUE[level] * cashToFinalIncome - LEVEL_INCOME[level];
      if (surplus > 0) resaleSurplus += farms[level - 1] * surplus;
    }

    for (let w = currentWave; w < endWave; w += 1) {
      upperIncome += upperCash * BEST_FINAL_INCOME_PER_CASH;
      upperCash = 0;
      if (w === endWave - 1) break;
      const nextWave = w + 1;
      upperCash += upperIncome + waveReward(mode, nextWave, bonuses);
    }

    return upperIncome + resaleSurplus;
  }

  function hasForcedPurchases(startPurchases, endPurchases) {
    for (let i = 0; i < startPurchases.length; i += 1) if (Number(startPurchases[i] || 0) > 0) return true;
    for (let i = 0; i < endPurchases.length; i += 1) if (Number(endPurchases[i] || 0) > 0) return true;
    return false;
  }

  function expandMonotoneInvestments(farms, cash) {
    const queue = [{ farms, cash }];
    const seen = new Map([[encodeFarms(farms[0], farms[1], farms[2], farms[3]), cash]]);
    let qh = 0;

    const add = (nextFarms, nextCash) => {
      if (nextCash < 0) return;
      const enc = encodeFarms(nextFarms[0], nextFarms[1], nextFarms[2], nextFarms[3]);
      const oldCash = seen.get(enc);
      if (oldCash == null || nextCash > oldCash) {
        seen.set(enc, nextCash);
        queue.push({ farms: nextFarms, cash: nextCash });
      }
    };

    while (qh < queue.length) {
      const cur = queue[qh++];
      const [l1, l2, l3, l4] = cur.farms;
      if (cur.cash >= BUY_COST) add([l1 + 1, l2, l3, l4], cur.cash - BUY_COST);
      if (l1 > 0 && cur.cash >= UPGRADE_COST["1-2"]) add([l1 - 1, l2 + 1, l3, l4], cur.cash - UPGRADE_COST["1-2"]);
      if (l2 > 0 && cur.cash >= UPGRADE_COST["2-3"]) add([l1, l2 - 1, l3 + 1, l4], cur.cash - UPGRADE_COST["2-3"]);
      if (l3 > 0 && cur.cash >= UPGRADE_COST["3-4"]) add([l1, l2, l3 - 1, l4 + 1], cur.cash - UPGRADE_COST["3-4"]);
    }

    return seen;
  }

  function monotoneMaxIncomeLowerBound({ mode, endWave, bonuses, startWave = 0, startFarms, startCash }) {
    const canonical = normalizeMode(mode);
    let cash = startCash ?? MODE_CONFIGS[canonical].startCash;
    const farms = startFarms ? startFarms.slice() : [0, 0, 0, 0];
    let frontier = new Map([[encodeFarms(farms[0], farms[1], farms[2], farms[3]), cash]]);

    for (let w = startWave; w < endWave; w += 1) {
      const nextFrontier = new Map();
      for (const [enc, stCash] of frontier) {
        const stFarms = farmsFromEnc(Number(enc));
        const cashAfterIncome = stCash + incomeOf(stFarms) + waveReward(mode, w, bonuses);
        const endpoints = expandMonotoneInvestments(stFarms, cashAfterIncome);
        for (const [nextEnc, nextCash] of endpoints) {
          const oldCash = nextFrontier.get(nextEnc);
          if (oldCash == null || nextCash > oldCash) nextFrontier.set(nextEnc, nextCash);
        }
      }
      frontier = nextFrontier;
    }

    let bestIncome = 0;
    for (const enc of frontier.keys()) {
      const inc = incomeOf(farmsFromEnc(Number(enc)));
      if (inc > bestIncome) bestIncome = inc;
    }
    return bestIncome;
  }

  function expandWithinWave({
    startFarms,
    startSellLocks,
    startCash,
    rewardLocked,
    forcedStartPurchase,
    forcedEndPurchase,
    allowFarmInvestments,
    maxIncomePruneRef,
    currentWave,
    endWave,
    mode,
    bonuses,
    actionCounterRef,
  }) {
    const result = new Map(); // farmEnc -> {cash, actions, farmsEnc, sellLocks}
    const queue = [];
    let qh = 0;

    const startRequired = !!forcedStartPurchase && forcedStartPurchase.cost > 0;
    const startCost = startRequired ? forcedStartPurchase.cost : 0;
    const startLabel = startRequired ? forcedStartPurchase.label : null;

    const endRequired = !!forcedEndPurchase && forcedEndPurchase.cost > 0;
    const endCost = endRequired ? forcedEndPurchase.cost : 0;
    const endLabel = endRequired ? forcedEndPurchase.label : null;

    const startDoneInitial = !startRequired;
    // Treat reward as a distinct phase boundary; if startPurchase exists it must
    // occur before reward collection. Reward collection itself is always optimal
    // once permitted and is auto-applied below.
    const rewardCollectedInitial = false;
    const endDoneInitial = !endRequired;

    const bestSeen = new Map(); // key (farmEnc + flags) -> {cash, sellLockScore}

    const startEnc = encodeFarms(startFarms[0], startFarms[1], startFarms[2], startFarms[3]);
    const initialSellLocks = canonicalizeSellLocks(startSellLocks || [[], [], [], []]);
    const initialSellLockScore = sellLockScore(initialSellLocks);
    queue.push({
      farms: startFarms,
      sellLocks: initialSellLocks,
      farmEnc: startEnc,
      cash: startCash,
      actions: null,
      startDone: startDoneInitial,
      rewardCollected: rewardCollectedInitial,
      endDone: endDoneInitial,
    });
    bestSeen.set(
      seenKey(startEnc, startDoneInitial, rewardCollectedInitial, endDoneInitial),
      { cash: startCash, sellLockScore: initialSellLockScore }
    );

    if (startDoneInitial && rewardCollectedInitial && endDoneInitial) {
      result.set(startEnc, { cash: startCash, actions: [], farmsEnc: startEnc, sellLocks: initialSellLocks, sellLockScore: initialSellLockScore });
    }

    const considerState = (ns) => {
      actionCounterRef.count += 1;
      if (ns.cash < 0) return;
      const fe = encodeFarms(ns.farms[0], ns.farms[1], ns.farms[2], ns.farms[3]);
      const key = seenKey(fe, ns.startDone, ns.rewardCollected, ns.endDone);
      const nsSellLockScore = sellLockScore(ns.sellLocks);
      const incumbentSeen = bestSeen.get(key);
      if (!seenBetter(ns.cash, nsSellLockScore, incumbentSeen)) return;

      bestSeen.set(key, { cash: ns.cash, sellLockScore: nsSellLockScore });
      queue.push({
        farms: ns.farms,
        sellLocks: ns.sellLocks,
        farmEnc: fe,
        cash: ns.cash,
        actions: ns.actions,
        startDone: ns.startDone,
        rewardCollected: ns.rewardCollected,
        endDone: ns.endDone,
      });
      if (ns.startDone && ns.rewardCollected && ns.endDone) {
        const curBest = result.get(fe);
        if (endpointBetter(ns.cash, nsSellLockScore, curBest)) {
          result.set(fe, { cash: ns.cash, actions: actionsFromPath(ns.actions), farmsEnc: fe, sellLocks: ns.sellLocks, sellLockScore: nsSellLockScore });
        }
        if (maxIncomePruneRef && currentWave === endWave - 1) {
          const nsIncome = incomeOf(ns.farms);
          if (nsIncome > maxIncomePruneRef.income) maxIncomePruneRef.income = nsIncome;
        }
      }
    };

    while (qh < queue.length) {
      const cur = queue[qh++];
      const [l1, l2, l3, l4] = cur.farms;
      const maxLiquidCash = cur.cash + sellValueOf(cur.farms);
      if (startRequired && !cur.startDone && !cur.rewardCollected && maxLiquidCash < startCost) continue;
      if (endRequired && !cur.endDone && cur.rewardCollected && maxLiquidCash < endCost) continue;
      if (
        maxIncomePruneRef &&
        optimisticMaxIncomeToEndUpper({ mode, currentWave, endWave, farms: cur.farms, cash: cur.cash, rewardLocked, rewardCollected: cur.rewardCollected, bonuses }) +
          1e-9 <
          maxIncomePruneRef.income
      ) {
        continue;
      }

      // Once the start tower purchase is completed (if any), collecting the reward
      // immediately is always optimal (reward only increases cash). Avoid exploring
      // dominated states that delay reward collection.
      if (!cur.rewardCollected && cur.startDone) {
        considerState({
          farms: cur.farms,
          sellLocks: cur.sellLocks,
          cash: cur.cash + rewardLocked,
          actions: appendAction(cur.actions, "__REWARD__"),
          startDone: cur.startDone,
          rewardCollected: true,
          endDone: cur.endDone,
        });
        continue;
      }

      // Forced start tower purchase (must occur before reward is collected)
      if (startRequired && !cur.startDone && !cur.rewardCollected) {
        if (cur.cash >= startCost) {
          considerState({
            farms: cur.farms,
            sellLocks: cur.sellLocks,
            cash: cur.cash - startCost,
            actions: appendAction(cur.actions, startLabel),
            startDone: true,
            rewardCollected: cur.rewardCollected,
            endDone: cur.endDone,
          });
          continue;
        }
      }

      if (!cur.rewardCollected) {
        // Reward can only be collected after the start tower purchase (if required).
        if (!startRequired || cur.startDone) {
          considerState({
            farms: cur.farms,
            sellLocks: cur.sellLocks,
            cash: cur.cash + rewardLocked,
            actions: appendAction(cur.actions, "__REWARD__"),
            startDone: cur.startDone,
            rewardCollected: true,
            endDone: cur.endDone,
          });
        }
      }

      // Forced end tower purchase (must occur after reward is collected)
      if (endRequired && !cur.endDone && cur.rewardCollected) {
        if (cur.cash >= endCost) {
          considerState({
            farms: cur.farms,
            sellLocks: cur.sellLocks,
            cash: cur.cash - endCost,
            actions: appendAction(cur.actions, endLabel),
            startDone: cur.startDone,
            rewardCollected: cur.rewardCollected,
            endDone: true,
          });
          continue;
        }
      }

      const forcedPurchasePending =
        (startRequired && !cur.startDone && !cur.rewardCollected) ||
        (endRequired && !cur.endDone && cur.rewardCollected);

      if (allowFarmInvestments && !forcedPurchasePending && cur.cash >= BUY_COST) {
        considerState({
          farms: [l1 + 1, l2, l3, l4],
          sellLocks: addBoughtLock(cur.sellLocks),
          cash: cur.cash - BUY_COST,
          actions: appendAction(cur.actions, "Buy L1 for $300"),
          startDone: cur.startDone,
          rewardCollected: cur.rewardCollected,
          endDone: cur.endDone,
        });
      }

      if (allowFarmInvestments && !forcedPurchasePending && l1 > 0 && cur.cash >= UPGRADE_COST["1-2"]) {
        for (const sellLocks of upgradeSellLockVariants(cur.sellLocks, 1, l1)) {
          considerState({
            farms: [l1 - 1, l2 + 1, l3, l4],
            sellLocks,
            cash: cur.cash - UPGRADE_COST["1-2"],
            actions: appendAction(cur.actions, "Upgrade L1→L2 for $250"),
            startDone: cur.startDone,
            rewardCollected: cur.rewardCollected,
            endDone: cur.endDone,
          });
        }
      }
      if (allowFarmInvestments && !forcedPurchasePending && l2 > 0 && cur.cash >= UPGRADE_COST["2-3"]) {
        for (const sellLocks of upgradeSellLockVariants(cur.sellLocks, 2, l2)) {
          considerState({
            farms: [l1, l2 - 1, l3 + 1, l4],
            sellLocks,
            cash: cur.cash - UPGRADE_COST["2-3"],
            actions: appendAction(cur.actions, "Upgrade L2→L3 for $550"),
            startDone: cur.startDone,
            rewardCollected: cur.rewardCollected,
            endDone: cur.endDone,
          });
        }
      }
      if (allowFarmInvestments && !forcedPurchasePending && l3 > 0 && cur.cash >= UPGRADE_COST["3-4"]) {
        for (const sellLocks of upgradeSellLockVariants(cur.sellLocks, 3, l3)) {
          considerState({
            farms: [l1, l2, l3 - 1, l4 + 1],
            sellLocks,
            cash: cur.cash - UPGRADE_COST["3-4"],
            actions: appendAction(cur.actions, "Upgrade L3→L4 for $1200"),
            startDone: cur.startDone,
            rewardCollected: cur.rewardCollected,
            endDone: cur.endDone,
          });
        }
      }

      if (l1 > 0 && canSellFarm(cur.sellLocks, 1, l1)) {
        considerState({
          farms: [l1 - 1, l2, l3, l4],
          sellLocks: cur.sellLocks,
          cash: cur.cash + SELL_VALUE[1],
          actions: appendAction(cur.actions, "Sell L1 for $150"),
          startDone: cur.startDone,
          rewardCollected: cur.rewardCollected,
          endDone: cur.endDone,
        });
      }
      if (l2 > 0 && canSellFarm(cur.sellLocks, 2, l2)) {
        considerState({
          farms: [l1, l2 - 1, l3, l4],
          sellLocks: cur.sellLocks,
          cash: cur.cash + SELL_VALUE[2],
          actions: appendAction(cur.actions, "Sell L2 for $275"),
          startDone: cur.startDone,
          rewardCollected: cur.rewardCollected,
          endDone: cur.endDone,
        });
      }
      if (l3 > 0 && canSellFarm(cur.sellLocks, 3, l3)) {
        considerState({
          farms: [l1, l2, l3 - 1, l4],
          sellLocks: cur.sellLocks,
          cash: cur.cash + SELL_VALUE[3],
          actions: appendAction(cur.actions, "Sell L3 for $550"),
          startDone: cur.startDone,
          rewardCollected: cur.rewardCollected,
          endDone: cur.endDone,
        });
      }
      if (l4 > 0 && canSellFarm(cur.sellLocks, 4, l4)) {
        considerState({
          farms: [l1, l2, l3, l4 - 1],
          sellLocks: cur.sellLocks,
          cash: cur.cash + SELL_VALUE[4],
          actions: appendAction(cur.actions, "Sell L4 for $1150"),
          startDone: cur.startDone,
          rewardCollected: cur.rewardCollected,
          endDone: cur.endDone,
        });
      }
    }

    return result;
  }

  function optimise({ mode, endWave, objective, startPurchases, endPurchases, bonuses }) {
    if (objective !== "max-cash" && objective !== "max-income") throw new Error("objective must be max-cash or max-income");

    const canonical = normalizeMode(mode);
    const startCash = MODE_CONFIGS[canonical].startCash;

    const init = {
      wave: 0,
      farms: [0, 0, 0, 0],
      sellLocks: [[], [], [], []],
      farmsEnc: encodeFarms(0, 0, 0, 0),
      cash: startCash,
      actionLog: [],
      trace: [[0, startCash]],
      farmHistory: [[0, 0, 0, 0]],
    };

    let frontier = [init];
    let bestForWave = init;

    const actionCounterRef = { count: 0 };
    const nextPurchases = nextForcedPurchasesByWave(endWave, startPurchases, endPurchases);
    const canUseMonotoneMaxIncomeBound = objective === "max-income" && !hasForcedPurchases(startPurchases, endPurchases);
    const maxIncomePruneRef =
      canUseMonotoneMaxIncomeBound
        ? { income: monotoneMaxIncomeLowerBound({ mode, endWave, bonuses }) }
        : objective === "max-income"
          ? { income: -Infinity }
          : null;

    for (let w = 0; w < endWave; w += 1) {
      const reward = waveReward(mode, w, bonuses);
      const nextFrontier = new Map(); // farmEnc -> state
      const nextPurchase = nextPurchases[w];
      let frontierThisWave = frontier;

      if (nextPurchase) {
        const feasibleFrontier = [];
        for (let i = 0; i < frontier.length; i += 1) {
          const st = frontier[i];
          const liquidUpper = optimisticLiquidForPurchase({
            mode,
            fromWave: w,
            target: nextPurchase,
            farms: st.farms,
            cash: st.cash,
            bonuses,
          });
          if (liquidUpper + 1e-9 >= nextPurchase.cost) feasibleFrontier.push(st);
        }
        // Keep the original failure wave for impossible inputs by only applying
        // the future bound when at least one state can continue.
        if (feasibleFrontier.length) frontierThisWave = feasibleFrontier;
      }

      for (let i = 0; i < frontierThisWave.length; i += 1) {
        const st = frontierThisWave[i];
        const inc = incomeOf(st.farms);
        const baseCash = st.cash + inc;
        const sellLocksAfterIncome = accrueSellLocks(st.sellLocks || [[], [], [], []]);

        const startCost = w < startPurchases.length ? Number(startPurchases[w] || 0) : 0;
        const endCost = w < endPurchases.length ? Number(endPurchases[w] || 0) : 0;
        const forcedStartPurchase = startCost > 0 ? { cost: startCost, label: `Buy tower ${startCost}` } : null;
        const forcedEndPurchase = endCost > 0 ? { cost: endCost, label: `Buy tower ${endCost}` } : null;

        // Model reward as collected during the between-waves phase so we can
        // separate "start" vs "end" tower purchases. If no start tower purchase
        // exists, reward is auto-collected immediately (see expandWithinWave).
        const startCashBetween = baseCash;
        const rewardLocked = reward;

        const expanded = expandWithinWave({
          startFarms: st.farms,
          startSellLocks: sellLocksAfterIncome,
          startCash: startCashBetween,
          rewardLocked,
          forcedStartPurchase,
          forcedEndPurchase,
          allowFarmInvestments: !(objective === "max-cash" && w === endWave - 1),
          maxIncomePruneRef,
          currentWave: w,
          endWave,
          mode,
          bonuses,
          actionCounterRef,
        });

        for (const endpoint of expanded.values()) {
          const farmsEnc = endpoint.farmsEnc;
          const farms2 = farmsFromEnc(farmsEnc);
          const cash2 = endpoint.cash;
          const actionsTaken = endpoint.actions;
          const incomeNext = incomeOf(farms2);
          const newState = {
            wave: w + 1,
            farms: farms2,
            sellLocks: endpoint.sellLocks,
            farmsEnc,
            cash: cash2,
            actionLog: st.actionLog.concat([actionsTaken]),
            trace: st.trace.concat([[incomeNext, cash2]]),
            farmHistory: st.farmHistory.concat([farms2]),
          };

          const incumbent = nextFrontier.get(farmsEnc);
          if (!incumbent || betterThan(newState, incumbent, objective)) {
            nextFrontier.set(farmsEnc, newState);
          }
        }
      }

      frontier = Array.from(nextFrontier.values());
      if (!frontier.length) throw new Error(`No frontier states remaining after wave ${w}`);

      bestForWave = frontier[0];
      for (let i = 1; i < frontier.length; i += 1) {
        if (betterThan(frontier[i], bestForWave, objective)) bestForWave = frontier[i];
      }
      if (typeof postMessage === "function") {
        postMessage({ type: "progress", wave: w, endWave, actionCounter: actionCounterRef.count });
      }
    }

    return {
      best: bestForWave,
      frontierSize: frontier.length,
      actionCounter: actionCounterRef.count,
    };
  }

  function replayPlan({ mode, endWave, bestState, startPurchases, endPurchases, bonuses }) {
    const canonical = normalizeMode(mode);
    let curFarms = [0, 0, 0, 0];
    let curCash = MODE_CONFIGS[canonical].startCash;
    const rows = [];

    for (let w = 0; w < endWave; w += 1) {
      const income = incomeOf(curFarms);
      const cashAfterIncome = curCash + income;
      const rewardBase = waveRewardBase(mode, w);
      const bonus = w < bonuses.length ? Number(bonuses[w] || 0) : 0;
      const rewardTotal = w === 0 ? 0 : rewardBase + bonus;

      const startCost = w < startPurchases.length ? Number(startPurchases[w] || 0) : 0;
      const endCost = w < endPurchases.length ? Number(endPurchases[w] || 0) : 0;

      let tempCash = cashAfterIncome;
      let [l1, l2, l3, l4] = curFarms;
      const rawActions = bestState.actionLog[w] || [];
      let cashAfterReward = null;

      for (let i = 0; i < rawActions.length; i += 1) {
        const act = rawActions[i];
        if (act === "__REWARD__") {
          tempCash += rewardTotal;
          cashAfterReward = tempCash;
          continue;
        }
        if (act.startsWith("Buy L1")) {
          tempCash -= 300;
          l1 += 1;
        } else if (act.startsWith("Upgrade L1")) {
          tempCash -= 250;
          l1 -= 1;
          l2 += 1;
        } else if (act.startsWith("Upgrade L2")) {
          tempCash -= 550;
          l2 -= 1;
          l3 += 1;
        } else if (act.startsWith("Upgrade L3")) {
          tempCash -= 1200;
          l3 -= 1;
          l4 += 1;
        } else if (act.startsWith("Sell L1")) {
          tempCash += 150;
          l1 -= 1;
        } else if (act.startsWith("Sell L2")) {
          tempCash += 275;
          l2 -= 1;
        } else if (act.startsWith("Sell L3")) {
          tempCash += 550;
          l3 -= 1;
        } else if (act.startsWith("Sell L4")) {
          tempCash += 1150;
          l4 -= 1;
        } else if (act.startsWith("Buy tower ")) {
          const parts = act.split(" ");
          const towerCost = Number(parts[parts.length - 1]);
          if (Number.isFinite(towerCost)) tempCash -= towerCost;
        }
      }

      if (cashAfterReward === null) {
        // Wave 0 has no reward; treat "after reward" as the current cash.
        cashAfterReward = tempCash;
      }

      const farmsAfter = [l1, l2, l3, l4];
      const cashAfterActions = tempCash;

      rows.push({
        wave: w,
        income,
        cashStart: curCash,
        cashAfterIncome,
        startTowerCost: startCost,
        rewardBase,
        bonus,
        cashAfterReward,
        endTowerCost: endCost,
        actions: rawActions,
        farmsAfter,
        cashAfterActions,
      });

      curFarms = farmsAfter;
      curCash = cashAfterActions;
    }

    return {
      rows,
      finalFarms: curFarms,
      finalCash: curCash,
      finalIncome: incomeOf(curFarms),
    };
  }

  // Expose internals for quick verification in Node (optional):
  // `node -e "globalThis.self=globalThis; require('./worker.js'); console.log(self.__TBFarmEngine.optimise(...))"`
  self.__TBFarmEngine = {
    optimise,
    replayPlan,
    waveReward,
    waveRewardBase,
    incomeOf,
  };

  self.onmessage = (ev) => {
    try {
      const data = ev.data || {};
      if (data.type !== "run") return;
      const input = data.input || {};

      const mode = input.mode;
      const endWave = Number(input.endWave);
      const objective = input.objective;
      const startPurchases = Array.isArray(input.startPurchases) ? input.startPurchases.map(Number) : [];
      const endPurchases = Array.isArray(input.endPurchases) ? input.endPurchases.map(Number) : [];
      const bonuses = Array.isArray(input.bonuses) ? input.bonuses.map(Number) : [];

      const { best, frontierSize, actionCounter } = optimise({ mode, endWave, objective, startPurchases, endPurchases, bonuses });
      const replay = replayPlan({ mode, endWave, bestState: best, startPurchases, endPurchases, bonuses });

      postMessage({
        type: "result",
        result: {
          mode,
          endWave,
          objective,
          actionCounter,
          finalFrontierSize: frontierSize,
          rows: replay.rows.map((r) => ({
            wave: r.wave,
            income: r.income,
            cashStart: r.cashStart,
            cashAfterIncome: r.cashAfterIncome,
            startTowerCost: r.startTowerCost,
            rewardBase: r.rewardBase,
            bonus: r.bonus,
            cashAfterReward: r.cashAfterReward,
            endTowerCost: r.endTowerCost,
            actions: r.actions,
            farmsAfter: r.farmsAfter,
            cashAfterActions: r.cashAfterActions,
          })),
          finalFarms: replay.finalFarms,
          finalCash: replay.finalCash,
          finalIncome: replay.finalIncome,
        },
      });
    } catch (e) {
      postMessage({ type: "error", error: String(e?.message || e) });
    }
  };
})();
