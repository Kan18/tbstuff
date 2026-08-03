"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadEngine() {
  const context = {};
  context.self = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "worker.js"), "utf8"), context);
  return context.__TBFarmEngine;
}

function run(engine, input) {
  const result = engine.optimise(input);
  const replay = engine.replayPlan({
    mode: input.mode,
    endWave: input.endWave,
    bestSolution: result.bestSolution,
    records: result.records,
    initialKey: result.initialKey,
    startPurchases: result.startCosts,
    endPurchases: result.endCosts,
    bonuses: input.bonuses,
  });
  const alternatives = engine.buildAlternativeGraph({
    mode: input.mode,
    terminalIds: result.coOptimalTerminalIds,
    canonicalTerminalId: result.canonicalTerminalId,
    records: result.records,
    startPurchases: result.startCosts,
    endPurchases: result.endCosts,
    bonuses: input.bonuses,
  });
  return { result, replay, alternatives };
}

test("uses the historical income/cash tie-breaker by default", () => {
  const engine = loadEngine();
  const endWave = 6;
  const input = {
    mode: "1v1",
    endWave,
    objective: "max-income",
    startPurchases: Array(endWave).fill(0),
    endPurchases: Array(endWave).fill(0),
    bonuses: Array(endWave).fill(0),
  };
  const { replay, alternatives } = run(engine, input);
  const trace = [[0, 650]].concat(
    replay.rows.map((row) => [engine.incomeOf(row.farmsAfter), row.cashAfterActions])
  );

  assert.deepEqual(trace, [
    [0, 650],
    [100, 100],
    [150, 130],
    [200, 290],
    [300, 230],
    [350, 550],
    [650, 50],
  ]);
  assert.equal(alternatives.count, "6");
});

test("the compact alternative graph counts paths and reproduces the canonical plan", () => {
  const engine = loadEngine();
  const endWave = 6;
  const input = {
    mode: "solo",
    endWave,
    objective: "max-cash",
    startPurchases: Array(endWave).fill(0),
    endPurchases: Array(endWave).fill(0),
    bonuses: [0, 0, 50, -25, 0, 0],
  };
  const { replay, alternatives } = run(engine, input);
  const nodes = new Map(alternatives.nodes.map((node) => [node.id, node]));
  const counts = new Map();
  const countPaths = (id) => {
    if (counts.has(id)) return counts.get(id);
    const node = nodes.get(id);
    const count = node.parents.length
      ? node.parents.reduce((sum, edge) => sum + countPaths(edge.parentId), 0n)
      : 1n;
    counts.set(id, count);
    return count;
  };
  const total = alternatives.terminalIds.reduce(
    (sum, id) => sum + countPaths(id),
    0n
  );

  const reverseRows = [];
  let id = alternatives.canonicalTerminalId;
  while (nodes.get(id).wave > 0) {
    const node = nodes.get(id);
    const edge = node.parents.find(
      (candidate) => candidate.parentId === node.canonicalParentId
    );
    assert.ok(edge);
    reverseRows.push(edge.row);
    id = edge.parentId;
  }

  assert.equal(total.toString(), alternatives.count);
  assert.equal(
    JSON.stringify(reverseRows.reverse()),
    JSON.stringify(replay.rows)
  );
});

test("retains economically optimal plans with different action counts", () => {
  const engine = loadEngine();
  const endWave = 5;
  const input = {
    mode: "1v1",
    endWave,
    objective: "max-cash",
    startPurchases: Array(endWave).fill(0),
    endPurchases: Array(endWave).fill(0),
    bonuses: Array(endWave).fill(0),
  };
  const { result, replay, alternatives } = run(engine, input);
  const nodes = new Map(alternatives.nodes.map((node) => [node.id, node]));

  assert.equal(
    JSON.stringify(alternatives.actionCounts),
    JSON.stringify([{ actions: 3, count: "1" }, { actions: 5, count: "2" }])
  );
  assert.equal(alternatives.preferredActionCount, 3);
  assert.equal(result.bestSolution.actionCount, 3);
  assert.equal(
    replay.rows.flatMap((row) => row.actions).filter((action) => action !== "__REWARD__").length,
    3
  );

  for (const option of alternatives.actionCounts) {
    let remainingActions = option.actions;
    let id = alternatives.canonicalTerminals.find(
      (candidate) => candidate.actions === option.actions
    ).terminalId;
    while (nodes.get(id).wave > 0) {
      const node = nodes.get(id);
      const choice = node.canonicalParents.find(
        (candidate) => candidate.actions === remainingActions
      );
      const edge = node.parents.find(
        (candidate) => candidate.parentId === choice.parentId
      );
      assert.ok(edge);
      remainingActions -= edge.actionCount;
      assert.equal(remainingActions, choice.parentActions);
      id = edge.parentId;
    }
    assert.equal(remainingActions, 0);
  }
});

test("supports L5 farms and their half-cost sell value", () => {
  const engine = loadEngine();
  const upgraded = engine.exactTransition({
    farms: [0, 0, 0, 1, 0],
    cash: 4300,
    target: [0, 0, 0, 0, 1],
    reward: 0,
    startCost: 0,
    endCost: 0,
  });
  assert.equal(upgraded.cash, 0);
  assert.deepEqual(Array.from(upgraded.reuse), [0, 0, 0, 1, 0]);
  assert.equal(upgraded.transitionActionCount, 1);
  assert.equal(engine.incomeOf([0, 0, 0, 0, 1]), 1500);

  const sold = engine.exactTransition({
    farms: [0, 0, 0, 0, 1],
    cash: 0,
    target: [0, 0, 0, 0, 0],
    reward: 0,
    startCost: 5000,
    endCost: 0,
  });
  assert.equal(sold.cash, 50);
});

test("enforces the farm-slot limit for every mode", () => {
  const engine = loadEngine();
  assert.equal(engine.towerLimitOf("1v1"), 25);
  assert.equal(engine.towerLimitOf("solo"), 25);
  assert.equal(engine.towerLimitOf("2v2"), 20);
  assert.equal(engine.towerLimitOf("coop"), 20);
  assert.equal(engine.towerLimitOf("3v3"), 18);
  assert.equal(engine.towerLimitOf("triop"), 18);
  assert.equal(engine.towerLimitOf("4v4"), 15);
  assert.equal(engine.towerLimitOf("quadop"), 15);

  const common = {
    farms: [0, 0, 0, 0, 0],
    cash: 5000,
    reward: 0,
    startCost: 0,
    endCost: 0,
    towerLimit: 15,
  };
  assert.ok(engine.exactTransition({ ...common, target: [15, 0, 0, 0, 0] }));
  assert.equal(
    engine.exactTransition({ ...common, target: [16, 0, 0, 0, 0] }),
    null
  );

  const capped = engine.optimise({
    mode: "quadop",
    endWave: 2,
    objective: "max-income",
    startPurchases: [0, 0],
    endPurchases: [0, 0],
    bonuses: [0, 110000],
  });
  assert.deepEqual(Array.from(capped.bestSolution.farms), [0, 0, 0, 0, 15]);
});

test("five-level capped reuse matches brute force", () => {
  const engine = loadEngine();
  let seed = 0x5eed1234;
  const random = (max) => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed % max;
  };
  const sellValues = [150, 275, 550, 1150, 3550];

  for (let sample = 0; sample < 100; sample += 1) {
    const farms = Array.from({ length: 5 }, () => random(4));
    const target = Array.from({ length: 5 }, () => random(4));
    const cap = random(9001);
    let bruteValue = -1;
    let bruteActionSaving = -1;
    const reuse = new Array(5).fill(0);

    const visit = (index) => {
      if (index === 5) {
        for (let level = 0; level < 5; level += 1) {
          const reusedAtOrAbove = reuse.slice(level).reduce((sum, n) => sum + n, 0);
          const targetsAtOrAbove = target.slice(level).reduce((sum, n) => sum + n, 0);
          if (reusedAtOrAbove > targetsAtOrAbove) return;
        }
        const value = reuse.reduce(
          (sum, count, level) => sum + count * sellValues[level],
          0
        );
        if (value > cap) return;
        const actionSaving = reuse.reduce(
          (sum, count, level) => sum + count * (level + 2),
          0
        );
        if (
          value > bruteValue ||
          (value === bruteValue && actionSaving > bruteActionSaving)
        ) {
          bruteValue = value;
          bruteActionSaving = actionSaving;
        }
        return;
      }
      for (let count = 0; count <= farms[index]; count += 1) {
        reuse[index] = count;
        visit(index + 1);
      }
    };
    visit(0);

    const actual = engine.bestReuseUnderCap(farms, target, cap);
    assert.equal(actual.value, bruteValue);
    assert.equal(actual.actionSavingScore, bruteActionSaving);
  }
});

test("reconstructed forced-purchase plans never spend unavailable cash", () => {
  const engine = loadEngine();
  const endWave = 8;
  const input = {
    mode: "1v1",
    endWave,
    objective: "max-income",
    startPurchases: [0, 0, 0, 0, 0, 1000, 0, 0],
    endPurchases: [0, 0, 0, 0, 0, 500, 0, 0],
    bonuses: [0, 0, 0, 125, 0, 0, 0, 0],
  };
  const { replay } = run(engine, input);

  assert.equal(replay.rows.length, endWave);
  for (const row of replay.rows) {
    assert.ok(row.cashAfterIncome >= 0);
    assert.ok(row.cashAfterReward >= 0);
    assert.ok(row.cashAfterActions >= 0);
  }
});
