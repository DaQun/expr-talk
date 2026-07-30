import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "../components/Layout";
import { HomePage } from "../pages/HomePage";
import { PracticePage } from "../pages/PracticePage";
import { ReviewPage } from "../pages/ReviewPage";
import { RetryPage } from "../pages/RetryPage";
import { HistoryPage } from "../pages/HistoryPage";
import { ProfilePage } from "../pages/ProfilePage";
import { SettingsPage } from "../pages/SettingsPage";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="practice" element={<PracticePage />} />
          <Route path="review/:sessionId?" element={<ReviewPage />} />
          <Route path="retry/:sessionId" element={<RetryPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
