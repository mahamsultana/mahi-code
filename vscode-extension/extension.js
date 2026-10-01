// VS Code face. Deliberately dumb: it forwards text to server.py and shows the reply.
// All the UI lives in media/ (main.js + main.css); this file is the bridge.
const vscode = require("vscode");

const SERVER = "http://localhost:8765";

class ChatViewProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    this.view = null;
    this.controller = null; // lets the Stop button cancel a reply
    this.pending = null; // a question waiting for the view to finish loading
  }

  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.getHtml(view.webview);

    view.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "ready" && this.pending) {
        this.post({ type: "ask", text: this.pending });
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
        body: JSON.stringify({ message: text }),
        signal: this.controller.signal,
      });
      if (!res.ok) throw new Error(`The server answered with error ${res.status}.`);

      // Read the streamed reply and pass each piece to the webview.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.post({ type: "chunk", text: decoder.decode(value, { stream: true }) });
      }
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

  async insert(code) {
    const editor = vscode.window.activeTextEditor || vscode.window.visibleTextEditors[0];
    if (!editor) {
      vscode.window.showWarningMessage("Open a file first, then click Insert.");
      return;
    }
    await editor.edit((edit) => edit.replace(editor.selection, code));
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
      <div class="logo">M</div>
      <h2>Maham Code</h2>
      <p>Ask about code, get explanations, or have it write something for you.</p>
      <div class="suggestions">
        <button class="suggestion">Explain Python generators simply</button>
        <button class="suggestion">Write a function that checks if a string is a palindrome</button>
        <button class="suggestion">What's the difference between a list and a tuple?</button>
      </div>
    </section>
  </main>
  <footer>
    <div class="composer">
      <textarea id="input" rows="1" placeholder="Ask Maham Code..."></textarea>
      <button id="send" title="Send (Enter)" aria-label="Send">
        <svg class="icon-send" viewBox="0 0 16 16"><path d="M1.7 14.3 15 8 1.7 1.7l.9 5.1L10 8l-7.4 1.2z"/></svg>
        <svg class="icon-stop" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/></svg>
      </button>
    </div>
    <div class="hint">Enter to send · Shift+Enter for a new line</div>
  </footer>
  <script nonce="${nonce}" src="${uri("main.js")}"></script>
</body>
</html>`;
  }
}

function activate(context) {
  const provider = new ChatViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("mahamCode.chat", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),

    vscode.commands.registerCommand("mahamCode.newChat", () => provider.newChat()),

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
