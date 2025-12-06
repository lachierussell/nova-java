//
// Rename Symbol support
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

function register() {
  nova.commands.register("java.renameSymbol", (editor) => {
    const client = Lsp.getClient();
    if (!client) {
      console.log("No language client available");
      return;
    }

    // Get current word
    const range = editor.selectedRange;
    const position = {
      line: range.start.line,
      character: range.start.character,
    };

    // Show input panel for new name
    nova.workspace.showInputPanel(
      "Rename Symbol",
      { prompt: "Enter new name:" },
      (newName) => {
        if (!newName) {
          return;
        }

        client.sendRequest("textDocument/rename", {
          textDocument: { uri: editor.document.uri },
          position: position,
          newName: newName,
        }).then((workspaceEdit) => {
          if (workspaceEdit) {
            applyWorkspaceEdit(workspaceEdit);
          }
        }).catch((err) => {
          console.error("Rename failed:", err);
          nova.workspace.showErrorMessage(`Rename failed: ${err.message}`);
        });
      }
    );
  });
}

function applyWorkspaceEdit(workspaceEdit) {
  if (!workspaceEdit.changes) {
    return;
  }

  // Apply changes to each document
  for (const [uri, changes] of Object.entries(workspaceEdit.changes)) {
    nova.workspace.openFile(uri).then((editor) => {
      editor.edit((edit) => {
        // Apply changes in reverse order to maintain positions
        const sortedChanges = changes.sort((a, b) => {
          if (a.range.start.line !== b.range.start.line) {
            return b.range.start.line - a.range.start.line;
          }
          return b.range.start.character - a.range.start.character;
        });

        for (const change of sortedChanges) {
          const startOffset = lspPositionToOffset(editor, change.range.start.line, change.range.start.character);
          const endOffset = lspPositionToOffset(editor, change.range.end.line, change.range.end.character);
          const range = new Range(startOffset, endOffset);
          edit.replace(range, change.newText);
        }
      });
    });
  }
}

module.exports = {
  register,
};
