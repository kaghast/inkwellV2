import React from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { DrawerTabsProvider } from "@/contexts/DrawerTabsContext";
import NoteDrawer from "@/components/NoteDrawer";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ReminderProvider } from "@/contexts/ReminderContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { Toaster } from "@/components/ui/sonner";
import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import Dashboard from "@/pages/Dashboard";
import AllNotes from "@/pages/AllNotes";
import MapView from "@/pages/MapView";
import AreaMapView from "@/pages/AreaMapView";
import KanbanPage from "@/pages/KanbanPage";
import GraphView from "@/pages/GraphView";
import TimelinePage from "@/pages/TimelinePage";
import NoteDetail from "@/pages/NoteDetail";
import NewNotePage from "@/pages/NewNotePage";
import SettingsPage from "@/pages/SettingsPage";
import ProtectedRoute from "@/components/ProtectedRoute";
import HomePage from "@/pages/HomePage";
import InboxPage from "@/pages/InboxPage";
import TodayPage from "@/pages/TodayPage";
import SpacesPage from "@/pages/SpacesPage";
import AskPage from "@/pages/AskPage";
import CommandPalette from "@/components/CommandPalette";
import TemplateDialog from "@/components/TemplateDialog";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";

function AppRoutes() {
  const location = useLocation();
  if (location.hash && location.hash.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
      <Route path="/home" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
      <Route path="/inbox" element={<ProtectedRoute><InboxPage /></ProtectedRoute>} />
      <Route path="/today" element={<ProtectedRoute><TodayPage /></ProtectedRoute>} />
      <Route path="/today/:date" element={<ProtectedRoute><TodayPage /></ProtectedRoute>} />
      <Route path="/ask" element={<ProtectedRoute><AskPage /></ProtectedRoute>} />
      <Route path="/spaces" element={<ProtectedRoute><SpacesPage /></ProtectedRoute>} />
      <Route path="/spaces/:spaceId" element={<ProtectedRoute><SpacesPage /></ProtectedRoute>} />
      <Route path="/feed" element={<ProtectedRoute><Dashboard mode="day" /></ProtectedRoute>} />
      <Route path="/new" element={<ProtectedRoute><NewNotePage /></ProtectedRoute>} />
      <Route path="/notes/new" element={<ProtectedRoute><NewNotePage /></ProtectedRoute>} />
      <Route path="/timeline" element={<ProtectedRoute><TimelinePage /></ProtectedRoute>} />
      <Route path="/all-notes" element={<ProtectedRoute><AllNotes /></ProtectedRoute>} />
      <Route path="/notes" element={<ProtectedRoute><AllNotes /></ProtectedRoute>} />
      <Route path="/graph" element={<ProtectedRoute><AreaMapView /></ProtectedRoute>} />
      <Route path="/areas" element={<ProtectedRoute><AreaMapView /></ProtectedRoute>} />
      <Route path="/network" element={<ProtectedRoute><GraphView /></ProtectedRoute>} />
      <Route path="/map" element={<ProtectedRoute><MapView /></ProtectedRoute>} />
      <Route path="/kanban" element={<ProtectedRoute><KanbanPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/day/:date" element={<ProtectedRoute><Dashboard mode="day" /></ProtectedRoute>} />
      <Route path="/week/:date" element={<ProtectedRoute><Dashboard mode="week" /></ProtectedRoute>} />
      <Route path="/month/:date" element={<ProtectedRoute><Dashboard mode="month" /></ProtectedRoute>} />
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

/** Global palette and template dialog, only for signed-in users. */
function WorkspaceOverlays() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <CommandPalette />
      <TemplateDialog />
    </>
  );
}

/** The tabbed note drawer is only mounted for a signed-in user. */
function DrawerHost() {
  const { user } = useAuth();
  return user ? <NoteDrawer /> : null;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SettingsProvider>
          <BrowserRouter>
            <ReminderProvider>
              <DrawerTabsProvider>
                <WorkspaceProvider>
                  <AppRoutes />
                  <WorkspaceOverlays />
                  <DrawerHost />
                </WorkspaceProvider>
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
              </DrawerTabsProvider>
            </ReminderProvider>
          </BrowserRouter>
        </SettingsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
