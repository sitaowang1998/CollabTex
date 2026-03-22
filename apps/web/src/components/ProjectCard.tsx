import { useNavigate } from "react-router-dom";
import type { ProjectSummary } from "@collab-tex/shared";
import { Card, CardContent } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/formatRelativeTime";

const roleBadgeColors: Record<string, string> = {
  admin: "bg-purple-100 text-purple-800",
  editor: "bg-blue-100 text-blue-800",
  commenter: "bg-yellow-100 text-yellow-800",
  reader: "bg-gray-100 text-gray-800",
};

export default function ProjectCard({ project }: { project: ProjectSummary }) {
  const navigate = useNavigate();

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent"
      onClick={() => navigate(`/projects/${project.id}`)}
      role="link"
      data-testid={`project-card-${project.id}`}
    >
      <CardContent className="flex items-center justify-between p-4">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{project.name}</h3>
          <p className="text-sm text-muted-foreground">
            {formatRelativeTime(project.updatedAt)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeColors[project.myRole] ?? roleBadgeColors.reader}`}
        >
          {project.myRole}
        </span>
      </CardContent>
    </Card>
  );
}
