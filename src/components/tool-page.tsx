import { useEffect } from "react";
import { readToolStore, writeToolStore, type ToolId } from "@/lib/tools";

export function ToolPage({
  id,
  title,
  body,
}: {
  id: ToolId;
  title: string;
  body: string;
}) {
  useEffect(() => {
    const store = readToolStore(id);
    if (store.openedAt == null) {
      writeToolStore(id, { ...store, openedAt: Date.now() });
    }
  }, [id]);

  return (
    <article className="rounded-card border border-line bg-surface px-5 py-5">
      <h1 className="text-2xl leading-tight font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-base leading-relaxed text-muted">{body}</p>
    </article>
  );
}
