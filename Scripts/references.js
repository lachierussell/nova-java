//
// Find References support
//

const State = require("./state.js");
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

class ReferencesProvider {
  constructor() {
    this.treeView = null;
  }

  findReferences(editor) {
    const client = Lsp.getClient();
    if (!client) {
      console.log("No language client available");
      return;
    }

    client.sendRequest("textDocument/references", {
      textDocument: { uri: editor.document.uri },
      position: {
        line: editor.selectedRange.start.line,
        character: editor.selectedRange.start.character,
      },
      context: {
        includeDeclaration: true,
      },
    }).then((locations) => {
      this.showReferences(locations);
    }).catch((err) => {
      console.error("Find references failed:", err);
    });
  }

  showReferences(locations) {
    if (!locations || locations.length === 0) {
      nova.workspace.showInformativeMessage("No references found");
      return;
    }

    // Get or create the sidebar tree view
    if (!this.treeView) {
      this.treeView = nova.workspace.addTreeView("java.sidebar.references", {
        dataProvider: this,
      });
    }

    this.locations = locations;
    if (this.treeView) {
      this.treeView.reload();
    }

    // Show the sidebar
    nova.workspace.showSidebar("java.sidebar");
  }

  getChildren(element) {
    if (!element) {
      // Root level - return all locations
      return this.locations || [];
    }
    return [];
  }

  getTreeItem(element) {
    const item = new TreeItem(element.uri);
    item.descriptiveText = `Line ${element.range.start.line + 1}`;
    item.command = "java.openReference";
    item.identifier = `${element.uri}:${element.range.start.line}:${element.range.start.character}`;
    return item;
  }
}

const provider = new ReferencesProvider();

function register() {
  nova.commands.register("java.findReferences", (editor) => {
    provider.findReferences(editor);
  });

  nova.commands.register("java.openReference", (location) => {
    nova.workspace.openFile(location.uri).then((editor) => {
      const startOffset = lspPositionToOffset(editor, location.range.start.line, location.range.start.character);
      const endOffset = lspPositionToOffset(editor, location.range.end.line, location.range.end.character);
      const range = new Range(startOffset, endOffset);
      editor.selectedRange = range;
      editor.scrollToPosition(range.start);
    });
  });
}

module.exports = {
  register,
};
