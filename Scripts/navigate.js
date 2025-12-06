//
// Navigation commands (Jump to Definition, etc.)
//

const Lsp = require("./lsp.js");

function register() {
  nova.commands.register("java.jumpToDefinition", (editor) => {
    const client = Lsp.getClient();
    if (!client) {
      console.log("No language client available");
      return;
    }
    return client.sendRequest("textDocument/definition", {
      textDocument: { uri: editor.document.uri },
      position: {
        line: editor.selectedRange.start.line,
        character: editor.selectedRange.start.character,
      },
    });
  });

  nova.commands.register("java.jumpToTypeDefinition", (editor) => {
    const client = Lsp.getClient();
    if (!client) {
      console.log("No language client available");
      return;
    }
    return client.sendRequest("textDocument/typeDefinition", {
      textDocument: { uri: editor.document.uri },
      position: {
        line: editor.selectedRange.start.line,
        character: editor.selectedRange.start.character,
      },
    });
  });

  nova.commands.register("java.jumpToImplementation", (editor) => {
    const client = Lsp.getClient();
    if (!client) {
      console.log("No language client available");
      return;
    }
    return client.sendRequest("textDocument/implementation", {
      textDocument: { uri: editor.document.uri },
      position: {
        line: editor.selectedRange.start.line,
        character: editor.selectedRange.start.character,
      },
    });
  });
}

module.exports = {
  register,
};
