const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');

let docs = {};
let client;

function activate(context) {
  console.log("Orion Extension Activated");

  // --- Inicializar el cliente LSP ---
  const serverModule = context.asAbsolutePath(path.join("server", "server.js"));
  const serverOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc }
  };
  const clientOptions = {
    documentSelector: [{ scheme: "file", language: "orion" }]
  };
  client = new LanguageClient("orionLSP", "Orion Language Server", serverOptions, clientOptions);
  client.start();

  // --- Load docs.json ---
  const docsPath = path.join(context.extensionPath, "docs", "docs.json");
  if (fs.existsSync(docsPath)) {
    try {
      docs = JSON.parse(fs.readFileSync(docsPath, "utf8"));
      console.log("Loaded Orion docs.json");
    } catch (err) {
      console.error("Error loading docs.json:", err);
    }
  }

  // --- Autocomplete Provider ---
  const provider = vscode.languages.registerCompletionItemProvider(
    "orion",
    {
      provideCompletionItems(document, position) {
        const suggestions = [];

        // Create completion items from docs.json
        for (const [keyword, info] of Object.entries(docs)) {
          const item = new vscode.CompletionItem(
            keyword,
            vscode.CompletionItemKind.Keyword
          );

          item.detail = info.syntax || "Orion keyword";
          item.documentation = new vscode.MarkdownString(info.description);

          // If it's a snippet (function, control structure, etc.)
          if (info.syntax && info.syntax.includes("(")) {
            item.kind = vscode.CompletionItemKind.Function;
          }

          suggestions.push(item);
        }

        // Extra snippets
        const mainSnippet = new vscode.CompletionItem("main", vscode.CompletionItemKind.Function);
        mainSnippet.insertText = new vscode.SnippetString("fn main() {\n\t$0\n}");
        mainSnippet.documentation = "Main entry point of the program";
        suggestions.push(mainSnippet);

        const ifElseSnippet = new vscode.CompletionItem("ifelse", vscode.CompletionItemKind.Snippet);
        ifElseSnippet.insertText = new vscode.SnippetString("if (${1:condition}) {\n\t$0\n} else {\n\t\n}");
        ifElseSnippet.documentation = "If/Else conditional structure";
        suggestions.push(ifElseSnippet);

        return suggestions;
      }
    },
    "" // empty trigger → always suggest
  );

  // --- Hover Provider ---
  const hoverProvider = vscode.languages.registerHoverProvider("orion", {
    provideHover(document, position) {
      const range = document.getWordRangeAtPosition(position);
      const word = document.getText(range);

      if (docs[word]) {
        const info = docs[word];
        const md = new vscode.MarkdownString();
        // Syntax as code block (top, like Python signature)
        md.appendCodeblock(info.syntax || word, "orion");
        // Separator line
        md.appendMarkdown('\n---\n');
        // Description as Markdown paragraph
        md.appendMarkdown(info.description ? info.description : "");
        md.isTrusted = true;
        return new vscode.Hover(md, range);
      }
      return null;
    }
  });

  // --- Run Orion File Command ---
  let runOrion = vscode.commands.registerCommand('orion-lang.runOrionFile', function () {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active editor');
      return;
    }
    const filePath = editor.document.fileName;
    if (!filePath.endsWith('.orx')) {
      vscode.window.showErrorMessage('Not an Orion file');
      return;
    }
    const pythonScript = 'C:/Users/lenovo/Desktop/ORION-LANGUAGE/src/main.py';
    const command = `python "${pythonScript}" "${filePath}"`;

    cp.exec(command, (err, stdout, stderr) => {
      if (err) {
        vscode.window.showErrorMessage(`Error: ${stderr}`);
        return;
      }
      vscode.window.showInformationMessage(`Output: ${stdout}`);
    });
  });

  context.subscriptions.push(provider, hoverProvider, runOrion);
}

function deactivate() {
  if (!client) return undefined;
  return client.stop();
}

module.exports = {
  activate,
  deactivate
};
