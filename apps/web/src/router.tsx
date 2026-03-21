import { createBrowserRouter } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import DashboardPage from "./pages/DashboardPage";
import ProtectedRoute from "./components/ProtectedRoute";
import { RouteErrorFallback } from "./components/RouteErrorFallback";

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorFallback />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      {
        element: <ProtectedRoute />,
        children: [
          { path: "/", element: <DashboardPage /> },
          { path: "/projects/:projectId", element: <div>Project</div> },
        ],
      },
      { path: "*", element: <div>Page not found</div> },
    ],
  },
]);
