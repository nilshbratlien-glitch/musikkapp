import { createFileRoute } from "@tanstack/react-router";
import { ToolPage } from "@/components/tool-page";
import { TOOLS } from "@/lib/tools";

const tool = TOOLS[2];

export const Route = createFileRoute("/oveplan")({
  component: () => <ToolPage id={tool.id} title={tool.label} body={tool.body} />,
});
