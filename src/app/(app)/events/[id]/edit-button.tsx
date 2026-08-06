"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EventDialog,
  type Category,
  type Event,
  type Member,
} from "../event-dialog";

/**
 * Edit button for the event detail page — opens the same dialog the events
 * list uses. On save the server page re-renders; after a delete we can't
 * stay here (the page would 404), so we go back to the list.
 */
export function EditEventButton({
  event,
  members,
  categories,
  connectedProviders,
}: {
  event: Event;
  members: Member[];
  categories: Category[];
  connectedProviders: Array<"google" | "microsoft">;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Pencil className="h-3.5 w-3.5" /> Edit
      </Button>
      {open && (
        <EventDialog
          existing={event}
          members={members}
          categories={categories}
          connectedProviders={connectedProviders}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
          onDeleted={() => router.push("/events")}
          onCategoryCreated={() => router.refresh()}
        />
      )}
    </>
  );
}
