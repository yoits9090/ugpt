"use client";

import {
  ReactFlow,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Node,
  Edge,
  useReactFlow,
  ReactFlowProvider,
  NodeDragHandler,
} from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import ChatNode from "./nodes/ChatNode";
import { saveCanvas, loadCanvas } from "./lib/storage";

const nodeTypes = { chat: ChatNode };

const defaultNode: Node = {
  id: "chat-initial",
  type: "chat",
  position: { x: -190, y: -200 },
  data: { messages: [], isStreaming: false },
};

const TRASH_ZONE = { right: 80, top: 80 };

function Flow() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([defaultNode]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { screenToFlowPosition, fitView, zoomIn, zoomOut, deleteElements } = useReactFlow();
  const initialized = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [overTrash, setOverTrash] = useState(false);
  const dragNodeId = useRef<string | null>(null);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const saved = loadCanvas();
    if (saved && saved.nodes.length > 0) {
      setNodes(saved.nodes);
      setEdges(saved.edges);
    }
  }, [setNodes, setEdges]);

  useEffect(() => {
    if (!initialized.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveCanvas(nodes, edges), 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [nodes, edges]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  const createNode = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".react-flow__node")) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: `chat-${Date.now()}`,
        type: "chat",
        position: { x: position.x - 190, y: position.y - 100 },
        data: { messages: [], isStreaming: false },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [screenToFlowPosition, setNodes]
  );

  const onNodeDragStart: NodeDragHandler = useCallback((_event, node) => {
    setIsDragging(true);
    dragNodeId.current = node.id;
  }, []);

  const onNodeDrag: NodeDragHandler = useCallback((_event, _node, _nodes) => {
    const e = _event as MouseEvent;
    const inTrash =
      e.clientX > window.innerWidth - TRASH_ZONE.right && e.clientY < TRASH_ZONE.top;
    setOverTrash(inTrash);
  }, []);

  const onNodeDragStop: NodeDragHandler = useCallback(
    (_event, _node) => {
      const e = _event as MouseEvent;
      const inTrash =
        e.clientX > window.innerWidth - TRASH_ZONE.right && e.clientY < TRASH_ZONE.top;
      if (inTrash && dragNodeId.current) {
        deleteElements({ nodes: [{ id: dragNodeId.current }] });
      }
      setIsDragging(false);
      setOverTrash(false);
      dragNodeId.current = null;
    },
    [deleteElements]
  );

  const clearAll = useCallback(() => {
    setNodes([{
      id: `chat-${Date.now()}`,
      type: "chat",
      position: { x: -190, y: -200 },
      data: { messages: [], isStreaming: false },
    }]);
    setEdges([]);
    localStorage.removeItem("ugpt-canvas");
    setTimeout(() => fitView({ maxZoom: 1, duration: 300 }), 50);
  }, [setNodes, setEdges, fitView]);

  const [confirmClear, setConfirmClear] = useState(false);

  const toolbarBtn: React.CSSProperties = {
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderRadius: 8,
    color: "#888",
    cursor: "pointer",
    padding: "8px 12px",
    fontSize: 13,
    transition: "all 0.15s",
    lineHeight: 1,
  };

  return (
    <div style={{ width: "100vw", height: "100vh" }} onDoubleClick={createNode}>
      {/* Trash zone — visible when dragging */}
      {isDragging && (
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            width: TRASH_ZONE.right,
            height: TRASH_ZONE.top,
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: overTrash ? "rgba(220, 38, 38, 0.3)" : "rgba(255, 255, 255, 0.03)",
            borderBottomLeftRadius: 16,
            transition: "background 0.15s",
            pointerEvents: "none",
          }}
        >
          <span style={{ fontSize: 20, opacity: overTrash ? 1 : 0.3, transition: "opacity 0.15s" }}>🗑</span>
        </div>
      )}

      {/* Toolbar — top right */}
      <div
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 50,
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <button onClick={() => zoomIn({ duration: 200 })} style={toolbarBtn} title="Zoom in">+</button>
        <button onClick={() => zoomOut({ duration: 200 })} style={toolbarBtn} title="Zoom out">−</button>
        <button
          onClick={() => {
            if (confirmClear) {
              clearAll();
              setConfirmClear(false);
            } else {
              setConfirmClear(true);
              setTimeout(() => setConfirmClear(false), 2000);
            }
          }}
          style={{
            ...toolbarBtn,
            background: confirmClear ? "#dc2626" : "#1a1a1a",
            color: confirmClear ? "#fff" : "#888",
          }}
          title="Clear all"
        >
          {confirmClear ? "confirm?" : "🗑"}
        </button>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
        defaultEdgeOptions={{ type: "smoothstep" }}
        zoomOnDoubleClick={false}
        nodeDragThreshold={2}
        nodesDraggable={true}
        proOptions={{ hideAttribution: true }}
        style={{ background: "#0a0a0a" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />
      </ReactFlow>
    </div>
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}
