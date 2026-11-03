// Runs inside the chat sidebar. Draws messages and talks to extension.js.
(function () {
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById("messages");
  const welcomeEl = document.getElementById("welcome");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const jumpBtn = document.getElementById("jump");
  const folderEl = document.getElementById("folder");

  // Saved by VS Code so the chat survives reloads.
  let messages = (vscode.getState() || {}).messages || [];
  let streaming = false;
  let liveEl = null; // the bot message currently being streamed
  let renderQueued = false;

  const save = () => vscode.setState({ messages });

  const FOLDER_ICON =
    '<svg class="icon" viewBox="0 0 16 16"><path d="M1.5 4h5L8 5.5h6.5V13h-13z"/></svg>';

  // ---------- Markdown (just the parts chat replies use) ----------

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  }

  // One tool step, e.g. "Editing calc.py": a status dot, the verb, the target.
  function toolRow(text) {
    const space = text.indexOf(" ");
    const verb = space === -1 ? text : text.slice(0, space);
    const target = space === -1 ? "" : text.slice(space + 1);
    return `<div class="tool"><span class="dot"></span><span class="verb">${verb}</span>` +
      `<span class="target" title="${target}">${target}</span></div>`;
  }

  function renderText(text) {
    let out = "";
    let list = null;
    let para = [];
    let inSteps = false; // consecutive tool lines share one box
    const flushPara = () => {
      if (para.length) out += `<p>${inline(para.join("<br>"))}</p>`;
      para = [];
    };
    const closeList = () => {
      if (list) out += `</${list}>`;
      list = null;
    };
    const closeSteps = () => {
      if (inSteps) out += "</div>";
      inSteps = false;
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
        continue; // blank lines don't end a group of tool steps
      }
      if ((m = line.match(/^\[tool\] (.*)/))) {
        flushPara();
        closeList();
        if (!inSteps) out += '<div class="steps">';
        inSteps = true;
        out += toolRow(m[1]);
        continue;
      }
      closeSteps();
      if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
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
    closeSteps();
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
              <button class="text-btn" data-action="copy" title="Copy code">Copy</button>
              <button class="text-btn" data-action="insert" title="Insert at cursor">Insert</button>
            </span>
          </div>
          <pre><code>${escapeHtml(code)}</code></pre>
        </div>`;
      })
      .join("");
  }

  // ---------- Drawing ----------

  const THINKING = `<div class="thinking">Thinking…</div>`;

  function messageEl(msg) {
    const el = document.createElement("div");
    el.className = `msg ${msg.role}`;
    el.innerHTML =
      msg.role === "bot"
        ? `<span class="actions"><button class="text-btn" data-action="copy-reply" title="Copy reply">Copy</button></span>
           <div class="body"></div>`
        : `<div class="body"></div>`;
    fill(el, msg);
    return el;
  }

  function fill(el, msg) {
    const body = el.querySelector(".body");
    if (msg.role === "user") {
      body.textContent = msg.text;
      return;
    }
    if (msg.role === "error") {
      body.innerHTML = renderText(msg.text);
      return;
    }
    if (!msg.text) {
      body.innerHTML = THINKING;
      return;
    }
    body.innerHTML = renderMarkdown(msg.text);

    // While a reply is still coming in and the newest thing is a tool step,
    // that step is still running: its dot pulses until something follows it.
    const live = el === liveEl && streaming;
    const lastLine = msg.text.trimEnd().split("\n").pop();
    if (live && lastLine.startsWith("[tool] ")) {
      const tools = body.querySelectorAll(".tool");
      tools[tools.length - 1].classList.add("running");
    }
  }

  function nearBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  }

  function scrollDown() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
    jumpBtn.hidden = true;
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

  // The reply as plain text, without the tool-step lines.
  function replyText(msg) {
    return msg.text.split("\n").filter((l) => !l.startsWith("[tool] ")).join("\n").trim();
  }

  // ---------- Sending ----------

  function send(text) {
    text = text.trim();
    if (!text || streaming) return;
    add({ role: "user", text });
    setStreaming(true);
    liveEl = add({ role: "bot", text: "" });
    save();
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

  messagesEl.addEventListener("scroll", () => {
    jumpBtn.hidden = nearBottom();
  });
  jumpBtn.addEventListener("click", scrollDown);

  function flash(button, label) {
    const before = button.textContent;
    button.textContent = label;
    setTimeout(() => (button.textContent = before), 1500);
  }

  document.addEventListener("click", (e) => {
    const suggestion = e.target.closest(".suggestion");
    if (suggestion) send(suggestion.dataset.prompt);

    const action = e.target.closest("[data-action]");
    if (!action) return;
    const kind = action.dataset.action;

    if (kind === "copy-reply") {
      const index = [...messagesEl.querySelectorAll(".msg")].indexOf(action.closest(".msg"));
      const msg = messages[index];
      if (msg) vscode.postMessage({ type: "copy", code: replyText(msg) });
      flash(action, "Copied");
      return;
    }

    const code = action.closest(".code").querySelector("code").textContent;
    vscode.postMessage({ type: kind, code });
    flash(action, kind === "copy" ? "Copied" : "Inserted");
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
          else jumpBtn.hidden = false;
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
      setStreaming(false);
      if (liveEl && final?.role === "bot") fill(liveEl, final);
      liveEl = null;
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
    } else if (msg.type === "folder") {
      folderEl.innerHTML = `${FOLDER_ICON}<span></span>`;
      folderEl.querySelector("span").textContent = msg.name || "No folder open: chat only";
      folderEl.classList.toggle("warn", !msg.name);
      folderEl.title = msg.name
        ? `Maham Code reads and edits files in ${msg.name}`
        : "Use File > Open Folder so Maham Code can read and create files";
    }
  });

  renderAll();
  vscode.postMessage({ type: "ready" });
})();
