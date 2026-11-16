import { createFileRoute } from "@tanstack/react-router";
import { Noter } from "@/components/noter";

export type NoterSearch = {
  sheet?: string;
  setlist?: string;
};

export const Route = createFileRoute("/noter")({
  validateSearch: (search: Record<string, unknown>): NoterSearch => ({
    ...(typeof search.sheet === "string" && search.sheet ? { sheet: search.sheet } : {}),
    ...(typeof search.setlist === "string" && search.setlist ? { setlist: search.setlist } : {}),
  }),
  component: Noter,
});
