import React, { useState, useRef, useCallback } from "react";

const GRID_SIZE = 24;
const CELL_SIZE = 24;

type Pos = { x: number; y: number };

type Node = {
  x: number;
  y: number;
  dist: number;
  visited: boolean;
  isPath: boolean;
  parent: Pos | null;
  isWall: boolean;
};

// セルごとに「どの実行・セグメントで訪問/パスになったか」を記録
type CellHistory = {
  // runIdx_segIdx -> true
  visited: Record<string, boolean>;
  path: Record<string, boolean>;
};

class MinHeap {
  data: { key: number; pos: Pos }[] = [];
  push(key: number, pos: Pos) {
    this.data.push({ key, pos });
    this.up();
  }
  pop() {
    if (!this.data.length) return;
    const top = this.data[0];
    const end = this.data.pop();
    if (this.data.length && end) {
      this.data[0] = end;
      this.down();
    }
    return top;
  }
  up() {
    let i = this.data.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].key <= this.data[i].key) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }
  down() {
    let i = 0;
    while (true) {
      const l = i * 2 + 1,
        r = i * 2 + 2;
      let s = i;
      if (l < this.data.length && this.data[l].key < this.data[s].key) s = l;
      if (r < this.data.length && this.data[r].key < this.data[s].key) s = r;
      if (s === i) break;
      [this.data[i], this.data[s]] = [this.data[s], this.data[i]];
      i = s;
    }
  }
}

function heuristic(a: Pos, b: Pos) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function makeEmptyGrid(): Node[][] {
  return Array.from({ length: GRID_SIZE }, (_, y) =>
    Array.from({ length: GRID_SIZE }, (_, x) => ({
      x,
      y,
      dist: Infinity,
      visited: false,
      isPath: false,
      parent: null,
      isWall: false,
    }))
  );
}

function makeEmptyHistory(): CellHistory[][] {
  return Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({ visited: {}, path: {} }))
  );
}

function resetSearchState(grid: Node[][]): Node[][] {
  return grid.map((row) =>
    row.map((n) => ({
      ...n,
      dist: Infinity,
      visited: false,
      isPath: false,
      parent: null,
    }))
  );
}

function* search(grid: Node[][], start: Pos, goal: Pos, useAstar: boolean) {
  const heap = new MinHeap();
  grid[start.y][start.x].dist = 0;
  heap.push(0, start);

  while (heap.data.length) {
    const cur = heap.pop();
    if (!cur) break;
    const { x, y } = cur.pos;
    const node = grid[y][x];
    if (node.visited || node.isWall) continue;
    node.visited = true;
    yield { type: "visit", node: { x, y } };

    if (x === goal.x && y === goal.y) {
      let c: Node | null = node;
      while (c) {
        yield { type: "path", node: { x: c.x, y: c.y } };
        if (!c.parent) break;
        c = grid[c.parent.y][c.parent.x];
      }
      return;
    }

    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
      const next = grid[ny][nx];
      if (next.isWall) continue;
      const g = node.dist + 1;
      if (g < next.dist) {
        next.dist = g;
        next.parent = { x, y };
        const cost = useAstar ? g + heuristic({ x: nx, y: ny }, goal) : g;
        heap.push(cost, { x: nx, y: ny });
      }
    }
  }
}

// セグメントインデックスに対応する色セット
const SEG_COLORS = [
  { visited: "rgba(33,150,243,0.25)", path: "#1565c0" },
  { visited: "rgba(233,30,99,0.22)", path: "#c2185b" },
  { visited: "rgba(76,175,80,0.22)", path: "#2e7d32" },
  { visited: "rgba(255,152,0,0.22)", path: "#e65100" },
  { visited: "rgba(156,39,176,0.22)", path: "#6a1b9a" },
];

// 実行インデックスに対応する透明度（古いものを薄く）
function runAlpha(runIdx: number, latestRunIdx: number): number {
  const age = latestRunIdx - runIdx;
  return Math.max(0.2, 1 - age * 0.25);
}

const POINT_COLORS = ["#00c896", "#e8365d", "#f5a623", "#7b5ea7", "#2196f3"];
const MAX_POINTS = 5;

// 履歴エントリー
type HistoryEntry = {
  runIdx: number;
  mode: "dijkstra" | "astar";
  segments: { visited: number; path: number }[];
  totalVisited: number;
  totalPath: number;
};

export default function App() {
  const [grid, setGrid] = useState<Node[][]>(makeEmptyGrid);
  // セルごとの履歴（run_seg -> visited/path）
  const [cellHistory, setCellHistory] =
    useState<CellHistory[][]>(makeEmptyHistory);
  const [points, setPoints] = useState<Pos[]>([]);
  const [mode, setMode] = useState<"dijkstra" | "astar">("dijkstra");
  const [isRunning, setIsRunning] = useState(false);
  const [runLog, setRunLog] = useState<HistoryEntry[]>([]);
  const [latestRunIdx, setLatestRunIdx] = useState(-1);
  // 表示フィルタ：どの実行を表示するか（nullなら全表示）
  const [highlightRun, setHighlightRun] = useState<number | null>(null);

  const runningRef = useRef(false);
  const runCountRef = useRef(0);
  const rightDragging = useRef(false);
  const dragWallState = useRef(false);

  const applyWall = useCallback((x: number, y: number, wallOn: boolean) => {
    setGrid((prev) => {
      const copy = prev.map((r) => r.map((n) => ({ ...n })));
      copy[y][x].isWall = wallOn;
      return copy;
    });
  }, []);

  const handleCellClick = (x: number, y: number) => {
    if (runningRef.current) return;
    if (grid[y][x].isWall) return;
    if (points.length >= MAX_POINTS) return;
    if (points.some((p) => p.x === x && p.y === y)) return;
    setPoints((prev) => [...prev, { x, y }]);
  };

  const handleMouseDown = (x: number, y: number, e: React.MouseEvent) => {
    if (e.button !== 2) return;
    if (runningRef.current) return;
    e.preventDefault();
    rightDragging.current = true;
    dragWallState.current = !grid[y][x].isWall;
    applyWall(x, y, dragWallState.current);
  };

  const handleMouseEnter = (x: number, y: number) => {
    if (!rightDragging.current || runningRef.current) return;
    applyWall(x, y, dragWallState.current);
  };

  const handleMouseUp = () => {
    rightDragging.current = false;
  };

  const run = async () => {
    if (points.length < 2 || runningRef.current) return;
    runningRef.current = true;
    setIsRunning(true);

    const runIdx = runCountRef.current++;
    setLatestRunIdx(runIdx);
    setHighlightRun(null);

    let workGrid = resetSearchState(grid);
    // cellHistoryはimmutableにコピーして更新
    const histCopy: CellHistory[][] = cellHistory.map((row) =>
      row.map((c) => ({ visited: { ...c.visited }, path: { ...c.path } }))
    );

    const segStats: { visited: number; path: number }[] = [];
    let totalVisited = 0;
    let totalPath = 0;

    for (let segIdx = 0; segIdx < points.length - 1; segIdx++) {
      workGrid = resetSearchState(workGrid);
      const key = `${runIdx}_${segIdx}`;
      const gen = search(
        workGrid,
        points[segIdx],
        points[segIdx + 1],
        mode === "astar"
      );
      let segVisited = 0,
        segPath = 0;

      for (const e of gen) {
        if (!runningRef.current) break;
        if (e.type === "visit") {
          workGrid[e.node.y][e.node.x].visited = true;
          histCopy[e.node.y][e.node.x].visited[key] = true;
          totalVisited++;
          segVisited++;
        }
        if (e.type === "path") {
          workGrid[e.node.y][e.node.x].isPath = true;
          histCopy[e.node.y][e.node.x].path[key] = true;
          totalPath++;
          segPath++;
        }
        // グリッドとhistoryを同時更新
        setGrid(workGrid.map((r) => [...r]));
        setCellHistory(histCopy.map((r) => r.map((c) => ({ ...c }))));
        await new Promise((r) => setTimeout(r, 12));
      }
      segStats.push({ visited: segVisited, path: segPath });
    }

    setRunLog((prev) => [
      ...prev,
      {
        runIdx,
        mode,
        segments: segStats,
        totalVisited,
        totalPath,
      },
    ]);

    runningRef.current = false;
    setIsRunning(false);
  };

  const reset = () => {
    runningRef.current = false;
    setIsRunning(false);
    setGrid(makeEmptyGrid());
    setCellHistory(makeEmptyHistory());
    setPoints([]);
    setRunLog([]);
    setLatestRunIdx(-1);
    setHighlightRun(null);
    runCountRef.current = 0;
  };

  const clearHistory = () => {
    if (runningRef.current) return;
    setGrid((prev) => resetSearchState(prev));
    setCellHistory(makeEmptyHistory());
    setRunLog([]);
    setLatestRunIdx(-1);
    setHighlightRun(null);
    runCountRef.current = 0;
  };

  const Btn = ({
    label,
    onClick,
    active = false,
    disabled = false,
    accent = "#555",
    small = false,
  }: {
    label: string;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
    accent?: string;
    small?: boolean;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: small ? "4px 10px" : "7px 16px",
        borderRadius: 4,
        border: `1.5px solid ${active ? accent : "#aaa"}`,
        background: active ? accent + "22" : "transparent",
        color: disabled ? "#bbb" : active ? accent : "#444",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: small ? 10 : 12,
        letterSpacing: 1,
        fontFamily: "inherit",
        fontWeight: active ? 700 : 400,
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );

  // セルの表示色を決定
  const getCellDisplay = (node: Node, hist: CellHistory) => {
    // 表示対象のキーを絞る
    const filterKey =
      highlightRun !== null
        ? (k: string) => k.startsWith(`${highlightRun}_`)
        : () => true;

    // pathキーを集める（セグメント別に色分け）
    const pathKeys = Object.keys(hist.path).filter(filterKey);
    const visitedKeys = Object.keys(hist.visited).filter(filterKey);

    // 最新のpathキーを優先
    if (pathKeys.length > 0) {
      // 最新のセグメントで着色
      const latest = pathKeys.sort().at(-1)!;
      const segIdx = parseInt(latest.split("_")[1]);
      const color = SEG_COLORS[segIdx % SEG_COLORS.length].path;
      return { bg: "#c8c8c8", dot: color, dotSize: 7, glow: color };
    }
    if (visitedKeys.length > 0) {
      const latest = visitedKeys.sort().at(-1)!;
      const segIdx = parseInt(latest.split("_")[1]);
      const color = SEG_COLORS[segIdx % SEG_COLORS.length].visited;
      return { bg: color, dot: null, dotSize: 0, glow: null };
    }
    return { bg: "#c8c8c8", dot: null, dotSize: 0, glow: null };
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#d0d0d0",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: "#333",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 16px",
        userSelect: "none",
      }}
      onMouseUp={handleMouseUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Title */}
      <div style={{ marginBottom: 16, textAlign: "center" }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: 5,
            color: "#888",
            marginBottom: 4,
            textTransform: "uppercase",
          }}
        >
          Pathfinding Visualizer
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: 1,
            color: "#222",
          }}
        >
          {mode === "astar" ? "A* Search" : "Dijkstra's Algorithm"}
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 12,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <Btn
          label="DIJKSTRA"
          onClick={() => !isRunning && setMode("dijkstra")}
          active={mode === "dijkstra"}
          accent="#2196f3"
        />
        <Btn
          label="A* STAR"
          onClick={() => !isRunning && setMode("astar")}
          active={mode === "astar"}
          accent="#2196f3"
        />
        <div style={{ width: 1, background: "#bbb", margin: "0 4px" }} />
        <Btn
          label={isRunning ? "RUNNING..." : "▶ RUN"}
          onClick={run}
          disabled={isRunning || points.length < 2}
          accent="#e8365d"
        />
        <Btn
          label="CLEAR HISTORY"
          onClick={clearHistory}
          disabled={isRunning}
        />
        <Btn label="RESET" onClick={reset} />
      </div>

      {/* Instruction */}
      <div
        style={{
          fontSize: 10,
          color: "#888",
          marginBottom: 12,
          letterSpacing: 1,
          textAlign: "center",
          lineHeight: 1.8,
        }}
      >
        <span style={{ color: "#00a070", fontWeight: 700 }}>左クリック</span> →
        ポイント追加 &nbsp;|&nbsp;
        <span style={{ color: "#555", fontWeight: 700 }}>右ドラッグ</span> →
        壁を描く / 消す
        {points.length < 2 && (
          <span style={{ color: "#e8365d", marginLeft: 8 }}>
            ※ 2点以上置いてください
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "flex-start",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {/* Grid */}
        <div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
              gap: 1,
              background: "#b0b0b0",
              padding: 8,
              borderRadius: 6,
              border: "1px solid #999",
              boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
            }}
          >
            {grid.map((row, y) =>
              row.map((node, x) => {
                const ptIdx = points.findIndex((p) => p.x === x && p.y === y);
                const isPoint = ptIdx !== -1;
                const hist = cellHistory[y][x];
                const { bg, dot, dotSize, glow } = getCellDisplay(node, hist);

                return (
                  <div
                    key={`${x},${y}`}
                    onClick={() => handleCellClick(x, y)}
                    onMouseDown={(e) => handleMouseDown(x, y, e)}
                    onMouseEnter={() => handleMouseEnter(x, y)}
                    style={{
                      width: CELL_SIZE,
                      height: CELL_SIZE,
                      background: node.isWall ? "#5a5a5a" : bg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: isRunning ? "default" : "crosshair",
                      position: "relative",
                      transition: "background 0.06s",
                      borderRadius: 2,
                    }}
                  >
                    {node.isWall && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          background:
                            "repeating-linear-gradient(45deg, #4a4a4a 0px, #4a4a4a 3px, #5a5a5a 3px, #5a5a5a 6px)",
                          borderRadius: 2,
                        }}
                      />
                    )}
                    {dot && !isPoint && (
                      <div
                        style={{
                          width: dotSize,
                          height: dotSize,
                          borderRadius: "50%",
                          background: dot,
                          boxShadow: glow ? `0 0 4px ${glow}` : undefined,
                          zIndex: 1,
                          position: "relative",
                        }}
                      />
                    )}
                    {isPoint && (
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: POINT_COLORS[ptIdx] + "33",
                          border: `2px solid ${POINT_COLORS[ptIdx]}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 8,
                          fontWeight: 700,
                          color: POINT_COLORS[ptIdx],
                          boxShadow: `0 0 6px ${POINT_COLORS[ptIdx]}88`,
                          zIndex: 2,
                          position: "relative",
                        }}
                      >
                        {ptIdx + 1}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Legend */}
          <div
            style={{
              display: "flex",
              gap: 14,
              marginTop: 12,
              fontSize: 10,
              color: "#666",
              letterSpacing: 1,
              flexWrap: "wrap",
            }}
          >
            {SEG_COLORS.slice(0, Math.max(1, points.length - 1)).map((c, i) => (
              <div
                key={i}
                style={{ display: "flex", alignItems: "center", gap: 4 }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: c.visited,
                    border: `1.5px solid ${c.path}`,
                  }}
                />
                SEG {i + 1}
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: "#5a5a5a55",
                  border: "1.5px solid #5a5a5a",
                }}
              />
              WALL
            </div>
          </div>
        </div>

        {/* 実行履歴パネル */}
        <div
          style={{
            minWidth: 200,
            maxWidth: 240,
            background: "#c4c4c4",
            borderRadius: 6,
            border: "1px solid #aaa",
            padding: "12px",
            fontSize: 11,
          }}
        >
          <div
            style={{
              fontWeight: 700,
              letterSpacing: 2,
              color: "#444",
              marginBottom: 10,
              fontSize: 10,
            }}
          >
            HISTORY ({runLog.length} runs)
          </div>

          {runLog.length === 0 && (
            <div style={{ color: "#999", fontSize: 10 }}>
              まだ実行されていません
            </div>
          )}

          {[...runLog].reverse().map((entry) => {
            const isHighlighted = highlightRun === entry.runIdx;
            return (
              <div
                key={entry.runIdx}
                onClick={() =>
                  setHighlightRun(isHighlighted ? null : entry.runIdx)
                }
                style={{
                  marginBottom: 8,
                  padding: "8px 10px",
                  borderRadius: 4,
                  border: `1.5px solid ${isHighlighted ? "#2196f3" : "#bbb"}`,
                  background: isHighlighted
                    ? "rgba(33,150,243,0.1)"
                    : "#d0d0d0",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontWeight: 700, color: "#333" }}>
                    Run #{entry.runIdx + 1}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      padding: "1px 6px",
                      borderRadius: 3,
                      background:
                        entry.mode === "astar" ? "#e8365d22" : "#2196f322",
                      color: entry.mode === "astar" ? "#c2185b" : "#1565c0",
                      border: `1px solid ${
                        entry.mode === "astar" ? "#c2185b" : "#1565c0"
                      }`,
                    }}
                  >
                    {entry.mode === "astar" ? "A*" : "DIJ"}
                  </span>
                </div>
                <div style={{ color: "#555", fontSize: 10, lineHeight: 1.6 }}>
                  <div>
                    訪問:{" "}
                    <span style={{ color: "#1565c0" }}>
                      {entry.totalVisited}
                    </span>
                  </div>
                  <div>
                    パス長:{" "}
                    <span style={{ color: "#c87000" }}>
                      {entry.totalPath > 0
                        ? entry.totalPath - entry.segments.length
                        : 0}
                    </span>
                  </div>
                </div>
                <div style={{ marginTop: 4 }}>
                  {entry.segments.map((seg, si) => (
                    <div
                      key={si}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 9,
                        color: "#777",
                      }}
                    >
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 1,
                          background: SEG_COLORS[si % SEG_COLORS.length].path,
                        }}
                      />
                      区間{si + 1}: 訪問{seg.visited} / 経路
                      {Math.max(0, seg.path - 1)}
                    </div>
                  ))}
                </div>
                {isHighlighted && (
                  <div style={{ fontSize: 9, color: "#2196f3", marginTop: 4 }}>
                    ● この実行をハイライト中
                  </div>
                )}
              </div>
            );
          })}

          {runLog.length > 0 && (
            <div
              style={{
                fontSize: 9,
                color: "#999",
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              クリックで特定の実行をハイライト表示
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
