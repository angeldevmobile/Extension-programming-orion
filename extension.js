const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} = require('vscode-languageclient/node');

let client;

function activate(context) {
    console.log("Orion Extension Activated");

    // --- Inicializar el cliente LSP (maneja hover y completion automáticamente) ---
    const serverModule = context.asAbsolutePath(path.join("server", "server.js"));
    
    const serverOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] }
        }
    };

    const clientOptions = {
        documentSelector: [{ scheme: "file", language: "orion" }],
        synchronize: {
            configurationSection: 'orion',
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{orx,or,orion}')
        }
    };

    client = new LanguageClient(
        "orionLanguageServer",
        "Orion Language Server",
        serverOptions,
        clientOptions
    );

    // Iniciar el cliente LSP
    client.start();

    // --- Run Orion File Command (mejorado) ---
    const runOrion = vscode.commands.registerCommand('orion-lang.runOrionFile', function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const filePath = editor.document.fileName;
        const validExtensions = ['.orx', '.or', '.orion'];
        const isOrionFile = validExtensions.some(ext => filePath.endsWith(ext));

        if (!isOrionFile) {
            vscode.window.showErrorMessage('Not an Orion file');
            return;
        }

        // Guardar el archivo antes de ejecutar
        editor.document.save().then(() => {
            const pythonScript = 'C:/Users/lenovo/Desktop/ORION-LANGUAGE/src/main.py';
            const command = `python "${pythonScript}" "${filePath}"`;

            // Crear terminal para mostrar output en tiempo real
            const terminal = vscode.window.createTerminal({
                name: 'Orion Runner',
                shellPath: 'cmd.exe'
            });
            
            terminal.show();
            terminal.sendText(command);
        });
    });

    // --- Restart Language Server Command ---
    const restartCommand = vscode.commands.registerCommand('orion-lang.restartLanguageServer', async () => {
        if (client) {
            vscode.window.showInformationMessage('Reiniciando Orion Language Server...');
            await client.stop();
            await client.start();
            vscode.window.showInformationMessage('Orion Language Server reiniciado exitosamente');
        }
    });

    // --- Diagnostic Collection para errores adicionales ---
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('orion');
    context.subscriptions.push(diagnosticCollection);

    // --- Document Formatting Provider ---
    const formattingProvider = vscode.languages.registerDocumentFormattingEditProvider('orion', {
        provideDocumentFormattingEdits(document) {
            const edits = [];
            const text = document.getText();
            const lines = text.split('\n');

            let indentLevel = 0;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();
                
                if (trimmed === '') continue;
                if (trimmed.startsWith('--')) continue; // comentarios

                // Reducir indentación para }
                if (trimmed === '}') {
                    indentLevel = Math.max(0, indentLevel - 1);
                }

                const expectedIndent = '    '.repeat(indentLevel);
                if (line !== expectedIndent + trimmed) {
                    const range = new vscode.Range(i, 0, i, line.length);
                    edits.push(vscode.TextEdit.replace(range, expectedIndent + trimmed));
                }

                // Aumentar indentación después de {
                if (trimmed.endsWith('{')) {
                    indentLevel++;
                }
            }

            return edits;
        }
    });

    // --- Symbol Provider para outline ---
    const symbolProvider = vscode.languages.registerDocumentSymbolProvider('orion', {
        provideDocumentSymbols(document) {
            const symbols = [];
            const text = document.getText();
            const lines = text.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                // Detectar funciones
                const fnMatch = line.match(/^fn\s+(\w+)\s*\([^)]*\)/);
                if (fnMatch) {
                    const name = fnMatch[1];
                    const range = new vscode.Range(i, 0, i, line.length);
                    const symbol = new vscode.DocumentSymbol(
                        name,
                        'function',
                        vscode.SymbolKind.Function,
                        range,
                        range
                    );
                    symbols.push(symbol);
                }

                // Detectar variables
                const varMatch = line.match(/^(let|var|const)\s+(\w+)/);
                if (varMatch) {
                    const name = varMatch[2];
                    const range = new vscode.Range(i, 0, i, line.length);
                    const symbol = new vscode.DocumentSymbol(
                        name,
                        'variable',
                        vscode.SymbolKind.Variable,
                        range,
                        range
                    );
                    symbols.push(symbol);
                }
            }

            return symbols;
        }
    });

    // --- Status Bar Item ---
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(rocket) Orion";
    statusBarItem.tooltip = "Orion Language Support Active";
    statusBarItem.command = 'orion-lang.runOrionFile';
    statusBarItem.show();

    // --- Event Listeners ---
    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && editor.document.languageId === 'orion') {
            statusBarItem.text = "$(rocket) Orion Ready";
        } else {
            statusBarItem.text = "$(rocket) Orion";
        }
    });

    // Listener para errores del LSP
    client.onDidChangeState(event => {
        if (event.newState === 3) { // Running
            console.log('Orion Language Server is running');
        } else if (event.newState === 2) { // Starting
            console.log('Orion Language Server is starting');
        } else {
            console.log('Orion Language Server stopped');
        }
    });

    // --- Configuration Change Handler ---
    vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('orion')) {
            vscode.window.showInformationMessage('Configuración de Orion actualizada');
        }
    });

    // --- Registrar todos los providers y comandos ---
    context.subscriptions.push(
        runOrion,
        restartCommand,
        formattingProvider,
        symbolProvider,
        statusBarItem,
        diagnosticCollection
    );

    // Mensaje de activación
    vscode.window.showInformationMessage('¡Orion Language Support activado!');
}

function deactivate() {
    if (!client) {
        return undefined;
    }
    return client.stop();
}

module.exports = {
    activate,
    deactivate
};
