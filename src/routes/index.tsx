import { createFileRoute } from "@tanstack/react-router";
import { ToolPage } from "@/components/tool-page";
import { TOOLS } from "@/lib/tools";

const tool = TOOLS[0];

export const Route = createFileRoute("/")({
  component: () => <ToolPage id={tool.id} title={tool.label} body={tool.body} />,
});
