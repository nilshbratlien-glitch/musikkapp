import { createFileRoute } from "@tanstack/react-router";
import { SnareSpeed } from "@/components/snare-speed";

export const Route = createFileRoute("/metronom")({
  component: SnareSpeed,
});
