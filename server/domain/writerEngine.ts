import { newId } from "../db.js";

export interface Scene {
  id: string;
  title: string;
  content: string;
}

export interface ConsistencyIssue {
  id: string;
  projectId: string;
  severity: "low" | "medium" | "high";
  category: "names" | "facts" | "timeline" | "pov";
  message: string;
}

export function runConsistency(projectId: string, scenes: Scene[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];

  for (const scene of scenes) {
    if (scene.content.includes("[TODO]")) {
      issues.push({
        id: newId(),
        projectId,
        severity: "medium",
        category: "facts",
        message: `Scene '${scene.title}' still contains TODO markers`
      });
    }

    if (scene.content.includes("I ") && scene.content.includes("she ")) {
      issues.push({
        id: newId(),
        projectId,
        severity: "low",
        category: "pov",
        message: `Scene '${scene.title}' may mix POV styles`
      });
    }
  }

  return issues;
}
