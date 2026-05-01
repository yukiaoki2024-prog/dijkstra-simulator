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

type CellHistory = {
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

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
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

const SEG_COLORS = [
  { visited: "rgba(33,150,243,0.25)", path: "#1565c0" },
  { visited: "rgba(233,30,99,0.22)", path: "#c2185b" },
  { visited: "rgba(76,175,80,0.22)", path: "#2e7d32" },
  { visited: "rgba(255,152,0,0.22)", path: "#e65100" },
  { visited: "rgba(156,39,176,0.22)", path: "#6a1b9a" },
];

const POINT_COLORS = ["#00c896", "#e8365d", "#f5a623", "#7b5ea7", "#2196f3"];
const MAX_POINTS = 5;

type HistoryEntry = {
  runIdx: number;
  mode: "dijkstra" | "astar";
  segments: { visited: number; path: number }[];
  totalVisited: number;
  totalPath: number;
};

export default function App() {
  const [grid, setGrid] = useState<Node[][]>(makeEmptyGrid);
  const [cellHistory, setCellHistory] = useState<CellHistory[][]>(makeEmptyHistory);
  const [points, setPoints] = useState<Pos[]>([]);
  const [mode, setMode] = useState<"dijkstra" | "astar">("dijkstra");
  const [isRunning, setIsRunning] = useState(false);
  const [runLog, setRunLog] = useState<HistoryEntry[]>([]);
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
    setHighlightRun(null);

    let workGrid = resetSearchState(grid);
    const histCopy: CellHistory[][] = cellHistory.map((row) =>
      row.map((c) => ({ visited: { ...c.visited }, path: { ...c.path } }))
    );

    const segStats: { visited: number; path: number }[] = [];
    let totalVisited = 0;
    let totalPath = 0;

    for (let segIdx = 0; segIdx < points.length - 1; segIdx++) {
      workGrid = resetSearchState(workGrid);
      const key = `${runIdx}_${segIdx}`;
      const gen = search(workGrid, points[segIdx], points[segIdx + 1], mode === "astar");
      let segVisited = 0, segPath = 0;

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
        setGrid(workGrid.map((r) => [...r]));
        setCellHistory(histCopy.map((r) => r.map((c) => ({ ...c }))));
        await new Promise((r) => setTimeout(r, 12));
      }
      segStats.push({ visited: segVisited, path: segPath });
    }

    setRunLog((prev) => [
      ...prev,
      { runIdx, mode, segments: segStats, totalVisited, totalPath },
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
    setHighlightRun(null);
    runCountRef.current = 0;
  };

  const clearHistory = () => {
    if (runningRef.current) return;
    setGrid((prev) => resetSearchState(prev));
    setCellHistory(makeEmptyHistory());
    setRunLog([]);
    setHighlightRun(null);
    runCountRef.current = 0;
  };

  const Btn = ({ label, onClick, active = false, disabled = false, accent = "#555", small = false }: any) => (
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

  const getCellDisplay = (node: Node, hist: CellHistory) => {
    const filterKey = highlightRun !== null ? (k: string) => k.startsWith(`${highlightRun}_`) : () => true;
    const pathKeys = Object.keys(hist.path).filter(filterKey);
    const visitedKeys = Object.keys(hist.visited).filter(filterKey);

    if (pathKeys.length > 0) {
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
        userSelect: "
