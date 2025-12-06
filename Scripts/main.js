//
// Main entry point for Java extension
//

const Prefs = require("./prefs.js");
const Lsp = require("./lsp.js");
const Format = require("./format.js");
const Navigate = require("./navigate.js");
const References = require("./references.js");
const Symbols = require("./symbols.js");
const Rename = require("./rename.js");
const State = require("./state.js");

exports.activate = async function () {
  console.log("Java extension activating...");
  
  Prefs.register();
  Format.register();
  Navigate.register();
  References.register();
  Symbols.register();
  Rename.register();
  Lsp.register();

  // Kick off activation
  State.emitter.emit(State.events.onActivate);
  
  console.log("Java extension activated");
};

exports.deactivate = function () {
  console.log("Java extension deactivating...");
  State.disposal.dispose();
  State.emitter.emit(State.events.onDeactivate);
};
