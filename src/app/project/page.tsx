"use client";

import { ModeProjectHub } from "@/components/ModeProjectHub";

export default function ProjectHubPage() {
  return (
    <ModeProjectHub
      mode="project"
      createPath="/project/new"
      hubPath="/project"
    />
  );
}
