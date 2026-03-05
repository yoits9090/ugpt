import { Node, Edge } from "@xyflow/react";

const STORAGE_KEY = "ugpt-canvas";

interface CanvasState {
  nodes: Node[];
  edges: Edge[];
}

export function saveCanvas(nodes: Node[], edges: Edge[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges }));
  } catch {
    // localStorage might be full
  }
}

export function loadCanvas(): CanvasState | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) return JSON.parse(data);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return null;
}
