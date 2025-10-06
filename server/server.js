console.log("Orion LSP server iniciado"); // <-- Agrega esto arriba de todo

const {
	createConnection,
	TextDocuments,
	DiagnosticSeverity,
	CodeActionKind
} = require("vscode-languageserver/node");
const fs = require("fs");
const path = require("path");

const connection = createConnection();
const documents = new TextDocuments();

documents.listen(connection);

// Guardamos diagnósticos por documento para quick fixes
const documentDiagnostics = new Map();

// Carga docs.json al iniciar el servidor
const docsPath = path.join(__dirname, "../docs/docs.json");
let docs = {};
try {
    docs = JSON.parse(fs.readFileSync(docsPath, "utf8"));
} catch (e) {
    console.error("No se pudo cargar docs.json:", e);
}

// Función auxiliar para obtener la palabra bajo el cursor
function getWordAtPosition(document, position) {
    const line = document.getText({
        start: { line: position.line, character: 0 },
        end: { line: position.line + 1, character: 0 }
    });
    const regex = /\b\w+\b/g;
    let match;
    while ((match = regex.exec(line))) {
        if (match.index <= position.character && regex.lastIndex >= position.character) {
            return match[0];
        }
    }
    return null;
}

// Busca docstring y firma de función definida por el usuario
function findUserFunctionDoc(document, word) {
    const lines = document.getText().split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Soporta firmas con tipos y flechas
        const fnMatch = line.match(/^fn\s+(\w+)\s*\(([^)]*)\)(\s*->\s*\w+)?/);
        if (fnMatch && fnMatch[1] === word) {
            // Busca docstring multilínea arriba (soporta líneas vacías entre comentarios)
            let doc = "";
            let j = i - 1;
            while (j >= 0) {
                const prev = lines[j].trim();
                if (prev.startsWith("--")) {
                    doc = prev.replace(/^--\s?/, "") + "\n" + doc;
                    j--;
                } else if (prev === "") {
                    j--; // permite líneas vacías entre comentarios
                } else {
                    break;
                }
            }
            const signature = line;
            return { doc: doc.trim(), signature };
        }
    }
    return null;
}

connection.onInitialize(() => {
	return {
		capabilities: {
			textDocumentSync: documents.syncKind,
			codeActionProvider: true, //  habilitamos QuickFix
		},
	};
});

documents.onDidChangeContent((change) => {
	const text = change.document.getText();
	console.log("Texto recibido por LSP:", text);

	const diagnostics = [];
	const lines = text.split(/\r?\n/);
	const declaredVars = new Map();

	lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        // Si la línea parece un comentario pero no usa "--", marcar error
        if (
            (trimmed.startsWith("#") ||
             trimmed.startsWith("//") ||
             trimmed.startsWith(";") ||
             trimmed.startsWith("/") ||
             trimmed.startsWith("%"))
        ) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line: i, character: 0 },
                    end: { line: i, character: trimmed.length },
                },
                message: `Solo se permite '--' para comentarios en Orion.`,
                code: "invalid-comment",
                source: "orion-lsp",
            });
            return;
        }

        // Comentarios válidos
        if (trimmed.startsWith("--")) return;

        // Declaración con var/let
        if (trimmed.startsWith("var ") || trimmed.startsWith("let ")) {
            const parts = trimmed.split(/\s+/);
            const varName = parts[1];
            if (declaredVars.has(varName)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: { line: i, character: 0 },
                        end: { line: i, character: trimmed.length },
                    },
                    message: `Variable "${varName}" ya fue declarada.`,
                    code: "duplicate-var",
                    source: "orion-lsp",
                });
            } else {
                declaredVars.set(varName, { line: i, used: false });
            }
        }

        // Declaración implícita: x = ...
        else if (/^\w+\s*=/.test(trimmed)) {
            const varName = trimmed.split("=")[0].trim();
            if (!declaredVars.has(varName)) {
                declaredVars.set(varName, { line: i, used: false });
            } else {
                declaredVars.get(varName).used = true;
            }
        }

        // Si no es palabra clave válida → error
        else if (!/^(return|break|continue|import|show)\b/.test(trimmed)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line: i, character: 0 },
                    end: { line: i, character: trimmed.length },
                },
                message: `Sintaxis no válida: "${trimmed}".`,
                code: "invalid-syntax",
                source: "orion-lsp",
            });
        }
	});

	// Warning: variables no usadas
	declaredVars.forEach((info, name) => {
		if (!info.used) {
			diagnostics.push({
				severity: DiagnosticSeverity.Warning,
				range: {
					start: { line: info.line, character: 0 },
					end: { line: info.line, character: name.length },
				},
				message: `Variable "${name}" declarada pero nunca usada.`,
				code: "unused-var", // quick fix
				source: "orion-lsp",
			});
		}
	});

	// Guardamos diagnósticos para este doc
	documentDiagnostics.set(change.document.uri, diagnostics);
    console.log("Enviando diagnósticos:", diagnostics);
    connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
});

//  QuickFixes
connection.onCodeAction((params) => {
	const diagnostics = documentDiagnostics.get(params.textDocument.uri) || [];
	const actions = [];

	diagnostics.forEach((d) => {
		if (params.context.diagnostics.find((ctx) => ctx.message === d.message)) {
			// Variable duplicada → quitar "var"
			if (d.code === "duplicate-var") {
				actions.push({
					title: "Reemplazar 'var' por asignación",
					kind: CodeActionKind.QuickFix,
					edit: {
						changes: {
							[params.textDocument.uri]: [
								{
									range: d.range,
									newText: d.message.replace(/Variable.*$/, ""), // simplificado
								},
							],
						},
					},
				});
			}

			// Variable no usada → sugerir eliminar
			if (d.code === "unused-var") {
				actions.push({
					title: "Eliminar variable no usada",
					kind: CodeActionKind.QuickFix,
					edit: {
						changes: {
							[params.textDocument.uri]: [
								{ range: d.range, newText: "" },
							],
						},
					},
				});
			}

			// Sintaxis inválida → sugerir convertir a show
			if (d.code === "invalid-syntax") {
				actions.push({
					title: "Convertir en 'show'",
					kind: CodeActionKind.QuickFix,
					edit: {
						changes: {
							[params.textDocument.uri]: [
								{
									range: d.range,
									newText: "show " + d.message.match(/"(.+)"/)[1],
								},
							],
						},
					},
				});
			}
		}
	});

	return actions;
});

// Proveedor de hover robusto
connection.onHover((params) => {
    const document = documents.get(params.textDocument.uri);
    const word = getWordAtPosition(document, params.position);

    // 1. Busca en docs.json
    if (word && docs[word]) {
        const entry = docs[word];
        let md = `**${word}**\n\n`;
        if (entry.syntax) md += `\`\`\`orion\n${entry.syntax}\n\`\`\`\n`;
        if (entry.description) md += `${entry.description}\n`;
        return { contents: { kind: "markdown", value: md } };
    }

    // 2. Busca si es función definida por el usuario
    const userFn = findUserFunctionDoc(document, word);
    if (userFn) {
        let md = `**${word}**\n\n`;
        md += `\`\`\`orion\n${userFn.signature}\n\`\`\`\n`;
        if (userFn.doc) md += userFn.doc + "\n";
        return { contents: { kind: "markdown", value: md } };
    }

    // 3. (Opcional) Hover para variables: muestra la línea de declaración
    const lines = document.getText().split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (
            line.startsWith("let ") ||
            line.startsWith("var ") ||
            line.startsWith("const ")
        ) {
            const parts = line.split(/\s+/);
            if (parts[1] === word) {
                return {
                    contents: {
                        kind: "markdown",
                        value: `\`${line}\`\nDeclaración de variable.`
                    }
                };
            }
        }
    }

    return null;
});

connection.listen();
