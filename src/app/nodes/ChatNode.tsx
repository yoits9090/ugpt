"use client";

import { Handle, Position, NodeProps, useReactFlow } from "@xyflow/react";
import { useState, useRef, useEffect, useCallback, memo, KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessage, streamChat, ToolEventType } from "../lib/chat";

// Memoized markdown renderer to avoid re-parsing on every drag
const MemoMarkdown = memo(function MemoMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        img: ({ src, ...props }) => (src ? <img src={src} {...props} /> : null),
        a: ({ href, children, ...props }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

const handleBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: "50%",
  background: "#0a0a0a",
  border: "1px solid #2a2a2a",
  color: "#555",
  fontSize: 11,
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  transition: "all 0.15s",
  fontFamily: "var(--font-geist-mono), monospace",
};

function ChatNodeInner({ id, data, selected }: NodeProps) {
  const { updateNodeData, getNode, getEdges, addNodes, addEdges, getZoom, deleteElements } = useReactFlow();
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messages = (data.messages as ChatMessage[]) || [];
  const isStreaming = (data.isStreaming as boolean) || false;
  const generatingImage = (data.generatingImage as boolean) || false;
  const searching = (data.searching as boolean) || false;
  const searchSources = (data.searchSources as string[]) || [];
  const imageUrls = (data.imageUrls as string[]) || [];
  const nodeWidth = (data.w as number) || 380;
  const nodeHeight = (data.h as number) || null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (selected) textareaRef.current?.focus();
  }, [selected]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [inputValue]);

  const getAttachedContext = useCallback((): ChatMessage[] => {
    const allEdges = getEdges();
    const context: ChatMessage[] = [];
    const visited = new Set<string>();

    // Recursively walk upstream through the graph
    function collectContext(nodeId: string, depth: number) {
      if (visited.has(nodeId) || depth > 10) return; // prevent cycles, cap depth
      visited.add(nodeId);

      const incoming = allEdges.filter((e) => e.target === nodeId);
      for (const edge of incoming) {
        // Collect upstream nodes first (furthest ancestor = earliest context)
        collectContext(edge.source, depth + 1);

        const sourceNode = getNode(edge.source);
        if (sourceNode?.type === "chat") {
          const srcMessages = (sourceNode.data.messages as ChatMessage[]) || [];
          if (srcMessages.length > 0) {
            context.push({
              role: "system",
              content: `[Context from attached conversation (depth ${depth})]:\n${srcMessages.map((m) => `${m.role}: ${m.content}`).join("\n")}`,
            });
          }
        }
      }
    }

    collectContext(id, 1);
    return context;
  }, [id, getEdges, getNode]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || isStreaming) return;

    const userMessage: ChatMessage = { role: "user", content: text };
    const newMessages = [...messages, userMessage];
    updateNodeData(id, { messages: newMessages, isStreaming: true });
    setInputValue("");

    const contextMessages = getAttachedContext();
    const allMessages = [...contextMessages, ...newMessages];
    let assistantContent = "";

    streamChat(
      allMessages,
      (chunk) => {
        assistantContent += chunk;
        const node = getNode(id);
        if (!node) return;
        const msgs = [...((node.data.messages as ChatMessage[]) || [])];
        if (msgs.length > 0 && msgs[msgs.length - 1].role === "assistant") {
          msgs[msgs.length - 1] = { role: "assistant", content: assistantContent };
        } else {
          msgs.push({ role: "assistant", content: assistantContent });
        }
        updateNodeData(id, { messages: msgs });
      },
      () => updateNodeData(id, { isStreaming: false }),
      (error) => {
        console.error("Chat error:", error);
        const node = getNode(id);
        if (!node) return;
        const msgs = [...((node.data.messages as ChatMessage[]) || [])];
        msgs.push({ role: "assistant", content: `Error: ${error.message}` });
        updateNodeData(id, { messages: msgs, isStreaming: false });
      },
      (type: ToolEventType, eventData?: string) => {
        // Image events
        if (type === "image_generating") {
          updateNodeData(id, { generatingImage: true });
        } else if (type === "image_result" && eventData) {
          const node = getNode(id);
          const existing = (node?.data.imageUrls as string[]) || [];
          updateNodeData(id, { imageUrls: [...existing, eventData], generatingImage: false });
        } else if (type === "image_error" && eventData) {
          const node = getNode(id);
          if (!node) return;
          const msgs = [...((node.data.messages as ChatMessage[]) || [])];
          msgs.push({ role: "assistant", content: `*Image error: ${eventData}*` });
          updateNodeData(id, { messages: msgs, generatingImage: false });
        }
        // Search events
        else if (type === "searching") {
          updateNodeData(id, { searching: true, searchSources: [] });
        } else if (type === "search_sources" && eventData) {
          try {
            const urls = JSON.parse(eventData) as string[];
            updateNodeData(id, { searchSources: urls });
          } catch { /* skip */ }
        } else if (type === "search_done") {
          updateNodeData(id, { searching: false });
        } else if (type === "search_error" && eventData) {
          const node = getNode(id);
          if (!node) return;
          const msgs = [...((node.data.messages as ChatMessage[]) || [])];
          msgs.push({ role: "assistant", content: `*Search error: ${eventData}*` });
          updateNodeData(id, { messages: msgs, searching: false });
        }
      }
    );
  }, [inputValue, isStreaming, messages, id, updateNodeData, getAttachedContext, getNode]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Delete node when Delete/Backspace pressed with empty input
    if ((e.key === "Delete" || e.key === "Backspace") && inputValue === "") {
      e.preventDefault();
      deleteElements({ nodes: [{ id }] });
    }
  };

  const handleBranch = () => {
    const node = getNode(id);
    if (!node) return;

    const newId = `chat-${Date.now()}`;
    addNodes({
      id: newId,
      type: "chat",
      position: { x: node.position.x + 460, y: node.position.y + 60 },
      data: { messages: [...messages], isStreaming: false },
    });
    addEdges({
      id: `e-${id}-${newId}`,
      source: id,
      sourceHandle: "context-out",
      target: newId,
      targetHandle: "context-in",
    });
  };

  const handleBranchFromMessage = (messageIndex: number) => {
    const branchedMessages = messages.slice(0, messageIndex + 1);
    const node = getNode(id);
    if (!node) return;

    const newId = `chat-${Date.now()}`;
    addNodes({
      id: newId,
      type: "chat",
      position: { x: node.position.x + 460, y: node.position.y },
      data: { messages: branchedMessages, isStreaming: false },
    });
    addEdges({
      id: `e-${id}-${newId}`,
      source: id,
      sourceHandle: "context-out",
      target: newId,
      targetHandle: "context-in",
    });
  };

  return (
    <div style={{ position: "relative", width: nodeWidth, minWidth: 280 }}>
      {/* Top button — I (input context) — has Handle overlaid for drag-to-connect */}
      <div
        className="nodrag nopan"
        style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}
      >
        <div style={{ ...handleBtn, position: "relative" }} title="Receive context (drag edge here)">
          I
          <Handle
            type="target"
            position={Position.Top}
            id="context-in"
            style={{
              position: "absolute",
              top: 0, left: 0,
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              background: "transparent",
              border: "none",
              transform: "none",
              cursor: "crosshair",
            }}
          />
        </div>
      </div>

      {/* Node body — border, no background */}
      <div
        style={{
          width: "100%",
          ...(nodeHeight ? { minHeight: nodeHeight } : {}),
          border: "1px solid #1e1e1e",
          borderRadius: 10,
          padding: "14px 16px",
          position: "relative",
        }}
      >
        {/* Resize handle — bottom right corner */}
        <div
          className="nodrag nopan"
          onPointerDown={(e) => {
            e.stopPropagation();
            const startX = e.clientX;
            const startY = e.clientY;
            const startW = nodeWidth;
            const startH = nodeHeight;

            const zoom = getZoom();
            const onMove = (ev: PointerEvent) => {
              const dw = (ev.clientX - startX) / zoom;
              const dh = (ev.clientY - startY) / zoom;
              const newW = Math.max(280, startW + dw);
              const newH = Math.max(80, startH + dh);
              updateNodeData(id, { w: newW, h: newH });
            };

            const onUp = () => {
              document.removeEventListener("pointermove", onMove);
              document.removeEventListener("pointerup", onUp);
            };

            document.addEventListener("pointermove", onMove);
            document.addEventListener("pointerup", onUp);
          }}
          style={{
            position: "absolute",
            right: 2,
            bottom: 2,
            width: 16,
            height: 16,
            cursor: "nwse-resize",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="9" y1="1" x2="1" y2="9" stroke="#2a2a2a" strokeWidth="1" />
            <line x1="9" y1="4" x2="4" y2="9" stroke="#2a2a2a" strokeWidth="1" />
            <line x1="9" y1="7" x2="7" y2="9" stroke="#2a2a2a" strokeWidth="1" />
          </svg>
        </div>

        {/* Drag handle — top bar */}
        <div
          className="drag-handle__custom"
          style={{
            height: 4,
            cursor: "grab",
            marginBottom: 10,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div style={{ width: 32, height: 3, borderRadius: 2, background: "#2a2a2a" }} />
        </div>

        {/* Messages */}
        <div
          className="nowheel nopan"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            maxHeight: 600,
            overflowY: "auto",
            padding: "4px 0",
          }}
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              onContextMenu={(e) => {
                e.preventDefault();
                handleBranchFromMessage(i);
              }}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                flexDirection: msg.role === "user" ? "row-reverse" : "row",
                cursor: "context-menu",
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: msg.role === "user" ? "#60a5fa" : "#888",
                  marginTop: 6,
                  flexShrink: 0,
                }}
              />
              <div
                className="chat-markdown"
                style={{
                  color: msg.role === "user" ? "#e0e8f0" : "#bbb",
                  fontSize: 13,
                  lineHeight: 1.6,
                  wordBreak: "break-word",
                  maxWidth: "85%",
                  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                }}
              >
                {msg.role === "assistant" ? (
                  <MemoMarkdown content={msg.content} />
                ) : (
                  <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
                )}
              </div>
            </div>
          ))}
          {/* Generated images */}
          {imageUrls.map((url, i) => (
            <div key={`img-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#888", marginTop: 6, flexShrink: 0 }} />
              <img
                src={url}
                alt="generated image"
                style={{ maxWidth: "85%", borderRadius: 8 }}
              />
            </div>
          ))}
          {/* Image generating placeholder */}
          {generatingImage && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#888", marginTop: 6, flexShrink: 0, animation: "pulse 1.5s infinite" }} />
              <div
                style={{
                  width: "85%",
                  height: 200,
                  background: "#1a1a1a",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  animation: "pulse 1.5s infinite",
                }}
              >
                <span style={{ color: "#555", fontSize: 12 }}>generating image...</span>
              </div>
            </div>
          )}
          {/* Searching indicator with favicons */}
          {searching && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#888", flexShrink: 0, animation: "pulse 1.5s infinite" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#666", fontSize: 13, animation: "pulse 1.5s infinite" }}>searching...</span>
                {searchSources.length > 0 && (
                  <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                    {searchSources.map((url, i) => {
                      try {
                        const domain = new URL(url).hostname;
                        return (
                          <img
                            key={i}
                            src={`https://www.google.com/s2/favicons?sz=16&domain=${domain}`}
                            alt={domain}
                            title={domain}
                            style={{ width: 14, height: 14, borderRadius: 2, opacity: 0.7 }}
                          />
                        );
                      } catch { return null; }
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
          {/* Streaming indicator */}
          {isStreaming && !generatingImage && !searching && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#888",
                  flexShrink: 0,
                  animation: "pulse 1.5s infinite",
                }}
              />
              <span style={{ color: "#666", fontSize: 13 }}>...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div
          className="nowheel nopan"
          style={{ marginTop: messages.length > 0 ? 16 : 0 }}
        >
          <div style={{ height: 1, background: "#2a2a2a", marginBottom: 12 }} />
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="message..."
            rows={1}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#aaa",
              fontSize: 13,
              fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
              resize: "none",
              lineHeight: 1.6,
              padding: 0,
              overflow: "hidden",
            }}
          />
        </div>
      </div>

      {/* Bottom buttons — O, Branch */}
      <div
        className="nodrag nopan"
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 8,
          marginTop: 8,
        }}
      >
        {/* O — output context — has Handle overlaid for drag-to-connect */}
        <div style={{ ...handleBtn, position: "relative" }} title="Send context (drag edge from here)">
          O
          <Handle
            type="source"
            position={Position.Bottom}
            id="context-out"
            style={{
              position: "absolute",
              top: 0, left: 0,
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              background: "transparent",
              border: "none",
              transform: "none",
              cursor: "crosshair",
            }}
          />
        </div>

        {/* Branch */}
        <div
          style={handleBtn}
          title="Branch conversation"
          onClick={handleBranch}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#a78bfa";
            e.currentTarget.style.color = "#a78bfa";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#2a2a2a";
            e.currentTarget.style.color = "#555";
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="4" cy="4" r="2" />
            <circle cx="12" cy="4" r="2" />
            <circle cx="4" cy="12" r="2" />
            <path d="M4 6v6M12 6c0 4-8 4-8 4" />
          </svg>
        </div>
      </div>
    </div>
  );
}

const ChatNode = memo(ChatNodeInner);
export default ChatNode;
