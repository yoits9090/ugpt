export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export type ToolEventType = "image_generating" | "image_result" | "image_error" | "searching" | "search_sources" | "search_done" | "search_error";

export async function streamChat(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  onToolEvent?: (type: ToolEventType, data?: string) => void
) {
  try {
    const res = await fetch(`${API_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            onDone();
            return;
          }
          try {
            const parsed = JSON.parse(data);

            // Tool events
            if (parsed.type === "image_generating") {
              onToolEvent?.("image_generating", parsed.prompt);
              continue;
            }
            if (parsed.type === "image_result") {
              onToolEvent?.("image_result", parsed.url);
              continue;
            }
            if (parsed.type === "image_error") {
              onToolEvent?.("image_error", parsed.error);
              continue;
            }
            if (parsed.type === "searching") {
              onToolEvent?.("searching", parsed.query);
              continue;
            }
            if (parsed.type === "search_sources") {
              onToolEvent?.("search_sources", JSON.stringify(parsed.urls));
              continue;
            }
            if (parsed.type === "search_done") {
              onToolEvent?.("search_done");
              continue;
            }
            if (parsed.type === "search_error") {
              onToolEvent?.("search_error", parsed.error);
              continue;
            }

            const content = parsed.choices?.[0]?.delta?.content;
            if (content) onChunk(content);
          } catch {
            // skip malformed chunks
          }
        }
      }
    }
    onDone();
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}
