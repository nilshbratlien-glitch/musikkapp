import { createFileRoute } from "@tanstack/react-router";
import { NoteCards } from "@/components/note-cards";

export const Route = createFileRoute("/notekort")({
  component: NoteCards,
});
