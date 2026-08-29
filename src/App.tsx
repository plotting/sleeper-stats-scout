import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Navigation from "./components/Navigation";
import Seasons from "./pages/Seasons";
import TeamPage from "./pages/TeamPage";
import WeeklyScores from "./pages/WeeklyScores";
import Draft from "./pages/Draft";
import Trades from "./pages/Trades";
import HeadToHead from "./pages/HeadToHead";
import Records from "./pages/Records";
import WeeklyRecords from "./pages/WeeklyRecords";
import Admin from "./pages/Admin";
import Analytics from "./pages/Analytics";
import Season14 from "./pages/Season14";
import Recaps from "./pages/Recaps";
import Rookies from "./pages/Rookies";
import DraftGrades from "./pages/DraftGrades";
import DynastyDigest from "./pages/DynastyDigest";
import GMScouting from "./pages/GMScouting";
import Hall from "./pages/Hall";
import NotFound from "./pages/NotFound";
import "./App.css";

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <div className="min-h-screen bg-background">
          <Navigation />
          <main className="container mx-auto py-6 px-4">
            <Routes>
              <Route path="/" element={<Seasons />} />
              <Route path="/team/:id" element={<TeamPage />} />
              <Route path="/weekly-scores" element={<WeeklyScores />} />
              <Route path="/draft" element={<Draft />} />
              <Route path="/trades" element={<Trades />} />
              <Route path="/head-to-head" element={<HeadToHead />} />
              <Route path="/records" element={<Records />} />
              <Route path="/weekly-records" element={<WeeklyRecords />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/recaps" element={<Recaps />} />
              <Route path="/rookies" element={<Rookies />} />
              <Route path="/draft-grades" element={<DraftGrades />} />
              <Route path="/dynasty-digest" element={<DynastyDigest />} />
              <Route path="/gm-scouting" element={<GMScouting />} />
              <Route path="/hall" element={<Hall />} />
              <Route path="/season14" element={<Season14 />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
        </div>
      </Router>
    </QueryClientProvider>
  );
}

export default App;