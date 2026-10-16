import { NextResponse } from "next/server";
import { listProjects } from "@/db/projects";

export async function GET() {
  return NextResponse.json({ projects: await listProjects() });
}
