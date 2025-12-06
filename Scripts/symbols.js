//
// Find Symbols support
//

const Lsp = require("./lsp.js");

// Helper function to convert LSP line/character position to absolute character position
function lspPositionToOffset(editor, line, character) {
  const doc = editor.document;
  
  // Read the document text by iterating through each character position
  // until we've counted enough newlines
  let offset = 0;
  let currentLine = 0;
  let pos = 0;
  
  // Read in chunks and count newlines until we reach the target line
  const chunkSize = 1000;
  
  while (currentLine < line) {
    try {
      const chunk = doc.getTextInRange(new Range(pos, pos + chunkSize));
      if (!chunk || chunk.length === 0) {
        // Reached end of document
        break;
      }
      
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === '\n') {
          currentLine++;
          if (currentLine === line) {
            // Found the start of our target line
            offset = pos + i + 1; // +1 to move past the newline
            break;
          }
        }
      }
      
      if (currentLine === line) {
        break;
      }
      
      pos += chunk.length;
    } catch (e) {
      console.error("Error reading document:", e);
      break;
    }
  }
  
  // Add the character position within the target line
  return offset + character;
}

class SymbolsProvider {
  constructor() {
    this.treeView = null;
  }

  findSymbols() {
    const editor = nova.workspace.activeTextEditor;
    if (!editor) {
      return;
    }

    const client = Lsp.getClient();
    if (!client) {
      console.log("No language client available");
      return;
    }

    // Request workspace symbols
    nova.workspace.showInputPanel(
      "Find Symbol",
      { prompt: "Enter symbol name:" },
      (query) => {
        if (!query) {
          return;
        }

        client.sendRequest("workspace/symbol", {
          query: query,
        }).then((symbols) => {
          this.showSymbols(symbols);
        }).catch((err) => {
          console.error("Find symbols failed:", err);
        });
      }
    );
  }

  showSymbols(symbols) {
    if (!symbols || symbols.length === 0) {
      nova.workspace.showInformativeMessage("No symbols found");
      return;
    }

    // Get or create the sidebar tree view
    if (!this.treeView) {
      this.treeView = nova.workspace.addTreeView("java.sidebar.symbols", {
        dataProvider: this,
      });
    }

    this.symbols = symbols;
    if (this.treeView) {
      this.treeView.reload();
    }

    // Show the sidebar
    nova.workspace.showSidebar("java.sidebar");
  }

  getChildren(element) {
    if (!element) {
      return this.symbols || [];
    }
    return [];
  }

  getTreeItem(element) {
    const item = new TreeItem(element.name);
    item.descriptiveText = element.containerName || "";
    item.command = "java.openSymbol";
    item.identifier = `${element.location.uri}:${element.name}`;
    return item;
  }
}

const provider = new SymbolsProvider();

function register() {
  nova.commands.register("java.findSymbols", () => {
    provider.findSymbols();
  });

  nova.commands.register("java.openSymbol", (symbol) => {
    nova.workspace.openFile(symbol.location.uri).then((editor) => {
      const startOffset = lspPositionToOffset(editor, symbol.location.range.start.line, symbol.location.range.start.character);
      const endOffset = lspPositionToOffset(editor, symbol.location.range.end.line, symbol.location.range.end.character);
      const range = new Range(startOffset, endOffset);
      editor.selectedRange = range;
      editor.scrollToPosition(range.start);
    });
  });
}

module.exports = {
  register,
};
