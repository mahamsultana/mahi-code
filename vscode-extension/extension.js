// VS Code face. Deliberately dumb: it forwards text to server.py and shows the reply.
// All the UI lives in media/ (main.js + main.css); this file is the bridge.
const vscode = require("vscode");

const SERVER = "http://localhost:8765";

// One row on the welcome screen: clicking it sends the prompt.
function suggestion(label, sub, prompt) {
  return `<button class="suggestion" data-prompt="${prompt.replace(/"/g, "&quot;")}">
    <span class="label">${label}</span><span class="sub">${sub}</span>
  </button>`;
}

class ChatViewProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    this.view = null;
    this.controller = null; // lets the Stop button cancel a reply
    this.pending = null; // a question waiting for the view to finish loading
    this.lastEditor = vscode.window.activeTextEditor; // where Insert puts code
  }

  // The folder the assistant works in: the first one open in this window.
  folder() {
    return vscode.workspace.workspaceFolders?.[0];
  }

  sendFolder() {
    this.post({ type: "folder", name: this.folder()?.name || null });
  }

  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.getHtml(view.webview);

    view.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "ready") {
        this.sendFolder();
        if (this.pending) this.post({ type: "ask", text: this.pending });
        this.pending = null;
      } else if (msg.type === "send") this.chat(msg.text);
      else if (msg.type === "stop") this.controller?.abort();
      else if (msg.type === "newChat") this.newChat();
      else if (msg.type === "copy") {
        vscode.env.clipboard.writeText(msg.code);
        vscode.window.setStatusBarMessage("Copied to clipboard", 2000);
      } else if (msg.type === "insert") this.insert(msg.code);
    });
  }

  post(msg) {
    this.view?.webview.postMessage(msg);
  }

  async chat(text) {
    this.controller = new AbortController();
    try {
      const res = await fetch(`${SERVER}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Tell the brain which folder to work in: the one open in this window.
        body: JSON.stringify({ message: text, root: this.folder()?.uri.fsPath }),
        signal: this.controller.signal,
      });
      if (!res.ok) throw new Error(`The server answered with error ${res.status}.`);

      // Read the streamed reply and pass each piece to the webview.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let reply = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        reply += chunk;
        this.post({ type: "chunk", text: chunk });
      }
      await this.openWrittenFile(reply);
    } catch (err) {
      if (err.name !== "AbortError") {
        const offline = err.cause?.code === "ECONNREFUSED" || err.message === "fetch failed";
        this.post({
          type: "error",
          text: offline
            ? "Can't reach the server. Run `py server.py` in the mahi-code folder, then try again."
            : err.message,
        });
      }
    }
    this.controller = null;
    this.post({ type: "done" });
  }

  async newChat() {
    this.controller?.abort();
    this.post({ type: "clear" });
    try {
      await fetch(`${SERVER}/reset`, { method: "POST" });
    } catch {
      // Server is down; nothing to reset.
    }
  }

  async ask(text) {
    // Open the sidebar first. If it was never opened, wait for "ready".
    await vscode.commands.executeCommand("mahamCode.chat.focus");
    if (this.view) this.post({ type: "ask", text });
    else this.pending = text;
  }

  // After the assistant changes files: close tabs of files it renamed away, and
  // show the last file it created, edited or renamed, so you can see the result.
  async openWrittenFile(reply) {
    const folder = this.folder();
    if (!folder) return;
    const uri = (path) => vscode.Uri.joinPath(folder.uri, path.trim());

    const renamedAway = [...reply.matchAll(/^\[tool\] Renaming (.+) to .+$/gm)].map((m) => uri(m[1]).fsPath);
    const staleTabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => renamedAway.includes(tab.input?.uri?.fsPath));
    if (staleTabs.length) await vscode.window.tabGroups.close(staleTabs);

    const changed = [...reply.matchAll(/^\[tool\] (?:(?:Writing|Editing) (.+)|Renaming .+ to (.+))$/gm)];
    if (!changed.length) return;
    const last = changed[changed.length - 1];
    try {
      await vscode.window.showTextDocument(uri(last[1] || last[2]), { preview: false });
    } catch {
      // The change failed (the reply explains why), so there's nothing to open.
    }
  }

  async insert(code) {
    // Clicking in the sidebar moves focus away from your file, so use the
    // last file you were editing. No file open? Put the code in a new tab.
    const editor = vscode.window.visibleTextEditors.includes(this.lastEditor) ? this.lastEditor : null;
    if (!editor) {
      const doc = await vscode.workspace.openTextDocument({ content: code });
      await vscode.window.showTextDocument(doc);
      return;
    }
    await editor.edit((edit) => edit.replace(editor.selection, code));
    await vscode.window.showTextDocument(editor.document, editor.viewColumn);
  }

  getHtml(webview) {
    const uri = (file) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", file));
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${uri("main.css")}">
</head>
<body>
  <main id="messages">
    <section id="welcome">
      <svg class="mark" viewBox="0 0 128 128" aria-hidden="true">
        <path d="M24 96V32l28 34 28-34v64" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="94" y="86" width="22" height="10" rx="2" fill="currentColor" opacity="0.5"/>
      </svg>
      <h2>What are we working on?</h2>
      <p class="tagline">Maham Code can read, search, edit and create files in this folder.</p>
      <div class="suggestions">
        ${suggestion("Explain this project", "Structure and purpose",
          "Look through this project and explain what it does and how it's organized.")}
        ${suggestion("Create a file", "hello.py that prints a greeting", "Create hello.py that prints a greeting")}
        ${suggestion("Find TODOs", "Search every file", "Search the project for TODO comments and list them.")}
        ${suggestion("Ask a question", "Python generators, simply", "Explain Python generators simply")}
      </div>
    </section>
  </main>
  <footer>
    <button id="jump" title="Scroll to latest" aria-label="Scroll to latest" hidden>
      <svg class="icon" viewBox="0 0 16 16"><path d="M8 3v10M4 9l4 4 4-4"/></svg>
    </button>
    <div class="composer">
      <textarea id="input" rows="1" placeholder="Ask Maham Code..."></textarea>
      <button id="send" title="Send (Enter)" aria-label="Send">
        <svg class="icon-send" viewBox="0 0 16 16"><path d="M1.7 14.3 15 8 1.7 1.7l.9 5.1L10 8l-7.4 1.2z"/></svg>
        <svg class="icon-stop" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/></svg>
      </button>
    </div>
    <div class="meta">
      <span id="folder" class="chip"></span>
      <span class="keys">Enter to send · Shift+Enter new line</span>
    </div>
  </footer>
  <script nonce="${nonce}" src="${uri("main.js")}"></script>
</body>
</html>`;
  }
}

function activate(context) {
  const provider = new ChatViewProvider(context.extensionUri);

  // A status bar button, so the chat is one click away even if the sidebar icon is hidden.
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = "$(comment-discussion) Maham Code";
  statusItem.tooltip = "Open Maham Code";
  statusItem.command = "mahamCode.open";
  statusItem.show();
  context.subscriptions.push(statusItem);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("mahamCode.chat", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),

    vscode.commands.registerCommand("mahamCode.open", () => vscode.commands.executeCommand("mahamCode.chat.focus")),

    vscode.commands.registerCommand("mahamCode.newChat", () => provider.newChat()),

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) provider.lastEditor = editor;
    }),

    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.sendFolder()),

    vscode.commands.registerCommand("mahamCode.askSelection", () => {
      const editor = vscode.window.activeTextEditor;
      const code = editor?.document.getText(editor.selection);
      if (!code) return;
      const file = vscode.workspace.asRelativePath(editor.document.uri);
      const lang = editor.document.languageId;
      provider.ask(`Explain this code from ${file}:\n\n\`\`\`${lang}\n${code}\n\`\`\``);
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
