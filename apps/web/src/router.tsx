import { createBrowserRouter } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import DashboardPage from "./pages/DashboardPage";
import ProjectEditorPage from "./pages/ProjectEditorPage";
import ProtectedRoute from "./components/ProtectedRoute";
import PublicRoute from "./components/PublicRoute";
import { RouteErrorFallback } from "./components/RouteErrorFallback";

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorFallback />,
    children: [
      {
        element: <PublicRoute />,
        children: [
          { path: "/login", element: <LoginPage /> },
          { path: "/register", element: <RegisterPage /> },
        ],
      },
      {
        element: <ProtectedRoute />,
        children: [
          { path: "/", element: <DashboardPage /> },
          { path: "/projects/:projectId", element: <ProjectEditorPage /> },
        ],
      },
      { path: "*", element: <div>Page not found</div> },
    ],
  },
]);
