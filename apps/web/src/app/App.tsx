import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./app.css";
import RepoPicker from "../routes/RepoPicker";
import Docs from "../routes/Docs";
import RepoChrome from "./RepoChrome";
import RepoView from "../routes/RepoView";
import People from "../routes/People";

/**
 * Application router.
 *
 *   /                    repo picker (the app's empty state)
 *   /r/:repoId           RepoView — map + side panel, two-pane (index)
 *   /r/:repoId/people    people / ownership view
 *
 * `RepoChrome` provides the shared top bar + the global ⌘K palette for the
 * repo routes. Unknown paths redirect home.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RepoPicker />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/r/:repoId" element={<RepoChrome />}>
          <Route index element={<RepoView />} />
          <Route path="people" element={<People />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
