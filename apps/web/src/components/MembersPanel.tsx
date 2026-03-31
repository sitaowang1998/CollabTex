import { useState, useEffect, useRef, useId } from "react";
import { useNavigate } from "react-router-dom";
import type {
  ProjectMember,
  ProjectRole,
  ProjectMemberListResponse,
  ProjectMemberResponse,
} from "@collab-tex/shared";
import { api, ApiError } from "@/lib/api";
import { useApiQuery } from "@/lib/useApiQuery";
import { useApiMutation } from "@/lib/useApiMutation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AlertBanner } from "@/components/ui/alert-banner";
import { ErrorBlock } from "@/components/ui/error-block";

const ROLES: ProjectRole[] = ["admin", "editor", "commenter", "reader"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmPhrase: string;
  confirmLabel: string;
  isSubmitting: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
};

function ConfirmDialogInner({
  title,
  description,
  confirmPhrase,
  confirmLabel,
  isSubmitting,
  error,
  onConfirm,
  onCancel,
}: Omit<ConfirmDialogProps, "open">) {
  const confirmId = useId();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onCancel();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <h2 className="text-xl font-semibold">{title}</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{description}</p>
          <div className="space-y-2">
            <Label htmlFor={confirmId}>
              Type <span className="font-mono font-bold">{confirmPhrase}</span>{" "}
              to confirm
            </Label>
            <Input
              ref={inputRef}
              id={confirmId}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={confirmPhrase}
            />
          </div>
          {error && <AlertBanner message={error} />}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={input !== confirmPhrase || isSubmitting}
              onClick={onConfirm}
            >
              {isSubmitting ? `${confirmLabel}…` : confirmLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ConfirmDialog({ open, ...rest }: ConfirmDialogProps) {
  if (!open) return null;
  return <ConfirmDialogInner {...rest} />;
}

function SimpleConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onCancel();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h2 className="text-lg font-semibold">{title}</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{description}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function MembersPanel({
  projectId,
  myRole,
  currentUserId,
  onClose,
  onProjectDeleted,
}: {
  projectId: string;
  myRole: ProjectRole;
  currentUserId: string;
  onClose: () => void;
  onProjectDeleted: () => void;
}) {
  const navigate = useNavigate();

  const {
    data: members,
    isLoading,
    error,
    refetch: retryFetchMembers,
    setData: setMembers,
  } = useApiQuery<ProjectMember[]>({
    queryFn: (signal) =>
      api
        .get<ProjectMemberListResponse>(`/projects/${projectId}/members`, {
          signal,
        })
        .then((d) => d.members),
    deps: [projectId],
    initialData: [],
  });

  // Add member form
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<ProjectRole>("editor");
  const [addValidationError, setAddValidationError] = useState("");

  // Mutation tracking
  const [pendingMemberIds, setPendingMemberIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [mutationError, setMutationError] = useState("");

  // Role change confirmation
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    userId: string;
    name: string;
    newRole: ProjectRole;
  } | null>(null);

  // Confirmation dialogs
  const [showDeleteProject, setShowDeleteProject] = useState(false);
  const [showLeaveProject, setShowLeaveProject] = useState(false);

  const isAdmin = myRole === "admin";

  const adminCount = members.filter((m) => m.role === "admin").length;

  const addMemberMutation = useApiMutation<
    [string, ProjectRole],
    ProjectMemberResponse
  >({
    mutationFn: (email: string, role: ProjectRole) =>
      api.post<ProjectMemberResponse>(`/projects/${projectId}/members`, {
        email,
        role,
      }),
    onSuccess: (result) => {
      setMembers((prev) => [...prev, result.member]);
      setAddEmail("");
      setAddRole("editor");
      setMutationError("");
    },
  });

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    setAddValidationError("");
    addMemberMutation.reset();
    const trimmed = addEmail.trim();
    if (!trimmed) {
      setAddValidationError("Email is required");
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setAddValidationError("Enter a valid email address");
      return;
    }
    await addMemberMutation.execute(trimmed, addRole);
  }

  const addError = addValidationError || addMemberMutation.error;
  const isAdding = addMemberMutation.isSubmitting;

  function requestRoleChange(userId: string, newRole: ProjectRole) {
    const member = members.find((m) => m.userId === userId);
    if (!member) return;

    // Last admin protection
    if (member.role === "admin" && newRole !== "admin" && adminCount <= 1) {
      setMutationError("Cannot demote the last admin");
      return;
    }

    if (newRole === member.role) return;

    setPendingRoleChange({ userId, name: member.name, newRole });
  }

  async function handleChangeRole(userId: string, newRole: ProjectRole) {
    const member = members.find((m) => m.userId === userId);
    if (!member) return;
    if (pendingMemberIds.has(userId)) return;

    setMutationError("");
    const oldRole = member.role;

    // Optimistic update
    setMembers((prev) =>
      prev.map((m) => (m.userId === userId ? { ...m, role: newRole } : m)),
    );
    setPendingMemberIds((prev) => new Set(prev).add(userId));

    try {
      await api.patch(`/projects/${projectId}/members/${userId}`, {
        role: newRole,
      });
    } catch (err) {
      // Rollback
      setMembers((prev) =>
        prev.map((m) => (m.userId === userId ? { ...m, role: oldRole } : m)),
      );
      setMutationError(errorMessage(err, "Failed to update role"));
    } finally {
      setPendingMemberIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  async function handleRemoveMember(userId: string) {
    const member = members.find((m) => m.userId === userId);
    if (!member) return;
    if (pendingMemberIds.has(userId)) return;

    // Last admin protection
    if (member.role === "admin" && adminCount <= 1) {
      setMutationError("Cannot remove the last admin");
      return;
    }

    setMutationError("");
    const originalIndex = members.indexOf(member);

    // Optimistic update
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
    setPendingMemberIds((prev) => new Set(prev).add(userId));

    try {
      await api.delete(`/projects/${projectId}/members/${userId}`);
    } catch (err) {
      // Rollback: re-insert at original position
      setMembers((prev) => {
        if (prev.some((m) => m.userId === member.userId)) return prev;
        const next = [...prev];
        next.splice(Math.min(originalIndex, next.length), 0, member);
        return next;
      });
      setMutationError(errorMessage(err, "Failed to remove member"));
    } finally {
      setPendingMemberIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  const leaveMutation = useApiMutation({
    mutationFn: () => {
      if (!currentUserId)
        throw new Error("Session expired. Please log in again.");
      return api.delete(`/projects/${projectId}/members/${currentUserId}`);
    },
    onSuccess: () => navigate("/"),
  });

  const deleteMutation = useApiMutation({
    mutationFn: () => api.delete(`/projects/${projectId}`),
    onSuccess: () => onProjectDeleted(),
  });

  const isLeavingProject = leaveMutation.isSubmitting;
  const leaveProjectError = leaveMutation.error;
  const isDeletingProject = deleteMutation.isSubmitting;
  const deleteProjectError = deleteMutation.error;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (showLeaveProject || showDeleteProject || pendingRoleChange) return;
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, showLeaveProject, showDeleteProject, pendingRoleChange]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Project members"
    >
      <Card
        className="flex w-full max-w-lg flex-col overflow-hidden"
        style={{ maxHeight: "80vh" }}
        data-testid="members-panel"
      >
        {/* Header */}
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <h2 className="text-lg font-semibold">Members</h2>
          <button
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close members panel"
          >
            ✕
          </button>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-0">
          {/* Add member form (admin only) */}
          {isAdmin && (
            <form onSubmit={handleAddMember} className="border-b p-3 space-y-2">
              <Label htmlFor="add-member-email" className="text-xs">
                Add member
              </Label>
              <Input
                id="add-member-email"
                type="email"
                placeholder="Email address"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                className="text-xs"
              />
              <div className="flex items-center justify-between gap-1.5">
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as ProjectRole)}
                  className="h-7 rounded-lg border border-input bg-transparent px-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  aria-label="Role"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isAdding || !EMAIL_RE.test(addEmail.trim())}
                >
                  {isAdding ? "Adding…" : "Add"}
                </Button>
              </div>
              {addError && (
                <AlertBanner message={addError} className="text-xs" />
              )}
            </form>
          )}

          {/* Loading */}
          {isLoading && (
            <p className="p-3 text-sm text-muted-foreground">
              Loading members…
            </p>
          )}

          {/* Error */}
          {!isLoading && error && (
            <ErrorBlock
              className="p-3"
              message={error}
              onRetry={retryFetchMembers}
            />
          )}

          {/* Mutation error */}
          {mutationError && (
            <div className="border-b px-3 py-2">
              <AlertBanner
                message={mutationError}
                onDismiss={() => setMutationError("")}
                className="text-xs"
              />
            </div>
          )}

          {/* Member list */}
          {!isLoading && !error && members.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">
              No members found.
            </p>
          )}
          {!isLoading && !error && members.length > 0 && (
            <ul className="divide-y" role="list" aria-label="Project members">
              {members.map((member) => (
                <li
                  key={member.userId}
                  className="flex items-center gap-2 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {member.name}
                      {member.userId === currentUserId && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {member.email}
                    </p>
                  </div>
                  {isAdmin ? (
                    <>
                      <select
                        value={member.role}
                        onChange={(e) =>
                          requestRoleChange(
                            member.userId,
                            e.target.value as ProjectRole,
                          )
                        }
                        disabled={pendingMemberIds.has(member.userId)}
                        className="h-6 rounded border border-input bg-transparent px-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                        aria-label={`Role for ${member.name}`}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      {member.userId !== currentUserId && (
                        <Button
                          variant="destructive"
                          size="icon-xs"
                          onClick={() => handleRemoveMember(member.userId)}
                          disabled={pendingMemberIds.has(member.userId)}
                          aria-label={`Remove ${member.name}`}
                        >
                          ✕
                        </Button>
                      )}
                    </>
                  ) : (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {member.role}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Leave / Delete section */}
          {!isLoading && !error && (
            <div className="border-t p-3 space-y-2">
              <Button
                variant="destructive"
                size="sm"
                className="w-full disabled:pointer-events-auto"
                onClick={() => setShowLeaveProject(true)}
                disabled={isAdmin && adminCount <= 1}
                title={
                  isAdmin && adminCount <= 1
                    ? "You are the last admin. Transfer admin role to another member before leaving."
                    : undefined
                }
              >
                Leave Project
              </Button>
              {isAdmin && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowDeleteProject(true)}
                >
                  Delete Project
                </Button>
              )}
            </div>
          )}
        </CardContent>

        {/* Confirmation dialogs */}
        <SimpleConfirmDialog
          open={pendingRoleChange !== null}
          title="Change Role"
          description={
            pendingRoleChange
              ? `Change ${pendingRoleChange.name}'s role to ${pendingRoleChange.newRole}?`
              : ""
          }
          confirmLabel="Change"
          onConfirm={() => {
            if (pendingRoleChange) {
              handleChangeRole(
                pendingRoleChange.userId,
                pendingRoleChange.newRole,
              );
            }
            setPendingRoleChange(null);
          }}
          onCancel={() => setPendingRoleChange(null)}
        />
        <ConfirmDialog
          open={showLeaveProject}
          title="Leave Project"
          description="You will lose access to this project. This action cannot be undone."
          confirmPhrase="LEAVE PROJECT"
          confirmLabel="Leave"
          isSubmitting={isLeavingProject}
          error={leaveProjectError}
          onConfirm={() => leaveMutation.execute()}
          onCancel={() => {
            setShowLeaveProject(false);
            leaveMutation.reset();
          }}
        />
        <ConfirmDialog
          open={showDeleteProject}
          title="Delete Project"
          description="This will permanently delete the project and all its files. This action cannot be undone."
          confirmPhrase="DELETE PROJECT"
          confirmLabel="Delete"
          isSubmitting={isDeletingProject}
          error={deleteProjectError}
          onConfirm={() => deleteMutation.execute()}
          onCancel={() => {
            setShowDeleteProject(false);
            deleteMutation.reset();
          }}
        />
      </Card>
    </div>
  );
}
