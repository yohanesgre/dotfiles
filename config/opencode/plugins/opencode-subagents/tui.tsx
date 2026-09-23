/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { SubagentSection } from "./SubagentSection";

export default Plugin.define({
  id: "opencode-subagents-tui",
  setup(context) {
    const sidebar = context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => (
        <SubagentSection
          sessionID={sessionID}
          data={context.data}
          client={context.client}
          theme={context.theme}
          dialog={context.ui.dialog}
        />
      ),
    });
    return sidebar;
  },
});
