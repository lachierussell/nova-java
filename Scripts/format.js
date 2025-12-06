//
// Formatting support for Java
//

const Config = require("./config.js");
const State = require("./state.js");
const Lsp = require("./lsp.js");

function getConfig(key) {
  let value = nova.workspace?.config.get(key);
  if (value === null || value === undefined) {
    value = nova.config.get(key);
  }
  return value;
}

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

// Helper function to safely create a Range from LSP positions
function createRangeFromLSP(editor, lspRange) {
  try {
    const startLine = lspRange.start.line;
    const startChar = lspRange.start.character;
    const endLine = lspRange.end.line;
    const endChar = lspRange.end.character;
    
    // Basic validation: end must not precede start
    if (endLine < startLine || (endLine === startLine && endChar < startChar)) {
      console.warn(`Skipping invalid range: start(${startLine},${startChar}) end(${endLine},${endChar})`);
      return null;
    }
    
    // Convert LSP line/character positions to absolute offsets
    const startOffset = lspPositionToOffset(editor, startLine, startChar);
    const endOffset = lspPositionToOffset(editor, endLine, endChar);
    
    console.log(`Creating range: (${startLine},${startChar})->(${endLine},${endChar}) = offsets ${startOffset}->${endOffset}, newText length: ${arguments[1] ? 'N/A' : 'N/A'}`);
    
    // Validate offsets
    if (endOffset < startOffset) {
      console.error(`ERROR: endOffset ${endOffset} < startOffset ${startOffset} for LSP range (${startLine},${startChar})->(${endLine},${endChar})`);
      return null;
    }
    
    // Create range with absolute positions
    return new Range(startOffset, endOffset);
  } catch (err) {
    console.error(`Failed to create range: start(${lspRange.start.line},${lspRange.start.character}) end(${lspRange.end.line},${lspRange.end.character})`, err.message);
    return null;
  }
}

function formatWithLsp(editor) {
  const client = Lsp.getClient();
  if (!client) {
    console.log("No language client available for formatting");
    return Promise.reject(new Error("No LSP client available"));
  }

  return client.sendRequest("textDocument/formatting", {
    textDocument: { uri: editor.document.uri },
    options: {
      tabSize: editor.tabLength,
      insertSpaces: editor.softTabs,
    },
  }).then((edits) => {
    if (edits && edits.length > 0) {
      // Sort edits in reverse order (from end to start of document)
      // This prevents position shifts from earlier edits affecting later ones
      const sortedEdits = edits.slice().sort((a, b) => {
        if (a.range.start.line !== b.range.start.line) {
          return b.range.start.line - a.range.start.line;
        }
        return b.range.start.character - a.range.start.character;
      });
      
      editor.edit((edit) => {
        for (const change of sortedEdits) {
          const range = createRangeFromLSP(editor, change.range);
          if (range) {
            edit.replace(range, change.newText);
          }
        }
      });
    }
  }).catch((err) => {
    console.error("LSP format failed:", err);
    throw err;
  });
}

function formatWithSpotless(editor) {
  const workspacePath = nova.workspace.path;
  if (!workspacePath) {
    console.error("Cannot format: no workspace path");
    return Promise.reject(new Error("No workspace path"));
  }

  // Check if gradlew exists
  const gradlewPath = nova.path.join(workspacePath, "gradlew");
  if (!nova.fs.access(gradlewPath, nova.fs.F_OK)) {
    console.error("Gradle wrapper (gradlew) not found in workspace");
    return Promise.reject(new Error("gradlew not found"));
  }

  const filePath = editor.document.path;
  const relativePath = nova.path.relative(workspacePath, filePath);
  
  console.log(`Formatting ${relativePath} with Spotless...`);

  return new Promise((resolve, reject) => {
    const process = new Process("/usr/bin/env", {
      args: ["bash", gradlewPath, "spotlessApply"],
      cwd: workspacePath,
    });

    let output = "";
    let errorOutput = "";

    process.onStdout((line) => {
      output += line;
      console.log("Spotless:", line.trim());
    });

    process.onStderr((line) => {
      errorOutput += line;
      console.error("Spotless error:", line.trim());
    });

    process.onDidExit((status) => {
      if (status === 0) {
        console.log("Spotless formatting completed successfully");
        // Reload the file to show the changes
        // Note: The file has been modified on disk by Gradle
        // Nova will automatically detect and reload the file changes
        resolve();
      } else {
        console.error(`Spotless failed with status ${status}`);
        console.error("Error output:", errorOutput);
        reject(new Error(`Spotless exited with status ${status}`));
      }
    });

    try {
      process.start();
    } catch (err) {
      console.error("Failed to start Spotless process:", err);
      reject(err);
    }
  });
}

function formatDocument(editor) {
  const formatter = getConfig(Config.formatter) || "lsp";
  
  if (formatter === "spotless") {
    return formatWithSpotless(editor);
  } else {
    return formatWithLsp(editor);
  }
}

function organizeImports(editor) {
  const client = Lsp.getClient();
  if (!client) {
    console.log("No language client available");
    return;
  }

  // Request organize imports action
  client.sendRequest("textDocument/codeAction", {
    textDocument: { uri: editor.document.uri },
    range: {
      start: { line: 0, character: 0 },
      end: { line: editor.document.length, character: 0 },
    },
    context: {
      diagnostics: [],
      only: ["source.organizeImports"],
    },
  }).then((actions) => {
    if (actions && actions.length > 0) {
      // Execute the first organize imports action
      const action = actions[0];
      if (action.edit) {
        applyWorkspaceEdit(editor, action.edit);
      }
    }
  }).catch((err) => {
    console.error("Organize imports failed:", err);
  });
}

function applyWorkspaceEdit(editor, workspaceEdit) {
  if (!workspaceEdit.changes) {
    return;
  }

  const changes = workspaceEdit.changes[editor.document.uri];
  if (!changes || changes.length === 0) {
    return;
  }

  // Sort edits in reverse order (from end to start of document)
  // This prevents position shifts from earlier edits affecting later ones
  const sortedChanges = changes.slice().sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) {
      return b.range.start.line - a.range.start.line;
    }
    return b.range.start.character - a.range.start.character;
  });

  editor.edit((edit) => {
    for (const change of sortedChanges) {
      const range = createRangeFromLSP(editor, change.range);
      if (range) {
        edit.replace(range, change.newText);
      }
    }
  });
}

function register() {
  nova.commands.register("java.formatFile", (editor) => {
    formatDocument(editor);
  });

  nova.commands.register("java.organizeImports", (editor) => {
    organizeImports(editor);
  });

  // Format on save
  nova.workspace.onDidAddTextEditor((editor) => {
    editor.onWillSave((editor) => {
      if (editor.document.syntax !== "java") {
        return;
      }
      
      const formatOnSave = getConfig(Config.formatOnSave);
      if (formatOnSave === true) {
        formatDocument(editor);
      }
    });
  });
}

module.exports = {
  register,
};
