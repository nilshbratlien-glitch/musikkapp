import { createFileRoute } from "@tanstack/react-router";
import { Metronom } from "@/components/metronom";

export const Route = createFileRoute("/metronom")({
  component: Metronom,
});
