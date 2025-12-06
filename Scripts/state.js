//
// Global state management for Java extension
//

const events = {
  onActivate: "onActivate",
  onDeactivate: "onDeactivate",
};

const emitter = new Emitter();
const disposal = new CompositeDisposable();

module.exports = {
  events,
  emitter,
  disposal,
};
