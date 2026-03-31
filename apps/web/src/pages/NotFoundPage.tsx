import { Link, useNavigate } from "react-router-dom";
import { ErrorBlock } from "@/components/ui/error-block";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <h2 className="mb-8 text-3xl font-bold tracking-tight">CollabTex</h2>
      <ErrorBlock
        icon="not-found"
        title="Page not found"
        message="The page you are looking for does not exist or has been moved."
        actions={
          <>
            <Link to="/">
              <Button variant="outline">Back to Dashboard</Button>
            </Link>
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Go back
            </Button>
          </>
        }
      />
    </div>
  );
}
