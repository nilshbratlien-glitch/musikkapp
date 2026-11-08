import { createFileRoute } from "@tanstack/react-router";
import { ToolPage } from "@/components/tool-page";
import { TOOLS } from "@/lib/tools";

const tool = TOOLS[3];

export const Route = createFileRoute("/notekort")({
  component: () => <ToolPage id={tool.id} title={tool.label} body={tool.body} />,
});
