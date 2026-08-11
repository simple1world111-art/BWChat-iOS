import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("batch action source parity", () => {
  it("connects the selection toolbar and forwarding modal on direct and group timelines", () => {
    for (const file of ["src/app/chat/[id].tsx", "src/app/group-chat/[id].tsx"]) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source).toContain("<ChatSelectionToolbar");
      expect(source).toContain("toggleChatSelection(");
      expect(source).toContain("canForwardSelection(");
      expect(source).toContain("<ForwardFlowModal");
      expect(source).toContain("<ForwardBundleMessageCard");
    }
  });

  it("keeps the audited source geometry, states, target types and confirmation flow", () => {
    const source = fs.readFileSync(
      path.join(root, "src/components/messages/ChatForwardViews.tsx"),
      "utf8",
    );
    for (const expected of [
      "width: 230",
      "padding: 12",
      "borderRadius: 12",
      "height: 310",
      "confirmationHandle: {",
      "width: 36",
      "height: 5",
      "size={42}",
      "size={22}",
      "Promise.allSettled([getFriendList(), getGroups()])",
      "toggleForwardTarget(selected, target)",
      "sortForwardTargets(selected)",
      "client_operation_id: clientOperationId",
      "export function ForwardBundleDetailModal",
    ])
      expect(source).toContain(expected);
  });
});
