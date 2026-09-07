/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode-ai/plugin/tui";
import { SubagentSection } from "./SubagentSection";

export default Plugin.define({
  id: "opencode-subagents-tui",
  setup(context) {
    return context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => <SubagentSection sessionID={sessionID} />,
    });
  },
});
