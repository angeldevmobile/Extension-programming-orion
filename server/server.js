console.log("Orion LSP server iniciado");

const {
    createConnection,
    TextDocuments,
    DiagnosticSeverity,
    ProposedFeatures,
    CompletionItemKind,
    MarkupKind,
    CodeActionKind,
    DiagnosticTag,
} = require("vscode-languageserver/node");

const { TextDocument } = require("vscode-languageserver-textdocument");
const fs = require("fs");
const path = require("path");

// Crear conexión con todas las capacidades
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

documents.listen(connection);

// Guardamos diagnósticos y símbolos por documento
const documentDiagnostics = new Map();
const documentSymbols = new Map();

// Carga docs.json al iniciar el servidor
const docsPath = path.join(__dirname, "../docs/docs.json");
let docs = {};
try {
    docs = JSON.parse(fs.readFileSync(docsPath, "utf8"));
    console.log("docs.json cargado exitosamente");
    console.log("Palabras clave disponibles:", Object.keys(docs));
} catch (e) {
    console.error("No se pudo cargar docs.json:", e);
}

// Clase para análisis semántico y sintáctico mejorada
class OrionAnalyzer {
    constructor() {
        this.symbols = new Map();
        this.scopes = ["global"];
        this.usedVariables = new Set();
        // Patrones de sintaxis dinámicos
        this.patterns = {
            function: /^fn\s+(\w+)\s*\(([^)]*)\)(\s*->\s*(\w+))?/,
            variable: /^(let|var|const)\s+(\w+)(\s*:\s*(\w+))?\s*=/,
            assignment: /^(\w+)\s*=/,
            call: /(\w+)\s*\(/g,
            usage: /\b(\w+)\b/g,
        };
        // Nuevos patrones para análisis sintáctico
        this.syntaxPatterns = {
            brackets: {
                open: /[\(\[\{]/g,
                close: /[\)\]\}]/g,
            },
            strings: {
                double: /"([^"\\]|\\.)*"/g,
                single: /'([^'\\]|\\.)*'/g,
                unclosedDouble: /"([^"\\]|\\.)*$/,
                unclosedSingle: /'([^'\\]|\\.)*$/,
            },
            controlFlow: {
                if: /^if\s+.+\s*\{?$/,
                else: /^else\s*\{?$/,
                while: /^while\s+.+\s*\{?$/,
                for: /^for\s+.+\s*\{?$/,
            },
            declarations: {
                invalidFunction: /^fn\s+(\w+)?\s*\([^)]*$/,
                invalidVariable: /^(let|var|const)\s*$/,
                invalidAssignment: /^\w+\s*=\s*$/,
            }
        };
    }

    // Análisis completamente dinámico
    analyze(document) {
        this.symbols.clear();
        this.usedVariables.clear();
        const text = document.getText();
        const lines = text.split(/\r?\n/);

        // Fase 1: Detectar declaraciones automáticamente
        this.detectDeclarations(lines);

        // Fase 2: Detectar uso de símbolos
        this.detectUsage(lines);

        // Fase 3: Analizar tipos y scope
        this.analyzeTypes(lines);

        return this.symbols;
    }

    // NUEVO: Análisis sintáctico completo
    analyzeSyntax(document) {
        const text = document.getText();
        const lines = text.split(/\r?\n/);
        const diagnostics = [];

        // Stack para rastrear paréntesis/corchetes/llaves
        const bracketStack = [];
        const bracketMap = { '(': ')', '[': ']', '{': '}' };
        const openBrackets = ['(', '[', '{'];
        const closeBrackets = [')', ']', '}'];

        lines.forEach((line, lineIndex) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('--') || !trimmed) return;

            // 1. Verificar paréntesis/corchetes/llaves balanceados
            this.checkBracketBalance(line, lineIndex, bracketStack, diagnostics);

            // 2. Verificar strings sin cerrar
            this.checkUnclosedStrings(line, lineIndex, diagnostics);

            // 3. Verificar declaraciones malformadas
            this.checkMalformedDeclarations(line, lineIndex, diagnostics);

            // 4. Verificar estructuras de control
            this.checkControlStructures(line, lineIndex, lines, diagnostics);

            // 5. Verificar sintaxis de funciones
            this.checkFunctionSyntax(line, lineIndex, diagnostics);

            // 6. Verificar operadores y expresiones
            this.checkOperatorsAndExpressions(line, lineIndex, diagnostics);

            // 7. Verificar palabras clave inválidas
            this.checkInvalidKeywords(line, lineIndex, diagnostics);
        });

        // Verificar brackets no cerrados al final del documento
        bracketStack.forEach(bracket => {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line: bracket.line, character: bracket.character },
                    end: { line: bracket.line, character: bracket.character + 1 }
                },
                message: `"${bracket.char}" no fue cerrado`,
                code: "unclosed-bracket",
                source: "orion-syntax"
            });
        });

        return diagnostics;
    }

    // Verificar balance de paréntesis/corchetes/llaves
    checkBracketBalance(line, lineIndex, bracketStack, diagnostics) {
        const bracketMap = { '(': ')', '[': ']', '{': '}' };
        const openBrackets = ['(', '[', '{'];
        const closeBrackets = [')', ']', '}'];

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (openBrackets.includes(char)) {
                bracketStack.push({
                    char: char,
                    line: lineIndex,
                    character: i,
                    expected: bracketMap[char]
                });
            } else if (closeBrackets.includes(char)) {
                if (bracketStack.length === 0) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: { line: lineIndex, character: i },
                            end: { line: lineIndex, character: i + 1 }
                        },
                        message: `"${char}" inesperado - no hay "${this.getMatchingOpen(char)}" correspondiente`,
                        code: "unmatched-bracket",
                        source: "orion-syntax"
                    });
                } else {
                    const lastOpen = bracketStack.pop();
                    if (lastOpen.expected !== char) {
                        diagnostics.push({
                            severity: DiagnosticSeverity.Error,
                            range: {
                                start: { line: lineIndex, character: i },
                                end: { line: lineIndex, character: i + 1 }
                            },
                            message: `Se esperaba "${lastOpen.expected}" pero se encontró "${char}"`,
                            code: "mismatched-bracket",
                            source: "orion-syntax"
                        });
                    }
                }
            }
        }
    }

    // Verificar strings sin cerrar
    checkUnclosedStrings(line, lineIndex, diagnostics) {
        if (this.syntaxPatterns.strings.unclosedDouble.test(line)) {
            const match = line.match(/"[^"]*$/);
            if (match) {
                const startPos = line.lastIndexOf('"');
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: { line: lineIndex, character: startPos },
                        end: { line: lineIndex, character: line.length }
                    },
                    message: 'String sin cerrar - falta comilla doble de cierre',
                    code: "unclosed-string",
                    source: "orion-syntax"
                });
            }
        }
        if (this.syntaxPatterns.strings.unclosedSingle.test(line)) {
            const match = line.match(/'[^']*$/);
            if (match) {
                const startPos = line.lastIndexOf("'");
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: { line: lineIndex, character: startPos },
                        end: { line: lineIndex, character: line.length }
                    },
                    message: 'String sin cerrar - falta comilla simple de cierre',
                    code: "unclosed-string",
                    source: "orion-syntax"
                });
            }
        }
    }

    // Verificar declaraciones malformadas
    checkMalformedDeclarations(line, lineIndex, diagnostics) {
        const trimmed = line.trim();
        if (this.syntaxPatterns.declarations.invalidFunction.test(trimmed)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line: lineIndex, character: 0 },
                    end: { line: lineIndex, character: line.length }
                },
                message: 'Declaración de función incompleta - faltan paréntesis de cierre',
                code: "incomplete-function",
                source: "orion-syntax"
            });
        }
        if (this.syntaxPatterns.declarations.invalidVariable.test(trimmed)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line: lineIndex, character: 0 },
                    end: { line: lineIndex, character: line.length }
                },
                message: 'Declaración de variable incompleta - falta nombre de variable',
                code: "incomplete-variable",
                source: "orion-syntax"
            });
        }
        if (this.syntaxPatterns.declarations.invalidAssignment.test(trimmed)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line: lineIndex, character: 0 },
                    end: { line: lineIndex, character: line.length }
                },
                message: 'Asignación incompleta - falta valor',
                code: "incomplete-assignment",
                source: "orion-syntax"
            });
        }
    }

    // Verificar estructuras de control
    checkControlStructures(line, lineIndex, lines, diagnostics) {
        const trimmed = line.trim();
        if (trimmed === 'if' || trimmed === 'if {') {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line: lineIndex, character: 0 },
                    end: { line: lineIndex, character: line.length }
                },
                message: 'Estructura if incompleta - falta condición',
                code: "incomplete-if",
                source: "orion-syntax"
            });
        }
        if (trimmed === 'while' || trimmed === 'while {') {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line: lineIndex, character: 0 },
                    end: { line: lineIndex, character: line.length }
                },
                message: 'Estructura while incompleta - falta condición',
                code: "incomplete-while",
                source: "orion-syntax"
            });
        }
    }

    // Verificar sintaxis de funciones
    checkFunctionSyntax(line, lineIndex, diagnostics) {
        const trimmed = line.trim();
        if (trimmed.match(/^fn\s*\(/)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line: lineIndex, character: 0 },
                    end: { line: lineIndex, character: line.length }
                },
                message: 'Función sin nombre - las funciones deben tener un identificador',
                code: "unnamed-function",
                source: "orion-syntax"
            });
        }
    }

    // Verificar operadores y expresiones
    checkOperatorsAndExpressions(line, lineIndex, diagnostics) {
        const trimmed = line.trim();
        if (trimmed.match(/[+\-*\/=<>!&|]+$/)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line: lineIndex, character: line.length - 1 },
                    end: { line: lineIndex, character: line.length }
                },
                message: 'Operador incompleto - falta operando',
                code: "incomplete-operator",
                source: "orion-syntax"
            });
        }
        if ((trimmed.match(/=/g) || []).length > 1 && !trimmed.includes('==') && !trimmed.includes('!=')) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line: lineIndex, character: 0 },
                    end: { line: lineIndex, character: line.length }
                },
                message: 'Múltiples asignaciones en una línea no permitidas',
                code: "multiple-assignment",
                source: "orion-syntax"
            });
        }
    }

    // Verificar palabras clave inválidas  
    checkInvalidKeywords(line, lineIndex, diagnostics) {
        const invalidKeywords = ['#', '//', ';', '%', 'print(', 'console.log', 'cout', 'printf'];
        const trimmed = line.trim();
        invalidKeywords.forEach(invalid => {
            if (trimmed.includes(invalid)) {
                let suggestion = '';
                switch(invalid) {
                    case '#':
                    case '//':
                    case ';':
                    case '%':
                        suggestion = 'Usa -- para comentarios';
                        break;
                    case 'print(':
                    case 'console.log':
                    case 'cout':
                    case 'printf':
                        suggestion = 'Usa show() en Orion';
                        break;
                }
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: { line: lineIndex, character: line.indexOf(invalid) },
                        end: { line: lineIndex, character: line.indexOf(invalid) + invalid.length }
                    },
                    message: `"${invalid}" no es válido en Orion. ${suggestion}`,
                    code: "invalid-syntax",
                    source: "orion-syntax"
                });
            }
        });
    }

    // Función auxiliar para obtener paréntesis de apertura correspondiente
    getMatchingOpen(closeBracket) {
        const map = { ')': '(', ']': '[', '}': '{' };
        return map[closeBracket] || '';
    }

    // Métodos para generar hover dinámico
    generateDynamicHover(symbol) {
        let md = `**${symbol.name}**\n\n`;

        if (symbol.type === "function") {
            md += `\`\`\`orion\n${symbol.signature}\n\`\`\`\n`;
            if (symbol.documentation) {
                md += `\n${symbol.documentation}\n`;
            }
            md += `\n📍 Definida en línea ${symbol.line + 1}`;
        } else {
            md += `\`\`\`orion\n${symbol.keyword || "let"} ${symbol.name}: ${
                symbol.dataType
            }\n\`\`\`\n`;
            md += `Variable ${symbol.mutable ? "mutable" : "inmutable"}${
                symbol.implicit ? " (implícita)" : ""
            }\n`;
            md += `\n📍 Definida en línea ${symbol.line + 1}`;
            if (!symbol.used) {
                md += `\n⚠️ Variable no utilizada`;
            }
        }

        return md;
    }

    // AJUSTADO PARA TU ESTRUCTURA DE docs.json
    generateBuiltinHover(word, entry) {
        let md = `**${word}**\n\n`;
        
        if (entry.syntax) {
            md += `\`\`\`orion\n${entry.syntax}\n\`\`\`\n\n`;
        }
        
        if (entry.description) {
            md += `${entry.description}\n\n`;
        }
        
        // Manejar parámetros si existen
        if (entry.params) {
            md += `**Parámetros:**\n`;
            if (typeof entry.params === 'object') {
                Object.entries(entry.params).forEach(([param, desc]) => {
                    md += `- \`${param}\`: ${desc}\n`;
                });
            } else if (Array.isArray(entry.params)) {
                entry.params.forEach((param) => {
                    md += `- \`${param}\`\n`;
                });
            }
            md += `\n`;
        }
        
        if (entry.returns) {
            md += `**Retorna:** ${entry.returns}\n\n`;
        }
        
        if (entry.example) {
            md += `**Ejemplo:**\n\`\`\`orion\n${entry.example}\n\`\`\`\n`;
        }
        
        return md;
    }
}

const analyzer = new OrionAnalyzer();

// Función auxiliar para obtener la palabra bajo el cursor
function getWordAtPosition(document, position) {
    const line = document.getText({
        start: { line: position.line, character: 0 },
        end: { line: position.line + 1, character: 0 },
    });

    console.log("Línea completa:", JSON.stringify(line));
    console.log("Posición character:", position.character);

    const beforeCursor = line.substring(0, position.character);
    const afterCursor = line.substring(position.character);

    const beforeMatch = beforeCursor.match(/[\w]+$/);
    const afterMatch = afterCursor.match(/^[\w]*/);

    const before = beforeMatch ? beforeMatch[0] : "";
    const after = afterMatch ? afterMatch[0] : "";

    const word = before + after;
    console.log("Palabra extraída:", JSON.stringify(word));

    return word;
}

// Función para obtener contexto de completado
function getCompletionContext(document, position) {
    const line = document.getText({
        start: { line: position.line, character: 0 },
        end: { line: position.line, character: position.character },
    });

    const fullLine = document.getText({
        start: { line: position.line, character: 0 },
        end: { line: position.line + 1, character: 0 },
    });

    // Detectar si estamos después de un punto (acceso a miembro)
    if (line.match(/\w+\.\w*$/)) {
        return { type: "member", object: line.match(/(\w+)\.\w*$/)[1] };
    }

    // Detectar si estamos en parámetros de función
    if (line.match(/\w+\([^)]*$/)) {
        return { type: "function_params" };
    }

    return { type: "general", line: fullLine };
}

// Inicialización del servidor
connection.onInitialize((params) => {
    console.log("Inicializando servidor Orion LSP");
    return {
        capabilities: {
            textDocumentSync: 1,
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: [".", "(", " ", "\n"],
            },
            hoverProvider: true,
            codeActionProvider: true,
            definitionProvider: true,
            documentSymbolProvider: true,
        },
    };
});

// Análisis cuando el documento cambia - EXPANDIDO
documents.onDidChangeContent((change) => {
    const text = change.document.getText();
    console.log("Analizando documento:", change.document.uri);

    // Análisis semántico
    const symbols = analyzer.analyze(change.document);
    documentSymbols.set(change.document.uri, symbols);

    // NUEVO: Análisis sintáctico completo
    const syntaxDiagnostics = analyzer.analyzeSyntax(change.document);

    // Diagnósticos existentes + nuevos sintácticos
    const diagnostics = [...syntaxDiagnostics];
    const lines = text.split(/\r?\n/);

    lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        // Comentarios inválidos (existente)
        if (trimmed.match(/^(#|\/\/|;|%)/)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line: i, character: 0 },
                    end: { line: i, character: trimmed.length },
                },
                message: `Solo se permite '--' para comentarios en Orion. Usa: -- ${trimmed.replace(
                    /^[#\/;%]+\s*/,
                    ""
                )}`,
                code: "invalid-comment",
                source: "orion-lsp",
                tags: [DiagnosticTag.Unnecessary],
            });
        }

        // NUEVO: Verificar variables no definidas
        const words = trimmed.match(/\b\w+\b/g) || [];
        words.forEach(word => {
            if (!docs[word] && !symbols.has(word) && !['if', 'else', 'while', 'for', 'return', 'true', 'false'].includes(word)) {
                const wordIndex = line.indexOf(word);
                const nextChar = line[wordIndex + word.length];
                if (nextChar !== '(' && !trimmed.startsWith(`let ${word}`) && !trimmed.startsWith(`var ${word}`) && !trimmed.startsWith(`const ${word}`)) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: {
                            start: { line: i, character: wordIndex },
                            end: { line: i, character: wordIndex + word.length }
                        },
                        message: `'${word}' no está definido`,
                        code: "undefined-variable",
                        source: "orion-semantic"
                    });
                }
            }
        });
    });

    documentDiagnostics.set(change.document.uri, diagnostics);
    connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
});

// Completado automático
connection.onCompletion((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const context = getCompletionContext(document, params.position);
    console.log("Generando completados para contexto:", context.type);

    const completions = analyzer.getCompletions(context, context.line || "");
    console.log("Completados generados:", completions.length);

    return completions;
});

// Hover mejorado - AJUSTADO PARA TU ESTRUCTURA
connection.onHover((params) => {
    console.log("=== HOVER REQUEST ===");
    console.log("URI:", params.textDocument.uri);
    console.log("Position:", params.position);
    
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        console.log("❌ No se encontró documento");
        return null;
    }

    const word = getWordAtPosition(document, params.position);
    if (!word) {
        console.log("❌ No se encontró palabra en posición");
        return null;
    }

    console.log("Hover para palabra:", word);

    // 1. Buscar en símbolos del documento (dinámico)
    const symbols = documentSymbols.get(params.textDocument.uri) || new Map();
    console.log("Símbolos disponibles:", Array.from(symbols.keys()));
    
    if (symbols.has(word)) {
        const symbol = symbols.get(word);
        console.log("✅ Encontrado símbolo:", symbol);
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: analyzer.generateDynamicHover(symbol),
            },
        };
    }

    // 2. Buscar en docs.json (estructura plana)
    console.log("Keywords disponibles:", Object.keys(docs));
    if (docs[word]) {
        const entry = docs[word];
        console.log("✅ Encontrado en docs.json:", entry);
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: analyzer.generateBuiltinHover(word, entry),
            },
        };
    }

    console.log("❌ No se encontró información para:", word);
    return null;
});

// Quick fixes y otros handlers (código anterior...)
connection.onCodeAction((params) => {
    // Implementación de code actions...
    return [];
});

connection.onDocumentSymbol((params) => {
    const symbols = documentSymbols.get(params.textDocument.uri) || new Map();
    const documentSymbols_result = [];

    symbols.forEach((symbol, name) => {
        documentSymbols_result.push({
            name: name,
            kind: symbol.type === "function" ? 12 : 13,
            range: {
                start: { line: symbol.line, character: 0 },
                end: { line: symbol.line, character: name.length },
            },
            selectionRange: {
                start: { line: symbol.line, character: 0 },
                end: { line: symbol.line, character: name.length },
            },
            detail: symbol.type === "function" ? 
                `${symbol.params.map((p) => `${p.name}: ${p.type}`).join(", ")} -> ${symbol.returnType}` :
                symbol.dataType,
        });
    });

    return documentSymbols_result;
});

connection.listen();