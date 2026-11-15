import { createFileRoute } from "@tanstack/react-router";
import { Noter } from "@/components/noter";

export const Route = createFileRoute("/noter")({
  component: Noter,
});
