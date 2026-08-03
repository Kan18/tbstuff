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
