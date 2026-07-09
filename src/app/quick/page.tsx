"use client";

import { ModeProjectHub } from "@/components/ModeProjectHub";

export default function QuickHubPage() {
  return (
    <ModeProjectHub
      mode="quick_room"
      createPath="/quick/new"
      hubPath="/quick"
    />
  );
}
