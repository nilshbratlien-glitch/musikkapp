import { createFileRoute } from "@tanstack/react-router";
import { Malletsight } from "@/components/malletsight";

export const Route = createFileRoute("/")({
  component: Malletsight,
});
