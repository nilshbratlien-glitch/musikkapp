import { createFileRoute } from "@tanstack/react-router";
import { Oveplan } from "@/components/oveplan";

export const Route = createFileRoute("/")({
  component: Oveplan,
});
