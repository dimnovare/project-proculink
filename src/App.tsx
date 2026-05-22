import { RedirectToSignIn, SignedIn, SignedOut } from "@clerk/clerk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import NotFound from "@/pages/NotFound";
import OrderDetailPage from "@/pages/OrderDetailPage";
import OrdersPage from "@/pages/OrdersPage";
import SupplierProfilesPage from "@/pages/SupplierProfilesPage";
import UploadPage from "@/pages/UploadPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />

      {/* Unauthenticated visitors are redirected to Clerk's hosted sign-in */}
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>

      {/* All app routes are only rendered for authenticated users */}
      <SignedIn>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/:id" element={<OrderDetailPage />} />
              <Route path="/admin/suppliers" element={<SupplierProfilesPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </SignedIn>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
