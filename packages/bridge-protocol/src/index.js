'use strict';

// @88snooker/bridge-protocol — schemas shared by the Shop PC (ai-bridge) and the Cloud hub.
// Spec: docs/ai-assistant/BRIDGE_PROTOCOL.md §4–7. Safety: docs/ai-assistant/SAFETY_RULES.md.

module.exports = {
  ...require('./primitives'),
  ...require('./envelope'),
  ...require('./snapshot'),
  ...require('./approval'),
  ...require('./messages'),
  ...require('./parser'),
};
