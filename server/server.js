const {
	createConnection,
	TextDocuments,
	DiagnosticSeverity,
	CodeActionKind
} = require("vscode-languageserver/node");

const connection = createConnection();
const documents = new TextDocuments();

documents.listen(connection);

// Guardamos diagnósticos por documento para quick fixes
const documentDiagnostics = new Map();

connection.onInitialize(() => {
	return {
		capabilities: {
			textDocumentSync: documents.syncKind,
			codeActionProvider: true, // 🚀 habilitamos QuickFix
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

		// Comentarios
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
					code: "duplicate-var", // 🚀 clave para quick fix
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
				code: "invalid-syntax", // 🚀 para quick fix
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
				code: "unused-var", // 🚀 quick fix
				source: "orion-lsp",
			});
		}
	});

	// Guardamos diagnósticos para este doc
	documentDiagnostics.set(change.document.uri, diagnostics);

	connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
});

// 🚀 QuickFixes
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

connection.listen();
