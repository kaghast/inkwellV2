import React from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ReminderProvider } from "@/contexts/ReminderContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { Toaster } from "@/components/ui/sonner";
import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import Dashboard from "@/pages/Dashboard";
import AllNotes from "@/pages/AllNotes";
import MapView from "@/pages/MapView";
import KanbanPage from "@/pages/KanbanPage";
import GraphView from "@/pages/GraphView";
import NoteDetail from "@/pages/NoteDetail";
import SettingsPage from "@/pages/SettingsPage";
import ProtectedRoute from "@/components/ProtectedRoute";

function AppRoutes() {
  const location = useLocation();
  if (location.hash && location.hash.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><Dashboard mode="day" /></ProtectedRoute>} />
      <Route path="/all-notes" element={<ProtectedRoute><AllNotes /></ProtectedRoute>} />
      <Route path="/notes" element={<ProtectedRoute><AllNotes /></ProtectedRoute>} />
      <Route path="/graph" element={<ProtectedRoute><GraphView /></ProtectedRoute>} />
      <Route path="/network" element={<ProtectedRoute><GraphView /></ProtectedRoute>} />
      <Route path="/map" element={<ProtectedRoute><MapView /></ProtectedRoute>} />
      <Route path="/kanban" element={<ProtectedRoute><KanbanPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/day/:date" element={<ProtectedRoute><Dashboard mode="day" /></ProtectedRoute>} />
      <Route path="/category/:id" element={<ProtectedRoute><Dashboard mode="category" /></ProtectedRoute>} />
      <Route path="/tag/:name" element={<ProtectedRoute><Dashboard mode="tag" /></ProtectedRoute>} />
      <Route path="/person/:name" element={<ProtectedRoute><Dashboard mode="person" /></ProtectedRoute>} />
      <Route path="/location/:id" element={<ProtectedRoute><Dashboard mode="location" /></ProtectedRoute>} />
      <Route path="/note/:id" element={<ProtectedRoute><NoteDetail /></ProtectedRoute>} />
      <Route path="/notes/:id" element={<ProtectedRoute><NoteDetail /></ProtectedRoute>} />
      <Route path="/n/:id" element={<ProtectedRoute><NoteDetail /></ProtectedRoute>} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SettingsProvider>
          <BrowserRouter>
            <ReminderProvider>
              <AppRoutes />
              <Toaster
                position="bottom-right"
                toastOptions={{
                  style: {
                    background: "hsl(var(--popover))",
                    color: "hsl(var(--popover-foreground))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontFamily: "'Manrope', sans-serif",
                  },
                }}
              />
            </ReminderProvider>
          </BrowserRouter>
        </SettingsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
