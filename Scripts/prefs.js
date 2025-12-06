//
// Preferences management for Java extension
//

const Config = require("./config.js");

function register() {
  nova.commands.register("java.preferences", (workspace) => {
    if (workspace) {
      nova.workspace.openConfig();
    }
  });

  nova.commands.register("java.extensionPreferences", (workspace) => {
    nova.openConfig();
  });
}

module.exports = {
  register,
};
