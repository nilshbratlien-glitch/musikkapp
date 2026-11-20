import { createFileRoute } from "@tanstack/react-router";
import { TunerView } from "@/components/tuner-view";

export const Route = createFileRoute("/tuner")({
  component: () => <TunerView />,
});
