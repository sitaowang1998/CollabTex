import { useState, useEffect, useRef, type FormEvent } from "react";
import type { Project, ProjectSummary } from "@collab-tex/shared";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type ProjectMutationResponse = { project: Project };

export default function CreateProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (project: ProjectSummary) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setError("");
      setFieldError("");
      setIsSubmitting(false);
      // Focus after render
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setFieldError("");

    const trimmed = name.trim();
    if (!trimmed) {
      setFieldError("Project name is required");
      return;
    }
    if (trimmed.length > 160) {
      setFieldError("Project name must be 160 characters or fewer");
      return;
    }

    setIsSubmitting(true);
    try {
      const { project } = await api.post<ProjectMutationResponse>("/projects", {
        name: trimmed,
      });
      onCreated({
        id: project.id,
        name: project.name,
        myRole: "admin",
        updatedAt: project.updatedAt,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.fields?.name) setFieldError(err.fields.name);
      } else {
        console.error("Create project failed:", err);
        setError("An unexpected error occurred");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Create project"
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <h2 className="text-xl font-semibold">New Project</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                ref={inputRef}
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={160}
              />
              {fieldError && (
                <p className="text-sm text-destructive">{fieldError}</p>
              )}
            </div>
            {error && (
              <div className="text-sm text-destructive" role="alert">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating…" : "Create"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
