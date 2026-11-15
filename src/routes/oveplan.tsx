import { createFileRoute, redirect } from "@tanstack/react-router";
import { Oveplan } from "@/components/oveplan";

export const Route = createFileRoute("/oveplan")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  component: Oveplan,
});
