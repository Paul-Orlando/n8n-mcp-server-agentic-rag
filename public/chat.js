// Chat history for multi-turn context (sent to backend)
let history = [];
let isStreaming = false;

const chatWindow = document.getElementById("chatWindow");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

// ── Reset / New Chat ──────────────────────────────────────────────────────────
function resetChat() {
  history = [];
  chatWindow.innerHTML = '';
  const welcome = document.createElement("div");
  welcome.id = "welcome";
  welcome.className = "welcome";
  welcome.innerHTML = `
    <div class="welcome-icon">🎓</div>
    <h2>Course Assistant</h2>
    <p class="welcome-desc">Ask any question about the <strong>Introduction to GenAI Concepts</strong> course. Select one of the starter questions below or type your own inquiry about GenAI topics.</p>
    <div class="suggestions">
      <button class="suggestion" onclick="sendSuggestion(this)">What topics are covered in this course?</button>
      <button class="suggestion" onclick="sendSuggestion(this)">How do I build an AI agent with n8n?</button>
      <button class="suggestion" onclick="sendSuggestion(this)">What is a reasoning model?</button>
    </div>
    <p class="welcome-hint">💡 You can also ask about context engineering, agentic workflows, RAG, MCP, and more.</p>
  `;
  chatWindow.appendChild(welcome);
  messageInput.value = "";
  messageInput.style.height = "auto";
  messageInput.focus();
}

// ── Send a suggestion chip ────────────────────────────────────────────────────
function sendSuggestion(btn) {
  messageInput.value = btn.textContent;
  sendMessage();
}

// ── Auto-resize textarea ──────────────────────────────────────────────────────
function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

// ── Enter to send (Shift+Enter for newline) ───────────────────────────────────
function handleKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ── Append a message bubble to the chat window ────────────────────────────────
function appendMessage(role, text) {
  const welcome = document.getElementById("welcome");
  if (welcome) welcome.style.display = "none";

  const wrap = document.createElement("div");
  wrap.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "👤" : "⚡";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  chatWindow.appendChild(wrap);
  scrollToBottom();
  return bubble;
}

// ── Append a typing/status indicator ─────────────────────────────────────────
function appendTyping() {
  const welcome = document.getElementById("welcome");
  if (welcome) welcome.style.display = "none";

  const wrap = document.createElement("div");
  wrap.className = "message ai";
  wrap.id = "typingIndicator";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = "⚡";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const dots = document.createElement("div");
  dots.className = "typing";
  dots.innerHTML = "<span></span><span></span><span></span>";

  const status = document.createElement("div");
  status.className = "status-text";
  status.id = "statusText";

  bubble.appendChild(dots);
  bubble.appendChild(status);
  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  chatWindow.appendChild(wrap);
  scrollToBottom();
  return { wrap, status };
}

function removeTyping() {
  const el = document.getElementById("typingIndicator");
  if (el) el.remove();
}

function scrollToBottom() {
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// ── Main send function ────────────────────────────────────────────────────────
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isStreaming) return;

  isStreaming = true;
  sendBtn.disabled = true;
  messageInput.value = "";
  messageInput.style.height = "auto";

  appendMessage("user", text);
  const { wrap: typingWrap, status: statusEl } = appendTyping();

  let aiBubble = null;
  let fullResponse = "";

  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history }),
    });

    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.startsWith("event:")) continue;

        if (line.startsWith("data:")) {
          const raw = line.slice(5).trim();
          let eventType = "chunk";

          const eventLine = lines[lines.indexOf(line) - 1];
          if (eventLine && eventLine.startsWith("event:")) {
            eventType = eventLine.slice(6).trim();
          }

          try {
            const payload = JSON.parse(raw);

            if (eventType === "status") {
              statusEl.textContent = payload;
            } else if (eventType === "chunk") {
              if (!aiBubble) {
                removeTyping();
                const wrap = document.createElement("div");
                wrap.className = "message ai";
                const avatar = document.createElement("div");
                avatar.className = "avatar";
                avatar.textContent = "⚡";
                aiBubble = document.createElement("div");
                aiBubble.className = "bubble";
                wrap.appendChild(avatar);
                wrap.appendChild(aiBubble);
                chatWindow.appendChild(wrap);
              }
              fullResponse += payload;
              aiBubble.textContent = fullResponse;
              scrollToBottom();
            } else if (eventType === "error") {
              removeTyping();
              const wrap = document.createElement("div");
              wrap.className = "message ai";
              const avatar = document.createElement("div");
              avatar.className = "avatar";
              avatar.textContent = "⚡";
              const errBubble = document.createElement("div");
              errBubble.className = "bubble error-bubble";
              errBubble.textContent = "Error: " + payload;
              wrap.appendChild(avatar);
              wrap.appendChild(errBubble);
              chatWindow.appendChild(wrap);
              scrollToBottom();
            }
          } catch {
            // skip unparseable lines
          }
        }
      }
    }

    if (fullResponse) {
      history.push({ role: "user", content: text });
      history.push({ role: "assistant", content: fullResponse });
      if (history.length > 20) history = history.slice(-20);
    }

  } catch (err) {
    removeTyping();
    const wrap = document.createElement("div");
    wrap.className = "message ai";
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "⚡";
    const errBubble = document.createElement("div");
    errBubble.className = "bubble error-bubble";
    errBubble.textContent = "Connection error: " + err.message;
    wrap.appendChild(avatar);
    wrap.appendChild(errBubble);
    chatWindow.appendChild(wrap);
    scrollToBottom();
  } finally {
    isStreaming = false;
    sendBtn.disabled = false;
    messageInput.focus();
  }
}
