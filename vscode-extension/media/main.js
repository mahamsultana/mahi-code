// Runs inside the chat sidebar. Draws messages and talks to extension.js.
(function () {
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById("messages");
  const welcomeEl = document.getElementById("welcome");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("send");

  // Saved by VS Code so the chat survives reloads.
  let messages = (vscode.getState() || {}).messages || [];
  let streaming = false;
  let liveEl = null; // the bot message currently being streamed
  let renderQueued = false;

  const save = () => vscode.setState({ messages });

  // ---------- Markdown (just the parts chat replies use) ----------

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }

  function renderText(text) {
    let out = "";
    let list = null;
    let para = [];
    const flushPara = () => {
      if (para.length) out += `<p>${inline(para.join("<br>"))}</p>`;
      para = [];
    };
    const closeList = () => {
      if (list) out += `</${list}>`;
      list = null;
    };
    const openList = (type) => {
      if (list !== type) {
        closeList();
        out += `<${type}>`;
        list = type;
      }
    };

    for (const line of escapeHtml(text).split("\n")) {
      let m;
      if (!line.trim()) {
        flushPara();
        closeList();
      } else if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
        flushPara();
        closeList();
        const level = m[1].length + 2;
        out += `<h${level}>${inline(m[2])}</h${level}>`;
      } else if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
        flushPara();
        openList("ul");
        out += `<li>${inline(m[1])}</li>`;
      } else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) {
        flushPara();
        openList("ol");
        out += `<li>${inline(m[1])}</li>`;
      } else {
        closeList();
        para.push(line);
      }
    }
    flushPara();
    closeList();
    return out;
  }

  function renderMarkdown(src) {
    // Odd pieces between ``` fences are code. An unclosed fence while
    // streaming still renders as code, which is what we want.
    return src
      .split("```")
      .map((part, i) => {
        if (i % 2 === 0) return renderText(part);
        const nl = part.indexOf("\n");
        const lang = nl === -1 ? "" : part.slice(0, nl).trim();
        const code = (nl === -1 ? part : part.slice(nl + 1)).replace(/\n$/, "");
        return `<div class="code">
          <div class="code-head">
            <span>${escapeHtml(lang) || "code"}</span>
            <span class="code-actions">
              <button data-action="copy">Copy</button>
              <button data-action="insert">Insert</button>
            </span>
          </div>
          <pre><code>${escapeHtml(code)}</code></pre>
        </div>`;
      })
      .join("");
  }

  // ---------- Drawing ----------

  function messageEl(msg) {
    const el = document.createElement("div");
    el.className = `msg ${msg.role}`;
    el.innerHTML =
      msg.role === "bot"
        ? `<div class="who">Maham Code</div><div class="body"></div>`
        : `<div class="body"></div>`;
    fill(el, msg);
    return el;
  }

  function fill(el, msg) {
    const body = el.querySelector(".body");
    if (msg.role === "user") body.textContent = msg.text;
    else if (msg.role === "error") body.innerHTML = renderText(msg.text);
    else if (!msg.text) body.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;
    else body.innerHTML = renderMarkdown(msg.text);
  }

  function nearBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  }

  function scrollDown() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderAll() {
    messagesEl.querySelectorAll(".msg").forEach((el) => el.remove());
    welcomeEl.hidden = messages.length > 0;
    for (const msg of messages) messagesEl.appendChild(messageEl(msg));
    scrollDown();
  }

  function add(msg) {
    messages.push(msg);
    welcomeEl.hidden = true;
    const el = messageEl(msg);
    messagesEl.appendChild(el);
    scrollDown();
    return el;
  }

  function setStreaming(on) {
    streaming = on;
    document.body.classList.toggle("streaming", on);
    sendBtn.title = on ? "Stop" : "Send (Enter)";
    sendBtn.setAttribute("aria-label", on ? "Stop" : "Send");
  }

  // ---------- Sending ----------

  function send(text) {
    text = text.trim();
    if (!text || streaming) return;
    add({ role: "user", text });
    liveEl = add({ role: "bot", text: "" });
    save();
    setStreaming(true);
    vscode.postMessage({ type: "send", text });
  }

  function sendInput() {
    send(input.value);
    input.value = "";
    autosize();
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
  }

  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendInput();
    }
  });

  sendBtn.addEventListener("click", () => {
    if (streaming) vscode.postMessage({ type: "stop" });
    else sendInput();
    input.focus();
  });

  document.addEventListener("click", (e) => {
    const suggestion = e.target.closest(".suggestion");
    if (suggestion) send(suggestion.textContent);

    const action = e.target.closest("[data-action]");
    if (action) {
      const code = action.closest(".code").querySelector("code").textContent;
      vscode.postMessage({ type: action.dataset.action, code });
      if (action.dataset.action === "copy") {
        action.textContent = "Copied";
        setTimeout(() => (action.textContent = "Copy"), 1500);
      }
    }
  });

  // ---------- Messages from extension.js ----------

  window.addEventListener("message", (e) => {
    const msg = e.data;
    const last = messages[messages.length - 1];

    if (msg.type === "chunk" && last?.role === "bot") {
      last.text += msg.text;
      // Redraw at most once per frame so long replies stay smooth.
      if (!renderQueued) {
        renderQueued = true;
        requestAnimationFrame(() => {
          renderQueued = false;
          const stick = nearBottom();
          if (liveEl) fill(liveEl, last);
          if (stick) scrollDown();
        });
      }
    } else if (msg.type === "error") {
      if (last?.role === "bot" && !last.text) {
        messages.pop();
        liveEl?.remove();
        liveEl = null;
      }
      add({ role: "error", text: msg.text });
    } else if (msg.type === "done") {
      const final = messages[messages.length - 1];
      if (final?.role === "bot" && !final.text) final.text = "(stopped)";
      if (liveEl && final?.role === "bot") fill(liveEl, final);
      liveEl = null;
      setStreaming(false);
      save();
    } else if (msg.type === "clear") {
      messages = [];
      liveEl = null;
      setStreaming(false);
      save();
      renderAll();
      input.focus();
    } else if (msg.type === "ask") {
      send(msg.text);
    }
  });

  renderAll();
  vscode.postMessage({ type: "ready" });
})();
