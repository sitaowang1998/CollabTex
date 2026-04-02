# AI Interaction Record

This file documents three representative AI interactions that meaningfully influenced the project, as required by the
course handout. In all cases, the AI was used as an assistant for drafting, planning, or review, and all final
decisions and verification were performed by the team.

## Session 1: Refining proposal motivation and report wording

### Prompt

```text
Please improve the writing quality of the following motivation section for our course project proposal. Keep the
technical meaning the same, make it more polished and concise, and preserve the comparison with Overleaf and Git-based
workflows.

LaTeX is widely used in scientific publication. All papers published in ACM and IEEE journals and conferences are
composed using LaTeX. Furthermore, University of Toronto provides a LaTeX template, from which most theses are
written. Given the collaborative nature of research, most papers are written by multiple authors, and theses, although
produced by one person, are often guided by suggestions and comments from the advisor.

Despite the need for multiple authors and commenters to work on the same LaTeX project together, there are not a lot
of platforms and tools that support the collaboration. A common platform available is Overleaf. However, the community
version has a strict limit on the compile time, and is not suitable for a large LaTeX project. Advanced features like
versioning, which is very useful, are also locked in the premium version. For collaboration, it lacks more
fine-grained access control. All collaborators have the same write access. There is no support for admin and
commenter.

Another widely used way to collaborate on LaTeX is to use a shared git repo on GitHub or GitLab to store the source
files. All collaborators need to install LaTeX toolchain locally, and there is no support for real-time
collaboration. Git is also not designed for handling large binary files, which can be a problem for LaTeX projects
with many figures.
```

### AI Response

```text
LaTeX is widely used in scientific publishing. Virtually all papers published in ACM and IEEE journals and conferences
are prepared using LaTeX. In addition, the University of Toronto provides an official LaTeX thesis template, which is
used by most graduate students. Given the collaborative nature of research, academic papers are typically written by
multiple authors. Even theses, although authored by a single student, are shaped extensively by feedback and
suggestions from advisors.

Despite this strong need for collaboration, there are relatively few platforms and tools that effectively support
multiple contributors working on the same LaTeX project. One commonly used platform is Overleaf. However, the
community version imposes strict compile-time limits, making it unsuitable for large LaTeX projects. Advanced features
such as version history are restricted to the premium version. In terms of collaboration controls, Overleaf also lacks
fine-grained access management: all collaborators are granted the same write permissions, with no distinction between
roles such as administrator, editor, or commenter.

Another widely used approach is to host the source files in a shared Git repository on GitHub or GitLab. While this
method provides version control, it requires all collaborators to install and maintain a local LaTeX toolchain.
Moreover, it does not support real-time collaborative editing, which can hinder efficient teamwork.
```

### What Your Team Did With It

The revised text was useful because it improved grammar, flow, and overall readability without changing the project's
core motivation. However, the response was incomplete for our needs because it removed the point that Git handles large
binary files poorly, which was important for a LaTeX workflow with many images and figures. We compared the AI version
against our original draft, restored the missing technical point manually, and iterated on the final wording ourselves
before using it in the proposal and later report.

## Session 2: Claude planned and wrote the mocked `PdfPreview` test file

### Prompt

```text
Read the existing frontend test infra first. Read the frontend and backend test setup, the checked-in backend API docs
under doc/api, and the proposal for the general architecture and intended behavior.

Plan to write the mocked test file for PdfPreview. Cover the full behavior already implemented in the component: initial PDF
loading, empty state, role-based compile visibility, compile requests, compile errors, compile:done socket events, PDF rendering state, and download behavior.
```

### AI Response

Claude first summarized the repo context:

- the frontend test suite already uses Vitest, React Testing Library, and user-event
- the backend has unit, integration, and WebSocket-oriented tests, so new frontend tests should align with the checked-
  in API contracts instead of inventing a new test shape
- the API docs say `POST /api/projects/{projectId}/compile` returns asynchronously and emits a `compile:done` socket
  event, so race conditions between the HTTP flow and the socket notification are worth testing directly
- the component behavior also includes initial fetch, PDF rendering, role-gated compile controls, and download flows,
  so the test plan should cover the mocked test file broadly instead of only compile transitions

Claude then gave a plan:

1. Reuse the existing frontend Vitest infra.
2. Add coverage for initial loading, initial 404 empty state, successful PDF rendering, and role-based compile button
   visibility.
3. Add compile-related tests for in-flight compile state, 409 conflict, success-without-PDF, and `compile:done`
   arriving during an active compile.
4. Add download-related tests for successful download, filename sanitization, and failure paths.
5. Use deferred promises to control async timing so socket events can be fired before the POST resolves.
6. Assert both the final UI state and the absence of transient incorrect error states.

After I approved the plan, Claude wrote actual test code following that plan. It used the existing Vitest and React
Testing Library style in the repo, reused the established mocking pattern for `api` and `getSocket`, and added concrete
tests for the full mocked `PdfPreview` flow.

### What Your Team Did With It

This interaction was useful because Claude did not start from a blank generic answer. It first checked the existing
test infrastructure, the backend API documentation, and the project proposal, then produced a plan that matched the
repository's actual structure. We reviewed the plan, approved it, and then had Claude write the actual test code for
the mocked `PdfPreview` test file, saving us hours to write hundreds lines of test code.

Some generated details still required manual correction. We adjusted expectations and event ordering to match the real
component behavior and the established testing style already used in the repo, and we did not accept generated code
blindly. We verified the test codes generated follows the intended behavior, and cover most use cases. We also run the
test on source code we wrote, and fixed the bugs in the test code.

We also discovered later that Clause is not good at reusing existing code. We had to refactor the tests by extracting
duplicated code into functions that is used by different tests.

## Session 3: Reviewing pull requests with GitHub Copilot review

### Prompt

We triggered GitHub's built-in Copilot pull request review on a lot of PRs from the PR page directly. For example,
for [PR #70](https://github.com/sitaowang1998/CollabTex/pull/70), Copilot reviewed the diff and posted inline comments
on the pull request.

### AI Response

Copilot posted comments including:

- `apps/web/src/components/ui/field-error.tsx`: field validation messages should not use `role="alert"` because that
  is too aggressive for screen readers.
- `apps/web/src/components/ui/error-block.tsx`: the generic error block should use a less urgent live region than
  `alert`.
- `apps/web/src/main.tsx`: the newly introduced `ToastProvider` looked unnecessary without real production `useToast`
  usage.

### What Your Team Did With It

We used Copilot review as one input during PR review, not as an automatic decision maker. This PR provided a real
mixed case in which some comments were adopted and some were not.

- We adopted the accessibility-related comments for `FieldError` and `ErrorBlock`. In the merged code, `FieldError`
  no longer uses `role="alert"`, and `ErrorBlock` uses `role="status"` instead.
- We did not adopt the `ToastProvider` suggestion in `main.tsx`. After checking the actual app structure, we decided
  not to add that provider.
