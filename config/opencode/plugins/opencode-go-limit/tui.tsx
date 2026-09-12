/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { GoFooter } from "./GoFooter";

export default Plugin.define({
  id: "opencode-go-limit",
  setup(context) {
    try {
      context.ui?.toast?.show?.({ message: "OpenCode Go limit loaded", variant: "info" });
      const unregister = context.ui.slot({
        append: "prompt.footer.status",
        render: () => <GoFooter context={context} />,
      });
      return () => unregister();
    } catch (error) {
      console.error("opencode-go-limit: setup failed", error);
      return () => {};
    }
  },
});
