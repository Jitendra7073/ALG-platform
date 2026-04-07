import { Inter } from "next/font/google";
import "./globals.css";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Email Campaign System",
  description: "Advanced Email Marketing & Automation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} min-h-screen bg-background`}>
        <DashboardLayout>
          {children}
        </DashboardLayout>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
