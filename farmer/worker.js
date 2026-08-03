/* eslint-disable no-restricted-globals */
(() => {
  "use strict";

  // Tower Battles farm data.  TOTAL_COST[level] is the full cost of a farm
  // bought from scratch to that level.  SELL_VALUE is exactly half of it.
  const LEVEL_INCOME = [0, 50, 100, 200, 500, 1500];
  const TOTAL_COST = [0, 300, 550, 1100, 2300, 7100];
  const SELL_VALUE = [0, 150, 275, 550, 1150, 3550];
  const UPGRADE_COST = [0, 250, 550, 1200, 4800]; // index = from level
  const LEVEL_COUNT = LEVEL_INCOME.length - 1;

  const MODE_CONFIGS = {
    "1v1": { startCash: 650, rewardType: "versus", players: 1, towerLimit: 25 },
    "2v2": { startCash: 600, rewardType: "versus", players: 2, towerLimit: 20 },
    "3v3": { startCash: 550, rewardType: "versus", players: 3, towerLimit: 18 },
    "4v4": { startCash: 550, rewardType: "versus", players: 4, towerLimit: 15 },
    solo: { startCash: 650, rewardType: "survival", rewardMultiplier: 16, rewardDivisor: 9, towerLimit: 25 },
    coop: { startCash: 600, rewardType: "survival", rewardMultiplier: 1, rewardDivisor: 1, towerLimit: 20 },
    triop: { startCash: 550, rewardType: "survival", rewardMultiplier: 8, rewardDivisor: 13, towerLimit: 18 },
    quadop: { startCash: 500, rewardType: "survival", rewardMultiplier: 4, rewardDivisor: 11, towerLimit: 15 },
  };
  const MODE_ALIASES = { qop: "quadop" };

  const NEGATIVE_INFINITY_PRIMARY = -1;

  function normalizeMode(mode) {
    const canonical = MODE_ALIASES[mode] || mode;
    if (!MODE_CONFIGS[canonical]) throw new Error(`Unknown mode: ${mode}`);
    return canonical;
  }

  function towerLimitOf(mode) {
    return MODE_CONFIGS[normalizeMode(mode)].towerLimit;
  }

  function assertSafeInteger(value, name) {
    if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
    return value;
  }

  function roundHalfUpRatio(numerator, denominator) {
    return Math.floor((2 * numerator + denominator) / (2 * denominator));
  }

  function waveRewardBase(mode, wave) {
    if (wave === 0) return 0;
    const canonical = normalizeMode(mode);
    const cfg = MODE_CONFIGS[canonical];
    if (cfg.rewardType === "versus") {
      return roundHalfUpRatio(200 + 30 * wave, cfg.players);
    }
    return roundHalfUpRatio((100 + 20 * wave) * cfg.rewardMultiplier, cfg.rewardDivisor);
  }

  function waveReward(mode, wave, bonuses) {
    if (wave === 0) return 0;
    const bonus = wave < bonuses.length ? (bonuses[wave] ?? 0) : 0;
    return waveRewardBase(mode, wave) + bonus;
  }

  function incomeOf(farms) {
    return farms.reduce((sum, count, index) => sum + count * LEVEL_INCOME[index + 1], 0);
  }

  function bookValueOf(farms) {
    return farms.reduce((sum, count, index) => sum + count * TOTAL_COST[index + 1], 0);
  }

  function sellValueOf(farms) {
    return farms.reduce((sum, count, index) => sum + count * SELL_VALUE[index + 1], 0);
  }

  function farmCountOf(farms) {
    return farms.reduce((sum, count) => sum + count, 0);
  }

  function copyFarms(farms) {
    return farms.slice(0, LEVEL_COUNT);
  }

  function farmsKey(farms) {
    return farms.join(",");
  }

  function stateKey(wave, farms) {
    return `${wave}|${farmsKey(farms)}`;
  }

  // ---------- Exact within-wave transition ----------
  //
  // Start from the baseline "sell every old farm, buy every target farm".
  // Reusing a level-i old farm for any target level j >= i saves exactly its
  // sell value, independent of j.  Therefore a transition is a level-chain
  // maximum-weight chain matching, with one extra value cap when a forced
  // purchase requires some farms to be liquidated before rewards arrive.

  function unconstrainedReuse(farms, target) {
    const r = new Array(LEVEL_COUNT).fill(0);
    let usedHigher = 0;
    let eligibleTargetSlots = 0;
    for (let i = LEVEL_COUNT - 1; i >= 0; i -= 1) {
      eligibleTargetSlots += target[i];
      r[i] = Math.min(farms[i], eligibleTargetSlots - usedHigher);
      usedHigher += r[i];
    }

    return {
      reuse: r,
      value: r.reduce((sum, count, i) => sum + count * SELL_VALUE[i + 1], 0),
      actionSavingScore: r.reduce((sum, count, i) => sum + count * (i + 2), 0),
    };
  }

  // Exact two-denomination subproblem in units of $25.  For a fixed residue of
  // r2 modulo 6, the largest feasible r2 is optimal: lowering it by 6 loses 66
  // value units and can add at most six L1 reuses worth 36 units.
  function bestL1L2Reuse(x1, x2, totalSlots, level2PlusSlots, capValue) {
    if (capValue < 0 || totalSlots < 0 || level2PlusSlots < 0) return null;
    const cap = Math.floor(capValue / 25);
    const maxR2 = Math.min(x2, level2PlusSlots, totalSlots, Math.floor(cap / 11));
    let best = null;

    for (let residue = 0; residue < 6; residue += 1) {
      let r2 = maxR2 - (((maxR2 - residue) % 6) + 6) % 6;
      if (r2 < 0) continue;
      const maxR1 = Math.min(x1, totalSlots - r2);
      const r1 = Math.min(maxR1, Math.floor((cap - 11 * r2) / 6));
      if (r1 < 0) continue;
      const units = 11 * r2 + 6 * r1;
      const actionSavingScore = 3 * r2 + 2 * r1;
      if (
        !best ||
        units > best.units ||
        (units === best.units && actionSavingScore > best.actionSavingScore)
      ) {
        best = { r1, r2, units, actionSavingScore };
      }
    }

    if (!best) return null;
    return {
      reuse: [best.r1, best.r2],
      value: best.units * 25,
      actionSavingScore: best.actionSavingScore,
    };
  }

  function bestReuseUnderCap(farms, target, capValue) {
    if (capValue < 0) return null;

    const greedy = unconstrainedReuse(farms, target);
    if (greedy.value <= capValue) return greedy;

    const targetTotal = farmCountOf(target);
    const targetLevel2Plus = target.slice(1).reduce((sum, count) => sum + count, 0);
    const targetLevel3Plus = target.slice(2).reduce((sum, count) => sum + count, 0);
    const targetLevel4Plus = target.slice(3).reduce((sum, count) => sum + count, 0);
    const maxR5 = Math.min(farms[4], target[4], Math.floor(capValue / 3550));

    let best = null;
    for (let r5 = 0; r5 <= maxR5; r5 += 1) {
      const remainingAfterR5 = capValue - 3550 * r5;
      const maxR4 = Math.min(
        farms[3],
        targetLevel4Plus - r5,
        Math.floor(remainingAfterR5 / 1150)
      );

      for (let r4 = 0; r4 <= maxR4; r4 += 1) {
        const remainingAfterR4 = remainingAfterR5 - 1150 * r4;
        const maxR3 = Math.min(
          farms[2],
          targetLevel3Plus - r5 - r4,
          Math.floor(remainingAfterR4 / 550)
        );

        for (let r3 = 0; r3 <= maxR3; r3 += 1) {
          const baseValue = 3550 * r5 + 1150 * r4 + 550 * r3;
          const higherCount = r5 + r4 + r3;
          const lower = bestL1L2Reuse(
            farms[0],
            farms[1],
            targetTotal - higherCount,
            targetLevel2Plus - higherCount,
            capValue - baseValue
          );
          if (!lower) continue;

          const value = baseValue + lower.value;
          const actionSavingScore =
            6 * r5 + 5 * r4 + 4 * r3 + lower.actionSavingScore;
          if (
            !best ||
            value > best.value ||
            (value === best.value && actionSavingScore > best.actionSavingScore)
          ) {
            best = {
              reuse: [lower.reuse[0], lower.reuse[1], r3, r4, r5],
              value,
              actionSavingScore,
            };
          }
        }
      }
    }

    return best;
  }

  function exactTransition({ farms, cash, target, reward, startCost, endCost, towerLimit = Infinity }) {
    if (farmCountOf(target) > towerLimit) return null;
    const cashAfterIncome = cash + incomeOf(farms);
    const liquidIfAllSold = cashAfterIncome + sellValueOf(farms);
    const preRewardRequirement = Math.max(startCost, startCost + endCost - reward);
    const reuseCap = liquidIfAllSold - preRewardRequirement;
    const reuse = bestReuseUnderCap(farms, target, reuseCap);
    if (!reuse) return null;

    const nextCash =
      liquidIfAllSold + reward - startCost - endCost - bookValueOf(target) + reuse.value;
    if (nextCash < 0) return null;
    assertSafeInteger(nextCash, "cash");

    const buildActions = target.reduce((sum, count, index) => sum + count * (index + 1), 0);
    const farmActions =
      buildActions + farmCountOf(farms) - reuse.actionSavingScore;
    const towerActions = (startCost > 0 ? 1 : 0) + (endCost > 0 ? 1 : 0);

    return {
      cash: nextCash,
      reuse: reuse.reuse,
      transitionActionCount: farmActions + towerActions,
    };
  }

  // ---------- Exact rational upper bounds ----------

  function buildExactBounds(endWave, objective, netRewards) {
    const specs = new Array(endWave + 1);

    if (objective === "max-income") {
      specs[endWave] = { kind: "income", denominator: 1n };
      for (let w = endWave - 1; w >= 0; w -= 1) {
        const remaining = endWave - w;
        if (remaining === 1) {
          const factor = 5n;
          const denominator = 23n;
          specs[w] = {
            kind: "ratio",
            factor,
            denominator,
            constantNumerator: factor * BigInt(netRewards[w]),
          };
        } else {
          const next = specs[w + 1];
          const factor = 28n * next.factor;
          const denominator = 23n * next.denominator;
          specs[w] = {
            kind: "ratio",
            factor,
            denominator,
            constantNumerator:
              23n * next.constantNumerator + factor * BigInt(netRewards[w]),
          };
        }
      }
      return specs;
    }

    if (objective !== "max-cash") {
      throw new Error("objective must be 'max-cash' or 'max-income'");
    }

    specs[endWave] = { kind: "cash", denominator: 1n };
    for (let w = endWave - 1; w >= 0; w -= 1) {
      const remaining = endWave - w;
      if (remaining <= 3) {
        const nextConstant = remaining === 1 ? 0n : specs[w + 1].constant;
        specs[w] = {
          kind: "cash-short",
          remaining,
          constant: nextConstant + BigInt(netRewards[w]),
          denominator: 1n,
        };
      } else if (remaining === 4) {
        const factor = 53n;
        const denominator = 46n;
        specs[w] = {
          kind: "ratio",
          factor,
          denominator,
          constantNumerator:
            denominator * specs[w + 1].constant + factor * BigInt(netRewards[w]),
        };
      } else {
        const next = specs[w + 1];
        const factor = 28n * next.factor;
        const denominator = 23n * next.denominator;
        specs[w] = {
          kind: "ratio",
          factor,
          denominator,
          constantNumerator:
            23n * next.constantNumerator + factor * BigInt(netRewards[w]),
        };
      }
    }
    return specs;
  }

  function boundOf(spec, cash, farms) {
    if (spec.kind === "income") {
      return { numerator: BigInt(incomeOf(farms)), denominator: 1n };
    }
    if (spec.kind === "cash") {
      return { numerator: BigInt(cash), denominator: 1n };
    }
    if (spec.kind === "cash-short") {
      return {
        numerator:
          BigInt(cash + sellValueOf(farms) + spec.remaining * incomeOf(farms)) +
          spec.constant,
        denominator: 1n,
      };
    }
    const augmentedWealth = cash + bookValueOf(farms) + incomeOf(farms);
    return {
      numerator:
        spec.factor * BigInt(augmentedWealth) + spec.constantNumerator,
      denominator: spec.denominator,
    };
  }

  function compareFractions(aNumerator, aDenominator, bNumerator, bDenominator) {
    const left = aNumerator * bDenominator;
    const right = bNumerator * aDenominator;
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function boundCanReach(bound, incumbentPrimary) {
    return bound.numerator >= BigInt(incumbentPrimary) * bound.denominator;
  }

  function partialCanReach({
    spec,
    incumbentPrimary,
    baseCashConstant,
    partialCost,
    partialIncome,
    partialReuse,
    remainingBudget,
    remainingMaxLevelIndex,
    remainingSourceSellValue,
  }) {
    const incumbent = BigInt(incumbentPrimary);

    if (spec.kind === "ratio") {
      // Upper-bound future target income by fractional investment in the most
      // efficient remaining level.  Ratios are exact small rationals.
      let ratioNumerator = 0n;
      let ratioDenominator = 1n;
      if (remainingMaxLevelIndex >= 3) {
        ratioNumerator = 5n;
        ratioDenominator = 23n;
      } else if (remainingMaxLevelIndex >= 1) {
        ratioNumerator = 2n;
        ratioDenominator = 11n;
      } else if (remainingMaxLevelIndex === 0) {
        ratioNumerator = 1n;
        ratioDenominator = 6n;
      }

      const integerPart =
        baseCashConstant + partialReuse + remainingSourceSellValue + partialIncome;
      const augmentedNumerator =
        BigInt(integerPart) * ratioDenominator +
        BigInt(remainingBudget) * ratioNumerator;
      const upperNumerator =
        spec.factor * augmentedNumerator +
        spec.constantNumerator * ratioDenominator;
      const upperDenominator = spec.denominator * ratioDenominator;
      return upperNumerator >= incumbent * upperDenominator;
    }

    if (spec.kind === "income") {
      let ratioNumerator = 0n;
      let ratioDenominator = 1n;
      if (remainingMaxLevelIndex >= 3) {
        ratioNumerator = 5n;
        ratioDenominator = 23n;
      } else if (remainingMaxLevelIndex >= 1) {
        ratioNumerator = 2n;
        ratioDenominator = 11n;
      } else if (remainingMaxLevelIndex === 0) {
        ratioNumerator = 1n;
        ratioDenominator = 6n;
      }
      const upperNumerator =
        BigInt(partialIncome) * ratioDenominator +
        BigInt(remainingBudget) * ratioNumerator;
      return upperNumerator >= incumbent * ratioDenominator;
    }

    if (spec.kind === "cash") {
      // Adding another target farm cannot increase cash: its reuse bonus is at
      // most half its purchase cost.
      const upperCash = baseCashConstant - partialCost + partialReuse;
      return BigInt(upperCash) >= incumbent;
    }

    // cash-short: c' + S(target) + n I(target) + constant.
    let bestNumerator = 0n;
    let bestDenominator = 1n;
    for (let levelIndex = 0; levelIndex <= remainingMaxLevelIndex; levelIndex += 1) {
      const level = levelIndex + 1;
      const marginal =
        -SELL_VALUE[level] + spec.remaining * LEVEL_INCOME[level];
      if (marginal <= 0) continue;
      const cost = TOTAL_COST[level];
      if (BigInt(marginal) * bestDenominator > bestNumerator * BigInt(cost)) {
        bestNumerator = BigInt(marginal);
        bestDenominator = BigInt(cost);
      }
    }

    const integerPart =
      baseCashConstant +
      partialReuse +
      remainingSourceSellValue -
      partialCost / 2 +
      spec.remaining * partialIncome;
    const upperNumerator =
      (BigInt(integerPart) + spec.constant) * bestDenominator +
      BigInt(remainingBudget) * bestNumerator;
    return upperNumerator >= incumbent * bestDenominator;
  }

  // Number-valued duals are used only to order heuristic actions.  Exact
  // pruning always uses the BigInt rational bounds above.
  function buildHeuristicDuals(endWave, objective) {
    const alpha = new Array(endWave + 1).fill(0);
    const beta = Array.from(
      { length: endWave + 1 },
      () => new Array(LEVEL_COUNT).fill(0)
    );

    if (objective === "max-income") {
      alpha[endWave] = 0;
      beta[endWave] = LEVEL_INCOME.slice(1);
    } else {
      alpha[endWave] = 1;
      beta[endWave] = new Array(LEVEL_COUNT).fill(0);
    }

    for (let w = endWave - 1; w >= 0; w -= 1) {
      const nextAlpha = alpha[w + 1];
      const nextBeta = beta[w + 1];
      let lambda = nextAlpha;
      for (let level = 1; level <= LEVEL_COUNT; level += 1) {
        lambda = Math.max(lambda, nextBeta[level - 1] / TOTAL_COST[level]);
      }

      const gamma = new Array(LEVEL_COUNT).fill(0);
      for (let from = 1; from <= LEVEL_COUNT; from += 1) {
        let best = lambda * SELL_VALUE[from];
        for (let to = from; to <= LEVEL_COUNT; to += 1) {
          best = Math.max(
            best,
            nextBeta[to - 1] - lambda * (TOTAL_COST[to] - TOTAL_COST[from])
          );
        }
        gamma[from - 1] = best;
      }

      alpha[w] = lambda;
      beta[w] = gamma.map((value, index) => value + lambda * LEVEL_INCOME[index + 1]);
    }

    return { alpha, beta };
  }

  // ---------- Candidate generation ----------

  function generateCandidateTargets({
    farms,
    cash,
    reward,
    startCost,
    endCost,
    childBoundSpec,
    incumbentPrimary,
    heuristicBeta,
    heuristicAlpha,
    towerLimit,
  }) {
    const sourceIncome = incomeOf(farms);
    const sourceBook = bookValueOf(farms);
    const sourceSell = sellValueOf(farms);
    const baseCashConstant =
      cash + sourceIncome + sourceSell + reward - startCost - endCost;
    const maximumTargetBook =
      cash + sourceIncome + sourceBook + reward - startCost - endCost;
    if (maximumTargetBook < 0) return [];

    const sourceSellPrefix = new Array(LEVEL_COUNT).fill(0);
    let prefix = 0;
    for (let i = 0; i < LEVEL_COUNT; i += 1) {
      prefix += farms[i] * SELL_VALUE[i + 1];
      sourceSellPrefix[i] = prefix;
    }

    const target = new Array(LEVEL_COUNT).fill(0);
    const out = [];

    const recurse = ({
      levelIndex,
      remainingBudget,
      partialCost,
      partialIncome,
      partialReuse,
      usedHigherSources,
      targetHigherSlots,
      remainingSlots,
    }) => {
      if (levelIndex < 0) {
        const transition = exactTransition({
          farms,
          cash,
          target,
          reward,
          startCost,
          endCost,
          towerLimit,
        });
        if (!transition) return;
        const bound = boundOf(childBoundSpec, transition.cash, target);
        if (!boundCanReach(bound, incumbentPrimary)) return;
        out.push({
          farms: copyFarms(target),
          cash: transition.cash,
          reuse: transition.reuse,
          transitionActionCount: transition.transitionActionCount,
          bound,
        });
        return;
      }

      if (
        !partialCanReach({
          spec: childBoundSpec,
          incumbentPrimary,
          baseCashConstant,
          partialCost,
          partialIncome,
          partialReuse,
          remainingBudget,
          remainingMaxLevelIndex: levelIndex,
          remainingSourceSellValue: sourceSellPrefix[levelIndex],
        })
      ) {
        return;
      }

      const level = levelIndex + 1;
      const cost = TOTAL_COST[level];
      const maxCount = Math.min(Math.floor(remainingBudget / cost), remainingSlots);
      const heuristicGain = heuristicBeta[levelIndex] - heuristicAlpha * cost;
      const descending = heuristicGain >= 0;

      for (let step = 0; step <= maxCount; step += 1) {
        const count = descending ? maxCount - step : step;
        target[levelIndex] = count;
        const newTargetHigherSlots = targetHigherSlots + count;
        const reusedAtLevel = Math.min(
          farms[levelIndex],
          newTargetHigherSlots - usedHigherSources
        );

        recurse({
          levelIndex: levelIndex - 1,
          remainingBudget: remainingBudget - count * cost,
          partialCost: partialCost + count * cost,
          partialIncome: partialIncome + count * LEVEL_INCOME[level],
          partialReuse: partialReuse + reusedAtLevel * SELL_VALUE[level],
          usedHigherSources: usedHigherSources + reusedAtLevel,
          targetHigherSlots: newTargetHigherSlots,
          remainingSlots: remainingSlots - count,
        });
      }
      target[levelIndex] = 0;
    };

    recurse({
      levelIndex: LEVEL_COUNT - 1,
      remainingBudget: maximumTargetBook,
      partialCost: 0,
      partialIncome: 0,
      partialReuse: 0,
      usedHigherSources: 0,
      targetHigherSlots: 0,
      remainingSlots: towerLimit,
    });

    return out;
  }

  // ---------- Greedy feasible completions (speed only) ----------

  function chooseFarmToSell(farms, alpha, beta) {
    let bestLevelIndex = -1;
    let bestRatio = Infinity;
    for (let i = 0; i < LEVEL_COUNT; i += 1) {
      if (farms[i] <= 0) continue;
      const loss = beta[i] - alpha * SELL_VALUE[i + 1];
      const ratio = loss / SELL_VALUE[i + 1];
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestLevelIndex = i;
      }
    }
    return bestLevelIndex;
  }

  function greedyCompletion({
    startWave,
    startFarms,
    startCash,
    endWave,
    rewards,
    startPurchases,
    endPurchases,
    heuristicDuals,
    towerLimit,
  }) {
    let farms = copyFarms(startFarms);
    let cash = startCash;
    for (let w = startWave; w < endWave; w += 1) {
      const sourceFarms = copyFarms(farms);
      const sourceCash = cash;
      cash += incomeOf(farms);

      const afford = (cost) => {
        while (cash < cost) {
          const levelIndex = chooseFarmToSell(
            farms,
            heuristicDuals.alpha[w + 1],
            heuristicDuals.beta[w + 1]
          );
          if (levelIndex < 0) return false;
          farms[levelIndex] -= 1;
          cash += SELL_VALUE[levelIndex + 1];
        }
        cash -= cost;
        return true;
      };

      if (!afford(startPurchases[w])) return null;
      cash += rewards[w];
      if (!afford(endPurchases[w])) return null;

      // Dual-guided local actions.  This is only a feasible lower bound; the
      // exact A* search below does not rely on its choices.
      let guard = 0;
      while (guard < 2_000_000) {
        guard += 1;
        const alpha = heuristicDuals.alpha[w + 1];
        const beta = heuristicDuals.beta[w + 1];
        let best = null;

        const consider = (ratio, code) => {
          if (!(ratio > 0)) return;
          if (!best || ratio > best.ratio) best = { ratio, code };
        };

        if (cash >= 300 && farmCountOf(farms) < towerLimit) {
          consider((beta[0] - alpha * 300) / 300, "buy");
        }
        for (let from = 1; from < LEVEL_COUNT; from += 1) {
          const cost = UPGRADE_COST[from];
          if (farms[from - 1] > 0 && cash >= cost) {
            consider(
              (beta[from] - beta[from - 1] - alpha * cost) / cost,
              `up${from}`
            );
          }
        }
        for (let i = 0; i < LEVEL_COUNT; i += 1) {
          if (farms[i] <= 0) continue;
          consider(
            (alpha * SELL_VALUE[i + 1] - beta[i]) / SELL_VALUE[i + 1],
            `sell${i + 1}`
          );
        }

        if (!best) break;
        if (best.code === "buy") {
          cash -= 300;
          farms[0] += 1;
        } else if (best.code.startsWith("up")) {
          const from = Number(best.code.slice(2));
          cash -= UPGRADE_COST[from];
          farms[from - 1] -= 1;
          farms[from] += 1;
        } else {
          const levelIndex = Number(best.code.slice(4)) - 1;
          cash += SELL_VALUE[levelIndex + 1];
          farms[levelIndex] -= 1;
        }
      }

      // Canonicalize the heuristic's target through the exact transition.  This
      // can only improve its cash and gives us a reconstructable exact path.
      const transition = exactTransition({
        farms: sourceFarms,
        cash: sourceCash,
        target: farms,
        reward: rewards[w],
        startCost: startPurchases[w],
        endCost: endPurchases[w],
        towerLimit,
      });
      if (!transition) return null;
      cash = transition.cash;
    }

    return { farms, cash };
  }

  // ---------- Priority queue ----------

  class MaxHeap {
    constructor(compare) {
      this.items = [];
      this.compare = compare;
    }

    get size() {
      return this.items.length;
    }

    push(value) {
      const items = this.items;
      items.push(value);
      let index = items.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (this.compare(items[parent], value) >= 0) break;
        items[index] = items[parent];
        index = parent;
      }
      items[index] = value;
    }

    pop() {
      const items = this.items;
      if (!items.length) return null;
      const root = items[0];
      const last = items.pop();
      if (!items.length) return root;

      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= items.length) break;
        let child = left;
        if (right < items.length && this.compare(items[right], items[left]) > 0) {
          child = right;
        }
        if (this.compare(last, items[child]) >= 0) break;
        items[index] = items[child];
        index = child;
      }
      items[index] = last;
      return root;
    }
  }

  function compareHeapNodes(a, b) {
    const boundCmp = compareFractions(
      a.bound.numerator,
      a.bound.denominator,
      b.bound.numerator,
      b.bound.denominator
    );
    if (boundCmp !== 0) return boundCmp;
    if (a.wave !== b.wave) return a.wave - b.wave;
    if (a.cash !== b.cash) return a.cash - b.cash;
    return b.serial - a.serial;
  }

  function primaryValue(objective, farms, cash) {
    return objective === "max-income" ? incomeOf(farms) : cash;
  }

  function compareEconomicRank(a, b, objective) {
    if (!b) return 1;
    if (objective === "max-income") {
      const aIncome = incomeOf(a.farms);
      const bIncome = incomeOf(b.farms);
      if (aIncome !== bIncome) return aIncome > bIncome ? 1 : -1;
      if (a.cash !== b.cash) return a.cash > b.cash ? 1 : -1;
      const aCount = farmCountOf(a.farms);
      const bCount = farmCountOf(b.farms);
      if (aCount !== bCount) return aCount < bCount ? 1 : -1;
    } else {
      if (a.cash !== b.cash) return a.cash > b.cash ? 1 : -1;
      const aIncome = incomeOf(a.farms);
      const bIncome = incomeOf(b.farms);
      if (aIncome !== bIncome) return aIncome > bIncome ? 1 : -1;
    }
    return 0;
  }

  function recordPathForActions(recordId, actionCount, records) {
    const path = [];
    let currentId = recordId;
    while (currentId != null) {
      const record = records.get(currentId);
      if (!record) throw new Error("Missing historical path record");
      path.push(record);
      if (!record.parents?.length) break;
      const choice = record.canonicalByAction?.get(actionCount);
      if (!choice) throw new Error("Missing action-specific historical path");
      currentId = choice.parentId;
      actionCount = choice.parentActions;
    }
    path.reverse();
    return path;
  }

  // Match the original optimizer's final historical tie-breakers: compare the
  // complete income/cash trace first, then prefer fewer farms at the earliest
  // wave where the otherwise-identical traces differ.
  function historicalRecordBetterForActions(aId, aActions, bId, bActions, records) {
    if (bId == null) return true;
    if (aId === bId && aActions === bActions) return false;
    const aPath = recordPathForActions(aId, aActions, records);
    const bPath = recordPathForActions(bId, bActions, records);
    const length = Math.min(aPath.length, bPath.length);

    for (let i = 0; i < length; i += 1) {
      const aIncome = incomeOf(aPath[i].farms);
      const bIncome = incomeOf(bPath[i].farms);
      if (aIncome !== bIncome) return aIncome > bIncome;
      if (aPath[i].cash !== bPath[i].cash) return aPath[i].cash > bPath[i].cash;
    }

    for (let i = 0; i < length; i += 1) {
      const aCount = farmCountOf(aPath[i].farms);
      const bCount = farmCountOf(bPath[i].farms);
      if (aCount !== bCount) return aCount < bCount;
    }
    return false;
  }

  function collectReachableRecordIds(terminalIds, records) {
    const reachable = new Set();
    const stack = terminalIds.slice();
    while (stack.length) {
      const id = stack.pop();
      if (reachable.has(id)) continue;
      const record = records.get(id);
      if (!record) throw new Error("Missing tied-path record");
      reachable.add(id);
      for (const edge of record.parents || []) stack.push(edge.parentId);
    }
    return Array.from(reachable);
  }

  function buildActionPathMetadata(recordIds, records) {
    const ordered = recordIds
      .map((id) => records.get(id))
      .filter(Boolean)
      .sort((a, b) => a.wave - b.wave || a.id - b.id);

    for (const record of ordered) {
      record.actionCounts = new Map();
      record.canonicalByAction = new Map();
      if (!record.parents?.length) {
        record.actionCounts.set(0, 1n);
        record.actionCount = 0;
        continue;
      }

      for (const edge of record.parents) {
        const parent = records.get(edge.parentId);
        if (!parent?.actionCounts) throw new Error("Missing parent action metadata");
        for (const [parentActions, pathCount] of parent.actionCounts) {
          const actions = parentActions + edge.transitionActionCount;
          record.actionCounts.set(
            actions,
            (record.actionCounts.get(actions) || 0n) + pathCount
          );

          const incumbent = record.canonicalByAction.get(actions);
          if (
            !incumbent ||
            historicalRecordBetterForActions(
              edge.parentId,
              parentActions,
              incumbent.parentId,
              incumbent.parentActions,
              records
            )
          ) {
            record.canonicalByAction.set(actions, {
              parentId: edge.parentId,
              parentActions,
              reuse: edge.reuse,
            });
          }
        }
      }

      const preferredActions = Math.min(...record.actionCounts.keys());
      const preferred = record.canonicalByAction.get(preferredActions);
      record.actionCount = preferredActions;
      record.parentId = preferred.parentId;
      record.reuse = preferred.reuse;
    }
  }

  function selectCoOptimalTerminals(terminalIds, records, objective) {
    let best = null;
    const selected = [];
    for (const id of terminalIds) {
      const record = records.get(id);
      if (!record) continue;
      const comparison = compareEconomicRank(record, best, objective);
      if (comparison > 0) {
        best = record;
        selected.length = 0;
        selected.push(id);
      } else if (comparison === 0) {
        selected.push(id);
      }
    }
    return selected;
  }

  function optimise({ mode, endWave, objective, startPurchases, endPurchases, bonuses }) {
    if (objective !== "max-cash" && objective !== "max-income") {
      throw new Error("objective must be max-cash or max-income");
    }
    if (!Number.isSafeInteger(endWave) || endWave < 0) {
      throw new Error("endWave must be a non-negative safe integer");
    }

    const canonicalMode = normalizeMode(mode);
    const modeConfig = MODE_CONFIGS[canonicalMode];
    const startCash = modeConfig.startCash;
    const towerLimit = towerLimitOf(canonicalMode);
    const rewards = new Array(endWave);
    const startCosts = new Array(endWave);
    const endCosts = new Array(endWave);
    const netRewards = new Array(endWave);
    for (let w = 0; w < endWave; w += 1) {
      rewards[w] = assertSafeInteger(waveReward(mode, w, bonuses), `reward at wave ${w}`);
      startCosts[w] = assertSafeInteger(startPurchases[w] || 0, `start purchase at wave ${w}`);
      endCosts[w] = assertSafeInteger(endPurchases[w] || 0, `end purchase at wave ${w}`);
      if (startCosts[w] < 0 || endCosts[w] < 0) {
        throw new Error("tower purchase costs must be non-negative");
      }
      netRewards[w] = rewards[w] - startCosts[w] - endCosts[w];
    }

    const exactBounds = buildExactBounds(endWave, objective, netRewards);
    const heuristicDuals = buildHeuristicDuals(endWave, objective);

    const initialFarms = new Array(LEVEL_COUNT).fill(0);
    const initialStateKey = stateKey(0, initialFarms);
    const initialRecordId = 0;
    const records = new Map();
    const bestByState = new Map(); // wave/farms key -> best record id
    const initialRecord = {
      id: initialRecordId,
      stateKey: initialStateKey,
      wave: 0,
      farms: initialFarms,
      cash: startCash,
      actionCount: 0,
      parentId: null,
      reuse: null,
      parents: [],
    };
    records.set(initialRecordId, initialRecord);
    bestByState.set(initialStateKey, initialRecordId);

    let incumbentPrimary = NEGATIVE_INFINITY_PRIMARY;
    let hasFeasibleCompletion = false;

    const initialGreedy = greedyCompletion({
      startWave: 0,
      startFarms: initialFarms,
      startCash,
      endWave,
      rewards,
      startPurchases: startCosts,
      endPurchases: endCosts,
      heuristicDuals,
      towerLimit,
    });
    if (initialGreedy) {
      incumbentPrimary = primaryValue(objective, initialGreedy.farms, initialGreedy.cash);
      hasFeasibleCompletion = true;
    }

    let serial = 0;
    let nextRecordId = 1;
    const heap = new MaxHeap(compareHeapNodes);
    heap.push({
      ...initialRecord,
      bound: boundOf(exactBounds[0], startCash, initialFarms),
      serial: serial += 1,
    });

    let expanded = 0;
    let maxWaveExpanded = 0;
    const terminalRecordIds = new Set();

    while (heap.size) {
      const node = heap.pop();
      if (!boundCanReach(node.bound, incumbentPrimary)) break;

      const current = records.get(node.id);
      if (!current || bestByState.get(node.stateKey) !== node.id) continue;

      if (node.wave === endWave) {
        terminalRecordIds.add(node.id);
        incumbentPrimary = Math.max(
          incumbentPrimary,
          primaryValue(objective, node.farms, node.cash)
        );
        hasFeasibleCompletion = true;
        continue;
      }

      expanded += 1;
      maxWaveExpanded = Math.max(maxWaveExpanded, node.wave);

      // A feasible completion often tightens the incumbent very early.  It is a
      // speed optimization only; all exactness comes from the rational bounds.
      const completion = greedyCompletion({
        startWave: node.wave,
        startFarms: node.farms,
        startCash: node.cash,
        endWave,
        rewards,
        startPurchases: startCosts,
        endPurchases: endCosts,
        heuristicDuals,
        towerLimit,
      });
      if (completion) {
        incumbentPrimary = Math.max(
          incumbentPrimary,
          primaryValue(objective, completion.farms, completion.cash)
        );
        hasFeasibleCompletion = true;
      }

      const candidates = generateCandidateTargets({
        farms: node.farms,
        cash: node.cash,
        reward: rewards[node.wave],
        startCost: startCosts[node.wave],
        endCost: endCosts[node.wave],
        childBoundSpec: exactBounds[node.wave + 1],
        incumbentPrimary,
        heuristicBeta: heuristicDuals.beta[node.wave + 1],
        heuristicAlpha: heuristicDuals.alpha[node.wave + 1],
        towerLimit,
      });

      for (const candidate of candidates) {
        const childWave = node.wave + 1;
        const childStateKey = stateKey(childWave, candidate.farms);
        const oldId = bestByState.get(childStateKey);
        const old = oldId == null ? null : records.get(oldId);
        if (old) {
          if (old.cash > candidate.cash) continue;
          if (old.cash === candidate.cash) {
            if (
              !(old.parents || []).some(
                (edge) =>
                  edge.parentId === node.id &&
                  edge.transitionActionCount === candidate.transitionActionCount
              )
            ) {
              old.parents.push({
                parentId: node.id,
                reuse: candidate.reuse,
                transitionActionCount: candidate.transitionActionCount,
              });
            }
            continue;
          }
        }

        const parentEdge = {
          parentId: node.id,
          reuse: candidate.reuse,
          transitionActionCount: candidate.transitionActionCount,
        };
        const record = {
          id: nextRecordId,
          stateKey: childStateKey,
          wave: childWave,
          farms: candidate.farms,
          cash: candidate.cash,
          actionCount: null,
          parentId: node.id,
          reuse: candidate.reuse,
          parents: [parentEdge],
        };
        nextRecordId += 1;
        records.set(record.id, record);
        bestByState.set(childStateKey, record.id);
        heap.push({
          ...record,
          bound: candidate.bound,
          serial: serial += 1,
        });
      }

      if (typeof postMessage === "function" && expanded % 250 === 0) {
        postMessage({
          type: "progress",
          wave: maxWaveExpanded,
          endWave,
        });
      }
    }

    if (!hasFeasibleCompletion) {
      throw new Error("No feasible farming plan satisfies the required purchases");
    }

    const coOptimalTerminalIds = selectCoOptimalTerminals(
      Array.from(terminalRecordIds),
      records,
      objective
    );
    if (!coOptimalTerminalIds.length) {
      throw new Error("Internal error: optimal terminal state was not retained");
    }

    const reachableIds = collectReachableRecordIds(coOptimalTerminalIds, records);
    buildActionPathMetadata(reachableIds, records);

    let preferredActionCount = Infinity;
    for (const id of coOptimalTerminalIds) {
      const terminal = records.get(id);
      for (const actionCount of terminal.actionCounts.keys()) {
        preferredActionCount = Math.min(preferredActionCount, actionCount);
      }
    }
    let canonicalTerminalId = null;
    for (const id of coOptimalTerminalIds) {
      const terminal = records.get(id);
      if (!terminal.actionCounts.has(preferredActionCount)) continue;
      if (
        canonicalTerminalId == null ||
        historicalRecordBetterForActions(
          id,
          preferredActionCount,
          canonicalTerminalId,
          preferredActionCount,
          records
        )
      ) {
        canonicalTerminalId = id;
      }
    }
    const canonicalTerminal = records.get(canonicalTerminalId);
    const bestSolution = {
      farms: copyFarms(canonicalTerminal.farms),
      cash: canonicalTerminal.cash,
      actionCount: preferredActionCount,
      terminalRecordId: canonicalTerminalId,
    };

    return {
      bestSolution,
      records,
      initialKey: initialRecordId,
      coOptimalTerminalIds,
      canonicalTerminalId,
      preferredActionCount,
      rewards,
      startCosts,
      endCosts,
    };
  }

  // ---------- Plan reconstruction ----------

  function assignReusedFarms(reuse, target) {
    const availableTargets = copyFarms(target);
    const assignment = Array.from(
      { length: LEVEL_COUNT },
      () => new Array(LEVEL_COUNT).fill(0)
    );

    for (let from = LEVEL_COUNT - 1; from >= 0; from -= 1) {
      let remaining = reuse[from];
      for (let to = from; to < LEVEL_COUNT && remaining > 0; to += 1) {
        const take = Math.min(remaining, availableTargets[to]);
        assignment[from][to] += take;
        availableTargets[to] -= take;
        remaining -= take;
      }
      if (remaining !== 0) throw new Error("Internal matching reconstruction error");
    }

    return { assignment, newTargets: availableTargets };
  }

  function pushRepeated(out, count, action) {
    for (let i = 0; i < count; i += 1) out.push(action);
  }

  function sellAction(level) {
    return `Sell L${level} for $${SELL_VALUE[level]}`;
  }

  function upgradeAction(fromLevel) {
    return `Upgrade L${fromLevel}→L${fromLevel + 1} for $${UPGRADE_COST[fromLevel]}`;
  }

  function buildTransitionActions({
    fromFarms,
    fromCash,
    toFarms,
    reuse,
    reward,
    startCost,
    endCost,
  }) {
    const actions = [];
    let cash = fromCash + incomeOf(fromFarms);
    const sold = fromFarms.map((count, i) => count - reuse[i]);

    const sellUntil = (requiredCash) => {
      for (let level = LEVEL_COUNT; level >= 1 && cash < requiredCash; level -= 1) {
        const index = level - 1;
        while (sold[index] > 0 && cash < requiredCash) {
          sold[index] -= 1;
          cash += SELL_VALUE[level];
          actions.push(sellAction(level));
        }
      }
      if (cash < requiredCash) throw new Error("Internal forced-purchase reconstruction error");
    };

    // Usually rewards are non-negative, so this is just the start purchase.
    // The extra term also keeps reconstruction valid for a negative per-wave
    // adjustment by liquidating enough before the reward phase.
    sellUntil(Math.max(startCost, startCost - reward));
    if (startCost > 0) {
      cash -= startCost;
      actions.push(`Buy tower ${startCost}`);
    }

    cash += reward;
    if (cash < 0) throw new Error("Internal negative cash at reward phase");
    actions.push("__REWARD__");

    if (endCost > 0) {
      sellUntil(endCost);
      cash -= endCost;
      actions.push(`Buy tower ${endCost}`);
    }

    // Sell all other non-reused farms after the forced phases.
    for (let level = LEVEL_COUNT; level >= 1; level -= 1) {
      const index = level - 1;
      pushRepeated(actions, sold[index], sellAction(level));
      cash += sold[index] * SELL_VALUE[level];
      sold[index] = 0;
    }

    const { assignment, newTargets } = assignReusedFarms(reuse, toFarms);

    // Upgrade reused farms.
    for (let from = 0; from < LEVEL_COUNT; from += 1) {
      for (let to = from + 1; to < LEVEL_COUNT; to += 1) {
        const count = assignment[from][to];
        for (let n = 0; n < count; n += 1) {
          for (let level = from + 1; level <= to; level += 1) {
            cash -= UPGRADE_COST[level];
            actions.push(upgradeAction(level));
          }
        }
      }
    }

    // Buy new targets from scratch.
    for (let to = 0; to < LEVEL_COUNT; to += 1) {
      for (let n = 0; n < newTargets[to]; n += 1) {
        cash -= 300;
        actions.push("Buy L1 for $300");
        for (let level = 1; level <= to; level += 1) {
          cash -= UPGRADE_COST[level];
          actions.push(upgradeAction(level));
        }
      }
    }

    if (cash < 0) throw new Error("Internal negative-cash reconstruction error");
    return { actions, cash };
  }

  function reconstructStateChain(bestSolution, records, initialKey) {
    const transitions = [];
    let recordId = bestSolution.terminalRecordId;
    while (recordId !== initialKey) {
      const record = records.get(recordId);
      if (!record) throw new Error("Missing path record");
      const parent = records.get(record.parentId);
      transitions.push({
        wave: record.wave - 1,
        fromFarms: copyFarms(parent.farms),
        fromCash: parent.cash,
        toFarms: copyFarms(record.farms),
        toCash: record.cash,
        reuse: copyFarms(record.reuse),
      });
      recordId = record.parentId;
    }
    transitions.reverse();
    return transitions;
  }

  function buildTransitionRow({
    mode,
    wave,
    fromFarms,
    fromCash,
    toFarms,
    toCash,
    reuse,
    startCost,
    endCost,
    bonus,
  }) {
    const income = incomeOf(fromFarms);
    const cashAfterIncome = fromCash + income;
    const rewardBase = waveRewardBase(mode, wave);
    const safeBonus = bonus ?? 0;
    const rewardTotal = wave === 0 ? 0 : rewardBase + safeBonus;
    const built = buildTransitionActions({
      fromFarms,
      fromCash,
      toFarms,
      reuse,
      reward: rewardTotal,
      startCost,
      endCost,
    });

    let tempCash = cashAfterIncome;
    let cashAfterReward = null;
    for (const action of built.actions) {
      if (action === "__REWARD__") {
        tempCash += rewardTotal;
        cashAfterReward = tempCash;
      } else if (action.startsWith("Sell L")) {
        const level = Number(action[6]);
        tempCash += SELL_VALUE[level];
      } else if (action.startsWith("Buy L1")) {
        tempCash -= 300;
      } else if (action.startsWith("Upgrade L")) {
        const fromLevel = Number(action[9]);
        tempCash -= UPGRADE_COST[fromLevel];
      } else if (action.startsWith("Buy tower ")) {
        tempCash -= Number(action.slice("Buy tower ".length));
      }
    }
    if (cashAfterReward === null) cashAfterReward = tempCash;
    if (toCash !== built.cash || toCash !== tempCash) {
      throw new Error(`Reconstruction cash mismatch at wave ${wave}`);
    }

    return {
      wave,
      income,
      cashStart: fromCash,
      cashAfterIncome,
      startTowerCost: startCost,
      rewardBase,
      bonus: safeBonus,
      cashAfterReward,
      endTowerCost: endCost,
      actions: built.actions,
      farmsAfter: copyFarms(toFarms),
      cashAfterActions: toCash,
    };
  }

  function replayPlan({
    mode,
    endWave,
    bestSolution,
    records,
    initialKey,
    startPurchases,
    endPurchases,
    bonuses,
  }) {
    const transitions = reconstructStateChain(bestSolution, records, initialKey);
    const rows = [];

    for (let w = 0; w < endWave; w += 1) {
      const transition = transitions[w];
      if (!transition || transition.wave !== w) {
        throw new Error(`Missing reconstructed transition for wave ${w}`);
      }
      const startCost = startPurchases[w] || 0;
      const endCost = endPurchases[w] || 0;
      rows.push(buildTransitionRow({
        mode,
        wave: w,
        fromFarms: transition.fromFarms,
        fromCash: transition.fromCash,
        toFarms: transition.toFarms,
        toCash: transition.toCash,
        reuse: transition.reuse,
        startCost,
        endCost,
        bonus: w < bonuses.length ? (bonuses[w] ?? 0) : 0,
      }));
    }

    const finalTransition = transitions[transitions.length - 1];
    const finalFarms = finalTransition
      ? copyFarms(finalTransition.toFarms)
      : new Array(LEVEL_COUNT).fill(0);
    const finalCash = finalTransition
      ? finalTransition.toCash
      : MODE_CONFIGS[normalizeMode(mode)].startCash;

    return {
      rows,
      finalFarms,
      finalCash,
      finalIncome: incomeOf(finalFarms),
    };
  }

  function buildAlternativeGraph({
    mode,
    terminalIds,
    canonicalTerminalId,
    records,
    startPurchases,
    endPurchases,
    bonuses,
  }) {
    const reachableIds = collectReachableRecordIds(terminalIds, records);
    const reachable = new Set(reachableIds);
    const terminalActionCounts = new Map();
    const canonicalTerminalByAction = new Map();
    for (const id of terminalIds) {
      const record = records.get(id);
      if (!record?.actionCounts) throw new Error("Missing terminal action metadata");
      for (const [actions, count] of record.actionCounts) {
        terminalActionCounts.set(actions, (terminalActionCounts.get(actions) || 0n) + count);
        const incumbentId = canonicalTerminalByAction.get(actions);
        if (
          incumbentId == null ||
          historicalRecordBetterForActions(id, actions, incumbentId, actions, records)
        ) {
          canonicalTerminalByAction.set(actions, id);
        }
      }
    }

    const actionCounts = Array.from(terminalActionCounts, ([actions, count]) => ({
      actions,
      count: count.toString(),
    })).sort((a, b) => a.actions - b.actions);
    const preferredActionCount = actionCounts[0].actions;
    const totalCount = actionCounts.reduce((sum, option) => sum + BigInt(option.count), 0n);

    const nodes = reachableIds
      .map((id) => records.get(id))
      .sort((a, b) => a.wave - b.wave || a.id - b.id)
      .map((record) => {
        const parents = [];
        for (const edge of record.parents || []) {
          if (!reachable.has(edge.parentId)) continue;
          const parent = records.get(edge.parentId);
          const wave = record.wave - 1;
          const row = buildTransitionRow({
            mode,
            wave,
            fromFarms: parent.farms,
            fromCash: parent.cash,
            toFarms: record.farms,
            toCash: record.cash,
            reuse: edge.reuse,
            startCost: startPurchases[wave] || 0,
            endCost: endPurchases[wave] || 0,
            bonus: wave < bonuses.length ? (bonuses[wave] ?? 0) : 0,
          });
          parents.push({
            parentId: edge.parentId,
            actionCount: edge.transitionActionCount,
            row,
          });
        }
        return {
          id: record.id,
          wave: record.wave,
          farms: copyFarms(record.farms),
          cash: record.cash,
          income: incomeOf(record.farms),
          canonicalParentId: record.parentId,
          actionCounts: Array.from(record.actionCounts, ([actions, count]) => ({
            actions,
            count: count.toString(),
          })).sort((a, b) => a.actions - b.actions),
          canonicalParents: Array.from(
            record.canonicalByAction,
            ([actions, choice]) => ({
              actions,
              parentId: choice.parentId,
              parentActions: choice.parentActions,
            })
          ).sort((a, b) => a.actions - b.actions),
          parents,
        };
      });

    return {
      count: totalCount.toString(),
      canonicalTerminalId,
      preferredActionCount,
      actionCounts,
      canonicalTerminals: Array.from(
        canonicalTerminalByAction,
        ([actions, terminalId]) => ({ actions, terminalId })
      ).sort((a, b) => a.actions - b.actions),
      terminalIds: terminalIds.slice(),
      nodes,
    };
  }

  self.__TBFarmEngine = {
    optimise,
    replayPlan,
    waveReward,
    waveRewardBase,
    towerLimitOf,
    incomeOf,
    exactTransition,
    bestReuseUnderCap,
    buildAlternativeGraph,
  };

  self.onmessage = (ev) => {
    try {
      const data = ev.data || {};
      if (data.type !== "run") return;
      const input = data.input || {};

      const mode = input.mode;
      const endWave = Number(input.endWave);
      const objective = input.objective;
      const startPurchases = Array.isArray(input.startPurchases)
        ? input.startPurchases.map(Number)
        : [];
      const endPurchases = Array.isArray(input.endPurchases)
        ? input.endPurchases.map(Number)
        : [];
      const bonuses = Array.isArray(input.bonuses) ? input.bonuses.map(Number) : [];

      const result = optimise({
        mode,
        endWave,
        objective,
        startPurchases,
        endPurchases,
        bonuses,
      });
      const replay = replayPlan({
        mode,
        endWave,
        bestSolution: result.bestSolution,
        records: result.records,
        initialKey: result.initialKey,
        startPurchases: result.startCosts,
        endPurchases: result.endCosts,
        bonuses,
      });
      const alternatives = buildAlternativeGraph({
        mode,
        terminalIds: result.coOptimalTerminalIds,
        canonicalTerminalId: result.canonicalTerminalId,
        records: result.records,
        startPurchases: result.startCosts,
        endPurchases: result.endCosts,
        bonuses,
      });

      postMessage({
        type: "result",
        result: {
          mode,
          endWave,
          objective,
          rows: replay.rows,
          finalFarms: replay.finalFarms,
          finalCash: replay.finalCash,
          finalIncome: replay.finalIncome,
          alternatives,
        },
      });
    } catch (e) {
      postMessage({ type: "error", error: String(e?.message || e) });
    }
  };
})();
